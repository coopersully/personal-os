import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
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
