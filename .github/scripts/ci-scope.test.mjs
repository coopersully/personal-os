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
