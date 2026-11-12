import { createHash } from "node:crypto";
import * as databaseSchema from "@personal-os/database";
import {
  accessTokens,
  auditEvents,
  type Database,
  executionPolicySettings,
  financeAccounts,
  financeCategories,
  financeProviderItems,
  financeReviewBatchEffects,
  financeReviewBatchRuns,
  financeReviewCases,
  financeTransactions,
} from "@personal-os/database";
import {
  executeFinanceReviewBatchInputSchema,
  type FinanceMaintenanceQualification,
  type FinanceReviewBatchDecision,
  type FinanceReviewBatchOutcome,
  type FinanceReviewBatchRun,
  financeMaintenanceQualificationSchema,
  financeReviewBatchCounterpartSchema,
  financeReviewBatchDecisionSchema,
  financeReviewBatchOutcomeSchema,
  idSchema,
  listFinanceReviewBatchesInputSchema,
  previewFinanceReviewBatchInputSchema,
  qualifyFinanceMaintenanceWorkInputSchema,
} from "@personal-os/domain";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool, PoolClient, QueryConfig, QueryResultRow } from "pg";
import { z } from "zod";
import { AppError } from "../errors.js";
import { lockReimbursementTopology } from "../finance-reimbursement-locks.js";
import { type createFinanceService, isProviderTransfer } from "../finance-service.js";
import { effectiveSynchronization } from "../finance-status-service.js";
import type { Principal } from "../types.js";
import { requireWorkspaceExecution } from "../workspace-execution.js";
import { createFinanceBatchCorrectionService } from "./batch-correction-service.js";
import { captureFinanceBatchEffect } from "./batch-effect-state.js";
import { guardFinanceExecutionTransaction } from "./execution-owner-guard.js";
import {
  type FinanceMaintenanceWork,
  selectFinanceMaintenanceWork,
} from "./maintenance-work-selection.js";
import { readTransferPairEvidence } from "./transfer-pair-evidence.js";

type Context = { principal: Principal; requestId: string; signal?: AbortSignal };
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Row = typeof financeReviewBatchRuns.$inferSelect;
type Finance = Pick<
  ReturnType<typeof createFinanceService>,
  | "resolveReview"
  | "applyCategorizations"
  | "applyVerifiedTransferPair"
  | "restoreReviewBatchEffect"
  | "qualifyBatchCategorization"
>;

const manifestItemSchema = z.strictObject({
  decision: financeReviewBatchDecisionSchema,
  transferCounterpart: financeReviewBatchCounterpartSchema.optional(),
  pairFingerprint: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
});
function manifest(row: Row) {
  return row.manifest.map((item) =>
    typeof item === "object" && item !== null && "decision" in item
      ? manifestItemSchema.parse(item)
      : {
          decision: financeReviewBatchDecisionSchema.parse(item),
          transferCounterpart: undefined,
          pairFingerprint: undefined,
        },
  );
}
function outcomes(row: Row) {
  return row.outcomes.map((item) => financeReviewBatchOutcomeSchema.parse(item));
}
function present(row: Row): FinanceReviewBatchRun {
  const items = manifest(row);
  const decisions = items.map(({ decision }) => decision);
  const receipts = outcomes(row);
  const pendingCount = decisions.length - receipts.length;
  return {
    id: row.id,
    fingerprint: row.fingerprint,
    idempotencyKey: row.idempotencyKey,
    decisions,
    transferCounterparts: items.flatMap(({ transferCounterpart }, index) =>
      transferCounterpart ? [{ index, ...transferCounterpart }] : [],
    ),
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
  elapsedNow = () => performance.now(),
  executionBudgetMs = 45_000,
  transactionBudgetMs = 10_000,
}: {
  db: Database;
  now: () => Date;
  finance: Finance;
  elapsedNow?: () => number;
  executionBudgetMs?: number;
  transactionBudgetMs?: number;
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
    agent = false,
    counterpartLimit?: number,
  ): Promise<
    | {
        transferReview?: boolean;
        transferCounterpart?: { transactionId: string; revision: string };
        pairFingerprint?: string;
      }
    | undefined
  > {
    if (decision.kind === "transfer_pair") {
      const proof = await readTransferPairEvidence(tx, userId, decision, now(), lock);
      return {
        transferReview: true,
        transferCounterpart: proof.transferCounterpart,
        pairFingerprint: proof.fingerprint,
      };
    }
    // Reconciliation/provider sync lock accounts before their transaction evidence.
    if (lock && decision.kind === "review" && decision.action === "confirm_transfer")
      await tx
        .select({ id: financeAccounts.id })
        .from(financeAccounts)
        .where(eq(financeAccounts.userId, userId))
        .orderBy(financeAccounts.id)
        .for("update");
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
      if (agent && review.reason === "possible_transfer" && decision.action !== "defer") {
        if (transaction.transferGroupId)
          throw new AppError(
            "invalid_request",
            "Inspect the existing transfer relationship before changing this case.",
          );
        if (decision.action === "confirm_transfer") {
          // Caller prose/confidence is not proof. Require a unique reciprocal pair
          // with signed source directions and transfer provenance on both legs.
          const evidenceQuery = tx
            .select({ transaction: financeTransactions })
            .from(financeTransactions)
            .innerJoin(
              financeAccounts,
              and(
                eq(financeAccounts.id, financeTransactions.accountId),
                eq(financeAccounts.userId, userId),
              ),
            )
            .where(
              and(
                eq(financeTransactions.userId, userId),
                eq(financeTransactions.amount, transaction.amount),
              ),
            );
          const rows = await (lock
            ? evidenceQuery.for("share", { of: financeTransactions })
            : counterpartLimit
              ? evidenceQuery.limit(counterpartLimit)
              : evidenceQuery);
          if (counterpartLimit && rows.length >= counterpartLimit)
            throw new AppError(
              "conflict",
              "Counterpart evidence exceeds the qualification bound.",
              { qualificationReason: "counterpart_evidence_limit" },
            );
          const evidenceIds = rows.map((row) => row.transaction.id);
          const confirmations = evidenceIds.length
            ? await tx
                .select({ transactionId: auditEvents.entityId, after: auditEvents.after })
                .from(auditEvents)
                .where(
                  and(
                    eq(auditEvents.userId, userId),
                    eq(auditEvents.action, "finance.transfer_confirmed"),
                    eq(auditEvents.entityType, "finance_transaction"),
                    or(
                      inArray(auditEvents.entityId, evidenceIds),
                      inArray(
                        sql<string>`${auditEvents.after}->'confirmedTransferPair'->>'counterpartTransactionId'`,
                        evidenceIds,
                      ),
                    ),
                  ),
                )
            : [];
          // Immutable writer receipts bind both legs. A confirmed leg remains evidence
          // for its exact partner, never a spare counterpart for another transaction.
          const pairs = confirmations.flatMap((confirmation) => {
            const pair = confirmation.after?.confirmedTransferPair;
            if (
              !pair ||
              typeof pair !== "object" ||
              !("transactionRevision" in pair) ||
              typeof pair.transactionRevision !== "string" ||
              !("counterpartTransactionId" in pair) ||
              typeof pair.counterpartTransactionId !== "string" ||
              !("counterpartRevision" in pair) ||
              typeof pair.counterpartRevision !== "string"
            )
              return [];
            return [
              {
                transactionId: confirmation.transactionId,
                transactionRevision: pair.transactionRevision,
                counterpartTransactionId: pair.counterpartTransactionId,
                counterpartRevision: pair.counterpartRevision,
              },
            ];
          });
          const belongsToPair = (id: string, counterpartId: string) =>
            pairs.every(
              (pair) =>
                (pair.transactionId !== id || pair.counterpartTransactionId === counterpartId) &&
                (pair.counterpartTransactionId !== id || pair.transactionId === counterpartId),
            );
          const candidates = rows
            .map((row) => row.transaction)
            .filter(
              (row) =>
                !row.pending &&
                !row.transferGroupId &&
                row.providerDirection !== null &&
                row.reconciliationStatus !== "matched" &&
                (row.reconciliationStatus !== "confirmed" ||
                  pairs.some(
                    (pair) =>
                      pair.transactionId === row.id &&
                      pair.transactionRevision === row.contextualRevision.toString() &&
                      pair.counterpartTransactionId === transaction.id &&
                      pair.counterpartRevision === transaction.contextualRevision.toString(),
                  )) &&
                row.currencyCode !== null &&
                (row.direction === "transfer" ||
                  isProviderTransfer(row.providerCategory) ||
                  isProviderTransfer(row.providerCategoryDetailed)),
            );
          const counterparts = (row: typeof transaction) =>
            candidates.filter(
              (other) =>
                other.id !== row.id &&
                other.accountId !== row.accountId &&
                other.providerDirection !== row.providerDirection &&
                other.currencyCode === row.currencyCode &&
                Math.abs(Date.parse(other.transactionDate) - Date.parse(row.transactionDate)) <=
                  3 * 86_400_000,
            );
          const matches = counterparts(transaction);
          const match = matches.length === 1 ? matches[0] : undefined;
          if (
            !candidates.some((row) => row.id === transaction.id) ||
            !match ||
            counterparts(match).length !== 1 ||
            !belongsToPair(transaction.id, match.id) ||
            !belongsToPair(match.id, transaction.id)
          )
            throw new AppError(
              "invalid_request",
              "Confirming this transfer requires a unique owned counterpart with current source evidence.",
            );
          return {
            transferReview: true,
            transferCounterpart: {
              transactionId: match.id,
              revision: match.contextualRevision.toString(),
            },
          };
        }
        return { transferReview: true };
      }
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
    ...createFinanceBatchCorrectionService({
      db,
      now,
      authorize,
      findBatch: find,
      restore: finance.restoreReviewBatchEffect,
    }),
    async qualify(raw: unknown, context: Context): Promise<FinanceMaintenanceQualification> {
      const input = qualifyFinanceMaintenanceWorkInputSchema.parse(raw);
      const deadline = elapsedNow() + 5_000;
      return db.transaction(async (tx) => {
        await tx.execute(sql`set transaction isolation level repeatable read`);
        await tx.execute(sql`set local statement_timeout = '1000ms'`);
        await authorize(tx, context, "read");
        const asOf = now();
        const principal = context.principal;
        if (principal.actorType !== "user" && principal.actorType !== "agent")
          throw new AppError(
            "forbidden",
            "Qualification requires an authenticated Finance reader.",
          );
        const [policy] = await tx
          .select({ bypass: executionPolicySettings.reviewBypassEnabled })
          .from(executionPolicySettings)
          .where(eq(executionPolicySettings.userId, principal.userId));
        const [grant] =
          principal.actorType === "agent"
            ? await tx
                .select()
                .from(accessTokens)
                .where(eq(accessTokens.id, principal.actorId))
                .limit(1)
            : [];
        // Inspection permission is distinct from standing approval and effect permission.
        const executionDenied =
          !principal.scopes.has("finances:write") ||
          (principal.actorType === "agent" &&
            (!principal.scopes.has("finances:execute") ||
              !grant?.scopes.includes("finances:write") ||
              !grant.scopes.includes("finances:execute")));
        const approvalReady =
          !executionDenied && principal.actorType === "agent" && policy?.bypass === true;
        type Item = FinanceMaintenanceQualification["items"][number];
        async function source(transactionId: string) {
          const [transaction] = await tx
            .select()
            .from(financeTransactions)
            .where(
              and(
                eq(financeTransactions.id, transactionId),
                eq(financeTransactions.userId, principal.userId),
              ),
            )
            .limit(1);
          if (!transaction) return null;
          const [account] = await tx
            .select()
            .from(financeAccounts)
            .where(
              and(
                eq(financeAccounts.id, transaction.accountId),
                eq(financeAccounts.userId, principal.userId),
              ),
            )
            .limit(1);
          if (!account) return null;
          const [item] = account.providerItemRecordId
            ? await tx
                .select()
                .from(financeProviderItems)
                .where(
                  and(
                    eq(financeProviderItems.id, account.providerItemRecordId),
                    eq(financeProviderItems.userId, principal.userId),
                  ),
                )
                .limit(1)
            : [];
          const ready =
            !transaction.pending &&
            transaction.currencyCode !== null &&
            (account.provider === "manual"
              ? account.status === "manual" &&
                account.providerItemRecordId === null &&
                account.providerItemId === null &&
                account.providerAccountId === null
              : account.status === "connected" &&
                item?.provider === "plaid" &&
                item.providerItemId !== null &&
                account.providerItemId === item.providerItemId &&
                account.lastSyncedAt !== null &&
                account.lastSyncedAt <= asOf &&
                item.lastSyncedAt !== null &&
                item.lastSyncedAt <= asOf &&
                effectiveSynchronization(account, asOf).state === "current" &&
                effectiveSynchronization(item, asOf).state === "current");
          return {
            ready,
            ref: {
              transactionId: transaction.id,
              transactionRevision: transaction.contextualRevision.toString(),
              accountId: account.id,
              accountRevision: account.contextualRevision.toString(),
              providerItemId: item?.id ?? null,
              providerItemUpdatedAt: item?.updatedAt.toISOString() ?? null,
            },
          };
        }
        const items: Item[] = [];
        const work: FinanceMaintenanceWork[] = [];
        for (const [index, decision] of input.decisions.entries()) {
          if (elapsedNow() >= deadline)
            throw new AppError(
              "service_unavailable",
              "Qualification exceeded its bounded read window.",
            );
          const item: Item = {
            index,
            transactionId: decision.transactionId,
            state: "awaiting_evidence",
            reasons: [],
            sourceRefs: [],
          };
          const primary = await source(decision.transactionId);
          let sourceReady = primary?.ready === true;
          let evidenceReady = false;
          if (!primary) item.reasons.push("source_unavailable");
          else {
            item.sourceRefs.push(primary.ref);
            if (!primary.ready) item.reasons.push("source_not_current");
            else
              try {
                // Reuse the real reciprocal evidence/revision rules; caller prose is not proof.
                const checked = await validate(tx, decision, principal.userId, false, true, 201);
                if (checked?.transferCounterpart) {
                  const counterpart = await source(checked.transferCounterpart.transactionId);
                  if (counterpart) item.sourceRefs.push(counterpart.ref);
                  sourceReady = counterpart?.ready === true;
                  if (!sourceReady) item.reasons.push("counterpart_source_not_current");
                  else
                    evidenceReady =
                      counterpart?.ref.transactionRevision === checked.transferCounterpart.revision;
                }
                if (sourceReady && decision.kind === "categorization")
                  evidenceReady = await finance.qualifyBatchCategorization(
                    decision,
                    principal.userId,
                    tx,
                  );
                // Other action families need their owning evidence adapter; do not infer from confidence.
                if (sourceReady && !evidenceReady)
                  item.reasons.push("decision_evidence_not_qualified");
              } catch (error) {
                if (
                  !(error instanceof AppError) ||
                  !["conflict", "invalid_request", "not_found"].includes(error.code)
                )
                  throw error;
                const detail = error.details as { qualificationReason?: string } | undefined;
                item.reasons.push(
                  detail?.qualificationReason === "counterpart_evidence_limit"
                    ? "counterpart_evidence_limit"
                    : error.code === "conflict"
                      ? "stale_decision"
                      : "decision_evidence_not_qualified",
                );
              }
          }
          if (executionDenied) item.reasons.push("execution_not_authorized");
          else if (!approvalReady) item.reasons.push("approval_required");
          work.push({ id: String(index), sourceReady, evidenceReady, approvalReady });
          items.push(item);
        }
        const selected = selectFinanceMaintenanceWork(work);
        for (const [index, item] of items.entries())
          item.state = executionDenied
            ? "authorization_denied"
            : (selected[index]?.state ?? "source_blocked");
        return financeMaintenanceQualificationSchema.parse({
          asOf: asOf.toISOString(),
          advisoryOnly: true,
          previewRequired: true,
          executionRevalidationRequired: true,
          items,
        });
      });
    },
    async preview(raw: unknown, context: Context): Promise<FinanceReviewBatchRun> {
      const input = previewFinanceReviewBatchInputSchema.parse(raw);
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
          if (
            JSON.stringify(manifest(row).map(({ decision }) => decision)) !==
            JSON.stringify(input.decisions)
          )
            throw new AppError(
              "conflict",
              "That idempotency key already identifies a different manifest.",
            );
          return present(row);
        }
        const items: z.infer<typeof manifestItemSchema>[] = [];
        for (const decision of input.decisions) {
          const checked = await validate(
            tx,
            decision,
            context.principal.userId,
            false,
            context.principal.actorType === "agent",
          );
          items.push({
            decision,
            transferCounterpart: checked?.transferCounterpart,
            pairFingerprint: checked?.pairFingerprint,
          });
        }
        const fingerprint = `sha256:${createHash("sha256").update(JSON.stringify(items)).digest("hex")}`;
        const [row] = await tx
          .insert(financeReviewBatchRuns)
          .values({
            userId: context.principal.userId,
            actorId: context.principal.actorId,
            actorType: context.principal.actorType,
            authorizationConnectionId: context.principal.authorizationConnectionId ?? null,
            idempotencyKey: input.idempotencyKey,
            fingerprint,
            manifest: items,
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
      // Leave >=15 seconds below the 60s gateway for rollback/serialization/transport.
      // This clock is independent of the injectable domain timestamp.
      const budget = Math.max(1, Math.min(executionBudgetMs, 45_000));
      const deadline = elapsedNow() + budget;
      const interrupted = new AppError(
        "service_unavailable",
        "Finance batch execution paused; retrieve the saved batch and resume pending items.",
      );
      const remaining = () => Math.max(0, Math.floor(deadline - elapsedNow()));
      let stopped = false;
      const check = () => {
        if (stopped || context.signal?.aborted || remaining() <= 0) throw interrupted;
      };
      async function bounded<T>(
        run: (
          tx: Transaction,
          preserve: <R>(operation: () => Promise<R>) => Promise<R>,
        ) => Promise<T>,
      ): Promise<T> {
        check();
        let observedInterruption: unknown;
        async function preserve<R>(operation: () => Promise<R>): Promise<R> {
          try {
            return await operation();
          } catch (error) {
            // PostgreSQL transaction_timeout terminates the connection. Drizzle's
            // subsequent savepoint/outer rollback can mask its original SQLSTATE.
            // Retain only an observed interruption, never infer one from a generic
            // connection failure (which could represent an uncertain commit).
            if (isInterrupted(error)) observedInterruption = error;
            throw error;
          }
        }
        let activeClient: PoolClient | undefined;
        let released = false;
        let discarded = false;
        const discard = () => {
          if (activeClient && !released) {
            released = true;
            discarded = true;
            activeClient.release(true);
          }
        };
        async function transactionWork(): Promise<T> {
          // The repository database factory exposes Drizzle's public $client pool.
          // Own one checkout until session configuration is restored or discarded.
          const pool = (db as Database & { $client: Pool }).$client;
          const client = await pool.connect();
          activeClient = client;
          let reusable = false;
          let previousTimeout: string | undefined;
          const onError = (error: Error) => {
            if (isInterrupted(error)) observedInterruption = error;
          };
          client.on("error", onError);
          const sessionQuery = <R extends QueryResultRow = QueryResultRow>(
            text: string,
            values?: string[],
          ) => {
            // node-postgres supports a per-query client deadline; its type package
            // currently declares this option only on the connection configuration.
            const query: QueryConfig & { query_timeout: number } = {
              text,
              ...(values ? { values } : {}),
              query_timeout: Math.max(1, Math.min(3_000, remaining())),
            };
            return client.query<R>(query);
          };
          try {
            check();
            const settings = await sessionQuery<{ timeout: string }>(
              "SELECT current_setting('transaction_timeout') AS timeout",
            );
            previousTimeout = settings.rows[0]?.timeout;
            if (previousTimeout === undefined)
              throw new AppError(
                "internal_error",
                "The transaction deadline setting is unavailable.",
              );
            check();
            const timeout = Math.max(1, Math.min(transactionBudgetMs, 10_000, remaining()));
            // PG17 arms transaction_timeout at StartTransaction. SET LOCAL after
            // BEGIN changes the setting but does not start that transaction's timer.
            await sessionQuery("SELECT set_config('transaction_timeout', $1, false)", [
              `${timeout}ms`,
            ]);
            check();
            const sessionDb: Database = drizzle(client, { schema: databaseSchema });
            const result = await sessionDb.transaction((tx) =>
              preserve(async () => {
                check();
                const statementTimeout = Math.max(1, Math.floor(timeout / 2));
                await tx.execute(sql.raw(`SET LOCAL statement_timeout = '${statementTimeout}ms'`));
                await tx.execute(
                  sql.raw(`SET LOCAL lock_timeout = '${Math.min(3_000, statementTimeout)}ms'`),
                );
                const value = await run(tx, preserve);
                check();
                return value;
              }),
            );
            reusable = true;
            return result;
          } finally {
            if (
              !released &&
              reusable &&
              previousTimeout !== undefined &&
              !stopped &&
              remaining() > 0
            ) {
              try {
                await sessionQuery("SELECT set_config('transaction_timeout', $1, false)", [
                  previousTimeout,
                ]);
                if (!released) {
                  released = true;
                  client.release();
                }
              } catch {
                // The transaction is already committed. Cleanup failure must not
                // relabel its durable outcome; discard the contaminated session.
                discard();
              }
            } else discard();
            if (discarded) client.once("end", () => client.removeListener("error", onError));
            else client.removeListener("error", onError);
          }
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        let abort = () => {};
        const interruption = new Promise<never>((_, reject) => {
          abort = () => {
            stopped = true;
            discard();
            reject(interrupted);
          };
          timer = setTimeout(abort, remaining());
          context.signal?.addEventListener("abort", abort, { once: true });
        });
        try {
          return await Promise.race([transactionWork(), interruption]);
        } catch (error) {
          throw observedInterruption ?? error;
        } finally {
          clearTimeout(timer);
          context.signal?.removeEventListener("abort", abort);
        }
      }
      const isInterrupted = (error: unknown): boolean => {
        if (error === interrupted) return true;
        if (typeof error !== "object" || error === null) return false;
        if ("code" in error && ["25P04", "57014", "55P03"].includes(String(error.code)))
          return true;
        return "cause" in error && error.cause !== error && isInterrupted(error.cause);
      };
      let latest = await bounded(async (tx) => {
        await authorize(tx, context, "execute");
        const row = await find(tx, id, context);
        if (row.fingerprint !== input.fingerprint)
          throw new AppError("conflict", "Execution must accept the exact preview fingerprint.");
        return row;
      }).catch((error: unknown) => {
        if (isInterrupted(error)) throw interrupted;
        throw error;
      });
      for (let count = 0; count < input.limit; count++) {
        if (context.signal?.aborted || remaining() < Math.min(10_000, budget / 10)) break;
        try {
          const progressed = await bounded(async (tx, preserve) => {
            await authorize(tx, context, "execute");
            const row = await find(tx, id, context);
            if (row.fingerprint !== input.fingerprint)
              throw new AppError(
                "conflict",
                "Execution must accept the exact preview fingerprint.",
              );
            const items = manifest(row);
            const receipts = outcomes(row);
            const completed = new Set(receipts.map((item) => item.index));
            const index = items.findIndex((_, index) => !completed.has(index));
            const item = items[index];
            if (!item) return { row, progressed: false };
            const { decision, transferCounterpart, pairFingerprint } = item;
            check();
            let outcome: FinanceReviewBatchOutcome;
            try {
              // A savepoint rolls back all writer effects before a business failure receipt commits.
              outcome = await tx.transaction((itemTx) =>
                preserve(async () => {
                  const transferReview = await validate(
                    itemTx,
                    decision,
                    context.principal.userId,
                    true,
                    row.actorType === "agent",
                  );
                  if (
                    decision.kind === "transfer_pair" &&
                    (!pairFingerprint || transferReview?.pairFingerprint !== pairFingerprint)
                  )
                    throw new AppError(
                      "conflict",
                      "Transfer evidence changed; prepare a new preview.",
                    );
                  const currentCounterpart = transferReview?.transferCounterpart;
                  if (currentCounterpart || transferCounterpart) {
                    const matchingId =
                      currentCounterpart &&
                      transferCounterpart &&
                      currentCounterpart.transactionId === transferCounterpart.transactionId;
                    // The only allowed advance is the first leg of this exact reciprocal pair
                    // committed by this same run. validate() also checked the writer's pair audit.
                    const advancedByThisRun =
                      matchingId &&
                      receipts.some((receipt) => {
                        const prior = items[receipt.index];
                        return (
                          receipt.status === "applied" &&
                          receipt.appliedTransferRevision === currentCounterpart.revision &&
                          receipt.transactionId === transferCounterpart.transactionId &&
                          prior?.decision.expectedTransactionRevision ===
                            transferCounterpart.revision &&
                          prior.transferCounterpart?.transactionId === decision.transactionId &&
                          prior.transferCounterpart.revision ===
                            decision.expectedTransactionRevision
                        );
                      });
                    if (
                      !matchingId ||
                      (currentCounterpart.revision !== transferCounterpart.revision &&
                        !advancedByThisRun)
                    )
                      throw new AppError(
                        "conflict",
                        "The transfer counterpart changed or was not bound; prepare a new preview.",
                      );
                  }
                  check();
                  // Deliberately reconstruct context: internal prepared-action/maintenance capabilities
                  // must never be inherited from a batch caller or persisted preview.
                  const writerContext = {
                    principal: context.principal,
                    requestId: context.requestId,
                    financeReviewBatchScope: {
                      transactionId: decision.transactionId,
                      transferReview: transferReview?.transferReview === true,
                      ...(currentCounterpart ? { transferCounterpart: currentCounterpart } : {}),
                      reviewId: decision.kind === "review" ? decision.reviewId : null,
                    },
                  };
                  const effectIds =
                    decision.kind === "transfer_pair"
                      ? [decision.transactionId, decision.counterpartTransactionId]
                      : [decision.transactionId];
                  const beforeEffect = await captureFinanceBatchEffect(
                    itemTx,
                    context.principal.userId,
                    effectIds,
                  );
                  let status: FinanceReviewBatchOutcome["status"];
                  if (decision.kind === "transfer_pair") {
                    const results = await finance.applyVerifiedTransferPair(
                      decision,
                      writerContext,
                      itemTx,
                    );
                    status =
                      results.length === 2 && results.every((result) => result.applied)
                        ? "applied"
                        : "review_required";
                  } else if (decision.kind === "review") {
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
                      throw new AppError(
                        "internal_error",
                        "The categorization outcome is missing.",
                      );
                    status = result.applied ? "applied" : "review_required";
                  }
                  if (status === "applied") {
                    const afterEffect = await captureFinanceBatchEffect(
                      itemTx,
                      context.principal.userId,
                      effectIds,
                    );
                    await itemTx.insert(financeReviewBatchEffects).values({
                      userId: context.principal.userId,
                      batchId: row.id,
                      outcomeIndex: index,
                      before: beforeEffect,
                      after: afterEffect,
                      createdAt: now(),
                    });
                  }
                  let appliedTransferRevision: string | undefined;
                  if (status === "applied" && currentCounterpart) {
                    const [updated] = await itemTx
                      .select({ revision: financeTransactions.contextualRevision })
                      .from(financeTransactions)
                      .where(
                        and(
                          eq(financeTransactions.id, decision.transactionId),
                          eq(financeTransactions.userId, context.principal.userId),
                        ),
                      )
                      .limit(1);
                    if (!updated)
                      throw new AppError(
                        "internal_error",
                        "The applied transfer revision is missing.",
                      );
                    appliedTransferRevision = updated.revision.toString();
                  }
                  check();
                  return {
                    index,
                    ...(appliedTransferRevision ? { appliedTransferRevision } : {}),
                    transactionId: decision.transactionId,
                    status,
                    undoAvailable: status === "applied",
                    error: null,
                    recovery: status === "applied" ? ("none" as const) : ("new_preview" as const),
                    completedAt: now().toISOString(),
                  };
                }),
              );
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
            check();
            const [updated] = await tx
              .update(financeReviewBatchRuns)
              .set({ outcomes: [...receipts, outcome], updatedAt: now() })
              .where(eq(financeReviewBatchRuns.id, row.id))
              .returning();
            if (!updated)
              throw new AppError("internal_error", "The batch receipt could not be saved.");
            return { row: updated, progressed: true };
          });
          latest = progressed.row;
          if (!progressed.progressed) break;
        } catch (error) {
          if (!isInterrupted(error)) throw error;
          break;
        }
      }
      // Only a successfully committed snapshot is returned. A response lost at commit
      // remains recoverable via get/resume; no unbounded final database read is needed.
      return present(latest);
    },
  };
}
