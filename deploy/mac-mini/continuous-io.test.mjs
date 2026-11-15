import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { controllerIO, parseAvailableBytes, retentionPlan, runOwned } from "./continuous-io.mjs";
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

const sha = (c) => c.repeat(40);
const id = (c) => `sha256:${c.repeat(64)}`;

test("retention keeps kept revisions, configured and in-use images, and ignores foreign tags", () => {
  const images = [
    { repository: "ilo-local/api", tag: sha("a"), id: id("1") }, // kept: deployed
    { repository: "ilo-local/web", tag: sha("b"), id: id("2") }, // kept: previous
    { repository: "ilo-local/mcp", tag: sha("c"), id: id("3") }, // used by a container
    { repository: "ilo-local/api", tag: sha("d"), id: id("4") }, // configured image
    { repository: "ilo-local/api", tag: sha("e"), id: id("5") }, // removable
    { repository: "ilo-local/web", tag: sha("f"), id: id("6") }, // removable
    { repository: "ilo-local/api", tag: "latest", id: id("7") }, // not a release tag
    { repository: "ilo-local/other", tag: sha("e"), id: id("8") }, // not a release repository
    { repository: "postgres", tag: sha("e"), id: id("9") }, // never touched
  ];
  assert.deepEqual(
    retentionPlan({ images, protectedIds: [id("3"), id("4")], keep: [sha("a"), sha("b")] }),
    [`ilo-local/api:${sha("e")}`, `ilo-local/web:${sha("f")}`],
  );
  assert.throws(() => retentionPlan({ images, protectedIds: [], keep: [undefined] }));
  assert.throws(() => retentionPlan({ images, protectedIds: ["latest"], keep: [sha("a")] }));
});

function fakeRuntime(responses) {
  const calls = [];
  return {
    calls,
    runtime: {
      // Ancillary images are digest-pinned exactly as the README prescribes.
      config: {
        images: {
          api: id("1"),
          mcp: id("2"),
          web: id("5"),
          postgres: `postgres@${id("0")}`,
          gateway: `nginxinc/nginx-unprivileged@${id("6")}`,
          tunnel: `cloudflare/cloudflared@${id("7")}`,
        },
      },
      docker: async (args, options) => {
        calls.push({ args, options });
        const key = args.slice(0, 2).join(" ");
        if (key in responses) return responses[key](args);
        return "";
      },
    },
  };
}

test("reclaim never removes in-use images, forces removal, or prunes volumes", async () => {
  const container = "f".repeat(64);
  const { calls, runtime } = fakeRuntime({
    "image ls": () =>
      [
        `ilo-local/api\t${sha("a")}\t${id("1")}`,
        `ilo-local/web\t${sha("c")}\t${id("3")}`,
        `ilo-local/mcp\t${sha("d")}\t${id("4")}`,
      ].join("\n"),
    "container ls": () => container,
    "container inspect": () => id("3"),
  });
  await controllerIO("/private/nohmi-source.git").reclaim(runtime, {
    revisions: [sha("a")],
    images: [],
  });
  const removed = calls.filter((c) => c.args[0] === "image" && c.args[1] === "rm");
  assert.deepEqual(
    removed.map((c) => c.args),
    [["image", "rm", `ilo-local/mcp:${sha("d")}`]],
  );
  assert.ok(calls.some((c) => c.args.includes(container)));
  const prune = calls.at(-1).args;
  assert.deepEqual(prune, ["builder", "prune", "--force", "--keep-storage", "3GB"]);
  for (const { args } of calls) {
    assert.ok(!args.includes("volume") && !args.includes("system"));
    if (args[1] === "rm") assert.ok(!args.includes("--force") && !args.includes("-f"));
  }
});

test("reclaim still prunes build cache but reports a failed image removal", async () => {
  const { calls, runtime } = fakeRuntime({
    "image ls": () => `ilo-local/api\t${sha("d")}\t${id("4")}`,
    "image rm": () => {
      throw new Error("conflict");
    },
  });
  await assert.rejects(
    controllerIO("/private/nohmi-source.git").reclaim(runtime, {
      revisions: [sha("a")],
      images: [],
    }),
    /could not be removed/,
  );
  assert.equal(calls.at(-1).args[0], "builder");
});

test("Docker headroom is measured offline through the pinned local image", async () => {
  const { calls, runtime } = fakeRuntime({
    "run --rm": () =>
      "Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/vdb1 25000000 20000000 4194304 83% /probe",
  });
  assert.equal(await controllerIO("/private/nohmi-source.git").dockerFree(runtime), 4 * 1024 ** 3);
  const args = calls[0].args;
  assert.ok(args.includes("none") && args.includes("--read-only"));
  assert.equal(args[args.indexOf("--pull") + 1], "never");
  assert.ok(args.includes("/var/lib/docker:/probe:ro"));
  assert.ok(args.includes(`postgres@${id("0")}`));
  for (const output of ["", "garbage", "Filesystem\n/dev/vdb1 1 2 lots 9% /probe"])
    assert.throws(() => parseAvailableBytes(output));
});

test("reclaim protects rollback images under any tag and removes the rest in batches", async () => {
  const lines = [`ilo-local/api\t${sha("9")}\t${id("8")}`];
  for (let n = 0; n < 60; n++)
    lines.push(`ilo-local/web\t${n.toString(16).padStart(40, "0")}\t${id("4")}`);
  const { calls, runtime } = fakeRuntime({ "image ls": () => lines.join("\n") });
  await controllerIO("/private/nohmi-source.git").reclaim(runtime, {
    revisions: [sha("a")],
    images: [id("8"), "not-an-id"],
  });
  const removed = calls.filter((c) => c.args[0] === "image" && c.args[1] === "rm");
  assert.deepEqual(
    removed.map((c) => c.args.length - 2),
    [50, 10],
  );
  assert.ok(!removed.some((c) => c.args.includes(`ilo-local/api:${sha("9")}`)));
});

test("an unrecognized container image identity fails closed before any removal", async () => {
  const { calls, runtime } = fakeRuntime({
    "image ls": () => `ilo-local/api\t${sha("d")}\t${id("4")}`,
    "container ls": () => "f".repeat(64),
    "container inspect": () => "ilo-local/api:latest",
  });
  await assert.rejects(
    controllerIO("/private/nohmi-source.git").reclaim(runtime, {
      revisions: [sha("a")],
      images: [],
    }),
  );
  assert.ok(!calls.some((c) => c.args[1] === "rm" || c.args[0] === "builder"));
});
