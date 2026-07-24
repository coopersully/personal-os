import { resolve } from "node:path";
import {
  createDatabaseClient,
  type DatabaseClient,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createGoalsService } from "./goals-service.js";
import type { Principal } from "./types.js";

const now = new Date("2026-07-19T12:00:00.000Z");

describe.sequential("goals service", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  let userId: string;
  const context = () => ({
    principal: {
      actorId: userId,
      actorType: "user",
      scopes: new Set(["goals:read", "goals:write"]),
      userId,
    } satisfies Principal,
    requestId: "goals-test",
  });

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
        displayName: "Goals",
        email: "goals@example.com",
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning();
    if (!user) throw new Error("Fixture user was not created.");
    userId = user.id;
  }, 120_000);
  afterAll(async () => {
    await database.close();
    await container.stop();
  });

  it("creates, lists, updates, and deletes private goals and motives", async () => {
    const service = createGoalsService({ db: database.db, now: () => now });
    const goal = await service.createGoal(
      { description: null, progress: 0, targetDate: null, title: "Protect focus" },
      context(),
    );
    expect(await service.listGoals(userId)).toEqual([goal]);
    await expect(
      service.updateGoal(
        goal.id,
        {
          description: "Block time for meaningful work.",
          progress: 100,
          status: "completed",
          targetDate: "2026-08-01",
          title: "Protect deep focus",
        },
        context(),
      ),
    ).resolves.toMatchObject({ progress: 100, status: "completed", title: "Protect deep focus" });
    await service.deleteGoal(goal.id, context());
    await expect(service.updateGoal(goal.id, { progress: 10 }, context())).rejects.toThrow(
      "goal was not found",
    );
    const motive = await service.createMotive({ detail: null, title: "Act with care" }, context());
    expect(await service.listMotives(userId)).toEqual([motive]);
    await expect(
      service.updateMotive(
        motive.id,
        {
          detail: "Prioritize people over performative urgency.",
          isActive: false,
          title: "Care first",
        },
        context(),
      ),
    ).resolves.toMatchObject({ isActive: false, title: "Care first" });
    await service.deleteMotive(motive.id, context());
    await expect(service.updateMotive(motive.id, { isActive: true }, context())).rejects.toThrow(
      "motive was not found",
    );
  });
});
