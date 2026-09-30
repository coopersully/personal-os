import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { execute, run, stop } from "./commands.mjs";
import { writePrivate } from "./safety.mjs";

test("stop works without release images, environment files or gateway config", async () => {
  const root = mkdtempSync(join(tmpdir(), "ilo-stop-test-"));
  try {
    const calls = [];
    await stop({
      root,
      docker: async (args) => {
        calls.push(args);
        return args[0] === "ps" ? "a".repeat(12) : "";
      },
    });
    assert.equal(calls.filter((args) => args[0] === "stop").length, 5);
    for (const args of calls.filter((args) => args[0] === "ps")) {
      assert.ok(args.includes(`label=com.docker.compose.project.working_dir=${root}`));
      assert.ok(args.includes("label=com.docker.compose.project=nohmi-production"));
      assert.ok(!args.includes("label=com.docker.compose.service=postgres"));
    }
    await assert.rejects(stop({ root, docker: async () => "invalid-container" }), /identity/);
  } finally {
    rmSync(root, { recursive: true });
  }
});

test("successful header-only consumers may close input early", async () => {
  const root = mkdtempSync(join(tmpdir(), "ilo-pipe-test-"));
  const input = join(root, "archive");
  try {
    writePrivate(input, "x".repeat(8 * 1024 * 1024));
    await run(process.execPath, ["-e", "process.stdin.once('data',()=>process.exit(0))"], {
      input,
    });
    await assert.rejects(
      run(process.execPath, ["-e", "process.stdin.once('data',()=>process.exit(3))"], { input }),
    );
  } finally {
    rmSync(root, { recursive: true });
  }
});

test("command output is complete and failures never reveal stderr", async () => {
  assert.equal(
    await run(process.execPath, ["-e", "process.stdout.write('x'.repeat(1000000))"]),
    "x".repeat(1000000),
  );
  await assert.rejects(
    run(process.execPath, ["-e", "console.error('sensitive-canary');process.exit(2)"]),
    (error) => !error.message.includes("sensitive-canary") && error.message.includes("failed (2)"),
  );
  await assert.rejects(
    run(process.execPath, ["-e", "setInterval(()=>{},1000)"], { timeout: 50 }),
    /failed/,
  );
});

test("explicit stop records maintenance even while a controller owns the operation lock", async () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "nohmi-maintenance-test-")));
  const root = join(directory, "nohmi-production");
  mkdirSync(root, { mode: 0o700 });
  try {
    const image = `sha256:${"a".repeat(64)}`;
    const configPath = join(root, "config.json");
    writePrivate(
      configPath,
      JSON.stringify({
        version: 1,
        root,
        revision: "b".repeat(40),
        postgresMajor: 17,
        backupRecipient: "age1example",
        dockerHost: "unix:///Users/nohmi-production/.colima/nohmi-production/docker.sock",
        images: Object.fromEntries(
          ["api", "mcp", "web", "postgres", "gateway", "tunnel"].map((name) => [name, image]),
        ),
      }),
    );
    mkdirSync(join(root, "operation.lock"));
    await assert.rejects(execute("stop", configPath), /locked/);
    assert.ok(existsSync(join(root, "maintenance.json")));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
