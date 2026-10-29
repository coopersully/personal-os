import type { McpServer } from "@modelcontextprotocol/server";
import type { PersonalOsApiClient } from "@personal-os/api-client";
import { agentAccountRegistrationSchema } from "@personal-os/domain";
import { z } from "zod";
import { apiResult } from "../tool-result.js";

/** Identity belongs to the authenticated connection; the API owns creation and reuse. */
export function registerAgentAccountTools(server: McpServer, api: PersonalOsApiClient) {
  server.registerTool(
    "get_agent_account",
    {
      title: "Get own agent account",
      description:
        "Read the shared agent account identity for your own authenticated connection, or null if none is registered. Register once with register_agent_account and reuse that identity across workspaces. The API returns its immutable nohmi UUID, generated display name, avatar seed, and identitySource (connection or user_confirmed). Never guess provider account IDs or send credentials. The user handles account grouping across client surfaces in shared settings.",
      inputSchema: z.object({}).strict(),
    },
    async () => apiResult(() => api.getCurrentAgentAccount()),
  );
  server.registerTool(
    "register_agent_account",
    {
      title: "Register or reuse own agent account",
      description:
        "Register once on your own authenticated connection, then reuse the returned shared identity across workspaces. Repeated calls return the existing identity without merging accounts or widening scopes. Optional platform is an unverified label, not proof of provider account ownership. The API owns the immutable nohmi UUID, generated display name, avatar seed, and identitySource (connection or user_confirmed). Never guess provider account IDs or send credentials. The user handles account grouping across client surfaces in shared settings.",
      inputSchema: agentAccountRegistrationSchema,
    },
    async ({ platform }) =>
      apiResult(() => api.registerCurrentAgentAccount(platform === undefined ? {} : { platform })),
  );
}
