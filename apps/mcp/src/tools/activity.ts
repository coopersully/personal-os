import type { McpServer } from "@modelcontextprotocol/server";
import type { PersonalOsApiClient } from "@personal-os/api-client";
import { z } from "zod";
import { result } from "../tool-result.js";

const id = z.string().uuid().describe("ilo object identifier");

/** Auditing and routine MCP adapters. Execution behavior and policy remain in the API. */
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

  server.registerTool(
    "list_automations",
    {
      annotations: { openWorldHint: false, readOnlyHint: true },
      description: "List enabled ilo routines that an authorized agent can run.",
      inputSchema: z.object({}),
      title: "List automations",
    },
    async () => result(await api.listAutomations()),
  );

  server.registerTool(
    "run_automation",
    {
      annotations: { idempotentHint: false, openWorldHint: false },
      description:
        "Run an installed routine. Use dryRun first to inspect the brief without updating the routine's last-run time.",
      inputSchema: z.object({ dryRun: z.boolean().default(false), id }),
      title: "Run automation",
    },
    async (input) => result(await api.runAutomation(input.id, input.dryRun)),
  );
}
