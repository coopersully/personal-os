import { z } from "zod";
import { accessScopeSchema } from "./auth.js";
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
  version: z.int().positive(),
});
export type AttentionItem = z.infer<typeof attentionItemSchema>;

export const createAttentionItemInputSchema = attentionItemSchema
  .pick({
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
  })
  .extend({
    relatedEntityId: idSchema.nullable().default(null),
    relatedEntityType: z.string().max(100).nullable().default(null),
    source: materialSourceReferenceSchema.nullable().default(null),
  });
export type CreateAttentionItemInput = z.infer<typeof createAttentionItemInputSchema>;

export const attentionItemQuerySchema = z.object({
  domain: assistantDomainSchema,
  limit: z.coerce.number().int().min(1).max(100).default(50),
  status: attentionItemStatusSchema.default("open"),
});
export type AttentionItemQuery = z.infer<typeof attentionItemQuerySchema>;

export const agentAccessDomains = ["mail", "finances", "calendar", "tasks"] as const;
export const agentAccessDomainSchema = z.enum(agentAccessDomains);
export type AgentAccessDomain = z.infer<typeof agentAccessDomainSchema>;

export const agentAccessWorkItemKindSchema = z.enum(["review", "attention", "setup"]);
export type AgentAccessWorkItemKind = z.infer<typeof agentAccessWorkItemKindSchema>;

export const agentAccessWorkItemPrioritySchema = z.enum([
  "person_review",
  "blocked",
  "critical",
  "high",
  "normal",
  "low",
]);
export type AgentAccessWorkItemPriority = z.infer<typeof agentAccessWorkItemPrioritySchema>;

export const agentAccessWorkItemQuerySchema = z.object({
  cursor: z.string().trim().min(1).max(4_000).optional(),
  domain: agentAccessDomainSchema.optional(),
  kind: agentAccessWorkItemKindSchema.optional(),
  limit: z.coerce.number().int().min(1).max(10).default(10),
});
export type AgentAccessWorkItemQuery = z.infer<typeof agentAccessWorkItemQuerySchema>;

export const agentAccessWorkItemSchema = z.object({
  action: z
    .object({
      label: z.string().trim().min(1).max(120),
      to: z
        .string()
        .trim()
        .min(1)
        .max(500)
        .regex(/^\/(?!\/)/),
    })
    .nullable(),
  actionAt: isoDateTimeSchema.nullable(),
  domain: agentAccessDomainSchema.nullable(),
  id: z.string().trim().min(1).max(300),
  kind: agentAccessWorkItemKindSchema,
  priority: agentAccessWorkItemPrioritySchema,
  source: materialSourceReferenceSchema.nullable(),
  summary: z.string().trim().min(1).max(1_000),
  title: z.string().trim().min(1).max(240),
  updatedAt: isoDateTimeSchema,
});
export type AgentAccessWorkItem = z.infer<typeof agentAccessWorkItemSchema>;

const agentAccessWorkItemCountSchema = z.int().nonnegative().nullable();

export const agentAccessWorkItemSummarySchema = z.object({
  byDomain: z.object({
    calendar: agentAccessWorkItemCountSchema,
    finances: agentAccessWorkItemCountSchema,
    mail: agentAccessWorkItemCountSchema,
    tasks: agentAccessWorkItemCountSchema,
  }),
  byKind: z.object({
    attention: agentAccessWorkItemCountSchema,
    review: agentAccessWorkItemCountSchema,
    setup: agentAccessWorkItemCountSchema,
  }),
  total: agentAccessWorkItemCountSchema,
});
export type AgentAccessWorkItemSummary = z.infer<typeof agentAccessWorkItemSummarySchema>;

export const agentAccessWorkItemPageSchema = z.object({
  items: z.array(agentAccessWorkItemSchema).max(10),
  nextCursor: z.string().trim().min(1).max(4_000).nullable(),
  snapshotAt: isoDateTimeSchema,
  summary: agentAccessWorkItemSummarySchema,
  unavailableDomains: z.array(agentAccessDomainSchema).max(agentAccessDomains.length),
});
export type AgentAccessWorkItemPage = z.infer<typeof agentAccessWorkItemPageSchema>;

export const updateAttentionItemInputSchema = z.object({
  expectedVersion: z.int().positive(),
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

export const iloAgentContextSchema = z.object({
  access: z.object({
    grantedScopes: z.array(accessScopeSchema),
  }),
  generatedAt: isoDateTimeSchema,
  identity: z.object({
    actorType: z.enum(["agent", "user"]),
    displayName: z.string().min(1),
    userId: idSchema,
  }),
  links: z.object({
    activity: z.url(),
    agentAccess: z.url(),
    approvals: z.url(),
    recovery: z.url(),
    today: z.url(),
  }),
  readiness: assistantSetupStatusSchema,
  time: z.object({
    timestamp: isoDateTimeSchema,
    timezone: z.string().min(1),
  }),
});
export type IloAgentContext = z.infer<typeof iloAgentContextSchema>;

export const assistantSetupStepIds = [
  "connect_agent",
  "learn_preferences",
  "review_guidance",
  "complete",
] as const;
export const assistantSetupStepIdSchema = z.enum(assistantSetupStepIds);
export type AssistantSetupStepId = z.infer<typeof assistantSetupStepIdSchema>;

export const assistantSetupPlanQuerySchema = z.object({
  domain: assistantDomainSchema.optional(),
  stepId: assistantSetupStepIdSchema.optional(),
});
export type AssistantSetupPlanQuery = z.infer<typeof assistantSetupPlanQuerySchema>;

export const assistantSetupStepSchema = z.object({
  completionEvidence: z.array(z.string().min(1)).max(20),
  description: z.string().min(1),
  id: assistantSetupStepIdSchema,
  instructions: z.array(z.string().min(1)).max(20),
  order: z.int().positive(),
  owner: z.enum(["agent", "ilo", "person"]),
  requiredTools: z.array(z.string().min(1)).max(20),
  state: z.enum(["blocked", "current", "complete"]),
  title: z.string().min(1),
  userAction: z.string().min(1).nullable(),
});
export type AssistantSetupStep = z.infer<typeof assistantSetupStepSchema>;

export const assistantSetupPlanSchema = z.object({
  access: z.object({
    canRead: z.boolean(),
    canWrite: z.boolean(),
  }),
  connection: z.object({
    lastObservedAt: isoDateTimeSchema.nullable(),
    observed: z.boolean(),
  }),
  currentStepId: assistantSetupStepIdSchema,
  domain: assistantDomainSchema,
  nextAction: z.string().min(1),
  profile: z.object({
    approvedStatus: z.literal("active").nullable(),
    approvedVersion: z.int().positive().nullable(),
    pendingDraftVersion: z.int().positive().nullable(),
    status: domainProfileStatusSchema.nullable(),
    version: z.int().positive().nullable(),
  }),
  progress: z.object({
    completed: z.int().nonnegative(),
    total: z.int().positive(),
  }),
  protocolVersion: z.literal("1.0"),
  selectedStepId: assistantSetupStepIdSchema,
  status: z.enum(["blocked", "complete", "in_progress", "needs_connection", "needs_input"]),
  steps: z.array(assistantSetupStepSchema).min(1),
});
export type AssistantSetupPlan = z.infer<typeof assistantSetupPlanSchema>;

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
