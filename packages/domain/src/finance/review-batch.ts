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
export const financeTransferPairDecisionSchema = z
  .strictObject({
    ...basis,
    kind: z.literal("transfer_pair"),
    counterpartTransactionId: idSchema,
    expectedCounterpartUpdatedAt: isoDateTimeSchema,
    expectedCounterpartRevision: basis.expectedTransactionRevision,
  })
  .refine(
    (value) => value.transactionId !== value.counterpartTransactionId,
    "Choose two distinct transactions.",
  );
export type FinanceTransferPairDecision = z.infer<typeof financeTransferPairDecisionSchema>;
export const financeReviewBatchDecisionSchema = z.discriminatedUnion("kind", [
  financeTransferPairDecisionSchema,
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
function uniqueDecisions(
  value: { decisions: FinanceReviewBatchDecision[] },
  context: z.RefinementCtx,
) {
  const transactions = new Set<string>();
  const reviews = new Set<string>();
  value.decisions.forEach((decision, index) => {
    if (
      transactions.has(decision.transactionId) ||
      (decision.kind === "transfer_pair" && transactions.has(decision.counterpartTransactionId)) ||
      (decision.kind === "review" && reviews.has(decision.reviewId))
    )
      context.addIssue({
        code: "custom",
        message: "Include each transaction and review only once.",
        path: ["decisions", index],
      });
    transactions.add(decision.transactionId);
    if (decision.kind === "transfer_pair") transactions.add(decision.counterpartTransactionId);
    if (decision.kind === "review") reviews.add(decision.reviewId);
  });
}
export const previewFinanceReviewBatchInputSchema = z
  .strictObject({
    idempotencyKey: z.string().trim().min(1).max(200),
    decisions: z.array(financeReviewBatchDecisionSchema).min(1).max(100),
  })
  .superRefine(uniqueDecisions);

/** Read-only qualification of supplied decisions, never a preview or effect capability. */
export const qualifyFinanceMaintenanceWorkInputSchema = z
  .strictObject({
    decisions: z.array(financeReviewBatchDecisionSchema).min(1).max(25),
  })
  .superRefine(uniqueDecisions);
export type QualifyFinanceMaintenanceWorkInput = z.infer<
  typeof qualifyFinanceMaintenanceWorkInputSchema
>;
export const financeMaintenanceQualificationSchema = z.strictObject({
  asOf: isoDateTimeSchema,
  advisoryOnly: z.literal(true),
  previewRequired: z.literal(true),
  executionRevalidationRequired: z.literal(true),
  items: z
    .array(
      z.strictObject({
        index: z.number().int().min(0).max(24),
        transactionId: idSchema,
        state: z.enum([
          "eligible",
          "awaiting_evidence",
          "awaiting_approval",
          "source_blocked",
          "authorization_denied",
        ]),
        reasons: z.array(
          z.enum([
            "source_unavailable",
            "source_not_current",
            "decision_evidence_not_qualified",
            "stale_decision",
            "counterpart_evidence_limit",
            "counterpart_source_not_current",
            "execution_not_authorized",
            "approval_required",
          ]),
        ),
        sourceRefs: z
          .array(
            z.strictObject({
              transactionId: idSchema,
              transactionRevision: z
                .string()
                .regex(/^[1-9][0-9]*$/)
                .max(19),
              accountId: idSchema,
              accountRevision: z
                .string()
                .regex(/^[1-9][0-9]*$/)
                .max(19),
              providerItemId: idSchema.nullable(),
              providerItemUpdatedAt: isoDateTimeSchema.nullable(),
            }),
          )
          .max(2),
      }),
    )
    .max(25),
});
export type FinanceMaintenanceQualification = z.infer<typeof financeMaintenanceQualificationSchema>;
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
  appliedTransferRevision: basis.expectedTransactionRevision.optional(),
  undoAvailable: z.boolean().optional(),
});
export type FinanceReviewBatchOutcome = z.infer<typeof financeReviewBatchOutcomeSchema>;
export const financeReviewBatchCounterpartSchema = z.strictObject({
  transactionId: idSchema,
  revision: basis.expectedTransactionRevision,
});

export const financeReviewBatchRunSchema = z.object({
  id: idSchema,
  fingerprint: z.string(),
  idempotencyKey: z.string(),
  decisions: z.array(financeReviewBatchDecisionSchema),
  transferCounterparts: z
    .array(financeReviewBatchCounterpartSchema.extend({ index: z.number().int().min(0).max(99) }))
    .default([]),
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

export const previewFinanceReviewBatchUndoInputSchema = z.strictObject({
  batchId: idSchema,
  outcomeIndexes: z
    .array(z.number().int().min(0).max(99))
    .min(1)
    .max(10)
    .refine((values) => new Set(values).size === values.length, "Include each effect once."),
  idempotencyKey: z.string().trim().min(1).max(200),
});
export const financeReviewBatchUndoSchema = z.strictObject({
  id: idSchema,
  batchId: idSchema,
  fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  outcomeIndexes: z.array(z.number().int().min(0).max(99)),
  outcomes: z.array(financeReviewBatchOutcomeSchema),
  pendingCount: z.number().int().nonnegative(),
  status: z.enum(["previewed", "in_progress", "completed", "completed_with_exceptions"]),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type FinanceReviewBatchUndo = z.infer<typeof financeReviewBatchUndoSchema>;

export type PreviewFinanceReviewBatchUndoInput = z.infer<
  typeof previewFinanceReviewBatchUndoInputSchema
>;
