import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { run, stop } from "./commands.mjs";
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
      assert.ok(args.includes("label=com.docker.compose.project=ilo-production"));
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
