import {
  financeAccounts,
  financeBudgetAllocations,
  financeBudgetPeriodBaselines,
  financeBudgetVersions,
  financeCategories,
} from "@personal-os/database";
import {
  type FinanceBudgetBaselineSnapshot,
  financeBudgetBaselineSnapshotSchema,
  type PrepareFinanceBudgetBaselineQualificationInput,
} from "@personal-os/domain";
import { and, eq, inArray } from "drizzle-orm";
import { AppError } from "../errors.js";
import { financeActionFingerprint } from "../finance-action-identity.js";
import type { FinanceTransaction } from "./context.js";

export function baselinePeriod(month: string, timezone: string) {
  const end = new Date(`${month}-01T00:00:00.000Z`);
  end.setUTCMonth(end.getUTCMonth() + 1, 0);
  return { from: `${month}-01`, through: end.toISOString().slice(0, 10), timezone };
}

export function baselineQualificationKind(
  snapshot: FinanceBudgetBaselineSnapshot,
  now: Date,
  ownerId: string,
) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: snapshot.period.timezone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const currentMonth = `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}`;
  const approval = snapshot.originalApproval;
  const currentAuthority =
    approval.actorType === "agent" ||
    (approval.actorType === "user" && approval.actorId === ownerId);
  return snapshot.month < currentMonth || !currentAuthority
    ? ("retrospective" as const)
    : ("current" as const);
}

/** Read every source while holding its lock until the exact reviewed snapshot is committed. */
export async function prepareBaselineEvidence(
  tx: FinanceTransaction,
  userId: string,
  input: Omit<PrepareFinanceBudgetBaselineQualificationInput, "idempotencyKey">,
) {
  const [version] = await tx
    .select()
    .from(financeBudgetVersions)
    .where(
      and(
        eq(financeBudgetVersions.id, input.budgetVersionId),
        eq(financeBudgetVersions.userId, userId),
      ),
    )
    .for("update");
  if (!version) throw new AppError("not_found", "The budget version was not found.");
  if (
    version.effectiveFrom !== input.month ||
    !["active", "retired"].includes(version.status) ||
    !version.approvedAt ||
    version.balanceDelta !== 0 ||
    version.expectedResources !== version.allocatedTotal
  )
    throw new AppError("conflict", "Choose a complete previously approved budget for this month.");
  const [designation] = await tx
    .select()
    .from(financeBudgetPeriodBaselines)
    .where(
      and(
        eq(financeBudgetPeriodBaselines.userId, userId),
        eq(financeBudgetPeriodBaselines.periodMonth, input.month),
      ),
    )
    .for("update");
  const period = baselinePeriod(input.month, input.timezone);
  if (
    designation &&
    (designation.budgetVersionId !== version.id ||
      designation.planId !== version.planId ||
      designation.periodFrom !== period.from ||
      designation.periodThrough !== period.through ||
      designation.timezone !== period.timezone)
  )
    throw new AppError(
      "conflict",
      "Use this month's designated baseline and its exact period timezone.",
    );
  const allocations = await tx
    .select()
    .from(financeBudgetAllocations)
    .where(
      and(
        eq(financeBudgetAllocations.userId, userId),
        eq(financeBudgetAllocations.budgetVersionId, version.id),
      ),
    )
    .orderBy(financeBudgetAllocations.id)
    .for("update");
  if (
    !allocations.length ||
    !version.resources.length ||
    allocations.reduce((sum, row) => sum + row.amount, 0) !== version.allocatedTotal ||
    version.resources.reduce((sum, row) => sum + Number(row.amount), 0) !==
      version.expectedResources
  )
    throw new AppError(
      "conflict",
      "The historical budget is incomplete; review a complete budget first.",
    );
  const accounts = await tx
    .select()
    .from(financeAccounts)
    .where(and(eq(financeAccounts.userId, userId), inArray(financeAccounts.id, input.accountIds)))
    .orderBy(financeAccounts.id)
    .for("update");
  if (accounts.length !== input.accountIds.length)
    throw new AppError("not_found", "Every budget account must still belong to you.");
  if (
    accounts.some(
      (account) => account.currencyCode !== null && account.currencyCode !== input.currency,
    )
  )
    throw new AppError(
      "invalid_request",
      "Every budget account must use the explicitly confirmed currency.",
    );
  const spending = allocations.filter((row) => row.kind === "spending");
  if (!spending.length)
    throw new AppError("conflict", "This baseline has no spending allocation to qualify.");
  const categoryIds = [
    ...new Set(spending.flatMap((row) => (row.categoryId ? [row.categoryId] : []))),
  ];
  const categories = categoryIds.length
    ? await tx
        .select()
        .from(financeCategories)
        .where(
          and(eq(financeCategories.userId, userId), inArray(financeCategories.id, categoryIds)),
        )
        .orderBy(financeCategories.id)
        .for("update")
    : [];
  const byCategory = new Map(categories.map((category) => [category.id, category]));
  const snapshot = financeBudgetBaselineSnapshotSchema.parse({
    accountIds: accounts.map((account) => account.id),
    allocations: spending
      .map((allocation) => {
        const category = allocation.categoryId ? byCategory.get(allocation.categoryId) : undefined;
        const label = category?.name ?? allocation.legacyCategory;
        if (!label || (allocation.categoryId && !category))
          throw new AppError(
            "conflict",
            "A historical allocation lost its category evidence; review its baseline before qualifying it.",
          );
        return {
          key: allocation.allocationKey,
          categoryId: allocation.categoryId,
          legacyCategory: allocation.legacyCategory,
          label,
          amountCents: allocation.amount,
        };
      })
      .sort((a, b) => a.key.localeCompare(b.key)),
    budgetVersionId: version.id,
    budgetVersion: version.version,
    planId: version.planId,
    sourceBaselineId: designation?.id ?? null,
    currency: input.currency,
    month: input.month,
    period,
    originalApproval: {
      approvedAt: version.approvedAt.toISOString(),
      actorId: version.approvedByActorId,
      actorType: version.approvedByActorType,
    },
  });
  return {
    snapshot,
    fingerprint: financeActionFingerprint("budget_baseline_qualification", snapshot),
    sourceFingerprint: financeActionFingerprint("budget_baseline_qualification_sources", {
      version: {
        ...version,
        approvedAt: version.approvedAt.toISOString(),
        createdAt: version.createdAt.toISOString(),
        updatedAt: version.updatedAt.toISOString(),
      },
      allocations: allocations.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
      categories: categories.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
      accounts: accounts.map(({ id, currencyCode, updatedAt }) => ({
        id,
        currencyCode,
        updatedAt: updatedAt.toISOString(),
      })),
      designation: designation
        ? { ...designation, confirmedAt: designation.confirmedAt.toISOString() }
        : null,
    }),
  };
}
