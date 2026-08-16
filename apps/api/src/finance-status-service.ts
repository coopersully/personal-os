import { createHash } from "node:crypto";
import {
  type Database,
  domainProfileApprovals,
  domainProfiles,
  financeAccounts,
  financeBudgets,
  financeCategoryRules,
  financeProfiles,
  financeReviewCases,
  financeTransactions,
  goals as goalRows,
  motives as motiveRows,
  workspaceMaintenanceRuns,
} from "@personal-os/database";
import {
  type FinanceAccount,
  type FinanceStatus,
  financeStatusSchema,
  type MaintenanceScope,
} from "@personal-os/domain";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { createAssistantService } from "./assistant-service.js";
import { assessFinanceHealth } from "./finance-health.js";
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

function serializeAccount(row: typeof financeAccounts.$inferSelect): FinanceAccount {
  return {
    balance: row.balance === null ? null : row.balance / 100,
    createdAt: row.createdAt.toISOString(),
    id: row.id,
    institution: row.institution,
    kind: row.kind,
    lastSyncedAt: iso(row.lastSyncedAt),
    name: row.name,
    provider: row.provider,
    status: row.status,
    synchronization: {
      failureCode: row.syncErrorCode,
      failureCount: row.syncFailureCount,
      lastAttemptAt: iso(row.lastSyncAttemptAt),
      lastSuccessAt: iso(row.lastSyncedAt),
      message: row.syncError,
      nextRetryAt: row.syncFailureCount > 0 ? iso(row.nextSyncAt) : null,
      recovery: row.syncRecovery,
      state: row.syncState,
    },
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
): boolean {
  if (scope.type === "window") {
    return row.transactionDate >= scope.start && row.transactionDate <= scope.end;
  }
  if (scope.type === "target") {
    if (scope.entityType === "finance_transaction") return row.id === scope.id;
    if (scope.entityType === "finance_account") return row.accountId === scope.id;
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

export function createFinanceStatusService({ db, now }: Options) {
  return {
    async getFinanceStatus(userId: string, scope: MaintenanceScope): Promise<FinanceStatus> {
      const asOfDate = now();
      const asOf = asOfDate.toISOString();
      const selectedMonth = scope.type === "window" ? scope.start.slice(0, 7) : asOf.slice(0, 7);
      return db.transaction(
        async (tx) => {
          const accounts = await tx
            .select()
            .from(financeAccounts)
            .where(eq(financeAccounts.userId, userId))
            .orderBy(financeAccounts.id);
          const budgets = await tx
            .select()
            .from(financeBudgets)
            .where(and(eq(financeBudgets.userId, userId), eq(financeBudgets.month, selectedMonth)))
            .orderBy(financeBudgets.id);
          const transactions = await tx
            .select()
            .from(financeTransactions)
            .where(eq(financeTransactions.userId, userId))
            .orderBy(financeTransactions.transactionDate, financeTransactions.id);
          const reviews = await tx
            .select()
            .from(financeReviewCases)
            .where(
              and(
                eq(financeReviewCases.userId, userId),
                inArray(financeReviewCases.status, [...outstandingReviewStatuses]),
              ),
            )
            .orderBy(financeReviewCases.createdAt);
          const profiles = await tx
            .select()
            .from(financeProfiles)
            .where(eq(financeProfiles.userId, userId));
          const domainProfileRows = await tx
            .select()
            .from(domainProfiles)
            .where(and(eq(domainProfiles.userId, userId), eq(domainProfiles.domain, "finances")));
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

          const approvedProfile = domainProfileRows.find(
            (profile) =>
              profile.status === "active" &&
              approvals.some(
                (approval) =>
                  approval.profileId === profile.id && approval.profileVersion === profile.version,
              ),
          );
          const approvedPreferences = approvedProfile?.preferences as
            | Record<string, unknown>
            | undefined;
          const profilePolicy = approvedProfile
            ? {
                ...(typeof approvedPreferences?.budgetOffTrackForecastRatio === "number"
                  ? { budgetOffTrackForecastRatio: approvedPreferences.budgetOffTrackForecastRatio }
                  : {}),
                ...(typeof approvedPreferences?.budgetWatchForecastRatio === "number"
                  ? { budgetWatchForecastRatio: approvedPreferences.budgetWatchForecastRatio }
                  : {}),
                ...(typeof approvedPreferences?.emergencyReserveTargetMonths === "number"
                  ? {
                      emergencyReserveTargetMonths:
                        approvedPreferences.emergencyReserveTargetMonths,
                    }
                  : {}),
              }
            : null;
          const scopedTransactions = transactions.filter((row) =>
            transactionIsInScope(row, scope, selectedMonth),
          );
          const transactionById = new Map(transactions.map((row) => [row.id, row]));
          const scopedReviews = reviews.filter((review) => {
            if (scope.type === "target" && scope.entityType === "finance_review_case")
              return review.id === scope.id;
            const transaction = transactionById.get(review.transactionId);
            return transaction ? transactionIsInScope(transaction, scope, selectedMonth) : false;
          });
          const postedExpenses = scopedTransactions.filter(
            (row) => !row.pending && row.direction === "expense",
          );
          const postedIncome = scopedTransactions.filter(
            (row) => !row.pending && row.direction === "income",
          );
          const spending = postedExpenses.reduce((sum, row) => sum + row.amount, 0) / 100;
          const incomeObserved = postedIncome.reduce((sum, row) => sum + row.amount, 0) / 100;
          const activeProfile = latestProfile(profiles, asOf.slice(0, 10));
          const monthlyIncome =
            activeProfile?.grossAnnualIncome != null
              ? activeProfile.grossAnnualIncome / 1200
              : incomeObserved > 0
                ? incomeObserved
                : null;
          const budgetTotal =
            budgets.length > 0 ? budgets.reduce((sum, row) => sum + row.limit, 0) / 100 : null;
          const selectedDay =
            scope.type === "window" ? Number(scope.end.slice(-2)) : asOfDate.getUTCDate();
          const daysInMonth = new Date(
            Date.UTC(Number(selectedMonth.slice(0, 4)), Number(selectedMonth.slice(5, 7)), 0),
          ).getUTCDate();
          const forecast =
            postedExpenses.length > 0 && selectedDay > 0
              ? (spending / selectedDay) * daysInMonth
              : null;
          const serializedAccounts = accounts.map(serializeAccount);
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
              postedTransactions: scopedTransactions.map((row) => ({
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
          const currentCount = accounts.filter(
            (row) =>
              row.syncState === "current" &&
              (row.provider === "manual" ||
                (row.lastSyncedAt !== null &&
                  asOfDate.getTime() - row.lastSyncedAt.getTime() <= 24 * 60 * 60 * 1_000)),
          ).length;
          const blockedCount = accounts.filter((row) => row.syncState === "blocked").length;
          const retryingCount = accounts.filter((row) => row.syncState === "retrying").length;
          const staleCount = accounts.length - currentCount - blockedCount - retryingCount;
          const usableCount = accounts.filter(
            (row) => row.syncState !== "blocked" && row.balance !== null,
          ).length;
          const freshnessState =
            usableCount === 0
              ? "unavailable"
              : currentCount === accounts.length
                ? "current"
                : currentCount > 0
                  ? "partial"
                  : "stale";
          const blockers = accounts
            .filter((row) => row.syncState === "blocked")
            .map((row) => ({
              code: row.syncErrorCode ?? "finance_account_blocked",
              message: row.syncError ?? "A Finance account is blocked.",
              recovery: row.syncRecovery,
            }));
          const byReason: Record<string, number> = {};
          for (const review of scopedReviews)
            byReason[review.reason] = (byReason[review.reason] ?? 0) + 1;
          const questions = health.missingInputs.map((missing) => ({
            code: missing,
            prompt: `Provide ${missing.replaceAll("_", " ")} evidence.`,
          }));
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
              ? { id: approvedProfile.id, version: approvedProfile.version }
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
          const oldestOutstandingAt = reviews[0]?.createdAt.toISOString() ?? null;
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
          return financeStatusSchema.parse({
            activeRun,
            asOf,
            details: {
              accounts: {
                blocked: blockedCount,
                current: currentCount,
                items: serializedAccounts,
                retrying: retryingCount,
                stale: staleCount,
                tracked: accounts.length,
              },
              activeGoals: goals.map(serializeGoal),
              activeMotives: motives.map(serializeMotive),
              budget: {
                approved: budgets.length > 0,
                month: selectedMonth,
                total: evidenceCurrent ? budgetTotal : null,
              },
              cashFlow: { net: evidenceCurrent ? incomeObserved - spending : null },
              health,
              income: { monthly: evidenceCurrent ? monthlyIncome : null },
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
              proposals: [],
              questions,
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
            state,
            validNextOperations:
              blockers.length > 0
                ? [
                    {
                      operation: "reconnect_finance",
                      label: "Reconnect Finance account",
                      href: "/finances/accounts",
                    },
                  ]
                : [
                    {
                      operation: "maintain_finances",
                      label: "Maintain finances",
                      href: "/finances",
                    },
                  ],
            work,
          });
        },
        { accessMode: "read only", isolationLevel: "repeatable read" },
      );
    },
  };
}

export type FinanceStatusService = ReturnType<typeof createFinanceStatusService>;
