import type { McpServer } from "@modelcontextprotocol/server";
import type { PersonalOsApiClient } from "@personal-os/api-client";
import {
  financeConversationAgentCardInputSchema,
  financeConversationHistoryQuerySchema,
} from "@personal-os/domain";
import { apiResult } from "../tool-result.js";
export function registerFinanceAgentChatTools(server: McpServer, api: PersonalOsApiClient) {
  server.registerTool(
    "get_finance_chat",
    {
      title: "Read Finance Chat",
      description:
        "Read a bounded page of the owner's shared Finance conversation using this connection's read grant. Does not mark messages read, acknowledge a routine turn, claim work or alter the original host. Requires finances:read.",
      inputSchema: financeConversationHistoryQuerySchema,
    },
    async (input) => apiResult(() => api.getFinanceAgentChat(input)),
  );
  server.registerTool(
    "publish_finance_chat_card",
    {
      title: "Publish a linked Finance card",
      description:
        "Publish a short attributed agent note with one to twelve actual saved record references. Use one question or result and at most three short sentences; details belong in linked cards. This is not a human message, financial approval, execution receipt or acknowledgment of an original routine's turn. Reuse the exact idempotency key on retry and read Chat to reconcile. Native notification delivery is queued, not confirmed displayed. Requires finances:read, finances:write and finances:maintain.",
      inputSchema: financeConversationAgentCardInputSchema,
    },
    async (input) => apiResult(() => api.publishFinanceAgentCard(input)),
  );
}
