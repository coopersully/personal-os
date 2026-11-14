import { randomUUID } from "node:crypto";
import {
  auditEvents,
  type Database,
  financeConversationMessages,
  financeReviewBatchApprovals,
  financeReviewBatchRuns,
} from "@personal-os/database";
import {
  approveFinanceReviewBatchInputSchema,
  type FinanceReviewBatchRun,
  financeReviewBatchContinuationSchema,
  financeReviewBatchCounterpartSchema,
  financeReviewBatchDecisionSchema,
  financeReviewBatchOutcomeSchema,
  financeReviewBatchTransactionSummarySchema,
} from "@personal-os/domain";
import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { auditValues } from "../audit.js";
import { AppError } from "../errors.js";
import { enqueueNativePushEvent } from "../native-push-service.js";
import type { Principal } from "../types.js";
import { nextFinanceConversationSequence } from "./conversation-persistence.js";
import {
  assertFinanceDecisionNotDeclined,
  recordFinanceDecisionDecline,
  requireFinanceDeclineOwner,
} from "./decision-decline.js";
import { guardFinanceExecutionTransaction } from "./execution-owner-guard.js";
import {
  type FinanceTransactionLimits,
  financeBatchTransactionLimits,
  runBoundedFinanceTransaction,
} from "./transaction-limits.js";

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
/** A worker permit plus an immutable owner attestation binds each confirmed pair. */
export async function hasFinanceBatchTransferAttestation(
  tx: Transaction,
  context: Context,
  batchId: string,
  fingerprint: string,
  index: number,
) {
  const permit = permits.get(context);
  if (!permit) return false;
  const [event] = await tx
    .select({ after: auditEvents.after })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.userId, context.principal.userId),
        eq(auditEvents.actorType, "user"),
        eq(auditEvents.actorId, context.principal.userId),
        eq(auditEvents.action, "finance_review_batch.approved"),
        eq(auditEvents.entityId, batchId),
        sql`${auditEvents.after}->>'approvalId' = ${permit.approvalId}`,
        sql`${auditEvents.after}->>'fingerprint' = ${fingerprint}`,
      ),
    )
    .limit(1);
  const indexes = event?.after?.confirmedTransferPairIndexes;
  return Array.isArray(indexes) && indexes.includes(index);
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
  limits = financeBatchTransactionLimits,
}: {
  db: Database;
  now: () => Date;
  limits?: FinanceTransactionLimits;
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
    runBoundedFinanceTransaction(db, limits, work);
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
        await assertFinanceDecisionNotDeclined(
          tx,
          context.principal.userId,
          "review_batch",
          batchId,
        );
        if (batch.fingerprint !== input.fingerprint)
          throw new AppError("conflict", "Approve the exact displayed batch fingerprint.");
        const [savedBatch] = await tx
          .select()
          .from(financeReviewBatchRuns)
          .where(
            and(
              eq(financeReviewBatchRuns.id, batchId),
              eq(financeReviewBatchRuns.userId, context.principal.userId),
            ),
          )
          .limit(1);
        const confirmedTransferPairIndexes = savedBatch?.manifest.flatMap((item, index) => {
          const value =
            typeof item === "object" && item !== null && "decision" in item ? item.decision : item;
          if (financeReviewBatchDecisionSchema.parse(value).kind !== "transfer_pair") return [];
          const details = item as { transactionSummary?: unknown; transferCounterpart?: unknown };
          const counterpart = financeReviewBatchCounterpartSchema.safeParse(
            details.transferCounterpart,
          );
          if (
            !financeReviewBatchTransactionSummarySchema.safeParse(details.transactionSummary)
              .success ||
            !counterpart.success ||
            !counterpart.data.summary
          )
            throw new AppError(
              "conflict",
              "Prepare a fresh preview showing both transfer transactions before confirming.",
            );
          return [index];
        });
        if (confirmedTransferPairIndexes?.length && input.confirmTransferPairs !== true)
          throw new AppError(
            "invalid_request",
            "Confirm that each displayed pair is the same movement between your own accounts.",
          );
        // One approval exists per batch. A repeat of the same exact approval returns it
        // unchanged; the same batch under another fingerprint is a different instruction.
        const replay = (saved: Approval) => {
          if (saved.fingerprint !== input.fingerprint)
            throw new AppError(
              "conflict",
              "This batch already has an approval for a different fingerprint. Read its current state.",
            );
          // A stopped approval never restarts; saying "approved" again would change nothing.
          if (["cancelled", "expired", "blocked"].includes(saved.state))
            throw new AppError(
              "conflict",
              `This batch approval is ${saved.state} and cannot be approved again. Prepare a new preview.`,
              { recovery: "new_preview" },
            );
          return present(saved);
        };
        const [existing] = await ownedApproval(tx, batchId, context.principal.userId);
        if (existing) return replay(existing);
        const at = now();
        // The unique index, not a caller's row lock, decides a race between duplicates:
        // the loser waits for the winner's commit and then reads its approval.
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
          .onConflictDoNothing({
            target: [financeReviewBatchApprovals.userId, financeReviewBatchApprovals.batchId],
          })
          .returning();
        if (!row) {
          const [winner] = await ownedApproval(tx, batchId, context.principal.userId);
          if (!winner)
            throw new AppError("conflict", "This batch approval changed. Read its current state.");
          return replay(winner);
        }
        await tx.insert(auditEvents).values(
          auditValues({
            ...context,
            action: "finance_review_batch.approved",
            entityType: "finance_review_batch",
            entityId: batchId,
            before: null,
            after: {
              confirmedTransferPairIndexes,
              approvalId: row.id,
              fingerprint: row.fingerprint,
              expiresAt: row.expiresAt.toISOString(),
            },
          }),
        );
        return present(row);
      });
    },
    /** The owner's "no" to a published batch that has no approval yet. */
    async declineBatch(batchId: string, context: Context) {
      requireFinanceDeclineOwner(context);
      return bounded(async (tx) => {
        await authorize(tx, context, "write");
        await find(tx, batchId, context);
        const [approval] = await ownedApproval(tx, batchId, context.principal.userId);
        if (approval)
          throw new AppError(
            "conflict",
            "This batch was already approved. Cancel its approval instead (cancelContinuation: POST /v1/finances/review-batches/{id}/approval/cancel).",
          );
        return recordFinanceDecisionDecline(tx, context, "review_batch", batchId, now());
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
      try {
        await bounded(async (tx) => {
          await guardFinanceExecutionTransaction(tx, claim.userId, {});
          const [current] = await ownedApproval(tx, claim.batchId, claim.userId);
          if (!current || current.claimId !== claim.claimId || current.state !== "running") return;
          // Execution may have committed before a crash or lost response. Its durable
          // receipts, not this attempt's return value or expiry, describe completed effects.
          const [saved] = await tx
            .select()
            .from(financeReviewBatchRuns)
            .where(
              and(
                eq(financeReviewBatchRuns.id, claim.batchId),
                eq(financeReviewBatchRuns.userId, claim.userId),
              ),
            )
            .for("update");
          if (!saved || saved.fingerprint !== claim.fingerprint)
            throw new AppError("conflict", "The approved batch receipt is unavailable.");
          const receipts = saved.outcomes.map((item) =>
            financeReviewBatchOutcomeSchema.parse(item),
          );
          const pending = saved.manifest.length - receipts.length;
          const applied = receipts.filter((item) => item.status === "applied").length;
          const other = receipts.length - applied;
          const failures = result ? 0 : current.failures + 1;
          const state =
            pending === 0
              ? other
                ? "completed_with_exceptions"
                : "completed"
              : current.expiresAt <= now()
                ? "expired"
                : !result && (failureCode === "forbidden" || failures >= 3)
                  ? "blocked"
                  : "pending";
          if (!pending) failureCode = null;
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
          const text =
            state === "expired"
              ? "This batch approval expired. Review its saved progress before preparing a new batch."
              : state === "blocked"
                ? failureCode === "forbidden"
                  ? "This batch no longer has the required approval or access. Review saved progress and prepare a fresh batch."
                  : "This batch paused after repeated execution failures. Review its saved progress before trying again."
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
                remaining: pending + other,
                source: "persisted_owner_approval",
                state,
                failureCode,
                messageId: message?.id ?? null,
              },
            }),
          );
        });
      } catch (error) {
        // Reconciliation itself failed. Without this the claim would stay `running`, be
        // re-claimed when its lease lapses and never count toward the retry bound.
        const reconciliationCode =
          error instanceof AppError ? `reconciliation_${error.code}` : "reconciliation_failed";
        await bounded(async (tx) => {
          const [current] = await tx
            .select()
            .from(financeReviewBatchApprovals)
            .where(eq(financeReviewBatchApprovals.id, claim.id))
            .for("update");
          if (!current || current.claimId !== claim.claimId || current.state !== "running") return;
          const failures = current.failures + 1;
          await tx
            .update(financeReviewBatchApprovals)
            .set({
              state: failures >= 3 ? "blocked" : "pending",
              failures,
              failureCode: reconciliationCode,
              claimId: null,
              leaseUntil: null,
              nextAttemptAt: new Date(now().getTime() + 60000),
              updatedAt: now(),
            })
            .where(eq(financeReviewBatchApprovals.id, claim.id));
        });
        throw error;
      }
      return { inspected: 1 };
    },
  };
}
