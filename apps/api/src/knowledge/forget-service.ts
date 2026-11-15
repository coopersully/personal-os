import { randomUUID } from "node:crypto";
import {
  auditEvents,
  type Database,
  knowledgeLearningReceipts,
  knowledgeReceipts,
  knowledgeSelectionInteractions,
  knowledgeForgetOperations as operations,
  knowledgeForgetPreviews as previews,
  knowledgeForgetReplayBindings as replays,
  knowledgeForgetTargets as targets,
} from "@personal-os/database";
import {
  activeKnowledgeForgetOperationsSchema,
  type KnowledgeForgetInput,
  type KnowledgeForgetOperationInput,
  type KnowledgeForgetPreview,
  type KnowledgeForgetPreviewInput,
  type KnowledgeForgetStatus,
  type KnowledgeMutationResult,
  knowledgeForgetInputSchema,
  knowledgeForgetOperationInputSchema,
  knowledgeForgetPreviewInputSchema,
} from "@personal-os/domain";
import { and, asc, eq, isNotNull, isNull, lte, or } from "drizzle-orm";
import { auditValues } from "../audit.js";
import { AppError } from "../errors.js";
import type { Principal } from "../types.js";
import {
  admitHumanKnowledgeContent,
  assertKnowledgeContentAvailable,
  bumpKnowledgeEpoch,
  findOwnedKnowledgeRevision,
  type KnowledgeTransaction,
  lockKnowledgeOwner,
  readKnowledgeEpoch,
  requireKnowledgeOwner,
  requireLiveKnowledgeHumanSession,
} from "./access.js";
import {
  eraseForgetBatch,
  type KnowledgeForgetOperation,
  planForgetErasure,
  readForgetImpact,
  scrubForgetBatch,
} from "./forget-erasure.js";
import {
  assertKnowledgeForgetKey,
  knowledgeForgetKeyProof,
  validKnowledgeForgetKey,
} from "./forget-suppression.js";

export type KnowledgeDeletionLedgerEntry = {
  operationId: string;
  ownerId: string;
  epoch: number;
  recordIds: string[];
  suppressionFingerprints: string[];
};

/** An independently durable, idempotent ledger. Both methods must honor cancellation.
 * readReceipt returns the durable entry, not an acknowledgement from a transport cache. */
export type KnowledgeDeletionLedger = {
  append(entry: KnowledgeDeletionLedgerEntry, signal: AbortSignal): Promise<void>;
  readReceipt(
    operationId: string,
    signal: AbortSignal,
  ): Promise<KnowledgeDeletionLedgerEntry | null>;
};
export type KnowledgeForgetDependencies = {
  suppressionKey?: Uint8Array;
  ledger?: KnowledgeDeletionLedger;
};

const leaseMs = 30_000;
const ledgerTimeoutMs = 10_000;
const retryDelaysMs = [60_000, 5 * 60_000, 30 * 60_000] as const;
const leaseReleased = { leaseId: null, leaseUntil: null } as const;

function operationReceipt(
  op: KnowledgeForgetOperation,
  recordId = op.recordId,
): KnowledgeMutationResult {
  return op.status === "completed"
    ? { receiptId: op.id, recordId, outcome: "forgotten" }
    : { receiptId: op.id, recordId, outcome: "pending_erasure", operationId: op.id };
}

async function ownedOperation(tx: KnowledgeTransaction, userId: string, id: string) {
  const [row] = await tx
    .select()
    .from(operations)
    .where(and(eq(operations.userId, userId), eq(operations.id, id)));
  if (!row) throw new AppError("not_found", "The forget operation was not found.");
  return row;
}

async function priorErasure(tx: KnowledgeTransaction, userId: string, recordId: string) {
  const [row] = await tx
    .select({ op: operations })
    .from(targets)
    .innerJoin(
      operations,
      and(eq(operations.userId, targets.userId), eq(operations.id, targets.operationId)),
    )
    .where(and(eq(targets.userId, userId), eq(targets.recordId, recordId)));
  return row?.op;
}

async function assertMutationKeyUnused(
  tx: KnowledgeTransaction,
  userId: string,
  mutationKey: string,
) {
  const [record] = await tx
    .select({ id: knowledgeReceipts.id })
    .from(knowledgeReceipts)
    .where(
      and(eq(knowledgeReceipts.userId, userId), eq(knowledgeReceipts.mutationKey, mutationKey)),
    );
  const [learning] = await tx
    .select({ key: knowledgeLearningReceipts.mutationKey })
    .from(knowledgeLearningReceipts)
    .where(
      and(
        eq(knowledgeLearningReceipts.userId, userId),
        eq(knowledgeLearningReceipts.mutationKey, mutationKey),
      ),
    );
  // A committed selection owns its event ID even when it produced no knowledge receipt.
  const [selection] = await tx
    .select({ id: knowledgeSelectionInteractions.id })
    .from(knowledgeSelectionInteractions)
    .where(
      and(
        eq(knowledgeSelectionInteractions.userId, userId),
        eq(knowledgeSelectionInteractions.id, mutationKey),
        isNotNull(knowledgeSelectionInteractions.occurredAt),
      ),
    );
  if (record || learning || selection)
    throw new AppError("conflict", "This mutation key was used for another request.");
}

function validReceipt(
  entry: KnowledgeDeletionLedgerEntry,
  receipt: KnowledgeDeletionLedgerEntry | null,
) {
  return (
    receipt?.operationId === entry.operationId &&
    receipt.ownerId === entry.ownerId &&
    receipt.epoch === entry.epoch &&
    Array.isArray(receipt.recordIds) &&
    Array.isArray(receipt.suppressionFingerprints) &&
    JSON.stringify([...receipt.recordIds].sort()) === JSON.stringify(entry.recordIds) &&
    JSON.stringify([...receipt.suppressionFingerprints].sort()) ===
      JSON.stringify(entry.suppressionFingerprints)
  );
}

async function verifyLedger(
  ledger: KnowledgeDeletionLedger | undefined,
  entry: KnowledgeDeletionLedgerEntry,
  stopping: AbortSignal | undefined,
  deadline: number,
  now: () => Date,
) {
  if (!ledger || stopping?.aborted) return false;
  const payload = structuredClone(entry);
  const remaining = deadline - now().getTime();
  if (remaining <= 0) return false;
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), Math.min(ledgerTimeoutMs, remaining));
  const signal = stopping ? AbortSignal.any([stopping, timeout.signal]) : timeout.signal;
  let onAbort: (() => void) | undefined;
  const abort = new Promise<false>((resolve) => {
    onAbort = () => resolve(false);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  const canSend = () => !signal.aborted && now().getTime() < deadline;
  try {
    return await Promise.race([
      abort,
      (async () => {
        if (!canSend()) return false;
        const previous = await ledger.readReceipt(entry.operationId, signal);
        if (!canSend()) return false;
        if (previous !== null) return validReceipt(entry, previous);
        await ledger.append(payload, signal);
        if (!canSend()) return false;
        const receipt = await ledger.readReceipt(entry.operationId, signal);
        return canSend() && validReceipt(entry, receipt);
      })(),
    ]);
  } catch {
    // Provider errors can contain request data or credentials. Only the retry state is persisted.
    return false;
  } finally {
    clearTimeout(timer);
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

function claimCondition(now: Date) {
  return and(
    eq(operations.status, "pending"),
    lte(operations.dueAt, now),
    or(isNull(operations.leaseUntil), lte(operations.leaseUntil, now)),
  );
}

export function createKnowledgeForgetService({
  db,
  now,
  suppressionKey,
  ledger,
}: { db: Database; now: () => Date } & KnowledgeForgetDependencies) {
  async function claim(stopping: AbortSignal | undefined) {
    if (stopping?.aborted) return;
    const [candidate] = await db
      .select({ id: operations.id, userId: operations.userId })
      .from(operations)
      .where(claimCondition(now()))
      .orderBy(asc(operations.dueAt), asc(operations.id))
      .limit(1);
    if (!candidate) return;
    return db.transaction(async (tx) => {
      await lockKnowledgeOwner(tx, candidate.userId);
      if (stopping?.aborted) return;
      const at = now();
      const [op] = await tx
        .update(operations)
        .set({
          leaseId: randomUUID(),
          leaseUntil: new Date(at.getTime() + leaseMs),
        })
        .where(
          and(
            eq(operations.id, candidate.id),
            eq(operations.userId, candidate.userId),
            claimCondition(at),
          ),
        )
        .returning();
      return op;
    });
  }

  async function withLease<T>(
    claimed: KnowledgeForgetOperation,
    stopping: AbortSignal | undefined,
    run: (tx: KnowledgeTransaction, op: KnowledgeForgetOperation) => Promise<T>,
  ) {
    if (!claimed.leaseId || stopping?.aborted) return;
    const leaseId = claimed.leaseId;
    return db.transaction(async (tx) => {
      await lockKnowledgeOwner(tx, claimed.userId);
      const [op] = await tx
        .select()
        .from(operations)
        .where(
          and(
            eq(operations.id, claimed.id),
            eq(operations.userId, claimed.userId),
            eq(operations.status, "pending"),
            eq(operations.leaseId, leaseId),
          ),
        )
        .for("update");
      if (!op?.leaseUntil || op.leaseUntil <= now() || stopping?.aborted) return;
      return run(tx, op);
    });
  }

  async function deferOrComplete(
    claimed: KnowledgeForgetOperation,
    stopping: AbortSignal | undefined,
    complete: boolean,
  ) {
    await withLease(claimed, stopping, async (tx, op) => {
      const match = and(eq(operations.userId, op.userId), eq(operations.id, op.id));
      if (complete) {
        await bumpKnowledgeEpoch(tx, op.userId);
        if (stopping?.aborted) return;
        await tx
          .update(operations)
          .set({ status: "completed", ...leaseReleased })
          .where(match);
        return;
      }
      const delay = retryDelaysMs[op.failures];
      await tx
        .update(operations)
        .set({
          status: delay === undefined ? "blocked" : "pending",
          dueAt: new Date(now().getTime() + (delay ?? 0)),
          failures: op.failures + 1,
          ...leaseReleased,
        })
        .where(match);
    });
  }

  return {
    async preview(
      principal: Principal,
      raw: KnowledgeForgetPreviewInput,
    ): Promise<KnowledgeForgetPreview> {
      requireKnowledgeOwner(principal);
      const { recordId, cursor } = knowledgeForgetPreviewInputSchema.parse(raw);
      return db.transaction(async (tx) => {
        const { userId } = principal;
        await admitHumanKnowledgeContent(tx, principal, now);
        const epoch = await readKnowledgeEpoch(tx, userId);
        const erased = await priorErasure(tx, userId, recordId);
        if (!erased && !(await findOwnedKnowledgeRevision(tx, userId, recordId)))
          throw new AppError("not_found", "The knowledge record was not found.");
        const [preview] = await tx
          .insert(previews)
          .values({ id: randomUUID(), userId, recordId, epoch })
          .onConflictDoUpdate({ target: [previews.userId, previews.recordId], set: { epoch } })
          .returning();
        if (!preview)
          throw new AppError("internal_error", "The forget preview could not be saved.");
        if (cursor && (cursor.previewId !== preview.id || cursor.ownerEpoch !== epoch))
          throw new AppError("conflict", "The forget preview changed. Open a fresh preview.");
        const { affected, dependentCopyCount, historyCount, more } = erased
          ? { affected: [], dependentCopyCount: 0, historyCount: 0, more: false }
          : await readForgetImpact(tx, userId, recordId, cursor);
        const last = affected.at(-1);
        return {
          previewId: preview.id,
          ownerEpoch: epoch,
          recordId,
          affected,
          dependentCopyCount,
          historyCount,
          nextCursor: more && last ? { ...last, ownerEpoch: epoch, previewId: preview.id } : null,
        };
      });
    },

    async forget(
      principal: Principal,
      raw: KnowledgeForgetInput,
    ): Promise<KnowledgeMutationResult> {
      requireKnowledgeOwner(principal);
      const input = knowledgeForgetInputSchema.parse(raw);
      return db.transaction(async (tx) => {
        const { userId } = principal;
        await lockKnowledgeOwner(tx, userId);
        await requireLiveKnowledgeHumanSession(tx, principal, now());
        const [previous] = await tx
          .select()
          .from(operations)
          .where(and(eq(operations.userId, userId), eq(operations.mutationKey, input.mutationKey)));
        if (previous) {
          if (
            previous.previewId !== input.previewId.toLowerCase() ||
            previous.epoch !== input.ownerEpoch + 1
          )
            throw new AppError("conflict", "This mutation key was used for another request.");
          return operationReceipt(previous);
        }
        const [repeat] = await tx
          .select()
          .from(replays)
          .where(and(eq(replays.userId, userId), eq(replays.mutationKey, input.mutationKey)));
        if (repeat) {
          if (
            repeat.previewId !== input.previewId.toLowerCase() ||
            repeat.ownerEpoch !== input.ownerEpoch
          )
            throw new AppError("conflict", "This mutation key was used for another request.");
          const op = await ownedOperation(tx, userId, repeat.operationId);
          return operationReceipt(op, repeat.recordId);
        }
        const [preview] = await tx
          .select()
          .from(previews)
          .where(and(eq(previews.userId, userId), eq(previews.id, input.previewId)));
        if (!preview) throw new AppError("not_found", "The forget preview was not found.");
        await assertMutationKeyUnused(tx, userId, input.mutationKey);
        const erased = await priorErasure(tx, userId, preview.recordId);
        if (erased) {
          if (preview.epoch !== input.ownerEpoch)
            throw new AppError("conflict", "The forget preview changed. Open a fresh preview.");
          await tx.insert(replays).values({
            userId,
            mutationKey: input.mutationKey,
            previewId: preview.id,
            ownerEpoch: input.ownerEpoch,
            operationId: erased.id,
            recordId: preview.recordId,
          });
          return operationReceipt(erased, preview.recordId);
        }
        const epoch = await readKnowledgeEpoch(tx, userId);
        if (preview.epoch !== input.ownerEpoch || epoch !== input.ownerEpoch)
          throw new AppError("conflict", "The forget preview changed. Open a fresh preview.");
        await assertKnowledgeContentAvailable(tx, userId);
        if (!validKnowledgeForgetKey(suppressionKey))
          throw new AppError(
            "service_unavailable",
            "Knowledge forgetting is temporarily unavailable.",
          );
        await assertKnowledgeForgetKey(tx, userId, suppressionKey);
        const nextEpoch = await bumpKnowledgeEpoch(tx, userId);
        if (nextEpoch !== input.ownerEpoch + 1)
          throw new AppError("conflict", "The forget preview changed. Open a fresh preview.");
        const [op] = await tx
          .insert(operations)
          .values({
            id: randomUUID(),
            userId,
            recordId: preview.recordId,
            previewId: preview.id,
            mutationKey: input.mutationKey,
            epoch: nextEpoch,
            keyProof: knowledgeForgetKeyProof(suppressionKey, userId),
            phase: "plan",
            status: "pending",
            dueAt: now(),
          })
          .returning();
        if (!op) throw new AppError("internal_error", "The forget operation was not saved.");
        await tx.insert(auditEvents).values(
          auditValues({
            action: "knowledge.forget_requested",
            entityType: "knowledge",
            entityId: op.recordId,
            principal,
            requestId: input.mutationKey,
            before: null,
            after: { operationId: op.id, status: op.status },
          }),
        );
        return operationReceipt(op);
      });
    },

    async active(principal: Principal) {
      requireKnowledgeOwner(principal);
      return db.transaction(async (tx) => {
        await lockKnowledgeOwner(tx, principal.userId, "read");
        await requireLiveKnowledgeHumanSession(tx, principal, now());
        const rows = await tx
          .select({ operationId: operations.id, status: operations.status })
          .from(operations)
          .where(
            and(
              eq(operations.userId, principal.userId),
              or(eq(operations.status, "pending"), eq(operations.status, "blocked")),
            ),
          )
          .limit(1);
        return activeKnowledgeForgetOperationsSchema.parse(rows);
      });
    },

    async status(
      principal: Principal,
      raw: KnowledgeForgetOperationInput,
    ): Promise<KnowledgeForgetStatus> {
      requireKnowledgeOwner(principal);
      const { operationId } = knowledgeForgetOperationInputSchema.parse(raw);
      const op = await db.transaction(async (tx) => {
        await lockKnowledgeOwner(tx, principal.userId, "read");
        await requireLiveKnowledgeHumanSession(tx, principal, now());
        return ownedOperation(tx, principal.userId, operationId);
      });
      return { operationId, status: op.status };
    },

    async retry(
      principal: Principal,
      raw: KnowledgeForgetOperationInput,
    ): Promise<KnowledgeForgetStatus> {
      requireKnowledgeOwner(principal);
      const { operationId } = knowledgeForgetOperationInputSchema.parse(raw);
      return db.transaction(async (tx) => {
        await lockKnowledgeOwner(tx, principal.userId);
        await requireLiveKnowledgeHumanSession(tx, principal, now());
        const op = await ownedOperation(tx, principal.userId, operationId);
        if (op.status !== "blocked") return { operationId, status: op.status };
        await tx
          .update(operations)
          .set({
            status: "pending",
            failures: 0,
            dueAt: now(),
            ...leaseReleased,
          })
          .where(and(eq(operations.userId, op.userId), eq(operations.id, op.id)));
        return { operationId, status: "pending" };
      });
    },

    /** One due owner at a time, with at most one batch of each local phase per pass. */
    async runOnce({ signal }: { signal?: AbortSignal } = {}): Promise<boolean> {
      const claimed = await claim(signal);
      if (!claimed) return false;
      if (
        !validKnowledgeForgetKey(suppressionKey) ||
        claimed.keyProof !== knowledgeForgetKeyProof(suppressionKey, claimed.userId)
      ) {
        await deferOrComplete(claimed, signal, false);
        return true;
      }
      const key = suppressionKey;
      try {
        await withLease(claimed, signal, async (tx, op) => {
          if (op.phase === "plan") await planForgetErasure(tx, op);
        });
        await withLease(claimed, signal, async (tx, op) => {
          if (op.phase === "erase") await eraseForgetBatch(tx, op, key);
        });
        await withLease(claimed, signal, async (tx, op) => {
          if (op.phase === "scrub") await scrubForgetBatch(tx, op);
        });
        const handoff = await withLease(claimed, signal, async (tx, op) => {
          const match = and(eq(operations.userId, op.userId), eq(operations.id, op.id));
          if (op.phase !== "ledger") {
            await tx
              .update(operations)
              .set({ dueAt: now(), ...leaseReleased })
              .where(match);
            return;
          }
          const batch = await tx
            .select({ id: targets.recordId })
            .from(targets)
            .where(
              and(
                eq(targets.userId, op.userId),
                eq(targets.operationId, op.id),
                eq(targets.erased, true),
              ),
            )
            .orderBy(asc(targets.recordId));
          const entry = {
            operationId: op.id,
            ownerId: op.userId,
            epoch: op.epoch,
            recordIds: batch.map(({ id }) => id),
            suppressionFingerprints: [...op.suppressionFingerprints],
          };
          const at = now();
          if (!op.leaseUntil || op.leaseUntil <= at || signal?.aborted) return;
          const leaseUntil = at.getTime() + leaseMs;
          await tx
            .update(operations)
            .set({ leaseUntil: new Date(leaseUntil) })
            .where(match);
          return { entry, leaseUntil };
        });
        const at = now().getTime();
        if (handoff && handoff.leaseUntil - at >= ledgerTimeoutMs) {
          const verified = await verifyLedger(
            ledger,
            handoff.entry,
            signal,
            Math.min(handoff.leaseUntil, at + ledgerTimeoutMs),
            now,
          );
          await deferOrComplete(claimed, signal, verified);
        }
      } catch {
        // Leave durable work eligible for repair and never surface a query's content or parameters.
        await deferOrComplete(claimed, signal, false).catch(() => {
          throw new Error("Knowledge forget worker could not record its retry state.");
        });
      }
      return true;
    },
  };
}
