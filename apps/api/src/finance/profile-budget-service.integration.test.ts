import { resolve } from "node:path";
import {
  createDatabaseClient,
  type DatabaseClient,
  financeAgentSettings,
  financeCategories,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import type { Principal } from "../types.js";
import { loadFinanceAuthorization } from "./context.js";
import { createProfileBudgetService } from "./profile-budget-service.js";

describe.sequential("Finance profile and budget lifecycle", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  let userId: string;
  const now = new Date("2026-08-23T20:00:00.000Z");

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
        displayName: "Finance planning",
        email: "finance-planning@example.com",
        passwordHash: "unused",
      })
      .returning();
    if (!user) throw new Error("Fixture user was not created.");
    userId = user.id;
    await database.db.insert(financeAgentSettings).values({
      reviewBypassEnabled: true,
      userId,
    });
  }, 120_000);

  afterAll(async () => {
    await database.close();
    await container.stop();
  });

  it("persists profile answers and activates a balanced successor budget", async () => {
    const service = createProfileBudgetService({ db: database.db, now: () => now });
    const principal: Principal = {
      actorId: "finance-agent",
      actorType: "agent",
      scopes: new Set(["finances:read", "finances:write"]),
      userId,
    };
    const context = await loadFinanceAuthorization({
      db: database.db,
      principal,
      requestId: "planning-request",
    });
    const profile = await service.updateFinancialProfile(
      {
        changes: {
          expectedMonthlyTakeHome: 8_000,
          householdSize: 1,
          incomeStability: "stable",
        },
        expectedVersion: 0,
        idempotencyKey: "profile-1",
      },
      context,
    );
    expect(profile.data.version).toBe(1);

    const [housing] = await database.db
      .insert(financeCategories)
      .values({ group: "Needs", name: "Housing", slug: "housing", userId })
      .returning();
    if (!housing) throw new Error("Housing category was not created.");
    const goalResult = await service.manageFinanceGoal(
      {
        deadline: "2027-08-01",
        idempotencyKey: "goal-1",
        name: "Emergency reserve",
        operation: "create",
        priority: "high",
        targetAmount: 12_000,
      },
      context,
    );
    const goal = goalResult.data;

    const proposed = await service.createFinanceBudget(
      {
        allocations: [
          { amount: 5_800, categoryId: housing.id, key: "living", kind: "spending" },
          { amount: 2_000, goalId: goal.id, key: "reserve", kind: "goal" },
          { amount: 200, key: "buffer", kind: "buffer" },
        ],
        assumptions: ["Take-home pay remains stable."],
        effectiveFrom: "2026-09",
        idempotencyKey: "budget-1",
        name: "Monthly plan",
        rationale: "Cover living costs, build reserves, and retain a buffer.",
        resources: [{ amount: 8_000, key: "take-home", kind: "income" }],
      },
      context,
    );
    expect(proposed.data).toMatchObject({ balanceDelta: 0, status: "proposed", version: 1 });
    expect(proposed.communication.requiredDisclosures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining("$8,000") }),
      ]),
    );

    const active = await service.approveFinanceBudget(
      {
        approvalSource: "agent_self_approval",
        budgetVersionId: proposed.data.id,
        expectedVersion: proposed.data.version,
        idempotencyKey: "approve-1",
      },
      context,
    );
    expect(active.data).toMatchObject({ balanceDelta: 0, status: "active" });

    const revised = await service.reviseFinanceBudget(
      {
        allocations: [
          { amount: 5_500, categoryId: housing.id, key: "living", kind: "spending" },
          { amount: 2_200, goalId: goal.id, key: "reserve", kind: "goal" },
          { amount: 300, key: "buffer", kind: "buffer" },
        ],
        assumptions: [],
        effectiveFrom: "2026-09",
        expectedVersion: active.data.version,
        idempotencyKey: "budget-2",
        name: "Monthly plan",
        planId: active.data.planId,
        rationale: "Increase savings while preserving a buffer.",
        resources: [{ amount: 8_000, key: "take-home", kind: "income" }],
      },
      context,
    );
    await database.db
      .update(financeAgentSettings)
      .set({ reviewBypassEnabled: false, version: 2 })
      .where(eq(financeAgentSettings.userId, userId));
    const noBypass = await loadFinanceAuthorization({
      db: database.db,
      principal,
      requestId: "planning-request-2",
    });
    await expect(
      service.approveFinanceBudget(
        {
          approvalSource: "agent_self_approval",
          budgetVersionId: revised.data.id,
          expectedVersion: revised.data.version,
          idempotencyKey: "approve-2-denied",
        },
        noBypass,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      service.approveFinanceBudget(
        {
          approvalSource: "user_instruction",
          budgetVersionId: revised.data.id,
          expectedVersion: revised.data.version,
          idempotencyKey: "approve-2",
        },
        noBypass,
      ),
    ).resolves.toMatchObject({ data: { status: "active", version: 2 } });

    await expect(service.getFinancialProfile(userId)).resolves.toMatchObject({
      data: { version: 1 },
    });
    await expect(service.getFinanceBudget(userId, active.data.planId)).resolves.toMatchObject({
      data: { version: 2 },
    });
    await expect(service.getFinanceBudgetStatus(userId)).resolves.toMatchObject({
      data: { status: "active", version: 2 },
    });
    await expect(service.listFinanceGoals(userId)).resolves.toMatchObject({
      data: [expect.objectContaining({ id: goal.id })],
    });
    const updatedGoal = await service.manageFinanceGoal(
      {
        changes: { name: "Six-month reserve", targetAmount: 15_000 },
        expectedVersion: 1,
        goalId: goal.id,
        idempotencyKey: "goal-update",
        operation: "update",
      },
      noBypass,
    );
    const pausedGoal = await service.manageFinanceGoal(
      {
        expectedVersion: updatedGoal.data.version,
        goalId: goal.id,
        idempotencyKey: "goal-pause",
        operation: "pause",
      },
      noBypass,
    );
    const resumedGoal = await service.manageFinanceGoal(
      {
        expectedVersion: pausedGoal.data.version,
        goalId: goal.id,
        idempotencyKey: "goal-resume",
        operation: "resume",
      },
      noBypass,
    );
    await expect(
      service.manageFinanceGoal(
        {
          expectedVersion: resumedGoal.data.version,
          goalId: goal.id,
          idempotencyKey: "goal-complete",
          operation: "complete",
        },
        noBypass,
      ),
    ).resolves.toMatchObject({ data: { status: "completed" } });
  });

  it("rejects an unbalanced budget proposal", async () => {
    const service = createProfileBudgetService({ db: database.db, now: () => now });
    const context = await loadFinanceAuthorization({
      db: database.db,
      principal: {
        actorId: userId,
        actorType: "user",
        scopes: new Set(["finances:write"]),
        userId,
      },
      requestId: "unbalanced",
    });
    await expect(
      service.createFinanceBudget(
        {
          allocations: [{ amount: 900, key: "buffer", kind: "buffer" }],
          assumptions: [],
          effectiveFrom: "2026-10",
          idempotencyKey: "unbalanced-budget",
          name: "Unbalanced",
          rationale: "Fixture",
          resources: [{ amount: 1_000, key: "income", kind: "income" }],
        },
        context,
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });
});
