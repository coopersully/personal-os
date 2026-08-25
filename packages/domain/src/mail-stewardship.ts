import { z } from "zod";
import { idSchema, isoDateTimeSchema, semanticVersionSchema } from "./common.js";
import { materialSourceReferenceSchema } from "./feature-contracts.js";
import {
  maintenanceRunSchema,
  maintenanceVerificationSchema,
  workspaceStatusSchema,
} from "./maintenance.js";

export const mailObligationKindSchema = z.enum([
  "reply",
  "follow_up",
  "decide",
  "schedule",
  "record",
  "security_review",
]);
export const mailObligationStateSchema = z.enum([
  "open",
  "waiting",
  "deferred",
  "resolved",
  "dismissed",
]);
export const mailDispositionKindSchema = z.enum([
  "active",
  "deferred",
  "waiting",
  "delegated",
  "reference",
  "noise",
  "resolved",
]);
export const mailStewardshipFeedbackKindSchema = z.enum([
  "correct",
  "incorrect",
  "outdated",
  "exception",
]);
export const mailQuestionKindSchema = z.enum([
  "needs_disposition",
  "needs_owner",
  "needs_due_date",
  "needs_correction",
  "needs_exception",
]);

export type MailObligationKind = z.infer<typeof mailObligationKindSchema>;
export type MailObligationState = z.infer<typeof mailObligationStateSchema>;
export type MailDispositionKind = z.infer<typeof mailDispositionKindSchema>;
export type MailStewardshipFeedbackKind = z.infer<typeof mailStewardshipFeedbackKindSchema>;

const obligationOwnerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user") }),
  z.object({
    kind: z.literal("other"),
    relationshipRef: z.string().trim().min(1).max(240).nullable(),
  }),
]);

export const createMailObligationInputSchema = z.object({
  dueAt: isoDateTimeSchema.nullable().default(null),
  goalIds: z.array(idSchema).max(25).default([]),
  kind: mailObligationKindSchema,
  nextReviewAt: isoDateTimeSchema.nullable().default(null),
  owner: obligationOwnerSchema,
  rationale: z.string().trim().min(1).max(1_000),
  sourceMessageId: idSchema.nullable().default(null),
  sourceThreadRevision: isoDateTimeSchema,
});
export type CreateMailObligationInput = z.infer<typeof createMailObligationInputSchema>;

export const updateMailObligationInputSchema = z
  .object({
    dueAt: isoDateTimeSchema.nullable().optional(),
    expectedVersion: z.int().positive(),
    goalIds: z.array(idSchema).max(25).optional(),
    nextReviewAt: isoDateTimeSchema.nullable().optional(),
    owner: obligationOwnerSchema.optional(),
    rationale: z.string().trim().min(1).max(1_000).optional(),
    state: mailObligationStateSchema.optional(),
  })
  .refine(
    ({ dueAt, goalIds, nextReviewAt, owner, rationale, state }) =>
      dueAt !== undefined ||
      goalIds !== undefined ||
      nextReviewAt !== undefined ||
      owner !== undefined ||
      rationale !== undefined ||
      state !== undefined,
    "Provide one obligation change.",
  );
export type UpdateMailObligationInput = z.infer<typeof updateMailObligationInputSchema>;

export const setMailDispositionInputSchema = z.object({
  disposition: mailDispositionKindSchema,
  expectedThreadUpdatedAt: isoDateTimeSchema,
  rationale: z.string().trim().min(1).max(1_000),
});
export type SetMailDispositionInput = z.infer<typeof setMailDispositionInputSchema>;

export const answerMailQuestionInputSchema = z.object({
  answer: z.string().trim().min(1).max(2_000),
  expectedVersion: z.int().positive(),
  generalize: z.boolean().default(false),
});
export type AnswerMailQuestionInput = z.infer<typeof answerMailQuestionInputSchema>;

export const previewMailResponseBriefInputSchema = z.object({
  expectedThreadUpdatedAt: isoDateTimeSchema,
  purpose: z.string().trim().min(1).max(500),
  factsToAddress: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
  openQuestions: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
  toneConsiderations: z.array(z.string().trim().min(1).max(240)).max(10).default([]),
  materialsNeeded: z.array(z.string().trim().min(1).max(240)).max(20).default([]),
});
export type PreviewMailResponseBriefInput = z.infer<typeof previewMailResponseBriefInputSchema>;

export const mailResponseBriefSchema = previewMailResponseBriefInputSchema
  .omit({ expectedThreadUpdatedAt: true })
  .extend({
    evidence: z.array(materialSourceReferenceSchema).min(1).max(50),
    sourceThreadRevision: isoDateTimeSchema,
    transmittable: z.literal(false),
  });
export type MailResponseBrief = z.infer<typeof mailResponseBriefSchema>;

export const mailObligationSchema = createMailObligationInputSchema.extend({
  closureEvidence: z.array(materialSourceReferenceSchema).max(50),
  confidence: z.enum(["explicit", "confirmed", "inferred_candidate"]),
  createdAt: isoDateTimeSchema,
  id: idSchema,
  state: mailObligationStateSchema,
  threadId: idSchema,
  updatedAt: isoDateTimeSchema,
  version: z.int().positive(),
});
export type MailObligation = z.infer<typeof mailObligationSchema>;

export const mailDispositionSchema = z.object({
  createdAt: isoDateTimeSchema,
  current: z.boolean(),
  disposition: mailDispositionKindSchema,
  id: idSchema,
  rationale: z.string().trim().min(1).max(1_000),
  sourceThreadRevision: isoDateTimeSchema,
  threadId: idSchema,
  version: z.int().positive(),
});
export type MailDisposition = z.infer<typeof mailDispositionSchema>;

export const mailStewardshipQuestionSchema = z.object({
  accountId: idSchema,
  answer: z.string().max(2_000).nullable(),
  answeredAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  evidence: z.array(materialSourceReferenceSchema).min(1).max(50),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  id: idSchema,
  kind: mailQuestionKindSchema,
  options: z
    .array(z.object({ label: z.string().min(1).max(200), value: z.string().min(1).max(200) }))
    .max(10),
  reason: z.string().trim().min(1).max(1_000),
  status: z.enum(["open", "answered", "dismissed"]),
  threadId: idSchema,
  updatedAt: isoDateTimeSchema,
  version: z.int().positive(),
});
export type MailStewardshipQuestion = z.infer<typeof mailStewardshipQuestionSchema>;

export const mailRuleProposalSchema = z.object({
  approvedRuleId: idSchema.nullable(),
  counterexamples: z.array(z.string().max(500)).max(50),
  createdAt: isoDateTimeSchema,
  examples: z.array(z.string().max(500)).min(1).max(50),
  exceptions: z.array(z.string().max(500)).max(50),
  id: idSchema,
  rationale: z.string().min(1).max(1_000),
  status: z.enum(["proposed", "dismissed", "approved"]),
  updatedAt: isoDateTimeSchema,
  version: z.int().positive(),
});
export type MailRuleProposal = z.infer<typeof mailRuleProposalSchema>;

export const createMailStewardshipFeedbackInputSchema = z.object({
  comment: z.string().trim().min(1).max(2_000),
  kind: mailStewardshipFeedbackKindSchema,
  targetId: idSchema,
  targetType: z.enum(["obligation", "disposition", "question", "rule_proposal", "review"]),
});
export type CreateMailStewardshipFeedbackInput = z.infer<
  typeof createMailStewardshipFeedbackInputSchema
>;

export const mailStewardshipFeedbackSchema = createMailStewardshipFeedbackInputSchema.extend({
  createdAt: isoDateTimeSchema,
  evidence: z.array(materialSourceReferenceSchema).max(50),
  id: idSchema,
});
export type MailStewardshipFeedback = z.infer<typeof mailStewardshipFeedbackSchema>;

export const mailHealthDimensionSchema = z.object({
  dimension: z.enum([
    "source_trust",
    "obligation_integrity",
    "ambiguity",
    "provider_effects",
    "rule_quality",
  ]),
  evidenceIds: z.array(idSchema).max(100),
  signal: z.enum(["healthy", "attention", "strained", "unknown"]),
  summary: z.string().trim().min(1).max(500),
});
export type MailHealthDimension = z.infer<typeof mailHealthDimensionSchema>;

export const mailReviewSummarySchema = z.object({
  createdAt: isoDateTimeSchema,
  evidenceCutoff: isoDateTimeSchema,
  id: idSchema,
  ledgerFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  state: z.enum(["maintained", "maintained_with_questions", "blocked"]),
});

export const mailReviewSchema = mailReviewSummarySchema.extend({
  effectCounts: z.object({
    failed: z.int().nonnegative(),
    pending: z.int().nonnegative(),
    reconcile: z.int().nonnegative(),
  }),
  health: z.array(mailHealthDimensionSchema),
  nextMaintenanceAt: isoDateTimeSchema,
  obligationCounts: z.record(mailObligationStateSchema, z.int().nonnegative()),
  openQuestionCount: z.int().nonnegative(),
  playbookVersion: semanticVersionSchema,
  profileVersion: z.int().positive().nullable(),
  rulebookVersion: z.string().trim().min(1).max(200),
  sourceFreshness: z.enum(["current", "stale", "partial", "unavailable"]),
});
export type MailReview = z.infer<typeof mailReviewSchema>;

export const mailThreadStewardshipSchema = z.object({
  disposition: mailDispositionSchema.nullable(),
  obligations: z.array(mailObligationSchema),
  questions: z.array(mailStewardshipQuestionSchema),
  threadId: idSchema,
  threadUpdatedAt: isoDateTimeSchema,
});
export type MailThreadStewardship = z.infer<typeof mailThreadStewardshipSchema>;

export const mailStatusDetailsSchema = z.object({
  authority: z.object({
    automatic: z.array(z.string()),
    approvedRule: z.array(z.string()),
    individualApproval: z.array(z.string()),
    unavailable: z.array(z.string()),
  }),
  dispositionCounts: z.record(mailDispositionKindSchema, z.int().nonnegative()),
  effectCounts: z.object({
    pending: z.int().nonnegative(),
    reconcile: z.int().nonnegative(),
    failed: z.int().nonnegative(),
  }),
  health: z.array(mailHealthDimensionSchema),
  latestReview: mailReviewSummarySchema.nullable(),
  objective: z.object({
    mode: z.enum(["approved_profile", "default_obligation_integrity"]),
    profileId: idSchema.nullable(),
    profileVersion: z.int().positive().nullable(),
    summary: z.string().trim().min(1).max(1_000),
  }),
  obligationCounts: z.record(mailObligationStateSchema, z.int().nonnegative()),
  openQuestionCount: z.int().nonnegative(),
  playbookVersion: semanticVersionSchema,
  rulebookVersion: z.string().trim().min(1).max(200),
});

export const mailStatusSchema = workspaceStatusSchema(mailStatusDetailsSchema).superRefine(
  (status, context) => {
    if (
      status.state === "clean" &&
      (status.freshness.state !== "current" ||
        status.details.openQuestionCount > 0 ||
        Object.values(status.details.effectCounts).some((count) => count > 0))
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Clean Mail status requires current evidence and no material ambiguity or effects.",
        path: ["state"],
      });
    }
    if (
      status.details.objective.mode === "approved_profile" &&
      status.details.objective.profileId === null
    ) {
      context.addIssue({
        code: "custom",
        message: "An approved objective requires its profile.",
        path: ["details", "objective"],
      });
    }
  },
);
export type MailStatus = z.infer<typeof mailStatusSchema>;

export const mailMaintenanceDispatchResultSchema = z.object({
  run: maintenanceRunSchema,
  summary: z.string().trim().min(1).max(4_000),
  verification: maintenanceVerificationSchema.nullable(),
});
export type MailMaintenanceDispatchResult = z.infer<typeof mailMaintenanceDispatchResultSchema>;
