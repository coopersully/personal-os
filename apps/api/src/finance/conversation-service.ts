import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  auditEvents,
  type Database,
  financeConversationBatches,
  financeConversationBatchMessages,
  financeConversationCapabilities,
  financeConversationMessages,
  financeConversations,
  type workspaceMaintenanceRuns,
} from "@personal-os/database";
import {
  FINANCE_CONVERSATION_PROTOCOL_VERSION,
  type FinanceConversationBatch,
  type FinanceConversationMessage,
} from "@personal-os/domain";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { AppError } from "../errors.js";
import type { Principal } from "../types.js";
import { requireWorkspaceExecution } from "../workspace-execution.js";
import { requireHostRunAuthority } from "./host-run-authority.js";

export type ConversationBinding = {
  userId: string;
  automationScheduleId: string;
  authorizationConnectionId: string;
  protocolVersion: string;
};
export type ConversationProof = ConversationBinding & {
  challengeId: string;
  nonceDigest: string;
  expiresAt: Date;
  fetchedAt: Date | null;
  acknowledgedAt: Date | null;
  respondedAt: Date | null;
  verifiedAt: Date | null;
  response: string | null;
};
export function conversationNonceDigest(nonce: string): string {
  return createHash("sha256").update(nonce).digest("hex");
}

/** Every protocol operation rechecks the original binding and live grant. */
export function requireConversationBinding(
  expected: ConversationBinding,
  actual: ConversationBinding,
  liveGrant: boolean,
) {
  if (
    !liveGrant ||
    expected.userId !== actual.userId ||
    expected.automationScheduleId !== actual.automationScheduleId ||
    expected.authorizationConnectionId !== actual.authorizationConnectionId ||
    expected.protocolVersion !== actual.protocolVersion
  ) {
    throw new AppError(
      "forbidden",
      "Use the original active Finance host connection and protocol.",
    );
  }
}

/** Returned state must be persisted under the capability row lock before replying. */
export function advanceConversationProof(input: {
  proof: ConversationProof;
  binding: ConversationBinding;
  liveGrant: boolean;
  now: Date;
  operation:
    | { kind: "fetch" }
    | { kind: "acknowledge"; challengeId: string; nonce: string }
    | { kind: "respond"; challengeId: string; response: string };
}): ConversationProof {
  const { proof, binding, liveGrant, now, operation } = input;
  requireConversationBinding(proof, binding, liveGrant);
  if (proof.expiresAt.getTime() <= now.getTime()) {
    throw new AppError(
      "conflict",
      "The Finance message challenge expired. Request a fresh challenge.",
    );
  }
  if (operation.kind === "fetch") return { ...proof, fetchedAt: proof.fetchedAt ?? now };
  if (operation.challengeId !== proof.challengeId)
    throw new AppError("conflict", "Acknowledge the exact issued message challenge.");
  if (!proof.fetchedAt) throw new AppError("conflict", "Fetch the message challenge first.");
  if (operation.kind === "acknowledge") {
    if (operation.nonce.length > 256)
      throw new AppError("invalid_request", "The message challenge nonce is too long.");
    const digest = conversationNonceDigest(operation.nonce);
    if (
      digest.length !== proof.nonceDigest.length ||
      !timingSafeEqual(Buffer.from(digest), Buffer.from(proof.nonceDigest))
    ) {
      throw new AppError("conflict", "Acknowledge the exact issued message challenge.");
    }
    return { ...proof, acknowledgedAt: proof.acknowledgedAt ?? now };
  }
  if (!proof.acknowledgedAt)
    throw new AppError("conflict", "Acknowledge the message challenge before responding.");
  const response = operation.response.trim();
  if (!response || response.length > 1000)
    throw new AppError("invalid_request", "Provide a bounded harmless challenge response.");
  if (proof.response !== null && proof.response !== response)
    throw new AppError("conflict", "The saved challenge response is immutable.");
  return {
    ...proof,
    response,
    respondedAt: proof.respondedAt ?? now,
    verifiedAt: proof.verifiedAt ?? now,
  };
}

export type ConversationBatchStore<Transaction> = {
  /** Calls occur inside the existing owner-locked canonical run transaction. */
  findBatch(
    tx: Transaction,
    userId: string,
    runId: string,
  ): Promise<FinanceConversationBatch | null>;
  currentSequence(tx: Transaction, userId: string): Promise<string>;
  /** Persists batch AND membership through cutoff atomically; excludes previously batched messages. */
  insertBatch(tx: Transaction, userId: string, batch: FinanceConversationBatch): Promise<void>;
};

/** Run coalescence and retries retain the original batch, including an originally empty batch. */
export async function captureFinanceConversationBatch<Transaction>(input: {
  tx: Transaction;
  store: ConversationBatchStore<Transaction>;
  userId: string;
  runId: string;
  automationScheduleId: string | null;
  authorizationConnectionId: string | null;
  now: Date;
}): Promise<FinanceConversationBatch> {
  const { tx, store, userId, runId } = input;
  const existing = await store.findBatch(tx, userId, runId);
  if (existing) {
    if (
      existing.automationScheduleId !== input.automationScheduleId ||
      existing.authorizationConnectionId !== input.authorizationConnectionId
    ) {
      throw new AppError(
        "conflict",
        "Recover the original run binding before reading its saved message batch.",
      );
    }
    return existing;
  }
  const batch: FinanceConversationBatch = {
    runId,
    automationScheduleId: input.automationScheduleId,
    authorizationConnectionId: input.authorizationConnectionId,
    cutoffSequence: await store.currentSequence(tx, userId),
    capturedAt: input.now.toISOString(),
  };
  await store.insertBatch(tx, userId, batch);
  return batch;
}

export function requireDeliveredConversationAcknowledgment(
  deliveredMessageIds: readonly string[],
  acknowledgedMessageIds: readonly string[],
) {
  const delivered = new Set(deliveredMessageIds);
  if (
    new Set(acknowledgedMessageIds).size !== acknowledgedMessageIds.length ||
    acknowledgedMessageIds.some((id) => !delivered.has(id))
  ) {
    throw new AppError(
      "conflict",
      "Acknowledge only exact messages delivered from this run's batch.",
    );
  }
}

export function requireConversationCausality(
  batch: FinanceConversationBatch,
  messages: readonly FinanceConversationMessage[],
  sourceMessageIds: readonly string[],
) {
  const sources = new Map(messages.map((message) => [message.id, message]));
  if (
    new Set(sourceMessageIds).size !== sourceMessageIds.length ||
    sourceMessageIds.some((id) => {
      const message = sources.get(id);
      return !message || BigInt(message.sequence) > BigInt(batch.cutoffSequence);
    })
  )
    throw new AppError("conflict", "An action can cite only messages in its fixed run batch.");
}

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export const postgresConversationBatchStore: ConversationBatchStore<Transaction> = {
  async findBatch(tx, userId, runId) {
    const [row] = await tx
      .select()
      .from(financeConversationBatches)
      .where(
        and(
          eq(financeConversationBatches.userId, userId),
          eq(financeConversationBatches.runId, runId),
        ),
      );
    return row
      ? {
          runId: row.runId,
          automationScheduleId: row.automationScheduleId,
          authorizationConnectionId: row.authorizationConnectionId,
          cutoffSequence: row.cutoffSequence.toString(),
          capturedAt: row.capturedAt.toISOString(),
        }
      : null;
  },
  async currentSequence(tx, userId) {
    const [row] = await tx
      .select()
      .from(financeConversations)
      .where(eq(financeConversations.userId, userId))
      .for("update");
    return row?.nextSequence.toString() ?? "0";
  },
  async insertBatch(tx, userId, batch) {
    await tx.insert(financeConversationBatches).values({
      ...batch,
      userId,
      cursorKey: randomBytes(32).toString("hex"),
      cutoffSequence: BigInt(batch.cutoffSequence),
      capturedAt: new Date(batch.capturedAt),
    });
    await tx.execute(sql`INSERT INTO ${financeConversationBatchMessages} (user_id, run_id, message_id)
      SELECT ${userId}::uuid, ${batch.runId}::uuid, m.id FROM ${financeConversationMessages} m
      WHERE m.user_id = ${userId}::uuid AND m.author_kind = 'user' AND m.sequence <= ${batch.cutoffSequence}::bigint
      AND NOT EXISTS (SELECT 1 FROM ${financeConversationBatchMessages} old WHERE old.user_id = m.user_id AND old.message_id = m.id)`);
  },
};

export function encodeConversationBatchCursor(
  userId: string,
  batch: FinanceConversationBatch,
  sequence: string,
  key: string,
): string {
  const payload = Buffer.from(
    JSON.stringify({ userId, runId: batch.runId, cutoffSequence: batch.cutoffSequence, sequence }),
  ).toString("base64url");
  return `${payload}.${createHmac("sha256", key).update(payload).digest("hex")}`;
}
export function decodeConversationBatchCursor(
  cursor: string,
  userId: string,
  batch: FinanceConversationBatch,
  key: string,
): bigint {
  if (cursor === "0") return 0n;
  try {
    if (cursor.length > 2000) throw new Error("cursor length");
    const [payload, signature, extra] = cursor.split(".");
    if (!payload || !signature || extra) throw new Error("unsigned cursor");
    const expected = createHmac("sha256", key).update(payload).digest("hex");
    if (
      signature.length !== expected.length ||
      !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    )
      throw new Error("cursor signature");
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (
      parsed.userId !== userId ||
      parsed.runId !== batch.runId ||
      parsed.cutoffSequence !== batch.cutoffSequence ||
      typeof parsed.sequence !== "string" ||
      !/^(0|[1-9][0-9]*)$/u.test(parsed.sequence)
    )
      throw new Error("cursor binding");
    const sequence = BigInt(parsed.sequence);
    if (sequence > BigInt(batch.cutoffSequence)) throw new Error("cursor cutoff");
    return sequence;
  } catch {
    throw new AppError(
      "invalid_request",
      "Use the signed page cursor from this owner's exact saved run batch.",
    );
  }
}

/** Existing accepted-answer tx owns authority, canonical operation/revision and continuation. */
export async function recordFinanceConversationAcceptedAnswer(
  tx: Transaction,
  input: {
    userId: string;
    operationId: string;
    caseId: string;
    questionId?: string;
    sourceMessageIds?: string[];
    transactionId: string;
    text: string;
    recordedAt: Date;
  },
) {
  const key = `answer:${input.operationId}`;
  const [existing] = await tx
    .select()
    .from(financeConversationMessages)
    .where(
      and(
        eq(financeConversationMessages.userId, input.userId),
        eq(financeConversationMessages.authorKind, "user"),
        eq(financeConversationMessages.idempotencyKey, key),
      ),
    );
  if (existing) {
    if (
      existing.sourceOperationId !== input.operationId ||
      (existing.caseId ?? existing.recordRefs.find((ref) => ref.kind === "review_case")?.id) !==
        input.caseId ||
      existing.text !== input.text
    )
      throw new AppError("conflict", "The canonical answer message already has different content.");
    return existing;
  }
  let sourceMessageIds = input.sourceMessageIds ?? [];
  if (input.questionId && !input.sourceMessageIds) {
    const [question] = await tx
      .select({ id: financeConversationMessages.id })
      .from(financeConversationMessages)
      .innerJoin(
        auditEvents,
        and(
          eq(auditEvents.userId, financeConversationMessages.userId),
          eq(auditEvents.action, "finance.contextual_question.created"),
          eq(auditEvents.entityId, input.questionId),
          eq(auditEvents.actorType, "agent"),
          sql`${auditEvents.after}->>'operationId' = ${financeConversationMessages.sourceOperationId}`,
          sql`${auditEvents.after}->>'prompt' = ${financeConversationMessages.text}`,
        ),
      )
      .where(
        and(
          eq(financeConversationMessages.userId, input.userId),
          eq(financeConversationMessages.authorKind, "agent"),
          sql`${financeConversationMessages.recordRefs} @> ${JSON.stringify([
            { kind: "contextual_question" as const, id: input.questionId },
            { kind: "review_case", id: input.caseId },
          ])}::jsonb`,
        ),
      )
      .limit(1);
    sourceMessageIds = question ? [question.id] : [];
  }
  // Row allocation serializes against batch cutoff reads without taking a new
  // advisory lock after the answer service's existing question/receipt locks.
  const [conversation] = await tx
    .insert(financeConversations)
    .values({ userId: input.userId, nextSequence: 1n })
    .onConflictDoUpdate({
      target: financeConversations.userId,
      set: { nextSequence: sql`${financeConversations.nextSequence} + 1` },
    })
    .returning();
  if (!conversation)
    throw new AppError("internal_error", "The answer message sequence was not allocated.");
  const [message] = await tx
    .insert(financeConversationMessages)
    .values({
      userId: input.userId,
      sequence: conversation.nextSequence,
      authorKind: "user",
      text: input.text,
      caseId: input.caseId,
      caseOwnerId: input.userId,
      sourceOperationId: input.operationId,
      idempotencyKey: key,
      recordRefs: [
        { kind: "review_case", id: input.caseId },
        ...(input.questionId
          ? [{ kind: "contextual_question" as const, id: input.questionId }]
          : []),
        { kind: "transaction", id: input.transactionId },
      ],
      sourceMessageIds,
      createdAt: input.recordedAt,
    })
    .returning();
  if (!message)
    throw new AppError("internal_error", "The canonical answer message was not recorded.");
  return message;
}

/** An ineligible run must never reserve or consume the owner's pending queue. */
export async function hasUsableFinanceConversationConsumer(
  tx: Transaction,
  run: typeof workspaceMaintenanceRuns.$inferSelect,
  principal: Principal,
  now: Date,
): Promise<boolean> {
  if (
    !run.automationScheduleId ||
    !run.authorizationConnectionId ||
    principal.actorType !== "agent"
  )
    return false;
  try {
    await requireHostRunAuthority(tx, run, principal, now);
    await requireWorkspaceExecution(tx, principal, "finances", now);
  } catch (error) {
    if (error instanceof AppError && error.code === "forbidden") return false;
    throw error;
  }
  const [proof] = await tx
    .select({ id: financeConversationCapabilities.id })
    .from(financeConversationCapabilities)
    .where(
      and(
        eq(financeConversationCapabilities.userId, run.userId),
        eq(financeConversationCapabilities.automationScheduleId, run.automationScheduleId),
        eq(
          financeConversationCapabilities.authorizationConnectionId,
          run.authorizationConnectionId,
        ),
        eq(financeConversationCapabilities.protocolVersion, FINANCE_CONVERSATION_PROTOCOL_VERSION),
        isNotNull(financeConversationCapabilities.verifiedAt),
      ),
    )
    .limit(1);
  return proof !== undefined;
}
