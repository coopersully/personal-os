import type { McpServer } from "@modelcontextprotocol/server";
import type { PersonalOsApiClient } from "@personal-os/api-client";
import { knowledgeMutationInputSchema, knowledgeReadInputSchema } from "@personal-os/domain";
import { apiResult } from "../tool-result.js";

/** Stateless adapters: API owns classification, disclosure and authority. */
export function registerKnowledgeTools(server: McpServer, api: PersonalOsApiClient): void {
  server.registerTool(
    "save_knowledge",
    {
      description:
        "Save typed account knowledge with original evidence and a stable mutation UUID. Agent statements require original wording plus session/message references; unsourced assertions remain proposed inference. Knowledge never grants action authority.",
      inputSchema: knowledgeMutationInputSchema,
    },
    async (input) => apiResult(() => api.saveKnowledge(input)),
  );
  server.registerTool(
    "get_knowledge",
    {
      description:
        "Read one knowledge record for an explicit eligible purpose. Workspace and source read scopes remain required. Sensitive disclosure awaits owner settings.",
      inputSchema: knowledgeReadInputSchema,
    },
    async (input) => apiResult(() => api.getKnowledge(input)),
  );
}
