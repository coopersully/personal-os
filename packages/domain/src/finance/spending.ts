import { z } from "zod";

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
