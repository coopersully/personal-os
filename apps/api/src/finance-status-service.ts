import { createHash } from "node:crypto";
import {
  type Database,
  domainProfileApprovals,
  financeAccounts,
  financeAgentActionReviews,
  financeAutomationSettings,
  financeBudgetPlans,
  financeBudgets,
  financeCategoryRules,
  financeIncomeStreams,
  financePeriodReviews,
  financeProfiles,
  financeProviderItems,
  financeRecurringObligations,
  financeReimbursementMatches,
  financeReimbursements,
  financeReviewCases,
  financeTransactionAllocations,
  financeTransactions,
  goals as goalRows,
  motives as motiveRows,
  workspaceMaintenanceRuns,
} from "@personal-os/database";
import {
  type FinanceAccount,
  type FinanceStatus,
  financeDomainProfileSchema,
  financeGuidedPreferencesSchema,
  financeQuestionSchema,
  financeStatusSchema,
  type MaintenanceScope,
} from "@personal-os/domain";
import { and, desc, eq, gte, inArray, or } from "drizzle-orm";
import type { createAssistantService } from "./assistant-service.js";
import { AppError } from "./errors.js";
import {
  activeAllocationsByTransaction,
  excludedReimbursementCentsByAllocation,
  matchedReimbursementCentsByCredit,
  personalAllocationCents,
} from "./finance-allocation-projections.js";
import { forecastCashflow } from "./finance-cashflow.js";
import { assessFinanceHealth } from "./finance-health.js";
import { reliableMonthlyCapacity, reliableMonthlyIncome } from "./finance-planning.js";
import { selectPlausibleReimbursementCredits } from "./finance-reimbursement-candidates.js";
import { deriveReimbursementStatus } from "./finance-reimbursement-service.js";
import type { createFinanceService } from "./finance-service.js";
import type { createGoalsService } from "./goals-service.js";
import type { WorkspaceMaintenanceService } from "./workspace-maintenance-service.js";

type Options = {
  assistant: ReturnType<typeof createAssistantService>;
  db: Database;
  finances: ReturnType<typeof createFinanceService>;
  goals: ReturnType<typeof createGoalsService>;
  maintenance: WorkspaceMaintenanceService;
  now: () => Date;
};

const openRunStatuses = [
  "queued",
  "running",
  "awaiting_approval",
  "blocked",
  "failed_recoverable",
] as const;
const outstandingReviewStatuses = ["deferred", "open"] as const;
const financeTargetTypes = [
  "finance_account",
  "finance_review_case",
  "finance_transaction",
] as const;
type FinanceTargetType = (typeof financeTargetTypes)[number];

function isFinanceTargetType(value: string): value is FinanceTargetType {
  return financeTargetTypes.includes(value as FinanceTargetType);
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, nested: unknown) => {
    if (nested !== null && typeof nested === "object" && !Array.isArray(nested)) {
      const record = nested as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(record)
          .sort()
          .map((key) => [key, record[key]]),
      );
    }
    return nested;
  });
}

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

type SynchronizationSource = Pick<
  typeof financeAccounts.$inferSelect,
  | "lastSyncedAt"
  | "lastSyncAttemptAt"
  | "nextSyncAt"
  | "syncError"
  | "syncErrorCode"
  | "syncFailureCount"
  | "syncRecovery"
  | "syncState"
>;

const migrationBlockedSynchronization = {
  failureCode: "finance_provider_item_migration_required",
  failureCount: 1,
  lastAttemptAt: null,
  lastSuccessAt: null,
  message: "This Plaid account must be linked to an authoritative Provider Item.",
  nextRetryAt: null,
  recovery: "operator" as const,
  state: "blocked" as const,
};

function synchronization(source: SynchronizationSource) {
  return {
    failureCode: source.syncErrorCode,
    failureCount: source.syncFailureCount,
    lastAttemptAt: iso(source.lastSyncAttemptAt),
    lastSuccessAt: iso(source.lastSyncedAt),
    message: source.syncError,
    nextRetryAt: source.syncFailureCount > 0 ? iso(source.nextSyncAt) : null,
    recovery: source.syncRecovery,
    state: source.syncState,
  };
}

function effectiveSynchronization(source: SynchronizationSource, asOf: Date, manual = false) {
  const value = synchronization(source);
  if (
    !manual &&
    value.state === "current" &&
    (source.lastSyncedAt === null ||
      asOf.getTime() - source.lastSyncedAt.getTime() > 24 * 60 * 60 * 1_000)
  ) {
    return { ...value, state: "stale" as const };
  }
  return value;
}

function serializeAccount(
  row: typeof financeAccounts.$inferSelect,
  source?: SynchronizationSource,
  sourceSynchronization?: ReturnType<typeof synchronization>,
): FinanceAccount {
  const synchronizationSource = source ?? row;
  const legacyPlaid = row.provider === "plaid" && row.providerItemRecordId === null;
  return {
    balance: row.balance === null ? null : row.balance / 100,
    createdAt: row.createdAt.toISOString(),
    currencyCode: row.currencyCode,
    id: row.id,
    institution: row.institution,
    kind: row.kind,
    lastSyncedAt: legacyPlaid ? null : iso(synchronizationSource.lastSyncedAt),
    name: row.name,
    provider: row.provider,
    status: row.status,
    synchronization: legacyPlaid
      ? migrationBlockedSynchronization
      : (sourceSynchronization ?? synchronization(synchronizationSource)),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function nextMonth(month: string): string {
  const [year = 0, monthNumber = 0] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 7);
}

function transactionIsInScope(
  row: typeof financeTransactions.$inferSelect,
  scope: MaintenanceScope,
  defaultMonth: string,
  targetReviewTransactionId: string | null,
): boolean {
  if (scope.type === "window") {
    return row.transactionDate >= scope.start && row.transactionDate <= scope.end;
  }
  if (scope.type === "target") {
    if (scope.entityType === "finance_transaction") return row.id === scope.id;
    if (scope.entityType === "finance_account") return row.accountId === scope.id;
    if (scope.entityType === "finance_review_case") return row.id === targetReviewTransactionId;
    return false;
  }
  return (
    row.transactionDate >= `${defaultMonth}-01` &&
    row.transactionDate < `${nextMonth(defaultMonth)}-01`
  );
}

function latestProfile(rows: Array<typeof financeProfiles.$inferSelect>, date: string) {
  return rows
    .filter((row) => row.effectiveDate <= date)
    .toSorted((left, right) => right.effectiveDate.localeCompare(left.effectiveDate))[0];
}

function serializeGoal(row: typeof goalRows.$inferSelect) {
  return {
    createdAt: row.createdAt.toISOString(),
    description: row.description,
    id: row.id,
    progress: row.progress,
    status: row.status,
    targetDate: row.targetDate,
    title: row.title,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeMotive(row: typeof motiveRows.$inferSelect) {
  return {
    createdAt: row.createdAt.toISOString(),
    detail: row.detail,
    id: row.id,
    isActive: row.isActive,
    title: row.title,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function questionId(code: string) {
  const hash = createHash("sha256").update(code).digest("hex");
  return `00000000-0000-4000-8000-${hash.slice(0, 12)}`;
}

function planningQuestion(code: string, prompt: string, why: string) {
  return {
    actionKind: "budget_plan" as const,
    choices: [],
    id: questionId(code),
    prompt,
    sourceRefs: [],
    why,
  };
}

export function createFinanceStatusService({ db, now }: Options) {
  return {
    async getFinanceStatus(
      userId: string,
      scope: MaintenanceScope,
      executor?: Parameters<Parameters<Database["transaction"]>[0]>[0],
    ): Promise<FinanceStatus> {
      const asOfDate = now();
      const asOf = asOfDate.toISOString();
      const currentMonth = asOf.slice(0, 7);
      if (scope.type === "target" && !isFinanceTargetType(scope.entityType)) {
        throw new AppError("invalid_request", "The Finance target type is not supported.");
      }
      const read = async (tx: Parameters<Parameters<Database["transaction"]>[0]>[0]) => {
        const accounts = await tx
          .select()
          .from(financeAccounts)
          .where(eq(financeAccounts.userId, userId))
          .orderBy(financeAccounts.id);
        const providerItems = await tx
          .select()
          .from(financeProviderItems)
          .where(eq(financeProviderItems.userId, userId))
          .orderBy(financeProviderItems.id);
        const [latestPeriodReview] = await tx
          .select({
            completedAt: financePeriodReviews.createdAt,
            id: financePeriodReviews.id,
            status: financePeriodReviews.status,
          })
          .from(financePeriodReviews)
          .where(eq(financePeriodReviews.userId, userId))
          .orderBy(desc(financePeriodReviews.createdAt), desc(financePeriodReviews.id))
          .limit(1);
        const budgets = await tx
          .select()
          .from(financeBudgets)
          .where(and(eq(financeBudgets.userId, userId), eq(financeBudgets.month, currentMonth)))
          .orderBy(financeBudgets.id);
        const [latestBudgetPlan] = await tx
          .select()
          .from(financeBudgetPlans)
          .where(eq(financeBudgetPlans.userId, userId))
          .orderBy(desc(financeBudgetPlans.updatedAt), desc(financeBudgetPlans.version))
          .limit(1);
        const [automationSettings] = await tx
          .select({ reviewBypassEnabled: financeAutomationSettings.reviewBypassEnabled })
          .from(financeAutomationSettings)
          .where(eq(financeAutomationSettings.userId, userId))
          .limit(1);
        const incomeStreams = await tx
          .select()
          .from(financeIncomeStreams)
          .where(
            and(eq(financeIncomeStreams.userId, userId), eq(financeIncomeStreams.status, "active")),
          )
          .orderBy(financeIncomeStreams.id);
        const recurringObligations = await tx
          .select()
          .from(financeRecurringObligations)
          .where(
            and(
              eq(financeRecurringObligations.userId, userId),
              eq(financeRecurringObligations.status, "active"),
            ),
          )
          .orderBy(financeRecurringObligations.id);
        const reviews = await tx
          .select()
          .from(financeReviewCases)
          .where(
            and(
              eq(financeReviewCases.userId, userId),
              or(
                inArray(financeReviewCases.status, outstandingReviewStatuses),
                scope.type === "target" && scope.entityType === "finance_review_case"
                  ? eq(financeReviewCases.id, scope.id)
                  : undefined,
              ),
            ),
          )
          .orderBy(financeReviewCases.createdAt);
        const actionQuestions = await tx
          .select()
          .from(financeAgentActionReviews)
          .where(
            and(
              eq(financeAgentActionReviews.userId, userId),
              eq(financeAgentActionReviews.actionKind, "question"),
              eq(financeAgentActionReviews.status, "pending"),
            ),
          )
          .orderBy(financeAgentActionReviews.createdAt);
        const targetReview =
          scope.type === "target" && scope.entityType === "finance_review_case"
            ? reviews.find((review) => review.id === scope.id)
            : null;
        const currentMonthStart = `${currentMonth}-01`;
        const lowerBound =
          scope.type === "window" && scope.start < currentMonthStart
            ? scope.start
            : currentMonthStart;
        const explicitlyRequiredTransactionIds = [
          ...reviews.map((review) => review.transactionId),
          ...(scope.type === "target" && scope.entityType === "finance_transaction"
            ? [scope.id]
            : []),
          ...(targetReview ? [targetReview.transactionId] : []),
        ];
        const transactions = await tx
          .select()
          .from(financeTransactions)
          .where(
            and(
              eq(financeTransactions.userId, userId),
              or(
                gte(financeTransactions.transactionDate, lowerBound),
                inArray(financeTransactions.id, explicitlyRequiredTransactionIds),
              ),
            ),
          )
          .orderBy(financeTransactions.transactionDate, financeTransactions.id);
        const allocationRows = transactions.length
          ? await tx
              .select()
              .from(financeTransactionAllocations)
              .where(
                and(
                  eq(financeTransactionAllocations.userId, userId),
                  inArray(
                    financeTransactionAllocations.transactionId,
                    transactions.map((transaction) => transaction.id),
                  ),
                ),
              )
          : [];
        const activeAllocations = activeAllocationsByTransaction(allocationRows);
        const [reimbursementRows, reimbursementMatches] = await Promise.all([
          tx.select().from(financeReimbursements).where(eq(financeReimbursements.userId, userId)),
          tx
            .select()
            .from(financeReimbursementMatches)
            .where(eq(financeReimbursementMatches.userId, userId)),
        ]);
        const openAllocationIds = reimbursementRows
          .filter((row) => row.status !== "cancelled" && row.status !== "received")
          .map((row) => row.allocationId);
        const openAllocations = openAllocationIds.length
          ? await tx
              .select({ transactionId: financeTransactionAllocations.transactionId })
              .from(financeTransactionAllocations)
              .where(
                and(
                  eq(financeTransactionAllocations.userId, userId),
                  inArray(financeTransactionAllocations.id, openAllocationIds),
                ),
              )
          : [];
        const openTransactionIds = openAllocations.map((row) => row.transactionId);
        const openExpenseDates = openTransactionIds.length
          ? await tx
              .select({ date: financeTransactions.transactionDate })
              .from(financeTransactions)
              .where(
                and(
                  eq(financeTransactions.userId, userId),
                  inArray(financeTransactions.id, openTransactionIds),
                ),
              )
          : [];
        const oldestOpenReimbursementAnchor = openExpenseDates.map((row) => row.date).toSorted()[0];
        const incomeCredits = oldestOpenReimbursementAnchor
          ? await tx
              .select({
                amount: financeTransactions.amount,
                category: financeTransactions.category,
                date: financeTransactions.transactionDate,
                id: financeTransactions.id,
                merchant: financeTransactions.merchant,
                pending: financeTransactions.pending,
              })
              .from(financeTransactions)
              .where(
                and(
                  eq(financeTransactions.userId, userId),
                  eq(financeTransactions.direction, "income"),
                  gte(financeTransactions.transactionDate, oldestOpenReimbursementAnchor),
                ),
              )
              .orderBy(desc(financeTransactions.transactionDate), desc(financeTransactions.id))
              .limit(500)
          : [];
        const reimbursementStatus = reimbursementRows.map((row) =>
          deriveReimbursementStatus({
            cancelledAt: row.cancelledAt,
            dueDate: row.dueDate,
            expectedCents: row.expectedAmount,
            receivedCents: row.receivedAmount,
            now: new Date(asOf),
            status: row.status,
          }),
        );
        const excludedByAllocation = excludedReimbursementCentsByAllocation(reimbursementRows);
        const matchedCreditAmounts = matchedReimbursementCentsByCredit(reimbursementMatches);
        const unmatchedCredits = selectPlausibleReimbursementCredits({
          credits: incomeCredits,
          matches: reimbursementMatches,
          reimbursements: reimbursementRows,
        }).length;
        const profiles = await tx
          .select()
          .from(financeProfiles)
          .where(eq(financeProfiles.userId, userId));
        const approvals = await tx
          .select()
          .from(domainProfileApprovals)
          .where(
            and(
              eq(domainProfileApprovals.userId, userId),
              eq(domainProfileApprovals.domain, "finances"),
            ),
          );
        const goals = await tx
          .select()
          .from(goalRows)
          .where(and(eq(goalRows.userId, userId), eq(goalRows.status, "active")))
          .orderBy(goalRows.id);
        const motives = await tx
          .select()
          .from(motiveRows)
          .where(and(eq(motiveRows.userId, userId), eq(motiveRows.isActive, true)))
          .orderBy(motiveRows.id);
        const categoryRules = await tx
          .select()
          .from(financeCategoryRules)
          .where(eq(financeCategoryRules.userId, userId))
          .orderBy(financeCategoryRules.id);
        const maintenanceRuns = await tx
          .select()
          .from(workspaceMaintenanceRuns)
          .where(
            and(
              eq(workspaceMaintenanceRuns.userId, userId),
              eq(workspaceMaintenanceRuns.domain, "finances"),
            ),
          )
          .orderBy(desc(workspaceMaintenanceRuns.createdAt))
          .limit(1);
        const goalsById = new Map(goals.map((goal) => [goal.id, goal]));
        const prioritizedGoals = (latestBudgetPlan?.goalIds ?? []).flatMap((goalId, index) => {
          const goal = goalsById.get(goalId);
          return goal ? [{ goal: serializeGoal(goal), priority: index + 1 }] : [];
        });
        const hasStatedGoalPriority = prioritizedGoals.length > 0;

        const approvedProfile = approvals
          .toSorted((left, right) => right.approvedAt.getTime() - left.approvedAt.getTime())
          .map((approval) => {
            const profile = financeDomainProfileSchema.safeParse(approval.profile);
            if (
              !profile.success ||
              profile.data.id !== approval.profileId ||
              profile.data.version !== approval.profileVersion ||
              profile.data.status !== "active"
            )
              return null;
            const preferences = financeGuidedPreferencesSchema.safeParse(profile.data.preferences);
            return preferences.success
              ? { preferences: preferences.data, profile: profile.data }
              : null;
          })
          .find((profile) => profile !== null);
        const profilePolicy = approvedProfile?.preferences ?? null;
        const outstandingReviews = reviews.filter((review) =>
          outstandingReviewStatuses.includes(
            review.status as (typeof outstandingReviewStatuses)[number],
          ),
        );
        if (
          scope.type === "target" &&
          ((scope.entityType === "finance_account" &&
            !accounts.some((account) => account.id === scope.id)) ||
            (scope.entityType === "finance_transaction" &&
              !transactions.some((transaction) => transaction.id === scope.id)) ||
            (scope.entityType === "finance_review_case" && targetReview === null))
        ) {
          throw new AppError("not_found", "The Finance target was not found.");
        }
        const currentTransactions = transactions.filter((row) =>
          transactionIsInScope(row, { type: "all_outstanding" }, currentMonth, null),
        );
        const scopedTransactions = transactions.filter((row) =>
          transactionIsInScope(row, scope, currentMonth, targetReview?.transactionId ?? null),
        );
        const transactionById = new Map(transactions.map((row) => [row.id, row]));
        const scopedReviews = outstandingReviews.filter((review) => {
          if (scope.type === "target" && scope.entityType === "finance_review_case")
            return review.id === scope.id;
          const transaction = transactionById.get(review.transactionId);
          return transaction
            ? transactionIsInScope(
                transaction,
                scope,
                currentMonth,
                targetReview?.transactionId ?? null,
              )
            : false;
        });
        const postedExpenses = currentTransactions.filter(
          (row) => !row.pending && row.direction === "expense",
        );
        const postedIncome = currentTransactions.filter(
          (row) => !row.pending && row.direction === "income",
        );
        const grossSpending = postedExpenses.reduce((sum, row) => sum + row.amount, 0) / 100;
        const spending =
          postedExpenses.reduce(
            (sum, row) =>
              sum +
              personalAllocationCents(row.id, row.amount, activeAllocations, excludedByAllocation),
            0,
          ) / 100;
        const incomeObserved =
          postedIncome.reduce(
            (sum, row) => sum + Math.max(0, row.amount - (matchedCreditAmounts.get(row.id) ?? 0)),
            0,
          ) / 100;
        const activeProfile = latestProfile(profiles, asOf.slice(0, 10));
        const statedMonthlyIncome =
          activeProfile?.grossAnnualIncome != null ? activeProfile.grossAnnualIncome / 1200 : null;
        const observedIncome = incomeObserved > 0 ? incomeObserved : null;
        const budgetTotal =
          budgets.length > 0 ? budgets.reduce((sum, row) => sum + row.limit, 0) / 100 : null;
        const selectedDay = asOfDate.getUTCDate();
        const daysInMonth = new Date(
          Date.UTC(Number(currentMonth.slice(0, 4)), Number(currentMonth.slice(5, 7)), 0),
        ).getUTCDate();
        const reliableIncomeInput = {
          expectedNetPay:
            activeProfile?.expectedNetPay == null ? null : activeProfile.expectedNetPay / 100,
          expectedNetPayFrequency: activeProfile?.payFrequency ?? null,
          grossAnnualIncome:
            activeProfile?.grossAnnualIncome == null ? null : activeProfile.grossAnnualIncome / 100,
          observedMonthlyIncome: observedIncome,
          observedIncomeWindow: {
            complete: selectedDay === daysInMonth,
            days: selectedDay,
          },
        };
        const monthlyIncome = reliableMonthlyIncome(reliableIncomeInput);
        const forecast =
          postedExpenses.length > 0 && selectedDay > 0
            ? (spending / selectedDay) * daysInMonth
            : null;
        const providerItemById = new Map(providerItems.map((item) => [item.id, item]));
        if (
          accounts.some((account) => {
            if (!account.providerItemRecordId) return false;
            const item = providerItemById.get(account.providerItemRecordId);
            return !item || account.provider !== "plaid" || item.provider !== "plaid";
          })
        ) {
          throw new AppError("conflict", "The Plaid connection topology is inconsistent.");
        }
        const accountIdsByItem = new Map<string, string[]>();
        for (const account of accounts) {
          if (!account.providerItemRecordId) continue;
          const linked = accountIdsByItem.get(account.providerItemRecordId) ?? [];
          linked.push(account.id);
          accountIdsByItem.set(account.providerItemRecordId, linked);
        }
        const providerItemSynchronizationById = new Map(
          providerItems.map((item) => [item.id, effectiveSynchronization(item, asOfDate)]),
        );
        const providerItemSynchronization = (itemId: string) => {
          const value = providerItemSynchronizationById.get(itemId);
          if (!value)
            throw new AppError("conflict", "The Plaid connection topology is inconsistent.");
          return value;
        };
        const serializedAccounts = accounts.map((account) =>
          serializeAccount(
            account,
            account.providerItemRecordId
              ? providerItemById.get(account.providerItemRecordId)
              : undefined,
            account.providerItemRecordId
              ? providerItemSynchronizationById.get(account.providerItemRecordId)
              : effectiveSynchronization(account, asOfDate, account.provider === "manual"),
          ),
        );
        const sourceSynchronizations = [
          ...providerItems.map((item) => ({
            accountIds: accountIdsByItem.get(item.id) ?? [],
            synchronization: providerItemSynchronization(item.id),
          })),
          ...accounts
            .filter((account) => account.provider !== "plaid")
            .map((account) => ({
              accountIds: [account.id],
              synchronization: effectiveSynchronization(
                account,
                asOfDate,
                account.provider === "manual",
              ),
            })),
          ...accounts
            .filter(
              (account) => account.provider === "plaid" && account.providerItemRecordId === null,
            )
            .map((account) => ({
              accountIds: [account.id],
              synchronization: migrationBlockedSynchronization,
            })),
        ];
        const evidenceCutoff =
          sourceSynchronizations
            .filter((source) => source.synchronization.state === "current")
            .map((source) => {
              if (source.synchronization.lastSuccessAt !== null)
                return source.synchronization.lastSuccessAt;
              // Manual sources have no provider success timestamp. Their local record revision is
              // the only honest cutoff, and the oldest account revision remains conservative.
              return (
                source.accountIds
                  .map(
                    (accountId) => accounts.find((account) => account.id === accountId)?.updatedAt,
                  )
                  .filter((value): value is Date => value !== undefined)
                  .toSorted((left, right) => left.getTime() - right.getTime())[0]
                  ?.toISOString() ?? null
              );
            })
            .filter((value): value is string => value !== null)
            .toSorted()
            .at(0) ?? null;
        const health = assessFinanceHealth(
          {
            accounts: serializedAccounts.map((account) => ({
              balance: account.balance,
              kind: account.kind,
              lastSuccessAt: account.synchronization.lastSuccessAt,
              provider: account.provider,
              synchronizationState: account.synchronization.state,
            })),
            activeGoalCount: goals.length,
            approvedBudget: budgetTotal,
            forecastSpending: forecast,
            investmentAllocationKnown: false,
            monthlyIncome,
            postedTransactions: currentTransactions.map((row) => ({
              amount: row.amount / 100,
              direction: row.direction,
              pending: row.pending,
            })),
            profile: profilePolicy,
            totalDebt: accounts.some((row) => row.kind === "debt" && row.balance !== null)
              ? accounts
                  .filter((row) => row.kind === "debt")
                  .reduce((sum, row) => sum + Math.abs(row.balance ?? 0), 0) / 100
              : accounts.some((row) => row.kind === "debt")
                ? null
                : 0,
            unknownDebtAprCount: accounts.filter((row) => row.kind === "debt").length,
          },
          asOfDate,
        );
        const currentCount = sourceSynchronizations.filter(
          (source) => source.synchronization.state === "current",
        ).length;
        const blockedSources = sourceSynchronizations.filter(
          (source) => source.synchronization.state === "blocked",
        );
        const blockedCount = blockedSources.length;
        const retryingCount = sourceSynchronizations.filter(
          (source) => source.synchronization.state === "retrying",
        ).length;
        const staleCount =
          sourceSynchronizations.length - currentCount - blockedCount - retryingCount;
        const usableCount = sourceSynchronizations.filter(
          (source) =>
            source.synchronization.state !== "blocked" &&
            source.accountIds.some(
              (accountId) => accounts.find((account) => account.id === accountId)?.balance !== null,
            ),
        ).length;
        const freshnessState =
          usableCount === 0
            ? "unavailable"
            : currentCount === sourceSynchronizations.length
              ? "current"
              : currentCount > 0
                ? "partial"
                : "stale";
        const blockers = blockedSources.map((source) => ({
          code: source.synchronization.failureCode ?? "finance_account_blocked",
          message: source.synchronization.message ?? "A Finance account is blocked.",
          recovery: source.synchronization.recovery,
        }));
        const byReason: Record<string, number> = {};
        for (const review of scopedReviews)
          byReason[review.reason] = (byReason[review.reason] ?? 0) + 1;
        const needsFirstBudgetFacts = latestBudgetPlan === undefined && budgets.length === 0;
        const missingFacts = needsFirstBudgetFacts
          ? [
              ...(monthlyIncome === null ? ["reliable_monthly_income"] : []),
              ...(activeProfile?.monthlyHousingCost == null ? ["monthly_housing_cost"] : []),
              ...(activeProfile?.householdSize == null ? ["household_size"] : []),
              ...(recurringObligations.length === 0 ? ["recurring_obligations"] : []),
              ...(!hasStatedGoalPriority ? ["goal_priority"] : []),
            ]
          : [];
        const planningQuestions = [
          ...(needsFirstBudgetFacts && monthlyIncome === null
            ? [
                planningQuestion(
                  "reliable_monthly_income",
                  "What reliable monthly take-home income should this plan use?",
                  "A first budget needs a monthly income baseline.",
                ),
              ]
            : []),
          ...(needsFirstBudgetFacts && activeProfile?.monthlyHousingCost == null
            ? [
                planningQuestion(
                  "monthly_housing_cost",
                  "What is your monthly housing cost?",
                  "Housing is needed to assess available budget capacity.",
                ),
              ]
            : []),
          ...(needsFirstBudgetFacts && activeProfile?.householdSize == null
            ? [
                planningQuestion(
                  "household_size",
                  "How many people does this budget support?",
                  "Household size makes spending and goal recommendations comparable.",
                ),
              ]
            : []),
          ...(needsFirstBudgetFacts && recurringObligations.length === 0
            ? [
                planningQuestion(
                  "recurring_obligations",
                  "Which recurring bills or obligations should the plan reserve for?",
                  "Recurring obligations are needed before allocating available income.",
                ),
              ]
            : []),
          ...(needsFirstBudgetFacts && !hasStatedGoalPriority
            ? [
                planningQuestion(
                  "goal_priority",
                  "Which financial goal should this budget prioritize first?",
                  "A first budget needs one goal priority to guide tradeoffs.",
                ),
              ]
            : []),
        ];
        const questions = [
          ...planningQuestions,
          ...actionQuestions.flatMap((row) => {
            const payload = row.privatePayload as { question: unknown };
            const parsed = financeQuestionSchema.safeParse({
              ...(payload.question as Record<string, unknown>),
              id: row.id,
            });
            return parsed.success ? [parsed.data] : [];
          }),
        ];
        const latestRun = maintenanceRuns[0];
        const activeRun =
          latestRun &&
          openRunStatuses.includes(latestRun.status as (typeof openRunStatuses)[number])
            ? {
                id: latestRun.id,
                domain: latestRun.domain,
                scope: latestRun.scope,
                status: latestRun.status,
                rulebookVersion: latestRun.rulebookVersion,
                updatedAt: latestRun.updatedAt.toISOString(),
              }
            : null;
        const rulebookInput = {
          accountRoles: { available: false, revisions: [] },
          activeBudgets: budgets.map((row) => ({
            id: row.id,
            month: row.month,
            updatedAt: row.updatedAt.toISOString(),
          })),
          activeGoals: goals.map((row) => ({
            id: row.id,
            revision: row.updatedAt.toISOString(),
          })),
          activeMotives: motives.map((row) => ({
            id: row.id,
            revision: row.updatedAt.toISOString(),
          })),
          approvedFinanceProfile: approvedProfile
            ? { id: approvedProfile.profile.id, version: approvedProfile.profile.version }
            : null,
          categoryRules: categoryRules.map((row) => ({
            id: row.id,
            revision: row.updatedAt.toISOString(),
          })),
        };
        const rulebookVersion = `sha256:${createHash("sha256").update(stableJson(rulebookInput)).digest("hex")}`;
        const possibleDuplicateKeys = new Map<string, number>();
        for (const row of scopedTransactions.filter((item) => item.direction !== "transfer")) {
          const key = [
            row.accountId,
            row.transactionDate,
            row.merchant.toLowerCase(),
            row.amount,
            row.direction,
          ].join(":");
          possibleDuplicateKeys.set(key, (possibleDuplicateKeys.get(key) ?? 0) + 1);
        }
        const reviewTransactionIds = new Set(scopedReviews.map((review) => review.transactionId));
        const unresolvedTransactions = scopedTransactions.filter((row) => {
          const duplicateKey = [
            row.accountId,
            row.transactionDate,
            row.merchant.toLowerCase(),
            row.amount,
            row.direction,
          ].join(":");
          return (
            row.pending ||
            row.reconciliationStatus === "candidate" ||
            (possibleDuplicateKeys.get(duplicateKey) ?? 0) > 1 ||
            (row.category !== null && row.categorySource === null) ||
            (row.direction !== "transfer" && row.category === null) ||
            reviewTransactionIds.has(row.id)
          );
        });
        const earliestUnresolvedDate = unresolvedTransactions
          .map((row) => row.transactionDate)
          .toSorted()[0];
        const reconciledThrough =
          scopedTransactions
            .filter(
              (row) =>
                !unresolvedTransactions.some((unresolved) => unresolved.id === row.id) &&
                (earliestUnresolvedDate === undefined ||
                  row.transactionDate < earliestUnresolvedDate),
            )
            .at(-1)?.transactionDate ?? null;
        const oldestOutstandingAt = outstandingReviews[0]?.createdAt.toISOString() ?? null;
        const work = {
          actionable: scopedReviews.length,
          awaitingApproval: latestRun?.status === "awaiting_approval" ? 1 : 0,
          awaitingInput: questions.length,
          blocked: blockedCount + (latestRun?.status === "blocked" ? 1 : 0),
          oldestOutstandingAt,
        };
        const evidenceCurrent = freshnessState === "current";
        const state =
          blockers.length > 0
            ? "blocked"
            : accounts.length === 0
              ? "needs_input"
              : work.actionable + work.awaitingApproval + work.awaitingInput > 0 ||
                  freshnessState !== "current" ||
                  health.month.rating === "watch" ||
                  health.month.rating === "off_track"
                ? "needs_work"
                : "clean";
        const cash = evidenceCurrent
          ? accounts
              .filter((row) => row.kind === "cash")
              .reduce((sum, row) => sum + (row.balance ?? 0), 0) / 100
          : null;
        const debt = evidenceCurrent
          ? accounts
              .filter((row) => row.kind === "debt")
              .reduce((sum, row) => sum + Math.abs(row.balance ?? 0), 0) / 100
          : null;
        const investments = evidenceCurrent
          ? accounts
              .filter((row) => row.kind === "investment")
              .reduce((sum, row) => sum + (row.balance ?? 0), 0) / 100
          : null;
        const cashflowProjection =
          evidenceCurrent && cash !== null
            ? forecastCashflow({
                asOf,
                cash,
                horizon: null,
                income: incomeStreams.map((stream) => ({
                  amount: stream.expectedAmount / 100,
                  date: stream.nextExpectedDate,
                  kind: "income" as const,
                })),
                obligations: recurringObligations.map((obligation) => ({
                  amount: obligation.expectedAmount / 100,
                  date: obligation.nextExpectedDate,
                  kind: "obligation" as const,
                })),
              })
            : null;
        const recurringMonthlyTotal = recurringObligations.reduce(
          (sum, obligation) => sum + obligation.expectedAmount / 100,
          0,
        );
        const reserveMonthlyOutflow =
          recurringMonthlyTotal > 0
            ? recurringMonthlyTotal
            : activeProfile?.monthlyHousingCost != null
              ? activeProfile.monthlyHousingCost / 100
              : null;
        const statedIncomeEvidence = {
          asOf: activeProfile?.updatedAt.toISOString() ?? null,
          basis: statedMonthlyIncome === null ? "missing" : "user_stated",
          confidence: statedMonthlyIncome === null ? null : "high",
          sourceRefs:
            activeProfile === undefined
              ? []
              : [
                  {
                    accountId: null,
                    provider: "local" as const,
                    remoteId: activeProfile.id,
                    revision: activeProfile.updatedAt.toISOString(),
                    sourceType: "local" as const,
                  },
                ],
          value: statedMonthlyIncome,
        };
        const observedIncomeEvidence = {
          asOf: evidenceCurrent && observedIncome !== null ? asOf : null,
          basis: observedIncome === null ? "missing" : "ledger_observed",
          confidence: observedIncome === null ? null : evidenceCurrent ? "medium" : "low",
          sourceRefs:
            observedIncome === null
              ? []
              : postedIncome.slice(0, 100).flatMap((transaction) => {
                  const account = accounts.find((item) => item.id === transaction.accountId);
                  const provider =
                    account?.provider === "manual" ? "local" : (account?.provider ?? "local");
                  if (provider !== "local" && transaction.providerTransactionId === null) return [];
                  return [
                    {
                      accountId: transaction.accountId,
                      provider,
                      remoteId: transaction.providerTransactionId ?? transaction.id,
                      revision: transaction.updatedAt.toISOString(),
                      sourceType: "finance_transaction" as const,
                    },
                  ];
                }),
          value: evidenceCurrent ? observedIncome : null,
        };
        const budgetCapacity = reliableMonthlyCapacity({
          ...reliableIncomeInput,
          recurring: recurringObligations.map((item) => ({
            amount: item.expectedAmount / 100,
            cadence: item.cadence,
          })),
        });
        const recommendedNextOperation =
          blockers.length > 0
            ? {
                href: "/finances/accounts",
                label: "Reconnect Finance account",
                operation: "reconnect_finance",
              }
            : questions.length > 0
              ? {
                  href: "/finances",
                  label: "Answer Finance question",
                  operation: "answer_finance_question",
                }
              : {
                  href: "/finances",
                  label: "Maintain finances",
                  operation: "maintain_finances",
                };
        return financeStatusSchema.parse({
          activeRun,
          asOf,
          details: {
            accountRoles: { missingInputs: ["account_roles"], state: "unavailable" },
            accounts: {
              blocked: blockedCount,
              current: currentCount,
              items: serializedAccounts,
              providerItems: providerItems.map((item) => ({
                accountIds: (accountIdsByItem.get(item.id) ?? []).toSorted(),
                id: item.id,
                provider: item.provider,
                synchronization: providerItemSynchronization(item.id),
              })),
              retrying: retryingCount,
              stale: staleCount,
              tracked: accounts.length,
            },
            activeGoals: goals.map(serializeGoal),
            activeMotives: motives.map(serializeMotive),
            budget: {
              approved: budgets.length > 0,
              month: currentMonth,
              total: evidenceCurrent ? budgetTotal : null,
            },
            cashFlow: {
              net: evidenceCurrent ? incomeObserved - grossSpending : null,
              projectedLowestBalance: cashflowProjection?.lowestBalance ?? null,
              projectedLowestBalanceDate: cashflowProjection?.lowestDate ?? null,
              reserveRunwayMonths:
                cash !== null && reserveMonthlyOutflow !== null && reserveMonthlyOutflow > 0
                  ? cash / reserveMonthlyOutflow
                  : null,
            },
            closeReadiness: {
              missingProvenance: scopedTransactions.filter(
                (row) => row.category !== null && row.categorySource === null,
              ).length,
              possibleDuplicates: [...possibleDuplicateKeys.values()].filter((count) => count > 1)
                .length,
              ready: scopedReviews.length === 0 && unresolvedTransactions.length === 0,
              reconciledThrough,
              unansweredExceptions: scopedReviews.length,
              uncategorized: scopedTransactions.filter(
                (row) => !row.pending && row.direction !== "transfer" && row.category === null,
              ).length,
              unmatchedTransfers: scopedTransactions.filter(
                (row) => row.reconciliationStatus === "candidate",
              ).length,
            },
            evidence: {
              cutoff: evidenceCurrent ? evidenceCutoff : null,
              current: evidenceCurrent,
            },
            health,
            income: {
              monthly: evidenceCurrent ? monthlyIncome : null,
              observed: observedIncomeEvidence,
              stated: statedIncomeEvidence,
            },
            interview: questions,
            ledger: {
              candidateTransfers: scopedTransactions.filter(
                (row) => row.reconciliationStatus === "candidate",
              ).length,
              missingProvenance: scopedTransactions.filter(
                (row) => row.category !== null && row.categorySource === null,
              ).length,
              pendingTransactions: scopedTransactions.filter((row) => row.pending).length,
              possibleDuplicates: [...possibleDuplicateKeys.values()].filter((count) => count > 1)
                .length,
            },
            month: {
              forecast: evidenceCurrent ? forecast : null,
              spending: evidenceCurrent ? spending : null,
            },
            latestReview: latestPeriodReview
              ? {
                  completedAt: latestPeriodReview.completedAt.toISOString(),
                  id: latestPeriodReview.id,
                  status: latestPeriodReview.status,
                }
              : null,
            missingFacts,
            plan: {
              budgetVariance:
                budgetCapacity === null || budgetTotal === null
                  ? null
                  : budgetCapacity - budgetTotal,
              capacity: budgetCapacity,
              overAllocated:
                budgetCapacity !== null && budgetTotal !== null && budgetTotal > budgetCapacity,
            },
            prioritizedGoals,
            proposals: [],
            questions,
            reimbursements: {
              open: reimbursementStatus.filter(
                (status) =>
                  status === "expected" ||
                  status === "partially_received" ||
                  status === "needs_input",
              ).length,
              overdue: reimbursementStatus.filter((status) => status === "overdue").length,
              expected: reimbursementStatus.filter((status) => status === "expected").length,
              needsInput: reimbursementStatus.filter((status) => status === "needs_input").length,
              anomalies:
                scopedReviews.filter((review) => review.reason === "possible_reimbursement")
                  .length +
                actionQuestions.filter((row) => {
                  const payload = row.privatePayload as { question?: { actionKind?: unknown } };
                  return payload.question?.actionKind === "reimbursement";
                }).length,
              outstanding:
                reimbursementRows.reduce(
                  (sum, row) =>
                    row.status === "cancelled" || row.status === "received"
                      ? sum
                      : sum + Math.max(0, row.expectedAmount - row.receivedAmount),
                  0,
                ) / 100,
              received: reimbursementStatus.filter((status) => status === "received").length,
              unresolved: reimbursementStatus.filter(
                (status) =>
                  status === "expected" ||
                  status === "partially_received" ||
                  status === "overdue" ||
                  status === "needs_input",
              ).length,
              unmatchedCredits,
            },
            reviewMode: { reviewBypassEnabled: automationSettings?.reviewBypassEnabled ?? false },
            review: { byReason, total: scopedReviews.length },
            rulebookVersion,
            wealth: {
              cash,
              debt,
              investments,
              netWorth:
                cash === null || debt === null || investments === null
                  ? null
                  : cash + investments - debt,
            },
          },
          domain: "finances",
          freshness: { blockers, observedAt: asOf, state: freshnessState },
          recommendedNextOperation,
          state,
          validNextOperations: [recommendedNextOperation],
          work,
        });
      };
      return executor
        ? read(executor)
        : db.transaction(read, { accessMode: "read only", isolationLevel: "repeatable read" });
    },
  };
}

export type FinanceStatusService = ReturnType<typeof createFinanceStatusService>;
