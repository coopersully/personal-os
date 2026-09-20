import { createHash } from "node:crypto";
import {
  financeAccounts,
  financeBudgetAllocations,
  financeBudgetPeriodBaselines,
  financeBudgetPlans,
  financeBudgetPolicies,
  financeBudgetPolicyVersions,
  financeBudgetVersions,
  financeCategories,
  financeGoals,
  financeIncomeStreams,
  financeProfileVersions,
} from "@personal-os/database";
import {
  type FinanceBudgetPolicyPlanSnapshot,
  type FinanceBudgetPolicyTerms,
  financeBudgetPolicyPlanSnapshotSchema,
  financeBudgetPolicyTermsSchema,
} from "@personal-os/domain";
import { and, desc, eq } from "drizzle-orm";
import { AppError } from "../errors.js";
import type { FinanceTransaction } from "./context.js";

export function policyHash(value: unknown): string {
  function stable(item: unknown): string {
    if (Array.isArray(item)) return `[${item.map(stable).join(",")}]`;
    if (item !== null && typeof item === "object")
      return `{${Object.entries(item)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`)
        .join(",")}}`;
    return JSON.stringify(item);
  }
  return `sha256:${createHash("sha256").update(stable(value)).digest("hex")}`;
}
export function samePolicyValue(a: unknown, b: unknown) {
  return policyHash(a) === policyHash(b);
}
export function policyRef(row: { id: string; version: number } | undefined) {
  return row ? { id: row.id, revision: String(row.version) } : null;
}
export async function policyBudget(tx: FinanceTransaction, userId: string, id: string) {
  return tx.query.financeBudgetVersions.findFirst({
    where: and(eq(financeBudgetVersions.userId, userId), eq(financeBudgetVersions.id, id)),
  });
}
export async function policyPlan(tx: FinanceTransaction, userId: string, id: string) {
  const row = await tx.query.financeBudgetPlans.findFirst({
    where: and(eq(financeBudgetPlans.userId, userId), eq(financeBudgetPlans.id, id)),
  });
  if (!row) throw new AppError("not_found", "Budget plan not found.");
  return row;
}
export async function policyCurrent(
  tx: FinanceTransaction,
  userId: string,
  planId: string,
  month: string,
) {
  const profile = await tx.query.financeProfileVersions.findFirst({
    where: eq(financeProfileVersions.userId, userId),
    orderBy: desc(financeProfileVersions.version),
  });
  const latest = await tx.query.financeBudgetVersions.findFirst({
    where: and(eq(financeBudgetVersions.userId, userId), eq(financeBudgetVersions.planId, planId)),
    orderBy: desc(financeBudgetVersions.version),
  });
  const active = await tx.query.financeBudgetVersions.findFirst({
    where: and(
      eq(financeBudgetVersions.userId, userId),
      eq(financeBudgetVersions.effectiveFrom, month),
      eq(financeBudgetVersions.status, "active"),
    ),
  });
  return { profile, latest, active };
}
export async function policyRoot(tx: FinanceTransaction, userId: string, id: string, lock = false) {
  const query = tx
    .select()
    .from(financeBudgetPolicies)
    .where(and(eq(financeBudgetPolicies.userId, userId), eq(financeBudgetPolicies.id, id)))
    .limit(1);
  const [row] = await (lock ? query.for("update") : query);
  if (!row) throw new AppError("not_found", "Budget policy not found.");
  const version = await tx.query.financeBudgetPolicyVersions.findFirst({
    where: and(
      eq(financeBudgetPolicyVersions.userId, userId),
      eq(financeBudgetPolicyVersions.policyId, id),
    ),
    orderBy: desc(financeBudgetPolicyVersions.version),
  });
  if (!version) throw new AppError("conflict", "Budget policy terms are unavailable.");
  return { row, version };
}
export async function policyTerms(
  tx: FinanceTransaction,
  version: typeof financeBudgetPolicyVersions.$inferSelect,
): Promise<FinanceBudgetPolicyTerms> {
  const baseline = await policyBudget(tx, version.userId, version.baselineBudgetVersionId);
  if (!baseline) throw new AppError("conflict", "Baseline version is unavailable.");
  return financeBudgetPolicyTermsSchema.parse({
    currency: version.currency,
    period: {
      from: version.periodFrom,
      through: version.periodThrough,
      timezone: version.timezone,
    },
    rollover: version.rollover,
    accounting: version.accounting,
    usageScope: version.usageScope,
    perChangeCapCents: version.perChangeCapCents,
    monthlyCapCents: version.monthlyCapCents,
    expiresAt: version.expiresAt.toISOString(),
    baseline: policyRef(baseline),
    directions: version.directions,
    protections: version.protections,
  });
}
export async function policySnapshot(
  tx: FinanceTransaction,
  row: typeof financeBudgetVersions.$inferSelect | undefined,
): Promise<FinanceBudgetPolicyPlanSnapshot | null> {
  if (!row) return null;
  const allocations = await tx.query.financeBudgetAllocations.findMany({
    where: and(
      eq(financeBudgetAllocations.userId, row.userId),
      eq(financeBudgetAllocations.budgetVersionId, row.id),
    ),
  });
  const parsed = financeBudgetPolicyPlanSnapshotSchema.safeParse({
    userId: row.userId,
    planId: row.planId,
    revision: policyRef(row),
    month: row.effectiveFrom,
    resources: row.resources
      .map((resource) => ({
        key: resource.key,
        kind: resource.kind,
        sourceId: resource.sourceId ?? null,
        amountCents: resource.amount,
      }))
      .sort((a, b) => String(a.key).localeCompare(String(b.key))),
    allocations: allocations
      .map((a) => ({
        key: a.allocationKey,
        kind: a.kind,
        targetId: a.categoryId ?? a.accountId ?? a.goalId ?? null,
        amountCents: a.amount,
      }))
      .sort((a, b) => a.key.localeCompare(b.key)),
  });
  return parsed.success ? parsed.data : null;
}
export async function policyBaseline(
  tx: FinanceTransaction,
  userId: string,
  planId: string,
  terms: Pick<FinanceBudgetPolicyTerms, "period" | "baseline">,
) {
  const designation = await tx.query.financeBudgetPeriodBaselines.findFirst({
    where: and(
      eq(financeBudgetPeriodBaselines.userId, userId),
      eq(financeBudgetPeriodBaselines.periodMonth, terms.period.from.slice(0, 7)),
    ),
  });
  const budget = designation
    ? await policyBudget(tx, userId, designation.budgetVersionId)
    : undefined;
  if (
    !designation ||
    !budget ||
    designation.planId !== planId ||
    designation.periodFrom !== terms.period.from ||
    designation.periodThrough !== terms.period.through ||
    designation.timezone !== terms.period.timezone ||
    !samePolicyValue(policyRef(budget), terms.baseline)
  )
    return null;
  return budget;
}
export async function validatePolicyCandidate(
  tx: FinanceTransaction,
  userId: string,
  planId: string,
  month: string,
  candidate: FinanceBudgetPolicyPlanSnapshot,
) {
  if (candidate.userId !== userId || candidate.planId !== planId || candidate.month !== month)
    throw new AppError("invalid_request", "Candidate must belong to this owner, plan, and period.");
  for (const item of candidate.allocations) {
    if (item.kind === "buffer" && item.targetId !== null)
      throw new AppError("invalid_request", "Buffer allocations cannot target another entity.");
    if (item.targetId === null) {
      if (item.kind === "debt" || item.kind === "goal")
        throw new AppError("invalid_request", "This allocation requires a target.");
      continue;
    }
    const table =
      item.kind === "spending"
        ? financeCategories
        : item.kind === "debt"
          ? financeAccounts
          : financeGoals;
    const [owned] = await tx
      .select({ id: table.id })
      .from(table)
      .where(and(eq(table.id, item.targetId), eq(table.userId, userId)))
      .limit(1);
    if (!owned)
      throw new AppError("invalid_request", "Candidate allocation target is unavailable.");
  }
  for (const item of candidate.resources) {
    if (item.sourceId === null) continue;
    const table = item.kind === "income" ? financeIncomeStreams : financeAccounts;
    const [owned] = await tx
      .select({ id: table.id })
      .from(table)
      .where(and(eq(table.id, item.sourceId), eq(table.userId, userId)))
      .limit(1);
    if (!owned) throw new AppError("invalid_request", "Candidate resource source is unavailable.");
  }
}
