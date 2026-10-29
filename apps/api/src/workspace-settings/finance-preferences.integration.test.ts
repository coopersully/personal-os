import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  createDatabaseClient,
  type DatabaseClient,
  financeAccounts,
  financeBudgetPlans,
  financeGoals,
  financeOnboardingLegacyAccess,
  financeProfiles,
  financeProfileVersions,
  financeSetupSessions,
  financesWorkspaceSettings,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq, sql } from "drizzle-orm";
import type { Principal } from "../types.js";
import { createWorkspaceSettingsService } from "./service.js";

describe.sequential("Finance preferences and migration-time access", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  let staging: string;
  let legacyId: string;
  let emptyId: string;
  let seededIds: string[];
  let settings: ReturnType<typeof createWorkspaceSettingsService>;
  const context = (userId: string) => ({
    principal: {
      userId,
      actorId: userId,
      actorType: "user",
      scopes: new Set(["finances:read", "finances:write"]),
    } as Principal,
    requestId: "finance-preferences-proof",
  });

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    staging = await mkdtemp(resolve(tmpdir(), "finance-preferences-migrations-"));
    const migrations = resolve(process.cwd(), "packages/database/migrations");
    await cp(migrations, staging, { recursive: true });
    const journalPath = resolve(staging, "meta/_journal.json");
    const journal = JSON.parse(await readFile(journalPath, "utf8"));
    journal.entries = journal.entries.filter(
      (entry: { tag: string }) => Number(entry.tag.slice(0, 4)) < 118,
    );
    await writeFile(journalPath, JSON.stringify(journal));
    await migrateDatabase(database.db, staging);
    const owners = await database.db
      .insert(users)
      .values([
        { email: "finance-legacy@example.com", displayName: "Legacy", passwordHash: "unused" },
        { email: "finance-empty@example.com", displayName: "Empty", passwordHash: "unused" },
      ])
      .returning();
    if (!owners[0] || !owners[1]) throw new Error("Missing migration owners");
    legacyId = owners[0].id;
    emptyId = owners[1].id;
    // Use pre-migration columns only: current schema correctly includes fields not yet present.
    await database.db.execute(sql`INSERT INTO finances_workspace_settings
      (user_id,revision,finance_transaction_view,finance_transaction_group,spend_account_ids)
      VALUES (${legacyId},7,'table','none',ARRAY[]::uuid[])`);
    // A partially started Finance session is approved legacy access evidence, not completion.
    await database.db.insert(financeSetupSessions).values({ userId: legacyId });
    const additional = await database.db
      .insert(users)
      .values(
        ["account", "plan", "goal", "profile", "version", "provider"].map((kind) => ({
          email: `finance-legacy-${kind}@example.com`,
          displayName: kind,
          passwordHash: "unused",
        })),
      )
      .returning();
    const owner = (index: number) => {
      const row = additional[index];
      if (!row) throw new Error("Missing source fixture owner");
      return row.id;
    };
    await database.db
      .insert(financeAccounts)
      .values({ userId: owner(0), provider: "manual", institution: "Fixture", name: "Cash" });
    await database.db.insert(financeBudgetPlans).values({ userId: owner(1), name: "Plan" });
    await database.db
      .insert(financeGoals)
      .values({ userId: owner(2), name: "Goal", targetAmount: 10000, priority: "high" });
    await database.db
      .insert(financeProfiles)
      .values({ userId: owner(3), effectiveDate: "2026-10-18" });
    await database.db.insert(financeProfileVersions).values({
      userId: owner(4),
      version: 1,
      debts: [],
      incomeStability: "unknown",
      insurance: [],
      preferences: { notes: [] },
      provenance: {},
    });
    // This evidence has no account or transaction, independently exercising provider-only access.
    await database.db.execute(sql`INSERT INTO finance_provider_items
      (user_id,provider,provider_item_id,encrypted_credentials)
      VALUES (${owner(5)},'plaid','legacy-provider-only','{}'::jsonb)`);
    seededIds = [legacyId, ...additional.map((row) => row.id)];
    await migrateDatabase(database.db, migrations);
    settings = createWorkspaceSettingsService(database.db);
  }, 120_000);

  afterAll(async () => {
    await database?.close();
    await container?.stop();
    if (staging) await rm(staging, { recursive: true, force: true });
  });

  it("defaults new persisted settings to List while preserving legacy view choices", async () => {
    const [owner] = await database.db
      .insert(users)
      .values({
        email: "finance-list-default@example.com",
        displayName: "List default",
        passwordHash: "unused",
      })
      .returning();
    if (!owner) throw new Error("Missing owner");
    const [row] = await database.db
      .insert(financesWorkspaceSettings)
      .values({ userId: owner.id })
      .returning();
    expect(row?.financeSpendingView).toBe("list");
    expect(row?.financeSpendingPeriod).toBe("week");
    expect(row?.financeSpendingGrouping).toBe("auto");
    expect((await settings.get(owner.id, "finances")).preferences.financeSpendingView).toBe("list");
    expect((await settings.get(legacyId, "finances")).preferences.financeSpendingView).toBe(
      "bubbles",
    );
  });

  it("adds defaults without changing existing revision or explicit empty account selection", async () => {
    expect(await settings.get(legacyId, "finances")).toMatchObject({
      revision: 7,
      preferences: {
        spendAccountIds: [],
        financeManualVisibility: "auto",
        financeSpendingView: "bubbles",
        financeSpendingGrouping: "auto",
        financeSpendingIncludePending: true,
        financeSpendingIncludeUncategorized: true,
        financeSpendingBasis: "personal_cost",
        financeSpendingSubtractRefunds: true,
        financeSpendingPeriod: "month",
      },
    });
    expect((await settings.get(emptyId, "finances")).revision).toBe(0);
  });

  it("persists all fields, rereads them, and preserves omitted fields on partial updates", async () => {
    const saved = await settings.update(
      "finances",
      {
        expectedRevision: 7,
        preferences: {
          financeManualVisibility: "hide",
          financeSpendingView: "rhythm",
          financeSpendingGrouping: "categories",
          financeSpendingIncludePending: false,
          financeSpendingIncludeUncategorized: false,
          financeSpendingBasis: "full_outflow",
          financeSpendingSubtractRefunds: false,
          financeSpendingPeriod: "week",
        },
      },
      context(legacyId),
    );
    expect(saved.revision).toBe(8);
    expect(await settings.get(legacyId, "finances")).toEqual(saved);
    const partial = await settings.update(
      "finances",
      { expectedRevision: 8, preferences: { financeSpendingView: "list" } },
      context(legacyId),
    );
    expect(partial.preferences).toEqual({ ...saved.preferences, financeSpendingView: "list" });
    expect(await settings.get(legacyId, "finances")).toEqual(partial);
    await expect(
      settings.update(
        "finances",
        { expectedRevision: 8, preferences: { financeSpendingView: "bubbles" } },
        context(legacyId),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(await settings.get(legacyId, "finances")).toEqual(partial);
  });

  it("isolates owners and permits exactly one concurrent expected-revision writer", async () => {
    const results = await Promise.allSettled(
      ["trends", "rhythm"].map((financeSpendingView) =>
        settings.update(
          "finances",
          { expectedRevision: 0, preferences: { financeSpendingView } },
          context(emptyId),
        ),
      ),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect((await settings.get(emptyId, "finances")).revision).toBe(1);
    expect((await settings.get(legacyId, "finances")).preferences.financeSpendingView).toBe("list");
  });

  it("seeds only pre-migration Finance owners without completing onboarding or granting future records", async () => {
    const grants = await database.db.select().from(financeOnboardingLegacyAccess);
    expect(grants.map((row) => row.userId).sort()).toEqual([...seededIds].sort());
    expect(grants.every((row) => row.provenance === "finance_records_at_migration")).toBe(true);
    const [session] = await database.db
      .select()
      .from(financeSetupSessions)
      .where(eq(financeSetupSessions.userId, legacyId));
    expect(session?.status).toBe("collecting_profile");
    await database.db.insert(financeSetupSessions).values({ userId: emptyId });
    expect(
      await database.db
        .select()
        .from(financeOnboardingLegacyAccess)
        .where(eq(financeOnboardingLegacyAccess.userId, emptyId)),
    ).toEqual([]);
    await expect(
      database.db
        .update(financeOnboardingLegacyAccess)
        .set({ grantedAt: new Date(0) })
        .where(eq(financeOnboardingLegacyAccess.userId, legacyId)),
    ).rejects.toThrow();
  });

  it("enforces database enum constraints and cascades owner deletion", async () => {
    await expect(
      database.db
        .update(financesWorkspaceSettings)
        .set({ financeSpendingView: "invalid" })
        .where(eq(financesWorkspaceSettings.userId, legacyId)),
    ).rejects.toThrow();
    await expect(
      database.db
        .delete(financeOnboardingLegacyAccess)
        .where(eq(financeOnboardingLegacyAccess.userId, legacyId)),
    ).rejects.toThrow();
    expect(
      await database.db
        .select()
        .from(financeOnboardingLegacyAccess)
        .where(eq(financeOnboardingLegacyAccess.userId, legacyId)),
    ).toHaveLength(1);
    await database.db.delete(users).where(eq(users.id, legacyId));
    expect(
      await database.db
        .select()
        .from(financeOnboardingLegacyAccess)
        .where(eq(financeOnboardingLegacyAccess.userId, legacyId)),
    ).toEqual([]);
  });
});
