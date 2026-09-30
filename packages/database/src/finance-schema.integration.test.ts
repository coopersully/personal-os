import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import {
  createDatabaseClient,
  type DatabaseClient,
  financeAccountConnections,
  financeAccounts,
  financeAgentSettings,
  financeAuditFindings,
  financeBudgetAllocations,
  financeBudgetPlans,
  financeBudgets,
  financeBudgetVersions,
  financeEconomicEvents,
  financeEventTransactions,
  financeGoals,
  financeMaintenanceJudgments,
  financeMaintenanceRuns,
  financeMutationRecords,
  financeProfileVersions,
  financeReviewCases,
  financeSetupSessions,
  financeTransactionRelationships,
  financeTransactionRevisions,
  financeTransactions,
  migrateDatabase,
  users,
} from "./index.js";

describe.sequential("canonical finance persistence", () => {
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
      .values({
        displayName: "Finance persistence",
        email: "finance-persistence@example.com",
        passwordHash: "unused",
      })
      .returning();
    if (!user) throw new Error("Fixture user was not created.");
    userId = user.id;
  }, 120_000);

  afterAll(async () => {
    await database.close();
    await container.stop();
  });

  it("stores a versioned profile, balanced budget, goal, setup session, and bypass setting", async () => {
    await database.db.insert(financeAgentSettings).values({
      reviewBypassEnabled: true,
      userId,
    });

    await database.db.insert(financeProfileVersions).values({
      debts: [],
      dependents: 0,
      expectedMonthlyTakeHome: 600_000,
      householdSize: 1,
      incomeStability: "stable",
      insurance: [],
      jurisdiction: "US-NY",
      liquidReserves: 1_500_000,
      preferences: {
        bufferTarget: 100_000,
        debtPriority: "avalanche",
        emergencyReserveMonths: 6,
        notes: [],
      },
      provenance: { expectedMonthlyTakeHome: { actorType: "user", source: "setup" } },
      userId,
      version: 1,
    });

    const [goal] = await database.db
      .insert(financeGoals)
      .values({
        currentAmount: 250_000,
        deadline: "2027-08-01",
        name: "Emergency reserve",
        priority: "high",
        targetAmount: 1_000_000,
        userId,
      })
      .returning();
    if (!goal) throw new Error("Goal was not created.");

    const [plan] = await database.db
      .insert(financeBudgetPlans)
      .values({ name: "Monthly plan", userId })
      .returning();
    if (!plan) throw new Error("Budget plan was not created.");

    const [budgetVersion] = await database.db
      .insert(financeBudgetVersions)
      .values({
        allocatedTotal: 600_000,
        assumptions: ["Net income is stable."],
        balanceDelta: 0,
        effectiveFrom: "2026-09",
        expectedResources: 600_000,
        planId: plan.id,
        rationale: "Fund obligations, saving, and a buffer.",
        resources: [{ amount: 600_000, key: "take-home", kind: "income" }],
        status: "proposed",
        userId,
        version: 1,
      })
      .returning();
    if (!budgetVersion) throw new Error("Budget version was not created.");

    await database.db.insert(financeBudgetAllocations).values([
      {
        allocationKey: "living",
        amount: 450_000,
        budgetVersionId: budgetVersion.id,
        description: "Living costs",
        kind: "spending",
        userId,
      },
      {
        allocationKey: "reserve",
        amount: 150_000,
        budgetVersionId: budgetVersion.id,
        goalId: goal.id,
        kind: "goal",
        userId,
      },
    ]);

    await database.db.insert(financeSetupSessions).values({
      budgetVersionId: budgetVersion.id,
      currentQuestionKey: "budget_approval",
      status: "budget_approval",
      userId,
    });

    await expect(
      database.db.insert(financeProfileVersions).values({
        debts: [],
        incomeStability: "unknown",
        insurance: [],
        preferences: { notes: [] },
        provenance: {},
        userId,
        version: 1,
      }),
    ).rejects.toThrow();
    await expect(
      database.db.insert(financeBudgetAllocations).values({
        allocationKey: "living",
        amount: 1,
        budgetVersionId: budgetVersion.id,
        kind: "buffer",
        userId,
      }),
    ).rejects.toThrow();

    expect(
      await database.db.query.financeBudgetVersions.findFirst({
        where: eq(financeBudgetVersions.id, budgetVersion.id),
      }),
    ).toMatchObject({
      allocatedTotal: 600_000,
      balanceDelta: 0,
      expectedResources: 600_000,
      status: "proposed",
    });
    expect(
      await database.db.query.financeBudgetAllocations.findMany({
        where: eq(financeBudgetAllocations.budgetVersionId, budgetVersion.id),
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ allocationKey: "living", amount: 450_000 }),
        expect.objectContaining({ allocationKey: "reserve", amount: 150_000 }),
      ]),
    );
  });

  it("repairs canonical legacy-budget backfill without activating inferred plans", async () => {
    const [legacyUser] = await database.db
      .insert(users)
      .values({
        displayName: "Legacy budget",
        email: "legacy-budget@example.com",
        passwordHash: "unused",
      })
      .returning();
    if (!legacyUser) throw new Error("Legacy budget user was not created.");
    const [plan] = await database.db
      .insert(financeBudgetPlans)
      .values({ month: "canonical", name: "Monthly plan", userId: legacyUser.id })
      .returning();
    if (!plan) throw new Error("Canonical legacy plan was not created.");
    const createdAt = new Date("2026-08-05T12:00:00Z");
    await database.db.insert(financeBudgets).values({
      category: "Housing",
      createdAt,
      limit: 250_000,
      month: "August 2026",
      updatedAt: createdAt,
      userId: legacyUser.id,
    });

    const migration = await readFile(
      resolve(
        process.cwd(),
        "packages/database/migrations/0069_finance_legacy_budget_backfill.sql",
      ),
      "utf8",
    );
    await database.pool.query(migration);

    const version = await database.db.query.financeBudgetVersions.findFirst({
      where: eq(financeBudgetVersions.planId, plan.id),
    });
    expect(version).toMatchObject({
      allocatedTotal: 250_000,
      balanceDelta: -250_000,
      effectiveFrom: "2026-08",
      expectedResources: 0,
      status: "incomplete",
    });
    const allocations = version
      ? await database.db.query.financeBudgetAllocations.findMany({
          where: eq(financeBudgetAllocations.budgetVersionId, version.id),
        })
      : [];
    expect(allocations).toEqual([
      expect.objectContaining({ amount: 250_000, legacyCategory: "Housing" }),
    ]);
  });

  it("deduplicates active reviews while retaining ledger and resolved lineage", async () => {
    const [account] = await database.db
      .insert(financeAccounts)
      .values({ institution: "Fixture bank", name: "Checking", provider: "manual", userId })
      .returning();
    if (!account) throw new Error("Account was not created.");
    const [transaction] = await database.db
      .insert(financeTransactions)
      .values({
        accountId: account.id,
        amount: 42_00,
        direction: "expense",
        merchant: "Fixture merchant",
        transactionDate: "2026-08-22",
        userId,
      })
      .returning();
    if (!transaction) throw new Error("Transaction was not created.");
    const [event] = await database.db
      .insert(financeEconomicEvents)
      .values({ kind: "purchase", stableKey: "fixture:event-1", userId })
      .returning();
    if (!event) throw new Error("Economic event was not created.");

    await database.db.insert(financeEventTransactions).values({
      economicEventId: event.id,
      transactionId: transaction.id,
      userId,
    });
    await database.db.insert(financeTransactionRevisions).values({
      changes: { category: { after: "Dining", before: null } },
      provenance: { actorId: "agent-1", actorType: "agent", source: "agent_reasoning" },
      transactionId: transaction.id,
      userId,
      version: 1,
    });
    await database.db.insert(financeTransactionRelationships).values({
      economicEventId: event.id,
      provenance: { actorId: "agent-1", actorType: "agent", source: "agent_reasoning" },
      rationale: "Fixture relationship",
      relationship: "reimbursement",
      transactionIds: [transaction.id, transaction.id],
      userId,
    });

    const [review] = await database.db
      .insert(financeReviewCases)
      .values({
        economicEventId: event.id,
        evidence: { amountCents: transaction.amount },
        reason: "possible_duplicate",
        reasonCode: "possible_duplicate",
        stableKey: "fixture:event-1:possible_duplicate",
        transactionId: transaction.id,
        userId,
      })
      .returning();
    if (!review) throw new Error("Review was not created.");
    await expect(
      database.db.insert(financeReviewCases).values({
        economicEventId: event.id,
        reason: "possible_duplicate",
        reasonCode: "possible_duplicate",
        stableKey: "fixture:event-1:possible_duplicate",
        transactionId: transaction.id,
        userId,
      }),
    ).rejects.toThrow();
    await database.db
      .update(financeReviewCases)
      .set({ resolution: { type: "dismiss" }, resolvedAt: new Date(), status: "resolved" })
      .where(eq(financeReviewCases.id, review.id));
    await expect(
      database.db.insert(financeReviewCases).values({
        economicEventId: event.id,
        reason: "possible_duplicate",
        reasonCode: "possible_duplicate",
        reopenedFromId: review.id,
        stableKey: "fixture:event-1:possible_duplicate",
        transactionId: transaction.id,
        userId,
      }),
    ).resolves.toBeDefined();

    const [run] = await database.db
      .insert(financeMaintenanceRuns)
      .values({ scope: { type: "all_outstanding" }, stage: "agent_reasoning", userId })
      .returning();
    if (!run) throw new Error("Maintenance run was not created.");
    await database.db.insert(financeMaintenanceJudgments).values({
      judgmentKey: "classify:fixture",
      payload: { transactionId: transaction.id, type: "classify_transaction" },
      runId: run.id,
      type: "classify_transaction",
      userId,
    });
    await database.db.insert(financeAuditFindings).values({
      economicEventId: event.id,
      evidence: { amountCents: transaction.amount },
      impactAmount: transaction.amount,
      rationale: "Larger than usual.",
      reasonCode: "unusual_amount",
      runId: run.id,
      stableKey: "fixture:event-1:unusual_amount",
      userId,
    });
    await database.db.insert(financeAccountConnections).values({
      accountIds: [account.id],
      provider: "manual",
      status: "connected",
      userId,
    });

    await database.db.insert(financeMutationRecords).values({
      actorId: "agent-1",
      actorType: "agent",
      idempotencyKey: "fixture-mutation",
      operation: "classify_finance_transactions",
      requestHash: "sha256:fixture",
      response: { transactionId: transaction.id },
      status: "completed",
      userId,
    });
    await expect(
      database.db.insert(financeMutationRecords).values({
        actorType: "agent",
        idempotencyKey: "fixture-mutation",
        operation: "different_operation",
        requestHash: "sha256:different",
        status: "started",
        userId,
      }),
    ).rejects.toThrow();
  });
});
