import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { classifyChanges, requiredGate } from "./ci-scope.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));

const emptyScope = {
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
  ["docs only", ["docs/engineering/ci.md", "README.md"], scope()],
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

test("required gate accepts only successful or intentionally skipped dependencies", () => {
  assert.equal(requiredGate({ lint: "success", terraform: "skipped" }), true);
  assert.equal(requiredGate({ lint: "success", quality: "success" }), true);
  assert.equal(requiredGate({ lint: "failure", terraform: "skipped" }), false);
  assert.equal(requiredGate({ lint: "success", quality: "cancelled" }), false);
  assert.equal(requiredGate({}), false);
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
  assert.deepEqual(classifyChanges(["docs/example.md"], { forceFull: false }), scope());
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
      /^ {4}if: \$\{\{ needs.changes.outputs.full == 'true'/m,
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
