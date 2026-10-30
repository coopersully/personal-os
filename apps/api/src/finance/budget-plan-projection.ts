import {
  type Database,
  financeBudgetAllocations,
  financeBudgetPlans,
  financeBudgetVersions,
  users,
} from "@personal-os/database";
import { type FinanceBudgetPlanContext, financeBudgetPlanContextSchema } from "@personal-os/domain";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  lt,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { AppError } from "../errors.js";

type Reader = Pick<Database, "select">;

export function budgetPlanningDate(now: Date, timezone: string) {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    throw new AppError(
      "service_unavailable",
      "Finance planning timezone is unavailable. Set a valid planning timezone and retry.",
    );
  }
  const parts = formatter.formatToParts(now);
  const value = (part: string) => parts.find((item) => item.type === part)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

/** No fallback on read errors: unavailable evidence must not become a missing plan. */
async function loadBudgetPlanContext(
  reader: Reader,
  userId: string,
  now: Date,
): Promise<FinanceBudgetPlanContext> {
  const [owner] = await reader
    .select({ timezone: users.planningTimezone })
    .from(users)
    .where(eq(users.id, userId));
  if (!owner) throw new AppError("not_found", "The budget owner was not found.");
  const month = budgetPlanningDate(now, owner.timezone).slice(0, 7);
  const approved = and(
    inArray(financeBudgetVersions.status, ["active", "retired"]),
    isNotNull(financeBudgetVersions.approvedAt),
    eq(financeBudgetVersions.balanceDelta, 0),
    eq(financeBudgetVersions.expectedResources, financeBudgetVersions.allocatedTotal),
  );
  const query = () =>
    reader
      .select({ version: financeBudgetVersions })
      .from(financeBudgetVersions)
      .innerJoin(
        financeBudgetPlans,
        and(
          eq(financeBudgetPlans.id, financeBudgetVersions.planId),
          eq(financeBudgetPlans.userId, userId),
        ),
      );
  const owned = eq(financeBudgetVersions.userId, userId);
  const latest = [
    desc(financeBudgetVersions.approvedAt),
    desc(financeBudgetVersions.version),
    desc(financeBudgetVersions.id),
  ];
  // Retirement of October on approval of November does not erase October's approval history.
  const [current] = await query()
    .where(
      and(
        owned,
        eq(financeBudgetPlans.status, "active"),
        approved,
        eq(financeBudgetVersions.effectiveFrom, month),
      ),
    )
    .orderBy(...latest)
    .limit(1);
  const [previous] = await query()
    .where(and(owned, approved, lt(financeBudgetVersions.effectiveFrom, month)))
    .orderBy(desc(financeBudgetVersions.effectiveFrom), ...latest)
    .limit(1);
  const successor = alias(financeBudgetVersions, "budget_successor");
  const [upcoming] = await query()
    .where(
      and(
        owned,
        eq(financeBudgetPlans.status, "active"),
        notExists(
          reader
            .select({ id: successor.id })
            .from(successor)
            .where(
              and(
                eq(successor.userId, userId),
                eq(successor.planId, financeBudgetVersions.planId),
                gt(successor.version, financeBudgetVersions.version),
              ),
            ),
        ),
        or(
          and(
            eq(financeBudgetVersions.status, "proposed"),
            gte(financeBudgetVersions.effectiveFrom, month),
          ),
          and(approved, gt(financeBudgetVersions.effectiveFrom, month)),
        ),
      ),
    )
    .orderBy(
      asc(financeBudgetVersions.effectiveFrom),
      desc(financeBudgetVersions.createdAt),
      desc(financeBudgetVersions.version),
      desc(financeBudgetVersions.id),
    )
    .limit(1);
  async function summary(row: typeof current) {
    if (!row) return null;
    const version = row.version;
    const [spending] = await reader
      .select({ amount: sql<number>`coalesce(sum(${financeBudgetAllocations.amount}), 0)::bigint` })
      .from(financeBudgetAllocations)
      .where(
        and(
          eq(financeBudgetAllocations.userId, userId),
          eq(financeBudgetAllocations.budgetVersionId, version.id),
          eq(financeBudgetAllocations.kind, "spending"),
        ),
      );
    return {
      id: version.id,
      planId: version.planId,
      version: version.version,
      effectiveFrom: version.effectiveFrom,
      status: version.status,
      approvedAt: version.approvedAt?.toISOString() ?? null,
      profileVersionId: version.profileVersionId,
      expectedResources: version.expectedResources / 100,
      allocatedTotal: version.allocatedTotal / 100,
      spendingTotal: Number(spending?.amount ?? 0) / 100,
    };
  }
  return financeBudgetPlanContextSchema.parse({
    month,
    timezone: owner.timezone,
    state: current ? "approved" : "missing",
    recovery: current
      ? "none"
      : upcoming?.version.status === "proposed" && upcoming.version.effectiveFrom === month
        ? "review_proposal"
        : "create_proposal",
    current: await summary(current),
    previous: await summary(previous),
    upcoming: await summary(upcoming),
  });
}

/** Preserve typed denials, but report failed canonical evidence as unavailable, never absent. */
export async function readBudgetPlanContext(
  reader: Reader,
  userId: string,
  now: Date,
): Promise<FinanceBudgetPlanContext> {
  try {
    return await loadBudgetPlanContext(reader, userId, now);
  } catch (error) {
    if (error instanceof AppError) throw error;
    const unavailable = new AppError(
      "service_unavailable",
      "Finance budget evidence is unavailable. Refresh the plan and retry.",
      { recovery: "refresh_plan" },
    );
    unavailable.cause = error;
    throw unavailable;
  }
}
