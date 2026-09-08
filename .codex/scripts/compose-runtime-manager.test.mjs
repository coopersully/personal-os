import assert from "node:assert/strict";
import test from "node:test";

import { runManager } from "./compose-runtime-manager.mjs";

const context = {
  composeFile: "/repo/.codex/runtime/compose.yaml",
  envFile: "/repo/.env",
  overlayFile: "/repo/.env.codex.local",
  root: "/repo",
  ...{
    composeProject: "ilo-123456789abc",
    repositoryId: "0123456789abcdef",
    runtimeId: "123456789abc",
  },
};

test("start prepares one port and attaches Compose Watch", async () => {
  const commands = [];
  const written = [];
  const code = await runManager(["start", "--root", context.root], {
    allocatePort: async () => 49152,
    canBind: async () => true,
    execAttached: async (file, args) => {
      commands.push({ args, file });
      return 0;
    },
    getContext: async () => context,
    getStoredPort: async () => null,
    projectExists: async () => false,
    reconcile: async () => [],
    writeRuntimeOverlay: async (_root, runtime) => written.push(runtime),
  });

  assert.equal(code, 0);
  assert.equal(written[0].port, 49152);
  assert.deepEqual(commands[0], {
    file: "docker",
    args: [
      "compose",
      "--env-file",
      context.envFile,
      "--env-file",
      context.overlayFile,
      "-f",
      context.composeFile,
      "-p",
      context.composeProject,
      "up",
      "--build",
      "--watch",
      "--remove-orphans",
    ],
  });
});

test("status is read-only when this worktree has never run", async () => {
  let allocated = false;
  let written = false;
  const output = [];
  const code = await runManager(["status", "--root", context.root], {
    allocatePort: async () => {
      allocated = true;
      return 49152;
    },
    getContext: async () => context,
    getStoredPort: async () => null,
    projectExists: async () => false,
    stdout: (line) => output.push(line),
    writeRuntimeOverlay: async () => {
      written = true;
    },
  });

  assert.equal(code, 0);
  assert.equal(allocated, false);
  assert.equal(written, false);
  assert.match(output.join("\n"), /State: not created/);
});

test("purge removes only the current deterministic Compose project", async () => {
  const commands = [];
  const code = await runManager(["purge", "--root", context.root, "--acknowledge-data-loss"], {
    exec: async (file, args) => {
      commands.push({ args, file });
      return { stdout: "" };
    },
    getContext: async () => context,
    projectExists: async () => true,
    removeOverlay: async () => {},
  });

  assert.equal(code, 0);
  assert.deepEqual(commands[0].args.slice(-3), ["--volumes", "--remove-orphans", "--timeout=15"]);
  assert.ok(commands[0].args.includes(context.composeProject));
});

test("purge refuses to delete data without acknowledgement", async () => {
  let executed = false;
  const code = await runManager(["purge", "--root", context.root], {
    exec: async () => {
      executed = true;
    },
    getContext: async () => context,
    projectExists: async () => true,
    stderr: () => {},
  });

  assert.equal(code, 2);
  assert.equal(executed, false);
});

test("start prunes confirmed orphan projects before launching", async () => {
  const reconciliations = [];
  await runManager(["start", "--root", context.root], {
    allocatePort: async () => 49152,
    canBind: async () => true,
    execAttached: async () => 0,
    getContext: async () => context,
    getStoredPort: async () => null,
    projectExists: async () => false,
    reconcile: async (_context, options) => reconciliations.push(options),
    stdout: () => {},
    writeRuntimeOverlay: async () => {},
  });

  assert.deepEqual(reconciliations, [{ prune: true }]);
});

test("fixtures run inside the isolated application container", async () => {
  const commands = [];
  const code = await runManager(["fixtures", "--root", context.root], {
    allocatePort: async () => 49152,
    canBind: async () => true,
    exec: async (file, args) => {
      commands.push({ args, file });
      return { stdout: "" };
    },
    getContext: async () => context,
    getStoredPort: async () => 49152,
    projectExists: async () => true,
    writeRuntimeOverlay: async () => {},
  });

  assert.equal(code, 0);
  assert.ok(commands.some(({ args }) => args.includes("up") && args.includes("--wait")));
  assert.ok(
    commands.some(({ args }) => args.includes("api") && args.includes("scripts/qa-fixtures.ts")),
  );
});
