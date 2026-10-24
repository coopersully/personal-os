import { createHash } from "node:crypto";
import {
  accessTokens,
  type Database,
  financeCategories,
  financeReviewBatchRuns,
  financeReviewCases,
  financeTransactions,
} from "@personal-os/database";
import {
  executeFinanceReviewBatchInputSchema,
  type FinanceReviewBatchDecision,
  type FinanceReviewBatchOutcome,
  type FinanceReviewBatchRun,
  financeReviewBatchDecisionSchema,
  financeReviewBatchOutcomeSchema,
  idSchema,
  listFinanceReviewBatchesInputSchema,
  previewFinanceReviewBatchInputSchema,
} from "@personal-os/domain";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { AppError } from "../errors.js";
import { lockReimbursementTopology } from "../finance-reimbursement-locks.js";
import type { createFinanceService } from "../finance-service.js";
import type { Principal } from "../types.js";
import { requireWorkspaceExecution } from "../workspace-execution.js";
import { guardFinanceExecutionTransaction } from "./execution-owner-guard.js";

type Context = { principal: Principal; requestId: string };
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Row = typeof financeReviewBatchRuns.$inferSelect;
type Finance = Pick<
  ReturnType<typeof createFinanceService>,
  "resolveReview" | "applyCategorizations"
>;

function manifest(row: Row) {
  return row.manifest.map((item) => financeReviewBatchDecisionSchema.parse(item));
}
function outcomes(row: Row) {
  return row.outcomes.map((item) => financeReviewBatchOutcomeSchema.parse(item));
}
function present(row: Row): FinanceReviewBatchRun {
  const decisions = manifest(row);
  const receipts = outcomes(row);
  const pendingCount = decisions.length - receipts.length;
  return {
    id: row.id,
    fingerprint: row.fingerprint,
    idempotencyKey: row.idempotencyKey,
    decisions,
    outcomes: receipts,
    pendingCount,
    status:
      pendingCount === 0
        ? receipts.some((item) => item.status !== "applied")
          ? "completed_with_exceptions"
          : "completed"
        : receipts.length
          ? "in_progress"
          : "previewed",
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
function binding(principal: Principal) {
  if (principal.actorType === "user") return eq(financeReviewBatchRuns.userId, principal.userId);
  return and(
    eq(financeReviewBatchRuns.userId, principal.userId),
    eq(financeReviewBatchRuns.actorType, principal.actorType),
    eq(financeReviewBatchRuns.actorId, principal.actorId),
    principal.authorizationConnectionId
      ? eq(financeReviewBatchRuns.authorizationConnectionId, principal.authorizationConnectionId)
      : isNull(financeReviewBatchRuns.authorizationConnectionId),
  );
}

/** Caller-driven bounded work: no promise, lease or worker survives the HTTP request.
 * One item owns one transaction; writer + audit + outcome either all commit or all roll back.
 * Business conflicts are terminal and require a fresh preview. Unexpected errors remain pending.
 */
export function createFinanceReviewBatchService({
  db,
  now,
  finance,
}: {
  db: Database;
  now: () => Date;
  finance: Finance;
}) {
  async function authorize(tx: Transaction, context: Context, mode: "read" | "write" | "execute") {
    const principal = context.principal;
    await guardFinanceExecutionTransaction(tx, principal.userId, {
      actorIds: principal.actorType === "agent" ? [principal.actorId] : [],
      connectionIds: principal.authorizationConnectionId
        ? [principal.authorizationConnectionId]
        : [],
    });
    if (
      !principal.scopes.has("finances:read") ||
      (mode !== "read" && !principal.scopes.has("finances:write"))
    )
      throw new AppError(
        "forbidden",
        "Finance batch access requires the corresponding read and write scopes.",
      );
    if (principal.actorType === "agent") {
      const [grant] = await tx
        .select()
        .from(accessTokens)
        .where(eq(accessTokens.id, principal.actorId))
        .limit(1);
      if (
        !grant ||
        grant.userId !== principal.userId ||
        grant.revokedAt ||
        (grant.expiresAt && grant.expiresAt <= now()) ||
        grant.authorizationConnectionId !== principal.authorizationConnectionId ||
        !grant.scopes.includes("finances:read") ||
        (mode !== "read" && !grant.scopes.includes("finances:write"))
      )
        throw new AppError("forbidden", "The original Finance grant is no longer active.");
    }
    if (mode === "execute") await requireWorkspaceExecution(tx, principal, "finances", now());
  }
  async function find(tx: Transaction, id: string, context: Context) {
    idSchema.parse(id);
    const [row] = await tx
      .select()
      .from(financeReviewBatchRuns)
      .where(and(eq(financeReviewBatchRuns.id, id), binding(context.principal)))
      .for("update")
      .limit(1);
    if (!row)
      throw new AppError(
        "not_found",
        "The Finance review batch was not found for this authorization.",
      );
    return row;
  }
  async function validate(
    tx: Transaction,
    decision: FinanceReviewBatchDecision,
    userId: string,
    lock: boolean,
  ) {
    // Match the existing categorization writer's topology -> transaction -> review lock order.
    if (lock) await lockReimbursementTopology(tx, userId);
    const query = tx
      .select()
      .from(financeTransactions)
      .where(
        and(
          eq(financeTransactions.id, decision.transactionId),
          eq(financeTransactions.userId, userId),
        ),
      );
    const [transaction] = await (lock ? query.for("update") : query).limit(1);
    if (!transaction) throw new AppError("not_found", "The Finance transaction was not found.");
    if (
      transaction.updatedAt.toISOString() !== decision.expectedTransactionUpdatedAt ||
      transaction.contextualRevision.toString() !== decision.expectedTransactionRevision
    )
      throw new AppError("conflict", "The transaction changed; prepare a new preview.");
    if (decision.categoryId) {
      const [category] = await tx
        .select({ id: financeCategories.id })
        .from(financeCategories)
        .where(
          and(eq(financeCategories.id, decision.categoryId), eq(financeCategories.userId, userId)),
        )
        .limit(1);
      if (!category) throw new AppError("not_found", "The Finance category was not found.");
    }
    if (decision.kind === "review") {
      const query = tx
        .select()
        .from(financeReviewCases)
        .where(
          and(
            eq(financeReviewCases.id, decision.reviewId),
            eq(financeReviewCases.userId, userId),
            eq(financeReviewCases.transactionId, decision.transactionId),
          ),
        );
      const [review] = await (lock ? query.for("update") : query).limit(1);
      if (!review) throw new AppError("not_found", "The Finance review was not found.");
      if (
        review.updatedAt.toISOString() !== decision.expectedReviewUpdatedAt ||
        review.contextualRevision.toString() !== decision.expectedReviewRevision ||
        review.actionRevision.toString() !== decision.expectedActionRevision ||
        review.status === "resolved"
      )
        throw new AppError("conflict", "The review changed; prepare a new preview.");
      if (
        (decision.action === "confirm_transfer" && review.reason !== "possible_transfer") ||
        (decision.action === "approve" && review.reason === "possible_transfer")
      )
        throw new AppError(
          "invalid_request",
          "Use an explicit transfer review decision supported by evidence.",
        );
    } else {
      const [transferReview] = await tx
        .select({ id: financeReviewCases.id })
        .from(financeReviewCases)
        .where(
          and(
            eq(financeReviewCases.userId, userId),
            eq(financeReviewCases.transactionId, transaction.id),
            eq(financeReviewCases.reason, "possible_transfer"),
            inArray(financeReviewCases.status, ["open", "deferred"]),
          ),
        )
        .limit(1);
      if (
        transferReview ||
        transaction.direction === "transfer" ||
        transaction.reconciliationStatus === "candidate"
      )
        throw new AppError(
          "invalid_request",
          "Transfer candidates require an explicit review decision and evidence.",
        );
    }
  }
  return {
    async preview(raw: unknown, context: Context): Promise<FinanceReviewBatchRun> {
      const input = previewFinanceReviewBatchInputSchema.parse(raw);
      const fingerprint = `sha256:${createHash("sha256").update(JSON.stringify(input.decisions)).digest("hex")}`;
      return db.transaction(async (tx) => {
        await authorize(tx, context, "write");
        const [existing] = await tx
          .select()
          .from(financeReviewBatchRuns)
          .where(
            and(
              eq(financeReviewBatchRuns.userId, context.principal.userId),
              eq(financeReviewBatchRuns.idempotencyKey, input.idempotencyKey),
            ),
          )
          .limit(1);
        if (existing) {
          const row = await find(tx, existing.id, context);
          if (row.fingerprint !== fingerprint)
            throw new AppError(
              "conflict",
              "That idempotency key already identifies a different manifest.",
            );
          return present(row);
        }
        for (const decision of input.decisions)
          await validate(tx, decision, context.principal.userId, false);
        const [row] = await tx
          .insert(financeReviewBatchRuns)
          .values({
            userId: context.principal.userId,
            actorId: context.principal.actorId,
            actorType: context.principal.actorType,
            authorizationConnectionId: context.principal.authorizationConnectionId ?? null,
            idempotencyKey: input.idempotencyKey,
            fingerprint,
            manifest: input.decisions,
            createdAt: now(),
            updatedAt: now(),
          })
          .returning();
        if (!row) throw new AppError("internal_error", "The Finance batch could not be saved.");
        return present(row);
      });
    },
    async get(id: string, context: Context): Promise<FinanceReviewBatchRun> {
      return db.transaction(async (tx) => {
        await authorize(tx, context, "read");
        return present(await find(tx, id, context));
      });
    },
    async list(context: Context, raw: unknown = {}): Promise<FinanceReviewBatchRun[]> {
      const { limit } = listFinanceReviewBatchesInputSchema.parse(raw);
      return db.transaction(async (tx) => {
        await authorize(tx, context, "read");
        const rows = await tx
          .select()
          .from(financeReviewBatchRuns)
          .where(binding(context.principal))
          .orderBy(desc(financeReviewBatchRuns.createdAt), desc(financeReviewBatchRuns.id))
          .limit(limit);
        return rows.map(present);
      });
    },
    async execute(id: string, raw: unknown, context: Context): Promise<FinanceReviewBatchRun> {
      const input = executeFinanceReviewBatchInputSchema.parse(raw);
      for (let count = 0; count < input.limit; count++) {
        const progressed = await db.transaction(async (tx) => {
          // Bound contention and individual database statements; interrupted work stays pending.
          await tx.execute(sql`SET LOCAL lock_timeout = '3s'`);
          await tx.execute(sql`SET LOCAL statement_timeout = '10s'`);
          await authorize(tx, context, "execute");
          const row = await find(tx, id, context);
          if (row.fingerprint !== input.fingerprint)
            throw new AppError("conflict", "Execution must accept the exact preview fingerprint.");
          const decisions = manifest(row);
          const receipts = outcomes(row);
          const completed = new Set(receipts.map((item) => item.index));
          const index = decisions.findIndex((_, index) => !completed.has(index));
          const decision = decisions[index];
          if (!decision) return false;
          let outcome: FinanceReviewBatchOutcome;
          try {
            // A savepoint rolls back all writer effects before a business failure receipt commits.
            outcome = await tx.transaction(async (itemTx) => {
              await validate(itemTx, decision, context.principal.userId, true);
              // Deliberately reconstruct context: internal prepared-action/maintenance capabilities
              // must never be inherited from a batch caller or persisted preview.
              const writerContext = {
                principal: context.principal,
                requestId: context.requestId,
                financeReviewBatchScope: {
                  transactionId: decision.transactionId,
                  reviewId: decision.kind === "review" ? decision.reviewId : null,
                },
              };
              let status: FinanceReviewBatchOutcome["status"];
              if (decision.kind === "review") {
                const result = await finance.resolveReview(
                  decision.reviewId,
                  decision,
                  writerContext,
                  itemTx,
                );
                status =
                  "deferred" in result
                    ? "deferred"
                    : result.applied
                      ? "applied"
                      : "review_required";
              } else {
                const [result] = await finance.applyCategorizations(
                  { decisions: [decision] },
                  writerContext,
                  itemTx,
                );
                if (!result)
                  throw new AppError("internal_error", "The categorization outcome is missing.");
                status = result.applied ? "applied" : "review_required";
              }
              return {
                index,
                transactionId: decision.transactionId,
                status,
                error: null,
                recovery: status === "applied" ? ("none" as const) : ("new_preview" as const),
                completedAt: now().toISOString(),
              };
            });
          } catch (error) {
            if (
              !(error instanceof AppError) ||
              !["conflict", "invalid_request", "not_found"].includes(error.code)
            )
              throw error;
            outcome = {
              index,
              transactionId: decision.transactionId,
              status: "failed",
              error: { code: error.code, message: error.message },
              recovery: "new_preview",
              completedAt: now().toISOString(),
            };
          }
          await tx
            .update(financeReviewBatchRuns)
            .set({ outcomes: [...receipts, outcome], updatedAt: now() })
            .where(eq(financeReviewBatchRuns.id, row.id));
          return true;
        });
        if (!progressed) break;
      }
      return this.get(id, context);
    },
  };
}
