import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import { ApiClientError, type PersonalOsApiClient } from "@personal-os/api-client";
import { registerFinanceTools } from "./finances.js";

const id = "11111111-1111-4111-8111-111111111111";
const source = "22222222-2222-4222-8222-222222222222";
it("preserves fixed-batch cursors, exact acknowledgments, causal replies and challenge proof phases", async () => {
  const api = {
    getFinanceConversationBatch: vi.fn(async () => ({
      batch: { cutoffSequence: "9007199254740993" },
      messages: [{ id: source }],
      nextCursor: "signed-next",
    })),
    acknowledgeFinanceConversationBatch: vi.fn(async () => ({ acknowledgedMessageIds: [source] })),
    replyToFinanceConversationBatch: vi.fn(async () => ({ id: source, text: "Saved reply" })),
    exchangeFinanceConversationChallenge: vi.fn(async () => ({ challengeId: id, verified: false })),
  };
  const server = new McpServer({ name: "conversation", version: "1" });
  registerFinanceTools(server, api as unknown as PersonalOsApiClient);
  const client = new Client({ name: "test", version: "1" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);
  try {
    const page = await client.callTool({
      name: "get_finance_conversation_batch",
      arguments: { runId: id, cursor: "signed-cursor", limit: 3 },
    });
    expect(page.isError).not.toBe(true);
    expect(api.getFinanceConversationBatch).toHaveBeenCalledWith(id, {
      cursor: "signed-cursor",
      limit: 3,
    });
    expect(JSON.stringify(page)).toContain("9007199254740993");
    await client.callTool({
      name: "acknowledge_finance_conversation_batch",
      arguments: { runId: id, messageIds: [source] },
    });
    expect(api.acknowledgeFinanceConversationBatch).toHaveBeenCalledWith(id, {
      messageIds: [source],
    });
    const reply = {
      text: "A contextual reply",
      idempotencyKey: "exact-reply",
      caseId: source,
      sourceMessageIds: [source],
    };
    await client.callTool({
      name: "reply_to_finance_conversation_batch",
      arguments: { runId: id, ...reply },
    });
    expect(api.replyToFinanceConversationBatch).toHaveBeenCalledWith(id, reply);
    for (const operation of [
      { kind: "fetch" },
      { kind: "acknowledge", challengeId: id, nonce: "exact-nonce" },
      { kind: "respond", challengeId: id, response: "Harmless proof reply" },
    ]) {
      const result = await client.callTool({
        name: "exchange_finance_conversation_challenge",
        arguments: { challengeId: id, operation },
      });
      expect(result.isError).not.toBe(true);
      expect(api.exchangeFinanceConversationChallenge).toHaveBeenLastCalledWith(id, operation);
    }
    api.replyToFinanceConversationBatch.mockRejectedValueOnce(
      new ApiClientError({
        status: 403,
        code: "forbidden",
        message: "Original connection required.",
        details: { reason: "authority_lost" },
        requestId: "conversation-denied",
      }),
    );
    const denied = await client.callTool({
      name: "reply_to_finance_conversation_batch",
      arguments: { runId: id, ...reply },
    });
    expect(denied.isError).toBe(true);
    expect(denied.structuredContent).toMatchObject({
      error: {
        code: "forbidden",
        requestId: "conversation-denied",
        details: { reason: "authority_lost" },
      },
    });
    const spoofed = await client.callTool({
      name: "exchange_finance_conversation_challenge",
      arguments: { challengeId: id, operation: { kind: "fetch", verified: true } },
    });
    expect(spoofed.isError).toBe(true);
    expect(api.exchangeFinanceConversationChallenge).toHaveBeenCalledTimes(3);
    const tools = await client.listTools();
    for (const name of [
      "send_finance_conversation_message",
      "get_finance_conversation_history",
      "mark_finance_conversation_rendered",
      "issue_finance_conversation_challenge",
    ])
      expect(tools.tools.some((tool) => tool.name === name)).toBe(false);
  } finally {
    await client.close();
    await server.close();
  }
});
