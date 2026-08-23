import {
  type Database,
  financeCategories,
  financeClassificationDecisions,
  financeEventTransactions,
  financeReviewCases,
  financeTransactionRelationships,
  financeTransactionRevisions,
  financeTransactions,
} from "@personal-os/database";
import type {
  AnswerFinanceReviewInput,
  FinanceChange,
  FinanceInboxCase,
  FinanceReviewReason,
  FinanceToolResult,
} from "@personal-os/domain";
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { AppError, isUniqueViolation } from "../errors.js";
import { executeFinanceIdempotently, type FinanceMutationContext } from "./context.js";

type Options = { db: Database; now: () => Date };
type ReviewFinding = {
  economicEventId: string;
  evidence: Record<string, unknown>;
  impactAmount: number;
  proposedResolution?: Record<string, unknown> | null;
  reason: FinanceReviewReason;
  transactionId: string;
  userId: string;
};

function fromCents(amount: number): number {
  return amount / 100;
}

function toCents(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100);
}

function caseValue(row: typeof financeReviewCases.$inferSelect): FinanceInboxCase {
  if (!row.economicEventId)
    throw new AppError("internal_error", "A Finance Inbox case lost its event.");
  return {
    economicEventId: row.economicEventId,
    evidence: row.evidence,
    firstSeenAt: row.firstSeenAt.toISOString(),
    id: row.id,
    impactAmount: fromCents(row.impactAmount),
    lastSeenAt: row.lastSeenAt.toISOString(),
    proposedResolution: row.proposedResolution,
    reason: row.reasonCode,
    reopenedFromId: row.reopenedFromId,
    resolution: row.resolution,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    stableKey: row.stableKey,
    status: row.status,
  };
}

export function financeReviewPrompt(
  reason: FinanceReviewReason,
  evidence: Record<string, unknown>,
): string {
  const merchant = typeof evidence.merchant === "string" ? ` at ${evidence.merchant}` : "";
  const prompts: Record<FinanceReviewReason, string> = {
    budget_variance: "Was this budget variance expected, and should the budget change?",
    category_ambiguity: `What did this transaction${merchant} represent?`,
    merchant_identity: `What was this transaction${merchant} for?`,
    missing_provenance: "What is the source and purpose of this transaction?",
    possible_duplicate: "Are these charges duplicates, or are both legitimate?",
    possible_transfer: "Was this movement a transfer between your own accounts?",
    profile_fact: "What should this financial profile fact be?",
    recurring_status: "Is this still a recurring obligation?",
    refund_or_reversal: "Was this transaction a refund or reversal of another charge?",
    reimbursement: "Which expense did this reimbursement offset?",
    source_freshness: "Does this account need to be reconnected or updated manually?",
    unusual_amount: `Was this unusually large transaction${merchant} expected and legitimate?`,
  };
  return prompts[reason];
}

function prompt(row: typeof financeReviewCases.$inferSelect): string {
  return financeReviewPrompt(row.reasonCode, row.evidence);
}

function inboxResult(
  rows: Array<typeof financeReviewCases.$inferSelect>,
  headline: string,
  changes: FinanceChange[] = [],
): FinanceToolResult<FinanceInboxCase[]> {
  const first = rows[0];
  return {
    changes,
    communication: {
      headline,
      ...(first
        ? { nextQuestion: { answerType: "text", id: first.id, prompt: prompt(first) } }
        : {}),
      optionalDetails: [],
      requiredDisclosures: [],
    },
    data: rows.map(caseValue),
    outcome: first ? "user_input_required" : "completed",
    remainingWork: { categories: first ? ["finance_inbox"] : [], count: rows.length },
    schemaVersion: 1,
  };
}

export function createInboxService({ db, now }: Options) {
  async function activeRows(userId: string) {
    return db
      .select()
      .from(financeReviewCases)
      .where(
        and(
          eq(financeReviewCases.userId, userId),
          inArray(financeReviewCases.status, ["open", "deferred"]),
          isNotNull(financeReviewCases.economicEventId),
        ),
      )
      .orderBy(desc(financeReviewCases.impactAmount), asc(financeReviewCases.firstSeenAt));
  }

  return {
    async upsertFinanceReview(input: ReviewFinding) {
      const stableKey = `${input.economicEventId}:${input.reason}`;
      const existing = await db.query.financeReviewCases.findFirst({
        where: and(
          eq(financeReviewCases.userId, input.userId),
          eq(financeReviewCases.stableKey, stableKey),
          inArray(financeReviewCases.status, ["open", "deferred"]),
        ),
      });
      if (existing) {
        const [updated] = await db
          .update(financeReviewCases)
          .set({
            evidence: input.evidence,
            impactAmount: toCents(input.impactAmount),
            lastSeenAt: now(),
            proposedResolution: input.proposedResolution ?? null,
            updatedAt: now(),
          })
          .where(eq(financeReviewCases.id, existing.id))
          .returning();
        if (!updated) throw new AppError("internal_error", "The Finance review was not updated.");
        return caseValue(updated);
      }
      try {
        const [created] = await db
          .insert(financeReviewCases)
          .values({
            economicEventId: input.economicEventId,
            evidence: input.evidence,
            impactAmount: toCents(input.impactAmount),
            proposedResolution: input.proposedResolution ?? null,
            reasonCode: input.reason,
            stableKey,
            transactionId: input.transactionId,
            userId: input.userId,
          })
          .returning();
        if (!created) throw new AppError("internal_error", "The Finance review was not created.");
        await db
          .insert(financeEventTransactions)
          .values({
            economicEventId: input.economicEventId,
            transactionId: input.transactionId,
            userId: input.userId,
          })
          .onConflictDoNothing();
        return caseValue(created);
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        const concurrent = await db.query.financeReviewCases.findFirst({
          where: and(
            eq(financeReviewCases.userId, input.userId),
            eq(financeReviewCases.stableKey, stableKey),
            inArray(financeReviewCases.status, ["open", "deferred"]),
          ),
        });
        if (!concurrent) throw error;
        return caseValue(concurrent);
      }
    },

    async getFinanceInbox(userId: string) {
      const rows = await activeRows(userId);
      return inboxResult(
        rows,
        rows.length ? `${rows.length} transactions need review.` : "Your Finance Inbox is clear.",
      );
    },

    async answerFinanceReview(
      caseId: string,
      input: AnswerFinanceReviewInput,
      context: FinanceMutationContext,
    ) {
      return executeFinanceIdempotently(
        db,
        context,
        {
          idempotencyKey: input.idempotencyKey,
          operation: "answer_finance_review",
          payload: { caseId, ...input },
        },
        async () => {
          const change = await db.transaction(async (tx) => {
            const review = await tx.query.financeReviewCases.findFirst({
              where: and(
                eq(financeReviewCases.id, caseId),
                eq(financeReviewCases.userId, context.userId),
              ),
            });
            if (!review) throw new AppError("not_found", "That Finance Inbox case was not found.");
            if (review.status === "resolved")
              throw new AppError("conflict", "That Finance Inbox case is already resolved.");
            if (input.resolution.type === "clarify") {
              await tx
                .update(financeReviewCases)
                .set({
                  evidence: { ...review.evidence, clarification: input.resolution.clarification },
                  lastSeenAt: now(),
                  updatedAt: now(),
                })
                .where(eq(financeReviewCases.id, review.id));
              return null;
            }
            if (
              input.resolution.type === "classify_transaction" ||
              input.resolution.type === "confirm_classification"
            ) {
              const category = await tx.query.financeCategories.findFirst({
                where: and(
                  eq(financeCategories.id, input.resolution.categoryId),
                  eq(financeCategories.userId, context.userId),
                ),
              });
              if (!category) throw new AppError("invalid_request", "That category was not found.");
              const transaction = await tx.query.financeTransactions.findFirst({
                where: and(
                  eq(financeTransactions.id, review.transactionId),
                  eq(financeTransactions.userId, context.userId),
                ),
              });
              if (!transaction)
                throw new AppError("not_found", "The reviewed transaction was not found.");
              const revisionCounts = await tx
                .select({ count: sql<number>`count(*)::integer` })
                .from(financeTransactionRevisions)
                .where(eq(financeTransactionRevisions.transactionId, transaction.id));
              await tx.insert(financeTransactionRevisions).values({
                changes: { category: { after: category.name, before: transaction.category } },
                provenance: {
                  actorId: context.actorId,
                  actorType: context.actorType,
                  requestId: context.requestId,
                  source: "inbox_answer",
                },
                transactionId: transaction.id,
                userId: context.userId,
                version: (revisionCounts[0]?.count ?? 0) + 1,
              });
              await tx
                .update(financeTransactions)
                .set({
                  category: category.name,
                  categoryConfidence: 10_000,
                  categoryDecidedAt: now(),
                  categoryId: category.id,
                  categoryRationale: input.answer,
                  categorySource: context.actorType,
                  needsReview: false,
                  updatedAt: now(),
                })
                .where(eq(financeTransactions.id, transaction.id));
              await tx.insert(financeClassificationDecisions).values({
                categoryId: category.id,
                categoryName: category.name,
                confidence: 10_000,
                outcome: "confirmed",
                rationale: input.answer,
                source: context.actorType,
                transactionId: transaction.id,
                userId: context.userId,
              });
            } else if (input.resolution.type === "link_transactions") {
              if (!review.economicEventId)
                throw new AppError("invalid_request", "The review has no economic event.");
              const related = await tx.query.financeTransactions.findFirst({
                where: and(
                  eq(financeTransactions.id, input.resolution.relatedTransactionId),
                  eq(financeTransactions.userId, context.userId),
                ),
              });
              if (!related)
                throw new AppError("invalid_request", "The related transaction was not found.");
              await tx.insert(financeTransactionRelationships).values({
                economicEventId: review.economicEventId,
                provenance: {
                  actorId: context.actorId,
                  actorType: context.actorType,
                  requestId: context.requestId,
                },
                rationale: input.answer,
                relationship: input.resolution.relationship,
                transactionIds: [review.transactionId, related.id],
                userId: context.userId,
              });
              await tx
                .insert(financeEventTransactions)
                .values({
                  economicEventId: review.economicEventId,
                  transactionId: related.id,
                  userId: context.userId,
                })
                .onConflictDoNothing();
            } else if (input.resolution.type === "update_profile") {
              throw new AppError(
                "invalid_request",
                "Use update_financial_profile for profile corrections.",
              );
            }
            await tx
              .update(financeReviewCases)
              .set({
                resolution: { answer: input.answer, ...input.resolution },
                resolutionProvenance: {
                  actorId: context.actorId,
                  actorType: context.actorType,
                  requestId: context.requestId,
                },
                resolvedAt: now(),
                resolvedByActorId: context.actorId,
                resolvedByActorType: context.actorType,
                status: "resolved",
                updatedAt: now(),
              })
              .where(eq(financeReviewCases.id, review.id));
            return {
              affectedEntityId: review.id,
              description: "Applied the answer and resolved the Finance Inbox case.",
              reversible: true,
              type: "finance_review_resolved",
            } satisfies FinanceChange;
          });
          const rows = await activeRows(context.userId);
          return inboxResult(
            rows,
            change
              ? "I applied that answer."
              : "I need one clarification before applying a change.",
            change ? [change] : [],
          );
        },
      );
    },
  };
}
