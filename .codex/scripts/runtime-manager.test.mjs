import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildRuntimeOverlay,
  formatAllocation,
  runManager,
  writeRuntimeOverlay,
} from "./runtime-manager.mjs";

const allocation = {
  runtimeId: "123456789abc",
  repositoryId: "0123456789abcdef0123456789abcdef",
  root: "/tmp/linked",
  rootHash: "a".repeat(64),
  tier: 2,
  ports: { web: 8086, api: 8793, mcp: 8794, postgres: 55438 },
  composeProject: "ilo-wt-123456789abc",
  state: "allocated",
  processes: {},
};

test("runtime overlay contains only allocation-derived non-secret values", () => {
  const overlay = buildRuntimeOverlay(allocation);
  assert.match(overlay, /^CODEX_RUNTIME_TIER=2$/m);
  assert.match(
    overlay,
    /^DATABASE_URL=postgres:\/\/personal_os:personal_os@127\.0\.0\.1:55438\/personal_os$/m,
  );
  assert.match(
    overlay,
    /^GOOGLE_REDIRECT_URI=http:\/\/127\.0\.0\.1:8793\/v1\/connectors\/google\/callback$/m,
  );
  assert.match(overlay, /^VITE_PROXY_API_TARGET=http:\/\/127\.0\.0\.1:8793$/m);
  assert.doesNotMatch(overlay, /APP_ENCRYPTION_KEY|MCP_INTERNAL_SECRET/);
});

test("runtime overlay is atomically written with private permissions", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ilo-manager-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeRuntimeOverlay(root, allocation);
  assert.equal((await stat(path.join(root, ".env.codex.local"))).mode & 0o777, 0o600);
  assert.equal(
    await readFile(path.join(root, ".env.codex.local"), "utf8"),
    buildRuntimeOverlay(allocation),
  );
});

test("config output remains compatible with cooper-run labels", () => {
  assert.equal(
    formatAllocation(allocation),
    [
      "  Root:      /tmp/linked",
      "  Tier:      2",
      "  App:       http://localhost:8086",
      "  API:       http://127.0.0.1:8793",
      "  MCP:       http://127.0.0.1:8794",
      "  PostgreSQL 127.0.0.1:55438",
      "  Compose:   ilo-wt-123456789abc",
    ].join("\n"),
  );
});

test("status is non-allocating for an unallocated root", async () => {
  let acquired = false;
  const output = [];
  const code = await runManager(["status", "--root", "/tmp/linked"], {
    stdout: (line) => output.push(line),
    resolveRepositoryContext: async () => ({ root: "/tmp/linked" }),
    getAllocationForRoot: async () => null,
    acquireAllocation: async () => {
      acquired = true;
    },
    reconcileRegistry: async () => [],
  });
  assert.equal(code, 0);
  assert.equal(acquired, false);
  assert.match(output.join("\n"), /State: unallocated/);
});

test("purge requires explicit data-loss acknowledgement before mutation", async () => {
  let removed = false;
  const code = await runManager(["purge", "--root", "/tmp/linked"], {
    stderr: () => {},
    resolveRepositoryContext: async () => ({ root: "/tmp/linked" }),
    getAllocationForRoot: async () => allocation,
    removeOwnedDockerResources: async () => {
      removed = true;
      return { ok: true };
    },
    reconcileRegistry: async () => [],
  });
  assert.equal(code, 2);
  assert.equal(removed, false);
});

test("start uses the explicit Compose project and attached supervisor then clears process records", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ilo-manager-start-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, ".codex/scripts"), { recursive: true });
  const current = { ...allocation, root, state: "allocated" };
  const commands = [];
  const replacements = [];
  const code = await runManager(["start", "--root", root], {
    stdout: () => {},
    resolveRepositoryContext: async () => ({
      root,
      registryDir: path.join(root, ".git/ilo-runtime"),
    }),
    reconcileRegistry: async () => [],
    migrateLegacyTiers: async () => ({}),
    acquireAllocation: async () => current,
    probePort: async () => ({ available: true }),
    inspectOwnedDockerResources: async () => ({
      ok: true,
      resources: { containers: [], networks: [], volumes: [] },
    }),
    execFile: async (file, args, options) => {
      commands.push({ file, args, options });
      return { stdout: "" };
    },
    spawnAttached: async () => 0,
    getAllocationForRoot: async () => ({
      ...current,
      state: "running",
      processes: { supervisor: { pid: 1 } },
    }),
    replaceAllocation: async (_context, value) => {
      replacements.push(value);
      return value;
    },
  });
  assert.equal(code, 0);
  assert.deepEqual(commands[0].args.slice(0, 9), [
    "compose",
    "-p",
    allocation.composeProject,
    "-f",
    `${root}/.codex/runtime/compose.yaml`,
    "up",
    "-d",
    "postgres",
  ]);
  assert.equal(replacements.at(-1).state, "stopped");
  assert.deepEqual(replacements.at(-1).processes, {});
});
