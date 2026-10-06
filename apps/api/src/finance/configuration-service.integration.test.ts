import { resolve } from "node:path";
import {
  auditEvents,
  createDatabaseClient,
  type DatabaseClient,
  financeBudgetVersions,
  financeProfileVersions,
  financeSetupSessions,
  financesWorkspaceSettings,
  migrateDatabase,
  users,
  workspaceMaintenanceRuns,
} from "@personal-os/database";
import { updateFinanceProfileInputSchema } from "@personal-os/domain";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import { createFinanceService } from "../finance-service.js";

describe.sequential("Finance configuration ownership and read purity", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
  }, 120000);
  afterAll(async () => {
    await database?.close();
    await container?.stop();
  });
  it("returns owner-scoped data without creating setup, preferences, budgets, or execution", async () => {
    const [owner, other] = await database.db
      .insert(users)
      .values([
        { displayName: "Owner", email: "owner@example.com", passwordHash: "unused" },
        { displayName: "Other", email: "other@example.com", passwordHash: "unused" },
      ])
      .returning();
    if (!owner || !other) throw new Error("Missing fixtures");
    const service = createFinanceService({ db: database.db, now: () => new Date() });
    const principal = {
      actorId: owner.id,
      actorType: "user" as const,
      userId: owner.id,
      scopes: new Set(["finances:read", "finances:write"] as const),
    };
    await service.updateProfile(
      updateFinanceProfileInputSchema.parse({
        employer: "Owner employer",
        expectedUpdatedAt: null,
      }),
      { principal, requestId: "owner-payroll" },
    );
    for (let i = 0; i < 2; i++) {
      const own = await service.getFinanceConfiguration(owner.id);
      const foreign = await service.getFinanceConfiguration(other.id);
      expect(own.income).toMatchObject({ state: "loaded", value: { employer: "Owner employer" } });
      expect(foreign.income).toEqual({ state: "loaded", value: null });
      expect(foreign.profile).toEqual({ state: "loaded", value: null });
      expect(foreign.capabilities.budget.state).toBe("needs_input");
    }
    for (const table of [
      financeSetupSessions,
      financeBudgetVersions,
      workspaceMaintenanceRuns,
      financesWorkspaceSettings,
    ])
      expect(await database.db.select().from(table)).toHaveLength(0);
    expect(
      await database.db
        .select()
        .from(financeProfileVersions)
        .where(eq(financeProfileVersions.userId, other.id)),
    ).toHaveLength(0);
    expect(
      await database.db.select().from(auditEvents).where(eq(auditEvents.userId, other.id)),
    ).toHaveLength(0);
  });
  it("rejects stale payroll writes and does not replace monthly income on unrelated edits", async () => {
    const [owner] = await database.db
      .insert(users)
      .values({ displayName: "Payroll", email: "payroll@example.com", passwordHash: "unused" })
      .returning();
    if (!owner) throw new Error("Missing fixture");
    let clock = new Date("2026-10-06T12:00:00Z");
    const service = createFinanceService({ db: database.db, now: () => clock });
    const context = {
      principal: {
        actorId: owner.id,
        actorType: "user" as const,
        userId: owner.id,
        scopes: new Set(["finances:read", "finances:write"] as const),
      },
      requestId: "payroll-update",
    };
    const first = await service.updateProfile(
      updateFinanceProfileInputSchema.parse({
        expectedUpdatedAt: null,
        expectedNetPay: 1000,
        payFrequency: "monthly",
      }),
      context,
    );
    clock = new Date("2026-10-06T12:00:01Z");
    const second = await service.updateProfile(
      updateFinanceProfileInputSchema.parse({
        ...first,
        expectedUpdatedAt: first.updatedAt,
        employer: "New employer",
      }),
      context,
    );
    await expect(
      service.updateProfile(
        updateFinanceProfileInputSchema.parse({
          ...first,
          expectedUpdatedAt: first.updatedAt,
          role: "Stale role",
        }),
        context,
      ),
    ).rejects.toThrow("Reload before saving");
    expect((await service.getProfile(owner.id))?.employer).toBe("New employer");
    expect(second.updatedAt).not.toBe(first.updatedAt);
    const versions = await database.db
      .select()
      .from(financeProfileVersions)
      .where(eq(financeProfileVersions.userId, owner.id));
    expect(versions).toHaveLength(1);
  });
});
