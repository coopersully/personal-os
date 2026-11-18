import { createHash } from "node:crypto";
import type {
  financeBudgetAllocations,
  financeBudgetVersions,
  financeConversationMessages,
  financeReviewBatchRuns,
  financeReviewCases,
  financeTransactions,
} from "@personal-os/database";
import {
  addLocalDays,
  financeReviewBatchDecisionSchema,
  localDateAt,
  localDateToIso,
} from "@personal-os/domain";

/** Local demo only. No grants, live sources, execution or approval are seeded. */
export function fixtureFinanceConversationPreview(
  userId: string,
  now: Date,
  id: (record: number) => string,
  {
    budget,
    allocations,
  }: {
    budget: typeof financeBudgetVersions.$inferInsert;
    allocations: Array<typeof financeBudgetAllocations.$inferInsert>;
  },
) {
  const budgetVersionId = id(9020);
  const actorId = id(9021);
  const batchId = id(9022);
  const proposal = {
    ...budget,
    id: budgetVersionId,
    version: 2,
    status: "proposed",
    assumptions: [...(budget.assumptions ?? []), "Keep an extra $100 in the cash buffer."],
    rationale: "Move $100 from long-term investing to the cash buffer for this month.",
    createdByActorType: "agent",
    createdByActorId: actorId,
    approvedByActorType: null,
    approvedByActorId: null,
    approvedAt: null,
  } satisfies typeof financeBudgetVersions.$inferInsert;
  const proposalAllocations = allocations.map((allocation, index) => ({
    ...allocation,
    id: id(9040 + index),
    budgetVersionId,
    amount:
      allocation.amount +
      (allocation.allocationKey === "buffer"
        ? 10_000
        : allocation.allocationKey === "investing"
          ? -10_000
          : 0),
  }));
  const shared = {
    userId,
    amount: 37_500,
    currencyCode: "USD",
    direction: "transfer" as const,
    // Categorization is settled; the review concerns only the pairing.
    category: "Transfers",
    categoryConfidence: 10_000,
    categorySource: "user" as const,
    // The posted pair is already reflected in today's demo cash bases.
    transactionDate: localDateToIso(addLocalDays(localDateAt(now, "America/New_York"), -1)),
    needsReview: true,
    reconciliationStatus: "candidate" as const,
    createdAt: now,
    updatedAt: now,
  };
  const transactions = [
    {
      ...shared,
      id: id(9023),
      accountId: id(400),
      merchant: "Savings transfer debit",
      providerDirection: "expense",
      providerCategory: "TRANSFER_OUT",
    },
    {
      ...shared,
      id: id(9024),
      accountId: id(401),
      merchant: "Checking transfer credit",
      providerDirection: "income",
      providerCategory: "TRANSFER_IN",
    },
  ] satisfies Array<typeof financeTransactions.$inferInsert>;
  const reviews = transactions.map((transaction, index) => ({
    id: id(9025 + index),
    userId,
    transactionId: transaction.id,
    reason: "possible_transfer" as const,
    status: "open" as const,
    rationale: "Two posted entries show equal and opposite movement between owned accounts.",
    createdAt: now,
    updatedAt: now,
  })) satisfies Array<typeof financeReviewCases.$inferInsert>;
  const manifest = reviews.map((review, index) => ({
    decision: financeReviewBatchDecisionSchema.parse({
      kind: "review",
      reviewId: review.id,
      transactionId: review.transactionId,
      action: "confirm_transfer",
      expectedTransactionUpdatedAt: now.toISOString(),
      expectedTransactionRevision: "1",
      expectedReviewUpdatedAt: now.toISOString(),
      expectedReviewRevision: "1",
      expectedActionRevision: "0",
      rationale: review.rationale,
      evidence: "Checking shows $375 out and savings shows $375 in on the same date.",
      confidence: 1,
    }),
    transferCounterpart: { transactionId: id(index === 0 ? 9024 : 9023), revision: "1" },
  }));
  const batch = {
    id: batchId,
    userId,
    actorType: "agent",
    actorId,
    idempotencyKey: "fixture-finance-transfer-preview",
    fingerprint: `sha256:${createHash("sha256").update(JSON.stringify(manifest)).digest("hex")}`,
    manifest,
    createdAt: now,
    updatedAt: now,
  } satisfies typeof financeReviewBatchRuns.$inferInsert;
  const recordRefs: NonNullable<(typeof financeConversationMessages.$inferInsert)["recordRefs"]> = [
    { kind: "budget_plan", id: budget.planId, budgetVersionId },
    { kind: "review_batch", id: batchId },
    { kind: "transaction", id: id(9023) },
    { kind: "transaction", id: id(9024) },
    { kind: "account", id: id(401) },
    { kind: "review_case", id: id(9025) },
  ];
  return { proposal, proposalAllocations, transactions, reviews, batch, recordRefs };
}
