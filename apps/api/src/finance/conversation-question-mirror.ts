import {
  type Database,
  financeConversationMessages,
  financeConversations,
} from "@personal-os/database";
import { and, eq, sql } from "drizzle-orm";
import { AppError } from "../errors.js";
import type { Principal } from "../types.js";
import { requireWorkspaceExecution } from "../workspace-execution.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** New canonical question creation only; never a backfill or an independent queue. */
export async function mirrorCreatedFinanceQuestion(
  tx: Transaction,
  principal: Principal,
  input: {
    questionId: string;
    caseId: string;
    transactionId: string;
    accountId: string;
    operationId: string;
    prompt: string;
    createdAt: Date;
  },
) {
  if (principal.actorType !== "agent") return null;
  await requireWorkspaceExecution(tx, principal, "finances", input.createdAt);
  const key = `question:${input.questionId}:1`;
  const [existing] = await tx
    .select()
    .from(financeConversationMessages)
    .where(
      and(
        eq(financeConversationMessages.userId, principal.userId),
        eq(financeConversationMessages.authorKind, "agent"),
        eq(financeConversationMessages.idempotencyKey, key),
      ),
    );
  if (existing) {
    if (existing.sourceOperationId !== input.operationId || existing.text !== input.prompt)
      throw new AppError(
        "conflict",
        "The canonical question message already has different creation evidence.",
      );
    return existing;
  }
  const [conversation] = await tx
    .insert(financeConversations)
    .values({ userId: principal.userId, nextSequence: 1n })
    .onConflictDoUpdate({
      target: financeConversations.userId,
      set: { nextSequence: sql`${financeConversations.nextSequence} + 1` },
    })
    .returning();
  if (!conversation)
    throw new AppError("internal_error", "The canonical question sequence was not allocated.");
  const [message] = await tx
    .insert(financeConversationMessages)
    .values({
      userId: principal.userId,
      sequence: conversation.nextSequence,
      authorKind: "agent",
      text: input.prompt,
      caseId: input.caseId,
      caseOwnerId: principal.userId,
      sourceOperationId: input.operationId,
      idempotencyKey: key,
      recordRefs: [
        { kind: "contextual_question", id: input.questionId },
        { kind: "review_case", id: input.caseId },
        { kind: "transaction", id: input.transactionId },
        { kind: "account", id: input.accountId },
      ],
      sourceMessageIds: [],
      createdAt: input.createdAt,
    })
    .returning();
  if (!message)
    throw new AppError("internal_error", "The actual Finance question message was not recorded.");
  return message;
}
