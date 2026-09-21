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
export async function policyPlan(tx: FinanceTransaction, userId: string, id: string, lock = false) {
  const query = tx
    .select()
    .from(financeBudgetPlans)
    .where(and(eq(financeBudgetPlans.userId, userId), eq(financeBudgetPlans.id, id)))
    .limit(1);
  const [row] = await (lock ? query.for("update") : query);
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
const dependencyTables = {
  finance_accounts: financeAccounts,
  finance_categories: financeCategories,
  finance_goals: financeGoals,
  finance_income_streams: financeIncomeStreams,
};

/** A single union avoids acquiring the same account in resource and allocation order. */
function candidateDependencies(candidate: FinanceBudgetPolicyPlanSnapshot) {
  const entries = new Map<string, { table: keyof typeof dependencyTables; id: string }>();
  const add = (table: keyof typeof dependencyTables, id: string | null) => {
    if (id !== null) {
      const canonicalId = id.toLowerCase();
      entries.set(`${table}:${canonicalId}`, { table, id: canonicalId });
    }
  };
  for (const item of candidate.allocations)
    add(
      item.kind === "spending"
        ? "finance_categories"
        : item.kind === "debt"
          ? "finance_accounts"
          : "finance_goals",
      item.targetId,
    );
  for (const item of candidate.resources)
    add(item.kind === "income" ? "finance_income_streams" : "finance_accounts", item.sourceId);
  return [...entries.values()].sort(
    (a, b) => a.table.localeCompare(b.table) || a.id.localeCompare(b.id),
  );
}

export async function policyDependenciesAvailable(
  tx: FinanceTransaction,
  userId: string,
  candidate: FinanceBudgetPolicyPlanSnapshot,
  lock = false,
) {
  for (const dependency of candidateDependencies(candidate)) {
    const table = dependencyTables[dependency.table];
    const query = tx
      .select({ id: table.id })
      .from(table)
      .where(and(eq(table.id, dependency.id), eq(table.userId, userId)))
      .limit(1);
    const [owned] = await (lock ? query.for("key share") : query);
    if (!owned) return false;
  }
  return true;
}

export async function validatePolicyCandidate(
  tx: FinanceTransaction,
  userId: string,
  planId: string,
  month: string,
  candidate: FinanceBudgetPolicyPlanSnapshot,
  lock = false,
) {
  if (candidate.userId !== userId || candidate.planId !== planId || candidate.month !== month)
    throw new AppError("invalid_request", "Candidate must belong to this owner, plan, and period.");
  for (const item of candidate.allocations) {
    if (item.kind === "buffer" && item.targetId !== null)
      throw new AppError("invalid_request", "Buffer allocations cannot target another entity.");
    if (item.targetId === null && (item.kind === "debt" || item.kind === "goal"))
      throw new AppError("invalid_request", "This allocation requires a target.");
  }
  if (!(await policyDependenciesAvailable(tx, userId, candidate, lock)))
    throw new AppError("invalid_request", "Candidate dependency is unavailable.");
}
