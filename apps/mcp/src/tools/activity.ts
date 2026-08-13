import type { McpServer } from "@modelcontextprotocol/server";
import type { PersonalOsApiClient } from "@personal-os/api-client";
import { z } from "zod";
import { result } from "../tool-result.js";

/** Auditing and daily-context MCP adapters. Execution behavior remains in the API. */
export function registerActivityTools(server: McpServer, api: PersonalOsApiClient): void {
  server.registerTool(
    "list_activity",
    {
      annotations: { openWorldHint: false, readOnlyHint: true },
      description: "List recent audited actions by people, agents, and connectors.",
      inputSchema: z.object({ limit: z.number().int().min(1).max(100).default(50) }),
      title: "List recent activity",
    },
    async (input) => result(await api.listActivity(input.limit)),
  );

  server.registerTool(
    "get_daily_brief",
    {
      annotations: { openWorldHint: false, readOnlyHint: true },
      description:
        "Get a time-aware daily brief: events happening now, the next event, later-today commitments, overdue reminders, and tomorrow's outlook.",
      inputSchema: z.object({}),
      title: "Get daily brief",
    },
    async () => result(await api.getDailyBrief()),
  );
}
