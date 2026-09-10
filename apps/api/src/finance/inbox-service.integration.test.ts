import { resolve } from "node:path";
import {
  createDatabaseClient,
  type DatabaseClient,
  financeAccounts,
  financeCategories,
  financeCategoryRules,
  financeEconomicEvents,
  financeProfileVersions,
  financeTransactions,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import type { Principal } from "../types.js";
import { loadFinanceAuthorization } from "./context.js";
import { createInboxService } from "./inbox-service.js";
import { createMaintenanceService } from "./maintenance-service.js";

describe.sequential("transaction-backed Finance Inbox", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  let userId: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine")
      .withDatabase("personal_os")
      .withUsername("personal_os")
      .withPassword("personal_os")
      .start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
    const [user] = await database.db
      .insert(users)
      .values({ displayName: "Inbox", email: "inbox@example.com", passwordHash: "unused" })
      .returning();
    if (!user) throw new Error("Fixture user was not created.");
    userId = user.id;
  }, 120_000);

  afterAll(async () => {
    await database.close();
    await container.stop();
  });

  it("deduplicates repeated findings and returns one next question after an answer", async () => {
    const service = createInboxService({
      db: database.db,
      now: () => new Date("2026-08-23T20:00:00Z"),
    });
    const [account] = await database.db
      .insert(financeAccounts)
      .values({ institution: "Bank", name: "Checking", provider: "manual", userId })
      .returning();
    if (!account) throw new Error("Account was not created.");
    const transactions = await database.db
      .insert(financeTransactions)
      .values([
        {
          accountId: account.id,
          amount: 50000,
          direction: "expense",
          merchant: "Large",
          transactionDate: "2026-08-22",
          userId,
        },
        {
          accountId: account.id,
          amount: 1000,
          direction: "expense",
          merchant: "Small",
          transactionDate: "2026-08-21",
          userId,
        },
      ])
      .returning();
    const events = await database.db
      .insert(financeEconomicEvents)
      .values([
        { kind: "purchase", stableKey: "event:large", userId },
        { kind: "purchase", stableKey: "event:small", userId },
      ])
      .returning();
    if (!transactions[0] || !transactions[1] || !events[0] || !events[1])
      throw new Error("Fixtures failed.");

    const first = await service.upsertFinanceReview({
      economicEventId: events[0].id,
      evidence: { merchant: "Large" },
      impactAmount: 500,
      reason: "unusual_amount",
      transactionId: transactions[0].id,
      userId,
    });
    const repeated = await service.upsertFinanceReview({
      economicEventId: events[0].id,
      evidence: { merchant: "Large", repeated: true },
      impactAmount: 500,
      reason: "unusual_amount",
      transactionId: transactions[0].id,
      userId,
    });
    expect(repeated.id).toBe(first.id);
    await service.upsertFinanceReview({
      economicEventId: events[1].id,
      evidence: { merchant: "Small" },
      impactAmount: 10,
      reason: "merchant_identity",
      transactionId: transactions[1].id,
      userId,
    });
    const inbox = await service.getFinanceInbox(userId);
    expect(inbox.communication.nextQuestion?.id).toBe(first.id);
    expect(inbox.remainingWork.count).toBe(2);
    expect(inbox.data[0]).toMatchObject({
      transactionId: transactions[0].id,
      context: {
        accountId: account.id,
        accountName: "Checking",
        institution: "Bank",
        date: "2026-08-22",
        amount: 500,
        merchant: "Large",
        direction: "expense",
        pending: false,
      },
    });
    expect((await service.getFinanceInbox(crypto.randomUUID())).data).toEqual([]);

    const principal: Principal = {
      actorId: "agent",
      actorType: "agent",
      scopes: new Set(["finances:write"]),
      userId,
    };
    const context = await loadFinanceAuthorization({
      db: database.db,
      principal,
      requestId: "answer",
    });
    const attempts = await Promise.allSettled(
      ["answer-1", "answer-2"].map((idempotencyKey) =>
        service.answerFinanceReview(
          first.id,
          {
            answer: "This purchase is legitimate.",
            idempotencyKey,
            resolution: { rationale: "User confirmed it.", type: "dismiss" },
          },
          context,
        ),
      ),
    );
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(1);
    const completed = attempts.find((attempt) => attempt.status === "fulfilled");
    if (completed?.status !== "fulfilled") throw new Error("No successful answer.");
    const answered = completed.value;
    expect(answered.communication.nextQuestion?.id).not.toBe(first.id);
    expect(answered.remainingWork.count).toBe(1);
    expect(answered.communication.headline).toBe("I applied that answer.");
    const remaining = await service.getFinanceInbox(userId);
    expect(remaining.communication.headline).toBe("1 transaction needs review.");
    expect(answered.changes).toHaveLength(1);
  });

  it("keeps clarification open, then classifies with trusted agent provenance", async () => {
    const now = () => new Date("2026-08-24T20:00:00Z");
    const service = createInboxService({ db: database.db, now });
    const [category] = await database.db
      .insert(financeCategories)
      .values({ group: "Food", name: "Dining", slug: "dining", userId })
      .returning();
    if (!category) throw new Error("Category fixture missing.");
    const current = await service.getFinanceInbox(userId);
    const reviewId = current.communication.nextQuestion?.id;
    if (!reviewId) throw new Error("Review fixture missing.");
    const principal: Principal = {
      actorId: "agent",
      actorType: "agent",
      scopes: new Set(["finances:write"]),
      userId,
    };
    const context = await loadFinanceAuthorization({
      db: database.db,
      principal,
      requestId: "classify-answer",
    });
    await expect(
      service.answerFinanceReview(
        reviewId,
        {
          answer: "I need the merchant name.",
          idempotencyKey: "clarify-1",
          resolution: { clarification: "Which location was this?", type: "clarify" },
        },
        context,
      ),
    ).resolves.toMatchObject({
      changes: [],
      outcome: "work_remaining",
      remainingWork: { count: 1, categories: ["finance_inbox"] },
    });
    const saved = (await service.getFinanceInbox(userId)).data.find((item) => item.id === reviewId);
    if (!saved?.transactionId) throw new Error("Saved review missing.");
    expect((await service.getFinanceInbox(userId)).communication.nextQuestion).toBeUndefined();
    await service.upsertFinanceReview({
      economicEventId: saved.economicEventId,
      transactionId: saved.transactionId,
      evidence: { merchant: "Updated provider label" },
      impactAmount: saved.impactAmount,
      reason: saved.reason,
      userId,
    });
    const refreshed = (await service.getFinanceInbox(userId)).data.find(
      (item) => item.id === reviewId,
    );
    expect(refreshed).toMatchObject({
      status: "open",
      resolution: {
        type: "clarify",
        answer: "I need the merchant name.",
        clarification: "Which location was this?",
      },
      evidence: { merchant: "Updated provider label" },
    });
    const maintenance = createMaintenanceService({ db: database.db, now, inbox: service });
    const nextPass = await maintenance.maintainFinances(
      { operation: "start", scope: { type: "since", from: "2026-09-01" } },
      context,
    );
    expect(nextPass.data.inboxCases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: reviewId, resolution: refreshed?.resolution }),
      ]),
    );
    await maintenance.maintainFinances(
      {
        operation: "submit_audit",
        runId: nextPass.data.runId,
        expectedVersion: nextPass.data.version,
        idempotencyKey: "notes-audit",
        findings: [],
      },
      context,
    );
    await database.db
      .update(financeTransactions)
      .set({ needsReview: true })
      .where(eq(financeTransactions.id, saved.transactionId));
    await database.db
      .insert(financeCategoryRules)
      .values({ userId, merchantNormalized: "small", category: "Dining" });
    const withRule = await maintenance.maintainFinances(
      { operation: "start", scope: { type: "all_outstanding" } },
      context,
    );
    expect(withRule.data.reasoningBatch).toEqual(
      expect.arrayContaining([expect.objectContaining({ transactionId: saved.transactionId })]),
    );
    const beforeAnswer = await database.db.query.financeTransactions.findFirst({
      where: eq(financeTransactions.id, saved.transactionId),
    });
    expect(beforeAnswer?.needsReview).toBe(true);
    await expect(
      service.answerFinanceReview(
        reviewId,
        {
          answer: "It was lunch.",
          idempotencyKey: "classify-1",
          resolution: {
            categoryId: category.id,
            meaning: "Lunch",
            type: "classify_transaction",
          },
        },
        context,
      ),
    ).resolves.toMatchObject({
      changes: [expect.objectContaining({ type: "finance_review_resolved" })],
    });
  });

  it("applies a profile answer and resolves its Inbox row atomically", async () => {
    const service = createInboxService({
      db: database.db,
      now: () => new Date("2026-08-25T20:00:00Z"),
    });
    const [account] = await database.db
      .select()
      .from(financeAccounts)
      .where(eq(financeAccounts.userId, userId))
      .limit(1);
    if (!account) throw new Error("Account fixture missing.");
    const [transaction] = await database.db
      .insert(financeTransactions)
      .values({
        accountId: account.id,
        amount: 100,
        direction: "expense",
        merchant: "Profile evidence",
        transactionDate: "2026-08-25",
        userId,
      })
      .returning();
    const [event] = await database.db
      .insert(financeEconomicEvents)
      .values({ kind: "other", stableKey: "event:profile", userId })
      .returning();
    if (!transaction || !event) throw new Error("Profile review fixtures missing.");
    const review = await service.upsertFinanceReview({
      economicEventId: event.id,
      evidence: { field: "householdSize" },
      impactAmount: 1,
      reason: "profile_fact",
      transactionId: transaction.id,
      userId,
    });
    const context = await loadFinanceAuthorization({
      db: database.db,
      principal: {
        actorId: "agent",
        actorType: "agent",
        scopes: new Set(["finances:write"]),
        userId,
      },
      requestId: "profile-answer",
    });
    const answered = await service.answerFinanceReview(
      review.id,
      {
        answer: "There are two people in my household.",
        idempotencyKey: "profile-answer-1",
        resolution: { changes: { householdSize: 2 }, type: "update_profile" },
      },
      context,
    );
    const [profile] = await database.db
      .select()
      .from(financeProfileVersions)
      .where(eq(financeProfileVersions.userId, userId));
    expect(profile?.householdSize).toBe(2);
    expect(answered.changes).toEqual([
      expect.objectContaining({ type: "finance_review_resolved" }),
    ]);
  });

  it("links reviewed activity and preserves populated profile facts across answers", async () => {
    const service = createInboxService({
      db: database.db,
      now: () => new Date("2026-08-26T20:00:00Z"),
    });
    const [account] = await database.db
      .select()
      .from(financeAccounts)
      .where(eq(financeAccounts.userId, userId))
      .limit(1);
    if (!account) throw new Error("Account fixture missing.");
    const [reviewed, related, profileEvidence, laterEvidence] = await database.db
      .insert(financeTransactions)
      .values([
        {
          accountId: account.id,
          amount: 2500,
          direction: "expense",
          merchant: "Expense",
          transactionDate: "2026-08-26",
          userId,
        },
        {
          accountId: account.id,
          amount: 2500,
          direction: "income",
          merchant: "Reimbursement",
          transactionDate: "2026-08-26",
          userId,
        },
        {
          accountId: account.id,
          amount: 100,
          direction: "expense",
          merchant: "Profile",
          transactionDate: "2026-08-26",
          userId,
        },
        {
          accountId: account.id,
          amount: 100,
          direction: "expense",
          merchant: "Profile later",
          transactionDate: "2026-08-26",
          userId,
        },
      ])
      .returning();
    if (!reviewed || !related || !profileEvidence || !laterEvidence)
      throw new Error("Review transaction fixtures missing.");
    const [linkEvent, profileEvent, laterEvent] = await database.db
      .insert(financeEconomicEvents)
      .values([
        { kind: "reimbursement", stableKey: "event:link-review", userId },
        { kind: "other", stableKey: "event:profile-values", userId },
        { kind: "other", stableKey: "event:profile-preserve", userId },
      ])
      .returning();
    if (!linkEvent || !profileEvent || !laterEvent) throw new Error("Review events missing.");
    const linkReview = await service.upsertFinanceReview({
      economicEventId: linkEvent.id,
      evidence: {},
      impactAmount: 25,
      reason: "reimbursement",
      transactionId: reviewed.id,
      userId,
    });
    const profileReview = await service.upsertFinanceReview({
      economicEventId: profileEvent.id,
      evidence: {},
      impactAmount: 1,
      reason: "profile_fact",
      transactionId: profileEvidence.id,
      userId,
    });
    const laterReview = await service.upsertFinanceReview({
      economicEventId: laterEvent.id,
      evidence: {},
      impactAmount: 1,
      reason: "profile_fact",
      transactionId: laterEvidence.id,
      userId,
    });
    const context = await loadFinanceAuthorization({
      db: database.db,
      principal: {
        actorId: "agent",
        actorType: "agent",
        scopes: new Set(["finances:write"]),
        userId,
      },
      requestId: "linked-answer",
    });
    await expect(
      service.answerFinanceReview(
        "00000000-0000-4000-8000-000000000000",
        {
          answer: "Missing",
          idempotencyKey: "missing-review-answer",
          resolution: { rationale: "Missing", type: "dismiss" },
        },
        context,
      ),
    ).rejects.toThrow("not found");
    await expect(
      service.answerFinanceReview(
        linkReview.id,
        {
          answer: "It reimbursed the expense.",
          idempotencyKey: "link-answer",
          resolution: {
            relatedTransactionId: related.id,
            relationship: "reimbursement",
            type: "link_transactions",
          },
        },
        context,
      ),
    ).resolves.toMatchObject({
      changes: [expect.objectContaining({ type: "finance_review_resolved" })],
    });
    await expect(
      service.answerFinanceReview(
        linkReview.id,
        {
          answer: "Again",
          idempotencyKey: "resolved-review-answer",
          resolution: { rationale: "Already handled", type: "dismiss" },
        },
        context,
      ),
    ).rejects.toThrow("already resolved");
    await expect(
      service.answerFinanceReview(
        profileReview.id,
        {
          answer: "Invalid relationship",
          idempotencyKey: "missing-related-answer",
          resolution: {
            relatedTransactionId: "00000000-0000-4000-8000-000000000000",
            relationship: "reimbursement",
            type: "link_transactions",
          },
        },
        context,
      ),
    ).rejects.toThrow("related transaction was not found");
    await expect(
      service.answerFinanceReview(
        profileReview.id,
        {
          answer: "Invalid category",
          idempotencyKey: "missing-category-answer",
          resolution: {
            categoryId: "00000000-0000-4000-8000-000000000000",
            meaning: "Unknown",
            type: "classify_transaction",
          },
        },
        context,
      ),
    ).rejects.toThrow("category was not found");
    await service.answerFinanceReview(
      profileReview.id,
      {
        answer: "My current figures.",
        idempotencyKey: "profile-values",
        resolution: {
          changes: {
            expectedMonthlyTakeHome: 5000,
            incomeStability: "stable",
            jurisdiction: "US-NY",
            liquidReserves: 10000,
          },
          type: "update_profile",
        },
      },
      context,
    );
    await service.answerFinanceReview(
      laterReview.id,
      {
        answer: "One dependent.",
        idempotencyKey: "profile-preserve",
        resolution: { changes: { dependents: 1 }, type: "update_profile" },
      },
      context,
    );
    const profiles = await database.db
      .select()
      .from(financeProfileVersions)
      .where(eq(financeProfileVersions.userId, userId));
    expect(profiles.at(-1)).toMatchObject({
      dependents: 1,
      expectedMonthlyTakeHome: 500000,
      liquidReserves: 1000000,
    });
  });
});
