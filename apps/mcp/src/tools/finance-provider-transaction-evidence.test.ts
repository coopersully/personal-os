import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import type { PersonalOsApiClient } from "@personal-os/api-client";
import { describe, expect, it, vi } from "vitest";
import { createPersonalOsMcpServer } from "../server.js";
import { availableToolNames } from "../tool-catalog.js";

const name = "read_finance_provider_transaction_evidence";
describe("historical evidence MCP read", () => {
  it("requires Finance read and stays available to read-only clients", () => {
    expect(availableToolNames(new Set(["finances:read"]), true)).toContain(name);
    expect(availableToolNames(new Set(), true)).not.toContain(name);
  });
  it("delegates native IDs with no business logic or provider credentials", async () => {
    const read = vi.fn(async () => ({ coverage: "unavailable", reason: "not_initialized" }));
    const server = createPersonalOsMcpServer({
      api: { readFinanceProviderTransactionEvidence: read } as unknown as PersonalOsApiClient,
      scopes: new Set(["finances:read"]),
      readOnly: true,
      timeZone: "UTC",
    });
    const client = new Client({ name: "history-evidence-test", version: "1" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    try {
      await Promise.all([server.connect(st), client.connect(ct)]);
      const transactionIds = ["11111111-1111-4111-8111-111111111111"];
      await client.callTool({ name, arguments: { transactionIds } });
      expect(read).toHaveBeenCalledWith({ transactionIds });
    } finally {
      await Promise.allSettled([client.close(), server.close()]);
    }
  });
});
