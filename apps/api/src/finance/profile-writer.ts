import {
  auditEvents,
  type Database,
  financeAccounts,
  financeCategories,
  financeGoals,
  financeProfileVersions,
} from "@personal-os/database";
import {
  type FinanceProfileVersion,
  type FinanceProvenance,
  financeSetupPlanningSchema,
  financialProfileChangesSchema,
  type UpdateFinancialProfileInput,
} from "@personal-os/domain";
import { and, desc, eq } from "drizzle-orm";
import { auditValues } from "../audit.js";
import { AppError } from "../errors.js";
import { type FinanceMutationContext, requireFinanceMutation } from "./context.js";
import { lockFinanceProfileVersion } from "./profile-version-lock.js";

type ProfileExecutor = Pick<Database, "execute" | "query" | "insert">;
const toCents = (value: number) => Math.round((value + Number.EPSILON) * 100);
const fromCents = (value: number) => value / 100;
const defaultPreferences = {
  bufferTarget: null,
  debtPriority: null,
  emergencyReserveMonths: null,
  notes: [],
};

function provenance(context: FinanceMutationContext, now: Date): FinanceProvenance {
  return {
    actorId: context.actorId,
    actorType: context.actorType,
    confidence: 1,
    evidence: {},
    maintenanceRunId: null,
    observedAt: now.toISOString(),
    requestId: context.requestId,
    sourceId: null,
  };
}

export function profileValue(
  row: typeof financeProfileVersions.$inferSelect,
): FinanceProfileVersion {
  return {
    createdAt: row.createdAt.toISOString(),
    debts: row.debts as FinanceProfileVersion["debts"],
    dependents: row.dependents,
    expectedMonthlyTakeHome:
      row.expectedMonthlyTakeHome === null ? null : fromCents(row.expectedMonthlyTakeHome),
    householdSize: row.householdSize,
    id: row.id,
    incomeStability: row.incomeStability,
    insurance: row.insurance as FinanceProfileVersion["insurance"],
    jurisdiction: row.jurisdiction,
    liquidReserves: row.liquidReserves === null ? null : fromCents(row.liquidReserves),
    preferences: {
      ...defaultPreferences,
      ...row.preferences,
    } as FinanceProfileVersion["preferences"],
    planning: row.planning == null ? null : financeSetupPlanningSchema.parse(row.planning),
    provenance: row.provenance as FinanceProfileVersion["provenance"],
    userId: row.userId,
    version: row.version,
  };
}

/** Caller owns the transaction; profile, source operation, and audit commit together. */
export async function appendFinanceProfile(
  tx: ProfileExecutor,
  input: {
    changes: UpdateFinancialProfileInput["changes"];
    expectedVersion?: number;
  },
  context: FinanceMutationContext,
  now: Date,
  source: Partial<FinanceProvenance> = {},
) {
  requireFinanceMutation(context);
  await lockFinanceProfileVersion(tx, context.userId);
  const before = await tx.query.financeProfileVersions.findFirst({
    orderBy: [desc(financeProfileVersions.version)],
    where: eq(financeProfileVersions.userId, context.userId),
  });
  const currentVersion = before?.version ?? 0;
  if (input.expectedVersion !== undefined && input.expectedVersion !== currentVersion) {
    throw new AppError(
      "conflict",
      `The financial profile is at version ${currentVersion}; reload it before updating.`,
    );
  }
  const observedAt = now;
  const previous = before
    ? profileValue(before)
    : {
        debts: [],
        dependents: null,
        expectedMonthlyTakeHome: null,
        householdSize: null,
        incomeStability: "unknown" as const,
        insurance: [],
        jurisdiction: null,
        liquidReserves: null,
        preferences: { ...defaultPreferences },
        provenance: {},
      };
  const changes = financialProfileChangesSchema.parse(input.changes);
  for (const key of Object.keys(changes) as Array<keyof typeof changes>)
    if (changes[key] === undefined) delete changes[key];
  if (changes.planning) {
    const prior = before?.planning ? financeSetupPlanningSchema.parse(before.planning) : null;
    const authenticatedSource = { ...provenance(context, observedAt), ...source };
    const statement = <T extends { provenance: FinanceProvenance }>(
      item: T,
      old?: T | null,
    ): T => ({
      ...item,
      provenance:
        old &&
        JSON.stringify({ ...old, provenance: null }) ===
          JSON.stringify({ ...item, provenance: null })
          ? old.provenance
          : authenticatedSource,
    });
    changes.planning = financeSetupPlanningSchema.parse({
      ...changes.planning,
      recurringIncome: changes.planning.recurringIncome
        ? statement(changes.planning.recurringIncome, prior?.recurringIncome)
        : null,
      ...Object.fromEntries(
        (
          [
            "uncertainIncome",
            "exceptionalResources",
            "obligations",
            "contributions",
            "priorities",
          ] as const
        ).map((key) => [
          key,
          changes.planning?.[key]?.map((item) =>
            statement(
              item,
              prior?.[key]?.find((old) => old.id === item.id),
            ),
          ) ?? null,
        ]),
      ),
    });
  }
  const next = { ...previous, ...changes };
  const accountIds = new Set(
    (next.debts ?? []).flatMap((debt) => (debt.accountId ? [debt.accountId] : [])),
  );
  for (const item of next.planning?.obligations ?? [])
    if (item.debtAccountId) accountIds.add(item.debtAccountId);
  for (const id of accountIds)
    if (
      !(await tx.query.financeAccounts.findFirst({
        where: and(eq(financeAccounts.id, id), eq(financeAccounts.userId, context.userId)),
      }))
    )
      throw new AppError("invalid_request", "A planning account does not belong to this user.");
  for (const item of next.planning?.contributions ?? [])
    if (
      !(await tx.query.financeGoals.findFirst({
        where: and(eq(financeGoals.id, item.goalId), eq(financeGoals.userId, context.userId)),
      }))
    )
      throw new AppError("invalid_request", "A planning goal does not belong to this user.");
  for (const item of next.planning?.priorities ?? [])
    if (
      item.categoryId &&
      !(await tx.query.financeCategories.findFirst({
        where: and(
          eq(financeCategories.id, item.categoryId),
          eq(financeCategories.userId, context.userId),
        ),
      }))
    )
      throw new AppError("invalid_request", "A planning category does not belong to this user.");
  const nextProvenance = { ...previous.provenance };
  for (const field of Object.keys(changes)) {
    nextProvenance[field] = { ...provenance(context, observedAt), ...source };
  }
  const [row] = await tx
    .insert(financeProfileVersions)
    .values({
      debts: next.debts as unknown as Record<string, unknown>[],
      dependents: next.dependents,
      expectedMonthlyTakeHome:
        next.expectedMonthlyTakeHome == null ? null : toCents(next.expectedMonthlyTakeHome),
      householdSize: next.householdSize,
      incomeStability: next.incomeStability,
      insurance: next.insurance as unknown as Record<string, unknown>[],
      jurisdiction: next.jurisdiction,
      liquidReserves: next.liquidReserves == null ? null : toCents(next.liquidReserves),
      preferences: next.preferences,
      planning: next.planning ?? null,
      employment: before?.employment ?? null,
      sourceLegacyProfileId: before?.sourceLegacyProfileId ?? null,
      provenance: nextProvenance,
      userId: context.userId,
      version: currentVersion + 1,
    })
    .returning();
  if (!row) throw new AppError("internal_error", "The financial profile was not updated.");
  await tx.insert(auditEvents).values(
    auditValues({
      action: "finance.profile.updated",
      after: { changedFields: Object.keys(changes), version: row.version },
      before: before ? { version: before.version } : null,
      entityId: row.id,
      entityType: "finance_profile_version",
      principal: context,
      requestId: context.requestId,
    }),
  );

  return profileValue(row);
}
