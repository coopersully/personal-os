import type { McpServer } from "@modelcontextprotocol/server";
import type { PersonalOsApiClient } from "@personal-os/api-client";
import {
  knowledgeAgentLifecycleInputSchema,
  knowledgeExplainInputSchema,
  knowledgeMutationInputSchema,
  knowledgeQuerySchema,
  knowledgeReadInputSchema,
} from "@personal-os/domain";
import { apiResult } from "../tool-result.js";

/** Stateless adapters: API owns classification, disclosure and authority. */
export function registerKnowledgeTools(server: McpServer, api: PersonalOsApiClient): void {
  server.registerTool(
    "save_knowledge",
    {
      description:
        "Search for existing knowledge before saving. Save typed account knowledge with original evidence and a stable mutation UUID. Agent statements require original wording plus session/message references; unsourced assertions remain proposed inference. Read the receipt outcome before using record content: pending owner review and forgotten receipts contain IDs only.",
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
  server.registerTool(
    "update_knowledge",
    {
      description:
        "Revise, dispute, or supersede a knowledge record using its current revision and a stable mutation UUID. The API may create a proposal when the owner has accepted the current value. Fetch fresh context after the mutation.",
      inputSchema: knowledgeAgentLifecycleInputSchema,
    },
    async (input) => apiResult(() => api.updateKnowledge(input)),
  );
  server.registerTool(
    "search_user_knowledge",
    {
      description:
        "Find permitted memory for one declared purpose. Search before creating a duplicate, follow any returned cursor with the same filters, and cite the record and supporting sources you use.",
      inputSchema: knowledgeQuerySchema,
    },
    async (input) => apiResult(() => api.searchKnowledge(input)),
  );
  server.registerTool(
    "get_context_for_intent",
    {
      description:
        "Fetch bounded, purpose-specific memory for the current intent. Cite supporting sources, distinguish stated and inferred knowledge, and preserve tentative material, conflicts and missing inputs. Fetch fresh context after a memory mutation. Context provides evidence and grants no action authority.",
      inputSchema: knowledgeQuerySchema,
    },
    async (input) => apiResult(() => api.getKnowledgeContext(input)),
  );
  server.registerTool(
    "explain_context",
    {
      description:
        "Check which references from a previous context use remain available to this caller. Changed or unavailable references call for a fresh context fetch.",
      inputSchema: knowledgeExplainInputSchema,
    },
    async (input) => apiResult(() => api.explainKnowledgeContext(input)),
  );
}
