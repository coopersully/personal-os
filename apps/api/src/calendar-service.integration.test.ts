import { resolve } from "node:path";
import {
  attentionItems,
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
import { and, eq } from "drizzle-orm";
import {
  type CalendarProviderFailureObservation,
  createCalendarService,
} from "./calendar-service.js";
import type { Principal } from "./types.js";

const timestamp = new Date("2026-07-28T15:00:00.000Z");

describe.sequential("Calendar commitment proposals", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  let localCalendarId: string;
  let profileId: string;
  let remoteAccountId: string;
  let remoteCalendarId: string;
  let secondRemoteCalendarId: string;
  let service: ReturnType<typeof createCalendarService>;
  let userId: string;
  const providerFailureObservations: CalendarProviderFailureObservation[] = [];
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
    update: vi.fn(async () => ({
      allDay: false,
      conferenceUrl: null,
      endsAt: new Date("2026-08-01T17:00:00.000Z"),
      etag: "remote-etag-updated",
      location: null,
      notes: null,
      raw: { id: "remote-updated" },
      recurrence: [],
      remoteEventId: "remote-updated",
      startsAt: new Date("2026-08-01T16:00:00.000Z"),
      status: "confirmed" as const,
      timezone: "UTC",
      title: "Updated provider event",
    })),
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
  const agentContext = () => ({
    principal: {
      actorId: userId,
      actorType: "agent" as const,
      scopes: new Set(["calendar:read", "calendar:write"]),
      userId,
    } satisfies Principal,
    requestId: "calendar-agent-revision-test",
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
    secondRemoteCalendarId = secondRemoteCalendar.id;
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
      observeProviderFailure: (entry) => providerFailureObservations.push(entry),
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

  async function createCompoundFixture(label: string, deleted = false) {
    const [source] = await database.db
      .insert(calendarEvents)
      .values({
        allDay: false,
        calendarId: localCalendarId,
        deletedAt: deleted ? timestamp : null,
        endsAt: new Date("2026-08-04T17:00:00.000Z"),
        provider: "local",
        startsAt: new Date("2026-08-04T16:00:00.000Z"),
        timezone: "UTC",
        title: `${label} source`,
        userId,
      })
      .returning();
    if (!source) throw new Error("Compound source fixture was not created.");
    const blocks = await database.db
      .insert(calendarEvents)
      .values([
        {
          allDay: false,
          blockMode: "busy",
          blockSourceEventId: source.id,
          calendarId: remoteCalendarId,
          createdAt: new Date(timestamp.getTime() + 1_000),
          deletedAt: deleted ? timestamp : null,
          endsAt: source.endsAt,
          provider: "google",
          remoteEventId: `${label}-block-1`,
          startsAt: source.startsAt,
          timezone: "UTC",
          title: "Busy",
          userId,
        },
        {
          allDay: false,
          blockMode: "busy",
          blockSourceEventId: source.id,
          calendarId: secondRemoteCalendarId,
          createdAt: new Date(timestamp.getTime() + 2_000),
          deletedAt: deleted ? timestamp : null,
          endsAt: source.endsAt,
          provider: "google",
          remoteEventId: `${label}-block-2`,
          startsAt: source.startsAt,
          timezone: "UTC",
          title: "Busy",
          userId,
        },
      ])
      .returning();
    return { blocks, source };
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
    const auditsBefore = (
      await database.db.select().from(auditEvents).where(eq(auditEvents.userId, userId))
    ).filter((event) => event.requestId === "calendar-proposal-test").length;
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
        completedEffects: [
          expect.objectContaining({
            action: "create",
            remoteEventId: "remote-duplicate",
            role: "source",
          }),
        ],
        operation: "create_event",
        partialEffect: "provider_event_created",
        pendingEffects: [],
        provider: "google",
        remoteEventId: "remote-duplicate",
      },
    });
    expect(gateway.create).toHaveBeenCalled();
    const audits = await database.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.userId, userId));
    expect(audits.filter((event) => event.requestId === "calendar-proposal-test")).toHaveLength(
      auditsBefore,
    );
    expect(providerFailureObservations.at(-1)).toMatchObject({
      actorId: userId,
      code: "service_unavailable",
      details: {
        completedEffects: [
          expect.objectContaining({
            remoteEventId: "remote-duplicate",
            role: "source",
          }),
        ],
        operation: "create_event",
      },
      operation: "create_event",
      requestId: "calendar-proposal-test",
      status: 503,
      userId,
    });
  });

  it("reports completed and pending provider effects when an event update fails mid-block", async () => {
    const { blocks, source } = await createCompoundFixture("update");
    gateway.update
      .mockImplementationOnce(async () => ({
        allDay: false,
        conferenceUrl: null,
        endsAt: source.endsAt,
        etag: "update-etag",
        location: null,
        notes: null,
        raw: { id: "updated-block-1" },
        recurrence: [],
        remoteEventId: "updated-block-1",
        startsAt: source.startsAt,
        status: "confirmed",
        timezone: "UTC",
        title: "Busy",
      }))
      .mockRejectedValueOnce(new Error("Injected second block update failure."));
    await expect(
      service.updateEvent(source.id, { title: "Changed" }, context()),
    ).rejects.toMatchObject({
      code: "service_unavailable",
      details: {
        completedEffects: [
          expect.objectContaining({
            action: "update",
            remoteEventId: "updated-block-1",
            role: "block",
          }),
        ],
        operation: "update_event",
        pendingEffects: [
          expect.objectContaining({
            action: "update",
            remoteEventId: blocks[1]?.remoteEventId,
            role: "block",
          }),
        ],
        recovery: expect.stringContaining("Synchronize Calendar before retrying"),
      },
    });
  });

  it("reports completed provider effects when a block changes before projection", async () => {
    const { blocks, source } = await createCompoundFixture("concurrent-update");
    const firstBlock = blocks[0];
    const secondBlock = blocks[1];
    if (!firstBlock || !secondBlock) throw new Error("Compound blocks were not created.");
    await database.db
      .update(calendarEvents)
      .set({ deletedAt: timestamp, updatedAt: timestamp })
      .where(eq(calendarEvents.id, secondBlock.id));
    await expect(
      service.updateEvent(
        source.id,
        {
          expectedBlockUpdatedAtById: {},
          expectedUpdatedAt: source.updatedAt.toISOString(),
          title: "Missing block revision",
        },
        context(),
      ),
    ).rejects.toMatchObject({
      code: "conflict",
      details: {
        currentBlockUpdatedAtById: {
          [firstBlock.id]: firstBlock.updatedAt.toISOString(),
        },
      },
    });
    const concurrentTimestamp = new Date(timestamp.getTime() + 60_000);
    gateway.update.mockImplementationOnce(async () => {
      await database.db
        .update(calendarEvents)
        .set({ updatedAt: concurrentTimestamp })
        .where(eq(calendarEvents.id, firstBlock.id));
      return {
        allDay: false,
        conferenceUrl: null,
        endsAt: source.endsAt,
        etag: "concurrent-etag",
        location: null,
        notes: null,
        raw: { id: "concurrent-block" },
        recurrence: [],
        remoteEventId: "concurrent-block",
        startsAt: source.startsAt,
        status: "confirmed",
        timezone: "UTC",
        title: "Busy",
      };
    });

    await expect(
      service.updateEvent(source.id, { title: "Concurrent change" }, context()),
    ).rejects.toMatchObject({
      code: "conflict",
      details: {
        completedEffects: [
          expect.objectContaining({
            action: "update",
            eventId: firstBlock.id,
            remoteEventId: "concurrent-block",
            role: "block",
          }),
        ],
        operation: "update_event",
        pendingEffects: [],
      },
    });
    const [currentBlock] = await database.db
      .select()
      .from(calendarEvents)
      .where(eq(calendarEvents.id, firstBlock.id));
    expect(currentBlock?.updatedAt).toEqual(concurrentTimestamp);
    expect(currentBlock?.remoteEventId).toBe(firstBlock.remoteEventId);
  });

  it("requires current source and block revisions for every agent mutation path", async () => {
    const { blocks, source } = await createCompoundFixture("agent-revisions");
    const block = blocks[0];
    if (!block) throw new Error("Agent revision block fixture is missing.");
    const { source: deletedSource } = await createCompoundFixture("agent-restore", true);
    const callsBefore = {
      create: gateway.create.mock.calls.length,
      delete: gateway.delete.mock.calls.length,
      update: gateway.update.mock.calls.length,
    };

    await expect(
      service.createEventBlock(
        source.id,
        { calendarId: secondRemoteCalendarId, mode: "busy" },
        agentContext(),
      ),
    ).rejects.toMatchObject({
      code: "invalid_request",
      details: { missingFields: ["expectedUpdatedAt"] },
    });
    await expect(
      service.updateEvent(source.id, { title: "Stale agent update" }, agentContext()),
    ).rejects.toMatchObject({
      code: "invalid_request",
      details: {
        missingFields: ["expectedBlockUpdatedAtById", "expectedUpdatedAt"],
      },
    });
    await expect(service.deleteEvent(source.id, agentContext())).rejects.toMatchObject({
      code: "invalid_request",
      details: {
        missingFields: ["expectedBlockUpdatedAtById", "expectedUpdatedAt"],
      },
    });
    await expect(service.restoreEvent(deletedSource.id, agentContext())).rejects.toMatchObject({
      code: "invalid_request",
      details: {
        missingFields: ["expectedBlockUpdatedAtById", "expectedUpdatedAt"],
      },
    });
    await expect(
      service.updateEventBlock(source.id, block.id, { mode: "details" }, agentContext()),
    ).rejects.toMatchObject({
      code: "invalid_request",
      details: {
        missingFields: ["expectedBlockUpdatedAt", "expectedUpdatedAt"],
      },
    });
    await expect(
      service.deleteEventBlock(source.id, block.id, agentContext()),
    ).rejects.toMatchObject({
      code: "invalid_request",
      details: {
        missingFields: ["expectedBlockUpdatedAt", "expectedUpdatedAt"],
      },
    });
    expect({
      create: gateway.create.mock.calls.length,
      delete: gateway.delete.mock.calls.length,
      update: gateway.update.mock.calls.length,
    }).toEqual(callsBefore);
  });

  it("rejects a compound update when a linked block is added after its provider snapshot", async () => {
    const { blocks, source } = await createCompoundFixture("concurrent-block-add");
    const [sourceCalendar] = await database.db
      .select()
      .from(calendars)
      .where(eq(calendars.id, localCalendarId));
    if (!sourceCalendar) throw new Error("Source calendar fixture is missing.");
    const [lateCalendar] = await database.db
      .insert(calendars)
      .values({
        accountId: sourceCalendar.accountId,
        isWritable: true,
        name: "Late local block",
        provider: "local",
        timezone: "UTC",
        userId,
      })
      .returning();
    if (!lateCalendar) throw new Error("Late block calendar fixture was not created.");
    let lateBlockId: string | undefined;
    gateway.update.mockImplementationOnce(async () => {
      const [lateBlock] = await database.db
        .insert(calendarEvents)
        .values({
          allDay: source.allDay,
          blockMode: "busy",
          blockSourceEventId: source.id,
          calendarId: lateCalendar.id,
          endsAt: source.endsAt,
          provider: "local",
          startsAt: source.startsAt,
          timezone: source.timezone,
          title: "Busy",
          userId,
        })
        .returning();
      lateBlockId = lateBlock?.id;
      return {
        allDay: false,
        conferenceUrl: null,
        endsAt: source.endsAt,
        etag: "concurrent-add-etag",
        location: null,
        notes: null,
        raw: { id: "concurrent-add-block" },
        recurrence: [],
        remoteEventId: "concurrent-add-block",
        startsAt: source.startsAt,
        status: "confirmed",
        timezone: "UTC",
        title: "Busy",
      };
    });

    await expect(
      service.updateEvent(
        source.id,
        {
          expectedBlockUpdatedAtById: Object.fromEntries(
            blocks.map((block) => [block.id, block.updatedAt.toISOString()]),
          ),
          expectedUpdatedAt: source.updatedAt.toISOString(),
          title: "Must not commit",
        },
        context(),
      ),
    ).rejects.toMatchObject({
      code: "conflict",
      details: {
        completedEffects: expect.arrayContaining([
          expect.objectContaining({ action: "update", role: "block" }),
        ]),
        operation: "update_event",
      },
    });
    const [currentSource] = await database.db
      .select()
      .from(calendarEvents)
      .where(eq(calendarEvents.id, source.id));
    const [lateBlock] = lateBlockId
      ? await database.db.select().from(calendarEvents).where(eq(calendarEvents.id, lateBlockId))
      : [];
    expect(currentSource?.title).toBe(source.title);
    expect(lateBlock).toMatchObject({ blockSourceEventId: source.id, deletedAt: null });
  });

  it("reports completed and pending provider effects when deletion fails mid-block", async () => {
    const { blocks, source } = await createCompoundFixture("delete");
    gateway.delete
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Injected second block delete failure."));
    await expect(service.deleteEvent(source.id, context())).rejects.toMatchObject({
      code: "service_unavailable",
      details: {
        completedEffects: [
          expect.objectContaining({
            action: "delete",
            remoteEventId: blocks[0]?.remoteEventId,
            role: "block",
          }),
        ],
        operation: "delete_event",
        pendingEffects: [
          expect.objectContaining({
            action: "delete",
            remoteEventId: blocks[1]?.remoteEventId,
            role: "block",
          }),
        ],
      },
    });
  });

  it("reports completed and pending provider effects when restoration fails mid-block", async () => {
    const { source } = await createCompoundFixture("restore", true);
    gateway.create
      .mockImplementationOnce(async () => ({
        allDay: false,
        conferenceUrl: null,
        endsAt: source.endsAt,
        etag: "restore-etag",
        location: null,
        notes: null,
        raw: { id: "restored-block-1" },
        recurrence: [],
        remoteEventId: "restored-block-1",
        startsAt: source.startsAt,
        status: "confirmed",
        timezone: "UTC",
        title: "Busy",
      }))
      .mockRejectedValueOnce(new Error("Injected second block restore failure."));
    await expect(service.restoreEvent(source.id, context())).rejects.toMatchObject({
      code: "service_unavailable",
      details: {
        completedEffects: [
          expect.objectContaining({
            action: "create",
            remoteEventId: "restored-block-1",
            role: "block",
          }),
        ],
        operation: "restore_event",
        pendingEffects: [
          expect.objectContaining({
            action: "create",
            remoteEventId: null,
            role: "block",
          }),
        ],
      },
    });
  });

  it("upserts event attention with derived provenance and redacted atomic audits", async () => {
    const privateNotes = "private event notes never copy";
    const created = await service.createEvent(
      {
        allDay: false,
        calendarId: localCalendarId,
        endsAt: "2026-08-06T17:00:00.000Z",
        location: null,
        notes: privateNotes,
        startsAt: "2026-08-06T16:00:00.000Z",
        timezone: "UTC",
        title: "Important local commitment",
      },
      context(),
    );
    const input = {
      expiresAt: null,
      importance: "high" as const,
      kind: "upcoming" as const,
      occursAt: "2026-08-06T16:00:00.000Z",
      summary: "Starts soon.",
      title: "Upcoming commitment",
    };

    await expect(
      service.updateEvent(
        created.id,
        {
          expectedBlockUpdatedAtById: {},
          expectedUpdatedAt: "2026-07-28T14:59:59.000Z",
          title: "Stale update",
        },
        context(),
      ),
    ).rejects.toMatchObject({
      code: "conflict",
      details: { currentUpdatedAt: created.updatedAt, eventId: created.id },
    });

    const [first, concurrent] = await Promise.all([
      service.upsertAttentionItem(created.id, input, context()),
      service.upsertAttentionItem(created.id, input, context()),
    ]);
    const [sourceCalendar] = await database.db
      .select()
      .from(calendars)
      .where(eq(calendars.id, localCalendarId));
    expect(concurrent.id).toBe(first.id);
    expect(first.source).toMatchObject({
      accountId: sourceCalendar?.accountId,
      provider: "local",
      remoteId: created.id,
      revision: created.updatedAt,
      sourceType: "calendar_event",
    });
    const storedAfterConcurrent = await database.db
      .select()
      .from(attentionItems)
      .where(
        and(
          eq(attentionItems.userId, userId),
          eq(attentionItems.relatedEntityId, created.id),
          eq(attentionItems.kind, "upcoming"),
          eq(attentionItems.status, "open"),
        ),
      );
    expect(storedAfterConcurrent).toHaveLength(1);

    const refreshedAt = new Date(timestamp.getTime() + 120_000);
    await database.db
      .update(calendarEvents)
      .set({ updatedAt: refreshedAt })
      .where(eq(calendarEvents.id, created.id));
    const refreshed = await service.upsertAttentionItem(
      created.id,
      {
        ...input,
        expiresAt: "2026-08-07T16:00:00.000Z",
        occursAt: null,
      },
      context(),
    );
    expect(refreshed.id).toBe(first.id);
    expect(refreshed.expiresAt).toBe("2026-08-07T16:00:00.000Z");
    expect(refreshed.occursAt).toBeNull();
    expect(refreshed.source?.revision).toBe(refreshedAt.toISOString());

    const [otherUser] = await database.db
      .insert(users)
      .values({
        displayName: "Other Calendar",
        email: "other-calendar-proposal@example.com",
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning();
    if (!otherUser) throw new Error("Cross-user fixture was not created.");
    await expect(
      service.upsertAttentionItem(created.id, input, {
        principal: {
          actorId: otherUser.id,
          actorType: "user",
          scopes: new Set(["calendar:read", "calendar:write"]),
          userId: otherUser.id,
        },
        requestId: "calendar-cross-user-attention",
      }),
    ).rejects.toMatchObject({ code: "not_found" });

    const attentionAudits = (
      await database.db.select().from(auditEvents).where(eq(auditEvents.userId, userId))
    ).filter(
      (event) =>
        event.entityType === "attention_item" &&
        event.entityId === first.id &&
        event.requestId === "calendar-proposal-test",
    );
    expect(attentionAudits).toHaveLength(3);
    expect(
      JSON.stringify({
        audits: attentionAudits.map(({ after, before }) => ({ after, before })),
        items: storedAfterConcurrent,
      }),
    ).not.toContain(privateNotes);
    expect(attentionAudits.at(-1)?.after).toEqual({
      domain: "calendar",
      importance: "high",
      kind: "upcoming",
      relatedEntityType: "calendar_event",
      status: "open",
    });
  });

  it("redacts shared-account provider errors from Calendar source discovery", async () => {
    const privateProviderError =
      "Gmail API request failed: private mailbox response body and provider diagnostics";
    await database.db
      .update(calendarAccounts)
      .set({ syncError: privateProviderError, syncStatus: "error" })
      .where(eq(calendarAccounts.id, remoteAccountId));
    const listed = await service.list(userId);
    expect(JSON.stringify(listed)).not.toContain(privateProviderError);
    expect(listed.find((calendar) => calendar.accountId === remoteAccountId)?.source).toMatchObject(
      {
        syncError:
          "The connected account needs attention. Synchronize Calendar or review Connections.",
        syncStatus: "error",
      },
    );
  });
});
