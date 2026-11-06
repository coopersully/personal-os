import type { McpServer } from "@modelcontextprotocol/server";
import type { PersonalOsApiClient } from "@personal-os/api-client";
import {
  textingAgentCheckpointSchema,
  textingAgentClaimSchema,
  textingAgentReplySchema,
  textWorkspaceSchema,
} from "@personal-os/domain";
import { z } from "zod";
import { apiResult } from "../tool-result.js";

export function registerTextingTools(
  server: McpServer,
  api: PersonalOsApiClient,
  timeZone: string,
) {
  server.registerTool(
    "claim_texting_agent_run",
    {
      annotations: { openWorldHint: false, readOnlyHint: false, idempotentHint: true },
      title: "Claim SMS conversation work",
      description:
        "Claim the exact run ID supplied by a nohmi_texting_ready routine trigger using a fresh invocation UUID. Reuse that UUID only within this invocation. Returns the fixed inbound batch, pending work from earlier sessions and API-owned instructions. A competing invocation cannot take this run. Domain APIs retain all action authority.",
      inputSchema: { runId: z.uuid(), ...textingAgentClaimSchema.shape },
    },
    async ({ runId, ...input }) => apiResult(() => api.claimTextingAgentRun(runId, input)),
  );
  server.registerTool(
    "checkpoint_texting_agent_run",
    {
      annotations: { openWorldHint: false, readOnlyHint: false, idempotentHint: true },
      title: "Save SMS work progress",
      description:
        "Save pending work before an action and its domain record or operation references afterward. Completed work cannot be overwritten. These are agent reports; domain receipts are the authority for actual effects. Retain stable domain/key identities across sessions. Classify every saved inbound message with annotations (messageId, workspaces and optional replyToMessageIds) before replying; an empty workspace list means general.",
      inputSchema: { runId: z.uuid(), ...textingAgentCheckpointSchema.shape },
    },
    async ({ runId, ...input }) => apiResult(() => api.checkpointTextingAgentRun(runId, input)),
  );
  server.registerTool(
    "reply_to_texting_agent_run",
    {
      annotations: { openWorldHint: true, readOnlyHint: false, idempotentHint: true },
      title: "Reply to SMS conversation work",
      description:
        "Record a concise topic-specific SMS reply, workspace tags and reply references atomically. Use distinct stable replyKey values and final:false for intermediate replies (at most four); final:true completes the run. Retry only with the same invocation, replyKey and identical content; an uncertain send is never repeated. Preserve blocked or uncertain workspace outcomes honestly. Do not also send_text_message for the same run.",
      inputSchema: { runId: z.uuid(), ...textingAgentReplySchema.shape },
    },
    async ({ runId, ...input }) => apiResult(() => api.replyToTextingAgentRun(runId, input)),
  );
  server.registerTool(
    "get_texting_finance_reply_status",
    {
      annotations: { openWorldHint: false, readOnlyHint: true },
      description:
        "Read the redacted status of one signed Finance SMS reply by its inbound message ID. Requires both Texting and Finance read access. This does not retry work or send a text.",
      inputSchema: {
        inboundMessageId: z.uuid().describe("Exact local ID of the inbound SMS message."),
      },
      title: "Get Finance SMS reply status",
    },
    async ({ inboundMessageId }) =>
      apiResult(() => api.getFinanceTextReplyStatus(inboundMessageId)),
  );

  server.registerTool(
    "read_text_conversation",
    {
      annotations: { openWorldHint: false, readOnlyHint: true },
      description:
        "Read the user's complete recent SMS context before replying. Returns every message with ISO and local date/time, the current local date/time, and a short-lived receipt required by send_text_message. Call this immediately before every send; reread if the receipt expires or the conversation changes.",
      inputSchema: {
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .default(100)
          .describe("Recent messages to return. Use 100 unless the thread is known to be short."),
      },
      title: "Read text conversation",
    },
    async (input) => apiResult(() => api.getTextConversation(timeZone, input)),
  );

  server.registerTool(
    "send_text_message",
    {
      annotations: { openWorldHint: true },
      description:
        "Send an SMS only after reading and understanding the conversation. Texting should convey the answer quickly: use one concise, information-dense bubble by default. Use 2–3 messages only for structured lists/data or large content the user explicitly requested. Three SMS segments require necessity; 4–6 require explicit length review; 7–10 are exceptional; over 10 is rejected. Avoid greetings, throat-clearing, repetition, markdown tables, and splitting one idea across bubbles. A provider timeout can leave a queued message with uncertain delivery; reread the conversation and do not resend it until the user or delivery status resolves the uncertainty.",
      inputSchema: {
        workspaces: z
          .array(textWorkspaceSchema)
          .max(4)
          .optional()
          .describe(
            "Related workspaces; use [] for general conversation. Tag each message explicitly.",
          ),
        replyToMessageIds: z
          .array(z.uuid())
          .max(25)
          .optional()
          .describe("Original messages this reply answers, from this owner conversation."),
        body: z.string().min(1).max(1600).describe("Final concise text, without a nohmi prefix."),
        contentKind: z
          .enum([
            "concise",
            "essential_context",
            "structured_data",
            "requested_large_content",
            "safety_critical",
          ])
          .default("concise"),
        conversationReceipt: z
          .string()
          .min(1)
          .describe("Receipt from the immediately preceding read_text_conversation call."),
        exceptionalLengthToken: z
          .string()
          .optional()
          .describe("Retry token returned only after the exceptional 7–10 segment stop."),
        lengthReviewToken: z
          .string()
          .optional()
          .describe("Retry token returned after the 4–6 segment review stop."),
        necessity: z
          .string()
          .max(240)
          .optional()
          .describe("Why three or more segments are truly necessary."),
        seriesId: z.string().uuid().optional(),
        seriesPart: z.number().int().min(1).max(3).optional(),
        seriesTotal: z.number().int().min(2).max(3).optional(),
      },
      title: "Send text message",
    },
    async (input) => apiResult(() => api.sendTextMessage(timeZone, input)),
  );
}
