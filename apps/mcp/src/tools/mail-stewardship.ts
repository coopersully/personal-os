import type { McpServer } from "@modelcontextprotocol/server";
import type { PersonalOsApiClient } from "@personal-os/api-client";
import { maintenanceRequestSchema } from "@personal-os/domain";
import { z } from "zod";
import { apiResult } from "../tool-result.js";

/** MCP remains a stateless intent surface; Mail judgment and retry live in the API. */
export function registerMailStewardshipTools(server: McpServer, api: PersonalOsApiClient) {
  server.registerTool(
    "get_mail_status",
    {
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
        readOnlyHint: true,
      },
      description:
        "Read the API-owned Mail workspace status, including objective, freshness, obligations, questions, effects, maintenance lifecycle, authority boundaries, and latest immutable review. Ilo never sends email.",
      inputSchema: z.object({}),
      title: "Get Mail workspace status",
    },
    async () => apiResult(() => api.getMailStatus()),
  );

  server.registerTool(
    "maintain_mail",
    {
      annotations: {
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
        readOnlyHint: false,
      },
      description:
        "Request one durable Mail maintenance turn. The API owns scope, authority, retries, questions, approved-rule provider effects, and honest settlement. This tool has no memory or polling loop, and Ilo never composes, drafts, replies, forwards, or sends email.",
      inputSchema: maintenanceRequestSchema,
      title: "Maintain Mail workspace",
    },
    async (input) => apiResult(() => api.maintainMail(input)),
  );
}
