import { z } from "zod";
import { financeMonthSchema } from "./budget.js";

export const financeAttentionMonthSchema = financeMonthSchema;

/** API-owned assessment; unknown dependency never means safe to hide. */
export const financeAttentionRecordSchema = z.strictObject({
  id: z.string().min(1),
  transactionId: z.string().min(1).nullable(),
  source: z.enum(["transaction_flag", "review_case", "question", "approval", "dependency"]),
  date: z.string().nullable(),
  dependency: z.enum(["none", "affects_current", "unknown"]),
  decisionKey: z.string().min(1).nullable(),
  workState: z.enum(["needs_person", "processing", "technical_blocker"]),
});
export type FinanceAttentionRecord = z.infer<typeof financeAttentionRecordSchema>;

const projectionInputSchema = z
  .strictObject({
    firstMonth: financeAttentionMonthSchema.nullable(),
    period: financeAttentionMonthSchema,
    complete: z.boolean(),
    openingPositionQualified: z.boolean(),
    budgetApproved: z.boolean(),
    records: z.array(financeAttentionRecordSchema),
  })
  .superRefine(({ records }, context) => {
    const identities = new Set<string>();
    for (const [index, record] of records.entries()) {
      if (identities.has(record.id))
        context.addIssue({
          code: "custom",
          message: "Duplicate attention record identity.",
          path: ["records", index, "id"],
        });
      identities.add(record.id);
    }
  });

/** Pure projection of complete domain assessments, never an evidence/authority shortcut. */
export function projectFinanceAttention(input: z.input<typeof projectionInputSchema>) {
  const state = projectionInputSchema.parse(input);
  const decisions = new Set<string>();
  const approvals = new Set<string>();
  const transactions = new Set<string>();
  const dependencyRefs: string[] = [];
  const rawCounts = { transactionFlags: 0, reviewCases: 0, questions: 0, approvals: 0 };
  let historicalRecordCount = 0;
  let futureRecordCount = 0;
  let triageRecordCount = 0;
  // A flag and a review case on one transaction are the same unit of machine work.
  const processing = new Set<string>();
  let technicalBlockerCount = 0;
  for (const record of state.records) {
    if (record.source === "transaction_flag") rawCounts.transactionFlags++;
    if (record.source === "review_case") rawCounts.reviewCases++;
    if (record.source === "question") rawCounts.questions++;
    if (record.source === "approval") {
      approvals.add(record.decisionKey ?? record.id);
      rawCounts.approvals = approvals.size;
    }
    const validDate = z.iso.date().safeParse(record.date);
    const month = validDate.success ? validDate.data.slice(0, 7) : null;
    const independent = record.dependency === "none";
    if (month && independent && state.firstMonth && month < state.firstMonth) {
      historicalRecordCount++;
      continue;
    }
    if (month && independent && month > state.period) {
      futureRecordCount++;
      continue;
    }
    if (!month || record.dependency === "unknown") triageRecordCount++;
    if (!month || !independent) dependencyRefs.push(record.id);
    if (record.transactionId) transactions.add(record.transactionId);
    if (record.workState === "needs_person") {
      // Namespace explicit shared decisions apart from unrelated individual records.
      decisions.add(record.decisionKey ? `decision:${record.decisionKey}` : `record:${record.id}`);
    } else if (record.workState === "technical_blocker") technicalBlockerCount++;
    else
      processing.add(
        record.transactionId ? `transaction:${record.transactionId}` : `record:${record.id}`,
      );
  }
  const processingCount = processing.size;
  return {
    period: state.period,
    complete: state.complete,
    activeDecisionCount: decisions.size,
    activeTransactionCount: transactions.size,
    historicalRecordCount,
    futureRecordCount,
    triageRecordCount,
    processingCount,
    technicalBlockerCount,
    dependencyRefs,
    rawCounts,
    budgetReady:
      state.firstMonth !== null &&
      state.firstMonth <= state.period &&
      state.complete &&
      state.openingPositionQualified &&
      state.budgetApproved &&
      decisions.size === 0 &&
      processingCount === 0 &&
      technicalBlockerCount === 0 &&
      triageRecordCount === 0,
  };
}

export const previewFinanceBudgetStartInputSchema = z.strictObject({
  firstMonth: financeMonthSchema.nullable(),
  expectedPolicyRevision: z.number().int().nonnegative(),
  idempotencyKey: z.string().trim().min(1).max(200),
});
export const applyFinanceBudgetStartInputSchema = z.strictObject({
  previewId: z.uuid(),
  fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
});
export const financeBudgetStartPolicySchema = z.strictObject({
  firstMonth: financeMonthSchema.nullable(),
  timezone: z.string().min(1),
  revision: z.number().int().positive(),
  approvedAt: z.iso.datetime(),
  approvalSource: z.literal("user_instruction"),
});
export type FinanceBudgetStartPolicy = z.infer<typeof financeBudgetStartPolicySchema>;

const attentionCount = z.number().int().nonnegative();
export const financeAttentionSnapshotSchema = z.strictObject({
  period: financeMonthSchema,
  complete: z.boolean(),
  activeDecisionCount: attentionCount,
  activeTransactionCount: attentionCount,
  historicalRecordCount: attentionCount,
  futureRecordCount: attentionCount,
  triageRecordCount: attentionCount,
  processingCount: attentionCount,
  technicalBlockerCount: attentionCount,
  dependencyRefs: z.array(z.string()),
  rawCounts: z.strictObject({
    transactionFlags: attentionCount,
    reviewCases: attentionCount,
    questions: attentionCount,
    approvals: attentionCount,
  }),
  budgetReady: z.boolean(),
  asOf: z.iso.datetime(),
  timezone: z.string().min(1),
  snapshot: z.string().regex(/^[a-f0-9]{64}$/),
  readiness: z.strictObject({ openingPositionQualified: z.boolean(), budgetApproved: z.boolean() }),
  policy: z
    .strictObject({
      firstMonth: financeMonthSchema.nullable(),
      revision: z.number().int().positive(),
    })
    .nullable(),
  qualificationRecovery: z.enum(["opening_position_required", "none"]),
});
export type FinanceAttentionSnapshot = z.infer<typeof financeAttentionSnapshotSchema>;

export const financeBudgetStartPreviewSchema = z.strictObject({
  id: z.uuid(),
  fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  proposedMonth: financeMonthSchema.nullable(),
  timezone: z.string(),
  expectedPolicyRevision: z.number().int().nonnegative(),
  attention: financeAttentionSnapshotSchema,
  projectedAttention: financeAttentionSnapshotSchema.nullable(),
  /** When the owner declined this exact item; null while it can still be approved. */
  declinedAt: z.iso.datetime().nullable().optional(),
});
export type FinanceBudgetStartPreview = z.infer<typeof financeBudgetStartPreviewSchema>;
export type PreviewFinanceBudgetStartInput = z.infer<typeof previewFinanceBudgetStartInputSchema>;
export type ApplyFinanceBudgetStartInput = z.infer<typeof applyFinanceBudgetStartInputSchema>;

/** The owner's durable refusal of one published card; only a new preview can follow. */
export const financeDecisionDeclineSchema = z.strictObject({
  kind: z.enum(["review_batch", "budget_start_preview", "review_batch_undo"]),
  id: z.uuid(),
  declinedAt: z.iso.datetime(),
  recovery: z.literal("new_preview"),
});
export type FinanceDecisionDecline = z.infer<typeof financeDecisionDeclineSchema>;
