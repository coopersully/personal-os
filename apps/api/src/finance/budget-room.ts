import type {
  FinanceBudgetBaselineQualificationRead,
  FinanceBudgetPlanContext,
  FinanceBudgetVersion,
  FinanceCashflowProjectionView,
  FinancePositionEvidence,
  FinanceSpendingDashboard,
} from "@personal-os/domain";
import { budgetPlanningDate } from "./budget-plan-projection.js";
import { positionRevision } from "./position.js";

/** Private calculation inputs from one authenticated, caller-owned read transaction.
 * These values are neither an admission capability nor permission to spend. */
export type BudgetRoomSources = {
  ownerUserId: string;
  asOf: string;
  context: FinanceBudgetPlanContext;
  budget: FinanceBudgetVersion;
  qualification: FinanceBudgetBaselineQualificationRead;
  spending: FinanceSpendingDashboard | null;
  position: FinancePositionEvidence | null;
  cashflow: FinanceCashflowProjectionView | null;
  fundingAccountIds: string[];
  readUnavailableReasons?: string[];
};
export type BudgetCategoryRoom = {
  categoryId: string | null;
  label: string;
  budgetCents: number;
  observedCents: number | null;
  observedRemainingCents: number | null;
  estimatedUsableCents: number | null;
};
export type BudgetRoom = {
  ownerUserId: string;
  revision: string;
  budget: { id: string; version: number; planId: string };
  period: { from: string; through: string; timezone: string };
  observedThrough: string;
  accountIds: string[];
  fundingAccountIds: string[];
  state: "unavailable" | "estimated";
  reasons: string[];
  categories: BudgetCategoryRoom[];
  assumptions: string[];
  sources: {
    spendingRevision: string | null;
    positionRevision: string | null;
    qualification: { id: string; revision: number } | null;
    payday: FinanceCashflowProjectionView["projection"] | null;
  };
};
const sameIds = (a: string[], b: string[]) =>
  a.length === b.length &&
  new Set(a).size === a.length &&
  JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const cents = (amount: number) => Math.round(amount * 100);

/** Observed category remainder is distinct from cash available before payday.
 * Future cashflow always remains an estimate, even with confirmed source statements. */
export function projectFinanceBudgetRoom(input: BudgetRoomSources): BudgetRoom {
  const { budget, context, qualification, spending, position, cashflow } = input;
  const today = budgetPlanningDate(new Date(input.asOf), context.timezone);
  const month = context.month;
  const [year, number] = month.split("-").map(Number);
  const period = {
    from: `${month}-01`,
    through: new Date(Date.UTC(year ?? 0, number ?? 0, 0)).toISOString().slice(0, 10),
    timezone: context.timezone,
  };
  const observedThrough = today < period.through ? today : period.through;
  const reasons = new Set<string>(input.readUnavailableReasons);
  if (
    context.state !== "approved" ||
    !context.current ||
    context.current.id !== budget.id ||
    context.current.version !== budget.version ||
    context.current.planId !== budget.planId ||
    budget.effectiveFrom !== month ||
    budget.status !== "active" ||
    !budget.approvedAt ||
    budget.balanceDelta !== 0 ||
    budget.expectedResources !== budget.allocatedTotal ||
    today.slice(0, 7) !== month
  )
    reasons.add("current_approved_budget_required");
  if (
    !budget.resources.length ||
    !budget.allocations.length ||
    cents(budget.resources.reduce((sum, row) => sum + row.amount, 0)) !==
      cents(budget.expectedResources) ||
    cents(budget.allocations.reduce((sum, row) => sum + row.amount, 0)) !==
      cents(budget.allocatedTotal)
  )
    reasons.add("current_approved_budget_required");
  const scope = qualification.state === "qualified" ? qualification.qualification : null;
  if (!scope) reasons.add("budget_scope_unqualified");
  else if (
    scope.month !== month ||
    scope.planId !== budget.planId ||
    scope.period.from !== period.from ||
    scope.period.through !== period.through ||
    scope.period.timezone !== period.timezone ||
    scope.currency !== "USD" ||
    !scope.accountIds.length ||
    new Set(scope.accountIds).size !== scope.accountIds.length
  )
    reasons.add("scope_mismatch");
  const snapshot = spending?.snapshot;
  const observedScopeMatches =
    !!snapshot &&
    !!scope &&
    snapshot.scope.from === period.from &&
    snapshot.scope.through === observedThrough &&
    snapshot.scope.timezone === period.timezone &&
    snapshot.scope.accountIds !== null &&
    sameIds(snapshot.scope.accountIds, scope.accountIds) &&
    snapshot.scope.categoryIds === null &&
    snapshot.scope.basis === "personal_cost" &&
    snapshot.scope.includePending &&
    snapshot.scope.subtractRefunds &&
    snapshot.asOf === input.asOf &&
    !reasons.has("scope_mismatch") &&
    !reasons.has("current_approved_budget_required");
  if (!observedScopeMatches) reasons.add("spending_scope_unavailable");
  if (!spending?.referenceRevision) reasons.add("spending_revision_unavailable");
  if (spending?.source.freshness !== "current") reasons.add("source_not_current");
  if (snapshot?.coverage !== "complete") reasons.add("transaction_history_incomplete");
  if (snapshot?.qualifications.length) reasons.add("recognition_unresolved");
  if (spending?.currency.unsupported.length) reasons.add("unsupported_currency");
  if (
    !position ||
    !scope ||
    position.asOf !== input.asOf ||
    position.scope.from !== period.from ||
    position.scope.through !== observedThrough ||
    !sameIds(position.scope.accountIds, scope.accountIds)
  )
    reasons.add("position_scope_unavailable");
  if (
    position?.committed.quality !== "verified" ||
    position.committed.cents === null ||
    !position.committed.sources.length
  )
    reasons.add("obligation_completeness_unknown");
  if (
    position?.protected.quality !== "verified" ||
    position.protected.cents === null ||
    !position.protected.sources.length
  )
    reasons.add("protection_unknown");
  if (
    position?.spendable.quality !== "verified" ||
    position.spendable.cents === null ||
    !position.spendable.sources.length
  )
    reasons.add("funding_unqualified");
  const incomeResources = budget.resources.filter((row) => row.kind === "income");
  const incomeIdentities = new Set(incomeResources.map((row) => row.sourceId));
  const forecast = cashflow?.projection;
  if (!forecast || forecast.status === "unavailable") {
    reasons.add("payday_unavailable");
    for (const reason of forecast?.reasons ?? []) reasons.add(`payday:${reason.code}`);
  } else {
    if (
      !incomeResources.length ||
      incomeIdentities.size !== 1 ||
      !incomeResources[0]?.sourceId ||
      !incomeIdentities.has(forecast.selectedIncomeStreamId)
    )
      reasons.add("income_scope_unqualified");
    if (
      forecast.asOfInstant !== input.asOf ||
      forecast.asOfLocalDate !== today ||
      forecast.currencyCode !== "USD" ||
      forecast.periodStartLocalDate !== today ||
      forecast.endLocalDate < today ||
      forecast.endLocalDate > period.through ||
      !input.fundingAccountIds.length ||
      !sameIds(
        forecast.evidence.balances.map((row) => row.accountId),
        input.fundingAccountIds,
      ) ||
      forecast.evidence.balances.some((row) => !row.sourceRevision)
    )
      reasons.add("payday_scope_mismatch");
    if (forecast.protectedFloor.status !== "confirmed") reasons.add("protection_unknown");
  }
  if (cashflow?.schedule.unavailableSources.length) reasons.add("schedule_incomplete");
  const categories = new Map<string | null, BudgetCategoryRoom>();
  for (const allocation of budget.allocations.filter((row) => row.kind === "spending")) {
    const id = allocation.categoryId ?? null;
    if (!id) reasons.add("category_identity_unresolved");
    const row = categories.get(id) ?? {
      categoryId: id,
      label:
        spending?.categories.find((category) => category.id === id)?.label ?? "Budgeted category",
      budgetCents: 0,
      observedCents: null,
      observedRemainingCents: null,
      estimatedUsableCents: null,
    };
    row.budgetCents += cents(allocation.amount);
    categories.set(id, row);
  }
  for (const row of categories.values()) {
    if (!Number.isSafeInteger(row.budgetCents)) reasons.add("invalid_money");
    if (row.categoryId && observedScopeMatches) {
      row.observedCents = snapshot.contributions
        .filter((c) => c.categoryId === row.categoryId)
        .reduce((sum, c) => sum + c.netCents, 0);
      row.observedRemainingCents = row.budgetCents - row.observedCents;
      if (!Number.isSafeInteger(row.observedRemainingCents)) reasons.add("invalid_money");
    }
  }
  if (!categories.size) reasons.add("category_budget_missing");
  if (
    !reasons.size &&
    forecast?.status === "estimated" &&
    forecast.protectedFloor.status === "confirmed" &&
    position?.spendable.cents !== null
  ) {
    for (const row of categories.values())
      row.estimatedUsableCents = Math.min(
        row.observedRemainingCents as number,
        position?.spendable.cents as number,
        forecast.protectedFloor.lowestEndOfDayMarginMinorUnits,
      );
  }
  return {
    ownerUserId: input.ownerUserId,
    revision: positionRevision({
      owner: input.ownerUserId,
      asOf: input.asOf,
      budget: {
        ...budget,
        allocations: [...budget.allocations].sort((a, b) => a.key.localeCompare(b.key)),
        resources: [...budget.resources].sort((a, b) => a.key.localeCompare(b.key)),
      },
      qualification,
      spendingRevision: spending?.referenceRevision,
      observed: snapshot,
      freshness: spending?.source,
      position,
      cashflow,
      readUnavailableReasons: input.readUnavailableReasons,
    }),
    budget: { id: budget.id, version: budget.version, planId: budget.planId },
    period,
    observedThrough,
    accountIds: scope?.accountIds ?? [],
    fundingAccountIds: input.fundingAccountIds,
    state: reasons.size ? "unavailable" : "estimated",
    reasons: [...reasons].sort(),
    categories: [...categories.values()].sort((a, b) =>
      String(a.categoryId).localeCompare(String(b.categoryId)),
    ),
    sources: {
      spendingRevision: spending?.referenceRevision ?? null,
      positionRevision: position?.revision ?? null,
      qualification: scope ? { id: scope.id, revision: scope.revision } : null,
      payday: forecast ?? null,
    },
    assumptions:
      forecast?.status === "estimated"
        ? [
            ...forecast.assumptions,
            "Future cashflow is estimated, not permission to spend.",
            "Category estimates share the same funding and must not be added together.",
          ]
        : [],
  };
}

export function budgetRoomCommunication(room: BudgetRoom) {
  const labels: Record<string, string> = {
    ledger_bound_exceeded: "financial evidence exceeds the supported read bound",
    budget_scope_unqualified: "the budget account scope needs qualification",
    transaction_history_incomplete: "transaction history is incomplete",
    obligation_completeness_unknown: "confirmed obligation coverage is incomplete",
    protection_unknown: "the protected cash floor is not confirmed",
    income_scope_unqualified: "the payday income does not match the approved resources",
    payday_unavailable: "the next payday is not established",
    funding_unqualified: "funding evidence is not qualified",
  };
  const format = (value: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value / 100);
  return {
    optionalDetails: room.categories.flatMap((row) =>
      row.observedRemainingCents === null
        ? []
        : [
            `${row.label}: ${format(row.observedRemainingCents)} remaining from observed spending against this month's budget.${row.estimatedUsableCents === null ? " This is not usable cash." : ` Estimated usable room before payday: ${format(row.estimatedUsableCents)}.`}`,
          ],
    ),
    disclosures:
      room.state === "unavailable"
        ? [
            `Usable category room is unavailable: ${[...new Set(room.reasons.map((reason) => labels[reason] ?? "compatible current evidence is missing"))].join("; ")}.`,
          ]
        : room.assumptions,
  };
}
