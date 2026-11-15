import type { McpServer } from "@modelcontextprotocol/server";
import type { PersonalOsApiClient } from "@personal-os/api-client";
import {
  knowledgeAgentLifecycleInputSchema,
  knowledgeAgentQuerySchema,
  knowledgeExplainInputSchema,
  knowledgeMutationInputSchema,
  knowledgeReadInputSchema,
} from "@personal-os/domain";
import { apiResult } from "../tool-result.js";

/** Stateless adapters: API owns classification, disclosure and authority. */
export function registerKnowledgeTools(server: McpServer, api: PersonalOsApiClient): void {
  server.registerTool(
    "save_knowledge",
    {
      description:
        "Search for existing knowledge before saving. Save typed account knowledge with original evidence and a stable mutation UUID; it is active at once. Agent statements require original wording plus session/message references; unsourced assertions are saved as inferred. Purposes are optional relevance hints. Read the receipt outcome before using record content: a forgotten receipt contains IDs only.",
      inputSchema: knowledgeMutationInputSchema,
    },
    async (input) => apiResult(() => api.saveKnowledge(input)),
  );
  server.registerTool(
    "get_knowledge",
    {
      description:
        "Read one knowledge record. Workspace and source read scopes remain required. Check origin, ownerHeld, sensitivity and conflicts before acting on it.",
      inputSchema: knowledgeReadInputSchema,
    },
    async (input) => apiResult(() => api.getKnowledge(input)),
  );
  server.registerTool(
    "update_knowledge",
    {
      description:
        "Revise, dispute, supersede, archive, unarchive, restrict to a workspace, or mark sensitive a knowledge record using its current revision and a stable mutation UUID. Revising or superseding memory the owner holds creates a proposal for the owner instead. Fetch fresh context after the mutation.",
      inputSchema: knowledgeAgentLifecycleInputSchema,
    },
    async (input) => apiResult(() => api.updateKnowledge(input)),
  );
  server.registerTool(
    "search_user_knowledge",
    {
      description:
        "Find permitted memory; an optional purpose ranks matching records first. Search before creating a duplicate, follow any returned cursor with the same filters, and cite the record and supporting sources you use.",
      inputSchema: knowledgeAgentQuerySchema,
    },
    async (input) => apiResult(() => api.searchKnowledge(input)),
  );
  server.registerTool(
    "get_context_for_intent",
    {
      description:
        "Fetch bounded, purpose-specific memory for the current intent. Cite supporting sources, distinguish stated and inferred knowledge, and preserve tentative material, conflicts and missing inputs. Fetch fresh context after a memory mutation. Context provides evidence and grants no action authority.",
      inputSchema: knowledgeAgentQuerySchema,
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
