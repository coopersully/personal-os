import { resolve } from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import {
  createDatabaseClient,
  type DatabaseClient,
  financeAgentSettings,
  financeBudgetAllocations,
  financeBudgetPlans,
  financeBudgetVersions,
  financeGoals,
  financeProfileVersions,
  financeSetupSessions,
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
});
