import { resolve } from "node:path";
import {
  attentionItems,
  auditEvents,
  calendarAccounts,
  calendars,
  createDatabaseClient,
  type DatabaseClient,
  domainProfileApprovals,
  domainProfiles,
  financeAccounts,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { and, eq } from "drizzle-orm";
import { createAssistantService } from "./assistant-service.js";
import { createCalendarService } from "./calendar-service.js";
import { createFinanceService } from "./finance-service.js";
import { createReminderService } from "./reminder-service.js";

describe.sequential("assistant setup service", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  let calendar: ReturnType<typeof createCalendarService>;
  let finances: ReturnType<typeof createFinanceService>;
  let reminders: ReturnType<typeof createReminderService>;
  let service: ReturnType<typeof createAssistantService>;
  let readOnlyCalendarId: string;
  let userId: string;
  let writableCalendarId: string;

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
    const [account] = await database.db
      .insert(calendarAccounts)
      .values({ label: "Local", provider: "local", userId })
      .returning();
    if (!account) throw new Error("Calendar account fixture was not created.");
    const createdCalendars = await database.db
      .insert(calendars)
      .values([
        {
          accountId: account.id,
          isWritable: true,
          name: "Personal",
          provider: "local",
          timezone: "UTC",
          userId,
        },
        {
          accountId: account.id,
          isWritable: false,
          name: "Subscribed",
          provider: "local",
          timezone: "UTC",
          userId,
        },
      ])
      .returning();
    const writable = createdCalendars.find((calendar) => calendar.isWritable);
    const readOnly = createdCalendars.find((calendar) => !calendar.isWritable);
    if (!writable || !readOnly) throw new Error("Calendar fixtures were not created.");
    writableCalendarId = writable.id;
    readOnlyCalendarId = readOnly.id;
    calendar = createCalendarService({
      connectedEvents: {
        create: vi.fn(),
        delete: vi.fn(),
        update: vi.fn(),
      } as never,
      db: database.db,
      now: () => new Date("2026-07-28T15:00:00.000Z"),
    });
    reminders = createReminderService({
      db: database.db,
      now: () => new Date("2026-07-28T15:00:00.000Z"),
    });
    service = createAssistantService({
      db: database.db,
      now: () => new Date("2026-07-28T15:00:00.000Z"),
      profileRequiresApproval: (domain) => domain === "finances",
      validateProfileSources: async (
        transaction,
        domain,
        profileUserId,
        sourceIds,
        status,
        actorType,
        preferences,
      ) => {
        if (domain === "calendar") {
          await calendar.validateProfileSources(
            transaction,
            profileUserId,
            sourceIds,
            status,
            preferences,
          );
        }
        if (domain === "reminders") {
          return reminders.validateProfileSources(
            transaction,
            profileUserId,
            sourceIds,
            status,
            preferences,
          );
        }
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
    await database.db.insert(domainProfileApprovals).values({
      approvedAt: new Date("2026-07-28T15:00:00.000Z"),
      approvedByUserId: userId,
      domain: "mail",
      profile: humanApproved,
      profileId: humanApproved.id,
      profileVersion: humanApproved.version,
      userId,
    });
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
          approvedProfileStatus: null,
          approvedProfileVersion: null,
          canRead: true,
          canWrite: true,
          domain: "mail",
          pendingDraftVersion: null,
          profileStatus: "active",
          profileVersion: 4,
        },
        {
          approvedProfileStatus: null,
          approvedProfileVersion: null,
          canRead: true,
          canWrite: false,
          domain: "calendar",
          pendingDraftVersion: null,
          profileStatus: null,
          profileVersion: null,
        },
        {
          approvedProfileStatus: null,
          approvedProfileVersion: null,
          canRead: false,
          canWrite: false,
          domain: "finances",
          pendingDraftVersion: null,
          profileStatus: null,
          profileVersion: null,
        },
      ]),
    });
    await expect(database.db.select().from(domainProfiles)).resolves.toHaveLength(2);
  });

  it("round-trips legacy Reminder drafts and persists normalized partial answers", async () => {
    const [legacy] = await database.db
      .insert(domainProfiles)
      .values({
        categories: [],
        domain: "reminders",
        instructions: [],
        objective: "Keep reminders visible.",
        preferences: {},
        sourceContexts: [],
        status: "draft",
        summary: "Legacy Reminder setup.",
        userId,
      })
      .returning();
    if (!legacy) throw new Error("Legacy Reminder profile was not created.");
    const revised = await service.upsertProfile(
      {
        categories: [],
        domain: "reminders",
        expectedVersion: legacy.version,
        instructions: [],
        objective: "Keep reminders visible.",
        preferences: { priorityHighMeaning: "  Needs attention today  " },
        sourceContexts: [],
        status: "draft",
        summary: "Partial Reminder setup.",
      },
      context(),
    );
    expect(revised.preferences).toEqual({ priorityHighMeaning: "Needs attention today" });
    await expect(
      service.upsertProfile(
        {
          categories: [],
          domain: "reminders",
          expectedVersion: revised.version,
          instructions: [],
          objective: "Keep reminders visible.",
          preferences: revised.preferences,
          sourceContexts: [],
          status: "active",
          summary: "Incomplete active setup.",
        },
        context(),
      ),
    ).rejects.toBeTruthy();

    const [legacyActiveUser] = await database.db
      .insert(users)
      .values({
        displayName: "Legacy Reminder",
        email: "legacy-reminder@example.com",
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning();
    if (!legacyActiveUser) throw new Error("Legacy Reminder user was not created.");
    const [legacyActive] = await database.db
      .insert(domainProfiles)
      .values({
        categories: [],
        domain: "reminders",
        instructions: [],
        objective: "Keep reminders visible.",
        preferences: {},
        sourceContexts: [],
        status: "active",
        summary: "Legacy active Reminder setup.",
        userId: legacyActiveUser.id,
      })
      .returning();
    if (!legacyActive) throw new Error("Legacy active Reminder profile was not created.");
    const legacyContext = {
      principal: {
        actorId: legacyActiveUser.id,
        actorType: "agent" as const,
        scopes: new Set(["reminders:read" as const, "reminders:write" as const]),
        userId: legacyActiveUser.id,
      },
      requestId: "legacy-reminder-revision",
    };
    await expect(
      service.upsertProfile(
        {
          categories: [],
          domain: "reminders",
          expectedVersion: legacyActive.version,
          instructions: ["Ask before assigning a due time."],
          objective: legacyActive.objective,
          preferences: {},
          sourceContexts: [],
          status: "active",
          summary: "Revised legacy active Reminder setup.",
        },
        legacyContext,
      ),
    ).resolves.toMatchObject({
      preferences: {},
      status: "active",
      summary: "Revised legacy active Reminder setup.",
      version: 2,
    });
    await expect(
      service.upsertProfile(
        {
          categories: [],
          domain: "reminders",
          expectedVersion: 2,
          instructions: [],
          objective: legacyActive.objective,
          preferences: { priorityHighMeaning: "Changed incomplete guidance" },
          sourceContexts: [],
          status: "active",
          summary: "Invalid changed legacy guidance.",
        },
        legacyContext,
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("treats legacy active Finance guidance without signed approval as a draft", async () => {
    const [legacyUser] = await database.db
      .insert(users)
      .values({
        displayName: "Legacy Finance",
        email: "legacy-finance@example.com",
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning();
    if (!legacyUser) throw new Error("Legacy Finance user was not created.");
    const [legacyAccount] = await database.db
      .insert(financeAccounts)
      .values({
        institution: "Legacy Bank",
        name: "Checking",
        provider: "manual",
        status: "manual",
        userId: legacyUser.id,
      })
      .returning();
    if (!legacyAccount) throw new Error("Legacy Finance account was not created.");
    await database.db.insert(domainProfiles).values({
      categories: [],
      domain: "finances",
      instructions: ["Unapproved legacy instruction."],
      objective: "Legacy objective",
      preferences: {},
      sourceContexts: [
        {
          notes: null,
          purpose: "Legacy spending",
          sourceId: legacyAccount.id,
          sourceLabel: legacyAccount.name,
        },
      ],
      status: "active",
      summary: "Legacy summary",
      userId: legacyUser.id,
    });
    await expect(service.getProfile(legacyUser.id, "finances")).resolves.toMatchObject({
      status: "draft",
      version: 1,
    });
    await expect(
      service.getSetupStatus({
        actorId: crypto.randomUUID(),
        actorType: "agent",
        scopes: new Set(["finances:read"]),
        userId: legacyUser.id,
      }),
    ).resolves.toMatchObject({
      domains: expect.arrayContaining([
        expect.objectContaining({
          approvedProfileStatus: null,
          domain: "finances",
          profileStatus: "draft",
          profileVersion: 1,
        }),
      ]),
    });
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
    const [draftOnlyAccount] = await database.db
      .insert(financeAccounts)
      .values({
        institution: "Draft Bank",
        name: "Draft-only account",
        provider: "manual",
        status: "manual",
        userId: financeUser.id,
      })
      .returning();
    if (!draftOnlyAccount) throw new Error("Draft-only Finance account was not created.");
    await expect(
      service.upsertProfile(
        {
          ...input,
          expectedVersion: 2,
          sourceContexts: [{ ...sourceContext, sourceId: draftOnlyAccount.id }],
        },
        financeContext,
      ),
    ).resolves.toMatchObject({ status: "draft", version: 3 });
    await expect(service.getSetupStatus(financeContext.principal)).resolves.toMatchObject({
      domains: expect.arrayContaining([
        {
          approvedProfileStatus: "active",
          approvedProfileVersion: 2,
          canRead: true,
          canWrite: true,
          domain: "finances",
          pendingDraftVersion: 3,
          profileStatus: "draft",
          profileVersion: 3,
        },
      ]),
    });
    await expect(finances.deleteAccount(account.id, financeUserContext)).rejects.toThrow(
      "active approved Finance guidance",
    );
    await expect(finances.deleteAccount(draftOnlyAccount.id, financeUserContext)).resolves.toBe(
      undefined,
    );
    const [profileAfterDraftAccountDelete] = await database.db
      .select()
      .from(domainProfiles)
      .where(and(eq(domainProfiles.userId, financeUser.id), eq(domainProfiles.domain, "finances")));
    expect(profileAfterDraftAccountDelete).toMatchObject({
      sourceContexts: [],
      status: "draft",
      version: 4,
    });
    const [financeApproval] = await database.db
      .select()
      .from(domainProfileApprovals)
      .where(
        and(
          eq(domainProfileApprovals.userId, financeUser.id),
          eq(domainProfileApprovals.domain, "finances"),
        ),
      );
    expect(financeApproval).toMatchObject({
      approvedByUserId: financeUser.id,
      profile: expect.objectContaining({
        sourceContexts: [expect.objectContaining({ sourceId: account.id })],
        status: "active",
        version: 2,
      }),
      profileVersion: 2,
    });
    if (!financeApproval) throw new Error("Finance approval snapshot was not saved.");
    await expect(
      database.db
        .update(domainProfileApprovals)
        .set({
          profile: {
            ...financeApproval.profile,
            id: crypto.randomUUID(),
          },
        })
        .where(eq(domainProfileApprovals.id, financeApproval.id)),
    ).rejects.toThrow();
    for (const missingField of ["id", "domain", "version", "status"] as const) {
      const invalidProfile = { ...financeApproval.profile };
      delete invalidProfile[missingField];
      await expect(
        database.db
          .update(domainProfileApprovals)
          .set({ profile: invalidProfile })
          .where(eq(domainProfileApprovals.id, financeApproval.id)),
      ).rejects.toThrow();
    }
    await expect(
      database.db
        .update(domainProfileApprovals)
        .set({
          profile: {
            ...financeApproval.profile,
            status: "draft",
          },
        })
        .where(eq(domainProfileApprovals.id, financeApproval.id)),
    ).rejects.toThrow();
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
          expectedVersion: profileAfterDraftAccountDelete?.version,
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
    expect(raceResults.filter((result) => result.status === "rejected").length).toBeLessThanOrEqual(
      1,
    );
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
      service.createAttentionItem(
        {
          domain: "reminders",
          expiresAt: null,
          importance: "high",
          kind: "follow_up",
          occursAt: null,
          relatedEntityId: crypto.randomUUID(),
          relatedEntityType: "reminder",
          source: {
            accountId: null,
            provider: "local",
            remoteId: crypto.randomUUID(),
            revision: "caller-revision",
            sourceType: "reminder",
          },
          summary: "Caller-supplied Reminder provenance.",
          title: "Forged Reminder attention",
        },
        context(),
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      service.createAttentionItem(
        {
          domain: "calendar",
          expiresAt: null,
          importance: "high",
          kind: "upcoming",
          occursAt: "2026-08-01T15:00:00.000Z",
          relatedEntityId: crypto.randomUUID(),
          relatedEntityType: "calendar_event",
          source: null,
          summary: "Caller-supplied Calendar provenance.",
          title: "Forged Calendar event",
        },
        context(),
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      service.createAttentionItem(
        {
          domain: "calendar",
          expiresAt: null,
          importance: "high",
          kind: "important",
          occursAt: null,
          relatedEntityId: null,
          relatedEntityType: null,
          source: {
            accountId: null,
            provider: "local",
            remoteId: crypto.randomUUID(),
            revision: "caller-revision",
            sourceType: "calendar_event",
          },
          summary: "Caller-supplied Calendar source.",
          title: "Forged Calendar source",
        },
        context(),
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      service.createAttentionItem(
        {
          domain: "reminders",
          expiresAt: null,
          importance: "high",
          kind: "upcoming",
          occursAt: "2026-08-01T15:00:00.000Z",
          relatedEntityId: crypto.randomUUID(),
          relatedEntityType: "calendar_event",
          source: {
            accountId: null,
            provider: "local",
            remoteId: crypto.randomUUID(),
            revision: "caller-revision",
            sourceType: "calendar_event",
          },
          summary: "Cross-domain caller-supplied Calendar provenance.",
          title: "Forged Calendar event in Reminders",
        },
        context(),
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    const unlinkedCalendarNote = await service.createAttentionItem(
      {
        domain: "calendar",
        expiresAt: null,
        importance: "normal",
        kind: "important",
        occursAt: null,
        relatedEntityId: null,
        relatedEntityType: null,
        source: null,
        summary: "An intentional unlinked Calendar note.",
        title: "Review scheduling preferences",
      },
      context(),
    );
    await expect(
      service.updateAttentionItem("mail", userId, { status: "dismissed" }, context()),
    ).rejects.toMatchObject({ code: "not_found" });
    const storedItems = await database.db.select().from(attentionItems);
    expect(storedItems).toHaveLength(3);
    expect(storedItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: item.id, status: "resolved" }),
        expect.objectContaining({ id: expiring.id, status: "open" }),
        expect.objectContaining({
          id: unlinkedCalendarNote.id,
          relatedEntityId: null,
          source: null,
          status: "open",
        }),
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

  it("validates Calendar profile sources and the default writable destination", async () => {
    const base = {
      categories: [],
      domain: "calendar" as const,
      instructions: ["Never move a hard commitment automatically."],
      objective: "Keep confirmed commitments accurate.",
      status: "active" as const,
      summary: "Personal is the default destination.",
    };
    const preferences = {
      afterBufferMinutes: 15,
      automaticEventCreation: true,
      automaticEventEvidence: ["booking"] as ["booking"],
      beforeBufferMinutes: 15,
      busyBlockPrivacy: "busy" as const,
      defaultCalendarId: writableCalendarId,
      defaultTimezone: "UTC",
    };
    await expect(
      service.upsertProfile(
        {
          ...base,
          preferences: {},
          sourceContexts: [
            {
              notes: null,
              purpose: "Unknown",
              sourceId: crypto.randomUUID(),
              sourceLabel: "Unknown",
            },
          ],
        },
        context(),
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      service.upsertProfile(
        {
          ...base,
          preferences: {},
          sourceContexts: [
            {
              notes: null,
              purpose: "Personal commitments",
              sourceId: writableCalendarId,
              sourceLabel: "Personal",
            },
          ],
        },
        context(),
      ),
    ).rejects.toThrow("complete Calendar preference contract");
    await expect(
      service.upsertProfile(
        {
          ...base,
          preferences,
          sourceContexts: [],
        },
        context(),
      ),
    ).rejects.toThrow("at least one owned Calendar source context");
    await expect(
      service.upsertProfile(
        {
          ...base,
          preferences,
          sourceContexts: [
            {
              notes: null,
              purpose: "Personal commitments",
              sourceId: writableCalendarId,
              sourceLabel: "Personal",
            },
            {
              notes: null,
              purpose: "Duplicate",
              sourceId: writableCalendarId,
              sourceLabel: "Personal again",
            },
          ],
        },
        context(),
      ),
    ).rejects.toThrow("must be unique");
    await expect(
      service.upsertProfile(
        {
          ...base,
          preferences,
          sourceContexts: [
            {
              notes: null,
              purpose: "Reference only",
              sourceId: readOnlyCalendarId,
              sourceLabel: "Subscribed",
            },
          ],
        },
        context(),
      ),
    ).rejects.toThrow("must have a source context");
    await expect(
      service.upsertProfile(
        {
          ...base,
          preferences: {
            afterBufferMinutes: 15,
            automaticEventCreation: true,
            automaticEventEvidence: ["booking"],
            beforeBufferMinutes: 15,
            busyBlockPrivacy: "busy",
            defaultCalendarId: readOnlyCalendarId,
            defaultTimezone: "UTC",
          },
          sourceContexts: [
            {
              notes: null,
              purpose: "Reference only",
              sourceId: readOnlyCalendarId,
              sourceLabel: "Subscribed",
            },
          ],
        },
        context(),
      ),
    ).rejects.toThrow("must be writable");
    await expect(
      service.upsertProfile(
        {
          ...base,
          preferences: {
            ...preferences,
            automaticEventEvidence: ["ticket", "booking", "registration"],
          },
          sourceContexts: [
            {
              notes: "Default destination",
              purpose: "Personal commitments",
              sourceId: writableCalendarId,
              sourceLabel: "Personal",
            },
            {
              notes: null,
              purpose: "Reference only",
              sourceId: readOnlyCalendarId,
              sourceLabel: "Subscribed",
            },
          ],
        },
        context(),
      ),
    ).resolves.toMatchObject({ domain: "calendar", status: "active", version: 1 });
    await database.db
      .update(domainProfiles)
      .set({
        preferences: { defaultCalendarId: writableCalendarId },
        status: "draft",
      })
      .where(and(eq(domainProfiles.userId, userId), eq(domainProfiles.domain, "calendar")));
    await calendar.deleteLocalCalendar(writableCalendarId, context());
    await expect(service.getProfile(userId, "calendar")).resolves.toMatchObject({
      sourceContexts: [
        expect.objectContaining({
          sourceId: readOnlyCalendarId,
        }),
      ],
      status: "draft",
      version: 2,
    });
  });
});
