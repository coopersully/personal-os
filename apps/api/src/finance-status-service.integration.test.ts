import { resolve } from "node:path";
import {
  createDatabaseClient,
  type DatabaseClient,
  domainProfileApprovals,
  domainProfiles,
  financeAccounts,
  financeBudgets,
  financeReviewCases,
  financeTransactions,
  migrateDatabase,
  users,
  workspaceMaintenanceRuns,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import { createFinanceStatusService } from "./finance-status-service.js";

const now = new Date("2026-08-15T12:00:00.000Z");

describe.sequential("Finance status service", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine")
      .withDatabase("personal_os")
      .withUsername("personal_os")
      .withPassword("personal_os")
      .start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
  });

  afterAll(async () => {
    await database.close();
    await container.stop();
  });

  async function makeUser(label: string) {
    const [user] = await database.db
      .insert(users)
      .values({
        displayName: label,
        email: `${label.toLowerCase().replaceAll(" ", "-")}@example.com`,
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning();
    if (!user) throw new Error("Fixture user was not created.");
    return user.id;
  }

  function service() {
    return createFinanceStatusService({
      assistant: {} as never,
      db: database.db,
      finances: {} as never,
      goals: {} as never,
      maintenance: {} as never,
      now: () => now,
    });
  }

  async function account(
    userId: string,
    state: "blocked" | "current" | "retrying" | "stale",
    provider: "manual" | "plaid" = "plaid",
  ) {
    const [created] = await database.db
      .insert(financeAccounts)
      .values({
        balance: state === "blocked" ? null : 5_000_00,
        institution: "Test Bank",
        kind: "cash",
        lastSyncedAt:
          state === "current"
            ? new Date("2026-08-15T11:00:00.000Z")
            : state === "stale"
              ? new Date("2026-08-13T11:00:00.000Z")
              : null,
        name: `${state} checking`,
        nextSyncAt: state === "current" ? new Date("2026-08-16T11:00:00.000Z") : null,
        provider,
        providerAccountId: crypto.randomUUID(),
        status:
          provider === "manual" ? "manual" : state === "blocked" ? "needs_reauth" : "connected",
        syncError:
          state === "blocked"
            ? "Reconnect this account."
            : state === "retrying"
              ? "Temporary provider failure."
              : null,
        syncErrorCategory:
          state === "blocked" ? "authorization" : state === "retrying" ? "temporary" : null,
        syncErrorCode:
          state === "blocked"
            ? "ITEM_LOGIN_REQUIRED"
            : state === "retrying"
              ? "PROVIDER_DOWN"
              : null,
        syncFailureCount: state === "blocked" || state === "retrying" ? 1 : 0,
        syncRecovery: state === "blocked" ? "reconnect" : state === "retrying" ? "automatic" : null,
        syncState: state,
        userId,
      })
      .returning();
    if (!created) throw new Error("Fixture account was not created.");
    return created;
  }

  it("reports current account and current-month evidence without manufacturing stale zeros", async () => {
    const userId = await makeUser("Current Finance");
    const source = await account(userId, "current");
    await database.db
      .insert(financeBudgets)
      .values({ category: "Food", limit: 100_000, month: "2026-08", userId });
    await database.db.insert(financeTransactions).values({
      accountId: source.id,
      amount: 40_000,
      category: "Food",
      categoryConfidence: 10000,
      categorySource: "user",
      direction: "expense",
      merchant: "Market",
      needsReview: false,
      pending: false,
      transactionDate: "2026-08-10",
      userId,
    });
    await database.db.insert(financeTransactions).values({
      accountId: source.id,
      amount: 100_000,
      category: "INCOME",
      categoryConfidence: 10000,
      categorySource: "user",
      direction: "income",
      merchant: "Employer",
      needsReview: false,
      pending: false,
      transactionDate: "2026-08-01",
      userId,
    });

    const status = await service().getFinanceStatus(userId, { type: "all_outstanding" });

    expect(status.freshness.state).toBe("current");
    expect(status.details.accounts).toMatchObject({ current: 1, tracked: 1 });
    expect(status.details.accountRoles).toEqual({
      missingInputs: ["account_roles"],
      state: "unavailable",
    });
    expect(status.details.accounts.items[0]?.synchronization.nextRetryAt).toBeNull();
    expect(status.details.month.spending).toBe(400);
    expect(status.details.health.confidence).toBe("reliable");
    expect(status.state).toBe("clean");
  });

  it("uses persisted manual-account current state without requiring a Plaid timestamp", async () => {
    const userId = await makeUser("Manual Current Finance");
    const [source] = await database.db
      .insert(financeAccounts)
      .values({
        balance: 1_000_00,
        institution: "Cash",
        kind: "cash",
        name: "Wallet",
        provider: "manual",
        status: "manual",
        syncState: "current",
        userId,
      })
      .returning();
    if (!source) throw new Error("Manual fixture account was not created.");

    const status = await service().getFinanceStatus(userId, { type: "all_outstanding" });

    expect(status.freshness.state).toBe("current");
    expect(status.details.health.confidence).toBe("reliable");
  });

  it.each([
    ["stale", "stale", "needs_work", "provisional"],
    ["retrying", "stale", "needs_work", "provisional"],
  ] as const)("reports %s evidence honestly", async (syncState, freshness, state, confidence) => {
    const userId = await makeUser(`${syncState} Finance`);
    await account(userId, syncState);
    const status = await service().getFinanceStatus(userId, { type: "all_outstanding" });
    expect(status).toMatchObject({
      freshness: { state: freshness },
      state,
      details: { health: { confidence } },
    });
    expect(status.details.month.spending).toBeNull();
    expect(status.details.month.forecast).toBeNull();
    expect(status.details.health.month.rating).toBe("unknown");
    expect(status.details.health.dimensions.spend).toMatchObject({
      missingInputs: expect.arrayContaining(["current_account_evidence"]),
      rating: "unknown",
    });
    expect(status.details.health.dimensions.save).toMatchObject({
      missingInputs: expect.arrayContaining(["current_account_evidence"]),
      rating: "unknown",
    });
    expect(status.details.health.dimensions.plan).toMatchObject({
      missingInputs: expect.arrayContaining(["current_account_evidence"]),
      rating: "unknown",
    });
  });

  it("reports mixed current and stale account evidence as partial", async () => {
    const userId = await makeUser("Mixed Finance");
    await account(userId, "current");
    await account(userId, "stale");

    const status = await service().getFinanceStatus(userId, { type: "all_outstanding" });

    expect(status).toMatchObject({
      freshness: { state: "partial" },
      state: "needs_work",
      details: { health: { confidence: "provisional" } },
    });
    expect(status.details.accounts).toMatchObject({ current: 1, stale: 1, tracked: 2 });
  });

  it("keeps blocked production failure output internally consistent", async () => {
    const userId = await makeUser("Blocked Finance");
    await account(userId, "blocked");

    const status = await service().getFinanceStatus(userId, { type: "all_outstanding" });

    expect(status).toMatchObject({
      freshness: { state: "unavailable" },
      state: "blocked",
      details: { health: { confidence: "insufficient", month: { rating: "unknown" } } },
    });
    expect(status.details.month.spending).toBeNull();
  });

  it("makes an empty workspace unavailable without claiming zero activity", async () => {
    const userId = await makeUser("Empty Finance");
    const status = await service().getFinanceStatus(userId, { type: "all_outstanding" });
    expect(status).toMatchObject({ freshness: { state: "unavailable" }, state: "needs_input" });
    expect(status.details.month).toEqual({ forecast: null, spending: null });
  });

  it("scopes work detail without replacing current-month budget and health evidence", async () => {
    const userId = await makeUser("Window Finance");
    const source = await account(userId, "current");
    await database.db.insert(financeBudgets).values([
      { category: "Food", limit: 50_000, month: "2026-07", userId },
      { category: "Food", limit: 100_000, month: "2026-08", userId },
    ]);
    const [oldTransaction, windowTransaction] = await database.db
      .insert(financeTransactions)
      .values([
        {
          accountId: source.id,
          amount: 1_000,
          direction: "expense",
          merchant: "Old",
          needsReview: true,
          transactionDate: "2026-06-01",
          userId,
        },
        {
          accountId: source.id,
          amount: 2_000,
          direction: "expense",
          merchant: "Window",
          needsReview: true,
          transactionDate: "2026-07-10",
          userId,
        },
      ])
      .returning();
    if (!oldTransaction || !windowTransaction)
      throw new Error("Fixture transactions were not created.");
    await database.db.insert(financeTransactions).values({
      accountId: source.id,
      amount: 40_000,
      direction: "expense",
      merchant: "Current month",
      needsReview: false,
      transactionDate: "2026-08-10",
      userId,
    });
    await database.db.insert(financeReviewCases).values([
      {
        createdAt: new Date("2026-06-02T00:00:00.000Z"),
        reason: "low_confidence",
        status: "open",
        transactionId: oldTransaction.id,
        userId,
      },
      {
        createdAt: new Date("2026-07-11T00:00:00.000Z"),
        reason: "unknown_merchant",
        status: "open",
        transactionId: windowTransaction.id,
        userId,
      },
    ]);

    const status = await service().getFinanceStatus(userId, {
      type: "window",
      start: "2026-07-01",
      end: "2026-07-31",
    });

    expect(status.details.review).toEqual({ byReason: { unknown_merchant: 1 }, total: 1 });
    expect(status.work.actionable).toBe(1);
    expect(status.work.oldestOutstandingAt).toBe("2026-06-02T00:00:00.000Z");
    expect(status.details.budget).toEqual({ approved: true, month: "2026-08", total: 1_000 });
    expect(status.details.month.spending).toBe(400);
    expect(status.details.month.forecast).toBeCloseTo(826.67, 2);
    expect(status.details.health.month.rating).toBe("on_track");
  });

  it("uses a preserved approved Finance profile snapshot after the live profile becomes a draft", async () => {
    const userId = await makeUser("Approved Snapshot Finance");
    const source = await account(userId, "current");
    await database.db
      .insert(financeBudgets)
      .values({ category: "Food", limit: 100_000, month: "2026-08", userId });
    await database.db.insert(financeTransactions).values({
      accountId: source.id,
      amount: 52_258,
      direction: "expense",
      merchant: "Approved pace",
      needsReview: false,
      transactionDate: "2026-08-10",
      userId,
    });
    const [profile] = await database.db
      .insert(domainProfiles)
      .values({
        categories: [],
        domain: "finances",
        instructions: [],
        objective: "Keep the current month on track.",
        preferences: {
          budgetOffTrackForecastRatio: 1.3,
          budgetWatchForecastRatio: 1.1,
          emergencyReserveTargetMonths: 2,
        },
        sourceContexts: [
          {
            notes: null,
            purpose: "Current spending",
            sourceId: source.id,
            sourceLabel: source.name,
          },
        ],
        status: "active",
        summary: "Signed Finance guidance.",
        userId,
        version: 1,
      })
      .returning();
    if (!profile) throw new Error("Finance profile fixture was not created.");
    const approvedSnapshot = {
      categories: profile.categories,
      createdAt: profile.createdAt.toISOString(),
      domain: profile.domain,
      id: profile.id,
      instructions: profile.instructions,
      objective: profile.objective,
      preferences: profile.preferences,
      sourceContexts: profile.sourceContexts,
      status: profile.status,
      summary: profile.summary,
      updatedAt: profile.updatedAt.toISOString(),
      version: profile.version,
    };
    const [approval] = await database.db
      .insert(domainProfileApprovals)
      .values({
        approvedAt: new Date("2026-08-14T12:00:00.000Z"),
        approvedByUserId: userId,
        domain: "finances",
        profile: approvedSnapshot,
        profileId: profile.id,
        profileVersion: 1,
        userId,
      })
      .returning();
    if (!approval) throw new Error("Finance approval fixture was not created.");
    await database.db
      .update(domainProfiles)
      .set({
        preferences: {
          budgetOffTrackForecastRatio: 1.15,
          budgetWatchForecastRatio: 1.05,
          emergencyReserveTargetMonths: 6,
        },
        status: "draft",
        summary: "Unapproved stricter draft.",
        version: 2,
      })
      .where(eq(domainProfiles.id, profile.id));

    const first = await service().getFinanceStatus(userId, { type: "all_outstanding" });
    await database.db
      .update(domainProfiles)
      .set({ summary: "Another unapproved draft.", version: 3 })
      .where(eq(domainProfiles.id, profile.id));
    const second = await service().getFinanceStatus(userId, { type: "all_outstanding" });

    expect(first.details.health.month.rating).toBe("on_track");
    expect(first.details.rulebookVersion).toBe(second.details.rulebookVersion);

    await database.db
      .update(domainProfileApprovals)
      .set({
        profile: {
          ...approvedSnapshot,
          preferences: {
            budgetOffTrackForecastRatio: 1.05,
            budgetWatchForecastRatio: 1.1,
          },
        },
      })
      .where(eq(domainProfileApprovals.id, approval.id));
    const invalidSnapshot = await service().getFinanceStatus(userId, {
      type: "all_outstanding",
    });

    expect(invalidSnapshot.details.health.month.rating).toBe("watch");
    expect(invalidSnapshot.details.rulebookVersion).not.toBe(first.details.rulebookVersion);
  });

  it("validates and resolves target scopes before exposing scoped details", async () => {
    const userId = await makeUser("Target Finance");
    const source = await account(userId, "current");
    const [transaction] = await database.db
      .insert(financeTransactions)
      .values({
        accountId: source.id,
        amount: 1_000,
        direction: "expense",
        merchant: "Target",
        needsReview: true,
        reconciliationStatus: "candidate",
        transactionDate: "2026-07-01",
        userId,
      })
      .returning();
    if (!transaction) throw new Error("Target fixture transaction was not created.");
    const [review] = await database.db
      .insert(financeReviewCases)
      .values({
        reason: "low_confidence",
        status: "open",
        transactionId: transaction.id,
        userId,
      })
      .returning();
    if (!review) throw new Error("Target review fixture was not created.");
    const [siblingTransaction] = await database.db
      .insert(financeTransactions)
      .values({
        accountId: source.id,
        amount: 1_500,
        direction: "expense",
        merchant: "Sibling",
        needsReview: true,
        pending: true,
        reconciliationStatus: "candidate",
        transactionDate: "2026-07-02",
        userId,
      })
      .returning();
    if (!siblingTransaction) throw new Error("Sibling transaction fixture was not created.");
    await database.db.insert(financeReviewCases).values({
      reason: "unknown_merchant",
      status: "open",
      transactionId: siblingTransaction.id,
      userId,
    });
    const distractorAccount = await account(userId, "current");
    const [distractorTransaction] = await database.db
      .insert(financeTransactions)
      .values({
        accountId: distractorAccount.id,
        amount: 9_000,
        direction: "expense",
        merchant: "Other account",
        needsReview: true,
        pending: true,
        reconciliationStatus: "candidate",
        transactionDate: "2026-07-03",
        userId,
      })
      .returning();
    if (!distractorTransaction) throw new Error("Distractor transaction fixture was not created.");
    await database.db.insert(financeReviewCases).values({
      reason: "possible_duplicate",
      status: "open",
      transactionId: distractorTransaction.id,
      userId,
    });
    await database.db.insert(financeTransactions).values({
      accountId: source.id,
      amount: 2_000,
      direction: "expense",
      merchant: "Current target month",
      needsReview: false,
      transactionDate: "2026-08-01",
      userId,
    });
    const [run] = await database.db
      .insert(workspaceMaintenanceRuns)
      .values({
        domain: "finances",
        rulebookVersion: "rules:v1",
        scope: { type: "all_outstanding" },
        status: "awaiting_approval",
        userId,
      })
      .returning();
    if (!run) throw new Error("Maintenance run fixture was not created.");

    const transactionStatus = await service().getFinanceStatus(userId, {
      entityType: "finance_transaction",
      id: transaction.id,
      type: "target",
    });
    const accountStatus = await service().getFinanceStatus(userId, {
      entityType: "finance_account",
      id: source.id,
      type: "target",
    });
    const reviewStatus = await service().getFinanceStatus(userId, {
      entityType: "finance_review_case",
      id: review.id,
      type: "target",
    });
    expect(transactionStatus.details.month.spending).toBe(20);
    expect(accountStatus.details.month.spending).toBe(20);
    expect(reviewStatus.details.month.spending).toBe(20);
    expect(transactionStatus.details.ledger).toMatchObject({
      candidateTransfers: 1,
      pendingTransactions: 0,
    });
    expect(transactionStatus.details.review).toEqual({
      byReason: { low_confidence: 1 },
      total: 1,
    });
    expect(accountStatus.details.ledger).toMatchObject({
      candidateTransfers: 2,
      pendingTransactions: 1,
    });
    expect(accountStatus.details.review).toEqual({
      byReason: { low_confidence: 1, unknown_merchant: 1 },
      total: 2,
    });
    expect(reviewStatus.details.review).toEqual({ byReason: { low_confidence: 1 }, total: 1 });
    expect(transactionStatus.activeRun).toMatchObject({ id: run.id, status: "awaiting_approval" });
    expect(transactionStatus.work.awaitingApproval).toBe(1);

    await expect(
      service().getFinanceStatus(userId, {
        entityType: "finance_budget",
        id: crypto.randomUUID(),
        type: "target",
      }),
    ).rejects.toMatchObject({ code: "invalid_request", status: 400 });
    await expect(
      service().getFinanceStatus(userId, {
        entityType: "finance_transaction",
        id: crypto.randomUUID(),
        type: "target",
      }),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });

    const otherUserId = await makeUser("Other Target Finance");
    const otherAccount = await account(otherUserId, "current");
    await expect(
      service().getFinanceStatus(userId, {
        entityType: "finance_account",
        id: otherAccount.id,
        type: "target",
      }),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
  });
});
