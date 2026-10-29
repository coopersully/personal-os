import { z } from "zod";
import { idSchema, isoDateTimeSchema } from "../common.js";

const basis = {
  transactionId: idSchema,
  expectedTransactionUpdatedAt: isoDateTimeSchema,
  expectedTransactionRevision: z
    .string()
    .regex(/^[1-9][0-9]*$/)
    .max(19),
  rationale: z.string().trim().min(1).max(1_000),
  // An explanation of source evidence, not a confidence score or an assertion of verification.
  evidence: z.string().trim().min(1).max(4_000),
  confidence: z.number().min(0).max(1),
  learnMerchant: z.literal("never").default("never"),
};
export const financeReviewBatchDecisionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...basis,
    kind: z.literal("categorization"),
    categoryId: idSchema,
  }),
  z
    .strictObject({
      ...basis,
      kind: z.literal("review"),
      reviewId: idSchema,
      expectedReviewUpdatedAt: isoDateTimeSchema,
      expectedReviewRevision: z
        .string()
        .regex(/^[1-9][0-9]*$/)
        .max(19),
      expectedActionRevision: z
        .string()
        .regex(/^(0|[1-9][0-9]*)$/)
        .max(19),
      action: z.enum(["approve", "confirm_transfer", "defer", "recategorize"]),
      categoryId: idSchema.optional(),
      nonTransferDirection: z.enum(["expense", "income"]).optional(),
    })
    .superRefine((value, context) => {
      if (value.action === "recategorize" && !value.categoryId)
        context.addIssue({ code: "custom", message: "Choose a category.", path: ["categoryId"] });
    }),
]);
export type FinanceReviewBatchDecision = z.infer<typeof financeReviewBatchDecisionSchema>;
export const previewFinanceReviewBatchInputSchema = z
  .strictObject({
    idempotencyKey: z.string().trim().min(1).max(200),
    decisions: z.array(financeReviewBatchDecisionSchema).min(1).max(100),
  })
  .superRefine((value, context) => {
    const transactions = new Set<string>();
    const reviews = new Set<string>();
    value.decisions.forEach((decision, index) => {
      if (
        transactions.has(decision.transactionId) ||
        (decision.kind === "review" && reviews.has(decision.reviewId))
      )
        context.addIssue({
          code: "custom",
          message: "Include each transaction and review only once.",
          path: ["decisions", index],
        });
      transactions.add(decision.transactionId);
      if (decision.kind === "review") reviews.add(decision.reviewId);
    });
  });
export type PreviewFinanceReviewBatchInput = z.infer<typeof previewFinanceReviewBatchInputSchema>;
export const executeFinanceReviewBatchInputSchema = z.strictObject({
  fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  limit: z.number().int().min(1).max(10).default(10),
});
export type ExecuteFinanceReviewBatchInput = z.infer<typeof executeFinanceReviewBatchInputSchema>;
export const financeReviewBatchOutcomeSchema = z.object({
  index: z.number().int().min(0).max(99),
  transactionId: idSchema,
  status: z.enum(["applied", "deferred", "review_required", "failed"]),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
  recovery: z.enum(["none", "new_preview"]),
  completedAt: isoDateTimeSchema,
});
export type FinanceReviewBatchOutcome = z.infer<typeof financeReviewBatchOutcomeSchema>;
export const financeReviewBatchRunSchema = z.object({
  id: idSchema,
  fingerprint: z.string(),
  idempotencyKey: z.string(),
  decisions: z.array(financeReviewBatchDecisionSchema),
  outcomes: z.array(financeReviewBatchOutcomeSchema),
  status: z.enum(["previewed", "in_progress", "completed", "completed_with_exceptions"]),
  pendingCount: z.number().int().nonnegative(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type FinanceReviewBatchRun = z.infer<typeof financeReviewBatchRunSchema>;

export const listFinanceReviewBatchesInputSchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
