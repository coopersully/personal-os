import {
  type Database,
  financeAccounts,
  financeBalanceInclusions,
  financeBudgetBucketCategories,
  financeBudgetBuckets,
  financeBudgetTaxonomies,
  financeBudgetVersions,
  financeCashBalanceBases,
  financeCategories,
  financeIncomeStreams,
  financeOccurrenceMatchEvents,
  financeProviderItems,
  financeRecurringObligations,
  financeRecurringOccurrences,
  financeRecurringScheduleVersions,
  financeTransactionCoverage,
} from "@personal-os/database";
import type { FinanceBudgetPlanContext, FinanceBudgetVersion } from "@personal-os/domain";
import { and, eq, inArray } from "drizzle-orm";
import { AppError } from "../errors.js";
import {
  createFinanceBalanceBasisService,
  financeCashflowReadLimit,
} from "./balance-basis-service.js";
import { createFinanceBudgetBaselineQualificationService } from "./baseline-qualification-service.js";
import { budgetPlanningDate } from "./budget-plan-projection.js";
import { type BudgetRoomSources, projectFinanceBudgetRoom } from "./budget-room.js";
import type { FinanceTransaction } from "./context.js";
import { createFinancePositionService } from "./position-service.js";
import { createFinanceRecurringOccurrenceService } from "./recurring-occurrence-service.js";
import { readScopedFinanceLedger } from "./scoped-ledger-reader.js";
import { createFinanceSpendingService } from "./spending-service.js";

/** Private read composition for canonical budget status. All ports use the caller's
 * transaction and one observation instant; no nested transaction or financial effect. */
export async function readFinanceBudgetRoom(input: {
  db: Database;
  tx: FinanceTransaction;
  userId: string;
  asOf: Date;
  context: FinanceBudgetPlanContext;
  budget: FinanceBudgetVersion;
}) {
  const { db, tx, userId, asOf, context, budget } = input;
  const stored = await tx.query.financeBudgetVersions.findFirst({
    where: and(eq(financeBudgetVersions.userId, userId), eq(financeBudgetVersions.id, budget.id)),
  });
  if (!stored) throw new AppError("not_found", "The room budget was not found.");
  if (
    stored.planId !== budget.planId ||
    stored.version !== budget.version ||
    stored.effectiveFrom !== context.month ||
    stored.status !== "active" ||
    stored.approvedAt?.toISOString() !== budget.approvedAt
  )
    throw new AppError("conflict", "The current approved budget changed; reload it.");
  const now = () => asOf;
  const qualification = await createFinanceBudgetBaselineQualificationService({
    db,
    now,
  }).getQualification(userId, context.month, tx);
  const sources: BudgetRoomSources = {
    ownerUserId: userId,
    asOf: asOf.toISOString(),
    context,
    budget,
    qualification,
    spending: null,
    position: null,
    cashflow: null,
    fundingAccountIds: [],
  };
  if (qualification.state !== "qualified") return projectFinanceBudgetRoom(sources);
  const scope = qualification.qualification;
  const today = budgetPlanningDate(asOf, context.timezone);
  if (
    scope.month !== context.month ||
    scope.planId !== budget.planId ||
    scope.period.timezone !== context.timezone ||
    today.slice(0, 7) !== context.month
  )
    return projectFinanceBudgetRoom(sources);
  const scoped = await readScopedFinanceLedger(tx, userId, {
    from: scope.period.from,
    through: today,
    accountIds: scope.accountIds,
  });
  if (scoped.state === "unavailable") {
    sources.readUnavailableReasons = [scoped.reason];
    return projectFinanceBudgetRoom(sources);
  }
  // Non-ledger metadata readers retain their existing complete-owner contracts and bounds.
  // Ledger preflight and actual dependency loads share the scoped closure above.
  for (const table of [
    financeTransactionCoverage,
    financeAccounts,
    financeProviderItems,
    financeCategories,
    financeBudgetTaxonomies,
    financeBudgetBuckets,
    financeBudgetBucketCategories,
    financeIncomeStreams,
    financeRecurringObligations,
    financeRecurringScheduleVersions,
    financeRecurringOccurrences,
    financeOccurrenceMatchEvents,
    financeCashBalanceBases,
    financeBalanceInclusions,
  ]) {
    const rows = await tx
      .select({ owner: table.userId })
      .from(table)
      .where(eq(table.userId, userId))
      .limit(financeCashflowReadLimit + 1);
    if (rows.length > financeCashflowReadLimit) {
      sources.readUnavailableReasons = ["ledger_bound_exceeded"];
      return projectFinanceBudgetRoom(sources);
    }
  }
  const accounts = await tx
    .select({ id: financeAccounts.id })
    .from(financeAccounts)
    .where(
      and(
        eq(financeAccounts.userId, userId),
        inArray(financeAccounts.id, scope.accountIds),
        eq(financeAccounts.kind, "cash"),
        eq(financeAccounts.includeInPlanning, true),
      ),
    );
  sources.fundingAccountIds = accounts.map((row) => row.id).sort();
  sources.spending = await createFinanceSpendingService({ db, now }).readSpending(
    userId,
    {
      scope: {
        from: scope.period.from,
        through: today,
        timezone: context.timezone,
        accountIds: scope.accountIds,
        categoryIds: null,
        basis: "personal_cost",
        includePending: true,
        subtractRefunds: true,
      },
      grouping: "categories",
      includeUncategorized: true,
    },
    tx,
    qualification,
    scoped.ledger,
  );
  sources.position = await createFinancePositionService({ db, now }).readPosition(
    userId,
    { from: scope.period.from, through: today, accountIds: scope.accountIds },
    tx,
    scoped.ledger,
  );
  // Only the exact income identity explicitly attached to the approved resources is eligible.
  // Missing or multiple identities remain unknown; do not guess from a recent bank deposit.
  const income = budget.resources.filter((resource) => resource.kind === "income");
  const identities = new Set(income.map((resource) => resource.sourceId));
  const selectedIncomeStreamId =
    income.length && identities.size === 1 ? (income[0]?.sourceId ?? null) : null;
  const occurrences = createFinanceRecurringOccurrenceService({ db, now, scopedActuals: true });
  sources.cashflow = await createFinanceBalanceBasisService({
    db,
    now,
    readOccurrences: occurrences.listFinanceRecurringOccurrences,
    scopedActuals: true,
  }).getFinanceCashflowProjection(
    userId,
    {
      from: today,
      to: scope.period.through,
      accountIds: sources.fundingAccountIds,
      selectedIncomeStreamId,
    },
    tx,
  );
  return projectFinanceBudgetRoom(sources);
}
