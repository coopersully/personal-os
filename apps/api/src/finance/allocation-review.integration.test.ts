import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  auditEvents,
  createDatabaseClient,
  type DatabaseClient,
  financeClassificationDecisions,
  financeMerchants,
  financeReimbursements,
  financeReviewCases,
  financeTransactionAllocations,
  financeTransactions,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { and, eq } from "drizzle-orm";
import { createFinanceService } from "../finance-service.js";
import type { Principal } from "../types.js";

describe.sequential("saved allocation review", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
  }, 120_000);
  afterAll(async () => {
    await database?.close();
    await container?.stop();
  });

  async function fixture(single = false) {
    const userId = randomUUID();
    await database.db.insert(users).values({
      id: userId,
      displayName: "Allocation owner",
      email: `${userId}@example.com`,
      passwordHash: "unused",
    });
    const principal: Principal = {
      actorId: userId,
      actorType: "user",
      userId,
      scopes: new Set(["finances:read", "finances:write"]),
    };
    const context = { principal, requestId: randomUUID() };
    const service = createFinanceService({ db: database.db, now: () => new Date() });
    const account = await service.createAccount(
      { balance: 100, provider: "manual", institution: "Manual", name: "Wallet" },
      context,
    );
    const categories = await service.listCategories(userId);
    if (!account || !categories[0] || !categories[1])
      throw new Error("Missing allocation fixtures.");
    const [transaction] = await database.db
      .insert(financeTransactions)
      .values({
        userId,
        accountId: account.id,
        amount: 8700,
        direction: "expense",
        merchant: "Storage receipt",
        transactionDate: "2026-11-02",
      })
      .returning();
    if (!transaction) throw new Error("Missing transaction.");
    const saved = await service.setTransactionBreakdown(
      transaction.id,
      {
        expectedTransactionUpdatedAt: transaction.updatedAt.toISOString(),
        rationale: "Itemized receipt.",
        allocations: single
          ? [
              {
                amount: 87,
                categoryId: categories[0].id,
                rationale: "Itemized expense",
                treatment: "reimbursable",
              },
            ]
          : [
              {
                amount: 78,
                categoryId: categories[0].id,
                rationale: "Rent",
                treatment: "personal",
              },
              {
                amount: 9,
                categoryId: categories[1].id,
                rationale: "Insurance",
                treatment: "reimbursable",
              },
            ],
      },
      context,
    );
    const allocations = await database.db
      .select()
      .from(financeTransactionAllocations)
      .where(eq(financeTransactionAllocations.transactionId, transaction.id))
      .orderBy(financeTransactionAllocations.id);
    const [review] = await database.db
      .insert(financeReviewCases)
      .values({
        userId,
        transactionId: transaction.id,
        reason: "unknown_merchant",
        reasonCode: "missing_provenance",
        rationale: "Prior missing category finding.",
      })
      .returning();
    if (!review) throw new Error("Missing review.");
    return {
      userId,
      context,
      service,
      transaction: saved,
      allocations,
      review,
      category: categories[0],
    };
  }

  it("backfill recognizes a complete saved split without rewriting an existing unrelated case", async () => {
    const f = await fixture();
    await database.db
      .update(financeReviewCases)
      .set({
        reason: "possible_duplicate",
        reasonCode: "possible_duplicate",
        rationale: "Inspect duplicate evidence.",
      })
      .where(eq(financeReviewCases.id, f.review.id));
    await f.service.backfillLearning(100);
    expect(
      await database.db
        .select()
        .from(financeTransactionAllocations)
        .where(eq(financeTransactionAllocations.transactionId, f.transaction.id))
        .orderBy(financeTransactionAllocations.id),
    ).toEqual(f.allocations);
    const [review] = await database.db
      .select()
      .from(financeReviewCases)
      .where(eq(financeReviewCases.id, f.review.id));
    expect(review).toMatchObject({
      reason: "possible_duplicate",
      reasonCode: "possible_duplicate",
      rationale: "Inspect duplicate evidence.",
      status: "open",
    });
  });

  it("an owner approves only the exact categorization case while preserving split history and other reasons", async () => {
    const f = await fixture();
    const [unrelated] = await database.db
      .insert(financeReviewCases)
      .values({
        userId: f.userId,
        transactionId: f.transaction.id,
        reason: "possible_duplicate",
        reasonCode: "possible_duplicate",
        rationale: "Unrelated duplicate check.",
      })
      .returning();
    const decisions = await database.db
      .select()
      .from(financeClassificationDecisions)
      .where(eq(financeClassificationDecisions.transactionId, f.transaction.id));
    const result = await f.service.resolveReview(
      f.review.id,
      {
        action: "approve",
        expectedTransactionUpdatedAt: f.transaction.updatedAt,
        learnMerchant: "never",
        rationale: "Keep the exact receipt breakdown.",
      },
      f.context,
    );
    expect(result).toMatchObject({
      applied: true,
      transaction: {
        categoryId: null,
        amount: 87,
        needsReview: true,
        allocations: f.transaction.allocations,
      },
    });
    expect(
      await database.db
        .select()
        .from(financeTransactionAllocations)
        .where(eq(financeTransactionAllocations.transactionId, f.transaction.id))
        .orderBy(financeTransactionAllocations.id),
    ).toEqual(f.allocations);
    expect(
      await database.db
        .select()
        .from(financeClassificationDecisions)
        .where(eq(financeClassificationDecisions.transactionId, f.transaction.id)),
    ).toEqual(decisions);
    const reviews = await database.db
      .select()
      .from(financeReviewCases)
      .where(eq(financeReviewCases.transactionId, f.transaction.id));
    expect(reviews.find((row) => row.id === f.review.id)).toMatchObject({ status: "resolved" });
    expect(reviews.find((row) => row.id === unrelated?.id)).toMatchObject({
      status: "open",
      rationale: "Unrelated duplicate check.",
    });
    const audit = await database.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.entityId, f.transaction.id),
          eq(auditEvents.action, "finance.transaction_categorized"),
        ),
      );
    expect(audit).toHaveLength(1);
  });

  it.each([
    "sum mismatch",
    "invalidated",
    "pending",
    "transfer",
  ])("backfill retains review for %s allocation evidence", async (state) => {
    const f = await fixture();
    const allocation = f.allocations[0];
    if (!allocation) throw new Error("Missing allocation.");
    if (state === "sum mismatch")
      await database.db
        .update(financeTransactionAllocations)
        .set({ amount: 1 })
        .where(eq(financeTransactionAllocations.id, allocation.id));
    if (state === "invalidated")
      await database.db
        .update(financeTransactionAllocations)
        .set({ state: "invalidated", invalidatedAt: new Date() })
        .where(eq(financeTransactionAllocations.transactionId, f.transaction.id));
    if (state === "pending")
      await database.db
        .update(financeTransactions)
        .set({ pending: true })
        .where(eq(financeTransactions.id, f.transaction.id));
    if (state === "transfer")
      await database.db
        .update(financeTransactions)
        .set({ direction: "transfer" })
        .where(eq(financeTransactions.id, f.transaction.id));
    await f.service.backfillLearning(100);
    const [review] = await database.db
      .select()
      .from(financeReviewCases)
      .where(eq(financeReviewCases.id, f.review.id));
    expect(review).toMatchObject({
      status: "open",
      reason: "unknown_merchant",
      rationale: "Backfilled without a confident category.",
    });
  });

  it("rejects stale, foreign, incomplete and transfer evidence without replacing allocations", async () => {
    const f = await fixture();
    const allocation = f.allocations[0];
    if (!allocation) throw new Error("Missing saved allocation.");
    const input = {
      action: "approve" as const,
      expectedTransactionUpdatedAt: f.transaction.updatedAt,
      learnMerchant: "never" as const,
      rationale: "Keep saved split.",
    };
    await expect(
      f.service.resolveReview(
        f.review.id,
        { ...input, expectedTransactionUpdatedAt: "2020-01-01T00:00:00Z" },
        f.context,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      f.service.resolveReview(f.review.id, input, {
        ...f.context,
        principal: { ...f.context.principal, userId: randomUUID() },
      }),
    ).rejects.toMatchObject({ code: "not_found" });
    await database.db
      .update(financeTransactionAllocations)
      .set({ amount: 1 })
      .where(eq(financeTransactionAllocations.id, allocation.id));
    await expect(f.service.resolveReview(f.review.id, input, f.context)).rejects.toMatchObject({
      code: "invalid_request",
    });
    await database.db
      .update(financeTransactionAllocations)
      .set({ amount: allocation.amount })
      .where(eq(financeTransactionAllocations.id, allocation.id));
    await database.db
      .update(financeReviewCases)
      .set({ reason: "possible_transfer", reasonCode: "possible_transfer" })
      .where(eq(financeReviewCases.id, f.review.id));
    await expect(f.service.resolveReview(f.review.id, input, f.context)).rejects.toMatchObject({
      code: "invalid_request",
    });
    expect(
      await database.db
        .select()
        .from(financeTransactionAllocations)
        .where(eq(financeTransactionAllocations.transactionId, f.transaction.id))
        .orderBy(financeTransactionAllocations.id),
    ).toEqual(f.allocations);
  });

  it("does not turn an agent category approval into authority to approve a saved breakdown", async () => {
    const f = await fixture();
    await expect(
      f.service.resolveReview(
        f.review.id,
        {
          action: "approve",
          expectedTransactionUpdatedAt: f.transaction.updatedAt,
          confidence: 1,
          learnMerchant: "never",
          rationale: "Keep saved split.",
        },
        {
          ...f.context,
          principal: { ...f.context.principal, actorId: randomUUID(), actorType: "agent" },
        },
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(
      await database.db
        .select()
        .from(financeTransactionAllocations)
        .where(eq(financeTransactionAllocations.transactionId, f.transaction.id))
        .orderBy(financeTransactionAllocations.id),
    ).toEqual(f.allocations);
  });

  it("preserves a single reimbursement-linked allocation when the owner approves its exact review", async () => {
    const f = await fixture(true);
    const allocation = f.allocations[0];
    if (!allocation) throw new Error("Missing allocation.");
    const [claim] = await database.db
      .insert(financeReimbursements)
      .values({
        userId: f.userId,
        allocationId: allocation.id,
        expectedAmount: 8700,
        rationale: "Existing receipt claim.",
      })
      .returning();
    await expect(
      f.service.resolveReview(
        f.review.id,
        {
          action: "approve",
          expectedTransactionUpdatedAt: f.transaction.updatedAt,
          learnMerchant: "never",
          rationale: "Keep this exact saved allocation.",
        },
        f.context,
      ),
    ).resolves.toMatchObject({
      applied: true,
      transaction: { needsReview: false, allocations: f.transaction.allocations },
    });
    expect(
      await database.db
        .select()
        .from(financeTransactionAllocations)
        .where(eq(financeTransactionAllocations.transactionId, f.transaction.id)),
    ).toEqual(f.allocations);
    expect(
      await database.db
        .select()
        .from(financeReimbursements)
        .where(eq(financeReimbursements.allocationId, allocation.id)),
    ).toEqual([claim]);
  });

  it("rejects approval of invalidated-only history even when a suggested category exists", async () => {
    const f = await fixture(true);
    await database.db
      .update(financeTransactionAllocations)
      .set({ state: "invalidated", invalidatedAt: new Date() })
      .where(eq(financeTransactionAllocations.transactionId, f.transaction.id));
    await database.db
      .update(financeReviewCases)
      .set({ suggestedCategoryId: f.category.id })
      .where(eq(financeReviewCases.id, f.review.id));
    const history = await database.db
      .select()
      .from(financeTransactionAllocations)
      .where(eq(financeTransactionAllocations.transactionId, f.transaction.id));
    await expect(
      f.service.resolveReview(
        f.review.id,
        {
          action: "approve",
          expectedTransactionUpdatedAt: f.transaction.updatedAt,
          learnMerchant: "never",
          rationale: "Do not recreate stale evidence.",
        },
        f.context,
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(
      await database.db
        .select()
        .from(financeTransactionAllocations)
        .where(eq(financeTransactionAllocations.transactionId, f.transaction.id)),
    ).toEqual(history);
  });

  it.each([
    [1, false],
    [4, true],
  ] as const)("preserves agent proposal enforcement with %i confirmations", async (confirmations, eligible) => {
    const f = await fixture(true);
    const [merchant] = await database.db
      .insert(financeMerchants)
      .values({
        userId: f.userId,
        displayName: "Acme Storage",
        normalizedName: "acme-storage",
        behavior: "consistent",
      })
      .returning();
    if (!merchant) throw new Error("Missing merchant.");
    await database.db
      .update(financeTransactions)
      .set({
        merchant: "Acme Storage",
        merchantId: merchant.id,
        needsReview: true,
        updatedAt: new Date(),
      })
      .where(eq(financeTransactions.id, f.transaction.id));
    for (let index = 0; index < confirmations; index += 1) {
      const [source] = await database.db
        .insert(financeTransactions)
        .values({
          userId: f.userId,
          accountId: f.transaction.accountId,
          amount: 100,
          direction: "expense",
          merchant: "Acme Storage",
          merchantId: merchant.id,
          categoryId: f.category.id,
          category: f.category.name,
          transactionDate: "2026-10-01",
        })
        .returning();
      if (!source) throw new Error("Missing prior confirmation transaction.");
      await database.db.insert(financeClassificationDecisions).values({
        userId: f.userId,
        transactionId: source.id,
        merchantId: merchant.id,
        categoryId: f.category.id,
        categoryName: f.category.name,
        source: "user",
        outcome: "confirmed",
        confidence: 10000,
        rationale: "Prior exact user confirmation.",
      });
    }
    const {
      items: [proposal],
    } = await f.service.proposeOutstandingCategorizations(f.userId, {
      type: "target",
      entityType: "finance_review_case",
      id: f.review.id,
    });
    if (!proposal) throw new Error("Missing proposal.");
    expect(proposal.meetsPolicyThreshold).toBe(eligible);
    const context = {
      ...f.context,
      principal: { ...f.context.principal, actorType: "agent" as const, actorId: randomUUID() },
    };
    const input = {
      action: "approve" as const,
      expectedTransactionUpdatedAt: proposal.transaction.updatedAt,
      confidence: proposal.confidence,
      learnMerchant: "never" as const,
      rationale: "Keep exact saved category with current policy.",
    };
    await expect(
      f.service.resolveReview(f.review.id, { ...input, confidence: 0 }, context),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(f.service.resolveReview(f.review.id, input, context)).resolves.toMatchObject({
      applied: eligible,
    });
    expect(
      await database.db
        .select()
        .from(financeTransactionAllocations)
        .where(eq(financeTransactionAllocations.transactionId, f.transaction.id)),
    ).toEqual(f.allocations);
    const [review] = await database.db
      .select()
      .from(financeReviewCases)
      .where(eq(financeReviewCases.id, f.review.id));
    expect(review?.status).toBe(eligible ? "resolved" : "open");
  });
});
