import { randomUUID } from "node:crypto";
import {
  accessTokens,
  auditEvents,
  automationHostSchedules,
  type Database,
  financeAnswerContinuations,
  financeContextualAnswers,
  financeReviewAnswers,
  users,
  workspaceMaintenanceRuns,
} from "@personal-os/database";
import {
  type AutomationHostSchedule,
  automationHostScheduleBindInputSchema,
  automationHostScheduleCancelInputSchema,
  automationHostScheduleCreateInputSchema,
  automationHostScheduleObservationInputSchema,
  automationHostScheduleRevokeInputSchema,
  automationHostScheduleSchema,
  automationHostScheduleUpdateInputSchema,
  observeAutomationHostScheduleHealth,
} from "@personal-os/domain";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { activeHostConnectionGrant } from "./automation-host-grant.js";
import { AppError } from "./errors.js";
import { reconcileFinanceContinuations } from "./finance/continuation-reconciliation.js";
import { encryptJson } from "./security.js";
import type { Principal } from "./types.js";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export function createAutomationHostService(options: {
  db: Database;
  now: () => Date;
  encryptionKey: string;
}) {
  const { db, now } = options;
  function human(principal: Principal) {
    if (principal.actorType !== "user" || principal.actorId !== principal.userId)
      throw new AppError("forbidden", "Only you can configure a host connection.");
  }
  async function liveGrant(tx: Tx, userId: string, connectionId: string) {
    const rows = await tx
      .select()
      .from(accessTokens)
      .where(
        and(
          eq(accessTokens.userId, userId),
          eq(accessTokens.authorizationConnectionId, connectionId),
          activeHostConnectionGrant(now()),
        ),
      )
      .for("share");
    if (!rows.some((token) => token.scopes.includes("finances:maintain")))
      throw new AppError("forbidden", "Reconnect this host with Finance maintenance authority.");
    return rows;
  }
  async function owned(tx: Tx, principal: Principal, id: string) {
    const [row] = await tx
      .select()
      .from(automationHostSchedules)
      .where(
        and(
          eq(automationHostSchedules.userId, principal.userId),
          eq(automationHostSchedules.id, id),
        ),
      )
      .for("update");
    if (!row) throw new AppError("not_found", "Host schedule not found.");
    return row;
  }
  const result = (schedule: AutomationHostSchedule) => ({
    schedule,
    health: observeAutomationHostScheduleHealth(schedule, now()),
  });
  async function change(
    principal: Principal,
    id: string,
    expectedVersion: number,
    apply: (schedule: AutomationHostSchedule, tx: Tx) => Promise<AutomationHostSchedule>,
  ) {
    return db.transaction(async (tx) => {
      const row = await owned(tx, principal, id);
      if (row.schedule.version !== expectedVersion)
        throw new AppError("conflict", "The host schedule changed. Reload it before continuing.");
      const updated = automationHostScheduleSchema.parse(await apply(row.schedule, tx));
      await tx
        .update(automationHostSchedules)
        .set({
          schedule: updated,
          updatedAt: now(),
          ...(updated.state === "revoked" || updated.state === "cancelled"
            ? { encryptedFireCredentials: null }
            : {}),
        })
        .where(eq(automationHostSchedules.id, row.id));
      return result(updated);
    });
  }
  return {
    async pendingAnswers(principal: Principal, cursorId?: string) {
      human(principal);
      const [cursor] = cursorId
        ? await db
            .select({ id: financeAnswerContinuations.id })
            .from(financeAnswerContinuations)
            .where(
              and(
                eq(financeAnswerContinuations.userId, principal.userId),
                eq(financeAnswerContinuations.id, cursorId),
              ),
            )
        : [];
      if (cursorId && !cursor)
        throw new AppError("invalid_request", "This answer cursor is unavailable.");
      const rows = await db
        .select({
          id: financeAnswerContinuations.id,
          reviewCaseId: financeAnswerContinuations.reviewCaseId,
          state: financeAnswerContinuations.state,
          automationScheduleId: financeAnswerContinuations.automationScheduleId,
          fireState: financeAnswerContinuations.fireState,
          maintenanceRunId: financeAnswerContinuations.maintenanceRunId,
          updatedAt: financeAnswerContinuations.updatedAt,
        })
        .from(financeAnswerContinuations)
        .where(
          and(
            eq(financeAnswerContinuations.userId, principal.userId),
            inArray(financeAnswerContinuations.state, ["pending", "accepted", "unavailable"]),
            cursor
              ? sql`(${financeAnswerContinuations.createdAt},${financeAnswerContinuations.id})>(SELECT created_at,id FROM finance_answer_continuations WHERE user_id=${principal.userId}::uuid AND id=${cursor.id}::uuid)`
              : undefined,
          ),
        )
        .orderBy(financeAnswerContinuations.createdAt, financeAnswerContinuations.id)
        .limit(101);
      const continuations = rows.slice(0, 100);
      return {
        continuations,
        nextCursor: rows.length > 100 ? (continuations.at(-1)?.id ?? null) : null,
      };
    },
    async hostRuns(principal: Principal) {
      human(principal);
      return db
        .select({
          id: workspaceMaintenanceRuns.id,
          status: workspaceMaintenanceRuns.status,
          automationScheduleId: workspaceMaintenanceRuns.automationScheduleId,
          authorizationConnectionId: workspaceMaintenanceRuns.authorizationConnectionId,
          updatedAt: workspaceMaintenanceRuns.updatedAt,
        })
        .from(workspaceMaintenanceRuns)
        .where(
          and(
            eq(workspaceMaintenanceRuns.userId, principal.userId),
            eq(workspaceMaintenanceRuns.domain, "finances"),
            sql`${workspaceMaintenanceRuns.automationScheduleId} IS NOT NULL`,
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
        .limit(25);
    },
    async recoverHostRun(principal: Principal, id: string, raw: unknown) {
      human(principal);
      const input = z
        .object({
          scheduleId: z.uuid(),
          expectedScheduleId: z.uuid(),
          expectedConnectionId: z.uuid(),
          expectedUpdatedAt: z.iso.datetime(),
          hostChecked: z.literal(true),
        })
        .strict()
        .parse(raw);
      return db.transaction(async (tx) => {
        await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, principal.userId))
          .for("no key update", { noWait: true });
        const schedule = await owned(tx, principal, input.scheduleId);
        if (schedule.schedule.state !== "active")
          throw new AppError("conflict", "Choose an active host schedule.");
        if (schedule.schedule.hostSurface !== "codex_desktop")
          throw new AppError("conflict", "Choose a polling Codex host to recover an existing run.");
        await liveGrant(tx, principal.userId, schedule.authorizationConnectionId);
        const [run] = await tx
          .select()
          .from(workspaceMaintenanceRuns)
          .where(
            and(
              eq(workspaceMaintenanceRuns.userId, principal.userId),
              eq(workspaceMaintenanceRuns.id, id),
              eq(workspaceMaintenanceRuns.domain, "finances"),
            ),
          )
          .for("update", { noWait: true });
        if (
          !run ||
          run.automationScheduleId !== input.expectedScheduleId ||
          run.authorizationConnectionId !== input.expectedConnectionId ||
          run.updatedAt.toISOString() !== input.expectedUpdatedAt ||
          run.leaseClaimId ||
          run.leaseExpiresAt ||
          ![
            "queued",
            "awaiting_agent_challenge",
            "awaiting_approval",
            "blocked",
            "failed_recoverable",
          ].includes(run.status)
        )
          throw new AppError(
            "conflict",
            "This run changed or is executing. Reload its status before recovery.",
          );
        await tx
          .update(workspaceMaintenanceRuns)
          .set({
            automationScheduleId: schedule.id,
            authorizationConnectionId: schedule.authorizationConnectionId,
            updatedAt: now(),
          })
          .where(eq(workspaceMaintenanceRuns.id, run.id));
        await tx
          .update(financeAnswerContinuations)
          .set({ automationScheduleId: schedule.id, updatedAt: now() })
          .where(
            and(
              eq(financeAnswerContinuations.userId, principal.userId),
              eq(financeAnswerContinuations.maintenanceRunId, run.id),
              eq(financeAnswerContinuations.state, "accepted"),
            ),
          );
        await tx.insert(auditEvents).values({
          userId: principal.userId,
          actorType: "user",
          actorId: principal.actorId,
          requestId: randomUUID(),
          action: "finance.host_run.rebound",
          entityType: "workspace_maintenance_run",
          entityId: run.id,
          before: {
            scheduleId: run.automationScheduleId,
            connectionId: run.authorizationConnectionId,
            status: run.status,
          },
          after: {
            scheduleId: schedule.id,
            connectionId: schedule.authorizationConnectionId,
            hostChecked: true,
          },
        });
        return { id: run.id };
      });
    },
    async reconcileDelivery(principal: Principal, id: string, raw: unknown) {
      human(principal);
      const input = z
        .object({ expectedUpdatedAt: z.iso.datetime(), hostChecked: z.literal(true) })
        .strict()
        .parse(raw);
      return db.transaction(async (tx) => {
        await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, principal.userId))
          .for("no key update", { noWait: true });
        const [answer] = await tx
          .select()
          .from(financeAnswerContinuations)
          .where(
            and(
              eq(financeAnswerContinuations.userId, principal.userId),
              eq(financeAnswerContinuations.id, id),
            ),
          )
          .for("update", { noWait: true });
        if (
          !answer ||
          answer.updatedAt.toISOString() !== input.expectedUpdatedAt ||
          answer.state !== "pending" ||
          answer.maintenanceRunId ||
          !["submitting", "uncertain", "accepted"].includes(answer.fireState) ||
          (answer.fireState === "submitting" &&
            answer.updatedAt.getTime() + 120000 >= now().getTime())
        )
          throw new AppError(
            "conflict",
            "This delivery changed or may still be executing. Reload before recovery.",
          );
        if (answer.fireState === "accepted") {
          const [schedule] = answer.automationScheduleId
            ? await tx
                .select({ schedule: automationHostSchedules.schedule })
                .from(automationHostSchedules)
                .where(
                  and(
                    eq(automationHostSchedules.userId, principal.userId),
                    eq(automationHostSchedules.id, answer.automationScheduleId),
                  ),
                )
            : [];
          const latencyMinutes =
            schedule?.schedule.trigger.type === "event"
              ? schedule.schedule.trigger.expectedMaximumLatencyMinutes
              : 5;
          if (answer.updatedAt.getTime() + Math.max(2, latencyMinutes) * 60_000 >= now().getTime())
            throw new AppError(
              "conflict",
              "The host session is still within its expected response time.",
            );
        }
        await tx
          .update(financeAnswerContinuations)
          .set({ fireState: "unavailable", updatedAt: now() })
          .where(eq(financeAnswerContinuations.id, id));
        await tx.insert(auditEvents).values({
          userId: principal.userId,
          actorType: "user",
          actorId: principal.actorId,
          requestId: randomUUID(),
          action: "finance.host_delivery.reconciled",
          entityType: "finance_answer_continuation",
          entityId: id,
          before: {
            fireState: answer.fireState,
            scheduleId: answer.automationScheduleId,
            hostSessionId: answer.hostSessionId,
          },
          after: { fireState: "unavailable", hostChecked: true },
        });
        return { id };
      });
    },
    async bindAnswer(principal: Principal, id: string, scheduleId: string) {
      human(principal);
      return db.transaction(async (tx) => {
        const schedule = await owned(tx, principal, scheduleId);
        if (schedule.schedule.state !== "active")
          throw new AppError("conflict", "Choose an active host schedule.");
        await liveGrant(tx, principal.userId, schedule.authorizationConnectionId);
        const [answer] = await tx
          .update(financeAnswerContinuations)
          .set({ automationScheduleId: scheduleId, fireState: "pending", updatedAt: now() })
          .where(
            and(
              eq(financeAnswerContinuations.userId, principal.userId),
              eq(financeAnswerContinuations.id, id),
              eq(financeAnswerContinuations.state, "pending"),
              inArray(financeAnswerContinuations.fireState, ["pending", "unavailable"]),
              isNull(financeAnswerContinuations.maintenanceRunId),
            ),
          )
          .returning({ id: financeAnswerContinuations.id });
        if (!answer)
          throw new AppError("conflict", "This answer has been submitted or is no longer pending.");
        return answer;
      });
    },
    async continuations(principal: Principal, id: string, cursorId?: string) {
      return db.transaction(async (tx) => {
        const schedule = await owned(tx, principal, id);
        if (
          principal.actorType !== "agent" ||
          principal.authorizationConnectionId !== schedule.authorizationConnectionId ||
          !principal.scopes.has("finances:maintain") ||
          schedule.schedule.state !== "active"
        )
          throw new AppError(
            "forbidden",
            "Read continuations through the original active host connection.",
          );
        await liveGrant(tx, principal.userId, schedule.authorizationConnectionId);
        await reconcileFinanceContinuations(tx, now(), principal.userId);
        const [cursor] = cursorId
          ? await tx
              .select({
                id: financeAnswerContinuations.id,
                createdAt: financeAnswerContinuations.createdAt,
              })
              .from(financeAnswerContinuations)
              .where(
                and(
                  eq(financeAnswerContinuations.userId, principal.userId),
                  eq(financeAnswerContinuations.automationScheduleId, id),
                  eq(financeAnswerContinuations.id, cursorId),
                ),
              )
          : [];
        if (cursorId && !cursor)
          throw new AppError("invalid_request", "This continuation cursor is unavailable.");
        const rows = await tx
          .select({
            id: financeAnswerContinuations.id,
            state: financeAnswerContinuations.state,
            maintenanceRunId: financeAnswerContinuations.maintenanceRunId,
          })
          .from(financeAnswerContinuations)
          .where(
            and(
              eq(financeAnswerContinuations.userId, principal.userId),
              eq(financeAnswerContinuations.automationScheduleId, id),
              cursor
                ? sql`(${financeAnswerContinuations.createdAt},${financeAnswerContinuations.id})>(SELECT created_at,id FROM finance_answer_continuations WHERE user_id=${principal.userId}::uuid AND automation_schedule_id=${id}::uuid AND id=${cursor.id}::uuid)`
                : undefined,
              or(
                eq(financeAnswerContinuations.state, "pending"),
                eq(financeAnswerContinuations.state, "accepted"),
              ),
            ),
          )
          .orderBy(financeAnswerContinuations.createdAt, financeAnswerContinuations.id)
          .limit(101);
        const details = [];
        for (const row of rows.slice(0, 100)) {
          const [continuation] = await tx
            .select()
            .from(financeAnswerContinuations)
            .where(
              and(
                eq(financeAnswerContinuations.userId, principal.userId),
                eq(financeAnswerContinuations.id, row.id),
              ),
            );
          const table =
            continuation?.sourceKind === "manual_question"
              ? financeContextualAnswers
              : financeReviewAnswers;
          const [answer] = continuation
            ? await tx
                .select({ text: table.text, sourceKind: table.sourceKind })
                .from(table)
                .where(
                  and(
                    eq(table.userId, principal.userId),
                    eq(table.operationId, continuation.operationId),
                  ),
                )
            : [];
          details.push({ ...row, answer: answer ?? null });
        }
        return {
          ...result(schedule.schedule),
          continuations: details,
          hasMore: rows.length > 100,
          nextCursor: rows.length > 100 ? (details.at(-1)?.id ?? null) : null,
        };
      });
    },
    async connections(principal: Principal) {
      human(principal);
      const tokens = await db
        .select()
        .from(accessTokens)
        .where(and(eq(accessTokens.userId, principal.userId), activeHostConnectionGrant(now())));
      return [
        ...new Map(
          tokens
            .filter((token) => token.scopes.includes("finances:maintain"))
            .map((token) => [
              token.authorizationConnectionId,
              { id: token.authorizationConnectionId, label: token.name, scopes: token.scopes },
            ]),
        ).values(),
      ];
    },
    async list(principal: Principal) {
      human(principal);
      const rows = await db
        .select()
        .from(automationHostSchedules)
        .where(eq(automationHostSchedules.userId, principal.userId));
      const tokens = await db
        .select()
        .from(accessTokens)
        .where(and(eq(accessTokens.userId, principal.userId), activeHostConnectionGrant(now())));
      return rows.map((row) => ({
        ...result(row.schedule),
        connectionAvailable: tokens.some(
          (token) =>
            token.authorizationConnectionId === row.authorizationConnectionId &&
            token.scopes.includes("finances:maintain"),
        ),
      }));
    },
    async create(principal: Principal, raw: unknown) {
      human(principal);
      const input = automationHostScheduleCreateInputSchema.parse(raw);
      return db.transaction(async (tx) => {
        const tokens = await liveGrant(tx, principal.userId, input.tenantAuthorizationConnectionId);
        if (
          !tokens.some((token) =>
            input.requestedScopes.every((scope) => token.scopes.includes(scope)),
          )
        )
          throw new AppError("forbidden", "The host connection does not grant these scopes.");
        const schedule = automationHostScheduleSchema.parse({
          id: randomUUID(),
          tenantAuthorizationConnectionId: input.tenantAuthorizationConnectionId,
          label: input.label,
          effectiveScopes: input.requestedScopes,
          hostSurface: input.hostSurface,
          trigger: input.trigger,
          state: "setup_pending",
          hostAutomationId: null,
          lastObservedAt: null,
          nextExpectedAt: null,
          version: 1,
          createdAt: now().toISOString(),
          updatedAt: now().toISOString(),
        });
        await tx.insert(automationHostSchedules).values({
          id: schedule.id,
          userId: principal.userId,
          authorizationConnectionId: input.tenantAuthorizationConnectionId,
          schedule,
        });
        return result(schedule);
      });
    },
    async bind(principal: Principal, id: string, raw: unknown) {
      human(principal);
      const input = automationHostScheduleBindInputSchema.parse(raw);
      return change(principal, id, input.expectedVersion, async (schedule, tx) => {
        if (schedule.state !== "setup_pending" || schedule.hostSurface !== input.hostSurface)
          throw new AppError("conflict", "This host schedule cannot be bound.");
        if (
          input.hostSurface === "claude_code_routine" &&
          !/^trig_[A-Za-z0-9]{10,100}$/.test(input.hostAutomationId)
        )
          throw new AppError("invalid_request", "Use the Claude routine's API trigger ID.");

        await liveGrant(tx, principal.userId, schedule.tenantAuthorizationConnectionId);
        if (input.hostSurface === "codex_desktop" && new Date(input.nextExpectedAt) <= now())
          throw new AppError("invalid_request", "Provide the next future host slot.");
        return automationHostScheduleSchema.parse({
          ...schedule,
          state: "active",
          hostAutomationId: input.hostAutomationId,
          nextExpectedAt: input.hostSurface === "codex_desktop" ? input.nextExpectedAt : null,
          version: schedule.version + 1,
          updatedAt: now().toISOString(),
        });
      });
    },
    async observe(principal: Principal, id: string, raw: unknown) {
      const input = automationHostScheduleObservationInputSchema.parse(raw);
      return change(principal, id, input.expectedVersion, async (schedule, tx) => {
        if (
          principal.actorType !== "agent" ||
          principal.authorizationConnectionId !== schedule.tenantAuthorizationConnectionId ||
          !principal.scopes.has("finances:maintain")
        )
          throw new AppError("forbidden", "Use this schedule's original host connection.");
        if (schedule.state !== input.expectedState || schedule.hostSurface !== input.hostSurface)
          throw new AppError("conflict", "The host schedule state changed.");
        await liveGrant(tx, principal.userId, schedule.tenantAuthorizationConnectionId);
        if (Math.abs(new Date(input.observedAt).getTime() - now().getTime()) > 5 * 60_000)
          throw new AppError("invalid_request", "The host observation must be current.");
        return automationHostScheduleSchema.parse({
          ...schedule,
          state: input.observedState,
          lastObservedAt: input.observedAt,
          nextExpectedAt: input.hostSurface === "codex_desktop" ? input.nextExpectedAt : null,
          version: schedule.version + 1,
          updatedAt: now().toISOString(),
        });
      });
    },
    async update(principal: Principal, id: string, raw: unknown) {
      human(principal);
      const input = automationHostScheduleUpdateInputSchema.parse(raw);
      return change(principal, id, input.expectedVersion, async (schedule) => {
        if (schedule.state === "revoked" || schedule.state === "cancelled")
          throw new AppError("conflict", "This host setup has ended.");
        return automationHostScheduleSchema.parse({
          ...schedule,
          label: input.label,
          version: schedule.version + 1,
          updatedAt: now().toISOString(),
        });
      });
    },
    async cancel(principal: Principal, id: string, raw: unknown) {
      human(principal);
      const input = automationHostScheduleCancelInputSchema.parse(raw);
      return change(principal, id, input.expectedVersion, async (schedule) => {
        if (schedule.state !== input.expectedState)
          throw new AppError("conflict", "The host schedule state changed.");
        return automationHostScheduleSchema.parse({
          ...schedule,
          state: "cancelled",
          version: schedule.version + 1,
          updatedAt: now().toISOString(),
        });
      });
    },
    async revoke(principal: Principal, id: string, raw: unknown) {
      human(principal);
      const input = automationHostScheduleRevokeInputSchema.parse(raw);
      return change(principal, id, input.expectedVersion, async (schedule) => {
        if (schedule.state !== input.expectedState)
          throw new AppError("conflict", "The host schedule state changed.");
        return automationHostScheduleSchema.parse({
          ...schedule,
          state: "revoked",
          nextExpectedAt: null,
          version: schedule.version + 1,
          updatedAt: now().toISOString(),
        });
      });
    },
    async saveFireToken(principal: Principal, id: string, token: string, expectedVersion: number) {
      human(principal);
      if (!/^sk-ant-oat01-[A-Za-z0-9_-]{10,500}$/.test(token))
        throw new AppError("invalid_request", "Use the routine's API trigger token.");
      return db.transaction(async (tx) => {
        const row = await owned(tx, principal, id);
        if (
          row.schedule.version !== expectedVersion ||
          row.schedule.hostSurface !== "claude_code_routine" ||
          row.schedule.state !== "active" ||
          !/^trig_[A-Za-z0-9]{10,100}$/.test(row.schedule.hostAutomationId)
        )
          throw new AppError(
            "conflict",
            "Bind the current Claude routine before saving its trigger token.",
          );
        await liveGrant(tx, principal.userId, row.authorizationConnectionId);
        const schedule = automationHostScheduleSchema.parse({
          ...row.schedule,
          version: row.schedule.version + 1,
          updatedAt: now().toISOString(),
        });
        await tx
          .update(automationHostSchedules)
          .set({
            encryptedFireCredentials: encryptJson({ token }, options.encryptionKey),
            schedule,
            updatedAt: now(),
          })
          .where(eq(automationHostSchedules.id, id));
        return result(schedule);
      });
    },
  };
}
