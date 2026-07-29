import { z } from "zod";
import {
  attentionItemImportanceSchema,
  attentionItemKindSchema,
  configuredRuleBaseSchema,
  domainPreferenceValueSchema,
  domainSourceContextSchema,
  upsertDomainProfileInputSchema,
} from "./assistant.js";
import { idSchema, isoDateTimeSchema } from "./common.js";
import type { AgentMutationPolicy } from "./feature-contracts.js";

export const mailProviderSchema = z.enum(["google", "icloud"]);
export type MailProvider = z.infer<typeof mailProviderSchema>;

export const mailboxRoleSchema = z.enum([
  "inbox",
  "sent",
  "drafts",
  "trash",
  "spam",
  "archive",
  "custom",
]);
export type MailboxRole = z.infer<typeof mailboxRoleSchema>;

export const mailboxSchema = z.object({
  accountId: idSchema,
  id: idSchema,
  name: z.string(),
  provider: mailProviderSchema,
  role: mailboxRoleSchema,
  totalCount: z.number().int().nonnegative(),
  unreadCount: z.number().int().nonnegative(),
});
export type Mailbox = z.infer<typeof mailboxSchema>;

export const mailSetupAccountSchema = z.object({
  accountId: idSchema,
  automaticRuleExecution: z.boolean(),
  email: z.email().nullable(),
  label: z.string().trim().min(1).max(200),
  lastSyncedAt: isoDateTimeSchema.nullable(),
  mailboxes: z.array(mailboxSchema),
  provider: mailProviderSchema,
  syncError: z.string().nullable(),
  syncStatus: z.enum(["idle", "syncing", "error"]),
});
export type MailSetupAccount = z.infer<typeof mailSetupAccountSchema>;

export const mailSetupContextSchema = z.object({
  accounts: z.array(mailSetupAccountSchema),
  safety: z.object({
    delayedRetentionAutomation: z.literal(false),
    permanentDeletion: z.literal(false),
    providerFilterCreation: z.literal(false),
    spamClassification: z.literal(false),
    unsubscribeAutomation: z.literal(false),
  }),
});
export type MailSetupContext = z.infer<typeof mailSetupContextSchema>;

export const mailAddressSchema = z.object({
  address: z.string(),
  name: z.string().nullable(),
});
export type MailAddress = z.infer<typeof mailAddressSchema>;

const mailHeaderTextSchema = (maximum: number, allowEmpty = false) =>
  z
    .string()
    .trim()
    .min(allowEmpty ? 0 : 1)
    .max(maximum)
    .refine(
      (value) =>
        [...value].every((character) => {
          const codePoint = character.codePointAt(0) ?? 0;
          return codePoint > 31 && (codePoint < 127 || codePoint > 159);
        }),
      { message: "Mail header text cannot contain control characters." },
    );

export const mailRecipientInputSchema = z.object({
  address: z.string().trim().max(320).pipe(z.email()),
  name: mailHeaderTextSchema(200).nullable(),
});
export type MailRecipientInput = z.infer<typeof mailRecipientInputSchema>;

export const mailThreadSchema = z.object({
  accountId: idSchema,
  bodyText: z.string(),
  from: mailAddressSchema,
  id: idSchema,
  mailboxIds: z.array(idSchema),
  messageCount: z.number().int().positive(),
  provider: mailProviderSchema,
  receivedAt: isoDateTimeSchema,
  remoteThreadId: z.string(),
  snippet: z.string(),
  starred: z.boolean(),
  subject: z.string(),
  to: z.array(mailAddressSchema),
  unread: z.boolean(),
  updatedAt: isoDateTimeSchema,
});
export type MailThread = z.infer<typeof mailThreadSchema>;

export const mailAttachmentSchema = z.object({
  contentType: z.string(),
  filename: z.string(),
  id: z.string(),
  size: z.number().int().nonnegative(),
});
export type MailAttachment = z.infer<typeof mailAttachmentSchema>;

export const mailMessageSchema = z.object({
  attachments: z.array(mailAttachmentSchema),
  bodyText: z.string(),
  cc: z.array(mailAddressSchema),
  from: mailAddressSchema,
  id: idSchema,
  receivedAt: isoDateTimeSchema,
  threadId: idSchema,
  to: z.array(mailAddressSchema),
});
export type MailMessage = z.infer<typeof mailMessageSchema>;

export const mailListQuerySchema = z.object({
  accountIds: z
    .string()
    .transform((value) => value.split(",").filter(Boolean))
    .pipe(z.array(idSchema))
    .optional(),
  mailboxId: idSchema.optional(),
  query: z.string().trim().min(1).max(200).optional(),
  unread: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export type MailListQuery = z.infer<typeof mailListQuerySchema>;

/** A provider-backed change to a conversation. Fields are intentionally optional
 * so a single keyboard/bulk action can update one or more attributes. */
export const updateMailThreadInputSchema = z
  .object({
    expectedUpdatedAt: isoDateTimeSchema.optional(),
    mailboxIds: z.array(idSchema).max(100).optional(),
    starred: z.boolean().optional(),
    unread: z.boolean().optional(),
  })
  .refine(
    (input) =>
      input.mailboxIds !== undefined || input.starred !== undefined || input.unread !== undefined,
    {
      message: "Provide at least one mail change.",
    },
  );
export type UpdateMailThreadInput = z.infer<typeof updateMailThreadInputSchema>;

export const bulkUpdateMailItemSchema = z.object({
  expectedUpdatedAt: isoDateTimeSchema,
  id: idSchema,
});
export type BulkUpdateMailItem = z.infer<typeof bulkUpdateMailItemSchema>;

export const bulkUpdateMailInputSchema = z
  .object({
    items: z
      .array(bulkUpdateMailItemSchema)
      .min(1)
      .max(6)
      .refine(
        (items) => new Set(items.map((item) => item.id)).size === items.length,
        "Mail conversation IDs must be unique.",
      ),
    starred: z.boolean().optional(),
    unread: z.boolean().optional(),
  })
  .refine((input) => input.starred !== undefined || input.unread !== undefined, {
    message: "Provide at least one bulk Mail change.",
  });
export type BulkUpdateMailInput = z.infer<typeof bulkUpdateMailInputSchema>;

export const bulkUpdateMailResultSchema = z.object({
  failedCount: z.int().nonnegative(),
  failures: z.array(
    z.object({
      error: z.object({
        code: z.string(),
        details: z.unknown().nullable(),
        message: z.string(),
        status: z.int().nullable(),
      }),
      id: idSchema,
    }),
  ),
  updatedCount: z.int().nonnegative(),
  updatedIds: z.array(idSchema),
});
export type BulkUpdateMailResult = z.infer<typeof bulkUpdateMailResultSchema>;

export const mailDraftInputSchema = z.object({
  accountId: idSchema,
  body: z.string().max(100_000),
  cc: z.array(mailRecipientInputSchema).max(100).default([]),
  subject: mailHeaderTextSchema(998, true),
  threadId: idSchema.optional(),
  to: z.array(mailRecipientInputSchema).min(1).max(100),
});
export type MailDraftInput = z.infer<typeof mailDraftInputSchema>;

export const sendMailInputSchema = mailDraftInputSchema.extend({ draftId: idSchema.optional() });
export type SendMailInput = z.infer<typeof sendMailInputSchema>;

export const reconcileMailDraftInputSchema = z.object({
  outcome: z.enum(["not_sent", "sent"]),
});
export type ReconcileMailDraftInput = z.infer<typeof reconcileMailDraftInputSchema>;

export const mailDraftSchema = mailDraftInputSchema.extend({
  createdAt: isoDateTimeSchema,
  id: idSchema,
  reconciliationState: z.enum(["in_progress", "none", "sent_mail_review_required"]),
  sendClaimedAt: isoDateTimeSchema.nullable(),
  sendStatus: z.enum(["draft", "sending", "sent", "reconcile"]),
  sentAt: isoDateTimeSchema.nullable(),
  threadId: idSchema.nullable(),
  updatedAt: isoDateTimeSchema,
});
export type MailDraft = z.infer<typeof mailDraftSchema>;

export const mailSnoozeInputSchema = z.object({ until: isoDateTimeSchema });
export type MailSnoozeInput = z.infer<typeof mailSnoozeInputSchema>;

export const mailRuleConditionSchema = z.object({
  field: z.enum(["any", "sender", "subject", "snippet"]).default("any"),
  operator: z.enum(["contains", "equals", "ends_with"]).default("contains"),
  value: z.string().trim().min(1).max(500),
});
export type MailRuleCondition = z.infer<typeof mailRuleConditionSchema>;

export const mailRuleActionSchema = z
  .object({
    afterDays: z.int().min(0).max(365).default(0),
    mailboxId: idSchema.nullable().default(null),
    type: z.enum(["add_label", "archive", "mark_read", "star", "trash"]),
  })
  .superRefine((action, context) => {
    if (action.type === "add_label" && action.mailboxId === null) {
      context.addIssue({
        code: "custom",
        message: "A label action requires a destination mailbox.",
        path: ["mailboxId"],
      });
    }
    if (action.type !== "add_label" && action.mailboxId !== null) {
      context.addIssue({
        code: "custom",
        message: "Only a label action accepts a destination mailbox.",
        path: ["mailboxId"],
      });
    }
  });
export type MailRuleAction = z.infer<typeof mailRuleActionSchema>;

export const legacyMailRuleActionSchema = z.enum(["archive", "mark_read", "star"]);
export type LegacyMailRuleAction = z.infer<typeof legacyMailRuleActionSchema>;

export function resolveStoredMailRule(input: {
  action: LegacyMailRuleAction;
  actions: MailRuleAction[] | null;
  condition: MailRuleCondition | null;
  enabled: boolean;
  policy: AgentMutationPolicy;
  query: string;
}): {
  actions: MailRuleAction[];
  condition: MailRuleCondition;
  policy: AgentMutationPolicy;
} {
  const isLegacy = input.actions === null || input.condition === null;
  return {
    actions: input.actions ?? [
      {
        afterDays: 0,
        mailboxId: null,
        type: input.action,
      },
    ],
    condition: input.condition ?? {
      field: "any",
      operator: "contains",
      value: input.query,
    },
    policy: isLegacy && input.enabled ? "approved_rule" : input.policy,
  };
}

export const mailRuleSchema = configuredRuleBaseSchema.extend({
  actions: z.array(mailRuleActionSchema).min(1).max(10),
  condition: mailRuleConditionSchema,
  domain: z.literal("mail"),
});
export type MailRule = z.infer<typeof mailRuleSchema>;

export const mailProfilePreferencesSchema = z
  .object({
    importantEmailHandling: z
      .enum(["inbox_only", "inbox_and_attention"])
      .default("inbox_and_attention"),
    inboxStyle: z
      .enum(["signal_only", "balanced", "conservative", "custom"])
      .default("conservative"),
    noiseDisposition: z
      .enum(["review_only", "archive_after_days", "trash_after_days"])
      .default("review_only"),
    noiseRetentionDays: z.int().min(1).max(365).nullable().default(null),
  })
  .catchall(domainPreferenceValueSchema)
  .superRefine((preferences, context) => {
    if (preferences.noiseDisposition === "review_only" && preferences.noiseRetentionDays !== null) {
      context.addIssue({
        code: "custom",
        message: "Review-only noise handling cannot set a retention period.",
        path: ["noiseRetentionDays"],
      });
    }
    if (preferences.noiseDisposition !== "review_only" && preferences.noiseRetentionDays === null) {
      context.addIssue({
        code: "custom",
        message: "Delayed noise handling requires a retention period.",
        path: ["noiseRetentionDays"],
      });
    }
  });
export type MailProfilePreferences = z.infer<typeof mailProfilePreferencesSchema>;

export const upsertMailProfileInputSchema = upsertDomainProfileInputSchema
  .extend({
    domain: z.literal("mail"),
    preferences: mailProfilePreferencesSchema,
    sourceContexts: z.array(domainSourceContextSchema.extend({ sourceId: idSchema })).max(50),
  })
  .superRefine((profile, context) => {
    const sourceIds = profile.sourceContexts.map((source) => source.sourceId);
    if (profile.status === "active" && sourceIds.length === 0) {
      context.addIssue({
        code: "custom",
        message: "An active Mail profile requires at least one connected Mail account.",
        path: ["sourceContexts"],
      });
    }
    if (new Set(sourceIds).size !== sourceIds.length) {
      context.addIssue({
        code: "custom",
        message: "Each Mail account can have only one source context.",
        path: ["sourceContexts"],
      });
    }
  });
export type UpsertMailProfileInput = z.infer<typeof upsertMailProfileInputSchema>;

const mailRuleInputSchema = mailRuleSchema.pick({
  actions: true,
  condition: true,
  confidenceThreshold: true,
  description: true,
  enabled: true,
  name: true,
  policy: true,
  profileId: true,
  sourceIds: true,
});

const uniqueMailRuleSourceIdsSchema = z
  .array(idSchema)
  .max(50)
  .refine(
    (sourceIds) => new Set(sourceIds).size === sourceIds.length,
    "Mail rule source accounts must be unique.",
  );

export const createMailRuleInputSchema = mailRuleInputSchema.extend({
  confidenceThreshold: z.null().default(null),
  description: z.string().max(2_000).default(""),
  enabled: z.literal(false).default(false),
  policy: z.literal("preview").default("preview"),
  profileId: idSchema.nullable().default(null),
  sourceIds: uniqueMailRuleSourceIdsSchema.default([]),
});
export type CreateMailRuleInput = z.infer<typeof createMailRuleInputSchema>;

export const updateMailRuleInputSchema = mailRuleInputSchema
  .partial()
  .extend({
    confidenceThreshold: z.null().optional(),
    enabled: z.literal(false).optional(),
    expectedVersion: z.int().positive(),
    policy: z.literal("preview").optional(),
    sourceIds: uniqueMailRuleSourceIdsSchema.optional(),
  })
  .refine(
    (input) => Object.keys(input).some((key) => key !== "expectedVersion"),
    "Provide at least one mail rule change.",
  );
export type UpdateMailRuleInput = z.infer<typeof updateMailRuleInputSchema>;

export const previewMailRuleInputSchema = createMailRuleInputSchema.omit({
  enabled: true,
  name: true,
  policy: true,
  profileId: true,
});
export type PreviewMailRuleInput = z.infer<typeof previewMailRuleInputSchema>;

export const mailRulePreviewSchema = z.object({
  candidates: z.array(
    z.object({
      accountId: idSchema,
      actions: z.array(mailRuleActionSchema.and(z.object({ due: z.boolean() }))),
      from: mailAddressSchema,
      id: idSchema,
      receivedAt: isoDateTimeSchema,
      subject: z.string(),
      updatedAt: isoDateTimeSchema,
    }),
  ),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  matchedCount: z.int().nonnegative(),
  previewedAt: isoDateTimeSchema,
  ruleId: idSchema.nullable(),
  ruleVersion: z.int().positive().nullable(),
  scannedCount: z.int().nonnegative(),
  window: z.object({
    limit: z.literal(200),
    newestReceivedAt: isoDateTimeSchema.nullable(),
    oldestReceivedAt: isoDateTimeSchema.nullable(),
    truncated: z.boolean(),
  }),
});
export type MailRulePreview = z.infer<typeof mailRulePreviewSchema>;

export const activateMailRuleInputSchema = z.object({
  expectedCandidateIds: z.array(idSchema).max(200),
  expectedPreviewFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  expectedPreviewedAt: isoDateTimeSchema,
  expectedVersion: z.int().positive(),
});
export type ActivateMailRuleInput = z.infer<typeof activateMailRuleInputSchema>;

export const upsertMailAttentionItemInputSchema = z.object({
  expiresAt: isoDateTimeSchema.nullable().default(null),
  importance: attentionItemImportanceSchema.default("high"),
  kind: attentionItemKindSchema
    .extract(["important", "upcoming", "follow_up"])
    .default("important"),
  occursAt: isoDateTimeSchema.nullable().default(null),
  summary: z.string().trim().min(1).max(4_000),
  title: z.string().trim().min(1).max(240),
});
export type UpsertMailAttentionItemInput = z.infer<typeof upsertMailAttentionItemInputSchema>;

type MailRuleMatchMaterial = Pick<MailThread, "from" | "snippet" | "subject">;

export function matchesMailRule(
  condition: MailRuleCondition,
  material: MailRuleMatchMaterial,
): boolean {
  const candidates =
    condition.field === "any"
      ? [material.subject, material.snippet, material.from.address, material.from.name ?? ""]
      : condition.field === "sender"
        ? [material.from.address, material.from.name ?? ""]
        : [material[condition.field]];
  const expected = condition.value.toLocaleLowerCase();
  return candidates.some((candidate) => {
    const value = candidate.toLocaleLowerCase();
    if (condition.operator === "equals") return value === expected;
    if (condition.operator === "ends_with") return value.endsWith(expected);
    return value.includes(expected);
  });
}

export function mailRuleActionIsDue(
  action: MailRuleAction,
  receivedAt: string | Date,
  current: Date,
): boolean {
  const received = typeof receivedAt === "string" ? new Date(receivedAt) : receivedAt;
  return current.getTime() - received.getTime() >= action.afterDays * 86_400_000;
}

export const connectICloudInputSchema = z
  .object({
    appSpecificPassword: z.string().trim().min(1).max(128),
    calendar: z.boolean().default(true),
    email: z.email().transform((value) => value.toLowerCase()),
    mail: z.boolean().default(true),
  })
  .refine((value) => value.calendar || value.mail, {
    message: "Select at least one iCloud service",
  });
export type ConnectICloudInput = z.infer<typeof connectICloudInputSchema>;
