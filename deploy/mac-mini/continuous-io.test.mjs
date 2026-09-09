import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { controllerIO, runOwned } from "./continuous-io.mjs";
import { withLock } from "./safety.mjs";

test("public polling fixes the repository, CI workflow and no-credential request boundary", async () => {
  const calls = [],
    requests = [];
  const sha = "a".repeat(40);
  const io = controllerIO("/private/nohmi-source.git", {
    command: async (name, args, options) => {
      calls.push({ name, args, options });
      return `${sha}\trefs/heads/main`;
    },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return new Response(JSON.stringify({ workflow_runs: [] }), { status: 200 });
    },
  });
  assert.equal(await io.main(), sha);
  assert.deepEqual(await io.ci(sha), []);
  assert.ok(calls[0].args.includes("https://github.com/coopersully/personal-os.git"));
  assert.ok(calls[0].args.includes("refs/heads/main"));
  assert.equal(calls[0].options.env.GIT_TERMINAL_PROMPT, "0");
  assert.equal(calls[0].options.env.GIT_CONFIG_GLOBAL, "/dev/null");
  const url = new URL(requests[0].url);
  assert.equal(url.hostname, "api.github.com");
  assert.equal(url.pathname, "/repos/coopersully/personal-os/actions/workflows/ci.yml/runs");
  assert.equal(url.searchParams.get("head_sha"), sha);
  assert.equal(url.searchParams.get("event"), "push");
  assert.equal(url.searchParams.get("branch"), "main");
  assert.equal(requests[0].options.headers.Authorization, undefined);
});

test("API rate limits, malformed runs and oversized responses fail closed", async () => {
  for (const response of [
    new Response("rate limited", { status: 429 }),
    new Response("{}"),
    new Response("x".repeat(1024 * 1024 + 1)),
  ]) {
    const io = controllerIO("/private/nohmi-source.git", { fetch: async () => response });
    await assert.rejects(io.ci("a".repeat(40)));
  }
});

test("Git ancestry inspection failure is never treated as proof that a bootstrap is safe", async () => {
  const old = "a".repeat(40),
    next = "b".repeat(40);
  const io = controllerIO("/private/nohmi-source.git", {
    command: async (_name, args) => {
      if (args.includes("merge-base")) throw new Error("object read failed");
      if (args.includes("rev-parse")) return args.at(-1).slice(0, 40);
      return "";
    },
  });
  await assert.rejects(io.history(next, old), /object read failed/);
});

test("build invocation isolates Docker from the operator context and pins its source", async () => {
  const calls = [];
  const io = controllerIO("/private/nohmi-source.git", {
    owned: async (name, args, options) => {
      calls.push({ name, args, options });
      throw new Error("stop at boundary");
    },
  });
  await assert.rejects(
    io.build("a".repeat(40), {
      root: "/private/nohmi-production",
      config: { dockerHost: "unix:///Users/nohmi-production/.colima/nohmi-production/docker.sock" },
    }),
  );
  assert.ok(calls[0].args.includes("--repository"));
  assert.ok(calls[0].args.includes("/private/nohmi-source.git"));
  assert.ok(calls[0].args.includes("--docker-host"));
  assert.ok(
    calls[0].args.includes("unix:///Users/nohmi-production/.colima/nohmi-production/docker.sock"),
  );
  assert.equal(calls[0].options.env.DOCKER_CONTEXT, undefined);
});

test("owned process failure and timeout terminate its descendant process group", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "nohmi-process-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const timeout of [false, true]) {
    const marker = join(directory, `orphan-${timeout}`);
    const descendant = `setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(marker)},'orphan'),500)`;
    const source = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'ignore'});${timeout ? "setInterval(()=>{},1000)" : "setTimeout(()=>process.exit(2),100)"}`;
    await assert.rejects(
      runOwned(process.execPath, ["-e", source], { timeout: timeout ? 150 : 2000 }),
    );
    await new Promise((resolve) => setTimeout(resolve, 650));
    assert.equal(existsSync(marker), false);
  }
});

test("a killed controller retains its real operation lock for orphan inspection", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "nohmi-killed-controller-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = `import {withLock} from ${JSON.stringify(new URL("./safety.mjs", import.meta.url).href)};
await withLock(${JSON.stringify(root)}, async()=>{console.log('locked');await new Promise(()=>setInterval(()=>{},1000));});`;
  const active = spawn(process.execPath, ["--input-type=module", "-e", source], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  t.after(() => active.kill("SIGKILL"));
  await new Promise((resolve, reject) => {
    active.stdout.once("data", resolve);
    active.once("error", reject);
  });
  active.kill("SIGKILL");
  await new Promise((resolve) => active.once("close", resolve));
  assert.equal(existsSync(join(root, "operation.lock")), true);
  await assert.rejects(
    withLock(root, async () => {}),
    /locked/,
  );
});
