import { errorMonitor, EventEmitter } from "node:events";
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
import { eq, sql } from "drizzle-orm";
import { createFinanceService } from "../finance-service.js";

describe.sequential("Finance configuration ownership and read purity", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  const pendingClientEnds = new Set<Promise<void>>();
  const connectionErrors: unknown[] = [];
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    database.pool.on("connect", (client) => {
      let settle = () => {};
      const ended = new Promise<void>((resolve) => {
        settle = resolve;
      });
      pendingClientEnds.add(ended);
      const finish = () => {
        pendingClientEnds.delete(ended);
        settle();
      };
      client.once("end", finish);
      // Monitor errors without consuming the pool/client's normal error propagation.
      EventEmitter.prototype.on.call(client, errorMonitor, (error: unknown) => {
        connectionErrors.push(error);
        finish();
      });
    });
    EventEmitter.prototype.on.call(database.pool, errorMonitor, (error: unknown) =>
      connectionErrors.push(error),
    );
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
  }, 120000);
  afterAll(async () => {
    // pool.end resolves before pg's physical client-end callbacks complete.
    const clientEnds = [...pendingClientEnds];
    try {
      await database?.close();
      await Promise.all(clientEnds);
      if (connectionErrors.length) {
        throw new AggregateError(
          connectionErrors,
          "Finance configuration fixture connection failed.",
        );
      }
    } finally {
      await container?.stop();
    }
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
  it("logs measured and safely classified configuration failures with the request identity", async () => {
    const [owner] = await database.db
      .insert(users)
      .values({
        displayName: "Diagnostic fixture",
        email: "diagnostics@example.com",
        passwordHash: "unused",
      })
      .returning();
    if (!owner) throw new Error("Missing fixture");
    const log = vi.fn();
    const service = createFinanceService({ db: database.db, now: () => new Date(), log });
    vi.spyOn(service, "getProfile").mockRejectedValue({
      cause: { code: "57014", message: "private query with account details" },
    });
    const result = await service.getFinanceConfiguration(owner.id, "configuration-diagnostic");
    expect(result.income).toEqual({ state: "unavailable" });
    expect(result.profile.state).toBe("loaded");
    const entry = log.mock.calls
      .map(([value]) => value)
      .find((value) => value.section === "income");
    expect(entry).toEqual({
      event: "finance_configuration_section_failed",
      section: "income",
      category: "timeout",
      durationMs: expect.any(Number),
      method: "GET",
      path: "/v1/finances/configuration",
      requestId: "configuration-diagnostic",
      status: 503,
    });
    expect(entry.durationMs).toBeGreaterThan(0);
    expect(JSON.stringify(log.mock.calls)).not.toContain("private");
  });
  it("cancels a blocked configuration section and releases its database work", async () => {
    const [owner] = await database.db
      .insert(users)
      .values({
        displayName: "Timeout fixture",
        email: "timeout@example.com",
        passwordHash: "unused",
      })
      .returning();
    if (!owner) throw new Error("Missing fixture");
    const blocker = await database.pool.connect();
    const log = vi.fn();
    try {
      await blocker.query("BEGIN");
      await blocker.query("LOCK TABLE finance_profile_versions IN ACCESS EXCLUSIVE MODE");
      const service = createFinanceService({ db: database.db, now: () => new Date(), log });
      const result = await service.getFinanceConfiguration(owner.id, "locked-configuration");
      expect(result.profile).toEqual({ state: "unavailable" });
      expect(result.income).toEqual({ state: "loaded", value: null });
      expect(result.accounts.state).toBe("loaded");
      expect(result.preferences.state).toBe("loaded");
      expect(result.execution).toEqual({ state: "loaded", value: null });
      expect(log).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "finance_configuration_section_failed",
          section: "profile",
          category: "timeout",
          requestId: "locked-configuration",
          durationMs: expect.any(Number),
        }),
      );
      const pending = await database.db.execute(sql`
        SELECT pid FROM pg_stat_activity
        WHERE wait_event_type = 'Lock' AND query LIKE '%finance_profile_versions%'
      `);
      expect(pending.rows).toHaveLength(0);
    } finally {
      try {
        await blocker.query("ROLLBACK");
      } finally {
        blocker.release();
      }
    }
    const recovered = await createFinanceService({
      db: database.db,
      now: () => new Date(),
    }).getFinanceConfiguration(owner.id);
    expect(recovered.profile).toEqual({ state: "loaded", value: null });
  }, 10_000);
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
        effectiveDate: "2026-10-06",
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
