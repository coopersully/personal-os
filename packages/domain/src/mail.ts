import { z } from "zod";
import { configuredRuleBaseSchema } from "./assistant.js";
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

export const mailAddressSchema = z.object({
  address: z.string(),
  name: z.string().nullable(),
});
export type MailAddress = z.infer<typeof mailAddressSchema>;

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
    mailboxIds: z.array(idSchema).max(100).optional(),
    starred: z.boolean().optional(),
    unread: z.boolean().optional(),
  })
  .refine((input) => Object.values(input).some((value) => value !== undefined), {
    message: "Provide at least one mail change.",
  });
export type UpdateMailThreadInput = z.infer<typeof updateMailThreadInputSchema>;

export const mailDraftInputSchema = z.object({
  accountId: idSchema,
  body: z.string().max(100_000),
  cc: z.array(mailAddressSchema).max(100).default([]),
  subject: z.string().max(998),
  threadId: idSchema.optional(),
  to: z.array(mailAddressSchema).min(1).max(100),
});
export type MailDraftInput = z.infer<typeof mailDraftInputSchema>;

export const sendMailInputSchema = mailDraftInputSchema.extend({ draftId: idSchema.optional() });
export type SendMailInput = z.infer<typeof sendMailInputSchema>;

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

export const createMailRuleInputSchema = mailRuleSchema
  .pick({
    actions: true,
    condition: true,
    confidenceThreshold: true,
    description: true,
    enabled: true,
    name: true,
    policy: true,
    profileId: true,
    sourceIds: true,
  })
  .extend({
    confidenceThreshold: z.number().min(0).max(1).nullable().default(null),
    description: z.string().max(2_000).default(""),
    enabled: z.boolean().default(false),
    policy: z.enum(["preview", "approve_each", "approved_rule"]).default("preview"),
    profileId: idSchema.nullable().default(null),
    sourceIds: z.array(idSchema).max(50).default([]),
  });
export type CreateMailRuleInput = z.infer<typeof createMailRuleInputSchema>;

export const updateMailRuleInputSchema = createMailRuleInputSchema
  .partial()
  .extend({ expectedVersion: z.int().positive() })
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
