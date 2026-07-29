import { z } from "zod";
import { idSchema, isoDateTimeSchema, semanticVersionSchema } from "./common.js";
import { agentMutationPolicies, materialSourceReferenceSchema } from "./feature-contracts.js";

export const assistantDomains = [
  "mail",
  "calendar",
  "reminders",
  "tasks",
  "finances",
  "goals",
] as const;
export const assistantDomainSchema = z.enum(assistantDomains);
export type AssistantDomain = z.infer<typeof assistantDomainSchema>;

export const domainPreferenceValueSchema = z.union([
  z.null(),
  z.boolean(),
  z.number(),
  z.string(),
  z.array(z.string().max(500)).max(100),
]);

export const domainSourceContextSchema = z.object({
  notes: z.string().max(2_000).nullable().default(null),
  purpose: z.string().trim().min(1).max(500),
  sourceId: z.string().min(1).max(200),
  sourceLabel: z.string().trim().min(1).max(200),
});
export type DomainSourceContext = z.infer<typeof domainSourceContextSchema>;

export const domainCategorySchema = z.object({
  description: z.string().trim().min(1).max(1_000),
  examples: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
  key: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9]+(?:_[a-z0-9]+)*$/),
  label: z.string().trim().min(1).max(120),
});
export type DomainCategory = z.infer<typeof domainCategorySchema>;

export const domainProfileStatusSchema = z.enum(["draft", "active"]);
export type DomainProfileStatus = z.infer<typeof domainProfileStatusSchema>;

export const domainProfileSchema = z.object({
  categories: z.array(domainCategorySchema).max(50),
  createdAt: isoDateTimeSchema,
  domain: assistantDomainSchema,
  id: idSchema,
  instructions: z.array(z.string().trim().min(1).max(1_000)).max(100),
  objective: z.string().trim().min(1).max(1_000),
  preferences: z.record(z.string().min(1).max(100), domainPreferenceValueSchema),
  sourceContexts: z.array(domainSourceContextSchema).max(50),
  status: domainProfileStatusSchema,
  summary: z.string().trim().min(1).max(4_000),
  updatedAt: isoDateTimeSchema,
  version: z.int().positive(),
});
export type DomainProfile = z.infer<typeof domainProfileSchema>;

export const upsertDomainProfileInputSchema = domainProfileSchema
  .pick({
    categories: true,
    domain: true,
    instructions: true,
    objective: true,
    preferences: true,
    sourceContexts: true,
    status: true,
    summary: true,
  })
  .extend({ expectedVersion: z.int().positive().optional() });
export type UpsertDomainProfileInput = z.infer<typeof upsertDomainProfileInputSchema>;

export const attentionItemKindSchema = z.enum([
  "important",
  "upcoming",
  "follow_up",
  "run_summary",
]);
export type AttentionItemKind = z.infer<typeof attentionItemKindSchema>;

export const attentionItemImportanceSchema = z.enum(["low", "normal", "high", "critical"]);
export type AttentionItemImportance = z.infer<typeof attentionItemImportanceSchema>;

export const attentionItemStatusSchema = z.enum(["open", "resolved", "dismissed"]);
export type AttentionItemStatus = z.infer<typeof attentionItemStatusSchema>;

export const attentionItemSchema = z.object({
  createdAt: isoDateTimeSchema,
  domain: assistantDomainSchema,
  expiresAt: isoDateTimeSchema.nullable(),
  id: idSchema,
  importance: attentionItemImportanceSchema,
  kind: attentionItemKindSchema,
  occursAt: isoDateTimeSchema.nullable(),
  relatedEntityId: idSchema.nullable(),
  relatedEntityType: z.string().max(100).nullable(),
  source: materialSourceReferenceSchema.nullable(),
  status: attentionItemStatusSchema,
  summary: z.string().trim().min(1).max(4_000),
  title: z.string().trim().min(1).max(240),
  updatedAt: isoDateTimeSchema,
});
export type AttentionItem = z.infer<typeof attentionItemSchema>;

export const createAttentionItemInputSchema = attentionItemSchema.pick({
  domain: true,
  expiresAt: true,
  importance: true,
  kind: true,
  occursAt: true,
  relatedEntityId: true,
  relatedEntityType: true,
  source: true,
  summary: true,
  title: true,
});
export type CreateAttentionItemInput = z.infer<typeof createAttentionItemInputSchema>;

export const attentionItemQuerySchema = z.object({
  domain: assistantDomainSchema,
  limit: z.coerce.number().int().min(1).max(100).default(50),
  status: attentionItemStatusSchema.default("open"),
});
export type AttentionItemQuery = z.infer<typeof attentionItemQuerySchema>;

export const updateAttentionItemInputSchema = z.object({
  status: attentionItemStatusSchema,
});
export type UpdateAttentionItemInput = z.infer<typeof updateAttentionItemInputSchema>;

export const configuredRuleBaseSchema = z.object({
  confidenceThreshold: z.number().min(0).max(1).nullable(),
  createdAt: isoDateTimeSchema,
  description: z.string().max(2_000),
  domain: assistantDomainSchema,
  enabled: z.boolean(),
  id: idSchema,
  name: z.string().trim().min(1).max(120),
  policy: z.enum(agentMutationPolicies),
  profileId: idSchema.nullable(),
  sourceIds: z.array(idSchema).max(50),
  updatedAt: isoDateTimeSchema,
  version: z.int().positive(),
});
export type ConfiguredRuleBase = z.infer<typeof configuredRuleBaseSchema>;

export const assistantSetupStatusSchema = z.object({
  domains: z.array(
    z.object({
      canRead: z.boolean(),
      canWrite: z.boolean(),
      domain: assistantDomainSchema,
      approvedProfileStatus: z.literal("active").nullable(),
      approvedProfileVersion: z.int().positive().nullable(),
      pendingDraftVersion: z.int().positive().nullable(),
      profileStatus: domainProfileStatusSchema.nullable(),
      profileVersion: z.int().positive().nullable(),
    }),
  ),
});
export type AssistantSetupStatus = z.infer<typeof assistantSetupStatusSchema>;

export const agentDomainSupportSchema = z.object({
  domain: assistantDomainSchema,
  readScope: z.string().min(1),
  support: z.enum(["unsupported", "profile_and_attention", "executable_rules"]),
  writeScope: z.string().min(1),
});
export type AgentDomainSupport = z.infer<typeof agentDomainSupportSchema>;

export const agentConnectionGuideSchema = z.object({
  domains: z.array(agentDomainSupportSchema),
  mcpUrl: z.url(),
  skill: z.object({
    displayName: z.string().min(1),
    installPrompt: z.string().min(1),
    invocation: z.string().min(1),
    name: z.string().min(1),
    revision: z.string().trim().min(1).max(128),
    setupPrompt: z.string().min(1),
    sourceUrl: z.url(),
    version: semanticVersionSchema,
  }),
});
export type AgentConnectionGuide = z.infer<typeof agentConnectionGuideSchema>;
