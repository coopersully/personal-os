import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  accessTokens,
  auditEvents,
  type Database,
  financeBudgetStartPreviews,
  financeConversationMessages,
  financeReviewBatchCorrections,
  financeReviewBatchRuns,
} from "@personal-os/database";
import {
  type FinanceConversationMessage,
  type FinanceConversationSendInput,
  financeConversationAgentCardInputSchema,
  financeConversationHistoryQuerySchema,
} from "@personal-os/domain";
import { and, asc, desc, eq, gt, lt } from "drizzle-orm";
import { auditValues } from "../audit.js";
import { AppError } from "../errors.js";
import { enqueueNativePushEvent } from "../native-push-service.js";
import type { Principal } from "../types.js";
import { guardFinanceExecutionTransaction } from "./execution-owner-guard.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type MessageRow = typeof financeConversationMessages.$inferSelect;
type Context = { principal: Principal; requestId: string };
/** Shared chat annotations are not host replies, financial effects, or approval receipts. */
export function createFinanceAgentConversationService({
  db,
  now,
  nextSequence,
  lockOwner,
  validateContext,
  present,
  presentMany,
}: {
  db: Database;
  now: () => Date;
  nextSequence: (tx: Transaction, ownerId: string) => Promise<bigint>;
  lockOwner: (tx: Transaction, ownerId: string) => Promise<void>;
  validateContext: (
    tx: Transaction,
    ownerId: string,
    input: FinanceConversationSendInput,
  ) => Promise<void>;
  present: (row: MessageRow) => FinanceConversationMessage;
  presentMany: (tx: Transaction, rows: MessageRow[]) => Promise<FinanceConversationMessage[]>;
}) {
  async function authorize(tx: Transaction, principal: Principal, write: boolean) {
    if (principal.actorType !== "agent")
      throw new AppError("forbidden", "Use an authenticated Finance agent connection.");
    await guardFinanceExecutionTransaction(tx, principal.userId, {
      actorIds: [principal.actorId],
      connectionIds: principal.authorizationConnectionId
        ? [principal.authorizationConnectionId]
        : [],
    });
    const scopes = write
      ? (["finances:read", "finances:write", "finances:maintain"] as const)
      : (["finances:read"] as const);
    const token = await tx.query.accessTokens.findFirst({
      where: and(eq(accessTokens.id, principal.actorId), eq(accessTokens.userId, principal.userId)),
    });
    if (
      !token ||
      token.revokedAt ||
      (token.expiresAt && token.expiresAt <= now()) ||
      (token.authorizationConnectionId ?? null) !== (principal.authorizationConnectionId ?? null) ||
      scopes.some((scope) => !principal.scopes.has(scope) || !token.scopes.includes(scope))
    )
      throw new AppError(
        "forbidden",
        "The connected agent's Finance permissions are no longer active.",
      );
  }
  return {
    async getAgentHistory(context: Context, rawQuery: unknown) {
      const query = financeConversationHistoryQuerySchema.parse(rawQuery);
      return db.transaction(async (tx) => {
        await authorize(tx, context.principal, false);
        const backward = query.latest || query.before !== undefined;
        const rows = await tx
          .select()
          .from(financeConversationMessages)
          .where(
            and(
              eq(financeConversationMessages.userId, context.principal.userId),
              backward
                ? query.before === undefined
                  ? undefined
                  : lt(financeConversationMessages.sequence, BigInt(query.before))
                : gt(financeConversationMessages.sequence, BigInt(query.after ?? "0")),
            ),
          )
          .orderBy(
            backward
              ? desc(financeConversationMessages.sequence)
              : asc(financeConversationMessages.sequence),
          )
          .limit(query.limit + 1);
        const messages = await presentMany(
          tx,
          backward ? rows.slice(0, query.limit).reverse() : rows.slice(0, query.limit),
        );
        return {
          messages,
          nextCursor:
            rows.length > query.limit
              ? ((backward ? messages[0] : messages.at(-1))?.sequence ?? null)
              : null,
        };
      });
    },
    async publishAgentCard(context: Context, raw: unknown) {
      const input = financeConversationAgentCardInputSchema.parse(raw);
      const { principal } = context;
      // Domain-owned namespace prevents collision with host replies or another connection.
      const key = `agent-card:${createHash("sha256")
        .update(
          JSON.stringify([
            principal.authorizationConnectionId ?? principal.actorId,
            input.idempotencyKey,
          ]),
        )
        .digest("hex")}`;
      return db.transaction(async (tx) => {
        await authorize(tx, principal, true);
        await lockOwner(tx, principal.userId);
        const existing = await tx.query.financeConversationMessages.findFirst({
          where: and(
            eq(financeConversationMessages.userId, principal.userId),
            eq(financeConversationMessages.authorKind, "agent"),
            eq(financeConversationMessages.idempotencyKey, key),
          ),
        });
        if (existing) {
          if (
            existing.text !== input.text ||
            !isDeepStrictEqual(existing.recordRefs, input.recordRefs)
          )
            throw new AppError(
              "conflict",
              "This card identity already has different content. Read the saved message before retrying.",
            );
          return present(existing);
        }
        for (const ref of input.recordRefs) {
          const table =
            ref.kind === "budget_start_preview"
              ? financeBudgetStartPreviews
              : ref.kind === "review_batch"
                ? financeReviewBatchRuns
                : ref.kind === "review_batch_undo"
                  ? financeReviewBatchCorrections
                  : null;
          if (!table) continue;
          const [owned] = await tx
            .select({ id: table.id })
            .from(table)
            .where(
              and(
                eq(table.userId, principal.userId),
                eq(table.id, ref.id),
                eq(table.actorType, "agent"),
                eq(table.actorId, principal.actorId),
              ),
            )
            .limit(1)
            .for("share");
          if (!owned)
            throw new AppError(
              "not_found",
              "Only this agent's exact review preview can be published.",
            );
        }
        await validateContext(tx, principal.userId, { ...input, caseId: null });
        const [message] = await tx
          .insert(financeConversationMessages)
          .values({
            userId: principal.userId,
            authorKind: "agent",
            text: input.text,
            recordRefs: input.recordRefs,
            idempotencyKey: key,
            sourceMessageIds: [],
            runId: null,
            sequence: await nextSequence(tx, principal.userId),
            createdAt: now(),
          })
          .returning();
        if (!message) throw new AppError("internal_error", "The Finance card was not saved.");
        await tx.insert(auditEvents).values(
          auditValues({
            principal,
            requestId: context.requestId,
            action: "finance_conversation_card.published",
            entityType: "finance_conversation_message",
            entityId: message.id,
            before: null,
            after: {
              authorizationConnectionId: principal.authorizationConnectionId ?? null,
              recordRefs: input.recordRefs,
              financialEffect: false,
              hostAcknowledgment: false,
            },
          }),
        );
        await enqueueNativePushEvent(tx, {
          userId: principal.userId,
          sourceId: message.id,
          kind: "reply",
          sourceRevision: "1",
          createdAt: message.createdAt,
        });
        return present(message);
      });
    },
  };
}
