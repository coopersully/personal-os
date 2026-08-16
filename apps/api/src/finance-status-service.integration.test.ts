import { resolve } from "node:path";
import {
  createDatabaseClient,
  type DatabaseClient,
  financeAccounts,
  financeBudgets,
  financeReviewCases,
  financeTransactions,
  migrateDatabase,
  users,
  workspaceMaintenanceRuns,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
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

  it("scopes detail to a window while preserving the oldest outstanding backlog time", async () => {
    const userId = await makeUser("Window Finance");
    const source = await account(userId, "current");
    const [oldTransaction, windowTransaction] = await database.db
      .insert(financeTransactions)
      .values([
        {
          accountId: source.id,
          amount: 1_000,
          direction: "expense",
          merchant: "Old",
          needsReview: true,
          transactionDate: "2026-07-01",
          userId,
        },
        {
          accountId: source.id,
          amount: 2_000,
          direction: "expense",
          merchant: "Window",
          needsReview: true,
          transactionDate: "2026-08-10",
          userId,
        },
      ])
      .returning();
    if (!oldTransaction || !windowTransaction)
      throw new Error("Fixture transactions were not created.");
    await database.db.insert(financeReviewCases).values([
      {
        createdAt: new Date("2026-07-02T00:00:00.000Z"),
        reason: "low_confidence",
        status: "open",
        transactionId: oldTransaction.id,
        userId,
      },
      {
        createdAt: new Date("2026-08-11T00:00:00.000Z"),
        reason: "unknown_merchant",
        status: "open",
        transactionId: windowTransaction.id,
        userId,
      },
    ]);

    const status = await service().getFinanceStatus(userId, {
      type: "window",
      start: "2026-08-01",
      end: "2026-08-15",
    });

    expect(status.details.review).toEqual({ byReason: { unknown_merchant: 1 }, total: 1 });
    expect(status.work.actionable).toBe(1);
    expect(status.work.oldestOutstandingAt).toBe("2026-07-02T00:00:00.000Z");
  });

  it("supports target scopes and exposes the latest active maintenance run", async () => {
    const userId = await makeUser("Target Finance");
    const source = await account(userId, "current");
    const [transaction] = await database.db
      .insert(financeTransactions)
      .values({
        accountId: source.id,
        amount: 1_000,
        direction: "expense",
        merchant: "Target",
        needsReview: false,
        transactionDate: "2026-07-01",
        userId,
      })
      .returning();
    if (!transaction) throw new Error("Target fixture transaction was not created.");
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
    const unrelatedStatus = await service().getFinanceStatus(userId, {
      entityType: "finance_budget",
      id: crypto.randomUUID(),
      type: "target",
    });

    expect(transactionStatus.details.month.spending).toBe(10);
    expect(accountStatus.details.month.spending).toBe(10);
    expect(unrelatedStatus.details.month.spending).toBe(0);
    expect(transactionStatus.activeRun).toMatchObject({ id: run.id, status: "awaiting_approval" });
    expect(transactionStatus.work.awaitingApproval).toBe(1);
  });
});
