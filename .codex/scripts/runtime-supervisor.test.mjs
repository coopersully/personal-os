import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { buildServiceSpecs, runSupervisor } from "./runtime-supervisor.mjs";

const allocation = {
  runtimeId: "123456789abc",
  repositoryId: "0123456789abcdef0123456789abcdef",
  root: "/tmp/linked",
  ports: { web: 8086, api: 8793, mcp: 8794, postgres: 55438 },
};

test("buildServiceSpecs derives every URL and binds all services to loopback", () => {
  const specs = buildServiceSpecs(allocation, allocation.root, { APP_ENCRYPTION_KEY: "secret" });
  assert.equal(specs.api.env.PORT, String(allocation.ports.api));
  assert.equal(specs.api.env.HOST, "127.0.0.1");
  assert.equal(
    specs.api.env.GOOGLE_REDIRECT_URI,
    "http://127.0.0.1:8793/v1/connectors/google/callback",
  );
  assert.equal(specs.api.env.X_REDIRECT_URI, "http://127.0.0.1:8793/v1/x-bookmarks/callback");
  assert.equal(
    specs.api.env.DATABASE_URL,
    "postgres://personal_os:personal_os@127.0.0.1:55438/personal_os",
  );
  assert.equal(specs.mcp.env.HOST, "127.0.0.1");
  assert.equal(specs.mcp.env.PORT, String(allocation.ports.mcp));
  assert.deepEqual(specs.web.args, [
    "--filter",
    "@personal-os/web",
    "exec",
    "vite",
    "--host",
    "127.0.0.1",
    "--port",
    String(allocation.ports.web),
    "--strictPort",
  ]);
  assert.equal(specs.web.env.VITE_PROXY_API_TARGET, "http://127.0.0.1:8793");
});

test("bootstrap starts one detached process-group leader and remains attached to its exit", async () => {
  const calls = [];
  const child = new EventEmitter();
  child.pid = 5000;
  const resultPromise = runSupervisor({
    allocation,
    root: allocation.root,
    argv: ["--allocation", "/tmp/allocation.json", "--runtime-id", allocation.runtimeId],
    env: {},
    spawn: (file, args, options) => {
      calls.push({ file, args, options });
      return child;
    },
  });
  queueMicrotask(() => child.emit("exit", 7, null));
  assert.equal(await resultPromise, 7);
  assert.equal(calls[0].options.detached, true);
  assert.equal(calls[0].options.stdio, "inherit");
  assert.equal(calls[0].options.env.ILO_RUNTIME_SUPERVISOR_CHILD, "1");
  assert.equal(calls[0].args.includes("--runtime-id"), true);
});

test("child records its process group and all services only after all readiness probes pass", async () => {
  let nextPid = 6000;
  const records = [];
  const probes = [];
  const result = await runSupervisor({
    allocation,
    root: allocation.root,
    env: {},
    supervisorChild: true,
    spawn: () => Object.assign(new EventEmitter(), { pid: (nextPid += 1) }),
    processIdentity: async (pid) => ({ pid, startIdentity: `start-${pid}` }),
    recordProcesses: async (processes) => records.push(structuredClone(processes)),
    readiness: async (name) => {
      probes.push(name);
      return true;
    },
    exitAfterReady: true,
  });
  assert.equal(result, 0);
  assert.deepEqual(probes, ["postgres", "api", "mcp", "web"]);
  assert.equal(records[0].supervisor.pgid, process.pid);
  assert.deepEqual(Object.keys(records.at(-1)).sort(), ["api", "mcp", "supervisor", "web"]);
});

test("one child exit terminates the verified process group", async () => {
  let nextPid = 7000;
  const children = [];
  const stops = [];
  const promise = runSupervisor({
    allocation,
    root: allocation.root,
    env: {},
    supervisorChild: true,
    spawn: () => {
      const child = Object.assign(new EventEmitter(), { pid: (nextPid += 1) });
      children.push(child);
      return child;
    },
    processIdentity: async (pid) => ({ pid, startIdentity: `start-${pid}` }),
    recordProcesses: async () => {},
    readiness: async () => true,
    stopGroup: async (signal) => stops.push(signal),
  });
  setImmediate(() => children[1].emit("exit", 1, null));
  assert.equal(await promise, 1);
  assert.deepEqual(stops, ["SIGTERM"]);
});

test("a child failure interrupts readiness immediately", async () => {
  let nextPid = 8000;
  const children = [];
  const stops = [];
  const promise = runSupervisor({
    allocation,
    root: allocation.root,
    env: {},
    supervisorChild: true,
    spawn: () => {
      const child = Object.assign(new EventEmitter(), { pid: (nextPid += 1) });
      children.push(child);
      return child;
    },
    processIdentity: async (pid) => ({ pid, startIdentity: `start-${pid}` }),
    recordProcesses: async () => {},
    readiness: async () => new Promise(() => {}),
    stopGroup: async (signal) => stops.push(signal),
  });
  setImmediate(() => children[0].emit("exit", 9, null));
  assert.equal(await promise, 9);
  assert.deepEqual(stops, ["SIGTERM"]);
});
