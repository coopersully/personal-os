import type { McpServer } from "@modelcontextprotocol/server";
import type { PersonalOsApiClient } from "@personal-os/api-client";
import { z } from "zod";
import { result } from "../tool-result.js";

export function registerXBookmarkTools(server: McpServer, api: PersonalOsApiClient): void {
  server.registerTool(
    "list_x_bookmarks",
    {
      annotations: { openWorldHint: false, readOnlyHint: true },
      description:
        "List synchronized posts from the user's selected X bookmark folder. Use each post URL as source attribution when proposing a calendar event; do not create an event until its date and time are definite.",
      inputSchema: z.object({ limit: z.number().int().min(1).max(100).default(50) }),
      title: "List X bookmarks",
    },
    async ({ limit }) => result(await api.listXBookmarks(limit)),
  );

  server.registerTool(
    "sync_x_bookmarks",
    {
      annotations: { idempotentHint: true, openWorldHint: false, readOnlyHint: true },
      description:
        "Refresh the selected X bookmark folder into Nomi. This reads X only and never changes X.",
      inputSchema: z.object({}),
      title: "Sync X bookmarks",
    },
    async () => result({ changed: await api.syncXBookmarks() }),
  );
}
