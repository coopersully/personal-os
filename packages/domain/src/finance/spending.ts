import { z } from "zod";
import { financeTransactionSchema } from "../finance.js";

const cents = z.number().int().safe();
const reference = z.string().min(1);
const timezone = z.string().refine((value) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}, "Expected an IANA timezone");

/** Date-only records already represent local dates and must never be shifted via UTC. */
export const financeSpendingScopeSchema = z
  .object({
    from: z.iso.date(),
    through: z.iso.date(),
    timezone,
    accountIds: z.array(reference).nullable(),
    categoryIds: z.array(reference.nullable()).nullable(),
    basis: z.enum(["personal_cost", "full_outflow"]),
    includePending: z.boolean(),
    subtractRefunds: z.boolean(),
  })
  .refine((scope) => scope.from <= scope.through, "Reversed period")
  .refine(
    (scope) => (Date.parse(scope.through) - Date.parse(scope.from)) / 86_400_000 < 3660,
    "Spending periods support at most 3660 calendar days",
  );
export type FinanceSpendingScope = z.infer<typeof financeSpendingScopeSchema>;

export const financeSpendingContributionSchema = z
  .object({
    id: reference,
    transactionId: reference,
    allocationId: reference.nullable(),
    categoryId: reference.nullable(),
    accountId: reference,
    date: z.iso.date(),
    pending: z.boolean(),
    currencyCode: z.literal("USD"),
    grossCents: cents.nonnegative(),
    reimbursementAdjustmentCents: cents.nonnegative(),
    reimbursementOutstandingCents: cents.nonnegative(),
    reimbursementIds: z.array(reference),
    refundAdjustmentCents: cents.nonnegative(),
    netCents: cents,
  })
  .refine(
    (value) =>
      value.netCents ===
      value.grossCents - value.reimbursementAdjustmentCents - value.refundAdjustmentCents,
    "Contributions must reconcile",
  );
export type FinanceSpendingContribution = z.infer<typeof financeSpendingContributionSchema>;

export const financeSpendingDrillDownSchema = z.object({
  scope: financeSpendingScopeSchema,
  contributionIds: z.array(reference),
  transactionIds: z.array(reference),
});

export type FinanceSpendingDrillDown = z.infer<typeof financeSpendingDrillDownSchema>;

export const financeSpendingDailyBinSchema = z.object({
  date: z.iso.date(),
  netCents: cents,
  positiveAreaCents: cents.nonnegative(),
  negativeAdjustmentCents: cents.nonnegative(),
  pendingCents: cents,
  coverage: z.enum(["complete", "partial", "unknown"]),
  provisional: z.boolean(),
  future: z.boolean(),
  drillDown: financeSpendingDrillDownSchema,
});

export type FinanceSpendingDailyBin = z.infer<typeof financeSpendingDailyBinSchema>;

export const financeSpendingSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  scope: financeSpendingScopeSchema,
  asOf: z.iso.datetime(),
  coverage: z.enum(["complete", "partial", "unknown"]),
  contributions: z.array(financeSpendingContributionSchema),
  bins: z.array(financeSpendingDailyBinSchema),
  netCents: cents,
  positiveAreaCents: cents.nonnegative(),
  negativeAdjustmentCents: cents.nonnegative(),
  qualifications: z.array(z.object({ code: reference, sourceIds: z.array(reference) })),
  budgetComparison: z.object({
    status: z.literal("unavailable"),
    reason: z.literal("historical_budget_not_resolved"),
  }),
});
export type FinanceSpendingSnapshot = z.infer<typeof financeSpendingSnapshotSchema>;

/** Validated API input; URL adapters preserve null (all) and [] (none). */
export const financeSpendingQuerySchema = z.object({
  scope: financeSpendingScopeSchema,
  grouping: z.enum(["auto", "buckets", "categories"]).default("auto"),
  includeUncategorized: z.boolean().default(true),
});
export type FinanceSpendingQuery = z.infer<typeof financeSpendingQuerySchema>;

export const financeSpendingGroupSchema = z.object({
  id: reference,
  label: reference,
  kind: z.enum(["bucket", "category"]),
  categoryIds: z.array(reference.nullable()),
  netCents: cents,
  positiveAreaCents: cents.nonnegative(),
  grossCents: cents.nonnegative(),
  reimbursementAdjustmentCents: cents.nonnegative(),
  reimbursementOutstandingCents: cents.nonnegative(),
  refundAdjustmentCents: cents.nonnegative(),
  pendingCents: cents,
  drillDown: financeSpendingDrillDownSchema,
});
export type FinanceSpendingGroup = z.infer<typeof financeSpendingGroupSchema>;

export const financeSpendingMonthlyBudgetSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("unavailable"),
    reason: z.enum([
      "multi_month_selection",
      "qualification_required",
      "baseline_missing",
      "baseline_incomplete",
      "scope_unavailable",
      "unsupported_currency",
      "category_identity_unresolved",
      "recognition_unresolved",
    ]),
    qualificationRequired: z.boolean(),
  }),
  z.object({
    state: z.literal("qualified"),
    month: z.string(),
    period: z.object({ from: z.iso.date(), through: z.iso.date(), timezone: z.string() }),
    currency: z.literal("USD"),
    accountIds: z.array(reference),
    qualificationId: reference,
    confirmedAt: z.iso.datetime(),
    qualificationKind: z.enum(["current", "retrospective"]),
    coverage: z.enum(["complete", "partial", "unknown"]),
    includesPending: z.boolean(),
    basis: z.enum(["personal_cost", "full_outflow"]),
    subtractsRefunds: z.boolean(),
    groups: z.array(
      z.object({
        groupId: reference,
        budgetCents: cents.positive().nullable(),
        usedCents: cents,
        overspent: z.boolean(),
      }),
    ),
  }),
]);
export type FinanceSpendingMonthlyBudget = z.infer<typeof financeSpendingMonthlyBudgetSchema>;

export const financeSpendingDashboardSchema = z.object({
  referenceRevision: z.string().min(1).optional(),
  monthlyBudget: financeSpendingMonthlyBudgetSchema.optional(),
  schemaVersion: z.literal(1),
  snapshot: financeSpendingSnapshotSchema,
  effectiveGrouping: z.enum(["buckets", "categories"]),
  groupingFallback: z.literal("buckets_unavailable").nullable(),
  groups: z.array(
    financeSpendingGroupSchema.extend({ categories: z.array(financeSpendingGroupSchema) }),
  ),
  positiveAreaCents: cents.nonnegative(),
  negativeAdjustmentCents: cents.nonnegative(),
  excludedUncategorizedCents: cents,
  accounts: z.array(z.object({ id: reference, label: reference })),
  categories: z.array(z.object({ id: reference, label: reference })),
  transactions: z.array(
    z.object({
      id: reference,
      accountId: reference,
      merchant: z.string(),
      updatedAt: z.iso.datetime().optional(),
      date: z.string(),
      pending: z.boolean(),
    }),
  ),
  source: z.object({
    freshness: z.enum(["current", "stale", "unavailable", "unknown"]),
    lastSyncedAt: z.iso.datetime().nullable(),
    reasons: z.array(reference),
  }),
  currency: z.object({
    supported: z.literal("USD"),
    unsupported: z.array(
      z.object({ code: z.string().nullable(), transactionIds: z.array(reference) }),
    ),
  }),
});
export type FinanceSpendingDashboard = z.infer<typeof financeSpendingDashboardSchema>;

/** Bounded source-reference filter. IDs select views and never establish authority. */
export const financeSpendingReferenceFilterSchema = z
  .object({
    query: financeSpendingQuerySchema,
    referenceRevision: z.string().regex(/^[a-f0-9]{64}$/),
    groupId: z.string().min(1).max(100).nullable(),
    from: z.iso.date(),
    through: z.iso.date(),
  })
  .strict()
  .refine(
    (value) =>
      value.from <= value.through &&
      value.from >= value.query.scope.from &&
      value.through <= value.query.scope.through,
    "Reference dates must remain inside the selected Spending scope",
  );
export type FinanceSpendingReferenceFilter = z.infer<typeof financeSpendingReferenceFilterSchema>;
export const financeSpendingReferencePageSchema = z.object({
  items: z.array(financeTransactionSchema),
  nextCursor: z.string().nullable(),
  referenceRevision: z.string(),
  totalTransactions: z.number().int().nonnegative(),
  netCents: cents,
  scope: financeSpendingScopeSchema,
  contributions: z.array(financeSpendingContributionSchema),
});
export type FinanceSpendingReferencePage = z.infer<typeof financeSpendingReferencePageSchema>;
