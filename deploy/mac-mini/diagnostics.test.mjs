import assert from "node:assert/strict";
import test from "node:test";
import { collectDiagnostics, summarizeConnectorLogs } from "./diagnostics.mjs";

test("diagnostics retain only safe connector fields, never provider payloads or account identities", () => {
  const logs = [
    JSON.stringify({
      event: "connector_capability_failed",
      provider: "google",
      capability: "mail",
      code: "google_rate_limited",
      status: 403,
      failureCount: 4,
      requestId: "sync:11111111-1111-4111-8111-111111111111",
      message: "private-canary",
      accountId: "private-canary",
      email: "private-canary",
      token: "private-canary",
    }),
    JSON.stringify({ event: "request", path: "/callback?code=private-canary" }),
    "private-canary non-json",
    JSON.stringify({
      event: "connector_sync_failed",
      code: "private-canary",
      provider: "private-canary",
      status: "private-canary",
    }),
  ].join("\n");
  const summary = summarizeConnectorLogs(logs);
  assert.equal(summary.events.length, 2);
  assert.equal(summary.events[0].code, "google_rate_limited");
  assert.equal(summary.events[0].capability, "mail");
  assert.ok(!JSON.stringify(summary).includes("private-canary"));
});

test("collects bounded read-only stats for the configured Compose project and reports partial failures", async () => {
  const calls = [];
  const result = await collectDiagnostics({
    config: { revision: "a".repeat(40) },
    root: "/private/nohmi-production",
    compose: async (args) => {
      calls.push(args);
      if (args[0] === "ps") return "a".repeat(64);
      if (args[0] === "logs") return "";
      throw new Error("Unexpected mutation");
    },
    docker: async (args) => {
      calls.push(args);
      if (args[0] === "stats")
        return JSON.stringify({
          Name: "nohmi-production-api-1",
          CPUPerc: "2.5%",
          MemUsage: "200MiB / 1GiB",
          MemPerc: "20%",
        });
      throw new Error("private-canary");
    },
  });
  assert.equal(result.containers[0].memory, "200MiB / 1GiB");
  assert.ok(result.unavailable.includes("container_state"));
  assert.ok(result.host.totalMemoryBytes > 0);
  assert.ok(!JSON.stringify(result).includes("private-canary"));
  assert.ok(calls.some((args) => args.includes("--no-stream")));
  assert.ok(calls.some((args) => args.includes("--tail") && args.includes("5000")));
});
