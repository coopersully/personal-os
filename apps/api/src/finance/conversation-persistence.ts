import { randomBytes } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  accessTokens,
  automationHostSchedules,
  type Database,
  financeAccounts,
  financeContextualQuestions,
  financeConversationBatches,
  financeConversationBatchMessages,
  financeConversationCapabilities,
  financeConversationMessages,
  financeConversationReadCursors,
  financeConversations,
  financeReviewCases,
  financeTransactions,
  workspaceMaintenanceRuns,
} from "@personal-os/database";
import {
  FINANCE_CONVERSATION_PROTOCOL_VERSION,
  type FinanceConversationMessage,
  type FinanceConversationReadiness,
  type FinanceConversationSendInput,
  financeConversationSendInputSchema,
  financeConversationSequenceSchema,
  projectFinanceConversationReadiness,
} from "@personal-os/domain";
import { and, asc, desc, eq, gt, inArray, isNotNull, sql } from "drizzle-orm";
import { activeHostConnectionGrant } from "../automation-host-grant.js";
import { AppError } from "../errors.js";
import type { Principal } from "../types.js";
import { requireWorkspaceExecution } from "../workspace-execution.js";
import {
  advanceConversationProof,
  type ConversationProof,
  conversationNonceDigest,
  decodeConversationBatchCursor,
  encodeConversationBatchCursor,
  postgresConversationBatchStore,
  requireConversationCausality,
  requireDeliveredConversationAcknowledgment,
} from "./conversation-service.js";
import { requireHostRunAuthority } from "./host-run-authority.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
function messageValue(
  row: typeof financeConversationMessages.$inferSelect,
): FinanceConversationMessage {
  return {
    id: row.id,
    sequence: row.sequence.toString(),
    authorKind: row.authorKind,
    text: row.text,
    caseId: row.caseId ?? row.recordRefs.find((ref) => ref.kind === "review_case")?.id ?? null,
    recordRefs: row.recordRefs,
    runId: row.runId,
    sourceMessageIds: row.sourceMessageIds,
    createdAt: row.createdAt.toISOString(),
  };
}
async function lockOwner(tx: Transaction, userId: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`finance-maintenance:${userId}`}, 0))`,
  );
}
async function nextSequence(tx: Transaction, userId: string) {
  const [row] = await tx
    .insert(financeConversations)
    .values({ userId, nextSequence: 1n })
    .onConflictDoUpdate({
      target: financeConversations.userId,
      set: { nextSequence: sql`${financeConversations.nextSequence} + 1` },
    })
    .returning();
  if (!row) throw new AppError("internal_error", "The Finance sequence was not allocated.");
  return row.nextSequence;
}

/** No model or independent dispatcher: all agent access is to an existing maintenance run. */
export function createFinanceConversationService({
  db,
  now = () => new Date(),
}: {
  db: Database;
  now?: () => Date;
}) {
  async function liveSchedule(tx: Transaction, userId: string, scheduleId: string) {
    const [schedule] = await tx
      .select()
      .from(automationHostSchedules)
      .where(
        and(eq(automationHostSchedules.userId, userId), eq(automationHostSchedules.id, scheduleId)),
      )
      .for("share");
    if (!schedule) throw new AppError("not_found", "The Finance host registration was not found.");
    const tokens = await tx
      .select()
      .from(accessTokens)
      .where(
        and(
          eq(accessTokens.userId, userId),
          eq(accessTokens.authorizationConnectionId, schedule.authorizationConnectionId),
          activeHostConnectionGrant(now()),
        ),
      )
      .for("share");
    return {
      schedule,
      liveGrant: tokens.some((token) => token.scopes.includes("finances:maintain")),
    };
  }
  async function readiness(tx: Transaction, userId: string): Promise<FinanceConversationReadiness> {
    const schedules = await tx
      .select()
      .from(automationHostSchedules)
      .where(eq(automationHostSchedules.userId, userId))
      .orderBy(desc(automationHostSchedules.updatedAt));
    let fallback: FinanceConversationReadiness | null = null;
    for (const candidate of schedules) {
      const { schedule, liveGrant } = await liveSchedule(tx, userId, candidate.id);
      const [proof] = await tx
        .select()
        .from(financeConversationCapabilities)
        .where(
          and(
            eq(financeConversationCapabilities.userId, userId),
            eq(financeConversationCapabilities.automationScheduleId, schedule.id),
            eq(
              financeConversationCapabilities.authorizationConnectionId,
              schedule.authorizationConnectionId,
            ),
          ),
        )
        .orderBy(desc(financeConversationCapabilities.createdAt))
        .limit(1);
      const registrationState =
        schedule.schedule.state === "active"
          ? "active"
          : schedule.schedule.state === "paused"
            ? "paused"
            : schedule.schedule.state === "setup_pending"
              ? "missing"
              : "revoked";
      const result = projectFinanceConversationReadiness({
        registrationState,
        connectionState: liveGrant ? "live" : "disconnected",
        messageCapability: !proof
          ? "unverified"
          : proof.protocolVersion !== FINANCE_CONVERSATION_PROTOCOL_VERSION
            ? "protocol_upgrade_required"
            : proof.verifiedAt
              ? "verified"
              : proof.expiresAt <= now()
                ? "expired"
                : "unverified",
      });
      if (result.canSend) return result;
      fallback ??= result;
    }
    return (
      fallback ??
      projectFinanceConversationReadiness({
        registrationState: "missing",
        connectionState: "missing",
        messageCapability: "unverified",
      })
    );
  }
  async function validateContext(
    tx: Transaction,
    userId: string,
    input: FinanceConversationSendInput,
  ) {
    if (input.caseId) {
      const [owned] = await tx
        .select({ id: financeReviewCases.id })
        .from(financeReviewCases)
        .where(and(eq(financeReviewCases.userId, userId), eq(financeReviewCases.id, input.caseId)))
        .for("share");
      if (!owned) throw new AppError("not_found", "The Finance case was not found.");
    }
    for (const ref of input.recordRefs) {
      const table =
        ref.kind === "transaction"
          ? financeTransactions
          : ref.kind === "account"
            ? financeAccounts
            : ref.kind === "review_case"
              ? financeReviewCases
              : financeContextualQuestions;
      const [owned] = await tx
        .select({ id: table.id })
        .from(table)
        .where(and(eq(table.userId, userId), eq(table.id, ref.id)))
        .for("share");
      if (!owned) throw new AppError("not_found", "A referenced Finance record was not found.");
    }
  }
  async function ownedRun(tx: Transaction, principal: Principal, runId: string) {
    const [run] = await tx
      .select()
      .from(workspaceMaintenanceRuns)
      .where(
        and(
          eq(workspaceMaintenanceRuns.userId, principal.userId),
          eq(workspaceMaintenanceRuns.id, runId),
          eq(workspaceMaintenanceRuns.domain, "finances"),
        ),
      )
      .for("update");
    if (!run) throw new AppError("not_found", "The Finance run was not found.");
    if (
      principal.actorType !== "agent" ||
      !run.automationScheduleId ||
      !run.authorizationConnectionId
    )
      throw new AppError("forbidden", "Use the original registered Finance host.");
    await requireHostRunAuthority(tx, run, principal, now());
    await requireWorkspaceExecution(tx, principal, "finances", now());
    return run;
  }
  async function batch(tx: Transaction, principal: Principal, runId: string) {
    const run = await ownedRun(tx, principal, runId);
    const saved = await postgresConversationBatchStore.findBatch(tx, principal.userId, runId);
    if (!saved)
      throw new AppError("conflict", "Start Finance maintenance to capture its message batch.");
    const [proof] = await tx
      .select({ id: financeConversationCapabilities.id })
      .from(financeConversationCapabilities)
      .where(
        and(
          eq(financeConversationCapabilities.userId, principal.userId),
          eq(
            financeConversationCapabilities.automationScheduleId,
            run.automationScheduleId as string,
          ),
          eq(
            financeConversationCapabilities.authorizationConnectionId,
            run.authorizationConnectionId as string,
          ),
          eq(
            financeConversationCapabilities.protocolVersion,
            FINANCE_CONVERSATION_PROTOCOL_VERSION,
          ),
          isNotNull(financeConversationCapabilities.verifiedAt),
        ),
      )
      .limit(1);
    if (!proof)
      throw new AppError(
        "conflict",
        "Verify this original host's current Finance message protocol first.",
      );
    if (
      saved.authorizationConnectionId !== run.authorizationConnectionId ||
      saved.automationScheduleId !== run.automationScheduleId
    )
      throw new AppError("conflict", "Recover this batch's original host binding explicitly.");
    return saved;
  }
  return {
    async getReadiness(userId: string) {
      return db.transaction((tx) => readiness(tx, userId));
    },
    async send(principal: Principal, raw: FinanceConversationSendInput) {
      if (principal.actorType !== "user" || principal.actorId !== principal.userId)
        throw new AppError("forbidden", "Only the owner can send a Finance message.");
      const input = financeConversationSendInputSchema.parse(raw);
      if (
        input.caseId &&
        !input.recordRefs.some((ref) => ref.kind === "review_case" && ref.id === input.caseId)
      )
        input.recordRefs.push({ kind: "review_case", id: input.caseId });
      return db.transaction(async (tx) => {
        await lockOwner(tx, principal.userId);
        const [existing] = await tx
          .select()
          .from(financeConversationMessages)
          .where(
            and(
              eq(financeConversationMessages.userId, principal.userId),
              eq(financeConversationMessages.authorKind, "user"),
              eq(financeConversationMessages.idempotencyKey, input.idempotencyKey),
            ),
          );
        if (existing) {
          if (
            existing.text !== input.text ||
            messageValue(existing).caseId !== input.caseId ||
            !isDeepStrictEqual(existing.recordRefs, input.recordRefs)
          )
            throw new AppError("conflict", "This message identity already has different content.");
          return messageValue(existing);
        }
        if (!(await readiness(tx, principal.userId)).canSend)
          throw new AppError(
            "conflict",
            "Verify an active Finance host message protocol before sending.",
          );
        await validateContext(tx, principal.userId, input);
        const sequence = await nextSequence(tx, principal.userId);
        const [row] = await tx
          .insert(financeConversationMessages)
          .values({
            ...input,
            userId: principal.userId,
            sequence,
            authorKind: "user",
            caseOwnerId: input.caseId ? principal.userId : null,
            sourceMessageIds: [],
            createdAt: now(),
          })
          .returning();
        if (!row) throw new AppError("internal_error", "The Finance message was not accepted.");
        return messageValue(row);
      });
    },
    async history(userId: string, after = "0", limit = 50) {
      const sequence = BigInt(financeConversationSequenceSchema.parse(after));
      if (!Number.isInteger(limit) || limit < 1 || limit > 100)
        throw new AppError("invalid_request", "Choose a page size between 1 and 100.");
      const rows = await db
        .select()
        .from(financeConversationMessages)
        .where(
          and(
            eq(financeConversationMessages.userId, userId),
            gt(financeConversationMessages.sequence, sequence),
          ),
        )
        .orderBy(asc(financeConversationMessages.sequence))
        .limit(limit + 1);
      const messages = rows.slice(0, limit).map(messageValue);
      return {
        messages,
        nextCursor: rows.length > limit ? (messages.at(-1)?.sequence ?? null) : null,
      };
    },
    async markRendered(principal: Principal, throughSequence: string) {
      if (principal.actorType !== "user" || principal.actorId !== principal.userId)
        throw new AppError("forbidden", "Only the owner can mark rendered Finance messages read.");
      const through = BigInt(financeConversationSequenceSchema.parse(throughSequence));
      return db.transaction(async (tx) => {
        await lockOwner(tx, principal.userId);
        const [conversation] = await tx
          .select()
          .from(financeConversations)
          .where(eq(financeConversations.userId, principal.userId));
        if (through > (conversation?.nextSequence ?? 0n))
          throw new AppError("conflict", "The rendered cursor exceeds the saved conversation.");
        const [cursor] = await tx
          .insert(financeConversationReadCursors)
          .values({ userId: principal.userId, readThroughSequence: through, updatedAt: now() })
          .onConflictDoUpdate({
            target: financeConversationReadCursors.userId,
            set: {
              readThroughSequence: sql`greatest(${financeConversationReadCursors.readThroughSequence}, ${through}::bigint)`,
              updatedAt: now(),
            },
          })
          .returning();
        return { readThroughSequence: cursor?.readThroughSequence.toString() ?? "0" };
      });
    },
    async pageBatch(principal: Principal, runId: string, after = "0", limit = 50) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100)
        throw new AppError("invalid_request", "Choose a page size between 1 and 100.");
      return db.transaction(async (tx) => {
        await lockOwner(tx, principal.userId);
        const saved = await batch(tx, principal, runId);
        const [privateBatch] = await tx
          .select({ cursorKey: financeConversationBatches.cursorKey })
          .from(financeConversationBatches)
          .where(
            and(
              eq(financeConversationBatches.userId, principal.userId),
              eq(financeConversationBatches.runId, runId),
            ),
          );
        if (!privateBatch)
          throw new AppError("conflict", "The saved message batch is unavailable.");
        const sequence = decodeConversationBatchCursor(
          after,
          principal.userId,
          saved,
          privateBatch.cursorKey,
        );
        if (sequence > BigInt(saved.cutoffSequence))
          throw new AppError("conflict", "The page cursor exceeds this fixed batch.");
        const rows = await tx
          .select({ message: financeConversationMessages })
          .from(financeConversationBatchMessages)
          .innerJoin(
            financeConversationMessages,
            and(
              eq(financeConversationMessages.userId, financeConversationBatchMessages.userId),
              eq(financeConversationMessages.id, financeConversationBatchMessages.messageId),
            ),
          )
          .where(
            and(
              eq(financeConversationBatchMessages.userId, principal.userId),
              eq(financeConversationBatchMessages.runId, runId),
              gt(financeConversationMessages.sequence, sequence),
            ),
          )
          .orderBy(asc(financeConversationMessages.sequence))
          .limit(limit + 1);
        const messages = rows.slice(0, limit).map(({ message }) => messageValue(message));
        if (messages.length)
          await tx
            .update(financeConversationBatchMessages)
            .set({
              deliveredAt: sql`coalesce(${financeConversationBatchMessages.deliveredAt}, ${now()})`,
            })
            .where(
              and(
                eq(financeConversationBatchMessages.userId, principal.userId),
                eq(financeConversationBatchMessages.runId, runId),
                inArray(
                  financeConversationBatchMessages.messageId,
                  messages.map((message) => message.id),
                ),
              ),
            );
        return {
          batch: saved,
          messages,
          nextCursor:
            rows.length > limit
              ? encodeConversationBatchCursor(
                  principal.userId,
                  saved,
                  messages.at(-1)?.sequence ?? "0",
                  privateBatch.cursorKey,
                )
              : null,
        };
      });
    },
    async acknowledgeBatch(principal: Principal, runId: string, messageIds: string[]) {
      if (messageIds.length > 100)
        throw new AppError("invalid_request", "Acknowledge at most 100 delivered messages.");
      return db.transaction(async (tx) => {
        await lockOwner(tx, principal.userId);
        await batch(tx, principal, runId);
        const delivered = await tx
          .select({ id: financeConversationBatchMessages.messageId })
          .from(financeConversationBatchMessages)
          .where(
            and(
              eq(financeConversationBatchMessages.userId, principal.userId),
              eq(financeConversationBatchMessages.runId, runId),
              isNotNull(financeConversationBatchMessages.deliveredAt),
              inArray(financeConversationBatchMessages.messageId, messageIds),
            ),
          );
        requireDeliveredConversationAcknowledgment(
          delivered.map((row) => row.id),
          messageIds,
        );
        if (messageIds.length)
          await tx
            .update(financeConversationBatchMessages)
            .set({
              acknowledgedAt: sql`coalesce(${financeConversationBatchMessages.acknowledgedAt}, ${now()})`,
            })
            .where(
              and(
                eq(financeConversationBatchMessages.userId, principal.userId),
                eq(financeConversationBatchMessages.runId, runId),
                inArray(financeConversationBatchMessages.messageId, messageIds),
              ),
            );
        return { acknowledgedMessageIds: messageIds };
      });
    },
    async reply(
      principal: Principal,
      input: {
        runId: string;
        text: string;
        idempotencyKey: string;
        sourceMessageIds: string[];
        caseId?: string | null;
      },
    ) {
      const parsed = financeConversationSendInputSchema.parse({
        text: input.text,
        idempotencyKey: input.idempotencyKey,
        caseId: input.caseId ?? null,
      });
      if (!input.sourceMessageIds.length || input.sourceMessageIds.length > 100)
        throw new AppError("invalid_request", "A reply requires bounded batch source messages.");
      return db.transaction(async (tx) => {
        await lockOwner(tx, principal.userId);
        const saved = await batch(tx, principal, input.runId);
        const sourceRows = await tx
          .select({ message: financeConversationMessages })
          .from(financeConversationBatchMessages)
          .innerJoin(
            financeConversationMessages,
            and(
              eq(financeConversationMessages.userId, financeConversationBatchMessages.userId),
              eq(financeConversationMessages.id, financeConversationBatchMessages.messageId),
            ),
          )
          .where(
            and(
              eq(financeConversationBatchMessages.userId, principal.userId),
              eq(financeConversationBatchMessages.runId, input.runId),
              inArray(financeConversationBatchMessages.messageId, input.sourceMessageIds),
            ),
          );
        const sources = sourceRows.map(({ message }) => messageValue(message));
        requireConversationCausality(saved, sources, input.sourceMessageIds);
        if (parsed.caseId && !sources.some((source) => source.caseId === parsed.caseId))
          throw new AppError("conflict", "The reply case must match its batch sources.");
        const [existing] = await tx
          .select()
          .from(financeConversationMessages)
          .where(
            and(
              eq(financeConversationMessages.userId, principal.userId),
              eq(financeConversationMessages.authorKind, "agent"),
              eq(financeConversationMessages.idempotencyKey, parsed.idempotencyKey),
            ),
          );
        if (existing) {
          if (
            existing.runId !== input.runId ||
            existing.text !== parsed.text ||
            messageValue(existing).caseId !== parsed.caseId ||
            !isDeepStrictEqual(existing.sourceMessageIds, input.sourceMessageIds)
          )
            throw new AppError("conflict", "This reply identity already has different content.");
          return messageValue(existing);
        }
        const [row] = await tx
          .insert(financeConversationMessages)
          .values({
            ...parsed,
            userId: principal.userId,
            authorKind: "agent",
            caseOwnerId: parsed.caseId ? principal.userId : null,
            recordRefs: parsed.caseId ? [{ kind: "review_case", id: parsed.caseId }] : [],
            runId: input.runId,
            sourceMessageIds: input.sourceMessageIds,
            sequence: await nextSequence(tx, principal.userId),
            createdAt: now(),
          })
          .returning();
        if (!row) throw new AppError("internal_error", "The Finance reply was not persisted.");
        return messageValue(row);
      });
    },
    async issueChallenge(principal: Principal, scheduleId: string) {
      return db.transaction(async (tx) => {
        await lockOwner(tx, principal.userId);
        const { schedule, liveGrant } = await liveSchedule(tx, principal.userId, scheduleId);
        if (
          !liveGrant ||
          schedule.schedule.state !== "active" ||
          principal.actorType !== "user" ||
          principal.actorId !== principal.userId
        )
          throw new AppError(
            "forbidden",
            "Enroll an active host with the owner's live Finance grant.",
          );
        const nonce = randomBytes(32).toString("hex");
        const [row] = await tx
          .insert(financeConversationCapabilities)
          .values({
            userId: principal.userId,
            automationScheduleId: scheduleId,
            authorizationConnectionId: schedule.authorizationConnectionId,
            protocolVersion: FINANCE_CONVERSATION_PROTOCOL_VERSION,
            nonceDigest: conversationNonceDigest(nonce),
            challengeText: nonce,
            expiresAt: new Date(now().getTime() + 600000),
            createdAt: now(),
          })
          .returning();
        if (!row) throw new AppError("internal_error", "The message challenge was not issued.");
        return {
          challengeId: row.id,
          nonce,
          protocolVersion: row.protocolVersion,
          expiresAt: row.expiresAt.toISOString(),
        };
      });
    },
    async advanceChallenge(
      principal: Principal,
      challengeId: string,
      operation: Parameters<typeof advanceConversationProof>[0]["operation"],
    ) {
      return db.transaction(async (tx) => {
        await lockOwner(tx, principal.userId);
        const [row] = await tx
          .select()
          .from(financeConversationCapabilities)
          .where(
            and(
              eq(financeConversationCapabilities.userId, principal.userId),
              eq(financeConversationCapabilities.id, challengeId),
            ),
          )
          .for("update");
        if (!row) throw new AppError("not_found", "The message challenge was not found.");
        const { schedule, liveGrant } = await liveSchedule(
          tx,
          principal.userId,
          row.automationScheduleId,
        );
        const [token] = await tx
          .select()
          .from(accessTokens)
          .where(
            and(
              eq(accessTokens.userId, principal.userId),
              eq(accessTokens.id, principal.actorId),
              eq(accessTokens.authorizationConnectionId, row.authorizationConnectionId),
              activeHostConnectionGrant(now()),
            ),
          )
          .for("share");
        if (principal.actorType !== "agent" || !token?.scopes.includes("finances:maintain"))
          throw new AppError("forbidden", "Use the original authenticated Finance host.");
        await requireWorkspaceExecution(tx, principal, "finances", now());
        const proof: ConversationProof = { ...row, challengeId: row.id };
        const next = advanceConversationProof({
          proof,
          binding: {
            userId: principal.userId,
            automationScheduleId: schedule.id,
            authorizationConnectionId: principal.authorizationConnectionId ?? "",
            protocolVersion: FINANCE_CONVERSATION_PROTOCOL_VERSION,
          },
          liveGrant: liveGrant && schedule.schedule.state === "active",
          now: now(),
          operation,
        });
        await tx
          .update(financeConversationCapabilities)
          .set({
            fetchedAt: next.fetchedAt,
            acknowledgedAt: next.acknowledgedAt,
            respondedAt: next.respondedAt,
            verifiedAt: next.verifiedAt,
            response: next.response,
          })
          .where(eq(financeConversationCapabilities.id, row.id));
        return {
          challengeId: row.id,
          protocolVersion: row.protocolVersion,
          verified: next.verifiedAt !== null,
          ...(operation.kind === "fetch" ? { nonce: row.challengeText } : {}),
        };
      });
    },
  };
}
