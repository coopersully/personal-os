import {
  type FinanceBudgetBaselineQualificationRead,
  type FinanceSpendingDashboard,
  type FinanceSpendingMonthlyBudget,
  type FinanceSpendingQuery,
  financeBudgetBaselineQualificationReadSchema,
  financeSpendingMonthlyBudgetSchema,
} from "@personal-os/domain";
import { projectFinanceSpending, type SpendingEvidenceInput } from "./spending-contributions.js";

/** Whole-month observed usage over explicit human-qualified budget accounts, never bubble scope. */
export function projectFinanceSpendingMonthlyBudget(
  evidence: SpendingEvidenceInput,
  query: FinanceSpendingQuery,
  groups: FinanceSpendingDashboard["groups"],
  read: FinanceBudgetBaselineQualificationRead,
): FinanceSpendingMonthlyBudget {
  const unavailable = (
    reason: Extract<FinanceSpendingMonthlyBudget, { state: "unavailable" }>["reason"],
    qualificationRequired = true,
  ): FinanceSpendingMonthlyBudget => ({ state: "unavailable", reason, qualificationRequired });
  if (query.scope.from.slice(0, 7) !== query.scope.through.slice(0, 7))
    return unavailable("multi_month_selection", false);
  const validated = financeBudgetBaselineQualificationReadSchema.parse(read);
  if (validated.state === "unavailable") return unavailable(validated.reason);
  const baseline = validated.qualification;
  const month = query.scope.from.slice(0, 7);
  const [year, monthNumber] = month.split("-").map(Number);
  const expectedThrough = new Date(Date.UTC(year ?? 0, monthNumber ?? 0, 0))
    .toISOString()
    .slice(0, 10);
  if (
    baseline.month !== month ||
    baseline.period.from !== `${month}-01` ||
    baseline.period.through !== expectedThrough
  )
    return unavailable("baseline_incomplete");
  if (baseline.currency !== "USD") return unavailable("unsupported_currency", false);
  const accounts = new Map(
    evidence.accounts.filter((row) => row.userId === evidence.userId).map((row) => [row.id, row]),
  );
  for (const id of baseline.accountIds) {
    const account = accounts.get(id);
    if (!account?.includeInPlanning) return unavailable("scope_unavailable");
    if (account.currencyCode !== "USD") return unavailable("unsupported_currency", false);
  }
  // Legacy labels cannot prove historical category identity. Never match current display names.
  if (baseline.allocations.some((row) => row.categoryId === null))
    return unavailable("category_identity_unresolved");
  const monthly = projectFinanceSpending(evidence, {
    ...query.scope,
    from: baseline.period.from,
    through: baseline.period.through,
    timezone: baseline.period.timezone,
    accountIds: baseline.accountIds,
    categoryIds: null,
  });
  if (monthly.qualifications.some((row) => row.code === "unsupported_currency"))
    return unavailable("unsupported_currency", false);
  if (monthly.qualifications.length) return unavailable("recognition_unresolved", false);
  const allGroups = groups.flatMap((row) => [row, ...row.categories]);
  return financeSpendingMonthlyBudgetSchema.parse({
    state: "qualified",
    month,
    period: baseline.period,
    currency: "USD",
    accountIds: baseline.accountIds,
    qualificationId: baseline.id,
    confirmedAt: baseline.confirmedAt,
    qualificationKind: baseline.qualificationKind,
    coverage: monthly.coverage,
    includesPending: query.scope.includePending,
    basis: query.scope.basis,
    subtractsRefunds: query.scope.subtractRefunds,
    groups: allGroups.map((group) => {
      const targets = baseline.allocations.filter((row) =>
        group.categoryIds.includes(row.categoryId),
      );
      const budgetCents = targets.length
        ? targets.reduce((sum, row) => sum + row.amountCents, 0)
        : null;
      const usedCents = monthly.contributions
        .filter((row) => group.categoryIds.includes(row.categoryId))
        .reduce((sum, row) => sum + row.netCents, 0);
      return {
        groupId: group.id,
        budgetCents,
        usedCents,
        overspent: budgetCents !== null && usedCents > budgetCents,
      };
    }),
  });
}
