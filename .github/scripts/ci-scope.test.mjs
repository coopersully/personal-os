import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  classifyChanges,
  classifyGitChanges,
  classifyPushChanges,
  expectedJobs,
  jobIds,
  requiredGate,
} from "./ci-scope.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));

const emptyScope = {
  prose_only: false,
  full: false,
  repo: false,
  terraform: false,
  node: false,
  database: false,
  browser: false,
  desktop: false,
  containers: false,
  dependencies: false,
  changed_packages: [],
};

function scope(overrides = {}) {
  return { ...emptyScope, ...overrides };
}

const cases = [
  ["docs only", ["docs/engineering/ci.md", "README.md"], scope({ repo: true })],
  ["Terraform root", ["infra/main.tf"], scope({ terraform: true })],
  ["bootstrap Terraform", ["infra/bootstrap/state.tf"], scope({ terraform: true })],
  [
    "domain and all transitive dependents",
    ["packages/domain/src/calendar.ts"],
    scope({
      node: true,
      browser: true,
      desktop: true,
      containers: true,
      changed_packages: [
        "@personal-os/api",
        "@personal-os/api-client",
        "@personal-os/connectors",
        "@personal-os/database",
        "@personal-os/domain",
        "@personal-os/mcp",
        "@personal-os/web",
      ],
    }),
  ],
  [
    "database migration",
    ["packages/database/migrations/0072_example.sql"],
    scope({
      node: true,
      database: true,
      browser: true,
      containers: true,
      changed_packages: ["@personal-os/api", "@personal-os/database"],
    }),
  ],
  [
    "connectors",
    ["packages/connectors/src/google.ts"],
    scope({
      node: true,
      browser: true,
      containers: true,
      changed_packages: ["@personal-os/api", "@personal-os/connectors"],
    }),
  ],
  [
    "API client",
    ["packages/api-client/src/client.ts"],
    scope({
      node: true,
      browser: true,
      desktop: true,
      containers: true,
      changed_packages: ["@personal-os/api-client", "@personal-os/mcp", "@personal-os/web"],
    }),
  ],
  [
    "UI package",
    ["packages/ui/src/index.tsx"],
    scope({
      node: true,
      browser: true,
      desktop: true,
      containers: true,
      changed_packages: ["@personal-os/ui", "@personal-os/web"],
    }),
  ],
  [
    "web app",
    ["apps/web/src/app.tsx"],
    scope({
      node: true,
      browser: true,
      desktop: true,
      containers: true,
      changed_packages: ["@personal-os/web"],
    }),
  ],
  [
    "API app",
    ["apps/api/src/app.ts"],
    scope({
      node: true,
      browser: true,
      containers: true,
      changed_packages: ["@personal-os/api"],
    }),
  ],
  [
    "MCP app",
    ["apps/mcp/src/server.ts"],
    scope({
      node: true,
      containers: true,
      changed_packages: ["@personal-os/mcp"],
    }),
  ],
  [
    "desktop Rust",
    ["apps/desktop/src-tauri/src/main.rs"],
    scope({ desktop: true, changed_packages: ["@personal-os/desktop"] }),
  ],
  ["container definition", ["Dockerfile"], scope({ node: true, containers: true })],
  [
    "repository contract script",
    ["scripts/check-deployment-drain-contract.mjs"],
    scope({ repo: true, node: true }),
  ],
  ["lockfile", ["pnpm-lock.yaml"], scope({ full: true, dependencies: true })],
  ["workflow", [".github/workflows/ci.yml"], scope({ full: true })],
  ["classifier", [".github/scripts/ci-scope.mjs"], scope({ full: true })],
  ["unknown top-level path", ["unowned/new.txt"], scope({ full: true })],
  ["empty input", [], scope({ full: true })],
  ["diff error", ["apps/mcp/src/server.ts"], scope({ full: true })],
];

for (const [name, paths, expected] of cases) {
  test(name, () => {
    const options = name === "diff error" ? { diffError: true } : {};
    assert.deepEqual(classifyChanges(paths, options), expected);
  });
}

test("rejects absolute paths and traversal fail closed", () => {
  assert.equal(classifyChanges(["/tmp/file.ts"]).full, true);
  assert.equal(classifyChanges(["apps/web/../api/src/app.ts"]).full, true);
});

function resultsFor(selected) {
  return Object.fromEntries(
    jobIds.map((job) => [job, selected.includes(job) ? "success" : "skipped"]),
  );
}

test("required gate rejects absent, skipped and failed selected jobs", () => {
  for (const candidate of [scope({ full: true }), scope({ prose_only: true, repo: true })]) {
    const selected = expectedJobs(candidate);
    const good = resultsFor(selected);
    assert.equal(requiredGate(good, candidate), true);
    for (const job of selected) {
      const missing = { ...good };
      delete missing[job];
      assert.equal(requiredGate(missing, candidate), false);
      for (const result of ["skipped", "failure", "cancelled", "", null])
        assert.equal(requiredGate({ ...good, [job]: result }, candidate), false);
    }
    assert.equal(requiredGate({ ...good, surprise: "success" }, candidate), false);
  }
  for (const invalid of [
    null,
    scope(),
    scope({ node: true }),
    scope({ full: true, dependencies: true }),
    {},
    [],
    scope({ full: "true" }),
    scope({ prose_only: true }),
    scope({ extra: false }),
    scope({ changed_packages: null }),
  ])
    assert.equal(requiredGate(resultsFor(jobIds), invalid), false);
});

const fixtureCases = [
  ["docs", { full: false, node: false, terraform: false }],
  ["terraform", { full: false, node: false, terraform: true }],
  ["mcp", { full: false, node: true, containers: true }],
  ["web", { full: false, node: true, browser: true, desktop: true }],
  ["database", { full: false, node: true, database: true }],
  ["lockfile", { full: true, dependencies: true }],
  ["unknown", { full: true }],
];

for (const [name, expected] of fixtureCases) {
  test(`CLI classifies the ${name} fixture`, () => {
    const fixture = resolve(scriptDirectory, "fixtures", "ci-scope", `${name}.txt`);
    assert.ok(readFileSync(fixture, "utf8").trim());
    const output = execFileSync(
      process.execPath,
      [resolve(scriptDirectory, "ci-scope.mjs"), "--files", fixture, "--json"],
      { encoding: "utf8" },
    );
    const actual = JSON.parse(output);
    assert.deepEqual(
      Object.fromEntries(Object.keys(expected).map((key) => [key, actual[key]])),
      expected,
    );
  });
}

test("explicit full verification overrides an otherwise omitted scope", () => {
  assert.deepEqual(
    classifyChanges(["docs/example.md"], { forceFull: true }),
    scope({ full: true }),
  );
  assert.deepEqual(
    classifyChanges(["docs/engineering/example.md"], { forceFull: false }),
    scope({ repo: true }),
  );
});

test("CLI honors only the exact full-verification flag", () => {
  const fixture = resolve(scriptDirectory, "fixtures", "ci-scope", "docs.txt");
  for (const value of ["true", "false", "", "TRUE", "ci:full"]) {
    const output = execFileSync(
      process.execPath,
      [resolve(scriptDirectory, "ci-scope.mjs"), "--files", fixture, "--json"],
      { encoding: "utf8", env: { ...process.env, CI_FULL: value } },
    );
    assert.equal(JSON.parse(output).full, value === "true");
  }
});

const fullScopeJobs = [
  "infrastructure",
  "repository",
  "lint-and-format",
  "quality",
  "browser",
  "desktop",
];

function workflowJobBlocks(workflow) {
  return workflow.split(/(?=^ {2}[a-z][a-z0-9-]*:\r?$)/m);
}

function assertFullScopeJobGates(workflow) {
  const blocks = workflowJobBlocks(workflow);
  for (const job of fullScopeJobs) {
    const block = blocks.find((candidate) => candidate.startsWith(`  ${job}:\n`));
    assert.ok(block, `The ${job} job must exist.`);
    assert.match(
      block,
      new RegExp(
        `^ {4}if: \\$\\{\\{ contains\\(fromJSON\\(needs.changes.outputs.required_jobs \\|\\| '\\[\\]'\\), '${job}'\\) \\}\\}$`,
        "m",
      ),
      `The ${job} job must keep its own full-scope gate.`,
    );
  }
}

test("full opt-in preserves PR events, provenance and all existing job gates", () => {
  const workflow = readFileSync(resolve(scriptDirectory, "../workflows/ci.yml"), "utf8");
  assert.match(workflow, /types: \[opened, reopened, synchronize\]/);
  assert.doesNotMatch(
    workflow,
    /workflow_dispatch|pull_request_target|labeled|issues: write|contents: write/,
  );
  assert.match(
    workflow,
    /CI_FULL: \$\{\{ github.event_name == 'pull_request' && contains\(github.event.pull_request.labels.\*.name, 'ci:full'\) \}\}/,
  );
  assertFullScopeJobGates(workflow);
  assert.match(workflow, /project: \[desktop-chromium, mobile-chromium\]/);
  assert.match(workflow, /os: \[macos-14, windows-latest\]/);
  assert.doesNotMatch(workflow, / {8}with:\n {10}ref:/);
});

test("full opt-in rejects a missing gate even when later jobs retain theirs", () => {
  const workflow = readFileSync(resolve(scriptDirectory, "../workflows/ci.yml"), "utf8");
  for (const job of fullScopeJobs) {
    const withoutGate = workflowJobBlocks(workflow)
      .map((block) =>
        block.startsWith(`  ${job}:\n`) ? block.replace(/^ {4}if:.*\r?\n/m, "") : block,
      )
      .join("");
    assert.notEqual(withoutGate, workflow, `The ${job} fixture must remove its own gate.`);
    assert.throws(
      () => assertFullScopeJobGates(withoutGate),
      {
        name: "AssertionError",
      },
      `A later job must not satisfy the missing ${job} gate.`,
    );
  }
});

test("browser shards retain both complete matrices and the original coverage command", () => {
  const workflow = readFileSync(resolve(scriptDirectory, "../workflows/ci.yml"), "utf8");
  const blocks = workflowJobBlocks(workflow);
  const quality = blocks.find((block) => block.startsWith("  quality:\n"));
  const browser = blocks.find((block) => block.startsWith("  browser:\n"));
  const required = blocks.find((block) => block.startsWith("  required:\n"));
  assert.match(quality, /pnpm check:node/);
  assert.match(quality, /pnpm audit --prod/);
  assert.doesNotMatch(quality, /merge-reports|shard|thresholds|continue-on-error/);
  assert.match(browser, /project: \[desktop-chromium, mobile-chromium\]/);
  assert.match(browser, /shard: \[1, 2, 3, 4\]/);
  assert.match(browser, /--project=\$\{\{ matrix.project \}\} --shard=\$\{\{ matrix.shard \}\}\/4/);
  assert.match(
    browser,
    /name: playwright-report-\$\{\{ matrix.project \}\}-\$\{\{ matrix.shard \}\}/,
  );
  assert.match(browser, /fail-fast: false/);
  assert.doesNotMatch(browser, /continue-on-error/);
  assert.match(required, /- quality\n/);
  assert.match(required, /- browser\n/);
  assert.equal(
    requiredGate({ ...resultsFor(jobIds), browser: "failure" }, scope({ full: true })),
    false,
  );
  assert.equal(
    requiredGate({ ...resultsFor(jobIds), browser: "cancelled" }, scope({ full: true })),
    false,
  );
});

test("production audit fails before expensive Node checks and still blocks readiness", () => {
  const workflow = readFileSync(resolve(scriptDirectory, "../workflows/ci.yml"), "utf8");
  const quality = workflowJobBlocks(workflow).find((block) => block.startsWith("  quality:\n"));
  const commands = [...quality.matchAll(/^ {6}- run: (.+)$/gm)].map((match) => match[1]);
  assert.deepEqual(commands, [
    "pnpm install --frozen-lockfile",
    "pnpm audit --prod",
    "pnpm check:node",
  ]);
  // Default step success conditions must prevent later checks after an audit failure.
  assert.doesNotMatch(quality, /continue-on-error|always\(\)|if: failure\(\)/);
  assert.equal(
    requiredGate({ ...resultsFor(jobIds), quality: "failure" }, scope({ full: true })),
    false,
  );
  assert.equal(
    requiredGate({ ...resultsFor(jobIds), quality: "cancelled" }, scope({ full: true })),
    false,
  );
});

function gitFixture(t) {
  const root = mkdtempSync(resolve(tmpdir(), "nohmi-scope-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "user.name", "Fixture");
  const write = (path, text) => {
    mkdirSync(dirname(resolve(root, path)), { recursive: true });
    writeFileSync(resolve(root, path), text);
  };
  write("docs/engineering/example.md", "Original\n");
  const commit = () => {
    git("add", "-A");
    git("commit", "-m", "fixture");
    return git("rev-parse", "HEAD");
  };
  const base = commit();
  return { root, git, write, commit, base };
}

test("Git proof permits only regular prose additions/modifications", (t) => {
  const f = gitFixture(t);
  f.write("docs/engineering/example.md", "Changed\n");
  f.write(".agents/skills/oversight/references/monitoring.md", "Guidance\n");
  const head = f.commit();
  assert.deepEqual(
    classifyGitChanges(f.base, head, { root: f.root }),
    scope({ prose_only: true, repo: true }),
  );
  assert.equal(classifyGitChanges(f.base, head, { root: f.root, forceFull: true }).full, true);
  assert.equal(classifyGitChanges(head, f.base, { root: f.root }).full, true);
  assert.equal(classifyGitChanges(head, head, { root: f.root }).full, true);
});

test("Git proof broadens executable/generated/mixed/unknown paths and special modes", async (t) => {
  const cases = [
    ["script", (f) => f.write(".agents/skills/oversight/scripts/task.py", "print(1)\n")],
    [
      "script Markdown fixture",
      (f) => f.write(".agents/skills/oversight/scripts/fixture.md", "input\n"),
    ],
    [
      "generated dictionary",
      (f) => f.write("docs/engineering/workspace-agent-tools.md", "generated\n"),
    ],
    ["runtime skill", (f) => f.write("apps/web/public/skills/setup/SKILL.md", "runtime\n")],
    ["nonprose docs", (f) => f.write("docs/engineering/data.json", "{}")],
    ["config", (f) => f.write("package.json", "{}")],
    ["unknown", (f) => f.write("other.md", "unknown\n")],
    ["rename", (f) => f.git("mv", "docs/engineering/example.md", "docs/engineering/renamed.md")],
    ["delete", (f) => f.git("rm", "docs/engineering/example.md")],
    ["executable", (f) => chmodSync(resolve(f.root, "docs/engineering/example.md"), 0o755)],
    [
      "symlink",
      (f) => {
        rmSync(resolve(f.root, "docs/engineering/example.md"));
        symlinkSync("../../package.json", resolve(f.root, "docs/engineering/example.md"));
      },
    ],
  ];
  for (const [name, change] of cases)
    await t.test(name, (t) => {
      const f = gitFixture(t);
      change(f);
      f.write("README.md", "prose too\n");
      assert.equal(classifyGitChanges(f.base, f.commit(), { root: f.root }).full, true);
    });
});

test("workflow derives selection and aggregate from one scope contract", () => {
  const workflow = readFileSync(resolve(scriptDirectory, "../workflows/ci.yml"), "utf8");
  assert.match(workflow, /--base "\$BASE_SHA" --head "\$HEAD_SHA"/);
  assert.match(workflow, /requiredGate\(results, JSON.parse\(scope\)\)/);
  assert.match(workflow, /required_jobs: \$\{\{ steps.scope.outputs.required_jobs \}\}/);
  assertFullScopeJobGates(workflow);
});

test("push or malformed Git identity emits broad scope and selected outputs", (t) => {
  const root = mkdtempSync(resolve(tmpdir(), "nohmi-output-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const outputFile = resolve(root, "outputs");
  const output = execFileSync(
    process.execPath,
    [
      resolve(scriptDirectory, "ci-scope.mjs"),
      "--base",
      "",
      "--head",
      "",
      "--json",
      "--github-output",
      outputFile,
    ],
    { encoding: "utf8" },
  );
  assert.deepEqual(JSON.parse(output), scope({ full: true }));
  assert.ok(readFileSync(outputFile, "utf8").includes(`required_jobs=${JSON.stringify(jobIds)}`));
});

function pushFixture(t) {
  const f = gitFixture(t);
  f.write(".github/scripts/ci-scope.mjs", readFileSync(resolve(scriptDirectory, "ci-scope.mjs")));
  const before = f.commit();
  f.write("README.md", "First prose commit\n");
  f.commit();
  f.write("docs/engineering/example.md", "Second prose commit\n");
  const after = f.commit();
  const eventPath = resolve(f.root, "push-event.json");
  const event = {
    before,
    after,
    ref: "refs/heads/main",
    repository: { id: 123, full_name: "owner/repo" },
    head_commit: { id: after },
    created: false,
    deleted: false,
    forced: false,
  };
  const context = {
    eventName: "push",
    repository: "owner/repo",
    repositoryId: "123",
    ref: event.ref,
    sha: after,
    workspace: f.root,
  };
  const env = {
    ...process.env,
    CI_FULL: "false",
    GITHUB_EVENT_NAME: "push",
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_REPOSITORY: context.repository,
    GITHUB_REPOSITORY_ID: context.repositoryId,
    GITHUB_REF: context.ref,
    GITHUB_SHA: after,
    GITHUB_WORKSPACE: f.root,
  };
  writeFileSync(eventPath, JSON.stringify(event));
  return { ...f, before, after, event, context, env, eventPath };
}

function pushCli(f, args = [], env = f.env) {
  const result = spawnSync(
    process.execPath,
    [
      realpathSync(resolve(f.root, ".github/scripts/ci-scope.mjs")),
      "--github-push",
      "--json",
      ...args,
    ],
    { encoding: "utf8", env, timeout: 5000 },
  );
  assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  return result;
}

test("authenticated push CLI narrows the entire committed prose range", (t) => {
  const f = pushFixture(t);
  assert.deepEqual(JSON.parse(pushCli(f).stdout), scope({ prose_only: true, repo: true }));
  const workflow = readFileSync(resolve(scriptDirectory, "../workflows/ci.yml"), "utf8");
  const run = workflow
    .match(/ {6}- id: scope[\s\S]*? {8}run: \|\n([\s\S]*?)(?=\n {6}- name: Record source event)/)[1]
    .split("\n")
    .map((line) => line.replace(/^ {10}/, ""))
    .join("\n");
  for (const eventName of ["push", "pull_request"]) {
    const outputFile = resolve(f.root, `${eventName}-output`);
    const result = execFileSync("bash", ["-e", "-c", run], {
      cwd: f.root,
      encoding: "utf8",
      env: {
        ...f.env,
        EVENT_NAME: eventName,
        GITHUB_EVENT_NAME: eventName,
        // A push must use the actual event file, not these empty PR fields.
        BASE_SHA: eventName === "push" ? "" : f.before,
        HEAD_SHA: eventName === "push" ? "" : f.after,
        RUNNER_TEMP: f.root,
        GITHUB_OUTPUT: outputFile,
        GITHUB_STEP_SUMMARY: resolve(f.root, "summary"),
      },
    });
    assert.deepEqual(JSON.parse(result), scope({ prose_only: true, repo: true }));
    assert.ok(readFileSync(outputFile, "utf8").includes('required_jobs=["changes","repository"]'));
  }
});

test("push identity rejects unverified event, repository, ref and checkout bindings", (t) => {
  const f = pushFixture(t);
  const classify = (event = f.event, context = f.context, options = {}) =>
    classifyPushChanges(event, context, { root: f.root, ...options });
  assert.equal(classify().prose_only, true);
  const events = [
    null,
    [],
    {},
    { ...f.event, repository: undefined },
    { ...f.event, repository: { ...f.event.repository, full_name: "other/repo" } },
    { ...f.event, repository: { ...f.event.repository, id: 124 } },
    { ...f.event, repository: { ...f.event.repository, id: "123" } },
    { ...f.event, repository: { ...f.event.repository, id: 0 } },
    { ...f.event, ref: "refs/heads/other" },
    { ...f.event, head_commit: null },
    { ...f.event, head_commit: { id: f.before } },
    ...["created", "deleted", "forced"].flatMap((key) =>
      [true, undefined, null, "false"].map((value) => ({ ...f.event, [key]: value })),
    ),
    ...["before", "after"].flatMap((key) =>
      [undefined, null, 123, "", "0".repeat(40), "f".repeat(39), "--all"].map((value) => ({
        ...f.event,
        [key]: value,
      })),
    ),
  ];
  for (const event of events) assert.equal(classify(event).full, true, JSON.stringify(event));
  for (const context of [
    null,
    {},
    { ...f.context, eventName: "pull_request" },
    { ...f.context, eventName: "workflow_dispatch" },
    { ...f.context, repository: "other/repo" },
    { ...f.context, repositoryId: "00123" },
    { ...f.context, repositoryId: 123 },
    { ...f.context, ref: "refs/heads/other" },
    { ...f.context, sha: f.before },
    { ...f.context, workspace: undefined },
    { ...f.context, workspace: tmpdir() },
  ])
    assert.equal(classify(f.event, context).full, true, JSON.stringify(context));
  assert.equal(
    classify({ ...f.event, ref: "refs/tags/v1" }, { ...f.context, ref: "refs/tags/v1" }).full,
    true,
  );
  assert.equal(classify(f.event, f.context, { forceFull: true }).full, true);
  assert.equal(
    classify(
      { ...f.event, after: f.before, head_commit: { id: f.before } },
      { ...f.context, sha: f.before },
    ).full,
    true,
    "Event and context agree but actual HEAD differs",
  );
});

test("push classification includes earlier runtime changes and fails full on uncertain history", (t) => {
  const f = pushFixture(t);
  f.write("apps/web/src/example.ts", "export const changed = true;\n");
  f.commit();
  f.write("README.md", "Only the final commit is prose\n");
  const after = f.commit();
  const event = { ...f.event, after, head_commit: { id: after } };
  const context = { ...f.context, sha: after };
  assert.equal(classifyPushChanges(event, context, { root: f.root }).full, true);
  assert.equal(
    classifyGitChanges(f.git("rev-parse", "HEAD~1"), after, { root: f.root }).prose_only,
    true,
    "A HEAD~1 shortcut would omit the earlier runtime change",
  );
  assert.equal(
    classifyPushChanges({ ...event, before: "f".repeat(40) }, context, { root: f.root }).full,
    true,
    "Missing history must not fall back to a guessed parent",
  );
  f.git("checkout", "-b", "diverged", f.before);
  f.write("README.md", "Diverged prose\n");
  const diverged = f.commit();
  f.git("checkout", f.after);
  assert.equal(
    classifyPushChanges({ ...f.event, before: diverged }, f.context, { root: f.root }).full,
    true,
    "A nonancestor push stays full even if a caller clears the forced flag",
  );
});

test("push CLI fails full for unreadable, malformed, oversized and conflicting inputs", (t) => {
  const f = pushFixture(t);
  assert.equal(JSON.parse(pushCli(f, [], { ...f.env, GITHUB_EVENT_PATH: "" }).stdout).full, true);
  assert.equal(JSON.parse(pushCli(f, [], { ...f.env, CI_FULL: "true" }).stdout).full, true);
  assert.equal(JSON.parse(pushCli(f, ["--base", f.before, "--head", f.after]).stdout).full, true);
  writeFileSync(f.eventPath, '{"private-marker":');
  const malformed = pushCli(f);
  assert.equal(JSON.parse(malformed.stdout).full, true);
  assert.doesNotMatch(malformed.stderr, /private-marker/);
  writeFileSync(f.eventPath, `${JSON.stringify(f.event)}${" ".repeat(1024 * 1024)}`);
  assert.equal(JSON.parse(pushCli(f).stdout).full, true);
  assert.equal(
    JSON.parse(pushCli(f, [], { ...f.env, GITHUB_EVENT_PATH: f.root }).stdout).full,
    true,
  );
  if (process.platform !== "win32") {
    rmSync(f.eventPath);
    execFileSync("mkfifo", [f.eventPath]);
    assert.equal(JSON.parse(pushCli(f).stdout).full, true, "Special file must not block opening");
  }
});

test("readiness full-source inventory matches workflow names and both complete matrices", () => {
  const workflow = readFileSync(resolve(scriptDirectory, "../workflows/ci.yml"), "utf8");
  const names = [];
  for (const block of workflowJobBlocks(workflow)) {
    const match = block.match(/^ {4}name: (.+)$/m);
    if (!match) continue;
    if (block.startsWith("  browser:\n")) {
      for (const project of ["desktop-chromium", "mobile-chromium"])
        for (const shard of [1, 2, 3, 4])
          names.push(
            match[1]
              .replace(/\$\{\{ matrix\.project \}\}/u, project)
              .replace(/\$\{\{ matrix\.shard \}\}/u, shard),
          );
    } else if (block.startsWith("  desktop:\n")) {
      for (const os of ["macos-14", "windows-latest"])
        names.push(match[1].replace(/\$\{\{ matrix\.os \}\}/u, os));
    } else names.push(match[1]);
  }
  const root = resolve(scriptDirectory, "../..");
  const inventory = JSON.parse(
    execFileSync(
      "python3",
      [
        "-c",
        "import sys,json;sys.path.insert(0,'.agents/skills/ship-it/scripts');from evaluate_readiness import FULL_SOURCE_JOBS;print(json.dumps(FULL_SOURCE_JOBS))",
      ],
      { cwd: root, encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } },
    ),
  );
  assert.deepEqual(inventory.sort(), names.sort());
});
