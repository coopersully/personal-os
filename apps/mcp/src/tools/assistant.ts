import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PersonalOsApiClient } from "@personal-os/api-client";
import {
  assistantDomainSchema,
  domainPreferenceValueSchema,
  idSchema,
  isoDateTimeSchema,
  materialSourceReferenceSchema,
} from "@personal-os/domain";
import { z } from "zod";
import { result } from "../tool-result.js";

export const assistantDomain = assistantDomainSchema;
const id = idSchema.describe("ilo object identifier");
const isoDateTime = isoDateTimeSchema;
const preferenceValue = domainPreferenceValueSchema;
const sourceReference = materialSourceReferenceSchema;

/** Shared setup and attention tools; domain APIs remain the authority. */
export function registerAssistantTools(server: McpServer, api: PersonalOsApiClient) {
  server.registerTool(
    "get_agent_setup_status",
    {
      annotations: { openWorldHint: false, readOnlyHint: true },
      description:
        "Discover which ilo domains this agent can read or configure and whether each has a draft or active preference profile. Use this before conducting setup.",
      inputSchema: {},
      title: "Get ilo agent setup status",
    },
    async () => result(await api.getAssistantSetupStatus()),
  );

  server.registerTool(
    "get_domain_profile",
    {
      annotations: { openWorldHint: false, readOnlyHint: true },
      description:
        "Read the user's durable preferences, source meanings, categories, and operating instructions for one ilo domain.",
      inputSchema: { domain: assistantDomain },
      title: "Get ilo domain profile",
    },
    async ({ domain }) => result(await api.getDomainProfile(domain)),
  );

  server.registerTool(
    "save_domain_profile",
    {
      annotations: { idempotentHint: true, openWorldHint: false },
      description:
        "Create or revise one domain's durable preference profile after a short user interview. Preserve user wording and use expectedVersion when updating.",
      inputSchema: {
        categories: z
          .array(
            z.object({
              description: z.string().min(1).max(1_000),
              examples: z.array(z.string().min(1).max(500)).max(20).default([]),
              key: z.string().regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/),
              label: z.string().min(1).max(120),
            }),
          )
          .max(50)
          .default([]),
        domain: assistantDomain,
        expectedVersion: z.number().int().positive().optional(),
        instructions: z.array(z.string().min(1).max(1_000)).max(100).default([]),
        objective: z.string().min(1).max(1_000),
        preferences: z.record(z.string().min(1).max(100), preferenceValue).default({}),
        sourceContexts: z
          .array(
            z.object({
              notes: z.string().max(2_000).nullable().default(null),
              purpose: z.string().min(1).max(500),
              sourceId: z.string().min(1).max(200),
              sourceLabel: z.string().min(1).max(200),
            }),
          )
          .max(50)
          .default([]),
        status: z.enum(["draft", "active"]).default("draft"),
        summary: z.string().min(1).max(4_000),
      },
      title: "Save ilo domain profile",
    },
    async (input) => result(await api.upsertDomainProfile(input)),
  );

  server.registerTool(
    "list_attention_items",
    {
      annotations: { openWorldHint: false, readOnlyHint: true },
      description:
        "List open, resolved, or dismissed important items, upcoming commitments, follow-ups, and run summaries for one domain.",
      inputSchema: {
        domain: assistantDomain,
        limit: z.number().int().min(1).max(100).default(50),
        status: z.enum(["open", "resolved", "dismissed"]).default("open"),
      },
      title: "List ilo attention items",
    },
    async (input) => result(await api.listAttentionItems(input)),
  );

  server.registerTool(
    "create_attention_item",
    {
      annotations: { openWorldHint: false },
      description:
        "Record a concise important item, upcoming commitment, follow-up, or post-run summary in the same cross-domain structure.",
      inputSchema: {
        domain: assistantDomain,
        expiresAt: isoDateTime.nullable().default(null),
        importance: z.enum(["low", "normal", "high", "critical"]).default("normal"),
        kind: z.enum(["important", "upcoming", "follow_up", "run_summary"]),
        occursAt: isoDateTime.nullable().default(null),
        relatedEntityId: id.nullable().default(null),
        relatedEntityType: z.string().max(100).nullable().default(null),
        source: sourceReference.nullable().default(null),
        summary: z.string().min(1).max(4_000),
        title: z.string().min(1).max(240),
      },
      title: "Create ilo attention item",
    },
    async (input) => result(await api.createAttentionItem(input)),
  );

  server.registerTool(
    "update_attention_item",
    {
      annotations: { idempotentHint: true, openWorldHint: false },
      description: "Resolve, dismiss, or reopen one ilo attention item.",
      inputSchema: {
        domain: assistantDomain,
        id,
        status: z.enum(["open", "resolved", "dismissed"]),
      },
      title: "Update ilo attention item",
    },
    async ({ domain, id: itemId, status }) =>
      result(await api.updateAttentionItem(domain, itemId, { status })),
  );
}
