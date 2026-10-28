import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  futimesSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  truncateSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { collect, LIMITS, prepare } from "./collect-node-coverage.mjs";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const helper = resolve(import.meta.dirname, "collect-node-coverage.mjs");
const fixtureTimes = new Map();

function fixture(run, event = "pull_request") {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "nohmi-coverage-")));
  const workspace = join(root, "workspace");
  const staging = join(root, "runner", "node-coverage");
  mkdirSync(join(workspace, ".github", "workflows"), { recursive: true });
  mkdirSync(join(workspace, "coverage"));
  mkdirSync(join(root, "runner"));
  writeFileSync(join(workspace, ".github", "workflows", "ci.yml"), "name: fixture\n");
  const git = (args) =>
    execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], {
      cwd: workspace,
      encoding: "utf8",
      timeout: 10000,
    });
  git(["init", "-q", workspace]);
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
    GITHUB_JOB: "quality",
    GITHUB_EVENT_NAME: "pull_request",
    GITHUB_SHA: sha,
    GITHUB_WORKFLOW_SHA: sha,
    GITHUB_WORKFLOW_REF: "fixture/repository/.github/workflows/ci.yml@refs/pull/7/merge",
    PR_NUMBER: "7",
    PR_HEAD_SHA: "a".repeat(40),
    PR_BASE_SHA: "b".repeat(40),
    INSTALL_OUTCOME: "success",
    AUDIT_OUTCOME: "success",
    NODE_OUTCOME: "failure",
    RUNNER_TEMP: join(root, "runner"),
  };
  if (event === "push") {
    env.GITHUB_EVENT_NAME = "push";
    env.GITHUB_WORKFLOW_REF = "fixture/repository/.github/workflows/ci.yml@refs/heads/main";
    delete env.PR_NUMBER;
    delete env.PR_HEAD_SHA;
    delete env.PR_BASE_SHA;
  }
  const options = { workspace, staging, env };
  try {
    const marker = prepare(options);
    // Control synthetic report time; filesystem timestamps need not track Date.now().
    // Whole seconds avoid sub-millisecond conversion ambiguity without sleeps or tolerances.
    fixtureTimes.set(workspace, Math.floor(marker.startedMs / 1000) + 1);
    return run({ root, workspace, staging, env, options });
  } finally {
    fixtureTimes.delete(workspace);
    rmSync(root, { recursive: true, force: true });
  }
}

function reports(workspace) {
  const path = join(workspace, "apps", "api", "src", "fixture.ts");
  mkdirSync(join(workspace, "apps", "api", "src"), { recursive: true });
  writeFileSync(path, "export function probe() {}\n");
  const point = { line: 1, column: 0 };
  const loc = { start: point, end: { line: 1, column: 8 } };
  const metric = { total: 1, covered: 1, skipped: 0, pct: 100 };
  const summary = {
    total: { lines: metric, statements: metric, functions: metric, branches: metric },
  };
  const map = {
    [path]: {
      path,
      all: false,
      statementMap: { 0: loc },
      s: { 0: 1 },
      fnMap: { 0: { name: "probe", decl: loc, loc, line: 1 } },
      f: { 0: 1 },
      branchMap: { 0: { type: "branch", line: 1, loc, locations: [loc] } },
      b: { 0: [1] },
    },
  };
  return { summary, map };
}

function writeReport(workspace, name, data) {
  assert.ok(["coverage-summary.json", "coverage-final.json"].includes(name));
  const seconds = fixtureTimes.get(workspace);
  assert.ok(Number.isSafeInteger(seconds));
  const directory = join(workspace, "coverage");
  assert.ok(lstatSync(directory).isDirectory());
  assert.equal(realpathSync(directory), directory);
  // Exclusive creation refuses existing links/special files; timestamp the opened file.
  const fd = openSync(join(directory, name), "wx");
  try {
    writeFileSync(fd, data);
    futimesSync(fd, seconds, seconds);
  } finally {
    closeSync(fd);
  }
}

function writeReports(workspace, values = reports(workspace)) {
  writeReport(workspace, "coverage-summary.json", JSON.stringify(values.summary));
  writeReport(workspace, "coverage-final.json", JSON.stringify(values.map));
}

function retainedReportFailure(workspace, staging, result) {
  const observe = (read) => {
    try {
      return read();
    } catch (error) {
      return { unavailable: /^[A-Z_]+$/.test(error?.code ?? "") ? error.code : "READ_FAILED" };
    }
  };
  try {
    const marker = observe(() => JSON.parse(readFileSync(join(staging, ".prepare.json"), "utf8")));
    const reports = Object.fromEntries(
      ["coverage-summary.json", "coverage-final.json"].map((name) => [
        name,
        observe(() => {
          const stat = lstatSync(join(workspace, "coverage", name));
          return {
            size: stat.size,
            mtimeMs: stat.mtimeMs,
            ctimeMs: stat.ctimeMs,
            nlink: stat.nlink,
            regular: stat.isFile(),
            freshnessDeltaMs: Number.isFinite(marker.startedMs)
              ? stat.mtimeMs - marker.startedMs
              : null,
          };
        }),
      ]),
    );
    const context = JSON.stringify({
      syntheticFixture: true,
      manifest: result.manifest,
      marker,
      reports,
    });
    return Buffer.byteLength(context, "utf8") <= 65536
      ? context
      : "Synthetic retention diagnostic exceeds 64 KiB.";
  } catch {
    return "Synthetic retention diagnostic unavailable; original collection assertion failed.";
  }
}

test("synthetic report timestamps are explicitly fresh relative to their prepare marker", () =>
  fixture(({ workspace, staging }) => {
    writeReports(workspace);
    const marker = JSON.parse(readFileSync(join(staging, ".prepare.json"), "utf8"));
    for (const name of ["coverage-summary.json", "coverage-final.json"]) {
      const stat = lstatSync(join(workspace, "coverage", name));
      assert.equal(stat.mtimeMs, (Math.floor(marker.startedMs / 1000) + 1) * 1000);
      assert.ok(stat.mtimeMs > marker.startedMs);
    }
  }));

for (const kind of ["symlink", "hardlink", "fifo"]) {
  test(
    `fixture writer refuses an existing ${kind} without following it`,
    {
      skip: kind === "fifo" && process.platform === "win32",
    },
    () =>
      fixture(({ root, workspace }) => {
        const outside = join(root, "outside.json");
        const target = join(workspace, "coverage", "coverage-summary.json");
        writeFileSync(outside, "untouched");
        if (kind === "symlink") symlinkSync(outside, target);
        else if (kind === "hardlink") linkSync(outside, target);
        else execFileSync("mkfifo", [target]);
        assert.throws(() => writeReport(workspace, "coverage-summary.json", "replacement"), {
          code: "EEXIST",
        });
        assert.equal(readFileSync(outside, "utf8"), "untouched");
      }),
  );
}

test("fixture writer refuses a replaced coverage directory", () =>
  fixture(({ root, workspace }) => {
    const directory = join(workspace, "coverage");
    const outside = join(root, "outside");
    renameSync(directory, outside);
    symlinkSync(outside, directory);
    assert.throws(() => writeReport(workspace, "coverage-summary.json", "replacement"));
    assert.throws(() => readFileSync(join(outside, "coverage-summary.json")));
  }));

test("retention failure context preserves synthetic manifest, marker and file stats", () =>
  fixture(({ workspace, staging }) => {
    writeReports(workspace);
    const result = { manifest: { files: [{ status: "rejected", reason: "stale" }] } };
    const message = retainedReportFailure(workspace, staging, result);
    const context = JSON.parse(message);
    assert.deepEqual(context.manifest, result.manifest);
    assert.equal(context.syntheticFixture, true);
    assert.equal(typeof context.marker.startedMs, "number");
    assert.equal(context.reports["coverage-summary.json"].regular, true);
    assert.equal(context.reports["coverage-summary.json"].nlink, 1);
    assert.equal(typeof context.reports["coverage-summary.json"].freshnessDeltaMs, "number");
    assert.ok(Buffer.byteLength(message) <= 65536);
  }));

test("unavailable diagnostic reads cannot mask the original retention assertion", () =>
  fixture(({ workspace, staging }) => {
    rmSync(join(staging, ".prepare.json"));
    const context = JSON.parse(retainedReportFailure(workspace, staging, { manifest: {} }));
    assert.deepEqual(context.marker, { unavailable: "ENOENT" });
    assert.deepEqual(context.reports["coverage-final.json"], { unavailable: "ENOENT" });
    assert.throws(
      () => assert.equal(1, 0, retainedReportFailure(workspace, staging, { manifest: {} })),
      { code: "ERR_ASSERTION" },
    );
    const result = Object.defineProperty({}, "manifest", {
      get() {
        throw new Error("synthetic diagnostic failure");
      },
    });
    assert.match(retainedReportFailure(workspace, staging, result), /diagnostic unavailable/);
  }));

test("retention failure context is bounded in UTF-8 bytes", () =>
  fixture(({ workspace, staging }) => {
    const message = retainedReportFailure(workspace, staging, {
      manifest: { value: "界".repeat(22000) },
    });
    assert.equal(message, "Synthetic retention diagnostic exceeds 64 KiB.");
    assert.ok(Buffer.byteLength(message) <= 65536);
  }));

for (const outcome of ["failure", "success"]) {
  test(`retains exact generated bytes and attempt identity after Node ${outcome}`, () =>
    fixture(({ workspace, staging, env, options }) => {
      env.NODE_OUTCOME = outcome;
      const values = reports(workspace);
      if (outcome === "failure") {
        values.summary.total.branches = { total: 1, covered: 0, skipped: 0, pct: 0 };
        Object.values(values.map)[0].b[0] = [0];
      }
      writeReports(workspace, values);
      const result = collect(options);
      assert.equal(
        result.exitCode,
        0,
        result.exitCode === 0 ? undefined : retainedReportFailure(workspace, staging, result),
      );
      assert.equal(result.manifest.sourceSteps.node, outcome);
      assert.equal(result.manifest.identity.runAttempt, 2);
      assert.equal(result.manifest.identity.checkoutSha, env.GITHUB_SHA);
      assert.equal(result.manifest.sourceReceipt.validated, false);
      assert.equal(result.manifest.sourceReceipt.expectedArtifact, "source-candidate-101-2");
      for (const file of result.manifest.files) {
        assert.equal(file.status, "present");
        const actual = readFileSync(join(workspace, "coverage", file.name));
        assert.deepEqual(readFileSync(join(staging, file.name)), actual);
        assert.equal(file.sha256, digest(actual));
        assert.equal(file.bytes, actual.length);
      }
      assert.ok(readFileSync(join(staging, "manifest.json")).length <= LIMITS.manifest);
    }));
}

for (const stage of ["install", "audit", "node"]) {
  test(`records honest absent reports when ${stage} fails before reports exist`, () =>
    fixture(({ env, options }) => {
      env.INSTALL_OUTCOME = stage === "install" ? "failure" : "success";
      env.AUDIT_OUTCOME =
        stage === "install" ? "skipped" : stage === "audit" ? "failure" : "success";
      env.NODE_OUTCOME = stage === "node" ? "failure" : "skipped";
      const result = collect(options);
      assert.equal(result.exitCode, 0);
      assert.deepEqual(
        result.manifest.files.map((file) => file.reason),
        ["absent", "absent"],
      );
      assert.ok(
        result.manifest.files.every((file) => !("sha256" in file) && !("coverage" in file)),
      );
      assert.equal(result.manifest.failureStage, undefined);
    }));
}

test("missing reports after a successful Node check are a visible diagnostic failure", () =>
  fixture(({ env, options }) => {
    env.NODE_OUTCOME = "success";
    const result = collect(options);
    assert.equal(result.exitCode, 1);
    assert.equal(result.manifest.diagnostics, "incomplete");
  }));

test("push provenance does not invent a PR source receipt", () =>
  fixture(({ env, options }) => {
    env.GITHUB_EVENT_NAME = "push";
    env.GITHUB_WORKFLOW_REF = "fixture/repository/.github/workflows/ci.yml@refs/heads/main";
    delete env.PR_NUMBER;
    delete env.PR_HEAD_SHA;
    delete env.PR_BASE_SHA;
    // The original PR marker must not be usable by a different event.
    assert.throws(() => collect(options), /identity/);
  }));

test("a genuine push marker records no PR receipt", () =>
  fixture(({ options }) => {
    const result = collect(options);
    assert.equal(result.manifest.identity.event, "push");
    assert.equal(result.manifest.identity.pr, null);
    assert.equal(result.manifest.sourceReceipt.applicable, false);
    assert.equal(result.manifest.sourceReceipt.expectedArtifact, undefined);
  }, "push"));

test("rejects a marker from a different source attempt", () =>
  fixture(({ env, options }) => {
    env.GITHUB_RUN_ATTEMPT = "3";
    assert.throws(() => collect(options), /identity/);
  }));

test("rejects malformed JSON without uploading its bytes", () =>
  fixture(({ workspace, staging, options }) => {
    writeReport(workspace, "coverage-summary.json", "{invalid");
    const result = collect(options);
    assert.equal(result.exitCode, 1);
    assert.equal(result.manifest.files[0].reason, "invalid_json");
    assert.equal(result.manifest.files[0].observedBytes, undefined);
    assert.throws(() => readFileSync(join(staging, "coverage-summary.json")));
  }));

test("rejects embedded source maps instead of exposing source content", () =>
  fixture(({ workspace, options }) => {
    const values = reports(workspace);
    Object.values(values.map)[0].inputSourceMap = { sourcesContent: ["private source"] };
    writeReports(workspace, values);
    const result = collect(options);
    assert.equal(result.exitCode, 1);
    assert.equal(result.manifest.files[1].reason, "invalid_coverage_shape");
  }));

test("rejects out-of-root coverage paths", () =>
  fixture(({ workspace, options }) => {
    const values = reports(workspace);
    const entry = Object.values(values.map)[0];
    entry.path = "/outside/private.ts";
    values.map = { [entry.path]: entry };
    writeReports(workspace, values);
    const result = collect(options);
    assert.equal(result.manifest.files[1].reason, "invalid_coverage_shape");
  }));

test("rejects a workflow changed after preparation despite an unchanged Git HEAD", () =>
  fixture(({ workspace, options }) => {
    writeFileSync(join(workspace, ".github", "workflows", "ci.yml"), "name: changed\n");
    assert.throws(() => collect(options), /identity/);
  }));

test("rejects a stale file from before preparation", () =>
  fixture(({ workspace, options }) => {
    writeReports(workspace);
    utimesSync(join(workspace, "coverage", "coverage-summary.json"), 1, 1);
    const result = collect(options);
    assert.equal(result.manifest.files[0].reason, "stale");
  }));

test("does not follow report symlinks", () =>
  fixture(({ root, workspace, options }) => {
    const outside = join(root, "outside.json");
    writeFileSync(outside, "{}");
    symlinkSync(outside, join(workspace, "coverage", "coverage-summary.json"));
    const result = collect(options);
    assert.equal(result.manifest.files[0].status, "rejected");
    assert.notEqual(result.manifest.files[0].status, "present");
  }));

test("rejects a coverage directory symlink", () =>
  fixture(({ root, workspace, options }) => {
    const outside = join(root, "outside");
    renameSync(join(workspace, "coverage"), outside);
    symlinkSync(outside, join(workspace, "coverage"));
    const result = collect(options);
    assert.equal(result.exitCode, 1);
    assert.ok(result.manifest.files.every((file) => file.reason === "unsafe_directory"));
  }));

test("rejects hard-linked reports", () =>
  fixture(({ root, workspace, options }) => {
    const outside = join(root, "outside.json");
    writeFileSync(outside, "{}");
    linkSync(outside, join(workspace, "coverage", "coverage-summary.json"));
    assert.equal(collect(options).manifest.files[0].reason, "not_regular");
  }));

test("rejects inconsistent counter and location maps", () =>
  fixture(({ workspace, options }) => {
    const values = reports(workspace);
    Object.values(values.map)[0].b[0] = [1, 0];
    writeReports(workspace, values);
    assert.equal(collect(options).manifest.files[1].reason, "invalid_coverage_shape");
  }));

test("a FIFO input cannot block collection", { skip: process.platform === "win32" }, () =>
  fixture(({ workspace, options }) => {
    execFileSync("mkfifo", [join(workspace, "coverage", "coverage-summary.json")]);
    const result = collect(options);
    assert.equal(result.exitCode, 1);
    assert.equal(result.manifest.files[0].reason, "not_regular");
  }),
);

test("file and aggregate budgets exclude whole files without truncation", () =>
  fixture(({ workspace, options }) => {
    writeReports(workspace);
    const summaryBytes = readFileSync(join(workspace, "coverage", "coverage-summary.json")).length;
    const result = collect({
      ...options,
      limits: { summary: 4096, detailed: 4096, total: summaryBytes, manifest: LIMITS.manifest },
    });
    assert.equal(result.manifest.files[0].status, "present");
    assert.equal(result.manifest.files[1].reason, "total_limit");
    assert.equal(result.exitCode, 1);
  }));

test("oversized inputs are rejected before JSON parsing", () =>
  fixture(({ workspace, options }) => {
    writeReport(workspace, "coverage-summary.json", "x".repeat(1025));
    const result = collect({
      ...options,
      limits: { summary: 1024, detailed: 1024, total: 2048, manifest: LIMITS.manifest },
    });
    assert.equal(result.manifest.files[0].reason, "file_limit");
    assert.equal(result.manifest.files[0].observedBytes, 1025);
    assert.equal(result.manifest.files[0].sha256, undefined);
  }));

test("accepts exact byte-budget boundaries without changing generated bytes", () =>
  fixture(({ workspace, options }) => {
    writeReports(workspace);
    const summaryBytes = readFileSync(join(workspace, "coverage", "coverage-summary.json")).length;
    const mapBytes = readFileSync(join(workspace, "coverage", "coverage-final.json")).length;
    const result = collect({
      ...options,
      limits: {
        summary: summaryBytes,
        detailed: mapBytes,
        total: summaryBytes + mapBytes,
        manifest: LIMITS.manifest,
      },
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.manifest.reportBytes, summaryBytes + mapBytes);
  }));

for (const [name, key, index] of [
  ["coverage-summary.json", "summary", 0],
  ["coverage-final.json", "detailed", 1],
]) {
  test(`${name} rejects one byte beyond its own configured limit`, () =>
    fixture(({ workspace, staging, options }) => {
      writeReports(workspace);
      const size = lstatSync(join(workspace, "coverage", name)).size;
      const result = collect({ ...options, limits: { [key]: size - 1 } });
      assert.deepEqual(result.manifest.files[index], {
        name,
        status: "rejected",
        reason: "file_limit",
        observedBytes: size,
      });
      assert.equal(result.exitCode, 1);
      assert.throws(() => readFileSync(join(staging, name)));
    }));

  test(`${name} enforces its default hard limit without reading a sparse oversized file`, () =>
    fixture(({ workspace, staging, options }) => {
      const path = join(workspace, "coverage", name);
      writeReport(workspace, name, "");
      truncateSync(path, LIMITS[key] + 1);
      const result = collect(options);
      assert.deepEqual(result.manifest.files[index], {
        name,
        status: "rejected",
        reason: "file_limit",
        observedBytes: LIMITS[key] + 1,
      });
      assert.equal(result.exitCode, 1);
      assert.throws(() => readFileSync(join(staging, name)));
    }));
}

test("a combined budget one byte short rejects the whole detailed report", () =>
  fixture(({ workspace, staging, options }) => {
    writeReports(workspace);
    const summaryBytes = lstatSync(join(workspace, "coverage", "coverage-summary.json")).size;
    const mapBytes = lstatSync(join(workspace, "coverage", "coverage-final.json")).size;
    const result = collect({ ...options, limits: { total: summaryBytes + mapBytes - 1 } });
    assert.equal(result.manifest.files[0].status, "present");
    assert.deepEqual(result.manifest.files[1], {
      name: "coverage-final.json",
      status: "rejected",
      reason: "total_limit",
    });
    assert.equal(result.manifest.reportBytes, summaryBytes);
    assert.equal(result.exitCode, 1);
    assert.throws(() => readFileSync(join(staging, "coverage-final.json")));
  }));

test("manifest overflow fails before publishing an uploadable manifest", () =>
  fixture(({ staging, options }) => {
    assert.throws(
      () => collect({ ...options, limits: { ...LIMITS, manifest: 128 } }),
      /manifest exceeds/,
    );
    assert.throws(() => readFileSync(join(staging, "manifest.json")));
  }));

test("rejects invalid UTF-8 rather than changing input bytes", () =>
  fixture(({ workspace, options }) => {
    writeReport(workspace, "coverage-summary.json", Buffer.from([0xff]));
    assert.equal(collect(options).manifest.files[0].reason, "invalid_json");
  }));

test("limits cannot be raised above the fixed upload contract", () =>
  fixture(({ options }) => {
    for (const key of Object.keys(LIMITS)) {
      assert.throws(
        () => collect({ ...options, limits: { ...LIMITS, [key]: LIMITS[key] + 1 } }),
        /limits/,
      );
    }
  }));

test("a staging collision cannot publish an upload-ready signal or overwrite bytes", () =>
  fixture(({ workspace, staging, options }) => {
    writeReports(workspace);
    const destination = join(staging, "coverage-summary.json");
    writeFileSync(destination, "untouched");
    assert.throws(() => collect(options));
    assert.equal(readFileSync(destination, "utf8"), "untouched");
    assert.throws(() => readFileSync(join(staging, "manifest.json")));
  }));

test("unsafe staging does not provide an upload-ready signal", () =>
  fixture(({ root, staging, options }) => {
    rmSync(staging, { recursive: true });
    symlinkSync(root, staging);
    assert.throws(() => collect(options), /directory/);
  }));

test("failed source and successful diagnostic outcomes remain distinct", () =>
  fixture(({ workspace, staging, env }) => {
    const output = join(staging, "step-output");
    const source = spawnSync(process.execPath, ["-e", "process.exit(23)"], { timeout: 10000 });
    assert.equal(source.status, 23);
    const cli = spawnSync(process.execPath, [helper, "collect", staging], {
      cwd: workspace,
      env: { ...process.env, ...env, GITHUB_OUTPUT: output },
      timeout: 10000,
    });
    assert.equal(cli.status, 0);
    assert.match(readFileSync(output, "utf8"), /artifact_ready=true/);
    assert.equal(source.status, 23);
    assert.equal(
      JSON.parse(readFileSync(join(staging, "manifest.json"))).sourceSteps.node,
      "failure",
    );
    // Actual workflow gating is checked separately: diagnostics do not own the source command.
    assert.equal(cli.status, 0);
  }));

test("repository verification registers fixtures and preserves Node failure gating", () => {
  const root = resolve(import.meta.dirname, "../..");
  const workflow = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");
  const hook = readFileSync(join(root, ".codex/scripts/check.sh"), "utf8");
  assert.match(hook, /node --test .*collect-node-coverage\.test\.mjs/);
  const quality = workflow.split("  quality:\n")[1].split("  browser:\n")[0];
  assert.match(quality, /- id: node\n\s+run: pnpm check:node/);
  assert.doesNotMatch(quality, /continue-on-error|\|\| true/);
  assert.match(quality, /if: always\(\)/);
  assert.match(quality, /steps\.coverage\.outputs\.artifact_ready == 'true'/);
  assert.match(quality, /retention-days: 7/);
  assert.doesNotMatch(quality, /path:.*\*/);
});
