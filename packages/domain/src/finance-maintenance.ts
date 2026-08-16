import { z } from "zod";
import { financeAccountSchema } from "./finance.js";
import { goalSchema, motiveSchema } from "./goals.js";
import { workspaceStatusSchema } from "./maintenance.js";

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
const financeQuestionSchema = z.object({
  code: z.string().trim().min(1).max(100),
  prompt: z.string().trim().min(1).max(1_000),
});
const financeProposalSummarySchema = z.object({
  id: z.string().uuid(),
  kind: z.string().trim().min(1).max(100),
  status: z.string().trim().min(1).max(100),
});

export const financeStatusDetailsSchema = z.object({
  accounts: z.object({
    blocked: z.int().nonnegative(),
    current: z.int().nonnegative(),
    items: z.array(financeAccountSchema),
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
  cashFlow: z.object({ net: nullableMoneySchema }),
  health: financeHealthSchema,
  income: z.object({ monthly: nullableMoneySchema }),
  ledger: z.object({
    candidateTransfers: z.int().nonnegative(),
    missingProvenance: z.int().nonnegative(),
    pendingTransactions: z.int().nonnegative(),
    possibleDuplicates: z.int().nonnegative(),
  }),
  month: z.object({ forecast: nullableMoneySchema, spending: nullableMoneySchema }),
  proposals: z.array(financeProposalSummarySchema),
  questions: z.array(financeQuestionSchema),
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
});
export type FinanceStatus = z.infer<typeof financeStatusSchema>;
