import { resolve } from "node:path";
import {
  attentionItems,
  auditEvents,
  createDatabaseClient,
  type DatabaseClient,
  domainProfiles,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import { createAssistantService } from "./assistant-service.js";

describe.sequential("assistant setup service", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
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
    service = createAssistantService({
      db: database.db,
      now: () => new Date("2026-07-28T15:00:00.000Z"),
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
          profileVersion: 2,
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
  });

  it("uses one cross-domain attention shape and audits changes", async () => {
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
  });
});
