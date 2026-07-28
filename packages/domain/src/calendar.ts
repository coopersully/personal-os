import { z } from "zod";
import { idSchema, isoDateTimeSchema, timeZoneSchema } from "./common.js";
import { agentMutationPolicies, materialSourceReferenceSchema } from "./feature-contracts.js";

export const calendarProviderSchema = z.enum(["local", "google", "icloud"]);
export type CalendarProvider = z.infer<typeof calendarProviderSchema>;

export const calendarSchema = z.object({
  id: idSchema,
  accountId: idSchema,
  provider: calendarProviderSchema,
  name: z.string(),
  color: z.string().nullable(),
  timezone: timeZoneSchema,
  isPrimary: z.boolean(),
  isSelected: z.boolean(),
  isWritable: z.boolean(),
  lastSyncedAt: isoDateTimeSchema.nullable(),
  source: z
    .object({
      accountLabel: z.string().min(1),
      remoteCalendarId: z.string().nullable(),
      syncError: z.string().nullable(),
      syncStatus: z.enum(["idle", "syncing", "error"]),
    })
    .optional(),
});
export type Calendar = z.infer<typeof calendarSchema>;

export const createLocalCalendarInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .default(null),
  timezone: timeZoneSchema,
});
export type CreateLocalCalendarInput = z.infer<typeof createLocalCalendarInputSchema>;

export const updateLocalCalendarInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .nullable()
      .optional(),
    timezone: timeZoneSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "At least one calendar field is required");
export type UpdateLocalCalendarInput = z.infer<typeof updateLocalCalendarInputSchema>;

const eventFieldsSchema = z.object({
  title: z.string().trim().min(1).max(500),
  notes: z.string().trim().max(50_000).nullable().default(null),
  location: z.string().trim().max(1_000).nullable().default(null),
  startsAt: isoDateTimeSchema,
  endsAt: isoDateTimeSchema,
  timezone: timeZoneSchema,
  allDay: z.boolean().default(false),
  eventType: z.enum(["default", "focus", "out_of_office"]).default("default"),
  transparency: z.enum(["busy", "free"]).default("busy"),
  visibility: z.enum(["default", "private", "public"]).default("default"),
  recurrence: z.array(z.string().min(1).max(500)).max(20).default([]),
  reminders: z
    .array(z.object({ minutes: z.number().int().min(0).max(40_320) }))
    .max(10)
    .default([]),
  attendees: z
    .array(
      z.object({
        email: z.email(),
        name: z.string().nullable().default(null),
        response: z
          .enum(["needs_action", "accepted", "declined", "tentative"])
          .default("needs_action"),
        isOrganizer: z.boolean().default(false),
      }),
    )
    .max(200)
    .default([]),
});

export const createEventInputSchema = eventFieldsSchema
  .extend({
    calendarId: idSchema,
  })
  .refine((value) => new Date(value.endsAt) > new Date(value.startsAt), {
    message: "Event end must be after its start",
    path: ["endsAt"],
  });
/** Callers may omit defaulted event semantics; API parsing supplies the defaults. */
export type CreateEventInput = z.input<typeof createEventInputSchema>;

export const updateEventInputSchema = z
  .object({
    title: z.string().trim().min(1).max(500).optional(),
    notes: z.string().trim().max(50_000).nullable().optional(),
    location: z.string().trim().max(1_000).nullable().optional(),
    startsAt: isoDateTimeSchema.optional(),
    endsAt: isoDateTimeSchema.optional(),
    timezone: timeZoneSchema.optional(),
    allDay: z.boolean().optional(),
    eventType: z.enum(["default", "focus", "out_of_office"]).optional(),
    transparency: z.enum(["busy", "free"]).optional(),
    visibility: z.enum(["default", "private", "public"]).optional(),
    recurrence: z.array(z.string().min(1).max(500)).max(20).optional(),
    reminders: z
      .array(z.object({ minutes: z.number().int().min(0).max(40_320) }))
      .max(10)
      .optional(),
    attendees: z
      .array(
        z.object({
          email: z.email(),
          name: z.string().nullable().default(null),
          response: z
            .enum(["needs_action", "accepted", "declined", "tentative"])
            .default("needs_action"),
          isOrganizer: z.boolean().default(false),
        }),
      )
      .max(200)
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "At least one event field is required")
  .refine(
    (value) =>
      !value.startsAt || !value.endsAt || new Date(value.endsAt) > new Date(value.startsAt),
    { message: "Event end must be after its start", path: ["endsAt"] },
  );
export type UpdateEventInput = z.input<typeof updateEventInputSchema>;

export const calendarEventStatusSchema = z.enum(["confirmed", "tentative", "cancelled"]);
export const eventBlockModeSchema = z.enum(["busy", "details"]);
export type EventBlockMode = z.infer<typeof eventBlockModeSchema>;

export const createEventBlockInputSchema = z.object({
  calendarId: idSchema,
  mode: eventBlockModeSchema.default("busy"),
});
export type CreateEventBlockInput = z.infer<typeof createEventBlockInputSchema>;

export const updateEventBlockInputSchema = z.object({ mode: eventBlockModeSchema });
export type UpdateEventBlockInput = z.infer<typeof updateEventBlockInputSchema>;

export const calendarEventBlockSchema = z.object({
  calendarId: idSchema,
  eventId: idSchema,
  mode: eventBlockModeSchema,
  provider: calendarProviderSchema,
});
export type CalendarEventBlock = z.infer<typeof calendarEventBlockSchema>;

export const calendarEventSchema = eventFieldsSchema
  .extend({
    id: idSchema,
    calendarId: idSchema,
    conferenceUrl: z.url().nullable().default(null),
    provider: calendarProviderSchema,
    blockSourceEventId: idSchema.nullable().default(null),
    blockMode: eventBlockModeSchema.nullable().default(null),
    blocks: z.array(calendarEventBlockSchema).default([]),
    remoteEventId: z.string().nullable(),
    source: materialSourceReferenceSchema.optional(),
    status: calendarEventStatusSchema,
    recurrence: z.array(z.string()),
    eventType: z.enum(["default", "focus", "out_of_office"]).optional(),
    transparency: z.enum(["busy", "free"]).optional(),
    visibility: z.enum(["default", "private", "public"]).optional(),
    reminders: z.array(z.object({ minutes: z.number().int() })).optional(),
    attendees: z
      .array(
        z.object({
          email: z.email(),
          name: z.string().nullable().default(null),
          response: z.enum(["needs_action", "accepted", "declined", "tentative"]),
          isOrganizer: z.boolean(),
        }),
      )
      .optional(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .refine((value) => new Date(value.endsAt) > new Date(value.startsAt), {
    message: "Event end must be after its start",
    path: ["endsAt"],
  });
export type CalendarEvent = z.infer<typeof calendarEventSchema>;

export const calendarCommitmentEvidenceKindSchema = z.enum([
  "ticket",
  "booking",
  "registration",
  "explicit_acceptance",
  "other",
]);
export type CalendarCommitmentEvidenceKind = z.infer<typeof calendarCommitmentEvidenceKindSchema>;
export const calendarAutomaticEvidenceKindSchema = z.enum([
  "ticket",
  "booking",
  "registration",
  "explicit_acceptance",
]);

export const calendarCommitmentFlexibilitySchema = z.enum(["hard", "flexible"]);
export type CalendarCommitmentFlexibility = z.infer<typeof calendarCommitmentFlexibilitySchema>;

export const calendarProfilePreferencesSchema = z.object({
  afterBufferMinutes: z.number().int().min(0).max(1_440),
  automaticEventCreation: z.boolean(),
  automaticEventEvidence: z.array(calendarAutomaticEvidenceKindSchema).max(4),
  beforeBufferMinutes: z.number().int().min(0).max(1_440),
  busyBlockPrivacy: z.enum(["busy", "details"]),
  defaultCalendarId: idSchema,
  defaultTimezone: timeZoneSchema,
});
export type CalendarProfilePreferences = z.infer<typeof calendarProfilePreferencesSchema>;

export const calendarCommitmentCandidateSchema = eventFieldsSchema
  .pick({
    allDay: true,
    endsAt: true,
    location: true,
    notes: true,
    startsAt: true,
    timezone: true,
    title: true,
    visibility: true,
  })
  .extend({
    buffer: z
      .object({
        afterMinutes: z.number().int().min(0).max(1_440),
        beforeMinutes: z.number().int().min(0).max(1_440),
      })
      .default({ afterMinutes: 0, beforeMinutes: 0 })
      .describe("Requested buffers shown in preview; this contract does not create them"),
    calendarId: idSchema.describe("Owned Calendar destination identifier"),
    evidence: z.object({
      kind: calendarCommitmentEvidenceKindSchema.describe(
        "Caller classification; it is not verified evidence authority",
      ),
      source: materialSourceReferenceSchema,
      summary: z.string().trim().min(1).max(1_000),
    }),
    flexibility: calendarCommitmentFlexibilitySchema.describe(
      "Hard commitments are never silently rearranged; flexible remains proposal-only",
    ),
  })
  .refine((value) => new Date(value.endsAt) > new Date(value.startsAt), {
    message: "Commitment end must be after its start",
    path: ["endsAt"],
  });
export type CalendarCommitmentCandidate = z.infer<typeof calendarCommitmentCandidateSchema>;

export const previewCalendarCommitmentInputSchema = z.object({
  candidate: calendarCommitmentCandidateSchema,
  expectedProfileVersion: z.number().int().positive().nullable().default(null),
  profileId: idSchema.nullable().default(null),
  requestedPolicy: z.enum(agentMutationPolicies).default("preview"),
});
export type PreviewCalendarCommitmentInput = z.input<typeof previewCalendarCommitmentInputSchema>;
export type ParsedPreviewCalendarCommitmentInput = z.output<
  typeof previewCalendarCommitmentInputSchema
>;

export const calendarCommitmentPolicyDecisionSchema = z.object({
  canApply: z.boolean(),
  effectivePolicy: z.enum(agentMutationPolicies),
  reasons: z.array(z.string().min(1)).max(20),
  requestedPolicy: z.enum(agentMutationPolicies),
  requiresInteractiveApproval: z.boolean(),
});
export type CalendarCommitmentPolicyDecision = z.infer<
  typeof calendarCommitmentPolicyDecisionSchema
>;

export const calendarCommitmentProposalSchema = z.object({
  authority: z.literal("caller_supplied_unverified"),
  candidate: calendarCommitmentCandidateSchema,
  destination: calendarSchema,
  possibleDuplicateEventId: idSchema.nullable(),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  policy: calendarCommitmentPolicyDecisionSchema,
  providerEffect: z.enum(["local_write", "provider_write"]),
  warnings: z.array(z.string().min(1)).max(20),
});
export type CalendarCommitmentProposal = z.infer<typeof calendarCommitmentProposalSchema>;

export const eventListQuerySchema = z.object({
  from: isoDateTimeSchema,
  to: isoDateTimeSchema,
  calendarIds: z
    .string()
    .transform((value) => value.split(",").filter(Boolean))
    .pipe(z.array(idSchema))
    .optional(),
  query: z.string().trim().min(1).max(200).optional(),
});
export type EventListQuery = z.infer<typeof eventListQuerySchema>;
