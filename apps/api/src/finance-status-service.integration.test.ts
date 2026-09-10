import { resolve } from "node:path";
import {
  createDatabaseClient,
  type DatabaseClient,
  domainProfileApprovals,
  domainProfiles,
  financeAccounts,
  financeAgentActionReviews,
  financeAutomationSettings,
  financeBudgetPlans,
  financeBudgets,
  financeCategories,
  financeIncomeStreams,
  financeProfiles,
  financeProviderItems,
  financeRecurringObligations,
  financeReimbursements,
  financeReviewCases,
  financeTransactionAllocations,
  financeTransactions,
  goals,
  migrateDatabase,
  users,
  workspaceMaintenanceRuns,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq, inArray } from "drizzle-orm";
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
  }, 120_000);

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
    provider: "manual" | "plaid" = "manual",
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
    const [food, reimbursement] = await database.db
      .insert(financeCategories)
      .values([
        { group: "Spending", name: "Food", slug: `food-${userId}`, userId },
        { group: "Spending", name: "Reimbursement", slug: `reimbursement-${userId}`, userId },
      ])
      .returning();
    if (!food || !reimbursement) throw new Error("Status allocation categories were not created.");
    const [expense] = await database.db
      .insert(financeTransactions)
      .values({
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
      })
      .returning();
    if (!expense) throw new Error("Status allocation expense was not created.");
    await database.db.insert(financeTransactionAllocations).values([
      {
        allocationOrder: 0,
        amount: 15_000,
        categoryId: food.id,
        transactionId: expense.id,
        treatment: "personal",
        userId,
      },
      {
        allocationOrder: 1,
        amount: 25_000,
        categoryId: reimbursement.id,
        transactionId: expense.id,
        treatment: "reimbursable",
        userId,
      },
    ]);
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
    expect(status.details.accounts.providerItems).toEqual([]);
    expect(status.details.accountRoles).toEqual({
      missingInputs: ["account_roles"],
      state: "unavailable",
    });
    expect(status.details.accounts.items[0]?.synchronization.nextRetryAt).toBeNull();
    // A reimbursable allocation becomes non-personal only once there is an
    // active reimbursement expectation; a bare allocation still belongs to us.
    expect(status.details.month.spending).toBe(400);
    expect(status.details.cashFlow.net).toBe(600);
    expect(status.details.health.confidence).toBe("reliable");
    expect(status.state).toBe("clean");
  });

  it("uses planning inclusion and ownership shares for wealth totals", async () => {
    const userId = await makeUser("Planning semantics wealth");
    const cashAccount = await account(userId, "current");
    const debtAccount = await account(userId, "current");
    const excludedInvestment = await account(userId, "current");
    const otherAccount = await account(userId, "current");

    await database.db
      .update(financeAccounts)
      .set({ ownershipShareBps: 5000, ownershipType: "joint" })
      .where(eq(financeAccounts.id, cashAccount.id));
    await database.db
      .update(financeAccounts)
      .set({ kind: "debt", ownershipShareBps: 5000, ownershipType: "joint" })
      .where(eq(financeAccounts.id, debtAccount.id));
    await database.db
      .update(financeAccounts)
      .set({
        includeInPlanning: false,
        kind: "investment",
        ownershipShareBps: 10000,
        ownershipType: "individual",
      })
      .where(eq(financeAccounts.id, excludedInvestment.id));
    await database.db
      .update(financeAccounts)
      .set({ kind: "other", ownershipShareBps: 10000, ownershipType: "individual" })
      .where(eq(financeAccounts.id, otherAccount.id));

    const status = await service().getFinanceStatus(userId, { type: "all_outstanding" });

    expect(status.details.wealth).toEqual({
      cash: 2_500,
      debt: 2_500,
      investments: 0,
      netWorth: 5_000,
      otherAssets: 5_000,
    });
    expect(status.details.health.dimensions.borrow.evidence).toEqual([
      { label: "Total debt", source: "accounts", value: 2_500 },
    ]);
  });

  it("excludes non-planning debt from borrowing evidence and APR requirements", async () => {
    const userId = await makeUser("Excluded planning debt");
    await account(userId, "current");
    const excludedDebt = await account(userId, "current");
    await database.db
      .update(financeAccounts)
      .set({
        includeInPlanning: false,
        kind: "debt",
        ownershipShareBps: 10000,
        ownershipType: "individual",
      })
      .where(eq(financeAccounts.id, excludedDebt.id));

    const status = await service().getFinanceStatus(userId, { type: "all_outstanding" });

    expect(status.details.health.dimensions.borrow).toMatchObject({
      evidence: [{ label: "Total debt", source: "accounts", value: 0 }],
      missingInputs: ["account_roles"],
      rating: "healthy",
    });
  });

  it("only scans reimbursement credits from the oldest open expense", async () => {
    const userId = await makeUser("Bounded reimbursement credits");
    const source = await account(userId, "current");
    const [category] = await database.db
      .insert(financeCategories)
      .values({ group: "Spending", name: "Meals", slug: `meals-${userId}`, userId })
      .returning();
    const [expense] = await database.db
      .insert(financeTransactions)
      .values({
        accountId: source.id,
        amount: 10_000,
        category: "Meals",
        categoryConfidence: 10000,
        categorySource: "user",
        direction: "expense",
        merchant: "Restaurant",
        needsReview: false,
        pending: false,
        transactionDate: "2026-08-10",
        userId,
      })
      .returning();
    if (!category || !expense) throw new Error("Reimbursement scan fixture was not created.");
    const [allocation] = await database.db
      .insert(financeTransactionAllocations)
      .values({
        allocationOrder: 0,
        amount: 10_000,
        categoryId: category.id,
        transactionId: expense.id,
        treatment: "reimbursable",
        userId,
      })
      .returning();
    if (!allocation) throw new Error("Reimbursement scan allocation was not created.");
    await database.db.insert(financeReimbursements).values({
      allocationId: allocation.id,
      expectedAmount: 10_000,
      receivedAmount: 0,
      rationale: "A shared dinner is expected to be repaid.",
      status: "expected",
      userId,
    });
    await database.db.insert(financeTransactions).values([
      {
        accountId: source.id,
        amount: 10_000,
        category: null,
        direction: "income",
        merchant: "Venmo shared dinner",
        pending: false,
        transactionDate: "2026-08-09",
        userId,
      },
      {
        accountId: source.id,
        amount: 10_000,
        category: null,
        direction: "income",
        merchant: "Venmo shared dinner",
        pending: false,
        transactionDate: "2026-08-11",
        userId,
      },
    ]);

    await expect(
      service().getFinanceStatus(userId, { type: "all_outstanding" }),
    ).resolves.toMatchObject({
      details: { reimbursements: { unmatchedCredits: 1 } },
    });
  });

  it("restores only a cancelled reimbursement remainder to personal spending without changing gross cash", async () => {
    const userId = await makeUser("Cancelled reimbursement");
    const source = await account(userId, "current");
    const [category] = await database.db
      .insert(financeCategories)
      .values({ group: "Spending", name: "Dining", slug: `dining-${userId}`, userId })
      .returning();
    const [expense] = await database.db
      .insert(financeTransactions)
      .values({
        accountId: source.id,
        amount: 31_000,
        direction: "expense",
        merchant: "Dinner",
        transactionDate: "2026-08-15",
        userId,
      })
      .returning();
    if (!category || !expense) throw new Error("Cancelled reimbursement fixture failed.");
    const [personal, reimbursable] = await database.db
      .insert(financeTransactionAllocations)
      .values([
        {
          allocationOrder: 0,
          amount: 9_000,
          categoryId: category.id,
          transactionId: expense.id,
          treatment: "personal",
          userId,
        },
        {
          allocationOrder: 1,
          amount: 22_000,
          categoryId: category.id,
          transactionId: expense.id,
          treatment: "reimbursable",
          userId,
        },
      ])
      .returning();
    if (!personal || !reimbursable) throw new Error("Cancelled reimbursement allocations failed.");
    await database.db.insert(financeReimbursements).values({
      allocationId: reimbursable.id,
      cancelledAt: now,
      expectedAmount: 22_000,
      receivedAmount: 10_000,
      rationale: "Payer cannot repay",
      status: "cancelled",
      userId,
    });
    await database.db.insert(financeReviewCases).values({
      rationale: "Dinner amount is materially above its robust merchant baseline.",
      reason: "possible_reimbursement",
      transactionId: expense.id,
      userId,
    });
    await expect(
      service().getFinanceStatus(userId, { type: "all_outstanding" }),
    ).resolves.toMatchObject({
      details: {
        month: { spending: 210 },
        reimbursements: { anomalies: 1, open: 0, overdue: 0 },
      },
    });
  });

  it("returns planning evidence before asking for a first budget", async () => {
    const userId = await makeUser("Planning evidence Finance");
    const source = await account(userId, "current");
    await database.db
      .insert(financeAutomationSettings)
      .values({ reviewBypassEnabled: false, userId });
    await database.db.insert(financeProfiles).values({
      effectiveDate: "2026-08-01",
      grossAnnualIncome: 72_000_00,
      householdSize: 2,
      monthlyHousingCost: 1_800_00,
      reserveTargetMonths: 3,
      userId,
    });
    await database.db.insert(financeIncomeStreams).values({
      accountId: source.id,
      amountTolerance: 0,
      cadence: "monthly",
      confidence: 10_000,
      displayName: "Salary",
      expectedAmount: 6_000_00,
      payer: "Employer",
      source: "user",
      status: "active",
      userId,
    });
    await database.db.insert(financeRecurringObligations).values({
      accountId: source.id,
      amountTolerance: 0,
      cadence: "monthly",
      confidence: 10_000,
      displayName: "Rent",
      expectedAmount: 1_800_00,
      kind: "bill",
      merchant: "Landlord",
      source: "user",
      status: "active",
      userId,
    });

    const status = await service().getFinanceStatus(userId, { type: "all_outstanding" });

    expect(status.details.reviewMode).toEqual({ reviewBypassEnabled: false });
    expect(status.details.income.stated).toMatchObject({
      basis: "user_stated",
      confidence: "high",
      value: 6_000,
    });
    expect(status.details.closeReadiness).toMatchObject({ ready: true, uncategorized: 0 });
    expect(status.details.cashFlow).toMatchObject({ projectedLowestBalance: 5_000 });
    expect(status.details.cashFlow.reserveRunwayMonths).toBeCloseTo(2.78, 2);
    expect(status.details.missingFacts).toContain("goal_priority");
    expect(status.details.interview).toEqual([
      expect.objectContaining({
        prompt: expect.stringContaining("goal"),
        why: expect.stringContaining("budget"),
      }),
    ]);
    expect(status.recommendedNextOperation).toMatchObject({ operation: "answer_finance_question" });
    expect(status.details.reimbursements).toEqual({
      anomalies: 0,
      expected: 0,
      needsInput: 0,
      open: 0,
      overdue: 0,
      outstanding: 0,
      received: 0,
      unmatchedCredits: 0,
      unresolved: 0,
    });
    expect(status.details.latestReview).toBeNull();
  });

  it("keeps partial month-to-date income visible but missing as a reliable monthly baseline", async () => {
    const userId = await makeUser("Partial income Finance");
    const source = await account(userId, "current");
    await database.db.insert(financeTransactions).values({
      accountId: source.id,
      amount: 500_00,
      category: "Income",
      categorySource: "user",
      direction: "income",
      merchant: "Partial payroll",
      needsReview: false,
      pending: false,
      transactionDate: "2026-08-01",
      userId,
    });

    const status = await service().getFinanceStatus(userId, { type: "all_outstanding" });

    expect(status.details.income.observed).toMatchObject({ basis: "ledger_observed", value: 500 });
    expect(status.details.income.monthly).toBeNull();
    expect(status.details.missingFacts).toContain("reliable_monthly_income");
    expect(status.details.questions).toContainEqual(
      expect.objectContaining({
        prompt: expect.stringContaining("reliable monthly take-home income"),
      }),
    );
  });

  it("reports biweekly expected take-home as the same normalized monthly income used for capacity", async () => {
    const userId = await makeUser("Biweekly income Finance");
    await account(userId, "current");
    await database.db.insert(financeProfiles).values({
      effectiveDate: "2026-08-01",
      expectedNetPay: 2_000_00,
      payFrequency: "biweekly",
      userId,
    });

    const status = await service().getFinanceStatus(userId, { type: "all_outstanding" });

    expect(status.details.income.monthly).toBeCloseTo(4_333.33, 2);
    expect(status.details.plan.capacity).toBeCloseTo(
      status.details.income.monthly ?? Number.NaN,
      8,
    );
    expect(status.details.missingFacts).not.toContain("reliable_monthly_income");
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
    expect(status.details.evidence.cutoff).toBe(source.updatedAt.toISOString());
  });

  it("uses the oldest current source cutoff and never invents provider transaction references", async () => {
    const userId = await makeUser("Conservative evidence Finance");
    const manual = await account(userId, "current");
    const plaid = await account(userId, "current", "plaid");
    const [item] = await database.db
      .insert(financeProviderItems)
      .values({
        encryptedCredentials: { ciphertext: "fixture", iv: "fixture", tag: "fixture", version: 1 },
        lastSyncedAt: new Date("2026-08-15T10:00:00.000Z"),
        provider: "plaid",
        providerItemId: `item-${crypto.randomUUID()}`,
        syncState: "current",
        userId,
      })
      .returning();
    if (!item) throw new Error("Provider item was not created.");
    await database.db
      .update(financeAccounts)
      .set({ providerItemRecordId: item.id })
      .where(eq(financeAccounts.id, plaid.id));
    await database.db.insert(financeTransactions).values([
      {
        accountId: manual.id,
        amount: 100,
        category: "Food",
        categorySource: "user",
        direction: "expense",
        merchant: "Resolved before exception",
        needsReview: false,
        pending: false,
        transactionDate: "2026-08-01",
        userId,
      },
      {
        accountId: manual.id,
        amount: 200,
        category: "Food",
        categorySource: "user",
        direction: "expense",
        merchant: "Pending exception",
        needsReview: false,
        pending: true,
        transactionDate: "2026-08-05",
        userId,
      },
      {
        accountId: manual.id,
        amount: 300,
        category: "Food",
        categorySource: "user",
        direction: "expense",
        merchant: "Resolved after exception",
        needsReview: false,
        pending: false,
        transactionDate: "2026-08-10",
        userId,
      },
      {
        accountId: plaid.id,
        amount: 2_000,
        category: "Income",
        categorySource: "provider",
        direction: "income",
        merchant: "Provider income without remote id",
        needsReview: false,
        pending: false,
        transactionDate: "2026-08-02",
        userId,
      },
    ]);

    const status = await service().getFinanceStatus(userId, { type: "all_outstanding" });

    expect(status.details.evidence).toEqual({
      current: true,
      cutoff: "2026-08-15T10:00:00.000Z",
    });
    expect(status.details.income.observed.sourceRefs).toEqual([]);
    expect(status.details.closeReadiness).toMatchObject({
      ready: false,
      reconciledThrough: "2026-08-02",
    });
  });

  it("uses durable budget-plan goal order and asks when no stated priority exists", async () => {
    const userId = await makeUser("Durable goal priority Finance");
    const [firstGoal, secondGoal] = await database.db
      .insert(goals)
      .values([
        { targetDate: "2026-12-01", title: "First by date", userId },
        { targetDate: "2026-09-01", title: "Second by date", userId },
      ])
      .returning();
    if (!firstGoal || !secondGoal) throw new Error("Finance goals were not created.");

    const unprioritized = await service().getFinanceStatus(userId, { type: "all_outstanding" });
    expect(unprioritized.details.prioritizedGoals).toEqual([]);
    expect(unprioritized.details.missingFacts).toContain("goal_priority");
    expect(unprioritized.details.questions).toContainEqual(
      expect.objectContaining({ prompt: expect.stringContaining("goal") }),
    );

    await database.db.insert(financeBudgetPlans).values({
      goalIds: [secondGoal.id, firstGoal.id],
      month: "2026-08",
      rationale: "Use the stated goal order.",
      userId,
    });
    const prioritized = await service().getFinanceStatus(userId, { type: "all_outstanding" });

    expect(prioritized.details.prioritizedGoals).toEqual([
      expect.objectContaining({
        goal: expect.objectContaining({ id: secondGoal.id }),
        priority: 1,
      }),
      expect.objectContaining({ goal: expect.objectContaining({ id: firstGoal.id }), priority: 2 }),
    ]);
    expect(prioritized.details.missingFacts).not.toContain("goal_priority");
    expect(prioritized.details.missingFacts).toEqual([]);
  });

  it("omits malformed durable questions instead of failing status", async () => {
    const userId = await makeUser("Malformed Finance question");
    const [question] = await database.db
      .insert(financeAgentActionReviews)
      .values({
        actionKind: "question",
        fingerprint: `malformed-${crypto.randomUUID()}`,
        privatePayload: { question: { prompt: 42 } },
        requestingAgentId: "finance-maintenance",
        userId,
      })
      .returning({ id: financeAgentActionReviews.id });
    if (!question) throw new Error("Malformed question fixture was not created.");

    const status = await service().getFinanceStatus(userId, { type: "all_outstanding" });

    expect(status.details.questions).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: question.id })]),
    );
  });

  it("projects one authoritative Provider Item across sibling accounts without trusting account shadows", async () => {
    const userId = await makeUser("Authoritative Provider Item Finance");
    const first = await account(userId, "current", "plaid");
    const second = await account(userId, "current", "plaid");
    const [item] = await database.db
      .insert(financeProviderItems)
      .values({
        encryptedCredentials: { ciphertext: "fixture", iv: "fixture", tag: "fixture", version: 1 },
        lastSyncedAt: new Date("2026-08-13T11:00:00.000Z"),
        provider: "plaid",
        providerItemId: `item-${crypto.randomUUID()}`,
        syncState: "stale",
        userId,
      })
      .returning();
    if (!item) throw new Error("Fixture Provider Item was not created.");
    await database.db
      .update(financeAccounts)
      .set({ providerItemRecordId: item.id })
      .where(inArray(financeAccounts.id, [first.id, second.id]));

    const status = await service().getFinanceStatus(userId, { type: "all_outstanding" });

    expect(status.details.accounts).toMatchObject({
      blocked: 0,
      current: 0,
      providerItems: [
        {
          accountIds: [first.id, second.id].sort(),
          id: item.id,
          provider: "plaid",
          synchronization: {
            lastSuccessAt: "2026-08-13T11:00:00.000Z",
            state: "stale",
          },
        },
      ],
      retrying: 0,
      stale: 1,
      tracked: 2,
    });
    expect(status.details.accounts.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          balance: 5_000,
          id: first.id,
          lastSyncedAt: "2026-08-13T11:00:00.000Z",
          synchronization: expect.objectContaining({ state: "stale" }),
        }),
        expect.objectContaining({
          balance: 5_000,
          id: second.id,
          lastSyncedAt: "2026-08-13T11:00:00.000Z",
          synchronization: expect.objectContaining({ state: "stale" }),
        }),
      ]),
    );
    expect(status.freshness).toMatchObject({ blockers: [], state: "stale" });
    expect(status.details.month.spending).toBeNull();
    expect(status.details.income.monthly).toBeNull();
    expect(status.details.budget.total).toBeNull();
    expect(status.details.wealth).toEqual({
      cash: null,
      debt: null,
      investments: null,
      netWorth: null,
      otherAssets: null,
    });
    expect(status.details.health.confidence).toBe("provisional");

    await database.db
      .update(financeProviderItems)
      .set({
        lastSyncedAt: now,
        syncError: null,
        syncErrorCategory: null,
        syncErrorCode: null,
        syncFailureCount: 0,
        syncRecovery: null,
        syncState: "current",
      })
      .where(eq(financeProviderItems.id, item.id));
    await expect(
      service().getFinanceStatus(userId, { type: "all_outstanding" }),
    ).resolves.toMatchObject({
      details: {
        accounts: {
          current: 1,
          items: expect.arrayContaining([
            expect.objectContaining({
              synchronization: expect.objectContaining({ state: "current" }),
            }),
          ]),
          retrying: 0,
          stale: 0,
        },
      },
      freshness: { state: "current" },
    });

    for (const lastSyncedAt of [new Date(now.getTime() - 24 * 60 * 60 * 1_000 - 1), null]) {
      await database.db
        .update(financeProviderItems)
        .set({ lastSyncedAt, syncState: "current" })
        .where(eq(financeProviderItems.id, item.id));
      await expect(
        service().getFinanceStatus(userId, { type: "all_outstanding" }),
      ).resolves.toMatchObject({
        details: {
          accounts: {
            current: 0,
            items: expect.arrayContaining([
              expect.objectContaining({
                lastSyncedAt: lastSyncedAt?.toISOString() ?? null,
                synchronization: expect.objectContaining({ state: "stale" }),
              }),
            ]),
            providerItems: [
              expect.objectContaining({
                synchronization: expect.objectContaining({ state: "stale" }),
              }),
            ],
            retrying: 0,
            stale: 1,
          },
          health: { confidence: "provisional" },
        },
        freshness: { blockers: [], state: "stale" },
      });
    }

    await database.db
      .update(financeProviderItems)
      .set({
        nextSyncAt: new Date("2026-08-15T12:05:00.000Z"),
        syncError: "Temporary provider failure.",
        syncErrorCategory: "temporary",
        syncErrorCode: "PROVIDER_DOWN",
        syncFailureCount: 1,
        syncRecovery: "automatic",
        syncState: "retrying",
      })
      .where(eq(financeProviderItems.id, item.id));
    await expect(
      service().getFinanceStatus(userId, { type: "all_outstanding" }),
    ).resolves.toMatchObject({
      details: {
        accounts: {
          current: 0,
          items: expect.arrayContaining([
            expect.objectContaining({
              synchronization: expect.objectContaining({ state: "retrying" }),
            }),
          ]),
          retrying: 1,
          stale: 0,
        },
      },
      freshness: { blockers: [], state: "stale" },
    });
  });

  it("counts a blocked Provider Item once and migration-blocks unlinked Plaid accounts", async () => {
    const userId = await makeUser("Blocked Provider Item Finance");
    const first = await account(userId, "current", "plaid");
    const second = await account(userId, "current", "plaid");
    const legacy = await account(userId, "current", "plaid");
    const [item] = await database.db
      .insert(financeProviderItems)
      .values({
        encryptedCredentials: { ciphertext: "fixture", iv: "fixture", tag: "fixture", version: 1 },
        provider: "plaid",
        providerItemId: `item-${crypto.randomUUID()}`,
        syncError: "Reconnect the linked bank.",
        syncErrorCategory: "authorization",
        syncErrorCode: "ITEM_LOGIN_REQUIRED",
        syncFailureCount: 1,
        syncRecovery: "reconnect",
        syncState: "blocked",
        userId,
      })
      .returning();
    if (!item) throw new Error("Blocked fixture Provider Item was not created.");
    await database.db
      .update(financeAccounts)
      .set({ providerItemRecordId: item.id })
      .where(inArray(financeAccounts.id, [first.id, second.id]));

    const status = await service().getFinanceStatus(userId, { type: "all_outstanding" });

    expect(status.details.accounts).toMatchObject({
      blocked: 2,
      current: 0,
      retrying: 0,
      stale: 0,
      tracked: 3,
    });
    expect(status.freshness).toMatchObject({
      blockers: [
        {
          code: "ITEM_LOGIN_REQUIRED",
          message: "Reconnect the linked bank.",
          recovery: "reconnect",
        },
        expect.objectContaining({ code: "finance_provider_item_migration_required" }),
      ],
      state: "unavailable",
    });
    expect(status.details.accounts.items.find((row) => row.id === legacy.id)).toMatchObject({
      lastSyncedAt: null,
      synchronization: {
        failureCode: "finance_provider_item_migration_required",
        recovery: "operator",
        state: "blocked",
      },
    });
  });

  it("rejects a foreign Provider Item link without exposing its synchronization evidence", async () => {
    const ownerId = await makeUser("Finance status topology owner");
    const foreignId = await makeUser("Finance status topology foreign");
    const linked = await account(ownerId, "current", "plaid");
    const [foreignItem] = await database.db
      .insert(financeProviderItems)
      .values({
        encryptedCredentials: { ciphertext: "fixture", iv: "fixture", tag: "fixture", version: 1 },
        provider: "plaid",
        providerItemId: `item-${crypto.randomUUID()}`,
        syncError: "Foreign source detail must not be disclosed.",
        syncErrorCategory: "authorization",
        syncErrorCode: "FOREIGN_PROVIDER_ITEM",
        syncFailureCount: 1,
        syncRecovery: "operator",
        syncState: "blocked",
        userId: foreignId,
      })
      .returning();
    if (!foreignItem) throw new Error("Foreign fixture Provider Item was not created.");
    await database.db
      .update(financeAccounts)
      .set({ providerItemRecordId: foreignItem.id })
      .where(eq(financeAccounts.id, linked.id));

    await expect(
      service().getFinanceStatus(ownerId, { type: "all_outstanding" }),
    ).rejects.toMatchObject({
      code: "conflict",
      message: "The Plaid connection topology is inconsistent.",
    });
  });

  it("rejects retrying Provider Items with incomplete failure recovery evidence", async () => {
    const userId = await makeUser("Invalid Provider Item failure evidence");

    await expect(
      database.pool.query(
        `INSERT INTO finance_provider_items (
          user_id, provider, provider_item_id, encrypted_credentials, sync_state,
          sync_error, sync_error_code, sync_failure_count
        ) VALUES ($1, 'plaid', $2, '{}'::jsonb, 'retrying', 'Temporary failure.', 'TEMPORARY', 1)`,
        [userId, `item-${crypto.randomUUID()}`],
      ),
    ).rejects.toMatchObject({ code: "23514" });
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
