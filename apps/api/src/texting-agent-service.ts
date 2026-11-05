import {
  auditEvents,
  automationHostSchedules,
  type Database,
  textInboundClaims,
  textingAgentQueue,
  textingAgentRuns,
  textingAgentSettings,
  textingAgentWork,
  textMessages,
} from "@personal-os/database";
import {
  type TextingAgentClaim,
  type TextingAgentStatus,
  textingAgentCheckpointSchema,
  textingAgentClaimSchema,
  textingAgentRecoverySchema,
  textingAgentReplySchema,
  textingAgentSettingsInputSchema,
  textingAgentWorkSchema,
} from "@personal-os/domain";
import { and, asc, count, desc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { auditValues } from "./audit.js";
import { AppError } from "./errors.js";
import {
  lockTextingOwner,
  publicTextingRun,
  type TextingAgentTransaction,
  textingAgentAuthority,
  textingAgentInstructions,
  textingAgentScopes,
} from "./texting-agent-authority.js";
import type { createTextingService } from "./texting-service.js";
import type { Principal } from "./types.js";
import { requireWorkspaceExecution } from "./workspace-execution.js";

export function createTextingAgentService(options: {
  db: Database;
  enabled: () => boolean;
  now: () => Date;
  texting: Pick<ReturnType<typeof createTextingService>, "sendNotification">;
}) {
  const { db, now } = options;
  async function status(principal: Principal, beforeRun?: string): Promise<TextingAgentStatus> {
    return db.transaction(async (tx) => {
      await lockTextingOwner(tx, principal.userId);
      const authority = await textingAgentAuthority(tx, principal.userId, now(), options.enabled());
      const schedules = await tx
        .select()
        .from(automationHostSchedules)
        .where(eq(automationHostSchedules.userId, principal.userId));
      const [cursor] = beforeRun
        ? await tx
            .select()
            .from(textingAgentRuns)
            .where(
              and(
                eq(textingAgentRuns.userId, principal.userId),
                eq(textingAgentRuns.id, beforeRun),
              ),
            )
            .limit(1)
        : [];
      if (beforeRun && !cursor) throw new AppError("invalid_request", "Run cursor not found.");
      const runs = await tx
        .select()
        .from(textingAgentRuns)
        .where(
          and(
            eq(textingAgentRuns.userId, principal.userId),
            cursor
              ? or(
                  lt(textingAgentRuns.createdAt, cursor.createdAt),
                  and(
                    eq(textingAgentRuns.createdAt, cursor.createdAt),
                    lt(textingAgentRuns.id, cursor.id),
                  ),
                )
              : undefined,
          ),
        )
        .orderBy(desc(textingAgentRuns.createdAt), desc(textingAgentRuns.id))
        .limit(21);
      const [pending] = await tx
        .select({ value: count() })
        .from(textingAgentQueue)
        .where(
          and(
            eq(textingAgentQueue.userId, principal.userId),
            isNull(textingAgentQueue.runId),
            isNull(textingAgentQueue.cancelledAt),
          ),
        );
      return {
        enabled: Boolean(authority.settings),
        scheduleId: authority.settings?.scheduleId ?? null,
        readiness: authority.readiness,
        pendingCount: pending?.value ?? 0,
        routines: schedules
          .filter(
            (s) =>
              s.schedule.hostSurface === "claude_code_routine" && s.schedule.state === "active",
          )
          .map((s) => ({ id: s.id, label: s.schedule.label })),
        runs: runs.slice(0, 20).map(publicTextingRun),
        nextRunCursor: runs.length > 20 ? (runs[19]?.id ?? null) : null,
        instructions: textingAgentInstructions,
      };
    });
  }
  async function configure(principal: Principal, raw: unknown) {
    if (principal.actorType !== "user")
      throw new AppError("forbidden", "Only the account owner can configure automatic replies.");
    const input = textingAgentSettingsInputSchema.parse(raw);
    await db.transaction(async (tx) => {
      await lockTextingOwner(tx, principal.userId);
      const [before] = await tx
        .select()
        .from(textingAgentSettings)
        .where(eq(textingAgentSettings.userId, principal.userId));
      if (input.scheduleId) {
        const [schedule] = await tx
          .select()
          .from(automationHostSchedules)
          .where(
            and(
              eq(automationHostSchedules.userId, principal.userId),
              eq(automationHostSchedules.id, input.scheduleId),
            ),
          )
          .for("share");
        if (
          !schedule ||
          schedule.schedule.hostSurface !== "claude_code_routine" ||
          schedule.schedule.state !== "active" ||
          !schedule.encryptedFireCredentials
        )
          throw new AppError(
            "invalid_request",
            "Choose an active Claude routine with an API trigger.",
          );
        await tx
          .insert(textingAgentSettings)
          .values({
            userId: principal.userId,
            scheduleId: input.scheduleId,
            createdAt: now(),
            updatedAt: now(),
          })
          .onConflictDoUpdate({
            target: textingAgentSettings.userId,
            set: { scheduleId: input.scheduleId, updatedAt: now() },
          });
        const authority = await textingAgentAuthority(
          tx,
          principal.userId,
          now(),
          options.enabled(),
        );
        if (authority.readiness !== "ready")
          throw new AppError(
            "forbidden",
            "Verify your phone and grant this connection Texting read, write and execution access with review bypass before enabling replies.",
          );
      } else {
        await tx
          .delete(textingAgentSettings)
          .where(eq(textingAgentSettings.userId, principal.userId));
      }
      // Changing the binding never silently replays queued messages under another host.
      if (before?.scheduleId !== input.scheduleId) {
        await tx
          .update(textingAgentQueue)
          .set({ cancelledAt: now() })
          .where(
            and(
              eq(textingAgentQueue.userId, principal.userId),
              isNull(textingAgentQueue.runId),
              isNull(textingAgentQueue.cancelledAt),
            ),
          );
      }
      await tx.insert(auditEvents).values(
        auditValues({
          action: "texting.agent.configure",
          before: { scheduleId: before?.scheduleId ?? null },
          after: { scheduleId: input.scheduleId },
          entityId: principal.userId,
          entityType: "texting_agent_settings",
          principal,
          requestId: crypto.randomUUID(),
        }),
      );
    });
    return status(principal);
  }
  async function authorizedRun(
    tx: TextingAgentTransaction,
    principal: Principal,
    runId: string,
    invocationId?: string,
  ) {
    if (
      principal.actorType !== "agent" ||
      !textingAgentScopes.every((scope) => principal.scopes.has(scope))
    )
      throw new AppError("forbidden", "This operation requires an authorized Texting agent.");
    const authority = await textingAgentAuthority(tx, principal.userId, now(), options.enabled());
    await requireWorkspaceExecution(tx, principal, "texting", now());
    const [run] = await tx
      .select()
      .from(textingAgentRuns)
      .where(and(eq(textingAgentRuns.userId, principal.userId), eq(textingAgentRuns.id, runId)))
      .for("update");
    if (!run) throw new AppError("not_found", "Texting run not found.");
    if (
      authority.readiness !== "ready" ||
      authority.settings?.scheduleId !== run.scheduleId ||
      authority.connection?.id !== run.connectionId ||
      authority.connection.consentEpoch !== run.consentEpoch ||
      authority.schedule?.authorizationConnectionId !== run.authorizationConnectionId ||
      principal.authorizationConnectionId !== run.authorizationConnectionId
    )
      throw new AppError(
        "forbidden",
        "This run no longer has its original consent and connection authority.",
      );
    if (invocationId && run.invocationId !== invocationId)
      throw new AppError("conflict", "Another agent invocation owns this run.");
    return run;
  }
  async function claim(
    principal: Principal,
    runId: string,
    raw: unknown,
  ): Promise<TextingAgentClaim> {
    const { invocationId, pendingWorkAfter } = textingAgentClaimSchema.parse(raw);
    return db.transaction(async (tx) => {
      await lockTextingOwner(tx, principal.userId);
      let run = await authorizedRun(tx, principal, runId);
      if (run.invocationId && run.invocationId !== invocationId)
        throw new AppError("conflict", "Another agent invocation owns this run.");
      if (run.state === "blocked" || run.state === "completed")
        throw new AppError("conflict", "This run is closed.");
      if (!run.invocationId) {
        const [updated] = await tx
          .update(textingAgentRuns)
          .set({ invocationId, state: "running", reason: null, updatedAt: now() })
          .where(eq(textingAgentRuns.id, run.id))
          .returning();
        if (!updated) throw new AppError("conflict", "Run changed.");
        run = updated;
        await tx.insert(auditEvents).values(
          auditValues({
            action: "texting.agent.claim",
            before: { state: "unclaimed" },
            after: { state: "running", invocationId },
            entityId: run.id,
            entityType: "texting_agent_run",
            principal,
            requestId: invocationId,
          }),
        );
      }
      const messages = await tx
        .select({
          id: textMessages.id,
          text: textMessages.body,
          occurredAt: textMessages.occurredAt,
        })
        .from(textingAgentQueue)
        .innerJoin(
          textInboundClaims,
          and(
            eq(textInboundClaims.id, textingAgentQueue.claimId),
            eq(textInboundClaims.userId, principal.userId),
          ),
        )
        .innerJoin(
          textMessages,
          and(
            eq(textMessages.id, textInboundClaims.messageId),
            eq(textMessages.userId, principal.userId),
          ),
        )
        .where(
          and(eq(textingAgentQueue.userId, principal.userId), eq(textingAgentQueue.runId, run.id)),
        )
        .orderBy(asc(textMessages.occurredAt), asc(textMessages.id))
        .limit(25);
      const pending = await tx
        .select({ runId: textingAgentWork.runId, item: textingAgentWork.item })
        .from(textingAgentWork)
        .where(
          and(
            eq(textingAgentWork.userId, principal.userId),
            sql`${textingAgentWork.item}->>'state' <> 'completed'`,
            pendingWorkAfter
              ? or(
                  gt(textingAgentWork.domain, pendingWorkAfter.domain),
                  and(
                    eq(textingAgentWork.domain, pendingWorkAfter.domain),
                    gt(textingAgentWork.key, pendingWorkAfter.key),
                  ),
                )
              : undefined,
          ),
        )
        .orderBy(asc(textingAgentWork.domain), asc(textingAgentWork.key))
        .limit(101);
      return {
        pendingWork: pending.slice(0, 100),
        nextPendingWorkCursor:
          pending.length > 100 && pending[99]
            ? { domain: pending[99].item.domain, key: pending[99].item.key }
            : null,
        run: publicTextingRun(run),
        messages: messages.map((m) => ({ ...m, occurredAt: m.occurredAt.toISOString() })),
        instructions: textingAgentInstructions,
      };
    });
  }
  async function checkpoint(principal: Principal, runId: string, raw: unknown) {
    const input = textingAgentCheckpointSchema.parse(raw);
    return db.transaction(async (tx) => {
      await lockTextingOwner(tx, principal.userId);
      const run = await authorizedRun(tx, principal, runId, input.invocationId);
      if (run.state !== "running") throw new AppError("conflict", "This run is not running.");
      const work = new Map(run.work.map((item) => [`${item.domain}:${item.key}`, item]));
      for (const item of input.work) {
        const key = `${item.domain}:${item.key}`;
        if (
          work.get(key)?.state === "completed" &&
          JSON.stringify(textingAgentWorkSchema.parse(work.get(key))) !== JSON.stringify(item)
        )
          throw new AppError(
            "conflict",
            "Completed work is immutable; inspect its domain records rather than replaying it.",
          );
        const [saved] = await tx
          .select()
          .from(textingAgentWork)
          .where(
            and(
              eq(textingAgentWork.userId, principal.userId),
              eq(textingAgentWork.domain, item.domain),
              eq(textingAgentWork.key, item.key),
            ),
          );
        if (
          saved?.item.state === "completed" &&
          JSON.stringify(textingAgentWorkSchema.parse(saved.item)) !== JSON.stringify(item)
        )
          throw new AppError("conflict", "Completed work cannot be replayed or replaced.");
        await tx
          .insert(textingAgentWork)
          .values({
            userId: principal.userId,
            domain: item.domain,
            key: item.key,
            runId: run.id,
            item,
            updatedAt: now(),
          })
          .onConflictDoUpdate({
            target: [textingAgentWork.userId, textingAgentWork.domain, textingAgentWork.key],
            set: { runId: run.id, item, updatedAt: now() },
          });
        work.set(key, item);
      }
      if (work.size > 100)
        throw new AppError("invalid_request", "A run supports at most 100 work items.");
      const [updated] = await tx
        .update(textingAgentRuns)
        .set({ work: [...work.values()], updatedAt: now() })
        .where(eq(textingAgentRuns.id, run.id))
        .returning();
      if (!updated) throw new AppError("conflict", "Run changed.");
      await tx.insert(auditEvents).values(
        auditValues({
          action: "texting.agent.checkpoint",
          before: { workCount: run.work.length },
          after: { workCount: updated.work.length },
          entityId: run.id,
          entityType: "texting_agent_run",
          principal,
          requestId: input.invocationId,
        }),
      );
      return publicTextingRun(updated);
    });
  }
  async function reply(principal: Principal, runId: string, raw: unknown) {
    const input = textingAgentReplySchema.parse(raw);
    await options.texting.sendNotification(principal.userId, async (tx) => {
      const run = await authorizedRun(tx, principal, runId, input.invocationId);
      if (run.replyMessageId) {
        const [message] = await tx
          .select()
          .from(textMessages)
          .where(
            and(eq(textMessages.userId, principal.userId), eq(textMessages.id, run.replyMessageId)),
          );
        if (
          !message ||
          (message.body !== input.body &&
            message.body !== `${input.body}\nReply STOP to unsubscribe.`)
        )
          throw new AppError("conflict", "This run already has a different reply.");
        return null;
      }
      if (run.state !== "running") throw new AppError("conflict", "This run is not running.");
      return {
        body: input.body,
        queued: async (messageId: string) => {
          await tx.insert(auditEvents).values(
            auditValues({
              action: "texting.agent.reply",
              before: { state: run.state },
              after: { messageId },
              entityId: run.id,
              entityType: "texting_agent_run",
              principal,
              requestId: input.invocationId,
            }),
          );
          await tx
            .update(textingAgentRuns)
            .set({ state: "completed", replyMessageId: messageId, updatedAt: now() })
            .where(eq(textingAgentRuns.id, run.id));
        },
      };
    });
    const [run] = await db
      .select()
      .from(textingAgentRuns)
      .where(and(eq(textingAgentRuns.userId, principal.userId), eq(textingAgentRuns.id, runId)));
    if (!run) throw new AppError("not_found", "Texting run not found.");
    return publicTextingRun(run);
  }
  async function recover(principal: Principal, runId: string, raw: unknown) {
    if (principal.actorType !== "user")
      throw new AppError("forbidden", "Only the account owner can recover an interrupted run.");
    const input = textingAgentRecoverySchema.parse(raw);
    await db.transaction(async (tx) => {
      await lockTextingOwner(tx, principal.userId);
      const authority = await textingAgentAuthority(tx, principal.userId, now(), options.enabled());
      const [run] = await tx
        .select()
        .from(textingAgentRuns)
        .where(and(eq(textingAgentRuns.userId, principal.userId), eq(textingAgentRuns.id, runId)))
        .for("update");
      if (!run) throw new AppError("not_found", "Texting run not found.");
      if (run.reason === "retry_requested") {
        if (input.action === "retry") return;
        throw new AppError(
          "conflict",
          "This request has already been queued again. Inspect the current run instead.",
        );
      }
      if (input.action === "retry") {
        if (run.state !== "blocked" || run.invocationId || run.reason !== "host_rejected")
          throw new AppError(
            "conflict",
            "Only a definitely rejected, unclaimed request can be retried.",
          );
        if (
          authority.readiness !== "ready" ||
          authority.schedule?.id !== run.scheduleId ||
          authority.connection?.id !== run.connectionId ||
          authority.connection.consentEpoch !== run.consentEpoch ||
          authority.schedule.authorizationConnectionId !== run.authorizationConnectionId
        )
          throw new AppError(
            "forbidden",
            "Restore the original connection and consent before retrying.",
          );
        await tx
          .update(textingAgentRuns)
          .set({ reason: "retry_requested", updatedAt: now() })
          .where(eq(textingAgentRuns.id, run.id));
        await tx
          .update(textingAgentQueue)
          .set({ runId: null, availableAt: new Date(now().getTime() + 5000) })
          .where(
            and(eq(textingAgentQueue.userId, principal.userId), eq(textingAgentQueue.runId, runId)),
          );
      } else {
        if (run.state === "completed")
          throw new AppError("conflict", "A completed reply cannot be reopened.");
        const work = run.work.map((item) =>
          item.state === "pending" ? { ...item, state: "uncertain" as const } : item,
        );
        await tx
          .update(textingAgentRuns)
          .set({ state: "blocked", reason: "human_closed", work, updatedAt: now() })
          .where(eq(textingAgentRuns.id, run.id));
        for (const item of work)
          await tx
            .update(textingAgentWork)
            .set({ item, updatedAt: now() })
            .where(
              and(
                eq(textingAgentWork.userId, principal.userId),
                eq(textingAgentWork.runId, run.id),
                eq(textingAgentWork.domain, item.domain),
                eq(textingAgentWork.key, item.key),
              ),
            );
      }
      await tx.insert(auditEvents).values(
        auditValues({
          action: `texting.agent.${input.action}`,
          before: { state: run.state },
          after: { action: input.action },
          entityId: run.id,
          entityType: "texting_agent_run",
          principal,
          requestId: crypto.randomUUID(),
        }),
      );
    });
    return status(principal);
  }
  return { status, configure, claim, checkpoint, reply, recover };
}
