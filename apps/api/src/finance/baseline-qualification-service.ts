import {
  auditEvents,
  type Database,
  financeAccounts,
  financeBudgetBaselineQualifications,
  financeBudgetBaselineReviews,
  financeBudgetPeriodBaselines,
  financeBudgetVersions,
} from "@personal-os/database";
import {
  confirmFinanceBudgetBaselineQualificationInputSchema,
  type FinanceBudgetBaselineQualificationRead,
  financeBudgetBaselineQualificationSchema,
  financeBudgetBaselineReviewSchema,
  financeBudgetBaselineSnapshotSchema,
  financeMonthSchema,
  prepareFinanceBudgetBaselineQualificationInputSchema,
} from "@personal-os/domain";
import { and, desc, eq, inArray } from "drizzle-orm";
import { auditValues } from "../audit.js";
import { AppError } from "../errors.js";
import {
  baselineQualificationKind,
  prepareBaselineEvidence,
} from "./baseline-qualification-evidence.js";
import { requireBudgetApproval } from "./budget-authority.js";
import {
  executeFinanceIdempotently,
  type FinanceMutationContext,
  requireFinanceExecution,
} from "./context.js";

function project(row: typeof financeBudgetBaselineQualifications.$inferSelect) {
  return financeBudgetBaselineQualificationSchema.parse({
    ...row.snapshot,
    id: row.id,
    revision: 1,
    confirmedAt: row.confirmedAt.toISOString(),
    confirmedByActorId: row.confirmedByActorId,
    ...(row.confirmedByActorType === "agent" ? { confirmedByActorType: "agent" } : {}),
    qualificationKind: row.qualificationKind,
  });
}
const unavailable = (
  reason:
    | "qualification_required"
    | "baseline_missing"
    | "baseline_incomplete"
    | "scope_unavailable",
): Extract<FinanceBudgetBaselineQualificationRead, { state: "unavailable" }> => ({
  state: "unavailable",
  reason,
  qualificationRequired: true,
  candidates: [],
});

/** Exact qualification of a comparison baseline. It never changes an active allocation. */
export function createFinanceBudgetBaselineQualificationService({
  db,
  now,
}: {
  db: Database;
  now: () => Date;
}) {
  return {
    async getQualification(
      userId: string,
      monthValue: string,
    ): Promise<FinanceBudgetBaselineQualificationRead> {
      const month = financeMonthSchema.parse(monthValue);
      return db.transaction(
        async (tx) => {
          const row = await tx.query.financeBudgetBaselineQualifications.findFirst({
            where: and(
              eq(financeBudgetBaselineQualifications.userId, userId),
              eq(financeBudgetBaselineQualifications.periodMonth, month),
            ),
          });
          if (!row) {
            const designation = await tx.query.financeBudgetPeriodBaselines.findFirst({
              where: and(
                eq(financeBudgetPeriodBaselines.userId, userId),
                eq(financeBudgetPeriodBaselines.periodMonth, month),
              ),
            });
            const versions = await tx
              .select()
              .from(financeBudgetVersions)
              .where(
                and(
                  eq(financeBudgetVersions.userId, userId),
                  eq(financeBudgetVersions.effectiveFrom, month),
                  ...(designation
                    ? [eq(financeBudgetVersions.id, designation.budgetVersionId)]
                    : []),
                ),
              )
              .orderBy(
                desc(financeBudgetVersions.approvedAt),
                desc(financeBudgetVersions.version),
                financeBudgetVersions.id,
              )
              .limit(100);
            const candidates = versions
              .filter(
                (version) =>
                  version.approvedAt &&
                  ["active", "retired"].includes(version.status) &&
                  version.balanceDelta === 0 &&
                  version.expectedResources === version.allocatedTotal,
              )
              .map((version) => ({
                budgetVersionId: version.id,
                planId: version.planId,
                budgetVersion: version.version,
                approvedAt: (version.approvedAt as Date).toISOString(),
                originalActorType: version.approvedByActorType,
                period: designation
                  ? {
                      from: designation.periodFrom,
                      through: designation.periodThrough,
                      timezone: designation.timezone,
                    }
                  : null,
              }));
            return {
              ...unavailable(
                !versions.length
                  ? "baseline_missing"
                  : !candidates.length
                    ? "baseline_incomplete"
                    : "qualification_required",
              ),
              candidates,
            };
          }
          const qualification = project(row);
          const accounts = await tx
            .select({ id: financeAccounts.id, currency: financeAccounts.currencyCode })
            .from(financeAccounts)
            .where(
              and(
                eq(financeAccounts.userId, userId),
                inArray(financeAccounts.id, qualification.accountIds),
              ),
            );
          if (accounts.length !== qualification.accountIds.length)
            return unavailable("scope_unavailable");
          return { state: "qualified", qualification };
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
    },
    async prepare(value: unknown, context: FinanceMutationContext) {
      const input = prepareFinanceBudgetBaselineQualificationInputSchema.parse(value);
      return executeFinanceIdempotently(
        db,
        context,
        {
          idempotencyKey: input.idempotencyKey,
          operation: "budget_baseline.prepare",
          payload: input,
          requireUserAdmission: true,
          lockIdentities: [`finance-profile:${context.userId}`],
        },
        async (tx) => {
          const evidence = await prepareBaselineEvidence(tx, context.userId, input);
          const [row] = await tx
            .insert(financeBudgetBaselineReviews)
            .values({
              userId: context.userId,
              periodMonth: input.month,
              planId: evidence.snapshot.planId,
              budgetVersionId: input.budgetVersionId,
              ...evidence,
              createdAt: now(),
            })
            .returning();
          if (!row)
            throw new AppError("internal_error", "The budget baseline review was not saved.");
          await tx.insert(auditEvents).values(
            auditValues({
              action: "finance.budget_baseline_review_prepared",
              entityId: row.id,
              entityType: "finance_budget_baseline_review",
              before: null,
              after: {
                month: input.month,
                budgetVersionId: input.budgetVersionId,
                fingerprint: row.fingerprint,
                accountCount: input.accountIds.length,
              },
              principal: context,
              requestId: context.requestId,
            }),
          );
          return financeBudgetBaselineReviewSchema.parse({
            id: row.id,
            fingerprint: row.fingerprint,
            snapshot: row.snapshot,
          });
        },
      );
    },
    async confirm(
      value: unknown,
      context: FinanceMutationContext,
    ): Promise<FinanceBudgetBaselineQualificationRead> {
      requireBudgetApproval(
        {
          ...context,
          scopes:
            context.actorType === "agent"
              ? (context.executionPrincipal?.scopes ?? new Set())
              : new Set(context.canMutate ? ["finances:write"] : []),
        },
        context.bypassEnabled,
      );
      const input = confirmFinanceBudgetBaselineQualificationInputSchema.parse(value);
      if (context.actorType === "agent") context.requiresApprovalBypass = true;
      return executeFinanceIdempotently(
        db,
        context,
        {
          idempotencyKey: input.idempotencyKey,
          operation: "budget_baseline.confirm",
          payload: input,
          requireUserAdmission: true,
          lockIdentities: [`finance-profile:${context.userId}`],
        },
        async (tx) => {
          await requireFinanceExecution(tx, context, now());
          const [review] = await tx
            .select()
            .from(financeBudgetBaselineReviews)
            .where(
              and(
                eq(financeBudgetBaselineReviews.userId, context.userId),
                eq(financeBudgetBaselineReviews.id, input.reviewId),
              ),
            )
            .for("update");
          if (!review) throw new AppError("not_found", "The budget baseline review was not found.");
          if (review.fingerprint !== input.expectedFingerprint)
            throw new AppError("conflict", "Confirm the exact displayed baseline review.");
          const existing = await tx.query.financeBudgetBaselineQualifications.findFirst({
            where: and(
              eq(financeBudgetBaselineQualifications.userId, context.userId),
              eq(financeBudgetBaselineQualifications.periodMonth, review.periodMonth),
            ),
          });
          if (existing) {
            if (existing.reviewId !== review.id)
              throw new AppError(
                "conflict",
                "This month's comparison baseline is already confirmed and cannot be replaced.",
              );
            return { state: "qualified" as const, qualification: project(existing) };
          }
          const snapshot = financeBudgetBaselineSnapshotSchema.parse(review.snapshot);
          const current = await prepareBaselineEvidence(tx, context.userId, {
            accountIds: snapshot.accountIds,
            budgetVersionId: snapshot.budgetVersionId,
            currency: snapshot.currency,
            month: snapshot.month,
            timezone: snapshot.period.timezone,
          });
          if (
            current.fingerprint !== review.fingerprint ||
            current.sourceFingerprint !== review.sourceFingerprint
          )
            throw new AppError(
              "conflict",
              "Budget or account evidence changed; review the monthly baseline again.",
            );
          const confirmedAt = now();
          const [row] = await tx
            .insert(financeBudgetBaselineQualifications)
            .values({
              userId: context.userId,
              periodMonth: snapshot.month,
              reviewId: review.id,
              snapshot,
              fingerprint: review.fingerprint,
              confirmedByActorId: context.actorId,
              confirmedByActorType: context.actorType === "agent" ? "agent" : "user",
              confirmedAt,
              qualificationKind: baselineQualificationKind(snapshot, confirmedAt, context.userId),
            })
            .returning();
          if (!row)
            throw new AppError(
              "internal_error",
              "The budget baseline qualification was not saved.",
            );
          await tx.insert(auditEvents).values(
            auditValues({
              action: "finance.budget_baseline_qualified",
              entityId: row.id,
              entityType: "finance_budget_baseline_qualification",
              before: null,
              after: {
                reviewId: review.id,
                month: snapshot.month,
                budgetVersionId: snapshot.budgetVersionId,
                fingerprint: review.fingerprint,
                currency: snapshot.currency,
                accountCount: snapshot.accountIds.length,
                qualificationKind: row.qualificationKind,
              },
              principal: context,
              requestId: context.requestId,
            }),
          );
          return { state: "qualified" as const, qualification: project(row) };
        },
      );
    },
  };
}
