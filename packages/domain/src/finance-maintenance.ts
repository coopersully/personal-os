import { z } from "zod";
import {
  financeAccountSchema,
  financeFactEvidenceSchema,
  financeProviderItemHealthSchema,
  financeQuestionSchema,
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
    open: z.int().nonnegative(),
    overdue: z.int().nonnegative(),
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
