import { resolve } from "node:path";
import {
  createDatabaseClient,
  type DatabaseClient,
  financeAgentSettings,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
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
    let response = await service.setupFinances({ operation: "start" }, context);
    expect(response.communication.nextQuestion?.id).toBe("profile:location");
    await expect(
      service.setupFinances(
        {
          answer: "Wrong question",
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
  });
});
