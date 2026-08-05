import type { McpServer } from "@modelcontextprotocol/server";
import type { PersonalOsApiClient } from "@personal-os/api-client";
import {
  assistantDomainSchema,
  assistantSetupStepIdSchema,
  domainPreferenceValueSchema,
  idSchema,
  isoDateTimeSchema,
} from "@personal-os/domain";
import { z } from "zod";
import { apiResult } from "../tool-result.js";

export const assistantDomain = assistantDomainSchema;
const id = idSchema.describe("ilo object identifier");
const isoDateTime = isoDateTimeSchema;
const preferenceValue = domainPreferenceValueSchema;

/** Shared setup and attention tools; domain APIs remain the authority. */
export function registerAssistantTools(server: McpServer, api: PersonalOsApiClient) {
  server.registerTool(
    "get_ilo_setup",
    {
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
        readOnlyHint: true,
      },
      description:
        "Start or continue Ilo setup. Call this immediately after connecting and again after saving or approving guidance. It returns the current semantic step, evidence, domain-specific instructions, required tools, and human approval boundary. No separately installed skill is required.",
      inputSchema: z.object({
        domain: assistantDomain
          .optional()
          .describe("Ilo domain to set up. Omit to begin with Mail."),
        stepId: assistantSetupStepIdSchema
          .optional()
          .describe("Optional semantic step to inspect without changing setup state."),
      }),
      title: "Start or continue Ilo setup",
    },
    async (input) => apiResult(() => api.getIloSetup(input)),
  );

  server.registerTool(
    "get_agent_setup_status",
    {
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
        readOnlyHint: true,
      },
      description:
        "Compatibility status view for Ilo domains and profiles. Prefer get_ilo_setup for the current step and self-contained setup instructions.",
      inputSchema: z.object({}),
      title: "Get ilo agent setup status",
    },
    async () => apiResult(() => api.getAssistantSetupStatus()),
  );

  server.registerTool(
    "get_domain_profile",
    {
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
        readOnlyHint: true,
      },
      description:
        "Read one ilo domain profile and its status. Active profiles are operative guidance; draft profiles are unapproved proposals and must not be treated as operating instructions.",
      inputSchema: z.object({ domain: assistantDomain }),
      title: "Get ilo domain profile",
    },
    async ({ domain }) => apiResult(() => api.getDomainProfile(domain)),
  );

  server.registerTool(
    "save_domain_profile",
    {
      annotations: {
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
        readOnlyHint: false,
      },
      description:
        "Create or revise one domain preference profile after a short user interview. Save a draft first, preserve user wording, and use expectedVersion when updating. A saved draft is not approval; domain-specific API validation of source ownership, connectivity, activation authority, and preferences is authoritative.",
      inputSchema: z.object({
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
      }),
      title: "Save ilo domain profile",
    },
    async (input) => apiResult(() => api.upsertDomainProfile(input)),
  );

  server.registerTool(
    "list_attention_items",
    {
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
        readOnlyHint: true,
      },
      description:
        "List open, resolved, or dismissed important items, upcoming commitments, follow-ups, and run summaries for one domain.",
      inputSchema: z.object({
        domain: assistantDomain,
        limit: z.number().int().min(1).max(100).default(50),
        status: z.enum(["open", "resolved", "dismissed"]).default("open"),
      }),
      title: "List ilo attention items",
    },
    async (input) => apiResult(() => api.listAttentionItems(input)),
  );

  server.registerTool(
    "create_attention_item",
    {
      annotations: {
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
        readOnlyHint: false,
      },
      description:
        "Record an intentionally unlinked generic note in one domain. For Mail conversations, Calendar events, Reminders, or Finance transactions, use the domain-owned attention tool so Ilo can validate ownership and derive provenance.",
      inputSchema: z.object({
        domain: assistantDomain,
        expiresAt: isoDateTime.nullable().default(null),
        importance: z.enum(["low", "normal", "high", "critical"]).default("normal"),
        kind: z.enum(["important", "upcoming", "follow_up", "run_summary"]),
        occursAt: isoDateTime.nullable().default(null),
        summary: z.string().min(1).max(4_000),
        title: z.string().min(1).max(240),
      }),
      title: "Create ilo attention item",
    },
    async (input) =>
      apiResult(() =>
        api.createAttentionItem({
          ...input,
          relatedEntityId: null,
          relatedEntityType: null,
          source: null,
        }),
      ),
  );

  server.registerTool(
    "update_attention_item",
    {
      annotations: {
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
        readOnlyHint: false,
      },
      description:
        "Resolve, dismiss, or reopen one ilo attention item using the version returned by list_attention_items. If another workflow refreshed it first, Ilo returns a conflict with the current version.",
      inputSchema: z.object({
        domain: assistantDomain,
        id,
        expectedVersion: z.number().int().positive(),
        status: z.enum(["open", "resolved", "dismissed"]),
      }),
      title: "Update ilo attention item",
    },
    async ({ domain, expectedVersion, id: itemId, status }) =>
      apiResult(() => api.updateAttentionItem(domain, itemId, { expectedVersion, status })),
  );
}
