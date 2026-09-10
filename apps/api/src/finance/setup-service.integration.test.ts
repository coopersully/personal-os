import { resolve } from "node:path";
import {
  createDatabaseClient,
  type DatabaseClient,
  financeAgentSettings,
  financeSetupSessions,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import type { Principal } from "../types.js";
import { loadFinanceAuthorization } from "./context.js";
import { createProfileBudgetService } from "./profile-budget-service.js";
import { createSetupService } from "./setup-service.js";

describe.sequential("guided Finance setup", () => {
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
      .values({ displayName: "Setup", email: "setup@example.com", passwordHash: "unused" })
      .returning();
    if (!user) throw new Error("Fixture user was not created.");
    userId = user.id;
    await database.db.insert(financeAgentSettings).values({ reviewBypassEnabled: true, userId });
  }, 120_000);

  afterAll(async () => {
    await database.close();
    await container.stop();
  });

  it("resumes a setup proposal revised and approved through another Finance surface", async () => {
    const [owner] = await database.db
      .insert(users)
      .values({
        displayName: "Portal setup",
        email: "portal-setup@example.com",
        passwordHash: "unused",
      })
      .returning();
    if (!owner) throw new Error("Fixture user was not created.");
    const now = () => new Date("2026-08-23T20:00:00Z");
    const planning = createProfileBudgetService({ db: database.db, now });
    const service = createSetupService({ db: database.db, now, planning });
    const context = await loadFinanceAuthorization({
      db: database.db,
      principal: {
        actorId: owner.id,
        actorType: "user",
        scopes: new Set(["finances:write"]),
        userId: owner.id,
      },
      requestId: "cross-surface-setup",
    });
    await planning.updateFinancialProfile(
      {
        expectedVersion: 0,
        idempotencyKey: "cross-profile",
        changes: {
          jurisdiction: "US-NY",
          householdSize: 1,
          expectedMonthlyTakeHome: 4000,
          liquidReserves: 2000,
        },
      },
      context,
    );
    const started = await service.setupFinances({ operation: "start" }, context);
    const original = (await planning.getFinanceBudget(owner.id)).data;
    if (!original) throw new Error("Setup proposal missing.");
    const revised = await planning.reviseFinanceBudget(
      {
        planId: original.planId,
        expectedVersion: original.version,
        idempotencyKey: "cross-revise",
        effectiveFrom: original.effectiveFrom,
        name: "Updated portal plan",
        resources: original.resources,
        allocations: original.allocations,
        assumptions: original.assumptions,
        rationale: "Revised in the portal.",
      },
      context,
    );
    const resumed = await service.setupFinances(
      { operation: "resume", sessionId: started.data.sessionId },
      context,
    );
    expect(resumed.data).toMatchObject({
      budgetVersionId: revised.data.id,
      stage: "budget_approval",
      version: started.data.version + 1,
    });
    await planning.approveFinanceBudget(
      {
        budgetVersionId: revised.data.id,
        expectedVersion: revised.data.version,
        approvalSource: "user_instruction",
        idempotencyKey: "cross-approve",
      },
      context,
    );
    const ready = await service.setupFinances(
      { operation: "resume", sessionId: started.data.sessionId },
      context,
    );
    expect(ready.data).toMatchObject({
      budgetVersionId: revised.data.id,
      stage: "initial_maintenance",
      version: resumed.data.version + 1,
    });
    expect(ready.nextAction?.tool).toBe("maintain_finances");
    expect(
      (
        await service.setupFinances(
          { operation: "resume", sessionId: started.data.sessionId },
          context,
        )
      ).data.version,
    ).toBe(ready.data.version);
  });

  it("persists each answer, proposes a budget, and hands approval into maintenance", async () => {
    const now = () => new Date("2026-08-23T20:00:00Z");
    const planning = createProfileBudgetService({ db: database.db, now });
    const service = createSetupService({ db: database.db, now, planning });
    const principal: Principal = {
      actorId: "agent",
      actorType: "agent",
      scopes: new Set(["finances:write"]),
      userId,
    };
    const context = await loadFinanceAuthorization({
      db: database.db,
      principal,
      requestId: "setup",
    });
    const concurrentStarts = await Promise.all([
      service.setupFinances({ operation: "start" }, context),
      service.setupFinances({ operation: "start" }, context),
    ]);
    expect(concurrentStarts[1]?.data.sessionId).toBe(concurrentStarts[0]?.data.sessionId);
    let response = concurrentStarts[0] as NonNullable<(typeof concurrentStarts)[number]>;
    expect(response.communication.nextQuestion?.id).toBe("profile:location");
    await expect(
      service.setupFinances(
        {
          answer: "Brooklyn, New York",
          expectedVersion: response.data.version + 1,
          idempotencyKey: "setup-stale-version",
          operation: "answer",
          questionId: "profile:location",
          sessionId: response.data.sessionId,
        },
        context,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      service.setupFinances(
        {
          answer: "Wrong question",
          expectedVersion: response.data.version,
          idempotencyKey: "setup-wrong-question",
          operation: "answer",
          questionId: "profile:household_size",
          sessionId: response.data.sessionId,
        },
        context,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      service.setupFinances(
        {
          operation: "resume",
          sessionId: "00000000-0000-4000-8000-000000000000",
        },
        context,
      ),
    ).rejects.toMatchObject({ code: "not_found" });

    const answers: Record<string, string> = {
      "profile:location": "Brooklyn, New York",
      "profile:household_size": "1",
      "profile:monthly_take_home": "$8,000",
      "profile:liquid_reserves": "$20,000",
    };
    for (const [index, [questionId, answer]] of Object.entries(answers).entries()) {
      response = await service.setupFinances(
        {
          answer,
          expectedVersion: response.data.version,
          idempotencyKey: `setup-answer-${index}`,
          operation: "answer",
          questionId,
          sessionId: response.data.sessionId,
        },
        context,
      );
    }
    expect(response).toMatchObject({
      data: { budgetVersionId: expect.any(String), stage: "budget_approval" },
    });
    expect(response.communication.nextQuestion?.id).toBe("budget:approval");
    await expect(service.setupFinances({ operation: "start" }, context)).resolves.toMatchObject({
      data: { stage: "budget_approval" },
    });
    await expect(
      service.setupFinances({ operation: "resume", sessionId: response.data.sessionId }, context),
    ).resolves.toMatchObject({ data: { stage: "budget_approval" } });
    await expect(
      service.setupFinances(
        {
          approvalSource: "agent_self_approval",
          budgetVersionId: "00000000-0000-4000-8000-000000000000",
          expectedVersion: response.data.version,
          idempotencyKey: "setup-wrong-budget",
          operation: "approve_budget",
          sessionId: response.data.sessionId,
        },
        context,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    const profile = await planning.getFinancialProfile(userId);
    expect(profile.data).toMatchObject({ expectedMonthlyTakeHome: 8000, jurisdiction: "US-NY" });

    const approved = await service.setupFinances(
      {
        approvalSource: "agent_self_approval",
        budgetVersionId: response.data.budgetVersionId as string,
        expectedVersion: response.data.version,
        idempotencyKey: "setup-approve",
        operation: "approve_budget",
        sessionId: response.data.sessionId,
      },
      context,
    );
    expect(approved).toMatchObject({
      data: { stage: "initial_maintenance" },
      nextAction: { tool: "maintain_finances" },
    });
    await expect(service.setupFinances({ operation: "start" }, context)).resolves.toMatchObject({
      data: { stage: "initial_maintenance" },
      nextAction: { tool: "maintain_finances" },
    });
    await expect(
      service.setupFinances({ operation: "resume", sessionId: response.data.sessionId }, context),
    ).resolves.toMatchObject({ data: { stage: "initial_maintenance" } });

    await database.db
      .update(financeSetupSessions)
      .set({ status: "settled" })
      .where(eq(financeSetupSessions.id, response.data.sessionId));
    await expect(
      service.setupFinances({ operation: "resume", sessionId: response.data.sessionId }, context),
    ).resolves.toMatchObject({
      data: { sessionId: response.data.sessionId, stage: "settled" },
      outcome: "completed",
    });
  });
});
