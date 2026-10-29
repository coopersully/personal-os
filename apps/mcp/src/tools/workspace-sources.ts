import type { McpServer } from "@modelcontextprotocol/server";
import type { PersonalOsApiClient } from "@personal-os/api-client";
import { idSchema } from "@personal-os/domain";
import { apiResult } from "../tool-result.js";

export function registerWorkspaceSourceTools(server: McpServer, api: PersonalOsApiClient) {
  server.registerTool(
    "list_workspace_sources",
    {
      title: "List workspace sources",
      description:
        "List owned connected sources with enabled Mail/Calendar capabilities, freshness and connection health. A source can supply multiple workspaces, so this shared read requires mail:read, calendar:read and reminders:read. Credentials are never returned. Provider login remains an owner consent step.",
      inputSchema: {},
    },
    async () => apiResult(() => api.listConnectors()),
  );
  server.registerTool(
    "sync_workspace_source",
    {
      title: "Sync workspace source",
      description:
        "Synchronize one owned provider account across its enabled workspaces. Read list_workspace_sources first. Requires mail/calendar/tasks write and execute, reminders:write, and enabled bypass for agents. Returns changed count, pending continuation and nextSyncAt; pending means synchronization continues automatically, not completion. Unavailable providers and partial failures retain API recovery diagnostics.",
      inputSchema: { accountId: idSchema },
    },
    async ({ accountId }) => apiResult(() => api.syncConnector(accountId)),
  );
  server.registerTool(
    "disconnect_workspace_source",
    {
      title: "Disconnect workspace source",
      description:
        "Disconnect an owned provider account and remove its local synchronized projections across Mail, Calendar and Reminders; invalidates linked source guidance. Inspect list_workspace_sources first. This is not recoverable trash. Unresolved provider effects block disconnection. Requires mail/calendar/tasks write and execute, reminders:write, and enabled bypass for agents. Does not delete the external provider account.",
      inputSchema: { accountId: idSchema },
    },
    async ({ accountId }) =>
      apiResult(async () => {
        await api.deleteConnector(accountId);
        return { disconnected: true, accountId };
      }),
  );
}
