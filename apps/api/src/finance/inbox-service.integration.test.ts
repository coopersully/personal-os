import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  createDatabaseClient,
  type DatabaseClient,
  financeAccounts,
  financeCategories,
  financeCategoryRules,
  financeContextualAnswers,
  financeContextualQuestions,
  financeEconomicEvents,
  financeProfileVersions,
  financeReviewArchives,
  financeReviewCases,
  financeTransactions,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import { createFinanceService } from "../finance-service.js";
import type { Principal } from "../types.js";
import { loadFinanceAuthorization } from "./context.js";
import { createInboxService } from "./inbox-service.js";

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

  it("pages owned review history in stable order and protects exact evidence and cursors", async () => {
    const [historyUser, otherUser] = await database.db
      .insert(users)
      .values([
        {
          displayName: "History",
          email: `history-${randomUUID()}@example.com`,
          passwordHash: "unused",
        },
        {
          displayName: "Other",
          email: `other-${randomUUID()}@example.com`,
          passwordHash: "unused",
        },
      ])
      .returning();
    if (!historyUser || !otherUser) throw new Error("History users were not created.");
    const historyUserId = historyUser.id;
    const accounts = await database.db
      .insert(financeAccounts)
      .values([
        { institution: "Bank", name: "History", provider: "manual", userId: historyUserId },
        { institution: "Other Bank", name: "Private", provider: "manual", userId: otherUser.id },
      ])
      .returning();
    if (!accounts[0] || !accounts[1]) throw new Error("History accounts were not created.");
    const transactions = await database.db
      .insert(financeTransactions)
      .values([
        {
          accountId: accounts[0].id,
          amount: 1200,
          direction: "expense",
          merchant: "History merchant",
          transactionDate: "2026-10-07",
          userId: historyUserId,
        },
        {
          accountId: accounts[1].id,
          amount: 500,
          direction: "expense",
          merchant: "Private merchant",
          transactionDate: "2026-10-07",
          userId: otherUser.id,
        },
      ])
      .returning();
    if (!transactions[0] || !transactions[1])
      throw new Error("History transactions were not created.");
    const ids = [randomUUID(), randomUUID(), randomUUID()] as const;
    const foreignId = randomUUID();
    await database.db.insert(financeReviewCases).values([
      {
        id: ids[0],
        userId: historyUserId,
        transactionId: transactions[0].id,
        stableKey: `history:${ids[0]}`,
        status: "open",
        reasonCode: "category_ambiguity",
        evidence: { source: "first", note: "Food or household" },
        impactAmount: 1200,
      },
      {
        id: ids[1],
        userId: historyUserId,
        transactionId: transactions[0].id,
        stableKey: `history:${ids[1]}`,
        status: "deferred",
        reasonCode: "merchant_identity",
        evidence: { source: "second" },
        impactAmount: 1200,
      },
      {
        id: ids[2],
        userId: historyUserId,
        transactionId: transactions[0].id,
        stableKey: `history:${ids[2]}`,
        status: "resolved",
        reasonCode: "unusual_amount",
        evidence: { source: "third" },
        resolution: {
          type: "dismiss",
          rationale: "Consolidated into the canonical Finance Inbox case.",
        },
        resolutionProvenance: {
          actorType: "user",
          actorId: historyUserId,
          requestId: "history-test",
        },
        resolvedAt: new Date("2026-10-08T10:00:00Z"),
        impactAmount: 1200,
      },
      {
        id: foreignId,
        userId: otherUser.id,
        transactionId: transactions[1].id,
        stableKey: `history:${foreignId}`,
        status: "resolved",
        reasonCode: "unusual_amount",
        evidence: { private: "Do not disclose" },
        impactAmount: 500,
      },
    ]);
    // PostgreSQL retains sub-millisecond precision, which the returned JS Date drops.
    for (const [index, id] of ids.entries()) {
      await database.pool.query(
        "UPDATE finance_review_cases SET first_seen_at = $1::timestamptz WHERE id = $2",
        [`2026-10-08T12:00:00.00000${index === 2 ? 1 : 3}Z`, id],
      );
    }
    const service = createInboxService({ db: database.db, now: () => new Date() });
    const tiedIds = [ids[0], ids[1]].sort((left, right) => right.localeCompare(left));
    const first = await service.listFinanceReviewHistory(historyUserId, { limit: 2 });
    expect(first.items.map((item) => item.id)).toEqual(tiedIds);
    expect(first.items.map((item) => item.status).sort()).toEqual(["deferred", "open"]);
    expect(first.nextCursor).toBe(tiedIds[1]);
    const tiePage = await service.listFinanceReviewHistory(historyUserId, { limit: 1 });
    if (!tiePage.nextCursor) throw new Error("Expected another tied review.");
    const nextTiePage = await service.listFinanceReviewHistory(historyUserId, {
      limit: 1,
      cursor: tiePage.nextCursor,
    });
    expect(nextTiePage.items.map((item) => item.id)).toEqual([tiedIds[1]]);
    const second = await service.listFinanceReviewHistory(historyUserId, {
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(second.items.map((item) => item.id)).toEqual([ids[2]]);
    expect(second.items[0]).toMatchObject({
      status: "resolved",
      context: { merchant: "History merchant" },
    });
    expect(second.items[0]).not.toHaveProperty("evidence");
    expect(second.nextCursor).toBeNull();
    expect(await service.getFinanceReviewHistoryItem(historyUserId, ids[2])).toMatchObject({
      id: ids[2],
      status: "resolved",
      evidence: { source: "third" },
      economicEventId: null,
      resolution: { rationale: "Consolidated into the canonical Finance Inbox case." },
      resolutionProvenance: { actorType: "user" },
    });
    await expect(
      service.getFinanceReviewHistoryItem(historyUserId, foreignId),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      service.listFinanceReviewHistory(historyUserId, { cursor: foreignId }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      service.listFinanceReviewHistory(historyUserId, { cursor: "not-a-uuid" }),
    ).rejects.toThrow();
    await expect(service.listFinanceReviewHistory(historyUserId, { limit: 51 })).rejects.toThrow();
    await database.db.insert(financeContextualQuestions).values({
      id: randomUUID(),
      userId: historyUserId,
      subtype: "manual_transaction_purpose_v1",
      reviewCaseId: ids[0],
      transactionId: transactions[0].id,
      accountId: accounts[0].id,
      accountRevision: accounts[0].contextualRevision,
      transactionRevision: transactions[0].contextualRevision,
      reviewRevision: 1n,
      prompt: "Purpose?",
      merchant: "History merchant",
      amount: 1200,
      transactionDate: "2026-10-07",
      state: "answered",
      workRevision: 2n,
    });
    const [question] = await database.db
      .select()
      .from(financeContextualQuestions)
      .where(eq(financeContextualQuestions.userId, historyUserId));
    if (!question) throw new Error("Missing retained question fixture");
    await database.db.insert(financeContextualAnswers).values({
      userId: historyUserId,
      questionId: question.id,
      operationId: randomUUID(),
      answeredWorkRevision: 1n,
      answeredActionRevision: 1n,
      resultingWorkRevision: 2n,
      text: "For groceries",
      sourceKind: "app",
      actorType: "user",
      actorId: historyUserId,
      requestId: "retention-test",
      recordedAt: new Date(),
    });
    await database.db
      .delete(financeTransactions)
      .where(eq(financeTransactions.id, transactions[0].id));
    const retained = await service.getFinanceReviewHistoryItem(historyUserId, ids[0]);
    expect(retained).toMatchObject({
      archived: true,
      evidence: { source: "first" },
      context: { merchant: "History merchant" },
      retainedAnswers: [{ text: "For groceries" }],
      retainedQuestions: [{ prompt: "Purpose?" }],
    });
    expect(
      (await service.listFinanceReviewHistory(historyUserId, { limit: 2 })).items.map(
        (item) => item.id,
      ),
    ).toEqual(tiedIds);
    expect(
      (
        await service.listFinanceReviewHistory(historyUserId, {
          cursor: first.nextCursor,
          limit: 2,
        })
      ).items.map((item) => item.id),
    ).toEqual([ids[2]]);
    const [liveTransaction] = await database.db
      .insert(financeTransactions)
      .values({
        accountId: accounts[0].id,
        amount: 900,
        direction: "expense",
        merchant: "Live review merchant",
        transactionDate: "2026-10-07",
        userId: historyUserId,
      })
      .returning();
    if (!liveTransaction) throw new Error("Live history transaction was not created.");
    const liveId = randomUUID();
    await database.db.insert(financeReviewCases).values({
      id: liveId,
      userId: historyUserId,
      transactionId: liveTransaction.id,
      stableKey: `history:${liveId}`,
      status: "open",
      reasonCode: "unusual_amount",
      evidence: { source: "live" },
      impactAmount: 900,
    });
    await database.pool.query(
      "UPDATE finance_review_cases SET first_seen_at = $1::timestamptz WHERE id = $2",
      ["2026-10-08T12:00:00.000002Z", liveId],
    );
    const mixedFirst = await service.listFinanceReviewHistory(historyUserId, { limit: 2 });
    const mixedSecond = await service.listFinanceReviewHistory(historyUserId, {
      cursor: mixedFirst.nextCursor,
      limit: 2,
    });
    expect(mixedFirst.items.map((item) => [item.id, item.archived])).toEqual(
      tiedIds.map((id) => [id, true]),
    );
    expect(mixedSecond.items.map((item) => [item.id, item.archived])).toEqual([
      [liveId, false],
      [ids[2], true],
    ]);
    expect(mixedSecond.nextCursor).toBeNull();
    await expect(service.getFinanceReviewHistoryItem(otherUser.id, ids[0])).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(
      database.db
        .update(financeReviewArchives)
        .set({ context: {} })
        .where(eq(financeReviewArchives.id, ids[0])),
    ).rejects.toThrow();
    await database.db.delete(financeAccounts).where(eq(financeAccounts.id, accounts[1].id));
    expect(await service.getFinanceReviewHistoryItem(otherUser.id, foreignId)).toMatchObject({
      archived: true,
      evidence: { private: "Do not disclose" },
    });
    await database.db.delete(users).where(eq(users.id, otherUser.id));
    expect(
      await database.db
        .select()
        .from(financeReviewArchives)
        .where(eq(financeReviewArchives.userId, otherUser.id)),
    ).toEqual([]);
    await database.db.delete(users).where(eq(users.id, historyUserId));
    expect(
      await database.db
        .select()
        .from(financeReviewArchives)
        .where(eq(financeReviewArchives.userId, historyUserId)),
    ).toEqual([]);
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
    if (!saved?.transactionId || !saved.context) throw new Error("Saved review missing.");
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
    const finances = createFinanceService({ db: database.db, now });
    await database.db
      .insert(financeCategoryRules)
      .values({ userId, merchantNormalized: "small", category: "Dining" });
    const contexts = await finances.getMaintenanceCandidateQuestionContexts(userId, [
      saved.transactionId,
    ]);
    expect(contexts[saved.transactionId]).toMatchObject({
      underlyingAction: "transaction",
      why: expect.stringContaining("I need the merchant name."),
    });
    const beforeAnswer = await database.db.query.financeTransactions.findFirst({
      where: eq(financeTransactions.id, saved.transactionId),
    });
    expect(beforeAnswer?.categoryId).not.toBe(category.id);
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
    expect(
      await finances.getMaintenanceCandidateQuestionContexts(userId, [saved.transactionId]),
    ).toEqual({});
    const afterAnswer = await database.db.query.financeTransactions.findFirst({
      where: eq(financeTransactions.id, saved.transactionId),
    });
    expect(afterAnswer).toMatchObject({ categoryId: category.id, needsReview: false });
  });

  it("allows only one concurrent clarification to replace an unchanged review", async () => {
    const service = createInboxService({
      db: database.db,
      now: () => new Date("2026-08-24T21:00:00Z"),
    });
    const [account] = await database.db
      .insert(financeAccounts)
      .values({ institution: "Guard Bank", name: "Checking", provider: "manual", userId })
      .returning();
    if (!account) throw new Error("Concurrent clarification account missing.");
    const [transaction] = await database.db
      .insert(financeTransactions)
      .values({
        accountId: account.id,
        amount: 2500,
        direction: "expense",
        merchant: "Concurrent Merchant",
        transactionDate: "2026-08-24",
        userId,
      })
      .returning();
    const [event] = await database.db
      .insert(financeEconomicEvents)
      .values({ kind: "purchase", stableKey: `event:concurrent:${transaction?.id}`, userId })
      .returning();
    if (!transaction || !event) throw new Error("Concurrent clarification fixture missing.");
    const review = await service.upsertFinanceReview({
      economicEventId: event.id,
      evidence: { merchant: transaction.merchant },
      impactAmount: 25,
      reason: "merchant_identity",
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
      requestId: "concurrent-clarification",
    });
    // Hold the case until both requests have observed the same resolution. Scheduling alone
    // cannot prove a race: two genuinely sequential clarifications may both be valid.
    let release: () => void = () => {};
    let held: () => void = () => {};
    const barrier = new Promise<void>((resolve) => {
      held = resolve;
    });
    const blocker = database.db.transaction(async (tx) => {
      await tx
        .select()
        .from(financeReviewCases)
        .where(eq(financeReviewCases.id, review.id))
        .for("update");
      held();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    });
    await barrier;
    const pendingAttempts = Promise.allSettled(
      ["first note", "second note"].map((answer, index) =>
        service.answerFinanceReview(
          review.id,
          {
            answer,
            idempotencyKey: `concurrent-clarification-${index}`,
            resolution: { clarification: answer, type: "clarify" },
          },
          context,
        ),
      ),
    );
    try {
      await vi.waitFor(
        async () => {
          const blocked = await database.pool.query(
            "SELECT count(*)::int AS count FROM pg_stat_activity WHERE query LIKE '%update \"finance_review_cases\"%' AND cardinality(pg_blocking_pids(pid))>0",
          );
          expect(blocked.rows[0]?.count).toBe(2);
        },
        { timeout: 5000 },
      );
    } finally {
      release();
    }
    await blocker;
    const attempts = await pendingAttempts;
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(1);
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
