import {
  accessTokens,
  automationHostSchedules,
  type Database,
  financeAgentActionReviews,
  financeLedgerChallenges,
  financeMaintenanceCandidates,
  financeMaintenanceExecutionBindings,
  users,
  workspaceMaintenanceRuns,
} from "@personal-os/database";
import { and, asc, eq, inArray, or, type SQL, sql } from "drizzle-orm";
import { activeHostConnectionGrant } from "../automation-host-grant.js";
import { AppError } from "../errors.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
const guards = new WeakMap<
  object,
  { ownerId: string; tokenIds: Set<string> | null; connectionIds: Set<string> }
>();
export type FinanceTokenLockPlan = {
  actorIds?: readonly string[];
  connectionIds?: readonly string[];
  runIds?: readonly string[];
  hostSchedules?: boolean;
  candidateIds?: readonly string[];
  challengeIds?: readonly string[];
  reviewIds?: readonly string[];
};
/** FIRST operation of the real owning transaction; no grant advisory or token authority. */
export async function lockFinanceExecutionOwner(tx: Transaction, ownerId: string) {
  const existing = guards.get(tx);
  if (existing) {
    if (existing.ownerId !== ownerId)
      throw new AppError("forbidden", "A Finance transaction cannot cross owners.");
    return;
  }
  const [owner] = await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, ownerId))
    .for("no key update");
  if (!owner) throw new AppError("not_found", "The Finance owner is unavailable.");
  guards.set(tx, { ownerId, tokenIds: null, connectionIds: new Set() });
}
/** Gather metadata after parent guard, BEFORE source/domain/token locks. */
export async function lockFinanceExecutionTokens(
  tx: Transaction,
  ownerId: string,
  plan: FinanceTokenLockPlan,
) {
  const guard = guards.get(tx);
  if (!guard || guard.ownerId !== ownerId)
    throw new AppError("internal_error", "Establish the Finance owner guard before token locks.");
  const connections = new Set(plan.connectionIds ?? []);
  const actors = new Set(
    (plan.actorIds ?? []).filter((id) => /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)),
  );
  const runs = new Set(plan.runIds ?? []);
  if (plan.candidateIds?.length) {
    const rows = await tx
      .select({ runId: financeMaintenanceCandidates.runId })
      .from(financeMaintenanceCandidates)
      .where(
        and(
          eq(financeMaintenanceCandidates.userId, ownerId),
          inArray(financeMaintenanceCandidates.id, [...plan.candidateIds]),
        ),
      );
    for (const row of rows) runs.add(row.runId);
  }
  if (plan.challengeIds?.length) {
    const rows = await tx
      .select({ runId: financeLedgerChallenges.runId })
      .from(financeLedgerChallenges)
      .where(
        and(
          eq(financeLedgerChallenges.userId, ownerId),
          inArray(financeLedgerChallenges.id, [...plan.challengeIds]),
        ),
      );
    for (const row of rows) runs.add(row.runId);
  }
  if (plan.reviewIds?.length) {
    const rows = await tx
      .select({
        runId: financeAgentActionReviews.maintenanceRunId,
        actorId: financeAgentActionReviews.requestingAgentId,
      })
      .from(financeAgentActionReviews)
      .where(
        and(
          eq(financeAgentActionReviews.userId, ownerId),
          inArray(financeAgentActionReviews.id, [...plan.reviewIds]),
        ),
      );
    for (const row of rows) {
      if (row.runId) runs.add(row.runId);
      if (/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(row.actorId)) actors.add(row.actorId);
    }
  }
  if (runs.size) {
    const rows = await tx
      .select({ actorId: financeLedgerChallenges.submittingAgentId })
      .from(financeLedgerChallenges)
      .where(
        and(
          eq(financeLedgerChallenges.userId, ownerId),
          inArray(financeLedgerChallenges.runId, [...runs]),
        ),
      );
    for (const row of rows)
      if (row.actorId && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(row.actorId))
        actors.add(row.actorId);
    const bindings = await tx
      .select({
        original: financeMaintenanceExecutionBindings.originalActorId,
        current: financeMaintenanceExecutionBindings.currentActorId,
      })
      .from(financeMaintenanceExecutionBindings)
      .where(
        and(
          eq(financeMaintenanceExecutionBindings.userId, ownerId),
          inArray(financeMaintenanceExecutionBindings.runId, [...runs]),
        ),
      );
    for (const row of bindings) {
      actors.add(row.original);
      actors.add(row.current);
    }
  }

  if (runs.size) {
    const rows = await tx
      .select({ connectionId: workspaceMaintenanceRuns.authorizationConnectionId })
      .from(workspaceMaintenanceRuns)
      .where(
        and(
          eq(workspaceMaintenanceRuns.userId, ownerId),
          inArray(workspaceMaintenanceRuns.id, [...runs]),
        ),
      );
    for (const row of rows) if (row.connectionId) connections.add(row.connectionId);
  }
  if (plan.hostSchedules) {
    const rows = await tx
      .select({ connectionId: automationHostSchedules.authorizationConnectionId })
      .from(automationHostSchedules)
      .where(eq(automationHostSchedules.userId, ownerId));
    for (const row of rows) connections.add(row.connectionId);
  }
  if (guard.tokenIds) {
    if (
      [...actors].some((id) => !guard.tokenIds?.has(id)) ||
      [...connections].some((id) => !guard.connectionIds.has(id))
    )
      throw new AppError(
        "conflict",
        "The complete Finance token lock plan must be established at its outer boundary.",
      );
    return;
  }
  const predicates: SQL[] = [];
  if (actors.size) predicates.push(inArray(accessTokens.id, [...actors]));
  if (connections.size)
    predicates.push(
      and(
        inArray(accessTokens.authorizationConnectionId, [...connections]),
        activeHostConnectionGrant(new Date()),
      ) as SQL,
    );
  const ids = predicates.length
    ? (
        await tx
          .select({ id: accessTokens.id })
          .from(accessTokens)
          .where(and(eq(accessTokens.userId, ownerId), or(...predicates)))
          .orderBy(asc(accessTokens.id))
          .for("share")
      ).map((row) => row.id)
    : [];
  guard.tokenIds = new Set(ids);
  guard.connectionIds = connections;
}
export function financeExecutionTokenSnapshot(tx: Transaction, ownerId: string) {
  const guard = guards.get(tx);
  if (!guard || guard.ownerId !== ownerId || !guard.tokenIds)
    throw new AppError("internal_error", "Finance authority requires its outer token lock plan.");
  return [...guard.tokenIds];
}
export async function withFinanceExecutionOwner<T>(
  db: Database,
  ownerId: string,
  plan: FinanceTokenLockPlan,
  run: (tx: Transaction) => Promise<T>,
  executor?: Transaction,
): Promise<T> {
  if (executor) {
    const guard = guards.get(executor);
    if (!guard || guard.ownerId !== ownerId || !guard.tokenIds)
      throw new AppError(
        "internal_error",
        "A caller-owned Finance transaction must propagate its original guard.",
      );
    await lockFinanceExecutionTokens(executor, ownerId, plan);
    return run(executor);
  }
  return db.transaction(async (tx) => {
    await lockFinanceExecutionOwner(tx, ownerId);
    await lockFinanceExecutionTokens(tx, ownerId, plan);
    return run(tx);
  });
}
/** Actual post-lock wall clock; transaction-start NOW is not an expiry proof. */
export async function financeExecutionDecisionTime(tx: Transaction): Promise<Date> {
  const result = await tx.execute(sql`select clock_timestamp() as at`);
  return new Date(result.rows[0]?.at as string | Date);
}

export async function guardFinanceExecutionTransaction(
  tx: Transaction,
  ownerId: string,
  plan: FinanceTokenLockPlan,
) {
  await lockFinanceExecutionOwner(tx, ownerId);
  await lockFinanceExecutionTokens(tx, ownerId, plan);
}

export function requireFinanceExecutionGuard(tx: Transaction, ownerId: string) {
  const guard = guards.get(tx);
  if (!guard || guard.ownerId !== ownerId || !guard.tokenIds)
    throw new AppError(
      "internal_error",
      "The caller-owned transaction must establish its Finance guard before all other locks.",
    );
}
