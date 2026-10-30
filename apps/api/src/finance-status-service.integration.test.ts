import { resolve } from "node:path";
import {
  createDatabaseClient,
  type DatabaseClient,
  domainProfileApprovals,
  domainProfiles,
  executionPolicySettings,
  financeAccounts,
  financeAgentActionReviews,
  financeBudgetAllocations,
  financeBudgetPlans,
  financeBudgets,
  financeBudgetVersions,
  financeCategories,
  financeIncomeStreams,
  financeProfiles,
  financeProfileVersions,
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
import { applyFinanceCategorizationsInputSchema, financeQuestionSchema } from "@personal-os/domain";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq, inArray } from "drizzle-orm";
import { readBudgetPlanContext } from "./finance/budget-plan-projection.js";
import { createProfileBudgetService } from "./finance/profile-budget-service.js";
import { createFinanceActionService } from "./finance-action-service.js";
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

  function service(at = now) {
    return createFinanceStatusService({
      assistant: {} as never,
      db: database.db,
      finances: {} as never,
      goals: {} as never,
      maintenance: {} as never,
      now: () => at,
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

  it("uses the approved monthly plan without confusing savings with spending limits", async () => {
    const userId = await makeUser("Canonical budget status");
    await account(userId, "current");
    const [plan] = await database.db.insert(financeBudgetPlans).values({ userId }).returning();
    if (!plan) throw new Error("Missing plan");
    const [version] = await database.db
      .insert(financeBudgetVersions)
      .values({
        userId,
        planId: plan.id,
        version: 7,
        status: "active",
        effectiveFrom: "2026-08",
        expectedResources: 300000,
        allocatedTotal: 300000,
        balanceDelta: 0,
        approvedAt: now,
        rationale: "Synthetic approved plan",
      })
      .returning();
    if (!version) throw new Error("Missing version");
    await database.db.insert(financeBudgetAllocations).values([
      {
        userId,
        budgetVersionId: version.id,
        allocationKey: "spending",
        kind: "spending",
        amount: 100000,
      },
      {
        userId,
        budgetVersionId: version.id,
        allocationKey: "savings",
        kind: "savings",
        amount: 200000,
      },
    ]);
    const status = await service().getFinanceStatus(userId, { type: "all_outstanding" });
    expect(status.details.budget.approved).toBe(true);
    expect(status.details.budget.total).toBe(1000);
    expect(status.details.budget.planContext?.current).toMatchObject({
      id: version.id,
      version: 7,
      allocatedTotal: 3000,
      spendingTotal: 1000,
    });
    expect(status.details.health.missingInputs).not.toContain("approved_budget");
  });

  async function planVersion(
    userId: string,
    month: string,
    status: "active" | "retired" | "proposed" = "active",
    planId?: string,
    version = 7,
  ) {
    const [plan] = planId
      ? [{ id: planId }]
      : await database.db.insert(financeBudgetPlans).values({ userId }).returning();
    if (!plan) throw new Error("Missing plan");
    const [row] = await database.db
      .insert(financeBudgetVersions)
      .values({
        userId,
        planId: plan.id,
        version,
        status,
        effectiveFrom: month,
        expectedResources: 300000,
        allocatedTotal: 300000,
        balanceDelta: 0,
        approvedAt: status === "proposed" ? null : now,
        rationale: "Synthetic month projection",
      })
      .returning();
    if (!row) throw new Error("Missing version");
    await database.db.insert(financeBudgetAllocations).values([
      {
        userId,
        budgetVersionId: row.id,
        allocationKey: "spending",
        kind: "spending",
        amount: 100000,
      },
      {
        userId,
        budgetVersionId: row.id,
        allocationKey: "savings",
        kind: "savings",
        amount: 200000,
      },
    ]);
    return row;
  }

  it("does not treat legacy category limits as an approved allocation plan", async () => {
    const userId = await makeUser("Legacy limits only");
    await account(userId, "current");
    await database.db
      .insert(financeBudgets)
      .values({ userId, month: "2026-08", category: "Food", limit: 50000 });
    const status = await service().getFinanceStatus(userId, { type: "all_outstanding" });
    expect(status.details.budget).toMatchObject({
      approved: false,
      total: null,
      categoryLimitTotal: 500,
      planContext: { state: "missing", current: null },
    });
    expect(status.details.health.missingInputs).toContain("approved_budget");
  });

  it("keeps October approval alongside November draft without changing latest-version reads", async () => {
    const userId = await makeUser("Upcoming plan");
    const current = await planVersion(userId, "2026-10");
    // An older unapproved draft cannot become a new approval prompt.
    await planVersion(userId, "2026-10", "proposed", current.planId, 6);
    expect(
      (await readBudgetPlanContext(database.db, userId, new Date("2026-10-30T12:00:00Z"))).upcoming,
    ).toBeNull();
    const upcoming = await planVersion(userId, "2026-11", "proposed", current.planId, 8);
    const at = new Date("2026-10-30T12:00:00Z");
    const profile = createProfileBudgetService({ db: database.db, now: () => at });
    const latest = await profile.getFinanceBudget(userId, current.planId);
    expect(latest.data?.id).toBe(upcoming.id);
    expect(latest.planContext).toMatchObject({
      state: "approved",
      month: "2026-10",
      current: { id: current.id },
      upcoming: { id: upcoming.id, status: "proposed", approvedAt: null },
    });
    expect((await profile.getFinanceBudgetStatus(userId)).data?.id).toBe(current.id);
    const status = await service(at).getFinanceStatus(userId, { type: "all_outstanding" });
    expect(status.details.budget).toMatchObject({
      approved: true,
      planContext: { current: { id: current.id }, upcoming: { id: upcoming.id } },
    });
    expect(status.details.health.missingInputs).not.toContain("approved_budget");
    const future = createProfileBudgetService({
      db: database.db,
      now: () => new Date("2026-11-01T12:00:00Z"),
    });
    expect(await future.getFinanceBudgetStatus(userId)).toMatchObject({
      data: null,
      planContext: {
        month: "2026-11",
        state: "missing",
        previous: { id: current.id },
        upcoming: { id: upcoming.id },
      },
    });
  });

  it("uses the owner's planning month and never borrows a foreign or future approved plan", async () => {
    const userId = await makeUser("Budget timezone");
    const foreign = await makeUser("Foreign budget timezone");
    await database.db
      .update(users)
      .set({ planningTimezone: "America/New_York" })
      .where(eq(users.id, userId));
    const october = await planVersion(userId, "2026-10", "retired");
    await planVersion(userId, "2026-11", "active", october.planId, 8);
    await planVersion(foreign, "2026-10");
    const at = new Date("2026-11-01T02:30:00Z");
    expect(await readBudgetPlanContext(database.db, userId, at)).toMatchObject({
      month: "2026-10",
      current: { id: october.id },
      previous: null,
    });
    const status = await service(at).getFinanceStatus(userId, { type: "all_outstanding" });
    expect(status.details.budget).toMatchObject({
      approved: true,
      month: "2026-10",
      planContext: { current: { id: october.id } },
    });
    const empty = await makeUser("No owner budget");
    expect(await readBudgetPlanContext(database.db, empty, at)).toMatchObject({
      current: null,
      previous: null,
      upcoming: null,
    });
  });

  it("does not erase approval after a profile revision or expose a future approval as this month", async () => {
    const userId = await makeUser("Budget profile changes");
    const current = await planVersion(userId, "2026-08");
    await database.db
      .insert(financeProfileVersions)
      .values({ userId, version: 1, expectedMonthlyTakeHome: 400000 });
    expect(
      (await service().getFinanceStatus(userId, { type: "all_outstanding" })).details.budget,
    ).toMatchObject({ approved: true, planContext: { current: { id: current.id } } });
    const futureOwner = await makeUser("Future budget only");
    await planVersion(futureOwner, "2026-09");
    expect(await readBudgetPlanContext(database.db, futureOwner, now)).toMatchObject({
      state: "missing",
      current: null,
    });
  });

  it.each([
    "owned",
    "foreign_transaction",
    "foreign_account",
    "missing",
    "all_missing",
    "malformed",
    "empty",
    "null",
  ])("projects legacy question %s input consistently through list and status without leaking partial targets", async (kind) => {
    const userId = await makeUser(`Projection ${kind}`);
    const foreignUserId = await makeUser(`Foreign projection ${kind}`);
    const ownedAccount = await account(userId, "current");
    const foreignAccount = await account(foreignUserId, "current");
    const [ownedTransaction, target] = await database.db
      .insert(financeTransactions)
      .values([
        {
          userId,
          accountId: ownedAccount.id,
          merchant: "Owned purchase",
          direction: "expense" as const,
          amount: 100,
          transactionDate: "2026-08-10",
        },
        // These deliberately inconsistent historical rows isolate the transaction-owner
        // predicate from the account-owner predicate. Both shapes are permitted by storage.
        {
          userId: kind === "foreign_transaction" ? foreignUserId : userId,
          accountId: kind === "foreign_account" ? foreignAccount.id : ownedAccount.id,
          merchant: "Private target marker",
          direction: "expense" as const,
          amount: 200,
          transactionDate: "2026-08-10",
        },
      ])
      .returning();
    if (!ownedTransaction || !target) throw new Error("Missing projection fixture");
    const decision = (transactionId: string) => ({
      transactionId,
      categoryId: crypto.randomUUID(),
      confidence: 0.5,
      rationale: "Unverified historical proposal",
      learnMerchant: "suggest",
      expectedTransactionUpdatedAt: ownedTransaction.updatedAt.toISOString(),
    });
    const validInput = {
      decisions:
        kind === "all_missing"
          ? [decision(crypto.randomUUID())]
          : [
              decision(ownedTransaction.id),
              decision(kind === "missing" ? crypto.randomUUID() : target.id),
            ],
    };
    applyFinanceCategorizationsInputSchema.parse(validInput);
    const input =
      kind === "malformed"
        ? { decisions: [decision(ownedTransaction.id), { transactionId: "invalid" }] }
        : kind === "empty"
          ? { decisions: [] }
          : kind === "null"
            ? null
            : validInput;
    const id = crypto.randomUUID();
    const question = financeQuestionSchema.parse({
      id,
      actionKind: "categorization",
      sourceRefs: [],
      choices: [],
      prompt: "Please provide the missing Finance evidence before this change is applied.",
      why: "The categorization evidence is incomplete, low-confidence, or protected as an ambiguous transfer.",
      expectedAnswer: [
        {
          name: "decisions",
          type: "object_array",
          required: true,
          nullable: false,
          example: "[...]",
        },
      ],
    });
    const [saved] = await database.db
      .insert(financeAgentActionReviews)
      .values({
        id,
        userId,
        actionKind: "question",
        requestingAgentId: "legacy-agent",
        fingerprint: crypto.randomUUID(),
        sourceRefs: [],
        privatePayload: { question, original: { actionKind: "categorization", input } },
      })
      .returning();
    const actions = createFinanceActionService({
      db: database.db,
      finances: {} as never,
      now: () => now,
    });
    const listed = await actions.listQuestions(userId, 50, id);
    const statusQuestion = (
      await service().getFinanceStatus(userId, { type: "all_outstanding" })
    ).details.questions.find((item) => item.id === id);
    expect(listed).toHaveLength(1);
    expect(statusQuestion).toEqual(listed[0]);
    if (kind === "owned") {
      expect(listed[0]?.sourceRefs).toHaveLength(2);
      expect(listed[0]?.sourceRefs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ accountId: ownedAccount.id, remoteId: ownedTransaction.id }),
          expect.objectContaining({ accountId: ownedAccount.id, remoteId: target.id }),
        ]),
      );
    } else {
      // Exact equality also rejects partial references, changed prompts, and foreign metadata.
      expect(listed).toEqual([question]);
      expect(statusQuestion).toEqual(question);
    }
    expect(
      await database.db
        .select()
        .from(financeAgentActionReviews)
        .where(eq(financeAgentActionReviews.id, id)),
    ).toEqual([saved]);
  });

  it("reports current account and current-month evidence without manufacturing stale zeros", async () => {
    const userId = await makeUser("Current Finance");
    await planVersion(userId, "2026-08");
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

  it("includes historical flags without review rows and keeps monthly evidence isolated", async () => {
    const userId = await makeUser("Historical backlog");
    const source = await account(userId, "current");
    const otherUser = await makeUser("Other historical backlog");
    const otherSource = await account(otherUser, "current");
    const insert = async (
      date: string,
      needsReview: boolean,
      amount: number,
      direction: "expense" | "income" = "expense",
      owner = userId,
      accountId = source.id,
    ) => {
      const [row] = await database.db
        .insert(financeTransactions)
        .values({
          accountId,
          userId: owner,
          amount,
          direction,
          transactionDate: date,
          merchant: `${date}-${amount}`,
          category: "Food",
          categorySource: "user",
          needsReview,
        })
        .returning();
      if (!row) throw new Error("Missing transaction fixture");
      return row;
    };
    await insert("2026-08-01", false, 40_000);
    await insert("2026-08-15", false, 100_000, "income");
    const before = await service().getFinanceStatus(userId, { type: "all_outstanding" });
    const historical = await insert("2024-12-31", true, 900_000);
    const orphan = await insert("2025-01-01", true, 800_000);
    await insert("2025-01-03", true, 750_000);
    await insert("2025-01-02", false, 700_000, "income");
    await insert("2026-09-01", false, 600_000);
    await insert("2024-01-01", true, 500_000, "expense", otherUser, otherSource.id);
    await database.db.insert(financeReviewCases).values([
      { userId, transactionId: historical.id, reason: "unknown_merchant", status: "open" },
      { userId, transactionId: historical.id, reason: "low_confidence", status: "deferred" },
      { userId, transactionId: orphan.id, reason: "unknown_merchant", status: "resolved" },
    ]);
    const all = await service().getFinanceStatus(userId, { type: "all_outstanding" });
    expect(all.details.review).toMatchObject({
      total: 2,
      byReason: { unknown_merchant: 1, low_confidence: 1 },
    });
    expect(all.details.review.coverage).toEqual({
      scope: { type: "all_outstanding" },
      complete: true,
      flaggedTransactions: 3,
      outstandingReviewRows: 2,
      transactionsWithOutstandingReviews: 1,
    });
    expect(all.work.actionable).toBe(4);
    expect(all.details.closeReadiness.ready).toBe(false);
    expect(all.details.month).toEqual(before.details.month);
    expect(all.details.income).toEqual(before.details.income);
    expect(all.details.health).toEqual(before.details.health);
    expect(all.details.cashFlow).toEqual(before.details.cashFlow);
    const window = await service().getFinanceStatus(userId, {
      type: "window",
      start: "2025-01-01",
      end: "2025-01-01",
    });
    expect(window.details.review.total).toBe(0);
    expect(window.details.review.coverage).toEqual({
      scope: { type: "window", start: "2025-01-01", end: "2025-01-01" },
      complete: true,
      flaggedTransactions: 1,
      outstandingReviewRows: 0,
      transactionsWithOutstandingReviews: 0,
    });
    expect(window.work.actionable).toBe(1);
    expect(window.details.closeReadiness.ready).toBe(false);
    const targeted = await service().getFinanceStatus(userId, {
      type: "target",
      entityType: "finance_account",
      id: source.id,
    });
    expect(targeted.work.actionable).toBe(4);
    expect(targeted.details.month).toEqual(before.details.month);
    const transaction = await service().getFinanceStatus(userId, {
      type: "target",
      entityType: "finance_transaction",
      id: orphan.id,
    });
    expect(transaction.work.actionable).toBe(1);
    expect(transaction.details.closeReadiness.ready).toBe(false);
  });

  it.each([
    false,
    true,
  ])("uses canonical income with a missing legacy income source (legacy row: %s)", async (legacyRow) => {
    const userId = await makeUser(`Canonical only ${legacyRow}`);
    await account(userId, "current");
    if (legacyRow)
      await database.db.insert(financeProfiles).values({ userId, effectiveDate: "2026-08-01" });
    await database.db.insert(financeProfileVersions).values({
      userId,
      version: 1,
      expectedMonthlyTakeHome: 425_050,
      householdSize: 2,
    });
    const status = await service().getFinanceStatus(userId, { type: "all_outstanding" });
    expect(status.details.income.monthly).toBe(4250.5);
    expect(status.details.income.stated.value).toBe(4250.5);
    expect(status.details.plan.capacity).toBe(4250.5);
    expect(status.details.missingFacts).not.toContain("reliable_monthly_income");
    expect(status.details.missingFacts).not.toContain("household_size");
  });

  it.each([
    null,
    0,
    420_000,
  ])("uses canonical profile income %s without reviving stale legacy facts", async (income) => {
    const userId = await makeUser(`Canonical profile ${income}`);
    await account(userId, "current");
    await database.db.insert(financeProfiles).values({
      userId,
      effectiveDate: "2026-08-01",
      grossAnnualIncome: 12_000_000,
      expectedNetPay: 500_000,
      payFrequency: "monthly",
      householdSize: 8,
    });
    await database.db.insert(financeProfileVersions).values({
      userId,
      version: 1,
      expectedMonthlyTakeHome: 999_900,
      householdSize: 6,
    });
    const [canonical] = await database.db
      .insert(financeProfileVersions)
      .values({
        userId,
        version: 2,
        expectedMonthlyTakeHome: income,
        householdSize: null,
      })
      .returning();
    if (!canonical) throw new Error("Missing canonical profile");
    const otherUser = await makeUser(`Other canonical ${income}`);
    await database.db.insert(financeProfileVersions).values({
      userId: otherUser,
      version: 100,
      expectedMonthlyTakeHome: 999_900,
    });
    const status = await service().getFinanceStatus(userId, { type: "all_outstanding" });
    const expected = income === null ? null : income / 100;
    expect(status.details.income.monthly).toBe(expected);
    expect(status.details.income.stated.value).toBe(expected);
    expect(status.details.income.stated.sourceRefs[0]?.remoteId).toBe(canonical.id);
    expect(status.details.plan.capacity).toBe(expected);
    expect(status.details.missingFacts.includes("reliable_monthly_income")).toBe(income === null);
    expect(status.details.questions.some((question) => question.prompt.includes("take-home"))).toBe(
      income === null,
    );
    expect(status.details.missingFacts).toContain("household_size");
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
      dueDate: "2026-08-20",
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
      .insert(executionPolicySettings)
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
    await planVersion(userId, "2026-08");
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

    expect(status.details.review).toMatchObject({ byReason: { unknown_merchant: 1 }, total: 1 });
    expect(status.work.actionable).toBe(1);
    expect(status.work.oldestOutstandingAt).toBe("2026-06-02T00:00:00.000Z");
    expect(status.details.budget).toMatchObject({
      approved: true,
      month: "2026-08",
      total: 1_000,
      categoryLimitTotal: 1_000,
    });
    expect(status.details.month.spending).toBe(400);
    expect(status.details.month.forecast).toBeCloseTo(826.67, 2);
    expect(status.details.health.month.rating).toBe("on_track");
  });

  it("uses a preserved approved Finance profile snapshot after the live profile becomes a draft", async () => {
    const userId = await makeUser("Approved Snapshot Finance");
    await planVersion(userId, "2026-08");
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
    expect(transactionStatus.details.review).toMatchObject({
      byReason: { low_confidence: 1 },
      total: 1,
    });
    expect(accountStatus.details.ledger).toMatchObject({
      candidateTransfers: 2,
      pendingTransactions: 1,
    });
    expect(accountStatus.details.review).toMatchObject({
      byReason: { low_confidence: 1, unknown_merchant: 1 },
      total: 2,
    });
    expect(reviewStatus.details.review).toMatchObject({
      byReason: { low_confidence: 1 },
      total: 1,
    });
    expect(transactionStatus.activeRun).toMatchObject({ id: run.id, status: "awaiting_approval" });
    expect(transactionStatus.work.awaitingApproval).toBe(1);
    await database.db
      .update(workspaceMaintenanceRuns)
      .set({ status: "awaiting_agent_challenge", checkpoint: { phase: "challenge" } })
      .where(eq(workspaceMaintenanceRuns.id, run.id));
    const awaitingChallenge = await service().getFinanceStatus(userId, { type: "all_outstanding" });
    expect(awaitingChallenge.activeRun).toMatchObject({
      id: run.id,
      status: "awaiting_agent_challenge",
    });
    const otherOwner = await makeUser("Challenge status tenant isolation");
    expect(
      (await service().getFinanceStatus(otherOwner, { type: "all_outstanding" })).activeRun,
    ).toBeNull();

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
