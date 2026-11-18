import type { McpServer } from "@modelcontextprotocol/server";
import type { PersonalOsApiClient } from "@personal-os/api-client";
import { taskWorkspaceQuerySchema } from "@personal-os/domain";
import { apiResult } from "../tool-result.js";

/** Read-only adapter. The API owns planning time, filtering, sorting and authorization. */
export function registerTaskWorkspaceTools(server: McpServer, api: PersonalOsApiClient) {
  server.registerTool(
    "list_task_workspace",
    {
      title: "List task workspace",
      description:
        "Read a globally filtered, sorted and grouped page of nohmi Tasks and Reminders, preserving each canonical kind and revision. Mixed discovery requires tasks:read and reminders:read. Omitted status means open in All/Today/Upcoming. History contains completed or cancelled items in active containers, excluding archived contents; Trash is recoverable deletion. due=today includes dated deadlines before the end of the planning day, including overdue, and excludes undated items. sort=auto ranks open deadlines in the next ten minutes first within each display group, then priority, deadline and stable identity; its observation time stays fixed across pagination. Today uses the person's planning timezone and includes overdue due dates. Upcoming begins after today. Exact date bounds are inclusive. groupKey is a planning-local YYYY-MM-DD, a List/Project ID, or none. readOnly marks unavailable containers outside Trash; Trash permits guarded restoration including Inbox fallback. Pass nextCursor with the same filters to continue; total counts all matching records. Due times do not promise notification delivery. Existing kind-specific tools retain least-privilege access.",
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
        readOnlyHint: true,
      },
      inputSchema: taskWorkspaceQuerySchema,
    },
    async (query) => apiResult(() => api.listTaskWorkspace(query)),
  );
}
