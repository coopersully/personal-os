import type { McpServer } from "@modelcontextprotocol/server";
import type { PersonalOsApiClient } from "@personal-os/api-client";
import { workspaceSettingsUpdateSchemas } from "@personal-os/domain";
import { z } from "zod";
import { apiResult } from "../tool-result.js";

const searchInput = z
  .object({
    q: z.string().trim().min(1).max(500),
    offset: z.number().int().min(0).optional(),
    limit: z.number().int().min(1).max(100).default(25),
    includeArchived: z.boolean().optional(),
    kind: z.enum(["all", "content", "reviews"]).optional(),
  })
  .strict();

export function registerWorkspaceSettingsTools(server: McpServer, api: PersonalOsApiClient) {
  server.registerTool(
    "get_calendar_settings",
    {
      title: "Get calendar settings",
      description: "Read calendar workspace preferences and their current revision.",
      inputSchema: {},
    },
    async () => apiResult(() => api.getWorkspaceSettings("calendar")),
  );
  server.registerTool(
    "update_calendar_settings",
    {
      title: "Update calendar settings",
      description:
        "Patch only supplied calendar preferences using the observed expectedRevision. Omitted fields are retained; null and empty selections retain their documented meanings. Agents require calendar:write, calendar:execute and enabled review bypass.",
      inputSchema: workspaceSettingsUpdateSchemas.calendar,
    },
    async (input) => apiResult(() => api.updateWorkspaceSettings("calendar", input)),
  );
  server.registerTool(
    "search_calendar",
    {
      title: "Search calendar",
      description:
        "Search owned calendar content and reviews. Follow returned pagination metadata; retain the same filters.",
      inputSchema: searchInput,
    },
    async (input) => apiResult(() => api.searchWorkspace("calendar", input)),
  );
  server.registerTool(
    "get_task_settings",
    {
      title: "Get tasks settings",
      description: "Read tasks workspace preferences and their current revision.",
      inputSchema: {},
    },
    async () => apiResult(() => api.getWorkspaceSettings("tasks")),
  );
  server.registerTool(
    "update_task_settings",
    {
      title: "Update tasks settings",
      description:
        "Patch only supplied tasks preferences using the observed expectedRevision. Omitted fields are retained; null and empty selections retain their documented meanings. Agents require tasks:write, tasks:execute and enabled review bypass.",
      inputSchema: workspaceSettingsUpdateSchemas.tasks,
    },
    async (input) => apiResult(() => api.updateWorkspaceSettings("tasks", input)),
  );
  server.registerTool(
    "search_tasks",
    {
      title: "Search tasks",
      description:
        "Search owned tasks content and reviews. Follow returned pagination metadata; retain the same filters.",
      inputSchema: searchInput,
    },
    async (input) => apiResult(() => api.searchWorkspace("tasks", input)),
  );
  server.registerTool(
    "get_mail_settings",
    {
      title: "Get mail settings",
      description: "Read mail workspace preferences and their current revision.",
      inputSchema: {},
    },
    async () => apiResult(() => api.getWorkspaceSettings("mail")),
  );
  server.registerTool(
    "update_mail_settings",
    {
      title: "Update mail settings",
      description:
        "Patch only supplied mail preferences using the observed expectedRevision. Omitted fields are retained; null and empty selections retain their documented meanings. Agents require mail:write, mail:execute and enabled review bypass.",
      inputSchema: workspaceSettingsUpdateSchemas.mail,
    },
    async (input) => apiResult(() => api.updateWorkspaceSettings("mail", input)),
  );
  server.registerTool(
    "search_mail",
    {
      title: "Search mail",
      description:
        "Search owned mail content and reviews. Follow returned pagination metadata; retain the same filters.",
      inputSchema: searchInput,
    },
    async (input) => apiResult(() => api.searchWorkspace("mail", input)),
  );
  server.registerTool(
    "get_finance_settings",
    {
      title: "Get finances settings",
      description: "Read finances workspace preferences and their current revision.",
      inputSchema: {},
    },
    async () => apiResult(() => api.getWorkspaceSettings("finances")),
  );
  server.registerTool(
    "update_finance_settings",
    {
      title: "Update finances settings",
      description:
        "Patch only supplied finances preferences using the observed expectedRevision. Omitted fields are retained; null and empty selections retain their documented meanings. Agents require finances:write, finances:execute and enabled review bypass.",
      inputSchema: workspaceSettingsUpdateSchemas.finances,
    },
    async (input) => apiResult(() => api.updateWorkspaceSettings("finances", input)),
  );
  server.registerTool(
    "search_finance",
    {
      title: "Search finances",
      description:
        "Search owned finances content and reviews. Follow returned pagination metadata; retain the same filters.",
      inputSchema: searchInput,
    },
    async (input) => apiResult(() => api.searchWorkspace("finances", input)),
  );
}
