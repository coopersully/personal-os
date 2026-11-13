import { createHash } from "node:crypto";
import {
  type Database,
  financeReviewBatchCorrections,
  financeReviewBatchEffects,
  type financeReviewBatchRuns,
} from "@personal-os/database";
import {
  executeFinanceReviewBatchInputSchema,
  type FinanceReviewBatchOutcome,
  type FinanceReviewBatchUndo,
  financeReviewBatchCorrectionEffectSchema,
  financeReviewBatchOutcomeSchema,
  financeReviewBatchUndoSchema,
  previewFinanceReviewBatchUndoInputSchema,
} from "@personal-os/domain";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { AppError } from "../errors.js";
import type { createFinanceService } from "../finance-service.js";
import type { Principal } from "../types.js";
import { captureFinanceBatchEffect, parseFinanceBatchEffect } from "./batch-effect-state.js";
import type { FinanceTransaction } from "./context.js";
import {
  assertFinanceDecisionNotDeclined,
  recordFinanceDecisionDecline,
  requireFinanceDeclineOwner,
} from "./decision-decline.js";
import {
  type FinanceTransactionLimits,
  financeBatchTransactionLimits,
  runBoundedFinanceTransaction,
} from "./transaction-limits.js";

type Context = { principal: Principal; requestId: string; signal?: AbortSignal };
type Row = typeof financeReviewBatchCorrections.$inferSelect;
const present = (row: Row, effects: FinanceReviewBatchUndo["effects"]) => {
  const outcomes = row.outcomes.map((item) => financeReviewBatchOutcomeSchema.parse(item));
  const pendingCount = row.outcomeIndexes.length - outcomes.length;
  return financeReviewBatchUndoSchema.parse({
    effects,
    id: row.id,
    batchId: row.batchId,
    fingerprint: row.fingerprint,
    outcomeIndexes: row.outcomeIndexes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    outcomes,
    pendingCount,
    status: pendingCount
      ? outcomes.length
        ? "in_progress"
        : "previewed"
      : outcomes.every((item) => item.status === "applied")
        ? "completed"
        : "completed_with_exceptions",
  });
};
export function createFinanceBatchCorrectionService({
  db,
  now,
  authorize,
  findBatch,
  restore,
  limits = financeBatchTransactionLimits,
}: {
  db: Database;
  now: () => Date;
  limits?: FinanceTransactionLimits;
  authorize: (
    tx: FinanceTransaction,
    context: Context,
    mode: "read" | "write" | "execute",
  ) => Promise<void>;
  findBatch: (
    tx: FinanceTransaction,
    id: string,
    context: Context,
  ) => Promise<typeof financeReviewBatchRuns.$inferSelect>;
  restore: ReturnType<typeof createFinanceService>["restoreReviewBatchEffect"];
}) {
  async function presentWithEffects(tx: Pick<Database, "select">, row: Row) {
    const receipts = await tx
      .select()
      .from(financeReviewBatchEffects)
      .where(
        and(
          eq(financeReviewBatchEffects.userId, row.userId),
          eq(financeReviewBatchEffects.batchId, row.batchId),
          inArray(financeReviewBatchEffects.outcomeIndex, row.outcomeIndexes),
        ),
      )
      .orderBy(financeReviewBatchEffects.outcomeIndex);
    const effects = receipts.flatMap((receipt) => {
      const before = parseFinanceBatchEffect(receipt.before);
      const after = parseFinanceBatchEffect(receipt.after);
      if (!before.display) return [];
      return [
        {
          index: receipt.outcomeIndex,
          transactions: before.display.transactions.map((display) => ({
            ...display,
            before: before.transactions.find((item) => item.id === display.id),
            after: after.transactions.find((item) => item.id === display.id),
          })),
          restoredAllocations: before.allocations.map((allocation) => ({
            transactionId: allocation.transactionId,
            categoryId: allocation.categoryId,
            category:
              before.display?.categories.find((item) => item.id === allocation.categoryId)?.name ??
              null,
            amountCents: allocation.amount,
            treatment: allocation.treatment,
          })),
          reopenedReviews: before.display.reviews.filter(
            (review) =>
              before.reviews.some((item) => item.id === review.id && item.status !== "resolved") &&
              after.reviews.some((item) => item.id === review.id && item.status === "resolved"),
          ),
        },
      ];
    });
    return present(
      row,
      effects.map((effect) => financeReviewBatchCorrectionEffectSchema.parse(effect)),
    );
  }
  async function find(tx: FinanceTransaction, id: string, context: Context) {
    const p = context.principal;
    const [row] = await tx
      .select()
      .from(financeReviewBatchCorrections)
      .where(
        and(
          eq(financeReviewBatchCorrections.id, id),
          eq(financeReviewBatchCorrections.userId, p.userId),
          p.actorType === "agent"
            ? and(
                eq(financeReviewBatchCorrections.actorId, p.actorId),
                eq(financeReviewBatchCorrections.actorType, p.actorType),
                p.authorizationConnectionId
                  ? eq(
                      financeReviewBatchCorrections.authorizationConnectionId,
                      p.authorizationConnectionId,
                    )
                  : isNull(financeReviewBatchCorrections.authorizationConnectionId),
              )
            : undefined,
        ),
      )
      .for("update")
      .limit(1);
    if (!row)
      throw new AppError("not_found", "The correction was not found for this authorization.");
    return row;
  }
  /**
   * Undo keeps the approval boundary of the effect it reverses. An agent may prepare any
   * correction it can see, but applies one only when its own authority applied every
   * targeted effect. Effects the owner applied or approved need the owner again.
   */
  async function assertUndoAuthority(tx: FinanceTransaction, row: Row, context: Context) {
    const { principal } = context;
    if (principal.actorType !== "agent") return;
    const effects = await tx
      .select({
        actorType: financeReviewBatchEffects.appliedByActorType,
        actorId: financeReviewBatchEffects.appliedByActorId,
      })
      .from(financeReviewBatchEffects)
      .where(
        and(
          eq(financeReviewBatchEffects.userId, row.userId),
          eq(financeReviewBatchEffects.batchId, row.batchId),
          inArray(financeReviewBatchEffects.outcomeIndex, row.outcomeIndexes),
        ),
      );
    if (
      effects.length !== row.outcomeIndexes.length ||
      effects.some((effect) => effect.actorType !== "agent" || effect.actorId !== principal.actorId)
    )
      throw new AppError(
        "forbidden",
        "The owner applied or approved these changes, so only the owner can apply this correction. Publish the preview for their approval.",
      );
  }
  return {
    /** The owner's "no" to a correction preview; effects already corrected remain. */
    async declineUndo(id: string, context: Context) {
      requireFinanceDeclineOwner(context);
      return runBoundedFinanceTransaction(db, limits, async (tx) => {
        await authorize(tx, context, "write");
        const row = await find(tx, id, context);
        if (row.outcomes.length === row.outcomeIndexes.length)
          throw new AppError(
            "conflict",
            "This correction already finished. Prepare a new correction to change its result.",
          );
        return recordFinanceDecisionDecline(tx, context, "review_batch_undo", row.id, now());
      });
    },
    async previewUndo(raw: unknown, context: Context) {
      const input = previewFinanceReviewBatchUndoInputSchema.parse(raw);
      return db.transaction(async (tx) => {
        await authorize(tx, context, "write");
        const batch = await findBatch(tx, input.batchId, context);
        const [existing] = await tx
          .select()
          .from(financeReviewBatchCorrections)
          .where(
            and(
              eq(financeReviewBatchCorrections.userId, context.principal.userId),
              eq(financeReviewBatchCorrections.idempotencyKey, input.idempotencyKey),
            ),
          )
          .limit(1);
        if (existing) {
          const owned = await find(tx, existing.id, context);
          if (
            owned.batchId !== input.batchId ||
            JSON.stringify(owned.outcomeIndexes) !== JSON.stringify(input.outcomeIndexes)
          )
            throw new AppError("conflict", "This correction key belongs to different effects.");
          return presentWithEffects(tx, owned);
        }
        const effects = await tx
          .select()
          .from(financeReviewBatchEffects)
          .where(
            and(
              eq(financeReviewBatchEffects.userId, context.principal.userId),
              eq(financeReviewBatchEffects.batchId, batch.id),
              inArray(financeReviewBatchEffects.outcomeIndex, input.outcomeIndexes),
            ),
          )
          .orderBy(financeReviewBatchEffects.outcomeIndex);
        if (effects.length !== input.outcomeIndexes.length)
          throw new AppError(
            "invalid_request",
            "These outcomes do not have reversible effect receipts. Review a new correction.",
          );
        for (const effect of effects) {
          if (!parseFinanceBatchEffect(effect.before).display)
            throw new AppError(
              "conflict",
              "The original receipt lacks an exact display of the changes. Prepare a new correction with nohmi instead of undoing blindly.",
            );
          const after = parseFinanceBatchEffect(effect.after);
          const current = await captureFinanceBatchEffect(
            tx,
            context.principal.userId,
            after.transactions.map((row) => row.id),
          );
          if (after.fingerprint !== current.fingerprint)
            throw new AppError(
              "conflict",
              "This item changed after the batch. Review a new correction instead.",
            );
        }
        const fingerprint = `sha256:${createHash("sha256")
          .update(
            JSON.stringify({
              batch: batch.fingerprint,
              effects: effects.map((row) => ({ id: row.id, after: row.after })),
              indexes: input.outcomeIndexes,
            }),
          )
          .digest("hex")}`;
        const [row] = await tx
          .insert(financeReviewBatchCorrections)
          .values({
            userId: context.principal.userId,
            batchId: batch.id,
            actorId: context.principal.actorId,
            actorType: context.principal.actorType,
            authorizationConnectionId: context.principal.authorizationConnectionId ?? null,
            idempotencyKey: input.idempotencyKey,
            fingerprint,
            outcomeIndexes: input.outcomeIndexes,
            createdAt: now(),
            updatedAt: now(),
          })
          .returning();
        if (!row) throw new AppError("internal_error", "The correction preview was not saved.");
        return presentWithEffects(tx, row);
      });
    },
    async getUndo(id: string, context: Context) {
      return db.transaction(async (tx) => {
        await authorize(tx, context, "read");
        return presentWithEffects(tx, await find(tx, id, context));
      });
    },
    async executeUndo(id: string, raw: unknown, context: Context) {
      const input = executeFinanceReviewBatchInputSchema.parse(raw);
      const deadline = performance.now() + 40000;
      let latest: Row | undefined;
      for (let chunk = 0; chunk < input.limit; chunk++) {
        if (context.signal?.aborted || performance.now() >= deadline) break;
        latest = await runBoundedFinanceTransaction(db, limits, async (tx) => {
          await authorize(tx, context, "execute");
          const row = await find(tx, id, context);
          await findBatch(tx, row.batchId, context);
          await assertFinanceDecisionNotDeclined(tx, row.userId, "review_batch_undo", row.id);
          if (row.fingerprint !== input.fingerprint)
            throw new AppError("conflict", "Accept the exact correction preview.");
          await assertUndoAuthority(tx, row, context);
          const outcomes = row.outcomes.map((item) => financeReviewBatchOutcomeSchema.parse(item));
          const index = row.outcomeIndexes.find(
            (index) => !outcomes.some((outcome) => outcome.index === index),
          );
          if (index === undefined) return row;
          const [effect] = await tx
            .select()
            .from(financeReviewBatchEffects)
            .where(
              and(
                eq(financeReviewBatchEffects.userId, context.principal.userId),
                eq(financeReviewBatchEffects.batchId, row.batchId),
                eq(financeReviewBatchEffects.outcomeIndex, index),
              ),
            )
            .limit(1);
          if (!effect)
            throw new AppError("conflict", "The original effect receipt is unavailable.");
          const before = parseFinanceBatchEffect(effect.before);
          const transactionId = before.transactions[0]?.id;
          if (!transactionId)
            throw new AppError("conflict", "The original effect receipt is incomplete.");
          let outcome: FinanceReviewBatchOutcome;
          try {
            await tx.transaction((itemTx) =>
              restore(
                effect.before,
                effect.after,
                { ...context, financeReviewBatchScope: { transactionId, reviewId: null } },
                itemTx,
              ),
            );
            outcome = {
              index,
              transactionId,
              status: "applied",
              error: null,
              recovery: "none",
              completedAt: now().toISOString(),
            };
          } catch (error) {
            if (
              !(error instanceof AppError) ||
              !["conflict", "invalid_request", "not_found"].includes(error.code)
            )
              throw error;
            outcome = {
              index,
              transactionId,
              status: "failed",
              error: { code: error.code, message: error.message },
              recovery: "new_preview",
              completedAt: now().toISOString(),
            };
          }
          const [updated] = await tx
            .update(financeReviewBatchCorrections)
            .set({ outcomes: [...outcomes, outcome], updatedAt: now() })
            .where(eq(financeReviewBatchCorrections.id, row.id))
            .returning();
          if (!updated)
            throw new AppError("internal_error", "The correction receipt was not saved.");
          return updated;
        });
        if (latest.outcomes.length === latest.outcomeIndexes.length) break;
      }
      if (!latest)
        throw new AppError(
          "service_unavailable",
          "Correction paused. Read its saved progress before resuming.",
        );
      return presentWithEffects(db, latest);
    },
  };
}
