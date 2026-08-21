import {
  type Database,
  financeAgentActionReviews,
  financeLedgerChallengeFindings,
  financeLedgerChallenges,
  financeMaintenanceCandidateItems,
  financeMaintenanceCandidates,
  financePeriodReviews,
  financeReimbursements,
  financeTransactionAllocations,
  financeTransactions,
  workspaceMaintenanceRuns,
} from "@personal-os/database";
import {
  type FinancePeriodReview,
  type FinanceStatus,
  financeCandidateLedgerProjectionSchema,
  financePeriodReviewSchema,
  type MaintenanceScope,
} from "@personal-os/domain";
import { and, asc, desc, eq } from "drizzle-orm";
import { AppError } from "./errors.js";

type StatusReader = {
  getFinanceStatus: (
    userId: string,
    scope: MaintenanceScope,
    executor?: Parameters<Parameters<Database["transaction"]>[0]>[0],
  ) => Promise<FinanceStatus>;
};
type Options = { db: Database; now: () => Date; status: StatusReader };

function periodFor(scope: MaintenanceScope, now: Date) {
  if (scope.type === "window") return { end: scope.end, start: scope.start };
  const month = now.toISOString().slice(0, 7);
  const start = `${month}-01`;
  const endDate = new Date(`${start}T00:00:00.000Z`);
  endDate.setUTCMonth(endDate.getUTCMonth() + 1);
  endDate.setUTCDate(0);
  return { end: endDate.toISOString().slice(0, 10), start };
}

function serialize(row: typeof financePeriodReviews.$inferSelect): FinancePeriodReview {
  return financePeriodReviewSchema.parse({
    ...(row.report as Record<string, unknown>),
    createdAt: row.createdAt.toISOString(),
    cutoff: row.cutoff.toISOString(),
    id: row.id,
    period: { end: row.periodEnd, start: row.periodStart },
    runId: row.runId,
    sourceIds: row.sourceIds,
    status: row.status,
    userId: row.userId,
  });
}

/** Reproducible, immutable close report created only after challenged work commits. */
export function createFinancePeriodReviewService({ db, now, status }: Options) {
  return {
    async createForRun(userId: string, runId: string): Promise<FinancePeriodReview> {
      return db.transaction(
        async (tx) => {
          const [existing] = await tx
            .select()
            .from(financePeriodReviews)
            .where(
              and(eq(financePeriodReviews.runId, runId), eq(financePeriodReviews.userId, userId)),
            )
            .limit(1);
          if (existing) return serialize(existing);
          const [run] = await tx
            .select()
            .from(workspaceMaintenanceRuns)
            .where(
              and(
                eq(workspaceMaintenanceRuns.id, runId),
                eq(workspaceMaintenanceRuns.userId, userId),
              ),
            )
            .limit(1);
          if (!run) throw new AppError("not_found", "The Finance maintenance run was not found.");
          const observed = await status.getFinanceStatus(userId, run.scope, tx);
          if (
            observed.freshness.state !== "current" ||
            observed.freshness.blockers.length > 0 ||
            observed.details.rulebookVersion !== run.rulebookVersion
          )
            throw new AppError(
              "conflict",
              "Finance verification is not current enough to publish.",
            );
          const [candidate] = await tx
            .select()
            .from(financeMaintenanceCandidates)
            .where(
              and(
                eq(financeMaintenanceCandidates.runId, runId),
                eq(financeMaintenanceCandidates.userId, userId),
                eq(financeMaintenanceCandidates.state, "committed"),
              ),
            )
            .limit(1);
          if (!candidate)
            throw new AppError("conflict", "A committed Finance candidate is required.");
          const [challenge] = await tx
            .select()
            .from(financeLedgerChallenges)
            .where(
              and(
                eq(financeLedgerChallenges.runId, runId),
                eq(financeLedgerChallenges.userId, userId),
                eq(financeLedgerChallenges.candidateId, candidate.id),
                eq(financeLedgerChallenges.state, "resolved"),
              ),
            )
            .limit(1);
          if (!challenge || challenge.candidateRevision !== candidate.revision)
            throw new AppError("conflict", "A resolved ledger challenge is required.");
          const items = await tx
            .select()
            .from(financeMaintenanceCandidateItems)
            .where(eq(financeMaintenanceCandidateItems.candidateId, candidate.id))
            .orderBy(asc(financeMaintenanceCandidateItems.ordinal));
          const findings = await tx
            .select()
            .from(financeLedgerChallengeFindings)
            .where(eq(financeLedgerChallengeFindings.challengeId, challenge.id));
          const transactions = await tx
            .select()
            .from(financeTransactions)
            .where(eq(financeTransactions.userId, userId));
          const allocations = await tx
            .select()
            .from(financeTransactionAllocations)
            .where(eq(financeTransactionAllocations.userId, userId));
          const activeByTransaction = new Map<string, number>();
          for (const allocation of allocations) {
            if (allocation.state !== "active") continue;
            activeByTransaction.set(
              allocation.transactionId,
              (activeByTransaction.get(allocation.transactionId) ?? 0) + allocation.amount,
            );
          }
          for (const transaction of transactions) {
            const total = activeByTransaction.get(transaction.id);
            if (total !== undefined && total !== transaction.amount)
              throw new AppError("conflict", "A Finance allocation total is inconsistent.");
          }
          const reimbursements = await tx
            .select()
            .from(financeReimbursements)
            .where(eq(financeReimbursements.userId, userId));
          if (reimbursements.some((row) => row.receivedAmount > row.expectedAmount))
            throw new AppError("conflict", "A reimbursement exceeds its expected amount.");
          const reviews = await tx
            .select()
            .from(financeAgentActionReviews)
            .where(eq(financeAgentActionReviews.maintenanceRunId, runId));
          const projection = financeCandidateLedgerProjectionSchema.parse(candidate.projection);
          const cash = observed.details.wealth.cash;
          const net = observed.details.cashFlow.net;
          const closing = cash;
          const opening = cash === null || net === null ? null : cash - net;
          const income = observed.details.income.monthly;
          const personal = projection.personalSpending;
          const questions =
            items.filter((item) => item.disposition === "question").length +
            observed.details.questions.length;
          const report = {
            challenge: {
              checked: (challenge.coverage as { checked?: string[] }).checked ?? [],
              findings: findings.length,
              observations: findings.filter((finding) => finding.kind === "observation").length,
            },
            closeReadiness: observed.details.closeReadiness,
            goalsAndDebt: {
              activeGoals: observed.details.activeGoals.length,
              debt: observed.details.wealth.debt,
              netWorth: observed.details.wealth.netWorth,
            },
            income,
            monitoring: {
              href: "/finances/reviews",
              responsibility:
                "Ilo will monitor new ledger activity and surface evidence gaps instead of guessing.",
            },
            position: {
              cashLowPoint: observed.details.cashFlow.projectedLowestBalance,
              closing,
              opening,
            },
            recommendations: [
              {
                assumptions: ["Only posted, current ledger evidence is treated as reliable."],
                disposition: observed.details.closeReadiness.ready ? "ready" : "monitor",
                evidence: [
                  `${observed.details.closeReadiness.uncategorized} uncategorized transactions`,
                  `${observed.details.reimbursements.outstanding} outstanding reimbursements`,
                ],
                recommendation: observed.details.closeReadiness.ready
                  ? "Keep the current plan and review new exceptions as they arrive."
                  : "Resolve the remaining ledger exceptions before treating the period as closed.",
                tradeoffs: ["Waiting for evidence preserves ledger accuracy."],
              },
            ],
            reimbursements: observed.details.reimbursements,
            spending: {
              budgetVariance: projection.budgetVariance,
              gross: projection.grossCashSpending,
              personal,
              savings: income === null ? null : income - personal,
            },
            work: {
              approvals: reviews.filter((review) => review.status === "applied").length,
              exceptions: observed.details.closeReadiness.unansweredExceptions,
              questions,
              rulesAndActions: items.filter((item) => item.disposition === "committed").length,
            },
          };
          const sourceIds = [
            candidate.id,
            challenge.id,
            ...items.map((item) => item.id),
            ...findings.map((finding) => finding.id),
          ];
          const reviewStatus = questions > 0 ? "completed_with_questions" : "completed";
          const period = periodFor(run.scope, now());
          const [created] = await tx
            .insert(financePeriodReviews)
            .values({
              cutoff: new Date(observed.details.evidence.cutoff ?? observed.asOf),
              periodEnd: period.end,
              periodStart: period.start,
              report,
              runId,
              sourceIds,
              status: reviewStatus,
              userId,
            })
            .onConflictDoNothing()
            .returning();
          if (created) return serialize(created);
          const [replayed] = await tx
            .select()
            .from(financePeriodReviews)
            .where(eq(financePeriodReviews.runId, runId))
            .limit(1);
          if (!replayed) throw new Error("The Finance period review could not be published.");
          return serialize(replayed);
        },
        { isolationLevel: "repeatable read" },
      );
    },

    async getOwned(userId: string, reviewId: string) {
      const [row] = await db
        .select()
        .from(financePeriodReviews)
        .where(and(eq(financePeriodReviews.id, reviewId), eq(financePeriodReviews.userId, userId)))
        .limit(1);
      if (!row) throw new AppError("not_found", "The Finance period review was not found.");
      return serialize(row);
    },

    async getLatest(userId: string) {
      const [row] = await db
        .select()
        .from(financePeriodReviews)
        .where(eq(financePeriodReviews.userId, userId))
        .orderBy(desc(financePeriodReviews.createdAt), desc(financePeriodReviews.id))
        .limit(1);
      return row ? serialize(row) : null;
    },
  };
}

export type FinancePeriodReviewService = ReturnType<typeof createFinancePeriodReviewService>;
