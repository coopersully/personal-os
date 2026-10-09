import { providerFetch } from "@personal-os/connectors";
import {
  accessTokens,
  automationHostSchedules,
  type Database,
  financeAnswerContinuations,
  users,
  workspaceMaintenanceRuns,
} from "@personal-os/database";
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { activeHostConnectionGrant } from "./automation-host-grant.js";
import { reconcileFinanceContinuations } from "./finance/continuation-reconciliation.js";
import { decryptJson } from "./security.js";
import type { RequestLog } from "./types.js";

/** Routine fire has no vendor idempotency key. Commit submitting before transport;
 * ambiguity is durable and never retried automatically. Host credentials never authorize Finance. */
export function createFinanceHostDispatcher(options: {
  db: Database;
  now: () => Date;
  encryptionKey: string;
  fetch: typeof globalThis.fetch;
  log?: (entry: RequestLog) => void;
}) {
  const { db, now } = options;
  let scheduleCursor: string | null = null;
  return async (shouldContinue: () => boolean = () => true) => {
    await reconcileFinanceContinuations(db, now());
    const scan = (after: string | null) =>
      db
        .selectDistinctOn([automationHostSchedules.id], {
          continuation: financeAnswerContinuations,
          schedule: automationHostSchedules,
        })
        .from(financeAnswerContinuations)
        .innerJoin(
          automationHostSchedules,
          and(
            eq(automationHostSchedules.id, financeAnswerContinuations.automationScheduleId),
            eq(automationHostSchedules.userId, financeAnswerContinuations.userId),
          ),
        )
        .where(
          and(
            after ? gt(automationHostSchedules.id, after) : undefined,
            sql`NOT EXISTS (
            SELECT 1 FROM finance_answer_continuations f LEFT JOIN workspace_maintenance_runs r ON r.id = f.maintenance_run_id AND r.user_id = f.user_id
            WHERE f.user_id = ${financeAnswerContinuations.userId} AND f.state IN ('pending','accepted') AND f.fire_state IN ('submitting','uncertain','accepted')
            AND NOT COALESCE((f.fire_state = 'accepted' AND r.id IS NOT NULL AND r.status IN ('awaiting_agent_challenge','awaiting_approval','blocked','failed_recoverable') AND r.scope->>'id' = ${financeAnswerContinuations.reviewCaseId}::text),false)
          )`,
            sql`NOT EXISTS (
            SELECT 1 FROM workspace_maintenance_runs r WHERE r.user_id = ${financeAnswerContinuations.userId} AND r.domain = 'finances' AND r.status IN ('queued','running','awaiting_agent_challenge','awaiting_approval','blocked','failed_recoverable')
            AND NOT COALESCE((r.scope->>'type' = 'target' AND r.scope->>'entityType' = 'finance_review_case' AND r.scope->>'id' = ${financeAnswerContinuations.reviewCaseId}::text AND r.automation_schedule_id = ${automationHostSchedules.id} AND r.authorization_connection_id = ${automationHostSchedules.authorizationConnectionId} AND r.status IN ('awaiting_agent_challenge','awaiting_approval','blocked','failed_recoverable') AND r.lease_claim_id IS NULL AND r.lease_expires_at IS NULL),false)
          )`,
            eq(financeAnswerContinuations.state, "pending"),
            eq(financeAnswerContinuations.fireState, "pending"),
            sql`${automationHostSchedules.schedule}->>'hostSurface' = 'claude_code_routine'`,
            sql`${automationHostSchedules.schedule}->>'state' = 'active'`,
            sql`${automationHostSchedules.encryptedFireCredentials} IS NOT NULL`,
            sql`EXISTS (SELECT 1 FROM access_tokens WHERE access_tokens.user_id = ${automationHostSchedules.userId} AND access_tokens.authorization_connection_id = ${automationHostSchedules.authorizationConnectionId} AND ${activeHostConnectionGrant(now())} AND access_tokens.scopes @> '["finances:maintain"]'::jsonb)`,
          ),
        )
        .orderBy(
          asc(automationHostSchedules.id),
          asc(financeAnswerContinuations.createdAt),
          asc(financeAnswerContinuations.id),
        )
        .limit(25);
    let pending = await scan(scheduleCursor);
    if (pending.length === 0 && scheduleCursor) {
      scheduleCursor = null;
      pending = await scan(null);
    }
    let processed = 0;
    for (const { continuation, schedule: initial } of pending) {
      if (!shouldContinue()) break;
      scheduleCursor = initial.id;
      if (initial.schedule.hostSurface !== "claude_code_routine") continue;
      const startedAt = Date.now();
      let diagnostic: RequestLog | undefined;
      const report = (
        outcome: "accepted" | "uncertain" | "unavailable",
        code: string,
        claimCount: number,
        status: number,
      ) => {
        diagnostic = {
          event: "finance_host_handoff",
          method: "POST",
          path: "/internal/finance/host-handoff",
          requestId: continuation.id,
          durationMs: Math.max(0, Date.now() - startedAt),
          hostOutcome: outcome,
          code,
          claimCount,
          status,
        };
      };
      const emit = () => {
        try {
          if (diagnostic) options.log?.(diagnostic);
        } catch {
          /* Logging cannot roll back a committed external handoff. */
        }
      };
      const prepared = await db.transaction(async (tx) => {
        const [owner] = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, continuation.userId))
          .for("no key update", { skipLocked: true });
        if (!owner) return null;
        const [schedule] = await tx
          .select()
          .from(automationHostSchedules)
          .where(
            and(
              eq(automationHostSchedules.id, initial.id),
              eq(automationHostSchedules.userId, continuation.userId),
            ),
          )
          .for("update");
        if (
          schedule?.schedule.state !== "active" ||
          schedule.schedule.hostSurface !== "claude_code_routine" ||
          !schedule.encryptedFireCredentials ||
          !/^trig_[A-Za-z0-9]{10,100}$/.test(schedule.schedule.hostAutomationId)
        )
          return null;
        const [inFlight] = await tx
          .select({ id: financeAnswerContinuations.id })
          .from(financeAnswerContinuations)
          .leftJoin(
            workspaceMaintenanceRuns,
            and(
              eq(workspaceMaintenanceRuns.id, financeAnswerContinuations.maintenanceRunId),
              eq(workspaceMaintenanceRuns.userId, financeAnswerContinuations.userId),
            ),
          )
          .where(
            and(
              eq(financeAnswerContinuations.userId, continuation.userId),
              inArray(financeAnswerContinuations.state, ["pending", "accepted"]),
              inArray(financeAnswerContinuations.fireState, [
                "submitting",
                "uncertain",
                "accepted",
              ]),
              sql`NOT COALESCE((${financeAnswerContinuations.fireState} = 'accepted' AND ${workspaceMaintenanceRuns.id} IS NOT NULL AND ${workspaceMaintenanceRuns.status} IN ('awaiting_agent_challenge','awaiting_approval','blocked','failed_recoverable') AND ${workspaceMaintenanceRuns.scope}->>'id' = ${continuation.reviewCaseId}),false)`,
            ),
          )
          .limit(1);
        if (inFlight) return null;
        const [openRun] = await tx
          .select()
          .from(workspaceMaintenanceRuns)
          .where(
            and(
              eq(workspaceMaintenanceRuns.userId, continuation.userId),
              eq(workspaceMaintenanceRuns.domain, "finances"),
              inArray(workspaceMaintenanceRuns.status, [
                "queued",
                "running",
                "awaiting_agent_challenge",
                "awaiting_approval",
                "blocked",
                "failed_recoverable",
              ]),
            ),
          )
          .limit(1);
        if (
          openRun &&
          !(
            openRun.scope.type === "target" &&
            openRun.scope.entityType === "finance_review_case" &&
            openRun.scope.id === continuation.reviewCaseId &&
            openRun.automationScheduleId === schedule.id &&
            openRun.authorizationConnectionId === schedule.authorizationConnectionId &&
            [
              "awaiting_agent_challenge",
              "awaiting_approval",
              "blocked",
              "failed_recoverable",
            ].includes(openRun.status) &&
            !openRun.leaseClaimId &&
            !openRun.leaseExpiresAt
          )
        )
          return null;
        const tokens = await tx
          .select()
          .from(accessTokens)
          .where(
            and(
              eq(accessTokens.userId, continuation.userId),
              eq(accessTokens.authorizationConnectionId, schedule.authorizationConnectionId),
              activeHostConnectionGrant(now()),
            ),
          )
          .for("share");
        if (!tokens.some((token) => token.scopes.includes("finances:maintain"))) return null;
        let credentials: { token: string };
        try {
          credentials = decryptJson<{ token: string }>(
            schedule.encryptedFireCredentials,
            options.encryptionKey,
          );
          if (!/^sk-ant-oat01-[A-Za-z0-9_-]{10,500}$/.test(credentials.token))
            throw new Error("Invalid trigger credential");
        } catch {
          const unavailable = await tx
            .update(financeAnswerContinuations)
            .set({ fireState: "unavailable", updatedAt: now() })
            .where(
              and(
                eq(financeAnswerContinuations.userId, continuation.userId),
                eq(financeAnswerContinuations.automationScheduleId, schedule.id),
                eq(financeAnswerContinuations.state, "pending"),
                eq(financeAnswerContinuations.fireState, "pending"),
              ),
            )
            .returning({ id: financeAnswerContinuations.id });
          report("unavailable", "credential_unavailable", unavailable.length, 503);
          return null;
        }
        const claimed = await tx
          .update(financeAnswerContinuations)
          .set({ fireState: "submitting", updatedAt: now() })
          .where(
            and(
              eq(financeAnswerContinuations.automationScheduleId, schedule.id),
              eq(financeAnswerContinuations.userId, continuation.userId),
              eq(financeAnswerContinuations.state, "pending"),
              eq(financeAnswerContinuations.fireState, "pending"),
              eq(financeAnswerContinuations.id, continuation.id),
            ),
          )
          .returning();
        return claimed.length
          ? {
              credentials,
              routineId: schedule.schedule.hostAutomationId,
              scheduleId: schedule.id,
              continuationIds: claimed.map((answer) => answer.id),
            }
          : null;
      });
      if (!prepared) {
        emit();
        continue;
      }
      await db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(automationHostSchedules)
          .where(
            and(
              eq(automationHostSchedules.id, prepared.scheduleId),
              eq(automationHostSchedules.userId, continuation.userId),
            ),
          )
          .for("share");
        const tokens = current
          ? await tx
              .select()
              .from(accessTokens)
              .where(
                and(
                  eq(accessTokens.userId, continuation.userId),
                  eq(accessTokens.authorizationConnectionId, current.authorizationConnectionId),
                  activeHostConnectionGrant(now()),
                ),
              )
              .for("share")
          : [];
        const claimed = await tx
          .select()
          .from(financeAnswerContinuations)
          .where(
            and(
              inArray(financeAnswerContinuations.id, prepared.continuationIds),
              eq(financeAnswerContinuations.userId, continuation.userId),
              eq(financeAnswerContinuations.fireState, "submitting"),
            ),
          )
          .orderBy(financeAnswerContinuations.id)
          .for("update");
        if (
          claimed.length !== prepared.continuationIds.length ||
          claimed.some((row) => row.state !== "pending")
        ) {
          await tx
            .update(financeAnswerContinuations)
            .set({ fireState: "unavailable", updatedAt: now() })
            .where(
              and(
                inArray(financeAnswerContinuations.id, prepared.continuationIds),
                eq(financeAnswerContinuations.fireState, "submitting"),
              ),
            );
          report("unavailable", "claim_changed", prepared.continuationIds.length, 409);
          return;
        }
        if (
          !shouldContinue() ||
          current?.schedule.state !== "active" ||
          current.schedule.version !== initial.schedule.version ||
          !tokens.some((token) => token.scopes.includes("finances:maintain"))
        ) {
          await tx
            .update(financeAnswerContinuations)
            .set({ fireState: "unavailable", updatedAt: now() })
            .where(inArray(financeAnswerContinuations.id, prepared.continuationIds));
          report("unavailable", "authority_changed", prepared.continuationIds.length, 403);
          return;
        }
        let fireState: "accepted" | "uncertain" | "unavailable" = "uncertain";
        let hostSessionId: string | null = null;
        let status = 503;
        let code = "transport_uncertain";
        try {
          const response = await providerFetch(
            options.fetch,
            `https://api.anthropic.com/v1/claude_code/routines/${prepared.routineId}/fire`,
            {
              method: "POST",
              redirect: "error",
              headers: {
                Authorization: `Bearer ${prepared.credentials.token}`,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                text: JSON.stringify({
                  type: "nohmi_finance_answer_ready",
                  scheduleId: prepared.scheduleId,
                  continuationId: continuation.id,
                }),
              }),
            },
          );
          status = response.status;
          code = "provider_uncertain";
          if (response.ok) {
            code = "invalid_response";
            const reader = response.body?.getReader();
            if (!reader) throw new Error("Missing host response.");
            const chunks: Uint8Array[] = [];
            let bytes = 0;
            try {
              for (;;) {
                const part = await reader.read();
                if (part.done) break;
                bytes += part.value.byteLength;
                if (bytes > 16_384) throw new Error("Host response too large.");
                chunks.push(part.value);
              }
            } finally {
              await reader.cancel();
            }
            const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            if (
              body &&
              typeof body === "object" &&
              "type" in body &&
              body.type === "routine_fire" &&
              "claude_code_session_id" in body &&
              typeof body.claude_code_session_id === "string" &&
              /^session_[A-Za-z0-9]{10,100}$/.test(body.claude_code_session_id)
            ) {
              fireState = "accepted";
              code = "accepted";
              hostSessionId = body.claude_code_session_id;
            }
          } else if ([400, 401, 403, 404, 429].includes(response.status)) {
            fireState = "unavailable";
            code = "provider_rejected";
          }
        } catch {
          /* Durable uncertainty; no automatic second fire. */
        }
        await tx
          .update(financeAnswerContinuations)
          .set({ fireState, hostSessionId, updatedAt: now() })
          .where(
            and(
              inArray(financeAnswerContinuations.id, prepared.continuationIds),
              eq(financeAnswerContinuations.fireState, "submitting"),
            ),
          );
        report(fireState, code, prepared.continuationIds.length, status);
      });
      emit();
      processed++;
    }
    return { processed };
  };
}
