import { z } from "zod";
import { idSchema, isoDateTimeSchema, semanticVersionSchema } from "./common.js";
import { materialSourceReferenceSchema } from "./feature-contracts.js";

export const calendarMaintenanceScopeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("all_outstanding") }),
  z.object({ type: z.literal("window"), start: isoDateTimeSchema, end: isoDateTimeSchema }),
  z.object({
    type: z.literal("target"),
    entityType: z.enum([
      "event",
      "series",
      "invitation",
      "finding",
      "question",
      "proposal",
      "provider_effect",
      "maintenance_run",
    ]),
    id: idSchema,
  }),
]);
export type CalendarMaintenanceScope = z.infer<typeof calendarMaintenanceScopeSchema>;

export const createCalendarReviewInputSchema = z.object({
  scope: calendarMaintenanceScopeSchema.default({ type: "all_outstanding" }),
});
export type CreateCalendarReviewInput = z.infer<typeof createCalendarReviewInputSchema>;

export const calendarMaintenanceLifecycleSchema = z.enum([
  "never_maintained",
  "stale",
  "queued",
  "active",
  "maintained",
  "maintained_with_questions",
  "blocked",
  "failed",
]);
export type CalendarMaintenanceLifecycle = z.infer<typeof calendarMaintenanceLifecycleSchema>;

export const calendarHealthSignalSchema = z.enum(["healthy", "attention", "strained", "unknown"]);
export type CalendarHealthSignal = z.infer<typeof calendarHealthSignalSchema>;

export const calendarHealthDimensionSchema = z.enum([
  "source_trust",
  "hard_conflicts",
  "buffer_and_travel",
  "protected_time",
  "meeting_load",
  "out_of_hours",
  "breaks_and_recovery",
  "schedule_volatility",
]);
export type CalendarHealthDimension = z.infer<typeof calendarHealthDimensionSchema>;

export const calendarReviewStateSchema = z.enum([
  "maintained",
  "maintained_with_questions",
  "blocked",
]);
export type CalendarReviewState = z.infer<typeof calendarReviewStateSchema>;

export const calendarSourceFreshnessSchema = z.object({
  accountId: idSchema,
  calendarId: idSchema,
  completeness: z.enum(["complete", "partial", "unknown"]),
  evidenceCutoff: isoDateTimeSchema,
  lastSyncedAt: isoDateTimeSchema.nullable(),
  provider: z.enum(["google", "icloud", "local"]),
  readable: z.boolean(),
  reason: z.string().max(240).nullable(),
  recovery: z.enum(["automatic", "operator", "reconnect"]).nullable(),
  state: z.enum(["current", "stale", "unavailable"]),
  writable: z.boolean(),
});
export type CalendarSourceFreshness = z.infer<typeof calendarSourceFreshnessSchema>;

export const calendarFindingKindSchema = z.enum([
  "source_stale",
  "source_unavailable",
  "recurrence_unassessed",
  "event_overlap",
  "buffer_shortfall",
  "tentative_hold",
]);
export type CalendarFindingKind = z.infer<typeof calendarFindingKindSchema>;
export const calendarFindingSeveritySchema = z.enum(["info", "attention", "strained"]);
export type CalendarFindingSeverity = z.infer<typeof calendarFindingSeveritySchema>;
export const calendarFindingStatusSchema = z.enum(["open", "resolved"]);
export type CalendarFindingStatus = z.infer<typeof calendarFindingStatusSchema>;
export const calendarFindingEvidenceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("source"), accountId: idSchema, calendarId: idSchema }),
  z.object({
    type: z.literal("event"),
    eventId: idSchema,
    startsAt: isoDateTimeSchema,
    endsAt: isoDateTimeSchema,
    revision: z.string().min(1),
  }),
  z.object({
    type: z.literal("event_pair"),
    eventIds: z.tuple([idSchema, idSchema]),
    startsAt: isoDateTimeSchema,
    endsAt: isoDateTimeSchema,
    minutes: z.number().int().min(0),
    revisions: z.tuple([z.string().min(1), z.string().min(1)]),
  }),
]);
export type CalendarFindingEvidence = z.infer<typeof calendarFindingEvidenceSchema>;

export const calendarFindingSchema = z.object({
  evidence: calendarFindingEvidenceSchema,
  evidenceCutoff: isoDateTimeSchema,
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  firstObservedAt: isoDateTimeSchema,
  id: idSchema,
  kind: calendarFindingKindSchema,
  lastObservedAt: isoDateTimeSchema,
  playbookVersion: semanticVersionSchema,
  resolvedAt: isoDateTimeSchema.nullable(),
  rulebookVersion: z.string().min(1).max(160),
  severity: calendarFindingSeveritySchema,
  sourceReferences: z.array(materialSourceReferenceSchema),
  status: calendarFindingStatusSchema,
  summary: z.string().min(1).max(500),
});
export type CalendarFinding = z.infer<typeof calendarFindingSchema>;

export const calendarHealthAssessmentSchema = z.object({
  dimension: calendarHealthDimensionSchema,
  evidenceFindingIds: z.array(idSchema),
  signal: calendarHealthSignalSchema,
  summary: z.string().min(1).max(500),
});
export type CalendarHealthAssessment = z.infer<typeof calendarHealthAssessmentSchema>;

export const calendarRecommendationSchema = z.object({
  assumptions: z.array(z.string().max(240)),
  confidence: z.enum(["low", "medium", "high"]),
  findingIds: z.array(idSchema),
  horizon: z.object({ start: isoDateTimeSchema, end: isoDateTimeSchema }),
  key: z.string().min(1).max(100),
  summary: z.string().min(1).max(500),
  tradeoffs: z.array(z.string().max(240)),
});
export type CalendarRecommendation = z.infer<typeof calendarRecommendationSchema>;

export const calendarReviewSchema = z.object({
  createdAt: isoDateTimeSchema,
  evidenceCutoff: isoDateTimeSchema,
  findings: z.array(calendarFindingSchema),
  health: z.array(calendarHealthAssessmentSchema),
  id: idSchema,
  ledgerFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  nextMaintenanceAt: isoDateTimeSchema,
  playbookVersion: semanticVersionSchema,
  profileVersion: z.number().int().positive().nullable(),
  recommendations: z.array(calendarRecommendationSchema),
  rulebookVersion: z.string().min(1).max(160),
  scope: calendarMaintenanceScopeSchema,
  scopeEnd: isoDateTimeSchema,
  scopeStart: isoDateTimeSchema,
  sourceFreshness: z.array(calendarSourceFreshnessSchema),
  state: calendarReviewStateSchema,
});
export type CalendarReview = z.infer<typeof calendarReviewSchema>;

export const calendarStewardshipOperationSchema = z.enum([
  "inspect",
  "assess",
  "create_event",
  "move_event",
  "resize_event",
  "trash_event",
  "restore_event",
  "rsvp",
  "invite",
  "cancel_attended_event",
  "book_travel",
  "send_correspondence",
]);

export const calendarStatusSchema = z
  .object({
    asOf: isoDateTimeSchema,
    authority: z.object({
      approvedRule: z.array(calendarStewardshipOperationSchema),
      automatic: z.array(calendarStewardshipOperationSchema),
      individualApproval: z.array(calendarStewardshipOperationSchema),
      unavailable: z.array(calendarStewardshipOperationSchema),
    }),
    backlog: z.object({
      actionable: z.number().int().min(0).nullable(),
      ambiguousEffects: z.number().int().min(0).nullable(),
      awaitingApproval: z.number().int().min(0).nullable(),
      awaitingInput: z.number().int().min(0).nullable(),
      blocked: z.number().int().min(0),
      failed: z.number().int().min(0).nullable(),
      openFindings: z.number().int().min(0).nullable(),
    }),
    health: z.array(calendarHealthAssessmentSchema),
    latestReview: calendarReviewSchema.nullable(),
    lifecycle: calendarMaintenanceLifecycleSchema,
    readiness: z.enum(["setup_required", "ready", "degraded"]),
    setupBlockers: z.array(z.string().max(240)),
    sources: z.array(calendarSourceFreshnessSchema),
    validNextOperations: z.array(z.enum(["assess_calendar", "open_connections", "review_findings"])),
  })
  .superRefine((status, context) => {
    const sourceTrust = status.health.find(({ dimension }) => dimension === "source_trust");
    if (status.sources.some(({ state }) => state !== "current") && sourceTrust?.signal === "healthy") {
      context.addIssue({
        code: "custom",
        message: "Unavailable or stale sources cannot be healthy.",
        path: ["health"],
      });
    }
    if (
      status.lifecycle === "maintained" &&
      status.sources.some(({ completeness, state }) => state !== "current" || completeness !== "complete")
    ) {
      context.addIssue({
        code: "custom",
        message: "Maintained status requires current complete sources.",
        path: ["lifecycle"],
      });
    }
  });
export type CalendarStatus = z.infer<typeof calendarStatusSchema>;
