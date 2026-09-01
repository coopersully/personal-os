import type { McpServer } from "@modelcontextprotocol/server";
import type { PersonalOsApiClient } from "@personal-os/api-client";
import { z } from "zod";
import { apiResult } from "../tool-result.js";

export function registerTextingTools(
  server: McpServer,
  api: PersonalOsApiClient,
  timeZone: string,
) {
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
        body: z.string().min(1).max(1600).describe("Final concise text, without an ilo prefix."),
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
