import { randomUUID } from "node:crypto";
import {
  accessTokens,
  auditEvents,
  automationHostPromptIssues,
  automationHostSchedules,
  type Database,
  financeAnswerContinuations,
  financeContextualAnswers,
  financeMaintenanceExecutionBindings,
  financeReviewAnswers,
  users,
  workspaceMaintenanceRuns,
} from "@personal-os/database";
import {
  type AutomationHostSchedule,
  automationHostPromptIssueInputSchema,
  automationHostPromptIssueSchema,
  automationHostPromptPageInputSchema,
  automationHostScheduleBindInputSchema,
  automationHostScheduleCancelInputSchema,
  automationHostScheduleCreateInputSchema,
  automationHostScheduleObservationInputSchema,
  automationHostScheduleRevokeInputSchema,
  automationHostScheduleSchema,
  automationHostScheduleUpdateInputSchema,
  observeAutomationHostScheduleHealth,
} from "@personal-os/domain";
import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { ensureAgentAccount, findAgentAccount } from "./agent-account-service.js";
import { activeHostConnectionGrant } from "./automation-host-grant.js";
import { AppError } from "./errors.js";
import {
  FINANCE_AUTOMATION_PROMPT_VERSION,
  renderFinanceAutomationPrompt,
} from "./finance/automation-prompts.js";
import { reconcileFinanceContinuations } from "./finance/continuation-reconciliation.js";
import {
  financeExecutionTokenSnapshot,
  guardFinanceExecutionTransaction,
} from "./finance/execution-owner-guard.js";
import { encryptJson } from "./security.js";
import type { Principal } from "./types.js";
import { requireWorkspaceExecution } from "./workspace-execution.js";

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
  function requireConnection(principal: Principal, connectionId: string) {
    if (
      principal.actorType === "agent" &&
      (!principal.scopes.has("finances:maintain") ||
        principal.authorizationConnectionId !== connectionId)
    )
      throw new AppError("forbidden", "Use this schedule's original host connection.");
  }
  async function authorizeHost(principal: Principal, write = false) {
    if (principal.actorType === "user") {
      human(principal);
      return;
    }
    if (!principal.authorizationConnectionId || !principal.scopes.has("finances:maintain"))
      throw new AppError(
        "forbidden",
        "Host controls require an existing connection with finances:maintain.",
      );
    if (write) await requireWorkspaceExecution(db, principal, "finances", now());
  }
  async function liveGrant(tx: Tx, userId: string, connectionId: string) {
    const rows = await tx
      .select()
      .from(accessTokens)
      .where(
        and(
          eq(accessTokens.userId, userId),
          inArray(accessTokens.id, financeExecutionTokenSnapshot(tx, userId)),
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
    requireConnection(principal, row.authorizationConnectionId);
    return row;
  }
  const promptValue = (row: typeof automationHostPromptIssues.$inferSelect) =>
    automationHostPromptIssueSchema.parse({
      scheduleId: row.scheduleId,
      templateVersion: row.templateVersion,
      scheduleVersionAtIssue: row.scheduleVersionAtIssue,
      text: row.text,
      issuedAt: row.issuedAt.toISOString(),
    });
  async function result(
    schedule: AutomationHostSchedule,
    userId: string,
    tx: Database | Tx = db,
    knownLatest?: typeof automationHostPromptIssues.$inferSelect | null,
  ) {
    const latest =
      knownLatest !== undefined
        ? knownLatest
        : (
            await tx
              .select()
              .from(automationHostPromptIssues)
              .where(
                and(
                  eq(automationHostPromptIssues.scheduleId, schedule.id),
                  eq(automationHostPromptIssues.userId, userId),
                ),
              )
              .orderBy(desc(automationHostPromptIssues.templateVersion))
              .limit(1)
          )[0];
    return {
      schedule,
      agentAccount: await findAgentAccount(tx, userId, schedule.tenantAuthorizationConnectionId),
      health: observeAutomationHostScheduleHealth(schedule, now()),
      prompt: {
        externalAdoption: "unknown" as const,
        latestIssued: latest ? promptValue(latest) : null,
        currentTemplateVersion: FINANCE_AUTOMATION_PROMPT_VERSION,
        upgradeAvailable: !latest || latest.templateVersion < FINANCE_AUTOMATION_PROMPT_VERSION,
      },
      chatCapability: {
        state: "unverified" as const,
        reason: "message_protocol_unavailable" as const,
      },
    };
  }
  async function insertPrompt(tx: Tx, principal: Principal, schedule: AutomationHostSchedule) {
    const [issue] = await tx
      .insert(automationHostPromptIssues)
      .values({
        userId: principal.userId,
        scheduleId: schedule.id,
        templateVersion: FINANCE_AUTOMATION_PROMPT_VERSION,
        scheduleVersionAtIssue: schedule.version,
        text: renderFinanceAutomationPrompt(schedule),
        issuedAt: now(),
      })
      .returning();
    if (!issue) throw new AppError("conflict", "The prompt could not be issued.");
    await tx.insert(auditEvents).values({
      userId: principal.userId,
      actorType: principal.actorType,
      actorId: principal.actorId,
      requestId: randomUUID(),
      action: "finance.host_prompt.issued",
      entityType: "automation_host_schedule",
      entityId: schedule.id,
      before: null,
      after: {
        templateVersion: issue.templateVersion,
        scheduleVersionAtIssue: issue.scheduleVersionAtIssue,
      },
    });
    return promptValue(issue);
  }
  function scheduleAudit(schedule: AutomationHostSchedule) {
    return {
      state: schedule.state,
      version: schedule.version,
      connectionId: schedule.tenantAuthorizationConnectionId,
      hostSurface: schedule.hostSurface,
    };
  }
  async function recordScheduleChange(
    tx: Tx,
    principal: Principal,
    after: AutomationHostSchedule,
    before: AutomationHostSchedule | null,
  ) {
    await tx.insert(auditEvents).values({
      userId: principal.userId,
      actorType: principal.actorType,
      actorId: principal.actorId,
      requestId: randomUUID(),
      action: before ? "finance.host_schedule.changed" : "finance.host_schedule.created",
      entityId: after.id,
      entityType: "automation_host_schedule",
      before: before ? scheduleAudit(before) : null,
      after: scheduleAudit(after),
    });
  }
  async function change(
    principal: Principal,
    id: string,
    expectedVersion: number,
    apply: (schedule: AutomationHostSchedule, tx: Tx) => Promise<AutomationHostSchedule>,
    requiresExecution = true,
  ) {
    return db.transaction(async (tx) => {
      await guardFinanceExecutionTransaction(tx, principal.userId, {
        actorIds: principal.actorType === "agent" ? [principal.actorId] : [],
        connectionIds: principal.authorizationConnectionId
          ? [principal.authorizationConnectionId]
          : [],
        hostSchedules: true,
      });
      const row = await owned(tx, principal, id);
      if (row.schedule.version !== expectedVersion)
        throw new AppError("conflict", "The host schedule changed. Reload it before continuing.");
      const updated = automationHostScheduleSchema.parse(await apply(row.schedule, tx));
      if (requiresExecution) await requireWorkspaceExecution(tx, principal, "finances", now());
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
      await recordScheduleChange(tx, principal, updated, row.schedule);
      return result(updated, principal.userId, tx);
    });
  }
  return {
    async promptHistory(principal: Principal, id: string, raw: unknown) {
      await authorizeHost(principal);
      const input = automationHostPromptPageInputSchema.parse(raw);
      return db.transaction(async (tx) => {
        await guardFinanceExecutionTransaction(tx, principal.userId, {
          actorIds: principal.actorType === "agent" ? [principal.actorId] : [],
          connectionIds: principal.authorizationConnectionId
            ? [principal.authorizationConnectionId]
            : [],
          hostSchedules: true,
        });
        await owned(tx, principal, id);
        const rows = await tx
          .select()
          .from(automationHostPromptIssues)
          .where(
            and(
              eq(automationHostPromptIssues.userId, principal.userId),
              eq(automationHostPromptIssues.scheduleId, id),
              input.beforeVersion
                ? lt(automationHostPromptIssues.templateVersion, input.beforeVersion)
                : undefined,
            ),
          )
          .orderBy(desc(automationHostPromptIssues.templateVersion))
          .limit(input.limit + 1);
        const issues = rows.slice(0, input.limit).map(promptValue);
        return {
          issues,
          nextCursor: rows.length > input.limit ? (issues.at(-1)?.templateVersion ?? null) : null,
          currentTemplateVersion: FINANCE_AUTOMATION_PROMPT_VERSION,
        };
      });
    },
    async getPrompt(principal: Principal, id: string, templateVersion: number) {
      await authorizeHost(principal);
      z.int().positive().parse(templateVersion);
      return db.transaction(async (tx) => {
        await guardFinanceExecutionTransaction(tx, principal.userId, {
          actorIds: principal.actorType === "agent" ? [principal.actorId] : [],
          connectionIds: principal.authorizationConnectionId
            ? [principal.authorizationConnectionId]
            : [],
          hostSchedules: true,
        });
        await owned(tx, principal, id);
        const [issue] = await tx
          .select()
          .from(automationHostPromptIssues)
          .where(
            and(
              eq(automationHostPromptIssues.userId, principal.userId),
              eq(automationHostPromptIssues.scheduleId, id),
              eq(automationHostPromptIssues.templateVersion, templateVersion),
            ),
          );
        if (!issue) throw new AppError("not_found", "Issued prompt not found.");
        return promptValue(issue);
      });
    },
    async issuePrompt(principal: Principal, id: string, templateVersion: number, raw: unknown) {
      await authorizeHost(principal);
      z.int().positive().parse(templateVersion);
      const input = automationHostPromptIssueInputSchema.parse(raw);
      return db.transaction(async (tx) => {
        await guardFinanceExecutionTransaction(tx, principal.userId, {
          actorIds: principal.actorType === "agent" ? [principal.actorId] : [],
          connectionIds: principal.authorizationConnectionId
            ? [principal.authorizationConnectionId]
            : [],
          hostSchedules: true,
        });
        const row = await owned(tx, principal, id);
        const [existing] = await tx
          .select()
          .from(automationHostPromptIssues)
          .where(
            and(
              eq(automationHostPromptIssues.userId, principal.userId),
              eq(automationHostPromptIssues.scheduleId, id),
              eq(automationHostPromptIssues.templateVersion, templateVersion),
            ),
          );
        // A replay is a read of immutable evidence, even after a later lifecycle/version change.
        if (existing) return promptValue(existing);
        if (templateVersion !== FINANCE_AUTOMATION_PROMPT_VERSION)
          throw new AppError(
            "conflict",
            "This prompt template is unavailable. Reload the current version.",
          );
        if (row.schedule.version !== input.expectedScheduleVersion)
          throw new AppError(
            "conflict",
            "The host schedule changed. Reload it before issuing a prompt.",
          );
        if (["cancelled", "revoked"].includes(row.schedule.state))
          throw new AppError("conflict", "This host setup has ended.");
        await liveGrant(tx, principal.userId, row.authorizationConnectionId);
        await requireWorkspaceExecution(tx, principal, "finances", now());
        return insertPrompt(tx, principal, row.schedule);
      });
    },
    async pendingAnswers(principal: Principal, cursorId?: string) {
      await authorizeHost(principal);
      const [cursor] = cursorId
        ? await db
            .select({ id: financeAnswerContinuations.id })
            .from(financeAnswerContinuations)
            .where(
              and(
                eq(financeAnswerContinuations.userId, principal.userId),
                principal.actorType === "agent"
                  ? sql`EXISTS (SELECT 1 FROM automation_host_schedules AS owned_host WHERE owned_host.id = ${financeAnswerContinuations.automationScheduleId} AND owned_host.user_id = ${principal.userId}::uuid AND owned_host.authorization_connection_id = ${principal.authorizationConnectionId}::uuid)`
                  : undefined,
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
            principal.actorType === "agent"
              ? sql`EXISTS (SELECT 1 FROM automation_host_schedules AS owned_host WHERE owned_host.id = ${financeAnswerContinuations.automationScheduleId} AND owned_host.user_id = ${principal.userId}::uuid AND owned_host.authorization_connection_id = ${principal.authorizationConnectionId}::uuid)`
              : undefined,
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
      await authorizeHost(principal);
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
            principal.actorType === "agent"
              ? eq(
                  workspaceMaintenanceRuns.authorizationConnectionId,
                  principal.authorizationConnectionId ?? "",
                )
              : undefined,
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
      await authorizeHost(principal, true);
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
        await guardFinanceExecutionTransaction(tx, principal.userId, {
          actorIds: principal.actorType === "agent" ? [principal.actorId] : [],
          connectionIds: principal.authorizationConnectionId
            ? [principal.authorizationConnectionId]
            : [],
          hostSchedules: true,
        });
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
        if (principal.actorType === "agent") {
          requireConnection(principal, run.authorizationConnectionId ?? "");
          await requireWorkspaceExecution(tx, principal, "finances", now());
        }
        const [executionBinding] = await tx
          .select({
            id: financeMaintenanceExecutionBindings.id,
            scheduleId: financeMaintenanceExecutionBindings.automationScheduleId,
            connectionId: financeMaintenanceExecutionBindings.authorizationConnectionId,
          })
          .from(financeMaintenanceExecutionBindings)
          .where(
            and(
              eq(financeMaintenanceExecutionBindings.userId, principal.userId),
              eq(financeMaintenanceExecutionBindings.runId, run.id),
            ),
          )
          .limit(1)
          .for("share");
        if (executionBinding) {
          if (
            run.automationScheduleId !== schedule.id ||
            run.authorizationConnectionId !== schedule.authorizationConnectionId ||
            executionBinding.scheduleId !== schedule.id ||
            executionBinding.connectionId !== schedule.authorizationConnectionId
          )
            throw new AppError(
              "conflict",
              "This submitted Finance candidate must retain its original host. Refresh its execution authorization instead.",
            );
          return { id: run.id };
        }
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
          actorType: principal.actorType,
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
      await authorizeHost(principal, true);
      const input = z
        .object({ expectedUpdatedAt: z.iso.datetime(), hostChecked: z.literal(true) })
        .strict()
        .parse(raw);
      return db.transaction(async (tx) => {
        await guardFinanceExecutionTransaction(tx, principal.userId, {
          actorIds: principal.actorType === "agent" ? [principal.actorId] : [],
          connectionIds: principal.authorizationConnectionId
            ? [principal.authorizationConnectionId]
            : [],
          hostSchedules: true,
        });
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
        if (principal.actorType === "agent") {
          if (!answer.automationScheduleId)
            throw new AppError("forbidden", "This answer has no original host connection.");
          await owned(tx, principal, answer.automationScheduleId);
          await requireWorkspaceExecution(tx, principal, "finances", now());
        }
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
          actorType: principal.actorType,
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
      await authorizeHost(principal, true);
      return db.transaction(async (tx) => {
        await guardFinanceExecutionTransaction(tx, principal.userId, {
          actorIds: principal.actorType === "agent" ? [principal.actorId] : [],
          connectionIds: principal.authorizationConnectionId
            ? [principal.authorizationConnectionId]
            : [],
          hostSchedules: true,
        });
        const schedule = await owned(tx, principal, scheduleId);
        if (schedule.schedule.state !== "active")
          throw new AppError("conflict", "Choose an active host schedule.");
        await liveGrant(tx, principal.userId, schedule.authorizationConnectionId);
        const [existing] = await tx
          .select()
          .from(financeAnswerContinuations)
          .where(
            and(
              eq(financeAnswerContinuations.id, id),
              eq(financeAnswerContinuations.userId, principal.userId),
            ),
          )
          .for("update")
          .limit(1);
        if (principal.actorType === "agent") {
          if (!existing?.automationScheduleId)
            throw new AppError("forbidden", "Only the owner can assign an unbound answer.");
          await owned(tx, principal, existing.automationScheduleId);
          await requireWorkspaceExecution(tx, principal, "finances", now());
        }
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
        await tx.insert(auditEvents).values({
          userId: principal.userId,
          actorType: principal.actorType,
          actorId: principal.actorId,
          requestId: randomUUID(),
          action: "finance.host_answer.bound",
          entityId: answer.id,
          entityType: "finance_answer_continuation",
          before: existing
            ? { scheduleId: existing.automationScheduleId, fireState: existing.fireState }
            : null,
          after: { scheduleId, fireState: "pending" },
        });
        return answer;
      });
    },
    async continuations(principal: Principal, id: string, cursorId?: string) {
      return db.transaction(async (tx) => {
        await guardFinanceExecutionTransaction(tx, principal.userId, {
          actorIds: principal.actorType === "agent" ? [principal.actorId] : [],
          connectionIds: principal.authorizationConnectionId
            ? [principal.authorizationConnectionId]
            : [],
          hostSchedules: true,
        });
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
          ...(await result(schedule.schedule, principal.userId, tx)),
          continuations: details,
          hasMore: rows.length > 100,
          nextCursor: rows.length > 100 ? (details.at(-1)?.id ?? null) : null,
        };
      });
    },
    async connections(principal: Principal) {
      await authorizeHost(principal);
      const tokens = await db
        .select()
        .from(accessTokens)
        .where(
          and(
            eq(accessTokens.userId, principal.userId),
            activeHostConnectionGrant(now()),
            principal.actorType === "agent"
              ? eq(
                  accessTokens.authorizationConnectionId,
                  principal.authorizationConnectionId ?? "",
                )
              : undefined,
          ),
        );
      const connections = [
        ...new Map(
          tokens
            .filter((token) => token.scopes.includes("finances:maintain"))
            .map((token) => [
              token.authorizationConnectionId,
              { id: token.authorizationConnectionId, label: token.name, scopes: token.scopes },
            ]),
        ).values(),
      ];
      return Promise.all(
        connections.map(async (connection) => ({
          ...connection,
          agentAccount: await findAgentAccount(db, principal.userId, connection.id),
        })),
      );
    },
    async list(principal: Principal) {
      await authorizeHost(principal);
      const rows = await db
        .select()
        .from(automationHostSchedules)
        .where(
          and(
            eq(automationHostSchedules.userId, principal.userId),
            principal.actorType === "agent"
              ? eq(
                  automationHostSchedules.authorizationConnectionId,
                  principal.authorizationConnectionId ?? "",
                )
              : undefined,
          ),
        );
      const tokens = await db
        .select()
        .from(accessTokens)
        .where(
          and(
            eq(accessTokens.userId, principal.userId),
            activeHostConnectionGrant(now()),
            principal.actorType === "agent"
              ? eq(
                  accessTokens.authorizationConnectionId,
                  principal.authorizationConnectionId ?? "",
                )
              : undefined,
          ),
        );
      const latestIssues = rows.length
        ? await db
            .selectDistinctOn([automationHostPromptIssues.scheduleId])
            .from(automationHostPromptIssues)
            .where(
              and(
                eq(automationHostPromptIssues.userId, principal.userId),
                inArray(
                  automationHostPromptIssues.scheduleId,
                  rows.map((row) => row.id),
                ),
              ),
            )
            .orderBy(
              automationHostPromptIssues.scheduleId,
              desc(automationHostPromptIssues.templateVersion),
            )
        : [];
      const latestBySchedule = new Map(latestIssues.map((issue) => [issue.scheduleId, issue]));
      return Promise.all(
        rows.map(async (row) => ({
          ...(await result(
            row.schedule,
            principal.userId,
            db,
            latestBySchedule.get(row.id) ?? null,
          )),
          connectionAvailable: tokens.some(
            (token) =>
              token.authorizationConnectionId === row.authorizationConnectionId &&
              token.scopes.includes("finances:maintain"),
          ),
        })),
      );
    },
    async create(principal: Principal, raw: unknown) {
      await authorizeHost(principal, true);
      const input = automationHostScheduleCreateInputSchema.parse(raw);
      requireConnection(principal, input.tenantAuthorizationConnectionId);
      if (
        principal.actorType === "agent" &&
        input.requestedScopes.some((scope) => !principal.scopes.has(scope))
      )
        throw new AppError("forbidden", "A schedule cannot expand the caller's scopes.");
      return db.transaction(async (tx) => {
        await guardFinanceExecutionTransaction(tx, principal.userId, {
          actorIds: principal.actorType === "agent" ? [principal.actorId] : [],
          connectionIds: [
            input.tenantAuthorizationConnectionId,
            ...(principal.authorizationConnectionId ? [principal.authorizationConnectionId] : []),
          ],
          hostSchedules: true,
        });
        const tokens = await liveGrant(tx, principal.userId, input.tenantAuthorizationConnectionId);
        if (
          !tokens.some((token) =>
            input.requestedScopes.every((scope) => token.scopes.includes(scope)),
          )
        )
          throw new AppError("forbidden", "The host connection does not grant these scopes.");
        await ensureAgentAccount(
          tx,
          principal.userId,
          input.tenantAuthorizationConnectionId,
          input.hostSurface.startsWith("claude")
            ? "claude"
            : input.hostSurface.startsWith("codex")
              ? "codex"
              : "other",
          now(),
        );
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
        await requireWorkspaceExecution(tx, principal, "finances", now());
        await tx.insert(automationHostSchedules).values({
          id: schedule.id,
          userId: principal.userId,
          authorizationConnectionId: input.tenantAuthorizationConnectionId,
          schedule,
        });
        await recordScheduleChange(tx, principal, schedule, null);
        await insertPrompt(tx, principal, schedule);
        return result(schedule, principal.userId, tx);
      });
    },
    async bind(principal: Principal, id: string, raw: unknown) {
      await authorizeHost(principal, true);
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
      return change(
        principal,
        id,
        input.expectedVersion,
        async (schedule, tx) => {
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
        },
        false,
      );
    },
    async update(principal: Principal, id: string, raw: unknown) {
      await authorizeHost(principal, true);
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
      await authorizeHost(principal, true);
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
      await authorizeHost(principal, true);
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
        await guardFinanceExecutionTransaction(tx, principal.userId, {
          actorIds: principal.actorType === "agent" ? [principal.actorId] : [],
          connectionIds: principal.authorizationConnectionId
            ? [principal.authorizationConnectionId]
            : [],
          hostSchedules: true,
        });
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
        return result(schedule, principal.userId, tx);
      });
    },
  };
}
