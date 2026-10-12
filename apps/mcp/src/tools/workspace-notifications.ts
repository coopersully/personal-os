import type { McpServer } from "@modelcontextprotocol/server";
import type { PersonalOsApiClient } from "@personal-os/api-client";
import {
  notificationScopeSchema,
  resetFinanceNotificationPreferencesSchema,
  saveNotificationPreferencesSchema,
} from "@personal-os/domain";
import { apiResult } from "../tool-result.js";
export function registerWorkspaceNotificationTools(server: McpServer, api: PersonalOsApiClient) {
  server.registerTool(
    "disconnect_texting",
    {
      title: "Disconnect Texting",
      description:
        "Disable the owner's verified Texting connection. This stops delivery to that destination; reconnecting requires owner phone verification again. Requires texting:write, texting:execute and enabled review bypass for agents. Read get_texting_connection before changing it.",
      inputSchema: {},
    },
    async () =>
      apiResult(async () => {
        await api.disconnectTexting();
        return { disconnected: true };
      }),
  );

  server.registerTool(
    "get_notification_settings",
    {
      title: "Get notification settings",
      description:
        "Read global and Finance notification preferences, revisions, inheritance, quiet hours and effective disclosure limits. Requires texting:read and finances:read.",
      inputSchema: {},
    },
    async () => apiResult(() => api.getNotificationStatus()),
  );
  server.registerTool(
    "update_notification_settings",
    {
      title: "Update notification settings",
      description:
        "Save an exact revision of global or Finance notification preferences. Agent changes require texting:write, texting:execute and review bypass. Agents cannot widen the global disclosure ceiling. Requires texting:read and finances:read to inspect current settings first.",
      inputSchema: saveNotificationPreferencesSchema.extend({ scope: notificationScopeSchema }),
    },
    async ({ scope, ...input }) => apiResult(() => api.saveNotificationPreferences(scope, input)),
  );
  server.registerTool(
    "reset_finance_notification_settings",
    {
      title: "Reset finance notification settings",
      description:
        "Remove the exact observed Finance override so notifications inherit global settings. Agents require texting:write, texting:execute and review bypass, plus texting:read and finances:read. This differs from disabling notifications.",
      inputSchema: resetFinanceNotificationPreferencesSchema,
    },
    async (input) => apiResult(() => api.resetFinanceNotificationPreferences(input)),
  );
  server.registerTool(
    "get_texting_connection",
    {
      title: "Get texting connection",
      description:
        "Read Texting connection readiness. Phone verification and account ownership consent remain owner-only. Requires texting:read.",
      inputSchema: {},
    },
    async () => apiResult(() => api.getTextingConnection()),
  );
}
