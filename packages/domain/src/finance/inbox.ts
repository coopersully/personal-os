import { z } from "zod";
import { idSchema, isoDateTimeSchema } from "../common.js";
import { financePositiveMoneySchema } from "./common.js";

export const financeReviewReasonSchema = z.enum([
  "merchant_identity",
  "category_ambiguity",
  "possible_duplicate",
  "possible_transfer",
  "reimbursement",
  "refund_or_reversal",
  "unusual_amount",
  "missing_provenance",
  "source_freshness",
  "recurring_status",
  "budget_variance",
  "profile_fact",
]);
export type FinanceReviewReason = z.infer<typeof financeReviewReasonSchema>;

export const financeInboxCaseSchema = z.object({
  economicEventId: idSchema,
  evidence: z.record(z.string(), z.unknown()),
  firstSeenAt: isoDateTimeSchema,
  id: idSchema,
  impactAmount: financePositiveMoneySchema,
  lastSeenAt: isoDateTimeSchema,
  proposedResolution: z.record(z.string(), z.unknown()).nullable(),
  reason: financeReviewReasonSchema,
  reopenedFromId: idSchema.nullable(),
  resolution: z.record(z.string(), z.unknown()).nullable().optional(),
  resolvedAt: isoDateTimeSchema.nullable(),
  stableKey: z.string().trim().min(1).max(500),
  status: z.enum(["open", "deferred", "resolved"]),
});
export type FinanceInboxCase = z.infer<typeof financeInboxCaseSchema>;

export const financeReviewResolutionSchema = z.discriminatedUnion("type", [
  z.object({ categoryId: idSchema, type: z.literal("confirm_classification") }),
  z.object({
    categoryId: idSchema,
    meaning: z.string().trim().min(1).max(500),
    type: z.literal("classify_transaction"),
  }),
  z.object({
    relatedTransactionId: idSchema,
    relationship: z.enum(["transfer", "reimbursement", "refund", "reversal", "duplicate"]),
    type: z.literal("link_transactions"),
  }),
  z.object({
    changes: z.record(z.string(), z.unknown()),
    type: z.literal("update_profile"),
  }),
  z.object({ rationale: z.string().trim().min(1).max(1_000), type: z.literal("dismiss") }),
  z.object({ clarification: z.string().trim().min(1).max(1_000), type: z.literal("clarify") }),
]);
export type FinanceReviewResolution = z.infer<typeof financeReviewResolutionSchema>;

export const answerFinanceReviewInputSchema = z.object({
  answer: z.string().trim().min(1).max(10_000),
  idempotencyKey: z.string().trim().min(1).max(200),
  resolution: financeReviewResolutionSchema,
});
export type AnswerFinanceReviewInput = z.infer<typeof answerFinanceReviewInputSchema>;
