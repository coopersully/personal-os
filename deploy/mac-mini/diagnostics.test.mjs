import assert from "node:assert/strict";
import test from "node:test";
import { collectDiagnostics, summarizeConnectorLogs } from "./diagnostics.mjs";

test("rejects private suffixes appended to allowlisted provider codes", () => {
  for (const prefix of [
    "google_authorization_failed",
    "plaid_transport_failure",
    "connector_unknown_failure",
    "plaid_invalid_cursor",
  ]) {
    const summary = summarizeConnectorLogs(
      JSON.stringify({ event: "connector_sync_failed", code: `${prefix}PRIVATE_CANARY` }),
    );
    assert.equal(summary.events[0].code, undefined);
    assert.ok(!JSON.stringify(summary).includes("PRIVATE_CANARY"));
  }
});

test("preserves fixed Finance provider, projection and cursor failure codes", () => {
  for (const code of [
    "plaid_invalid_response",
    "plaid_invalid_cursor",
    "plaid_transactions_cursor_invalid",
    "plaid_invalid_cursor_replay_in_progress",
    "plaid_invalid_cursor_replay_failed",
    "plaid_account_missing_from_item",
    "plaid_configuration_missing",
    "plaid_sync_page_limit_exceeded",
    "plaid_sync_cursor_not_advancing",
    "finance_encryption_configuration_missing",
    "finance_provider_item_identity_mismatch",
    "finance_provider_item_identity_conflict",
  ]) {
    const summary = summarizeConnectorLogs(
      JSON.stringify({
        event: "connector_sync_failed",
        provider: "plaid",
        code,
        message: "PRIVATE_CANARY",
      }),
    );
    assert.equal(summary.events[0].code, code);
    assert.ok(!JSON.stringify(summary).includes("PRIVATE_CANARY"));
  }
});

test("diagnostics retain only safe connector fields, never provider payloads or account identities", () => {
  const logs = [
    JSON.stringify({
      event: "connector_capability_failed",
      provider: "google",
      capability: "mail",
      code: "plaid_authorization_failed",
      status: 403,
      failureCount: 4,
      transportCode: "ENOTFOUND",
      transportPhase: "dns",
      syncSource: "scheduled",
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
      transportCode: "private-canary",
      transportPhase: "private-canary",
      syncSource: "private-canary",
      provider: "private-canary",
      status: "private-canary",
    }),
  ].join("\n");
  const summary = summarizeConnectorLogs(logs);
  assert.equal(summary.events.length, 2);
  assert.equal(summary.events[0].code, "plaid_authorization_failed");
  assert.equal(summary.events[0].capability, "mail");
  assert.equal(summary.events[0].transportCode, "ENOTFOUND");
  assert.equal(summary.events[0].transportPhase, "dns");
  assert.equal(summary.events[0].syncSource, "scheduled");
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
