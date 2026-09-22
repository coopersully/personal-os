import {
  type Database,
  textInboundClaims,
  textingConnections,
  textMessages,
  textReplyBindings,
} from "@personal-os/database";
import {
  type FinanceDomainOutcome,
  type FinanceHumanWorkRef,
  financeHumanWorkRefSchema,
  idSchema,
} from "@personal-os/domain";
import { and, eq, sql } from "drizzle-orm";
import { AppError } from "./errors.js";

export type TextingTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Structural twin of the dependent Finance port; neither side imports an unpublished file. */
export type SmsAnswerCommand = {
  operationId: string;
  work: FinanceHumanWorkRef;
  text: string;
  inboundMessageId: string;
  replyBindingId: string;
};
export type SmsAdmission =
  | { state: "unavailable" }
  | {
      state: "verified";
      consume: (accepted: FinanceDomainOutcome & { state: "accepted" }) => Promise<void>;
    };

function retry(): AppError {
  return new AppError(
    "conflict",
    "Texting admission changed or is busy. Retry the same operation.",
    {
      retryable: true,
    },
  );
}

/** Called only by the injected Finance SMS port after its owner and operation locks. */
export async function admitSmsAnswer(
  tx: TextingTransaction,
  expected: SmsAnswerCommand & { userId: string },
  current: Date = new Date(),
): Promise<SmsAdmission> {
  idSchema.parse(expected.userId);
  idSchema.parse(expected.operationId);
  idSchema.parse(expected.inboundMessageId);
  idSchema.parse(expected.replyBindingId);
  const work = financeHumanWorkRefSchema.parse(expected.work);
  if (work.kind !== "question" || !expected.text || expected.text !== expected.text.trim())
    return { state: "unavailable" };
  const [connection] = await tx
    .select()
    .from(textingConnections)
    .where(eq(textingConnections.userId, expected.userId))
    .for("share", { noWait: true })
    .limit(1);
  if (connection?.state !== "active") return { state: "unavailable" };
  const [inbound] = await tx
    .select()
    .from(textMessages)
    .where(
      and(eq(textMessages.userId, expected.userId), eq(textMessages.id, expected.inboundMessageId)),
    )
    .for("share", { noWait: true })
    .limit(1);
  if (inbound?.direction !== "inbound" || inbound.connectionId !== connection.id)
    return { state: "unavailable" };
  const [binding] = await tx
    .select()
    .from(textReplyBindings)
    .where(
      and(
        eq(textReplyBindings.userId, expected.userId),
        eq(textReplyBindings.id, expected.replyBindingId),
      ),
    )
    .for("update", { noWait: true })
    .limit(1);
  if (!binding) return { state: "unavailable" };
  const [claim] = await tx
    .select()
    .from(textInboundClaims)
    .where(
      and(
        eq(textInboundClaims.userId, expected.userId),
        eq(textInboundClaims.id, binding.inboundClaimId ?? "00000000-0000-0000-0000-000000000000"),
      ),
    )
    .limit(1);
  if (
    !claim ||
    claim.messageId !== inbound.id ||
    claim.connectionId !== connection.id ||
    claim.consentEpoch !== connection.consentEpoch ||
    binding.connectionId !== connection.id ||
    binding.consentEpoch !== connection.consentEpoch ||
    binding.state !== "pending" ||
    binding.expiresAt <= current ||
    binding.operationId !== expected.operationId ||
    binding.canonicalAnswer !== expected.text ||
    binding.workId !== work.id ||
    binding.workKind !== work.kind ||
    binding.workRevision !== work.revision ||
    binding.actionRevision !== work.actionRevision
  )
    return { state: "unavailable" };
  let invoked = false;
  return {
    state: "verified",
    consume: async (accepted) => {
      if (invoked || accepted.state !== "accepted" || accepted.operationId !== expected.operationId)
        throw retry();
      invoked = true;
      const [changed] = await tx
        .update(textReplyBindings)
        .set({ state: "accepted", resultRevision: accepted.resultRevision, updatedAt: current })
        .where(
          and(
            eq(textReplyBindings.id, binding.id),
            eq(textReplyBindings.userId, expected.userId),
            eq(textReplyBindings.operationId, expected.operationId),
            eq(textReplyBindings.inboundClaimId, claim.id),
            eq(textReplyBindings.canonicalAnswer, expected.text),
            eq(textReplyBindings.workId, work.id),
            eq(textReplyBindings.workKind, work.kind),
            eq(textReplyBindings.workRevision, work.revision),
            eq(textReplyBindings.actionRevision, work.actionRevision),
            eq(textReplyBindings.state, "pending"),
            sql`${textReplyBindings.expiresAt} > ${current}`,
          ),
        )
        .returning({ id: textReplyBindings.id });
      if (!changed) throw retry();
    },
  };
}
