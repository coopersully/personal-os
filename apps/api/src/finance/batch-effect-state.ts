import { createHash } from "node:crypto";
import {
  auditEvents,
  type Database,
  financeAccounts,
  financeClassificationDecisions,
  financeReviewCases,
  financeTransactionAllocations,
  financeTransactions,
} from "@personal-os/database";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { auditValues } from "../audit.js";
import { AppError } from "../errors.js";
import { lockReimbursementTopology } from "../finance-reimbursement-locks.js";
import type { Principal } from "../types.js";

type Executor = Pick<Database, "select" | "update" | "insert" | "execute">;
const fingerprint = (value: unknown) =>
  createHash("sha256")
    .update(
      JSON.stringify(value, (_key, field) =>
        typeof field === "bigint" ? field.toString() : field,
      ),
    )
    .digest("hex");
const stateSchema = z.object({
  fingerprint: z.string(),
  classificationIds: z.array(z.uuid()),
  transactions: z
    .array(
      z.object({
        id: z.uuid(),
        categoryId: z.uuid().nullable(),
        category: z.string().nullable(),
        categoryConfidence: z.number().nullable(),
        categorySource: z.enum(["agent", "provider", "rule", "user"]).nullable(),
        categoryRationale: z.string().nullable(),
        categoryDecidedAt: z.iso.datetime().nullable(),
        direction: z.enum(["expense", "income", "transfer"]),
        needsReview: z.boolean(),
        reconciliationStatus: z.enum(["candidate", "confirmed", "matched", "not_applicable"]),
        transferGroupId: z.uuid().nullable(),
      }),
    )
    .min(1)
    .max(2),
  allocations: z.array(
    z.object({
      transactionId: z.uuid(),
      categoryId: z.uuid(),
      amount: z.number().int().positive(),
      allocationOrder: z.number().int().nonnegative(),
      treatment: z.enum(["personal", "reimbursable"]),
      rationale: z.string().nullable(),
    }),
  ),
  reviews: z.array(
    z.object({
      id: z.uuid(),
      status: z.enum(["open", "deferred", "resolved"]),
      resolvedAt: z.iso.datetime().nullable(),
    }),
  ),
});
export type FinanceBatchEffectState = z.infer<typeof stateSchema>;
export async function captureFinanceBatchEffect(
  tx: Executor,
  userId: string,
  ids: string[],
  lock = false,
): Promise<FinanceBatchEffectState> {
  if (!ids.length || ids.length > 2 || new Set(ids).size !== ids.length)
    throw new AppError("invalid_request", "Choose one effect or one transfer pair.");
  if (lock) {
    await tx
      .select({ id: financeAccounts.id })
      .from(financeAccounts)
      .where(eq(financeAccounts.userId, userId))
      .orderBy(financeAccounts.id)
      .for("update");
    await lockReimbursementTopology(tx, userId);
  }
  const query = tx
    .select()
    .from(financeTransactions)
    .where(and(eq(financeTransactions.userId, userId), inArray(financeTransactions.id, ids)))
    .orderBy(financeTransactions.id);
  const transactions = await (lock ? query.for("update") : query);
  if (transactions.length !== ids.length)
    throw new AppError("not_found", "The original batch transactions are no longer available.");
  const allocations = await tx
    .select()
    .from(financeTransactionAllocations)
    .where(
      and(
        eq(financeTransactionAllocations.userId, userId),
        inArray(financeTransactionAllocations.transactionId, ids),
        eq(financeTransactionAllocations.state, "active"),
      ),
    )
    .orderBy(financeTransactionAllocations.id);
  const reviews = await tx
    .select()
    .from(financeReviewCases)
    .where(
      and(eq(financeReviewCases.userId, userId), inArray(financeReviewCases.transactionId, ids)),
    )
    .orderBy(financeReviewCases.id);
  const classifications = await tx
    .select()
    .from(financeClassificationDecisions)
    .where(
      and(
        eq(financeClassificationDecisions.userId, userId),
        inArray(financeClassificationDecisions.transactionId, ids),
      ),
    )
    .orderBy(financeClassificationDecisions.id);
  const digest = fingerprint({ transactions, allocations, reviews, classifications });
  return stateSchema.parse({
    fingerprint: digest,
    classificationIds: classifications.map((row) => row.id),
    transactions: transactions.map((row) => ({
      ...row,
      categoryDecidedAt: row.categoryDecidedAt?.toISOString() ?? null,
    })),
    allocations,
    reviews: reviews.map((row) => ({ ...row, resolvedAt: row.resolvedAt?.toISOString() ?? null })),
  });
}
export function parseFinanceBatchEffect(raw: unknown) {
  return stateSchema.parse(raw);
}

/** Trusted persisted receipt only. Preserve history and advance revisions; never reset generations. */
export async function restoreFinanceBatchEffect(
  tx: Executor,
  beforeRaw: unknown,
  afterRaw: unknown,
  context: { principal: Principal; requestId: string },
  at: Date,
  assertAllocationsMayBeReplaced: (id: string) => Promise<void>,
) {
  const before = stateSchema.parse(beforeRaw);
  const after = stateSchema.parse(afterRaw);
  const ids = before.transactions.map((row) => row.id);
  if (JSON.stringify(ids) !== JSON.stringify(after.transactions.map((row) => row.id)))
    throw new AppError("conflict", "The effect receipt is inconsistent.");
  const current = await captureFinanceBatchEffect(tx, context.principal.userId, ids, true);
  if (current.fingerprint !== after.fingerprint)
    throw new AppError(
      "conflict",
      "This item changed after the batch. Review a new correction instead.",
    );
  for (const id of ids) await assertAllocationsMayBeReplaced(id);
  const addedClassifications = after.classificationIds.filter(
    (id) => !before.classificationIds.includes(id),
  );
  if (addedClassifications.length)
    await tx
      .update(financeClassificationDecisions)
      .set({ retractedAt: at })
      .where(
        and(
          eq(financeClassificationDecisions.userId, context.principal.userId),
          inArray(financeClassificationDecisions.id, addedClassifications),
        ),
      );
  // Retain replaced allocations as historical evidence instead of deleting the newer result.
  await tx
    .update(financeTransactionAllocations)
    .set({ state: "invalidated", invalidatedAt: at, updatedAt: at })
    .where(
      and(
        eq(financeTransactionAllocations.userId, context.principal.userId),
        inArray(financeTransactionAllocations.transactionId, ids),
        eq(financeTransactionAllocations.state, "active"),
      ),
    );
  for (const row of before.transactions) {
    const { id, categoryDecidedAt, ...fields } = row;
    await tx
      .update(financeTransactions)
      .set({
        ...fields,
        categoryDecidedAt: categoryDecidedAt ? new Date(categoryDecidedAt) : null,
        updatedAt: at,
      })
      .where(
        and(
          eq(financeTransactions.id, id),
          eq(financeTransactions.userId, context.principal.userId),
        ),
      );
  }
  if (before.allocations.length)
    await tx.insert(financeTransactionAllocations).values(
      before.allocations.map((row) => ({
        ...row,
        userId: context.principal.userId,
        createdAt: at,
        updatedAt: at,
      })),
    );
  for (const row of before.reviews)
    await tx
      .update(financeReviewCases)
      .set({
        status: row.status,
        resolvedAt: row.resolvedAt ? new Date(row.resolvedAt) : null,
        updatedAt: at,
      })
      .where(
        and(
          eq(financeReviewCases.id, row.id),
          eq(financeReviewCases.userId, context.principal.userId),
        ),
      );
  await tx.insert(auditEvents).values(
    auditValues({
      action: "finance.batch_effect_corrected",
      entityType: "finance_transaction",
      entityId: ids[0] ?? "",
      before: { fingerprint: after.fingerprint },
      after: { restoredFrom: before.fingerprint, transactionIds: ids },
      ...context,
    }),
  );
}
