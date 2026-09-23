import {
  type Database,
  textInboundClaims,
  textingConnections,
  textMessages,
  textReplyBindings,
  users,
} from "@personal-os/database";
import {
  parseTextReply,
  type TextReplyBindingInput,
  type TextReplyParseResult,
  textReplyBindingInputSchema,
} from "@personal-os/domain";
import { and, asc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { AppError } from "./errors.js";
import {
  readTextingEnabled,
  replyDeliveryState,
  type TextingTransaction,
} from "./texting-sms-admission.js";

function retry(): AppError {
  return new AppError("conflict", "Texting reply changed or is busy. Retry the same operation.", {
    retryable: true,
  });
}

/** Use inside the queued outbound message transaction while its connection UPDATE lock is held. */
export async function createTextReplyBindings(
  tx: TextingTransaction,
  userId: string,
  connection: typeof textingConnections.$inferSelect,
  outboundMessageId: string,
  raw: readonly TextReplyBindingInput[],
  now: Date = new Date(),
) {
  if (
    raw.length < 1 ||
    raw.length > 3 ||
    connection.userId !== userId ||
    connection.state !== "active"
  )
    throw new AppError(
      "invalid_request",
      "Reply bindings require an active owner and one to three items.",
    );
  const [outbound] = await tx
    .select()
    .from(textMessages)
    .where(and(eq(textMessages.userId, userId), eq(textMessages.id, outboundMessageId)))
    .limit(1);
  if (outbound?.direction !== "outbound" || outbound.connectionId !== connection.id)
    throw new AppError("invalid_request", "Reply bindings require the exact outbound message.");
  const inputs = raw.map((value) => textReplyBindingInputSchema.parse(value));
  if (
    new Set(inputs.map((item) => item.itemNumber)).size !== inputs.length ||
    new Set(inputs.map((item) => item.operationId)).size !== inputs.length ||
    inputs.some(
      (item) =>
        item.outboundMessageId !== outboundMessageId ||
        new Date(item.expiresAt).getTime() <= now.getTime() ||
        item.work.kind !== "question" ||
        (item.answerVocabulary !== null &&
          new Set(item.answerVocabulary.map((word) => word.toLowerCase())).size !==
            item.answerVocabulary.length),
    )
  )
    throw new AppError("invalid_request", "Reply binding evidence is invalid or expired.");
  return tx
    .insert(textReplyBindings)
    .values(
      inputs.map((item) => ({
        actionRevision: item.work.actionRevision,
        answerMode: item.answerMode,
        answerVocabulary: item.answerVocabulary,
        connectionId: connection.id,
        consentEpoch: connection.consentEpoch,
        expiresAt: new Date(item.expiresAt),
        itemNumber: item.itemNumber,
        operationId: item.operationId,
        outboundMessageId,
        userId,
        workId: item.work.id,
        workKind: item.work.kind,
        workRevision: item.work.revision,
      })),
    )
    .returning();
}

export type BindInboundResult =
  | { state: "unavailable"; reason: "ambiguous" | "unsupported" | "missing" | "delivery_failed" }
  | { state: "waiting"; reason: "delivery_unconfirmed" | "texting_disabled" }
  | {
      state: "pending";
      children: Array<{ bindingId: string; operationId: string; answer: string }>;
    };

/** Attach each parsed child exactly once before invoking any Finance operation. */
export async function bindInboundReply(
  db: Database,
  userId: string,
  inboundMessageId: string,
  enabled: () => boolean,
  now: Date = new Date(),
): Promise<BindInboundResult> {
  return db.transaction(async (tx) => {
    if (!readTextingEnabled(enabled)) return { state: "waiting", reason: "texting_disabled" };
    const [owner] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .for("key share", { noWait: true })
      .limit(1);
    if (!owner) return { state: "unavailable", reason: "missing" };
    const [connection] = await tx
      .select()
      .from(textingConnections)
      .where(eq(textingConnections.userId, userId))
      .for("share", { noWait: true })
      .limit(1);
    if (connection?.state !== "active") return { state: "unavailable", reason: "missing" };
    const [message] = await tx
      .select()
      .from(textMessages)
      .where(and(eq(textMessages.userId, userId), eq(textMessages.id, inboundMessageId)))
      .for("share", { noWait: true })
      .limit(1);
    if (message?.direction !== "inbound" || message.connectionId !== connection.id)
      return { state: "unavailable", reason: "missing" };
    const [claim] = await tx
      .select()
      .from(textInboundClaims)
      .where(and(eq(textInboundClaims.userId, userId), eq(textInboundClaims.messageId, message.id)))
      .limit(1);
    if (
      !claim ||
      claim.connectionId !== connection.id ||
      claim.consentEpoch !== connection.consentEpoch
    )
      return { state: "unavailable", reason: "missing" };
    const attached = await tx
      .select()
      .from(textReplyBindings)
      .where(
        and(eq(textReplyBindings.userId, userId), eq(textReplyBindings.inboundClaimId, claim.id)),
      )
      .orderBy(asc(textReplyBindings.itemNumber));
    if (attached.length) {
      if (attached.some((row) => row.state === "open" || !row.canonicalAnswer)) throw retry();
      return {
        state: "pending",
        children: attached.map((row) => ({
          bindingId: row.id,
          operationId: row.operationId,
          answer: row.canonicalAnswer ?? "",
        })),
      };
    }
    const candidates = await tx
      .select()
      .from(textReplyBindings)
      .where(
        and(
          eq(textReplyBindings.userId, userId),
          eq(textReplyBindings.connectionId, connection.id),
          eq(textReplyBindings.consentEpoch, connection.consentEpoch),
          eq(textReplyBindings.state, "open"),
          gt(textReplyBindings.expiresAt, now),
          lt(textReplyBindings.createdAt, claim.createdAt),
          lt(textReplyBindings.createdAt, message.occurredAt),
        ),
      )
      .orderBy(asc(textReplyBindings.itemNumber))
      .limit(4);
    if (!candidates.length) return { state: "unavailable", reason: "unsupported" };
    if (new Set(candidates.map((row) => row.outboundMessageId)).size !== 1 || candidates.length > 3)
      return { state: "unavailable", reason: "ambiguous" };
    const candidate = candidates[0];
    if (!candidate) return { state: "unavailable", reason: "unsupported" };
    const [outbound] = await tx
      .select()
      .from(textMessages)
      .where(and(eq(textMessages.userId, userId), eq(textMessages.id, candidate.outboundMessageId)))
      .for("share", { noWait: true })
      .limit(1);
    if (outbound?.direction !== "outbound" || outbound.connectionId !== connection.id)
      return { state: "unavailable", reason: "missing" };
    const delivery = replyDeliveryState(outbound);
    if (delivery === "terminal") return { state: "unavailable", reason: "delivery_failed" };
    if (delivery === "waiting") return { state: "waiting", reason: "delivery_unconfirmed" };
    const parsed: TextReplyParseResult = parseTextReply(
      message.body,
      candidates.map((row) => ({
        id: row.id,
        itemNumber: row.itemNumber,
        answerMode: row.answerMode,
        answerVocabulary: row.answerVocabulary,
      })),
    );
    if (parsed.state !== "matched") return parsed;
    const ids = parsed.choices.map((choice) => choice.bindingId).sort();
    const locked = await tx
      .select()
      .from(textReplyBindings)
      .where(and(eq(textReplyBindings.userId, userId), inArray(textReplyBindings.id, ids)))
      .orderBy(asc(textReplyBindings.id))
      .for("update", { noWait: true });
    if (
      locked.length !== ids.length ||
      locked.some(
        (row) =>
          row.state !== "open" ||
          row.connectionId !== connection.id ||
          row.consentEpoch !== connection.consentEpoch ||
          row.expiresAt <= now ||
          row.createdAt >= claim.createdAt ||
          row.createdAt >= message.occurredAt,
      )
    )
      throw retry();
    if (!readTextingEnabled(enabled)) return { state: "waiting", reason: "texting_disabled" };
    const children = [];
    for (const row of locked) {
      const choice = parsed.choices.find((item) => item.bindingId === row.id);
      if (!choice) throw retry();
      const [changed] = await tx
        .update(textReplyBindings)
        .set({
          inboundClaimId: claim.id,
          canonicalAnswer: choice.answer,
          state: "pending",
          updatedAt: now,
        })
        .where(and(eq(textReplyBindings.id, row.id), eq(textReplyBindings.state, "open")))
        .returning({ id: textReplyBindings.id });
      if (!changed) throw retry();
      children.push({ bindingId: row.id, operationId: row.operationId, answer: choice.answer });
    }
    children.sort(
      (left, right) =>
        (candidates.find((row) => row.id === left.bindingId)?.itemNumber ?? 0) -
        (candidates.find((row) => row.id === right.bindingId)?.itemNumber ?? 0),
    );
    return { state: "pending", children };
  });
}

/** Persist a non-accepted result or retry state outside Finance; repeat safely after a crash. */
export async function transitionReplyChild(
  db: Database,
  userId: string,
  bindingId: string,
  operationId: string,
  outcome: {
    state: "pending" | "blocked" | "unavailable" | "waiting" | "uncertain";
    reasonCode: string | null;
  },
  now: Date = new Date(),
) {
  return db.transaction(async (tx) => {
    const [owner] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .for("key share", { noWait: true })
      .limit(1);
    if (!owner) return false;
    const [connection] = await tx
      .select({ id: textingConnections.id })
      .from(textingConnections)
      .where(eq(textingConnections.userId, userId))
      .for("share", { noWait: true })
      .limit(1);
    if (!connection) return false;
    const [preview] = await tx
      .select({ inboundClaimId: textReplyBindings.inboundClaimId })
      .from(textReplyBindings)
      .where(and(eq(textReplyBindings.userId, userId), eq(textReplyBindings.id, bindingId)))
      .limit(1);
    if (!preview?.inboundClaimId) return false;
    const [claim] = await tx
      .select({ messageId: textInboundClaims.messageId })
      .from(textInboundClaims)
      .where(
        and(eq(textInboundClaims.userId, userId), eq(textInboundClaims.id, preview.inboundClaimId)),
      )
      .limit(1);
    if (!claim) return false;
    const [message] = await tx
      .select({ id: textMessages.id })
      .from(textMessages)
      .where(and(eq(textMessages.userId, userId), eq(textMessages.id, claim.messageId)))
      .for("share", { noWait: true })
      .limit(1);
    if (!message) return false;
    const [binding] = await tx
      .select()
      .from(textReplyBindings)
      .where(and(eq(textReplyBindings.userId, userId), eq(textReplyBindings.id, bindingId)))
      .for("update", { noWait: true })
      .limit(1);
    if (
      !binding ||
      binding.operationId !== operationId ||
      binding.connectionId !== connection.id ||
      binding.inboundClaimId !== preview.inboundClaimId
    )
      return false;
    if (binding.state === outcome.state && binding.reasonCode === outcome.reasonCode) return true;
    if (binding.state === "pending" && outcome.state === "pending") return false;
    if (binding.state !== "pending" && binding.state !== "waiting" && binding.state !== "uncertain")
      return false;
    const [changed] = await tx
      .update(textReplyBindings)
      .set({ state: outcome.state, reasonCode: outcome.reasonCode, updatedAt: now })
      .where(
        and(eq(textReplyBindings.id, binding.id), eq(textReplyBindings.operationId, operationId)),
      )
      .returning({ id: textReplyBindings.id });
    return Boolean(changed);
  });
}

/** Idempotently terminalize only expired, unanswered bindings; T2 must schedule the sweep. */
export async function expireOpenReplyBindings(
  db: Database,
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  return db.transaction(async (tx) => {
    const [owner] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .for("key share", { noWait: true })
      .limit(1);
    if (!owner) return 0;
    const [connection] = await tx
      .select({ id: textingConnections.id })
      .from(textingConnections)
      .where(eq(textingConnections.userId, userId))
      .for("share", { noWait: true })
      .limit(1);
    if (!connection) return 0;
    const expired = await tx
      .select({ id: textReplyBindings.id })
      .from(textReplyBindings)
      .where(
        and(
          eq(textReplyBindings.userId, userId),
          eq(textReplyBindings.connectionId, connection.id),
          eq(textReplyBindings.state, "open"),
          sql`${textReplyBindings.expiresAt} <= CURRENT_TIMESTAMP`,
        ),
      )
      .orderBy(asc(textReplyBindings.expiresAt), asc(textReplyBindings.id))
      .limit(100)
      .for("update", { noWait: true });
    if (!expired.length) return 0;
    const changed = await tx
      .update(textReplyBindings)
      .set({ state: "expired", updatedAt: now })
      .where(
        inArray(
          textReplyBindings.id,
          expired.map((row) => row.id),
        ),
      )
      .returning({ id: textReplyBindings.id });
    return changed.length;
  });
}
