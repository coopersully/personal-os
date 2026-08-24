import { createHash } from "node:crypto";
import {
  auditEvents,
  type Database,
  financeAccounts,
  financeCategories,
  financeClassificationDecisions,
  financeEconomicEvents,
  financeEventTransactions,
  financeTransactionRelationships,
  financeTransactionRevisions,
  financeTransactions,
} from "@personal-os/database";
import type { FinanceToolResult, FinanceTransaction } from "@personal-os/domain";
import { and, desc, eq, inArray } from "drizzle-orm";
import { AppError } from "../errors.js";
import { executeFinanceIdempotently, type FinanceMutationContext } from "./context.js";

type Classification = {
  categoryId: string;
  confidence: number;
  meaning: string;
  rationale: string;
  transactionId: string;
};

function result<T>(
  data: T,
  headline: string,
  changes: FinanceToolResult<T>["changes"] = [],
): FinanceToolResult<T> {
  return {
    changes,
    communication: { headline, optionalDetails: [], requiredDisclosures: [] },
    data,
    outcome: "completed",
    remainingWork: { categories: [], count: 0 },
    schemaVersion: 1,
  };
}

function transaction(row: typeof financeTransactions.$inferSelect): FinanceTransaction {
  return {
    accountId: row.accountId,
    amount: row.amount / 100,
    category: row.category,
    categoryConfidence: row.categoryConfidence === null ? null : row.categoryConfidence / 10_000,
    categoryId: row.categoryId,
    categoryRationale: row.categoryRationale,
    categorySource: row.categorySource,
    createdAt: row.createdAt.toISOString(),
    currencyCode: row.currencyCode,
    date: row.transactionDate,
    direction: row.direction,
    id: row.id,
    merchant: row.merchant,
    merchantId: row.merchantId,
    needsReview: row.needsReview,
    notes: row.notes,
    pending: row.pending,
    providerCategory: row.providerCategory,
    providerCategoryConfidence:
      row.providerCategoryConfidence as FinanceTransaction["providerCategoryConfidence"],
    rawMerchant: row.merchant,
    reconciliationStatus: row.reconciliationStatus,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function transactionAudit(row: typeof financeTransactions.$inferSelect) {
  return {
    categoryConfidence: row.categoryConfidence === null ? null : row.categoryConfidence / 10_000,
    categoryId: row.categoryId,
    categorySource: row.categorySource,
    direction: row.direction,
    id: row.id,
    needsReview: row.needsReview,
    pending: row.pending,
    reconciliationStatus: row.reconciliationStatus,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function provenance(context: FinanceMutationContext, now: Date, confidence: number | null = null) {
  return {
    actorId: context.actorId,
    actorType: context.actorType,
    confidence,
    evidence: {},
    maintenanceRunId: null,
    observedAt: now.toISOString(),
    requestId: context.requestId,
    sourceId: null,
  };
}

export function createFinanceLedgerService(input: { db: Database; now: () => Date }) {
  const { db, now } = input;

  async function ownedTransaction(userId: string, id: string) {
    const [row] = await db
      .select()
      .from(financeTransactions)
      .where(and(eq(financeTransactions.id, id), eq(financeTransactions.userId, userId)))
      .limit(1);
    if (!row) throw new AppError("not_found", "The transaction was not found.");
    return row;
  }

  async function ownedCategory(userId: string, id: string) {
    const [row] = await db
      .select()
      .from(financeCategories)
      .where(and(eq(financeCategories.id, id), eq(financeCategories.userId, userId)))
      .limit(1);
    if (!row) throw new AppError("not_found", "The Finance category was not found.");
    return row;
  }

  return {
    async getTransaction(userId: string, id: string) {
      return result(transaction(await ownedTransaction(userId, id)), "Transaction loaded.");
    },

    async removeTransaction(id: string, idempotencyKey: string, context: FinanceMutationContext) {
      return executeFinanceIdempotently(
        db,
        context,
        { idempotencyKey, operation: "finance.transaction.remove", payload: { id } },
        async () => {
          const before = await ownedTransaction(context.userId, id);
          const [source] = await db
            .select({ provider: financeAccounts.provider })
            .from(financeAccounts)
            .where(eq(financeAccounts.id, before.accountId))
            .limit(1);
          if (source?.provider !== "manual") {
            throw new AppError(
              "invalid_request",
              "Provider transactions must be linked as duplicates or reversals so imported evidence is preserved.",
            );
          }
          await db.transaction(async (tx) => {
            await tx.delete(financeTransactions).where(eq(financeTransactions.id, id));
            await tx.insert(auditEvents).values({
              action: "finance.transaction_removed",
              actorId: context.actorId,
              actorType: context.actorType,
              after: null,
              before: transactionAudit(before),
              entityId: id,
              entityType: "finance_transaction",
              requestId: context.requestId,
              userId: context.userId,
            });
          });
          return result({ id, removed: true }, "Manual transaction removed.", [
            {
              affectedEntityId: id,
              description: "Removed an erroneous manual transaction.",
              reversible: false,
              type: "transaction_removed",
            },
          ]);
        },
      );
    },

    async classifyTransactions(
      classifications: Classification[],
      idempotencyKey: string,
      context: FinanceMutationContext,
    ) {
      return executeFinanceIdempotently(
        db,
        context,
        { idempotencyKey, operation: "finance.transaction.classify", payload: { classifications } },
        async () => {
          const changed: FinanceTransaction[] = [];
          for (const classification of classifications) {
            const [before, category] = await Promise.all([
              ownedTransaction(context.userId, classification.transactionId),
              ownedCategory(context.userId, classification.categoryId),
            ]);
            const decidedAt = now();
            const [updated] = await db
              .update(financeTransactions)
              .set({
                category: category.name,
                categoryConfidence: Math.round(classification.confidence * 10_000),
                categoryDecidedAt: decidedAt,
                categoryId: category.id,
                categoryRationale: `${classification.meaning}: ${classification.rationale}`,
                categorySource: context.actorType === "agent" ? "agent" : "user",
                needsReview: classification.confidence < 0.8,
                updatedAt: decidedAt,
              })
              .where(eq(financeTransactions.id, before.id))
              .returning();
            if (!updated)
              throw new AppError("internal_error", "The transaction could not be classified.");
            await db.insert(financeClassificationDecisions).values({
              categoryId: category.id,
              categoryName: category.name,
              confidence: Math.round(classification.confidence * 10_000),
              merchantId: before.merchantId,
              outcome:
                before.categoryId && before.categoryId !== category.id ? "corrected" : "applied",
              rationale: classification.rationale,
              source: context.actorType === "agent" ? "agent" : "user",
              transactionId: before.id,
              userId: context.userId,
            });
            changed.push(transaction(updated));
          }
          return result(
            changed,
            `Classified ${changed.length} transactions.`,
            changed.map((item) => ({
              affectedEntityId: item.id,
              description: "Applied a reasoned transaction classification.",
              reversible: true,
              type: "transaction_classified",
            })),
          );
        },
      );
    },

    async linkTransactions(
      input: {
        rationale: string;
        relationship: "transfer" | "reimbursement" | "refund" | "reversal" | "duplicate";
        transactionIds: string[];
        idempotencyKey: string;
      },
      context: FinanceMutationContext,
    ) {
      return executeFinanceIdempotently(
        db,
        context,
        {
          idempotencyKey: input.idempotencyKey,
          operation: "finance.transaction.link",
          payload: input,
        },
        async () => {
          const ids = [...new Set(input.transactionIds)].toSorted();
          if (ids.length < 2)
            throw new AppError(
              "invalid_request",
              "Choose at least two different transactions to link.",
            );
          await Promise.all(ids.map((id) => ownedTransaction(context.userId, id)));
          const stableKey = `${input.relationship}:${createHash("sha256").update(ids.join(":")).digest("hex")}`;
          const timestamp = now();
          const linked = await db.transaction(async (tx) => {
            const [event] = await tx
              .insert(financeEconomicEvents)
              .values({ kind: input.relationship, stableKey, userId: context.userId })
              .onConflictDoUpdate({
                set: { updatedAt: timestamp },
                target: [financeEconomicEvents.userId, financeEconomicEvents.stableKey],
              })
              .returning();
            if (!event)
              throw new AppError("internal_error", "The economic event could not be created.");
            await tx
              .insert(financeEventTransactions)
              .values(
                ids.map((transactionId) => ({
                  economicEventId: event.id,
                  transactionId,
                  userId: context.userId,
                })),
              )
              .onConflictDoNothing();
            const [relationship] = await tx
              .insert(financeTransactionRelationships)
              .values({
                economicEventId: event.id,
                provenance: provenance(context, timestamp),
                rationale: input.rationale,
                relationship: input.relationship,
                transactionIds: ids,
                userId: context.userId,
              })
              .returning();
            await tx
              .update(financeTransactions)
              .set({ reconciliationStatus: "matched", updatedAt: timestamp })
              .where(inArray(financeTransactions.id, ids));
            return relationship;
          });
          return result(
            linked,
            `Linked ${ids.length} transactions as ${input.relationship}.`,
            ids.map((id) => ({
              affectedEntityId: id,
              description: `Linked as one ${input.relationship} economic event.`,
              reversible: true,
              type: "transaction_linked",
            })),
          );
        },
      );
    },

    async splitTransaction(
      input: {
        expectedVersion: number;
        idempotencyKey: string;
        parts: Array<{ amount: number; categoryId: string; meaning: string; notes: string | null }>;
        transactionId: string;
      },
      context: FinanceMutationContext,
    ) {
      return executeFinanceIdempotently(
        db,
        context,
        {
          idempotencyKey: input.idempotencyKey,
          operation: "finance.transaction.split",
          payload: input,
        },
        async () => {
          const original = await ownedTransaction(context.userId, input.transactionId);
          const [latest] = await db
            .select({ version: financeTransactionRevisions.version })
            .from(financeTransactionRevisions)
            .where(eq(financeTransactionRevisions.transactionId, original.id))
            .orderBy(desc(financeTransactionRevisions.version))
            .limit(1);
          const version = latest?.version ?? 1;
          if (input.expectedVersion !== version)
            throw new AppError(
              "conflict",
              `The transaction changed; retry with expectedVersion ${version}.`,
            );
          const cents = input.parts.map((part) => Math.round(part.amount * 100));
          if (cents.reduce((sum, amount) => sum + amount, 0) !== original.amount)
            throw new AppError(
              "invalid_request",
              "Split part amounts must exactly equal the original transaction amount.",
            );
          const categories = await Promise.all(
            input.parts.map((part) => ownedCategory(context.userId, part.categoryId)),
          );
          const timestamp = now();
          const splitValues: Array<typeof financeTransactions.$inferInsert> = input.parts.map(
            (part, index) => {
              const amount = cents[index];
              const category = categories[index];
              if (amount === undefined || !category) {
                throw new AppError("internal_error", "The split parts could not be prepared.");
              }
              return {
                accountId: original.accountId,
                amount,
                category: category.name,
                categoryConfidence: 10_000,
                categoryDecidedAt: timestamp,
                categoryId: category.id,
                categoryRationale: part.meaning,
                categorySource: context.actorType === "agent" ? "agent" : "user",
                direction: original.direction,
                merchant: original.merchant,
                merchantId: original.merchantId,
                needsReview: false,
                notes: part.notes,
                reconciliationStatus: "matched",
                transactionDate: original.transactionDate,
                userId: context.userId,
              };
            },
          );
          const parts = await db.transaction(async (tx) => {
            const created = await tx.insert(financeTransactions).values(splitValues).returning();
            const stableKey = `split:${original.id}`;
            const [event] = await tx
              .insert(financeEconomicEvents)
              .values({ kind: "split", stableKey, userId: context.userId })
              .onConflictDoUpdate({
                set: { updatedAt: timestamp },
                target: [financeEconomicEvents.userId, financeEconomicEvents.stableKey],
              })
              .returning();
            if (!event)
              throw new AppError("internal_error", "The split event could not be created.");
            const ids = [original.id, ...created.map((item) => item.id)];
            await tx
              .insert(financeEventTransactions)
              .values(
                ids.map((transactionId) => ({
                  economicEventId: event.id,
                  transactionId,
                  userId: context.userId,
                })),
              )
              .onConflictDoNothing();
            await tx.insert(financeTransactionRelationships).values({
              economicEventId: event.id,
              provenance: provenance(context, timestamp),
              rationale: "Transaction split across budget categories.",
              relationship: "split",
              transactionIds: ids,
              userId: context.userId,
            });
            await tx
              .update(financeTransactions)
              .set({
                category: "Split",
                categoryId: null,
                categoryRationale: "Replaced by linked split parts.",
                categorySource: context.actorType === "agent" ? "agent" : "user",
                direction: "transfer",
                needsReview: false,
                reconciliationStatus: "matched",
                updatedAt: timestamp,
              })
              .where(eq(financeTransactions.id, original.id));
            await tx.insert(financeTransactionRevisions).values({
              changes: { splitPartIds: created.map((item) => item.id) },
              provenance: provenance(context, timestamp),
              transactionId: original.id,
              userId: context.userId,
              version: version + 1,
            });
            return created.map(transaction);
          });
          return result(parts, `Split the transaction into ${parts.length} balanced parts.`, [
            {
              affectedEntityId: original.id,
              description: "Split the original transaction without losing its lineage.",
              reversible: true,
              type: "transaction_split",
            },
          ]);
        },
      );
    },
  };
}
