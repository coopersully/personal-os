import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  truncateSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { collect, LIMITS, prepare } from "./collect-browser-diagnostics.mjs";

const helper = resolve(import.meta.dirname, "collect-browser-diagnostics.mjs");
const zip = Buffer.from([80, 75, 3, 4, 1, 2, 3]);
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

function fixture(run, overrides = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "nohmi-browser-diagnostics-")));
  const workspace = join(root, "workspace");
  const runner = join(root, "runner");
  mkdirSync(join(workspace, ".github/workflows"), { recursive: true });
  mkdirSync(runner);
  writeFileSync(join(workspace, ".github/workflows/ci.yml"), "name: fixture\n");
  const git = (args) =>
    execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], {
      cwd: workspace,
      encoding: "utf8",
      timeout: 10000,
    });
  git(["init", "-q"]);
  git(["add", "."]);
  git([
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-qm",
    "fixture",
  ]);
  const sha = git(["rev-parse", "HEAD"]).trim();
  const env = {
    GITHUB_REPOSITORY: "fixture/repository",
    GITHUB_RUN_ID: "101",
    GITHUB_RUN_ATTEMPT: "2",
    GITHUB_JOB: "browser",
    GITHUB_EVENT_NAME: "pull_request",
    GITHUB_SHA: sha,
    GITHUB_WORKFLOW_SHA: sha,
    GITHUB_WORKFLOW_REF: "fixture/repository/.github/workflows/ci.yml@refs/pull/7/merge",
    PR_NUMBER: "7",
    PR_HEAD_SHA: "a".repeat(40),
    PR_BASE_SHA: "b".repeat(40),
    RUNNER_TEMP: runner,
    BROWSER_PROJECT: "mobile-chromium",
    BROWSER_SHARD: "1",
    BROWSER_DIAGNOSTIC_CONTEXT: "local-e2e-fixtures",
    BROWSER_TEST_OUTCOME: "success",
    ...overrides,
  };
  const options = { workspace, staging: join(runner, "browser-diagnostics"), env };
  try {
    const marker = prepare(options);
    const attach = (name, data, caseName = "failed-case-mobile-chromium") => {
      const path = join(workspace, "test-results", caseName, name);
      mkdirSync(join(workspace, "test-results", caseName), { recursive: true });
      writeFileSync(path, data);
      // Keep timestamp fixtures explicit; filesystem precision must not choose test branches.
      const instant = Math.floor(marker.startedMs / 1000) + 1;
      utimesSync(path, instant, instant);
      return path;
    };
    return run({ root, workspace, options, env, marker, attach });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("failed-attempt attachments survive terminal retry success without claiming body/retry identity", () =>
  fixture(({ options, attach }) => {
    attach("trace.zip", zip);
    attach("test-failed-1.png", png);
    attach("error-context.md", "fixture context");
    const { manifest, exitCode } = collect(options);
    assert.equal(exitCode, 0);
    assert.equal(manifest.sourceStepOutcome, "success");
    assert.equal(manifest.diagnostics, "collected");
    assert.equal(manifest.files.length, 3);
    assert.equal(manifest.identity.runAttempt, 2);
    assert.equal(manifest.identity.project, "mobile-chromium");
    assert.equal(manifest.identity.shard, 1);
    assert.equal(manifest.sourceReceipt.validated, false);
    for (const file of manifest.files) {
      const data = readFileSync(join(options.staging, "artifact", file.stagedPath));
      assert.equal(data.length, file.bytes);
      assert.equal(digest(data), file.sha256);
      assert.equal(file.retryIndex, "not-recorded");
      assert.equal(file.testIdentity, "not-recorded");
    }
    assert.equal(
      manifest.attachmentBytes,
      manifest.files.reduce((sum, f) => sum + f.bytes, 0),
    );
    assert.equal(readdirSync(join(options.staging, "artifact")).length, 4);
    assert.ok(!readdirSync(join(options.staging, "artifact")).includes(".prepare.json"));
  }));

for (const outcome of ["success", "failure", "skipped", "cancelled", "unknown"]) {
  test(`absence is honest and source ${outcome} remains distinct from diagnostics`, () =>
    fixture(
      ({ options }) => {
        const result = collect(options);
        assert.equal(result.manifest.sourceStepOutcome, outcome);
        assert.equal(result.manifest.diagnostics, "absent");
        assert.equal(result.manifest.attachmentBytes, 0);
        assert.deepEqual(result.manifest.files, []);
        assert.ok(result.manifest.gaps.includes("output_absent"));
        assert.match(result.manifest.meaning, /does not prove a clean first attempt/);
        assert.deepEqual(readdirSync(join(options.staging, "artifact")), ["manifest.json"]);
      },
      { BROWSER_TEST_OUTCOME: outcome },
    ));
}

test("terminal failure can retain bytes while original source failure stays recorded", () =>
  fixture(
    ({ options, attach }) => {
      attach("trace.zip", zip);
      const result = collect(options);
      assert.equal(result.manifest.sourceStepOutcome, "failure");
      assert.equal(result.manifest.files[0].status, "present");
    },
    { BROWSER_TEST_OUTCOME: "failure" },
  ));

test("a present empty context stays distinct from missing attachments", () =>
  fixture(({ options, attach }) => {
    attach("error-context.md", "");
    const { manifest } = collect(options);
    assert.equal(manifest.attachmentBytes, 0);
    assert.equal(manifest.files[0].status, "present");
    assert.equal(manifest.diagnostics, "collected");
  }));

test("only bounded allowlisted failure attachments are staged", () =>
  fixture(({ options, workspace, attach }) => {
    attach("trace.zip", zip);
    for (const name of [
      ".env",
      "state.json",
      "video.webm",
      "index.html",
      ".last-run.json",
      "notes.txt",
    ])
      attach(name, "not staged");
    mkdirSync(join(workspace, "playwright-report"));
    writeFileSync(join(workspace, "playwright-report/index.html"), "not staged");
    const result = collect(options);
    assert.equal(result.manifest.files.length, 1);
    assert.equal(result.manifest.files[0].type, "trace");
    assert.equal(readdirSync(join(options.staging, "artifact")).length, 2);
  }));

test("raw trace content is not called sanitized and environment values are not copied", () =>
  fixture(({ options, attach }) => {
    options.env.GOOGLE_CLIENT_SECRET = "environment-canary-not-for-artifact";
    const raw = Buffer.concat([zip, Buffer.from("fixture-session-canary")]);
    attach("trace.zip", raw);
    const { manifest } = collect(options);
    assert.match(manifest.privacy.content, /Unsanitized/);
    assert.match(manifest.privacy.audience, /not private/);
    assert.ok(!JSON.stringify(manifest).includes(options.env.GOOGLE_CLIENT_SECRET));
    assert.deepEqual(
      readFileSync(join(options.staging, "artifact", manifest.files[0].stagedPath)),
      raw,
    );
  }));

for (const [name, data, type] of [
  ["trace.zip", zip, "trace"],
  ["test-failed-1.png", png, "screenshot"],
  ["error-context.md", "fixture context", "context"],
]) {
  test(`${type} limit rejects whole file and records observed bytes`, () =>
    fixture(({ options, attach }) => {
      attach(name, data);
      const { manifest, exitCode } = collect({ ...options, limits: { [type]: 1 } });
      assert.equal(exitCode, 1);
      assert.equal(manifest.files[0].status, "rejected");
      assert.equal(manifest.files[0].reason, "file_limit");
      assert.equal(manifest.files[0].observedBytes, Buffer.byteLength(data));
      assert.equal(manifest.attachmentBytes, 0);
      assert.deepEqual(readdirSync(join(options.staging, "artifact")), ["manifest.json"]);
    }));
}

test("combined limit and file-count exhaustion are explicit gaps", () => {
  fixture(({ options, attach }) => {
    attach("trace.zip", zip, "one");
    attach("trace.zip", zip, "two");
    const { manifest, exitCode } = collect({ ...options, limits: { total: zip.length } });
    assert.equal(exitCode, 1);
    assert.ok(manifest.files.some((f) => f.reason === "total_limit"));
    assert.equal(manifest.attachmentBytes, zip.length);
  });
  fixture(({ options, attach }) => {
    attach("trace.zip", zip, "one");
    attach("trace.zip", zip, "two");
    const { manifest, exitCode } = collect({ ...options, limits: { files: 1 } });
    assert.equal(exitCode, 1);
    assert.ok(manifest.gaps.includes("file_count_limit"));
    assert.equal(manifest.files.length, 1);
  });
});

test("entry and depth budgets stop traversal without uploading unknown payloads", () => {
  fixture(({ options, attach }) => {
    attach("notes.txt", "ignored");
    const { manifest, exitCode } = collect({ ...options, limits: { entries: 1 } });
    assert.equal(exitCode, 1);
    assert.ok(manifest.gaps.includes("entry_limit"));
    assert.equal(manifest.enumeratedEntries, 1);
  });
  fixture(({ options, attach }) => {
    attach("trace.zip", zip, "one/two");
    const { manifest, exitCode } = collect({ ...options, limits: { depth: 1 } });
    assert.equal(exitCode, 1);
    assert.ok(manifest.gaps.includes("depth_limit"));
    assert.equal(manifest.files.length, 0);
  });
});

test("stale and malformed attachments are rejected", () => {
  fixture(({ options, marker, attach }) => {
    const path = attach("trace.zip", zip);
    utimesSync(path, (marker.startedMs - 10000) / 1000, (marker.startedMs - 10000) / 1000);
    const result = collect(options);
    assert.equal(result.exitCode, 1);
    assert.equal(result.manifest.files[0].reason, "stale");
  });
  for (const name of ["trace.zip", "test-failed-1.png", "error-context.md"])
    fixture(({ options, attach }) => {
      attach(name, Buffer.from([255, 0, 255]));
      const result = collect(options);
      assert.equal(result.exitCode, 1);
      assert.equal(result.manifest.files[0].reason, "invalid_content");
    });
});

test("symlink paths, hardlinked files and FIFO candidates are not read/uploaded", () => {
  fixture(({ options, workspace, root }) => {
    mkdirSync(join(workspace, "test-results"));
    writeFileSync(join(root, "trace.zip"), zip);
    symlinkSync(root, join(workspace, "test-results", "linked"));
    const result = collect(options);
    assert.equal(result.exitCode, 1);
    assert.ok(result.manifest.gaps.includes("symlink_entry"));
  });
  fixture(({ options, attach }) => {
    const source = attach("trace.zip", zip);
    linkSync(source, join(options.workspace, "copy"));
    const result = collect(options);
    assert.equal(result.exitCode, 1);
    assert.equal(result.manifest.files[0].reason, "not_regular");
  });
  if (process.platform !== "win32")
    fixture(({ options, workspace }) => {
      const dir = join(workspace, "test-results", "case");
      mkdirSync(dir, { recursive: true });
      execFileSync("mkfifo", [join(dir, "trace.zip")], { timeout: 1000 });
      const result = collect(options);
      assert.equal(result.exitCode, 1);
      assert.equal(result.manifest.files[0].reason, "not_regular");
    });
});

test("identity, policy, matrix, marker and manifest bounds fail closed", () => {
  for (const [key, value] of [
    ["GITHUB_SHA", "f".repeat(40)],
    ["BROWSER_PROJECT", "unknown"],
    ["BROWSER_SHARD", "5"],
    ["BROWSER_DIAGNOSTIC_CONTEXT", "production"],
  ])
    fixture(({ options }) => {
      assert.throws(() => collect({ ...options, env: { ...options.env, [key]: value } }));
    });
  fixture(({ options }) => {
    assert.throws(() => prepare(options));
    assert.throws(() => collect({ ...options, limits: { manifest: 1 } }));
  });
  fixture(({ options }) =>
    assert.throws(() => collect({ ...options, limits: { trace: LIMITS.trace + 1 } })),
  );
});

test("push identity is distinct and does not invent a PR receipt", () =>
  fixture(
    ({ options }) => {
      const { manifest } = collect(options);
      assert.equal(manifest.identity.pr, null);
      assert.equal(manifest.sourceReceipt.applicable, false);
    },
    {
      GITHUB_EVENT_NAME: "push",
      GITHUB_WORKFLOW_REF: "fixture/repository/.github/workflows/ci.yml@refs/heads/main",
    },
  ));

test("CLI produces ready only after complete staging, without changing source outcome", () =>
  fixture(({ options, attach, env }) => {
    attach("trace.zip", zip);
    const output = join(options.staging, "outputs");
    const result = spawnSync(process.execPath, [helper, "collect", options.staging], {
      cwd: options.workspace,
      env: { ...process.env, ...env, GITHUB_OUTPUT: output, BROWSER_TEST_OUTCOME: "failure" },
      encoding: "utf8",
      timeout: 10000,
    });
    assert.equal(result.status, 0);
    assert.equal(readFileSync(output, "utf8"), "artifact_ready=true\n");
    assert.equal(
      JSON.parse(readFileSync(join(options.staging, "artifact/manifest.json"))).sourceStepOutcome,
      "failure",
    );
  }));

test("CLI publishes a bounded rejection but keeps diagnostics failure visible", () =>
  fixture(({ options, attach, env, marker }) => {
    const path = attach("trace.zip", zip);
    truncateSync(path, LIMITS.trace + 1);
    const time = Math.floor(marker.startedMs / 1000) + 1;
    utimesSync(path, time, time);
    const output = join(options.staging, "outputs");
    const result = spawnSync(process.execPath, [helper, "collect", options.staging], {
      cwd: options.workspace,
      env: { ...process.env, ...env, GITHUB_OUTPUT: output },
      encoding: "utf8",
      timeout: 10000,
    });
    assert.equal(result.status, 1);
    assert.equal(readFileSync(output, "utf8"), "artifact_ready=true\n");
    const manifest = JSON.parse(readFileSync(join(options.staging, "artifact/manifest.json")));
    assert.equal(manifest.sourceStepOutcome, "success");
    assert.equal(manifest.files[0].reason, "file_limit");
    assert.deepEqual(readdirSync(join(options.staging, "artifact")), ["manifest.json"]);
  }));

test("marker tampering or reused identity never signals safe upload", () =>
  fixture(({ options, env }) => {
    const marker = JSON.parse(readFileSync(join(options.staging, ".prepare.json")));
    marker.identity.runAttempt++;
    writeFileSync(join(options.staging, ".prepare.json"), JSON.stringify(marker));
    const output = join(options.staging, "outputs");
    const result = spawnSync(process.execPath, [helper, "collect", options.staging], {
      cwd: options.workspace,
      env: { ...process.env, ...env, GITHUB_OUTPUT: output },
      encoding: "utf8",
      timeout: 10000,
    });
    assert.equal(result.status, 1);
    assert.ok(!readdirSync(options.staging).includes("outputs"));
    assert.deepEqual(readdirSync(join(options.staging, "artifact")), []);
  }));

test("unsafe output root and unlisted staging data cannot become an artifact", () => {
  fixture(({ options, root, workspace }) => {
    symlinkSync(root, join(workspace, "test-results"));
    assert.throws(() => collect(options));
    assert.deepEqual(readdirSync(join(options.staging, "artifact")), []);
  });
  fixture(({ options }) => {
    writeFileSync(join(options.staging, "artifact", "unexpected.txt"), "not approved");
    assert.throws(() => collect(options), /Unexpected staged/);
    assert.ok(!readdirSync(join(options.staging, "artifact")).includes("manifest.json"));
  });
});

test("workflow retains retry-success evidence with unchanged source command and strict gating", () => {
  const workflow = readFileSync(resolve(import.meta.dirname, "../workflows/ci.yml"), "utf8");
  const browser = workflow.split("  browser:\n")[1].split("\n  desktop:\n")[0];
  assert.match(browser, /timeout-minutes: 30/);
  assert.match(browser, /project: \[desktop-chromium, mobile-chromium\]/);
  assert.match(browser, /shard: \[1, 2, 3, 4\]/);
  assert.equal(
    (
      browser.match(
        /run: pnpm test:e2e --project=\$\{\{ matrix.project \}\} --shard=\$\{\{ matrix.shard \}\}\/4/g,
      ) ?? []
    ).length,
    1,
  );
  assert.match(browser, /id: browser_tests/);
  assert.match(browser, /BROWSER_TEST_OUTCOME: \$\{\{ steps.browser_tests.outcome \}\}/);
  assert.match(
    browser,
    /if: \$\{\{ always\(\) && steps.browser_diagnostics.outputs.artifact_ready == 'true' \}\}/,
  );
  assert.match(browser, /path: \$\{\{ runner.temp \}\}\/browser-diagnostics\/artifact\//);
  assert.match(
    browser,
    /name: browser-diagnostics-\$\{\{ github.run_id \}\}-\$\{\{ github.run_attempt \}\}-\$\{\{ matrix.project \}\}-\$\{\{ matrix.shard \}\}/,
  );
  assert.match(browser, /retention-days: 7/);
  assert.match(browser, /if-no-files-found: error/);
  assert.match(browser, /include-hidden-files: false/);
  assert.doesNotMatch(
    browser,
    /continue-on-error|failure\(\)|playwright-report|secrets\.|\|\| true/,
  );
  const config = readFileSync(resolve(import.meta.dirname, "../../playwright.config.ts"), "utf8");
  assert.match(config, /retries: process.env.CI \? 1 : 0/);
  assert.match(config, /timeout: 45_000/);
  assert.match(config, /workers: 1/);
  assert.match(config, /trace: "retain-on-failure"/);
  assert.match(config, /screenshot: "only-on-failure"/);
});
