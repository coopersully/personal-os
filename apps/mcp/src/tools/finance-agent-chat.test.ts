import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import type { PersonalOsApiClient } from "@personal-os/api-client";
import type { AccessScope } from "@personal-os/domain";
import { createPersonalOsMcpServer } from "../server.js";
import { availableToolNames } from "../tool-catalog.js";

it("exposes bounded chat reads and card publishing without financial execution or impersonation", async () => {
  expect(availableToolNames(new Set<AccessScope>(["finances:read"]), true)).toContain(
    "get_finance_chat",
  );
  expect(
    availableToolNames(new Set<AccessScope>(["finances:read", "finances:write"]), false),
  ).not.toContain("publish_finance_chat_card");
  const api = {
    getFinanceAgentChat: vi.fn(async () => ({ messages: [], nextCursor: null })),
    publishFinanceAgentCard: vi.fn(async () => ({ authorKind: "agent" })),
  };
  const server = createPersonalOsMcpServer({
    api: api as unknown as PersonalOsApiClient,
    scopes: new Set<AccessScope>(["finances:read", "finances:write", "finances:maintain"]),
    readOnly: false,
    timeZone: "UTC",
  });
  const client = new Client({ name: "test", version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);
  try {
    await client.callTool({ name: "get_finance_chat", arguments: { latest: "true", limit: 10 } });
    expect(api.getFinanceAgentChat).toHaveBeenCalledWith({ latest: "true", limit: 10 });
    const input = {
      text: "Review this transaction.",
      idempotencyKey: "card",
      recordRefs: [{ kind: "transaction", id: "11111111-1111-4111-8111-111111111111" }],
    };
    expect(
      (await client.callTool({ name: "publish_finance_chat_card", arguments: input })).isError,
    ).not.toBe(true);
    expect(api.publishFinanceAgentCard).toHaveBeenCalledWith(input);
    expect(
      (
        await client.callTool({
          name: "publish_finance_chat_card",
          arguments: { ...input, authorKind: "user" },
        })
      ).isError,
    ).toBe(true);
    expect(api.publishFinanceAgentCard).toHaveBeenCalledTimes(1);
  } finally {
    await client.close();
    await server.close();
  }
});
