import { resolve } from "node:path";
import {
  auditEvents,
  calendarAccounts,
  calendarEvents,
  calendars,
  createDatabaseClient,
  type DatabaseClient,
  domainProfiles,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import { createCalendarService } from "./calendar-service.js";
import type { Principal } from "./types.js";

const timestamp = new Date("2026-07-28T15:00:00.000Z");

describe.sequential("Calendar commitment proposals", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  let localCalendarId: string;
  let profileId: string;
  let remoteAccountId: string;
  let remoteCalendarId: string;
  let service: ReturnType<typeof createCalendarService>;
  let userId: string;
  const gateway = {
    create: vi.fn(async () => ({
      allDay: false,
      conferenceUrl: null,
      endsAt: new Date("2026-08-01T17:00:00.000Z"),
      etag: "remote-etag-new",
      location: null,
      notes: null,
      raw: { id: "remote-duplicate" },
      recurrence: [],
      remoteEventId: "remote-duplicate",
      startsAt: new Date("2026-08-01T16:00:00.000Z"),
      status: "confirmed" as const,
      timezone: "UTC",
      title: "Provider reservation",
    })),
    delete: vi.fn(async () => undefined),
    update: vi.fn(async () => {
      throw new Error("not used");
    }),
  };
  const context = () => ({
    principal: {
      actorId: userId,
      actorType: "user",
      scopes: new Set(["calendar:read", "calendar:write"]),
      userId,
    } satisfies Principal,
    requestId: "calendar-proposal-test",
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
        displayName: "Calendar",
        email: "calendar-proposal@example.com",
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning();
    if (!user) throw new Error("User fixture was not created.");
    userId = user.id;
    const [localAccount] = await database.db
      .insert(calendarAccounts)
      .values({ label: "Local", provider: "local", userId })
      .returning();
    const [remoteAccount] = await database.db
      .insert(calendarAccounts)
      .values({
        label: "Google",
        lastSyncedAt: timestamp,
        provider: "google",
        providerAccountId: "google-calendar-proposal",
        syncStatus: "idle",
        userId,
      })
      .returning();
    if (!localAccount || !remoteAccount) throw new Error("Account fixtures were not created.");
    remoteAccountId = remoteAccount.id;
    const [localCalendar] = await database.db
      .insert(calendars)
      .values({
        accountId: localAccount.id,
        isPrimary: true,
        isWritable: true,
        name: "Personal",
        provider: "local",
        timezone: "UTC",
        userId,
      })
      .returning();
    const [remoteCalendar] = await database.db
      .insert(calendars)
      .values({
        accountId: remoteAccount.id,
        isWritable: true,
        lastSyncedAt: timestamp,
        name: "Connected",
        provider: "google",
        remoteCalendarId: "remote-calendar",
        timezone: "UTC",
        userId,
      })
      .returning();
    const [secondRemoteCalendar] = await database.db
      .insert(calendars)
      .values({
        accountId: remoteAccount.id,
        isWritable: true,
        lastSyncedAt: timestamp,
        name: "Connected team",
        provider: "google",
        remoteCalendarId: "remote-calendar-2",
        timezone: "UTC",
        userId,
      })
      .returning();
    if (!localCalendar || !remoteCalendar || !secondRemoteCalendar)
      throw new Error("Calendar fixtures were not created.");
    localCalendarId = localCalendar.id;
    remoteCalendarId = remoteCalendar.id;
    const [profile] = await database.db
      .insert(domainProfiles)
      .values({
        categories: [],
        domain: "calendar",
        instructions: ["Never move hard events automatically."],
        objective: "Keep confirmed commitments accurate.",
        preferences: {
          afterBufferMinutes: 15,
          automaticEventCreation: true,
          automaticEventEvidence: ["ticket", "booking", "registration"],
          beforeBufferMinutes: 15,
          busyBlockPrivacy: "busy",
          defaultCalendarId: localCalendar.id,
          defaultTimezone: "UTC",
        },
        sourceContexts: [
          {
            notes: null,
            purpose: "Personal commitments",
            sourceId: localCalendar.id,
            sourceLabel: "Personal",
          },
        ],
        status: "active",
        summary: "Personal is the default.",
        userId,
      })
      .returning();
    if (!profile) throw new Error("Profile fixture was not created.");
    profileId = profile.id;
    await database.db.insert(calendarEvents).values({
      allDay: false,
      calendarId: remoteCalendar.id,
      endsAt: new Date("2026-08-01T17:00:00.000Z"),
      provider: "google",
      remoteEtag: "remote-etag-existing",
      remoteEventId: "remote-duplicate",
      startsAt: new Date("2026-08-01T16:00:00.000Z"),
      timezone: "UTC",
      title: "Existing provider event",
      userId,
    });
    await database.db.insert(calendarEvents).values([
      {
        allDay: false,
        calendarId: remoteCalendar.id,
        endsAt: new Date("2026-08-03T17:00:00.000Z"),
        provider: "google",
        remoteEventId: "focus-1",
        startsAt: new Date("2026-08-03T16:00:00.000Z"),
        timezone: "UTC",
        title: "Independent focus",
        userId,
      },
      {
        allDay: false,
        calendarId: secondRemoteCalendar.id,
        endsAt: new Date("2026-08-03T17:00:00.000Z"),
        provider: "google",
        remoteEventId: "focus-2",
        startsAt: new Date("2026-08-03T16:00:00.000Z"),
        timezone: "UTC",
        title: "Independent focus",
        userId,
      },
    ]);
    service = createCalendarService({
      connectedEvents: gateway,
      db: database.db,
      now: () => timestamp,
    });
  }, 120_000);

  afterAll(async () => {
    await database.close();
    await container.stop();
  });

  function candidate(calendarId = localCalendarId) {
    return {
      allDay: false,
      buffer: { afterMinutes: 15, beforeMinutes: 15 },
      calendarId,
      endsAt: "2026-08-02T17:00:00.000Z",
      evidence: {
        kind: "booking" as const,
        source: {
          accountId: "22222222-2222-4222-8222-222222222222",
          provider: "google" as const,
          remoteId: "invented-booking",
          revision: "invented-revision",
          sourceType: "mail_thread" as const,
        },
        summary: "Caller says this is confirmed.",
      },
      flexibility: "hard" as const,
      location: null,
      notes: null,
      startsAt: "2026-08-02T16:00:00.000Z",
      timezone: "UTC",
      title: "Reservation",
      visibility: "private" as const,
    };
  }

  it("keeps caller-supplied strong evidence preview-only and exposes source state", async () => {
    const proposal = await service.previewCommitment(userId, {
      candidate: candidate(),
      expectedProfileVersion: 1,
      profileId,
      requestedPolicy: "approved_rule",
    });
    expect(proposal).toMatchObject({
      authority: "caller_supplied_unverified",
      destination: {
        id: localCalendarId,
        source: { accountLabel: "Local", remoteCalendarId: null, syncStatus: "idle" },
      },
      possibleDuplicateEventId: null,
      policy: {
        canApply: false,
        effectivePolicy: "preview",
        requestedPolicy: "approved_rule",
        requiresInteractiveApproval: true,
      },
      providerEffect: "local_write",
    });
    expect(proposal.policy.reasons).toContainEqual(expect.stringContaining("not authority"));
    expect(proposal.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    await expect(service.list(userId)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: remoteCalendarId,
          source: expect.objectContaining({
            accountLabel: "Google",
            remoteCalendarId: "remote-calendar",
            syncStatus: "idle",
          }),
        }),
      ]),
    );
    await expect(
      service.listEvents(userId, {
        from: "2026-08-01T00:00:00.000Z",
        to: "2026-08-02T00:00:00.000Z",
      }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: expect.objectContaining({
            accountId: remoteAccountId,
            remoteId: "remote-duplicate",
          }),
        }),
      ]),
    );
    const sameTimeEvents = await service.listEvents(userId, {
      from: "2026-08-03T00:00:00.000Z",
      to: "2026-08-04T00:00:00.000Z",
    });
    expect(sameTimeEvents).toHaveLength(2);
    expect(sameTimeEvents.map((event) => event.source?.remoteId).sort()).toEqual([
      "focus-1",
      "focus-2",
    ]);
  });

  it("reports profile drift, weak/flexible evidence, and exact projection duplicates", async () => {
    const created = await service.createEvent(
      {
        ...candidate(),
        attendees: [],
        recurrence: [],
      },
      context(),
    );
    expect(created.source).toMatchObject({
      provider: "local",
      remoteId: created.id,
      sourceType: "calendar_event",
    });
    const duplicate = await service.previewCommitment(userId, {
      candidate: candidate(),
      expectedProfileVersion: 2,
      profileId,
      requestedPolicy: "approved_rule",
    });
    expect(duplicate.possibleDuplicateEventId).toBe(created.id);
    expect(duplicate.policy.reasons).toContainEqual(
      expect.stringContaining("profile version changed"),
    );
    expect(duplicate.warnings).toContainEqual(expect.stringContaining("possible duplicate"));
    const weak = await service.previewCommitment(userId, {
      candidate: {
        ...candidate(),
        evidence: { ...candidate().evidence, kind: "other" },
        flexibility: "flexible",
        title: "Tentative idea",
      },
      expectedProfileVersion: 1,
      profileId,
      requestedPolicy: "approved_rule",
    });
    expect(weak.policy.reasons).toEqual(
      expect.arrayContaining([
        expect.stringContaining("eligible evidence shape"),
        expect.stringContaining("Flexible commitments"),
      ]),
    );
    expect(weak.policy.canApply).toBe(false);
  });

  it("discloses a completed provider write when projection persistence fails", async () => {
    await expect(
      service.createEvent(
        {
          allDay: false,
          calendarId: remoteCalendarId,
          endsAt: "2026-08-01T17:00:00.000Z",
          location: null,
          notes: null,
          startsAt: "2026-08-01T16:00:00.000Z",
          timezone: "UTC",
          title: "Reservation",
        },
        context(),
      ),
    ).rejects.toMatchObject({
      code: "service_unavailable",
      details: {
        partialEffect: "provider_event_created",
        provider: "google",
      },
    });
    expect(gateway.create).toHaveBeenCalled();
    const audits = await database.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.userId, userId));
    expect(audits.some((event) => event.action === "calendar_event.created")).toBe(true);
  });
});
