import { resolve } from "node:path";
import {
  attentionItems,
  auditEvents,
  createDatabaseClient,
  type DatabaseClient,
  domainProfileApprovals,
  domainProfiles,
  financeAccounts,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import { createAssistantService } from "./assistant-service.js";
import { createFinanceService } from "./finance-service.js";

describe.sequential("assistant setup service", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  let finances: ReturnType<typeof createFinanceService>;
  let service: ReturnType<typeof createAssistantService>;
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
        displayName: "Setup Test",
        email: "setup@example.com",
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning();
    if (!user) throw new Error("Fixture user was not created.");
    userId = user.id;
    finances = createFinanceService({
      db: database.db,
      now: () => new Date("2026-07-28T16:00:00.000Z"),
    });
    service = createAssistantService({
      db: database.db,
      now: () => new Date("2026-07-28T15:00:00.000Z"),
      validateProfileSources: async (
        transaction,
        domain,
        profileUserId,
        sourceIds,
        status,
        actorType,
      ) => {
        if (domain === "finances") {
          await finances.validateProfileSources(
            transaction,
            profileUserId,
            sourceIds,
            status,
            actorType,
          );
        }
      },
    });
  }, 120_000);

  afterAll(async () => {
    await database.close();
    await container.stop();
  });

  const context = () => ({
    principal: {
      actorId: userId,
      actorType: "agent" as const,
      scopes: new Set(["mail:read" as const, "mail:write" as const, "calendar:read" as const]),
      userId,
    },
    requestId: "assistant-request",
  });

  it("stores versioned domain profiles and reports scoped setup status", async () => {
    await expect(service.getProfile(userId, "mail")).resolves.toBeNull();
    const profile = await service.upsertProfile(
      {
        categories: [
          {
            description: "Messages requiring the user's response.",
            examples: ["A direct question from a colleague"],
            key: "needs_reply",
            label: "Needs reply",
          },
        ],
        domain: "mail",
        instructions: ["Keep delivery problems visible."],
        objective: "Keep only high-signal mail in the inbox.",
        preferences: { inboxStyle: "signal_only", temporaryRetentionDays: 1 },
        sourceContexts: [
          {
            notes: null,
            purpose: "Personal orders and communication",
            sourceId: "personal-mail",
            sourceLabel: "Personal",
          },
        ],
        status: "draft",
        summary: "A clean, high-signal personal inbox.",
      },
      context(),
    );
    expect(profile).toMatchObject({ domain: "mail", status: "draft", version: 1 });
    await expect(service.getProfile(userId, "mail")).resolves.toMatchObject({
      id: profile.id,
      version: 1,
    });
    await expect(
      service.upsertProfile(
        {
          categories: profile.categories,
          domain: profile.domain,
          instructions: profile.instructions,
          objective: profile.objective,
          preferences: profile.preferences,
          sourceContexts: profile.sourceContexts,
          status: "active",
          summary: profile.summary,
        },
        context(),
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    for (const relatedEntityType of ["mail_account", "mail_rule"] as const) {
      await expect(
        service.createAttentionItem(
          {
            domain: "mail",
            expiresAt: null,
            importance: "high",
            kind: "follow_up",
            occursAt: null,
            relatedEntityId: userId,
            relatedEntityType,
            source: null,
            summary: "Forged Mail provenance.",
            title: "Forged Mail attention",
          },
          context(),
        ),
      ).rejects.toThrow("reserved for Mail-owned");
    }
    await expect(
      service.upsertProfile(
        {
          categories: profile.categories,
          domain: profile.domain,
          expectedVersion: profile.version,
          instructions: profile.instructions,
          objective: profile.objective,
          preferences: profile.preferences,
          sourceContexts: profile.sourceContexts,
          status: "active",
          summary: profile.summary,
        },
        context(),
      ),
    ).resolves.toMatchObject({ status: "active", version: 2 });
    const humanApproved = await service.upsertProfile(
      {
        categories: profile.categories,
        domain: profile.domain,
        expectedVersion: 2,
        instructions: profile.instructions,
        objective: profile.objective,
        preferences: profile.preferences,
        sourceContexts: profile.sourceContexts,
        status: "active",
        summary: "Human-approved Mail guidance.",
      },
      {
        principal: {
          ...context().principal,
          actorId: userId,
          actorType: "user",
        },
        requestId: "human-mail-approval",
      },
    );
    expect(humanApproved).toMatchObject({ status: "active", version: 3 });
    await expect(
      service.upsertProfile(
        {
          categories: profile.categories,
          domain: profile.domain,
          expectedVersion: 3,
          instructions: profile.instructions,
          objective: profile.objective,
          preferences: profile.preferences,
          sourceContexts: profile.sourceContexts,
          status: "active",
          summary: "Later agent-active Mail revision.",
        },
        context(),
      ),
    ).resolves.toMatchObject({ status: "active", version: 4 });
    const [preservedApproval] = await database.db
      .select()
      .from(domainProfileApprovals)
      .where(eq(domainProfileApprovals.userId, userId));
    expect(preservedApproval).toMatchObject({
      approvedByUserId: userId,
      profile: expect.objectContaining({ summary: "Human-approved Mail guidance.", version: 3 }),
      profileVersion: 3,
    });
    await expect(
      service.upsertProfile(
        {
          categories: [],
          domain: "mail",
          expectedVersion: 1,
          instructions: [],
          objective: "Stale",
          preferences: {},
          sourceContexts: [],
          status: "draft",
          summary: "Stale update",
        },
        context(),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      service.upsertProfile(
        {
          categories: [],
          domain: "calendar",
          expectedVersion: 1,
          instructions: [],
          objective: "Keep commitments accurate.",
          preferences: {},
          sourceContexts: [],
          status: "draft",
          summary: "Calendar setup.",
        },
        context(),
      ),
    ).rejects.toMatchObject({ code: "conflict", details: { currentVersion: null } });
    await database.db.insert(domainProfiles).values({
      categories: [],
      domain: "finances",
      instructions: [],
      objective: "Keep finances reviewed.",
      preferences: {},
      sourceContexts: [],
      status: "active",
      summary: "Private finance setup.",
      userId,
    });

    await expect(service.getSetupStatus(context().principal)).resolves.toMatchObject({
      domains: expect.arrayContaining([
        {
          canRead: true,
          canWrite: true,
          domain: "mail",
          profileStatus: "active",
          profileVersion: 4,
        },
        {
          canRead: true,
          canWrite: false,
          domain: "calendar",
          profileStatus: null,
          profileVersion: null,
        },
        {
          canRead: false,
          canWrite: false,
          domain: "finances",
          profileStatus: null,
          profileVersion: null,
        },
      ]),
    });
    await expect(database.db.select().from(domainProfiles)).resolves.toHaveLength(2);
  });

  it("allows source-empty Finance drafts but requires a distinct owned account to activate", async () => {
    const [financeUser] = await database.db
      .insert(users)
      .values({
        displayName: "Finance Setup",
        email: "finance-setup@example.com",
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning();
    if (!financeUser) throw new Error("Finance setup fixture user was not created.");
    const [account] = await database.db
      .insert(financeAccounts)
      .values({
        institution: "Example Bank",
        name: "Checking",
        provider: "manual",
        status: "manual",
        userId: financeUser.id,
      })
      .returning();
    if (!account) throw new Error("Finance setup fixture account was not created.");
    const financeContext = {
      principal: {
        actorId: financeUser.id,
        actorType: "agent" as const,
        scopes: new Set(["finances:read" as const, "finances:write" as const]),
        userId: financeUser.id,
      },
      requestId: "finance-profile",
    };
    const financeUserContext = {
      principal: {
        actorId: financeUser.id,
        actorType: "user" as const,
        scopes: new Set(["finances:read" as const, "finances:write" as const]),
        userId: financeUser.id,
      },
      requestId: "finance-profile-activation",
    };
    const sourceContext = {
      notes: null,
      purpose: "Bills and daily spending",
      sourceId: account.id,
      sourceLabel: "Checking",
    };
    const input = {
      categories: [],
      domain: "finances" as const,
      instructions: ["Never infer a permanent merchant rule."],
      objective: "Keep financial review trustworthy.",
      preferences: { reviewCadence: "weekly" },
      sourceContexts: [sourceContext],
      status: "draft" as const,
      summary: "Review weekly and keep uncertain transfers visible.",
    };
    await expect(
      service.upsertProfile(
        {
          ...input,
          sourceContexts: [{ ...sourceContext, sourceId: "checking" }],
        },
        financeContext,
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      service.upsertProfile(
        {
          ...input,
          sourceContexts: [{ ...sourceContext, sourceId: userId }],
        },
        financeContext,
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      service.upsertProfile(
        { ...input, sourceContexts: [sourceContext, sourceContext] },
        financeContext,
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      service.upsertProfile({ ...input, sourceContexts: [] }, financeContext),
    ).resolves.toMatchObject({
      domain: "finances",
      sourceContexts: [],
      status: "draft",
      version: 1,
    });
    await expect(
      service.upsertProfile(
        {
          ...input,
          expectedVersion: 1,
          sourceContexts: [],
          status: "active",
        },
        financeUserContext,
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      service.upsertProfile(
        {
          ...input,
          expectedVersion: 1,
          status: "active",
        },
        financeContext,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      service.upsertProfile(
        {
          ...input,
          expectedVersion: 1,
          status: "active",
        },
        financeUserContext,
      ),
    ).resolves.toMatchObject({
      domain: "finances",
      sourceContexts: [expect.objectContaining({ sourceId: account.id })],
      status: "active",
      version: 2,
    });
    await expect(
      service.upsertProfile(
        {
          ...input,
          expectedVersion: 1,
          status: "active",
        },
        financeUserContext,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    const [raceAccount] = await database.db
      .insert(financeAccounts)
      .values({
        institution: "Race Bank",
        name: "Closing account",
        provider: "manual",
        status: "manual",
        userId: financeUser.id,
      })
      .returning();
    if (!raceAccount) throw new Error("Finance race fixture account was not created.");
    const raceResults = await Promise.allSettled([
      service.upsertProfile(
        {
          ...input,
          expectedVersion: 2,
          sourceContexts: [{ ...sourceContext, sourceId: raceAccount.id }],
        },
        financeContext,
      ),
      finances.deleteAccount(raceAccount.id, {
        principal: {
          actorId: financeUser.id,
          actorType: "user",
          scopes: new Set(["finances:read", "finances:write"]),
          userId: financeUser.id,
        },
        requestId: "concurrent-account-delete",
      }),
    ]);
    expect(raceResults.filter((result) => result.status === "rejected")).toHaveLength(1);
    const [savedRaceProfile] = await database.db
      .select({ sourceContexts: domainProfiles.sourceContexts })
      .from(domainProfiles)
      .where(eq(domainProfiles.userId, financeUser.id));
    const [savedRaceAccount] = await database.db
      .select({ id: financeAccounts.id })
      .from(financeAccounts)
      .where(eq(financeAccounts.id, raceAccount.id));
    expect(
      savedRaceProfile?.sourceContexts.some((source) => source.sourceId === raceAccount.id),
    ).toBe(Boolean(savedRaceAccount));
    const orderedAccounts = await database.db
      .insert(financeAccounts)
      .values([
        {
          institution: "Ordered Bank",
          name: "First lock",
          provider: "manual",
          status: "manual",
          userId: financeUser.id,
        },
        {
          institution: "Ordered Bank",
          name: "Second lock",
          provider: "manual",
          status: "manual",
          userId: financeUser.id,
        },
      ])
      .returning();
    const currentProfile = await service.getProfile(financeUser.id, "finances");
    if (!currentProfile || orderedAccounts.length !== 2) {
      throw new Error("Ordered Finance lock fixtures were not created.");
    }
    const contexts = orderedAccounts.map((source) => ({
      ...sourceContext,
      sourceId: source.id,
      sourceLabel: source.name,
    }));
    const orderedLockResults = await Promise.allSettled([
      service.upsertProfile(
        {
          ...input,
          expectedVersion: currentProfile.version,
          sourceContexts: contexts,
        },
        financeContext,
      ),
      service.upsertProfile(
        {
          ...input,
          expectedVersion: currentProfile.version,
          sourceContexts: [...contexts].reverse(),
        },
        financeContext,
      ),
    ]);
    expect(orderedLockResults.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(orderedLockResults.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(orderedLockResults.find((result) => result.status === "rejected")).toMatchObject({
      reason: expect.objectContaining({ code: "conflict" }),
      status: "rejected",
    });
  });

  it("uses one cross-domain attention shape and audits changes", async () => {
    await expect(
      service.createAttentionItem(
        {
          domain: "mail",
          expiresAt: null,
          importance: "high",
          kind: "important",
          occursAt: null,
          relatedEntityId: userId,
          relatedEntityType: "mail_thread",
          source: {
            accountId: userId,
            provider: "google",
            remoteId: "unvalidated-thread",
            revision: null,
            sourceType: "mail_thread",
          },
          summary: "Unvalidated Mail source.",
          title: "Unsafe attention item",
        },
        context(),
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    const item = await service.createAttentionItem(
      {
        domain: "mail",
        expiresAt: null,
        importance: "high",
        kind: "follow_up",
        occursAt: "2026-07-29T15:00:00.000Z",
        relatedEntityId: null,
        relatedEntityType: null,
        source: null,
        summary: "A reply is due tomorrow.",
        title: "Reply to Ada",
      },
      context(),
    );
    await expect(
      service.listAttentionItems(userId, { domain: "mail", limit: 50, status: "open" }),
    ).resolves.toEqual([expect.objectContaining({ id: item.id, kind: "follow_up" })]);
    await expect(
      service.updateAttentionItem("mail", item.id, { status: "resolved" }, context()),
    ).resolves.toMatchObject({ status: "resolved" });
    const expiring = await service.createAttentionItem(
      {
        domain: "reminders",
        expiresAt: "2026-07-31T15:00:00.000Z",
        importance: "normal",
        kind: "run_summary",
        occursAt: null,
        relatedEntityId: null,
        relatedEntityType: null,
        source: null,
        summary: "No overdue reminders remain.",
        title: "Reminder cleanup complete",
      },
      context(),
    );
    expect(expiring).toMatchObject({
      expiresAt: "2026-07-31T15:00:00.000Z",
      occursAt: null,
    });
    await expect(
      service.updateAttentionItem("mail", userId, { status: "dismissed" }, context()),
    ).rejects.toMatchObject({ code: "not_found" });
    const storedItems = await database.db.select().from(attentionItems);
    expect(storedItems).toHaveLength(2);
    expect(storedItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: item.id, status: "resolved" }),
        expect.objectContaining({ id: expiring.id, status: "open" }),
      ]),
    );
    const events = await database.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.userId, userId));
    expect(events.map((event) => event.action)).toEqual(
      expect.arrayContaining([
        "assistant.profile.created",
        "assistant.profile.updated",
        "assistant.attention.created",
        "assistant.attention.updated",
      ]),
    );
    const sharedAudit = JSON.stringify(
      events
        .filter(
          (event) =>
            event.action.startsWith("assistant.profile.") ||
            event.action.startsWith("assistant.attention."),
        )
        .map(({ after, before }) => ({ after, before })),
    );
    for (const privateValue of [
      "Keep only high-signal mail in the inbox.",
      "Keep delivery problems visible.",
      "Personal orders and communication",
      "personal-mail",
      "A clean, high-signal personal inbox.",
      "Reply to Ada",
      "A reply is due tomorrow.",
      "Reminder cleanup complete",
      "No overdue reminders remain.",
    ]) {
      expect(sharedAudit).not.toContain(privateValue);
    }
    expect(
      events.find((event) => event.action === "assistant.profile.created")?.after,
    ).toMatchObject({
      changedFields: expect.arrayContaining([
        "categories",
        "instructions",
        "objective",
        "preferences",
        "sourceContexts",
        "status",
        "summary",
      ]),
      domain: "mail",
      sourceCount: 1,
      status: "draft",
      version: 1,
    });
    expect(events.find((event) => event.action === "assistant.attention.updated")?.after).toEqual({
      domain: "mail",
      importance: "high",
      kind: "follow_up",
      relatedEntityType: null,
      status: "resolved",
    });
  });
});
