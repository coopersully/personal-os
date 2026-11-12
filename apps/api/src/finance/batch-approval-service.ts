import { randomUUID } from "node:crypto";
import {
  auditEvents,
  type Database,
  financeConversationMessages,
  financeReviewBatchApprovals,
} from "@personal-os/database";
import {
  approveFinanceReviewBatchInputSchema,
  type FinanceReviewBatchRun,
  financeReviewBatchContinuationSchema,
} from "@personal-os/domain";
import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { auditValues } from "../audit.js";
import { AppError } from "../errors.js";
import { enqueueNativePushEvent } from "../native-push-service.js";
import type { Principal } from "../types.js";
import { nextFinanceConversationSequence } from "./conversation-persistence.js";
import { guardFinanceExecutionTransaction } from "./execution-owner-guard.js";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Context = { principal: Principal; requestId: string; signal?: AbortSignal };
type Approval = typeof financeReviewBatchApprovals.$inferSelect;
const permits = new WeakMap<Context, { approvalId: string; claimId: string }>();
/** Only the worker's in-memory context carries a permit; HTTP inputs cannot construct one. */
export async function assertFinanceBatchContinuation(
  tx: Transaction,
  context: Context,
  batchId: string,
  fingerprint: string,
  at: Date,
) {
  const permit = permits.get(context);
  if (!permit) return;
  const [row] = await tx
    .select()
    .from(financeReviewBatchApprovals)
    .where(
      and(
        eq(financeReviewBatchApprovals.id, permit.approvalId),
        eq(financeReviewBatchApprovals.userId, context.principal.userId),
      ),
    )
    .for("update");
  if (
    !row ||
    row.batchId !== batchId ||
    row.fingerprint !== fingerprint ||
    row.approvedBy !== context.principal.actorId ||
    row.state !== "running" ||
    row.claimId !== permit.claimId ||
    row.expiresAt <= at ||
    !row.leaseUntil ||
    row.leaseUntil <= at
  )
    throw new AppError(
      "conflict",
      "This batch continuation was cancelled, expired or replaced. Read its current state.",
    );
}
const present = (row: Approval) =>
  financeReviewBatchContinuationSchema.parse({
    id: row.id,
    batchId: row.batchId,
    fingerprint: row.fingerprint,
    state: row.state,
    approvedAt: row.approvedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    attempts: row.attempts,
    failureCode: row.failureCode,
    recovery: ["expired", "blocked", "cancelled"].includes(row.state) ? "new_preview" : "none",
  });
export function createFinanceBatchApprovalService({
  db,
  now,
  authorize,
  find,
  execute,
}: {
  db: Database;
  now: () => Date;
  authorize: (
    tx: Transaction,
    context: Context,
    mode: "read" | "write" | "execute",
  ) => Promise<void>;
  find: (
    tx: Transaction,
    id: string,
    context: Context,
  ) => Promise<{ id: string; fingerprint: string }>;
  execute: (
    id: string,
    input: { fingerprint: string; limit: number },
    context: Context,
  ) => Promise<FinanceReviewBatchRun>;
}) {
  const bounded = <T>(work: (tx: Transaction) => Promise<T>) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`set local transaction_timeout = '10000ms'`);
      await tx.execute(sql`set local statement_timeout = '8000ms'`);
      await tx.execute(sql`set local lock_timeout = '2000ms'`);
      return work(tx);
    });
  function owner(context: Context) {
    if (
      context.principal.actorType !== "user" ||
      context.principal.actorId !== context.principal.userId ||
      !context.principal.scopes.has("finances:write")
    )
      throw new AppError("forbidden", "Only the owner can approve or cancel this exact batch.");
  }
  const ownedApproval = (tx: Transaction, batchId: string, userId: string) =>
    tx
      .select()
      .from(financeReviewBatchApprovals)
      .where(
        and(
          eq(financeReviewBatchApprovals.batchId, batchId),
          eq(financeReviewBatchApprovals.userId, userId),
        ),
      )
      .for("update");
  return {
    async approveForContinuation(batchId: string, raw: unknown, context: Context) {
      owner(context);
      const input = approveFinanceReviewBatchInputSchema.parse(raw);
      return bounded(async (tx) => {
        await authorize(tx, context, "write");
        const batch = await find(tx, batchId, context);
        if (batch.fingerprint !== input.fingerprint)
          throw new AppError("conflict", "Approve the exact displayed batch fingerprint.");
        const [existing] = await ownedApproval(tx, batchId, context.principal.userId);
        if (existing) return present(existing);
        const at = now();
        const [row] = await tx
          .insert(financeReviewBatchApprovals)
          .values({
            userId: context.principal.userId,
            batchId,
            fingerprint: input.fingerprint,
            approvedBy: context.principal.actorId,
            approvedAt: at,
            expiresAt: new Date(at.getTime() + 86400000),
            nextAttemptAt: at,
            updatedAt: at,
          })
          .returning();
        if (!row) throw new AppError("internal_error", "The exact batch approval was not saved.");
        await tx.insert(auditEvents).values(
          auditValues({
            ...context,
            action: "finance_review_batch.approved",
            entityType: "finance_review_batch",
            entityId: batchId,
            before: null,
            after: {
              approvalId: row.id,
              fingerprint: row.fingerprint,
              expiresAt: row.expiresAt.toISOString(),
            },
          }),
        );
        return present(row);
      });
    },
    async getContinuation(batchId: string, context: Context) {
      return bounded(async (tx) => {
        await authorize(tx, context, "read");
        await find(tx, batchId, context);
        const [row] = await ownedApproval(tx, batchId, context.principal.userId);
        return row ? present(row) : null;
      });
    },
    async cancelContinuation(batchId: string, context: Context) {
      owner(context);
      return bounded(async (tx) => {
        await authorize(tx, context, "write");
        await find(tx, batchId, context);
        const [row] = await ownedApproval(tx, batchId, context.principal.userId);
        if (!row) throw new AppError("not_found", "No batch approval was found.");
        if (
          !["pending", "running", "blocked", "expired", "completed_with_exceptions"].includes(
            row.state,
          )
        )
          return present(row);
        const [cancelled] = await tx
          .update(financeReviewBatchApprovals)
          .set({ state: "cancelled", claimId: null, leaseUntil: null, updatedAt: now() })
          .where(eq(financeReviewBatchApprovals.id, row.id))
          .returning();
        if (!cancelled) throw new AppError("conflict", "Batch approval changed.");
        await tx.insert(auditEvents).values(
          auditValues({
            ...context,
            action: "finance_review_batch.cancelled",
            entityType: "finance_review_batch",
            entityId: batchId,
            before: present(row),
            after: present(cancelled),
          }),
        );
        return present(cancelled);
      });
    },
    async processApproved() {
      const claim = await bounded(async (tx) => {
        const at = now();
        const [row] = await tx
          .select()
          .from(financeReviewBatchApprovals)
          .where(
            and(
              inArray(financeReviewBatchApprovals.state, ["pending", "running"]),
              lte(financeReviewBatchApprovals.nextAttemptAt, at),
              or(
                isNull(financeReviewBatchApprovals.leaseUntil),
                lte(financeReviewBatchApprovals.leaseUntil, at),
              ),
            ),
          )
          .orderBy(
            asc(financeReviewBatchApprovals.nextAttemptAt),
            asc(financeReviewBatchApprovals.id),
          )
          .limit(1)
          .for("update", { skipLocked: true });
        if (!row) return null;
        const [claimed] = await tx
          .update(financeReviewBatchApprovals)
          .set({
            state: "running",
            claimId: randomUUID(),
            leaseUntil: new Date(at.getTime() + 120000),
            attempts: row.attempts + 1,
            updatedAt: at,
          })
          .where(eq(financeReviewBatchApprovals.id, row.id))
          .returning();
        return claimed ?? null;
      });
      if (!claim?.claimId) return { inspected: 0 };
      // This is the persisted owner's exact one-batch instruction, not an agent grant.
      const context: Context = {
        principal: {
          userId: claim.userId,
          actorId: claim.approvedBy,
          actorType: "user",
          scopes: new Set(["finances:read", "finances:write"]),
        },
        requestId: `batch-approval:${claim.id}:${claim.claimId}`,
      };
      permits.set(context, { approvalId: claim.id, claimId: claim.claimId });
      let result: FinanceReviewBatchRun | undefined;
      let failureCode: string | null = null;
      try {
        result = await execute(
          claim.batchId,
          { fingerprint: claim.fingerprint, limit: 10 },
          context,
        );
      } catch (error) {
        failureCode = error instanceof AppError ? error.code : "execution_failed";
      } finally {
        permits.delete(context);
      }
      await bounded(async (tx) => {
        await guardFinanceExecutionTransaction(tx, claim.userId, {});
        const [current] = await ownedApproval(tx, claim.batchId, claim.userId);
        if (!current || current.claimId !== claim.claimId || current.state !== "running") return;
        const failures = result ? 0 : current.failures + 1;
        const state =
          result && !result.pendingCount
            ? result.status === "completed"
              ? "completed"
              : "completed_with_exceptions"
            : current.expiresAt <= now()
              ? "expired"
              : !result && failures >= 3
                ? "blocked"
                : "pending";
        await tx
          .update(financeReviewBatchApprovals)
          .set({
            state,
            failures,
            failureCode,
            claimId: null,
            leaseUntil: null,
            nextAttemptAt: new Date(now().getTime() + (result ? 0 : 60000)),
            updatedAt: now(),
          })
          .where(eq(financeReviewBatchApprovals.id, claim.id));
        if (state === "pending") return;
        const applied = result?.outcomes.filter((item) => item.status === "applied").length ?? 0;
        const other = (result?.outcomes.length ?? 0) - applied;
        const text =
          state === "expired"
            ? "This batch approval expired. Review its saved progress before preparing a new batch."
            : state === "blocked"
              ? "This batch paused after repeated execution failures. Review its saved progress before trying again."
              : other
                ? `Batch finished: ${applied} changes applied; ${other} need another look.`
                : `Batch finished: ${applied} changes applied.`;
        const key = `approved-batch-result:${claim.id}`;
        const [message] = await tx
          .insert(financeConversationMessages)
          .values({
            userId: claim.userId,
            sequence: await nextFinanceConversationSequence(tx, claim.userId),
            authorKind: "agent",
            text,
            recordRefs: [{ kind: "review_batch", id: claim.batchId }],
            sourceMessageIds: [],
            idempotencyKey: key,
            createdAt: now(),
          })
          .onConflictDoNothing()
          .returning();
        if (message)
          await enqueueNativePushEvent(tx, {
            userId: claim.userId,
            sourceId: message.id,
            kind: "reply",
            sourceRevision: "1",
            createdAt: message.createdAt,
          });
        await tx.insert(auditEvents).values(
          auditValues({
            ...context,
            action:
              state === "blocked" || state === "expired"
                ? "finance_review_batch.continuation_stopped"
                : "finance_review_batch.continuation_completed",
            entityType: "finance_review_batch",
            entityId: claim.batchId,
            before: null,
            after: {
              approvalId: claim.id,
              applied,
              remaining: other,
              source: "persisted_owner_approval",
              state,
              failureCode,
              messageId: message?.id ?? null,
            },
          }),
        );
      });
      return { inspected: 1 };
    },
  };
}
