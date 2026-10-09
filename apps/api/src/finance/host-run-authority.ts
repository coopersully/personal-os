import {
  accessTokens,
  automationHostSchedules,
  type Database,
  type workspaceMaintenanceRuns,
} from "@personal-os/database";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import { AppError } from "../errors.js";
import type { Principal } from "../types.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** A saved host run never acquires authority from a different connection. */
export async function requireHostRunAuthority(
  tx: Transaction,
  run: typeof workspaceMaintenanceRuns.$inferSelect,
  principal: Principal,
  now: Date,
) {
  if (!run.automationScheduleId && !run.authorizationConnectionId) return;
  if (
    !run.automationScheduleId ||
    !run.authorizationConnectionId ||
    principal.actorType !== "agent" ||
    !principal.scopes.has("finances:maintain") ||
    principal.authorizationConnectionId !== run.authorizationConnectionId
  )
    throw new AppError("forbidden", "Use this run's original active host connection.");
  const [schedule] = await tx
    .select()
    .from(automationHostSchedules)
    .where(
      and(
        eq(automationHostSchedules.id, run.automationScheduleId),
        eq(automationHostSchedules.userId, run.userId),
      ),
    )
    .for("share");
  const [token] = await tx
    .select()
    .from(accessTokens)
    .where(
      and(
        eq(accessTokens.id, principal.actorId),
        eq(accessTokens.userId, run.userId),
        isNull(accessTokens.revokedAt),
        or(isNull(accessTokens.expiresAt), gt(accessTokens.expiresAt, now)),
      ),
    )
    .for("share");
  if (
    schedule?.schedule.state !== "active" ||
    schedule.authorizationConnectionId !== run.authorizationConnectionId ||
    !token ||
    token.authorizationConnectionId !== run.authorizationConnectionId ||
    !token.scopes.includes("finances:maintain")
  )
    throw new AppError("forbidden", "Use this run's original active host connection.");
}
