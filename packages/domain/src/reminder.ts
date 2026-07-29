import { z } from "zod";
import {
  attentionItemImportanceSchema,
  attentionItemKindSchema,
  domainPreferenceValueSchema,
  upsertDomainProfileInputSchema,
} from "./assistant.js";
import { idSchema, isoDateTimeSchema, paginationSchema, timeZoneSchema } from "./common.js";
import { materialSourceReferenceSchema } from "./feature-contracts.js";

export const reminderPrioritySchema = z.enum(["low", "medium", "high"]);
export const reminderTimeZoneSchema = timeZoneSchema.refine((value) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}, "Must be a valid IANA time zone");

export const reminderAutomaticActionSchema = z.enum([
  "create",
  "update",
  "complete",
  "reopen",
  "trash",
  "restore",
]);

/**
 * Canonical preference keys captured by the Reminders guided interview.
 * These preferences guide an agent, but API scopes and mutation policy remain
 * the authorization boundary.
 */
export const reminderProfilePreferencesSchema = z
  .object({
    preferredAutomaticActions: z.array(reminderAutomaticActionSchema).max(6),
    defaultCapture: z.enum(["anytime", "due_when_stated", "ask_for_due_time"]),
    dueAtMeaning: z.enum(["deadline", "notification_time", "ask_when_ambiguous"]),
    notificationLeadMinutes: z.union([
      z
        .number()
        .int()
        .min(0)
        .max(365 * 24 * 60),
      z.literal("none"),
    ]),
    overdueBehavior: z.enum(["keep_due_date", "review", "propose_deferral"]),
    overdueReviewAfterDays: z.number().int().min(0).max(365),
    priorityHighMeaning: z.string().trim().min(1).max(500),
    priorityLowMeaning: z.string().trim().min(1).max(500),
    priorityMediumMeaning: z.string().trim().min(1).max(500),
    preferredMutationPolicy: z.enum(["read_only", "preview", "approve_each"]),
    reviewPriorityAtOrAbove: z.enum(["low", "medium", "high", "none"]),
    timezoneBehavior: z.enum(["profile_default", "preserve_explicit", "ask_when_ambiguous"]),
  })
  .catchall(domainPreferenceValueSchema);
export type ReminderProfilePreferences = z.infer<typeof reminderProfilePreferencesSchema>;
export const reminderDraftProfilePreferencesSchema = reminderProfilePreferencesSchema.partial();

const reminderProfileInputSchema = upsertDomainProfileInputSchema.extend({
  domain: z.literal("reminders"),
});

export const upsertReminderProfileInputSchema = z.discriminatedUnion("status", [
  reminderProfileInputSchema.extend({
    preferences: reminderDraftProfilePreferencesSchema,
    status: z.literal("draft"),
  }),
  reminderProfileInputSchema.extend({
    preferences: reminderProfilePreferencesSchema,
    status: z.literal("active"),
  }),
]);
export type UpsertReminderProfileInput = z.infer<typeof upsertReminderProfileInputSchema>;

const reminderFieldsSchema = z.object({
  title: z.string().trim().min(1).max(240),
  notes: z.string().trim().max(10_000).nullable().default(null),
  dueAt: isoDateTimeSchema.nullable().default(null),
  timezone: reminderTimeZoneSchema.nullable().default(null),
  priority: reminderPrioritySchema.default("medium"),
});

export const createReminderInputSchema = reminderFieldsSchema;
export type CreateReminderInput = z.infer<typeof createReminderInputSchema>;

export const updateReminderInputSchema = z
  .object({
    expectedUpdatedAt: isoDateTimeSchema.optional(),
    title: z.string().trim().min(1).max(240).optional(),
    notes: z.string().trim().max(10_000).nullable().optional(),
    dueAt: isoDateTimeSchema.nullable().optional(),
    timezone: reminderTimeZoneSchema.nullable().optional(),
    priority: reminderPrioritySchema.optional(),
  })
  .refine(
    (value) => Object.keys(value).some((key) => key !== "expectedUpdatedAt"),
    "At least one reminder field is required",
  );
export type UpdateReminderInput = z.infer<typeof updateReminderInputSchema>;

export const reminderRevisionInputSchema = z.object({
  expectedUpdatedAt: isoDateTimeSchema.optional(),
});
export type ReminderRevisionInput = z.infer<typeof reminderRevisionInputSchema>;

export const completeReminderInputSchema = reminderRevisionInputSchema.extend({
  completed: z.boolean().default(true),
});
export type CompleteReminderInput = z.infer<typeof completeReminderInputSchema>;

export const reminderSchema = reminderFieldsSchema.extend({
  id: idSchema,
  completedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  source: materialSourceReferenceSchema,
  updatedAt: isoDateTimeSchema,
});
export type Reminder = z.infer<typeof reminderSchema>;

export const reminderDeferralPreviewInputSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(100),
    overdueBefore: isoDateTimeSchema,
    priority: reminderPrioritySchema.optional(),
    proposedDueAt: isoDateTimeSchema,
    timezone: reminderTimeZoneSchema.nullable().default(null),
  })
  .superRefine((input, context) => {
    if (new Date(input.proposedDueAt).getTime() <= new Date(input.overdueBefore).getTime()) {
      context.addIssue({
        code: "custom",
        message: "The proposed due time must be later than the overdue cutoff.",
        path: ["proposedDueAt"],
      });
    }
  });
export type ReminderDeferralPreviewInput = z.infer<typeof reminderDeferralPreviewInputSchema>;

export const reminderDeferralCandidateSchema = reminderSchema
  .pick({
    dueAt: true,
    id: true,
    priority: true,
    source: true,
    title: true,
    updatedAt: true,
  })
  .extend({
    dueAt: isoDateTimeSchema,
    proposedDueAt: isoDateTimeSchema,
    proposedTimezone: reminderTimeZoneSchema.nullable(),
  });
export type ReminderDeferralCandidate = z.infer<typeof reminderDeferralCandidateSchema>;

export const reminderDeferralPreviewSchema = z.object({
  candidates: z.array(reminderDeferralCandidateSchema).max(100),
  matchedCount: z.number().int().min(0).max(100),
  policy: z.literal("preview"),
  previewedAt: isoDateTimeSchema,
});
export type ReminderDeferralPreview = z.infer<typeof reminderDeferralPreviewSchema>;

export const reminderListQuerySchema = paginationSchema
  .extend({
    completed: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .optional(),
    dueBefore: isoDateTimeSchema.optional(),
    dueAfter: isoDateTimeSchema.optional(),
    query: z.string().trim().min(1).max(200).optional(),
  })
  .superRefine((input, context) => {
    if (
      input.dueAfter &&
      input.dueBefore &&
      new Date(input.dueAfter).getTime() > new Date(input.dueBefore).getTime()
    ) {
      context.addIssue({
        code: "custom",
        message: "dueAfter must not be later than dueBefore.",
        path: ["dueAfter"],
      });
    }
  });
export type ReminderListQuery = z.infer<typeof reminderListQuerySchema>;

export const upsertReminderAttentionItemInputSchema = z.object({
  expiresAt: isoDateTimeSchema.nullable().default(null),
  importance: attentionItemImportanceSchema.default("high"),
  kind: attentionItemKindSchema
    .extract(["important", "upcoming", "follow_up"])
    .default("follow_up"),
  occursAt: isoDateTimeSchema.nullable().default(null),
  summary: z.string().trim().min(1).max(4_000),
  title: z.string().trim().min(1).max(240),
});
export type UpsertReminderAttentionItemInput = z.infer<
  typeof upsertReminderAttentionItemInputSchema
>;
