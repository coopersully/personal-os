import { z } from "zod";
import { idSchema, isoDateTimeSchema } from "./common.js";
import { materialSourceReferenceSchema } from "./feature-contracts.js";
import {
  applyFinanceCategorizationsInputSchema,
  financeAccountSchema,
  financeActionKindSchema,
  financeFactEvidenceSchema,
  financeProviderItemHealthSchema,
  financeQuestionSchema,
  reconcileFinanceReimbursementInputSchema,
  resolveFinanceAlertInputSchema,
  setFinanceBudgetPlanInputSchema,
  setFinanceTransactionBreakdownInputSchema,
  updateFinanceIncomeStreamInputSchema,
  updateFinanceMerchantInputSchema,
  updateFinanceProfileInputSchema,
  updateFinanceRecurringObligationInputSchema,
  updateFinanceTransactionInputSchema,
} from "./finance.js";
import { goalSchema, motiveSchema } from "./goals.js";
import { maintenanceOperationSchema, workspaceStatusSchema } from "./maintenance.js";

export const financeDataConfidenceSchema = z.enum(["insufficient", "provisional", "reliable"]);
export type FinanceDataConfidence = z.infer<typeof financeDataConfidenceSchema>;

export const financeMonthRatingSchema = z.enum(["off_track", "on_track", "unknown", "watch"]);
export type FinanceMonthRating = z.infer<typeof financeMonthRatingSchema>;

export const financeDimensionRatingSchema = z.enum([
  "healthy",
  "needs_attention",
  "unknown",
  "watch",
]);
export type FinanceDimensionRating = z.infer<typeof financeDimensionRatingSchema>;

export const financeHealthDimensionKeySchema = z.enum([
  "borrow",
  "goals",
  "invest",
  "plan",
  "save",
  "spend",
]);
export type FinanceHealthDimensionKey = z.infer<typeof financeHealthDimensionKeySchema>;

const financeHealthEvidenceSchema = z.object({
  label: z.string().trim().min(1).max(160),
  source: z.string().trim().min(1).max(160),
  value: z.union([z.number().finite(), z.string().max(500), z.null()]),
});

export const financeHealthDimensionSchema = z.object({
  evidence: z.array(financeHealthEvidenceSchema).max(100),
  missingInputs: z.array(z.string().trim().min(1).max(160)).max(100),
  nextAction: z.string().trim().min(1).max(500).nullable(),
  rating: financeDimensionRatingSchema,
  trend: z.enum(["improving", "stable", "unknown", "worsening"]),
});

export const financeHealthSchema = z.object({
  confidence: financeDataConfidenceSchema,
  confidenceEvidence: z.array(z.string().trim().min(1).max(500)).max(100),
  dimensions: z.record(financeHealthDimensionKeySchema, financeHealthDimensionSchema),
  missingInputs: z.array(z.string().trim().min(1).max(160)).max(100),
  month: z.object({
    approvedBudget: z.number().finite().nonnegative().nullable(),
    forecastSpending: z.number().finite().nonnegative().nullable(),
    postedSpending: z.number().finite().nonnegative().nullable(),
    rating: financeMonthRatingSchema,
  }),
});
export type FinanceHealth = z.infer<typeof financeHealthSchema>;

const nullableMoneySchema = z.number().finite().nullable();
const financeProposalSummarySchema = z.object({
  id: z.string().uuid(),
  kind: z.string().trim().min(1).max(100),
  status: z.string().trim().min(1).max(100),
});

export const financeStatusDetailsSchema = z.object({
  accountRoles: z.object({
    missingInputs: z.array(z.literal("account_roles")).length(1),
    state: z.literal("unavailable"),
  }),
  accounts: z.object({
    blocked: z.int().nonnegative(),
    current: z.int().nonnegative(),
    items: z.array(financeAccountSchema),
    providerItems: z.array(financeProviderItemHealthSchema).default([]),
    retrying: z.int().nonnegative(),
    stale: z.int().nonnegative(),
    tracked: z.int().nonnegative(),
  }),
  activeGoals: z.array(goalSchema),
  activeMotives: z.array(motiveSchema),
  budget: z.object({
    approved: z.boolean(),
    month: z.string().regex(/^\d{4}-\d{2}$/u),
    total: nullableMoneySchema,
  }),
  cashFlow: z.object({
    net: nullableMoneySchema,
    projectedLowestBalance: nullableMoneySchema,
    projectedLowestBalanceDate: z.iso.date().nullable(),
    reserveRunwayMonths: nullableMoneySchema,
  }),
  closeReadiness: z.object({
    missingProvenance: z.int().nonnegative(),
    possibleDuplicates: z.int().nonnegative(),
    ready: z.boolean(),
    reconciledThrough: z.iso.date().nullable(),
    unansweredExceptions: z.int().nonnegative(),
    uncategorized: z.int().nonnegative(),
    unmatchedTransfers: z.int().nonnegative(),
  }),
  evidence: z.object({
    cutoff: z.iso.datetime().nullable(),
    current: z.boolean(),
  }),
  health: financeHealthSchema,
  income: z.object({
    monthly: nullableMoneySchema,
    observed: financeFactEvidenceSchema(z.number().finite()),
    stated: financeFactEvidenceSchema(z.number().finite()),
  }),
  interview: z.array(financeQuestionSchema),
  ledger: z.object({
    candidateTransfers: z.int().nonnegative(),
    missingProvenance: z.int().nonnegative(),
    pendingTransactions: z.int().nonnegative(),
    possibleDuplicates: z.int().nonnegative(),
  }),
  month: z.object({ forecast: nullableMoneySchema, spending: nullableMoneySchema }),
  latestReview: z
    .object({
      completedAt: z.iso.datetime(),
      id: z.uuid(),
      status: z.string().trim().min(1).max(100),
    })
    .nullable(),
  missingFacts: z.array(z.string().trim().min(1).max(160)),
  plan: z.object({
    budgetVariance: nullableMoneySchema,
    capacity: nullableMoneySchema,
    overAllocated: z.boolean(),
  }),
  prioritizedGoals: z.array(
    z.object({
      goal: goalSchema,
      priority: z.int().positive(),
    }),
  ),
  proposals: z.array(financeProposalSummarySchema),
  questions: z.array(financeQuestionSchema),
  reimbursements: z.object({
    anomalies: z.int().nonnegative(),
    expected: z.int().nonnegative(),
    needsInput: z.int().nonnegative(),
    open: z.int().nonnegative(),
    overdue: z.int().nonnegative(),
    outstanding: z.number().finite().nonnegative(),
    received: z.int().nonnegative(),
    unresolved: z.int().nonnegative(),
    unmatchedCredits: z.int().nonnegative(),
  }),
  reviewMode: z.object({ reviewBypassEnabled: z.boolean() }),
  review: z.object({
    byReason: z.record(z.string(), z.int().nonnegative()),
    total: z.int().nonnegative(),
  }),
  rulebookVersion: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  wealth: z.object({
    cash: nullableMoneySchema,
    debt: nullableMoneySchema,
    investments: nullableMoneySchema,
    netWorth: nullableMoneySchema,
  }),
});

export const financeStatusSchema = workspaceStatusSchema(financeStatusDetailsSchema).extend({
  domain: z.literal("finances"),
  recommendedNextOperation: maintenanceOperationSchema.nullable(),
});
export type FinanceStatus = z.infer<typeof financeStatusSchema>;

/**
 * A durable, private Finance maintenance batch.  It is deliberately distinct
 * from the public action-review record: challenge and settlement need the
 * complete candidate ledger, while the UI receives only safe projections.
 */
export const financeMaintenanceCandidateStateSchema = z.enum([
  "preparing",
  "ready_for_challenge",
  "challenged",
  "awaiting_approval",
  "committing",
  "committed",
  "superseded",
]);
export type FinanceMaintenanceCandidateState = z.infer<
  typeof financeMaintenanceCandidateStateSchema
>;

export const financeMaintenanceCandidateDispositionSchema = z.enum([
  "prepared",
  "question",
  "removed",
  "committed",
]);
export type FinanceMaintenanceCandidateDisposition = z.infer<
  typeof financeMaintenanceCandidateDispositionSchema
>;

const financeCandidateSafeChangeSchema = z
  .object({
    entityId: idSchema.nullable().default(null),
    entityType: z.string().trim().min(1).max(100),
    summary: z.string().trim().min(1).max(500),
  })
  .strict();

const financeCandidateEvidenceSchema = z
  .object({
    confidence: z.number().finite().min(0).max(1),
    rationale: z.string().trim().min(1).max(4_000),
  })
  .strict();

const financeCandidatePreparedPayloadSchema = z.discriminatedUnion("actionKind", [
  z.object({
    actionKind: z.literal("categorization"),
    input: applyFinanceCategorizationsInputSchema,
  }),
  z.object({
    actionKind: z.literal("transaction_breakdown"),
    input: setFinanceTransactionBreakdownInputSchema,
  }),
  z.object({
    actionKind: z.literal("reimbursement"),
    input: reconcileFinanceReimbursementInputSchema,
  }),
  z.object({
    actionKind: z.literal("recurring_obligation"),
    input: updateFinanceRecurringObligationInputSchema,
  }),
  z.object({ actionKind: z.literal("merchant"), input: updateFinanceMerchantInputSchema }),
  z.object({ actionKind: z.literal("alert"), input: resolveFinanceAlertInputSchema }),
  z.object({ actionKind: z.literal("profile"), input: updateFinanceProfileInputSchema }),
  z.object({ actionKind: z.literal("budget_plan"), input: setFinanceBudgetPlanInputSchema }),
  z.object({ actionKind: z.literal("transaction"), input: updateFinanceTransactionInputSchema }),
  z.object({ actionKind: z.literal("income_stream"), input: updateFinanceIncomeStreamInputSchema }),
]);

const financeCandidateDraftBaseSchema = z.object({
  assumptions: z.array(z.string().trim().min(1).max(500)).max(25).default([]),
  evidence: financeCandidateEvidenceSchema,
  expectedRevision: z.string().trim().min(1).max(128).nullable().default(null),
  fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  safeChanges: z.array(financeCandidateSafeChangeSchema).max(100).default([]),
  sourceRefs: z.array(materialSourceReferenceSchema).max(100).default([]),
});

const financeCandidatePreparedDraftSchema = financeCandidateDraftBaseSchema.extend({
  actionKind: financeActionKindSchema.exclude(["question", "maintenance_turn"]),
  disposition: z.literal("prepared"),
  privatePayload: financeCandidatePreparedPayloadSchema,
});

const financeCandidateQuestionDraftSchema = financeCandidateDraftBaseSchema.extend({
  actionKind: z.literal("question"),
  disposition: z.literal("question"),
  privatePayload: z
    .object({
      asOf: isoDateTimeSchema,
      choices: financeQuestionSchema.shape.choices,
      expectedAnswer: financeQuestionSchema.shape.expectedAnswer,
      prompt: z.string().trim().min(1).max(1_000),
      underlyingAction: financeActionKindSchema.exclude(["question", "maintenance_turn"]),
      transactionId: idSchema.nullable().default(null),
      why: z.string().trim().min(1).max(1_000),
    })
    .strict(),
});

/** Strict internal input accepted before a candidate item can be persisted. */
export const financeMaintenanceCandidateItemDraftSchema = z
  .union([financeCandidatePreparedDraftSchema, financeCandidateQuestionDraftSchema])
  .superRefine((value, context) => {
    if (value.disposition === "prepared" && value.actionKind !== value.privatePayload.actionKind) {
      context.addIssue({
        code: "custom",
        message: "Prepared candidate payload actionKind must match the candidate actionKind.",
        path: ["privatePayload", "actionKind"],
      });
    }
  });
export type FinanceMaintenanceCandidateItemDraft = z.infer<
  typeof financeMaintenanceCandidateItemDraftSchema
>;

export const financeCandidateLedgerProjectionSchema = z
  .object({
    budgetVariance: z.number().finite().nullable().default(null),
    grossCashSpending: z.number().finite().nonnegative(),
    personalSpending: z.number().finite().nonnegative(),
    questions: z.int().nonnegative(),
    reimbursementsOutstanding: z.number().finite().nonnegative(),
  })
  .strict();
export type FinanceCandidateLedgerProjection = z.infer<
  typeof financeCandidateLedgerProjectionSchema
>;

export const financeMaintenanceCandidateSchema = z
  .object({
    createdAt: isoDateTimeSchema,
    id: idSchema,
    projection: financeCandidateLedgerProjectionSchema,
    revision: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    runId: idSchema,
    state: financeMaintenanceCandidateStateSchema,
    updatedAt: isoDateTimeSchema,
    userId: idSchema,
  })
  .strict();
export type FinanceMaintenanceCandidate = z.infer<typeof financeMaintenanceCandidateSchema>;

export const financeMaintenanceCandidateItemSchema = z
  .object({
    actionKind: financeActionKindSchema,
    candidateId: idSchema,
    createdAt: isoDateTimeSchema,
    disposition: financeMaintenanceCandidateDispositionSchema,
    evidence: z.record(z.string(), z.unknown()).default({}),
    expectedRevision: z.string().trim().min(1).max(128).nullable().default(null),
    fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    id: idSchema,
    ordinal: z.int().nonnegative(),
    privatePayload: z.record(z.string(), z.unknown()),
    safeChanges: z.array(financeCandidateSafeChangeSchema).max(100).default([]),
    sourceRefs: z.array(materialSourceReferenceSchema).max(100).default([]),
    updatedAt: isoDateTimeSchema,
  })
  .strict();
export type FinanceMaintenanceCandidateItem = z.infer<typeof financeMaintenanceCandidateItemSchema>;

/** Safe, owner-scoped candidate item view. Private prepared payloads never leave storage. */
export const financeMaintenanceCandidateItemProjectionSchema =
  financeMaintenanceCandidateItemSchema.omit({ privatePayload: true });
export type FinanceMaintenanceCandidateItemProjection = z.infer<
  typeof financeMaintenanceCandidateItemProjectionSchema
>;

export const financeMaintenanceCandidateItemPageSchema = z
  .object({
    items: z.array(financeMaintenanceCandidateItemProjectionSchema).max(100),
    nextCursor: z.string().min(1).nullable(),
  })
  .strict();
export type FinanceMaintenanceCandidateItemPage = z.infer<
  typeof financeMaintenanceCandidateItemPageSchema
>;

export const financeMaintenanceCandidatePageSchema = z
  .object({
    candidate: financeMaintenanceCandidateSchema,
    items: z.array(financeMaintenanceCandidateItemSchema).max(100),
    nextCursor: z.string().min(1).nullable(),
  })
  .strict();
export type FinanceMaintenanceCandidatePage = z.infer<typeof financeMaintenanceCandidatePageSchema>;

export const financeMaintenanceResultSchema = z.object({
  applied: z.object({
    categorizations: z.int().nonnegative(),
    transfers: z.int().nonnegative(),
  }),
  asOf: z.iso.datetime(),
  health: z.object({
    applicability: z.enum(["not_run", "applied", "skipped_scoped"]),
    confidence: financeDataConfidenceSchema,
    refreshed: z.boolean(),
  }),
  questions: z.object({
    created: z.int().nonnegative(),
    total: z.int().nonnegative(),
  }),
  verification: z.object({
    duplicateActions: z.int().nonnegative(),
    freshness: z.enum(["current", "partial", "stale", "unavailable"]),
    state: z.enum(["blocked", "clean", "needs_input", "needs_work"]),
  }),
});
export type FinanceMaintenanceResult = z.infer<typeof financeMaintenanceResultSchema>;
