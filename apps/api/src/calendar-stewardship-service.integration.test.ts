import { resolve } from "node:path";
import {
  auditEvents,
  calendarAccounts,
  calendarEvents,
  calendarFindings,
  calendarReviews,
  calendars,
  createDatabaseClient,
  type DatabaseClient,
  domainProfiles,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { and, eq, sql } from "drizzle-orm";
import type { Pool, PoolClient } from "pg";
import { CALENDAR_ASSESSMENT_BUDGETS } from "./calendar-assessment.js";
import { createCalendarStewardshipService } from "./calendar-stewardship-service.js";

const initialNow = new Date("2026-08-23T12:00:00.000Z");

describe.sequential("Calendar stewardship service", () => {
  let accountId: string;
  let calendarId: string;
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  let firstEventId: string;
  let now: Date;
  let otherUserId: string;
  let profileId: string;
  let secondEventId: string;
  let service: ReturnType<typeof createCalendarStewardshipService>;
  let userId: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine")
      .withDatabase("personal_os")
      .withUsername("personal_os")
      .withPassword("personal_os")
      .start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
  }, 120_000);

  afterAll(async () => {
    await database.close();
    await container.stop();
  });

  beforeEach(async () => {
    await database.db.delete(users);
    now = new Date(initialNow);
    const [user, otherUser] = await database.db
      .insert(users)
      .values([
        {
          displayName: "Calendar owner",
          email: "calendar-stewardship@example.com",
          passwordHash: "unused",
          planningTimezone: "UTC",
        },
        {
          displayName: "Other owner",
          email: "other-calendar-stewardship@example.com",
          passwordHash: "unused",
          planningTimezone: "UTC",
        },
      ])
      .returning();
    if (!user || !otherUser) throw new Error("User fixtures were not created.");
    userId = user.id;
    otherUserId = otherUser.id;

    const [account] = await database.db
      .insert(calendarAccounts)
      .values({
        label: "Connected calendar",
        lastSyncedAt: now,
        provider: "google",
        providerAccountId: "calendar-stewardship-owner",
        syncGeneration: 3,
        syncStatus: "idle",
        userId,
      })
      .returning();
    if (!account) throw new Error("Account fixture was not created.");
    accountId = account.id;

    const [calendar] = await database.db
      .insert(calendars)
      .values({
        accountId,
        isSelected: true,
        isWritable: true,
        lastSyncedAt: now,
        name: "Private calendar name",
        provider: "google",
        remoteCalendarId: "remote-calendar",
        timezone: "UTC",
        userId,
      })
      .returning();
    if (!calendar) throw new Error("Calendar fixture was not created.");
    calendarId = calendar.id;

    const [profile] = await database.db
      .insert(domainProfiles)
      .values({
        categories: [],
        domain: "calendar",
        instructions: ["Private profile instruction"],
        objective: "Keep calendar evidence dependable.",
        preferences: {
          afterBufferMinutes: 15,
          automaticEventCreation: false,
          automaticEventEvidence: [],
          beforeBufferMinutes: 15,
          busyBlockPrivacy: "busy",
          defaultCalendarId: calendarId,
          defaultTimezone: "UTC",
          privateProfileMaterial: "profile-buffer-secret",
        },
        sourceContexts: [],
        status: "active",
        summary: "Private profile summary",
        userId,
      })
      .returning();
    if (!profile) throw new Error("Profile fixture was not created.");
    profileId = profile.id;

    const [firstEvent, secondEvent] = await database.db
      .insert(calendarEvents)
      .values([
        {
          allDay: false,
          attendees: [
            {
              email: "attendee@example.com",
              isOrganizer: false,
              name: "Private attendee",
              response: "accepted",
            },
          ],
          calendarId,
          endsAt: new Date("2026-08-24T15:00:00.000Z"),
          notes: "private note",
          provider: "google",
          remoteEtag: "stable-v2",
          remoteEventId: "first-event",
          startsAt: new Date("2026-08-24T14:00:00.000Z"),
          timezone: "UTC",
          title: "Planning meeting",
          userId,
        },
        {
          allDay: false,
          calendarId,
          endsAt: new Date("2026-08-24T15:30:00.000Z"),
          provider: "google",
          remoteEtag: "stable-v2-second",
          remoteEventId: "second-event",
          startsAt: new Date("2026-08-24T14:30:00.000Z"),
          timezone: "UTC",
          title: "Second private meeting",
          userId,
        },
      ])
      .returning();
    if (!firstEvent || !secondEvent) throw new Error("Event fixtures were not created.");
    firstEventId = firstEvent.id;
    secondEventId = secondEvent.id;

    service = createCalendarStewardshipService({ db: database.db, now: () => now });
  });

  it("publishes owner-scoped findings and an immutable redacted review without audit mutation", async () => {
    const [otherAccount] = await database.db
      .insert(calendarAccounts)
      .values({ label: "Other local", provider: "local", userId: otherUserId })
      .returning();
    if (!otherAccount) throw new Error("Other account fixture was not created.");
    const [otherCalendar] = await database.db
      .insert(calendars)
      .values({
        accountId: otherAccount.id,
        name: "Other calendar",
        provider: "local",
        timezone: "UTC",
        userId: otherUserId,
      })
      .returning();
    if (!otherCalendar) throw new Error("Other calendar fixture was not created.");
    await database.db.insert(calendarEvents).values({
      calendarId: otherCalendar.id,
      endsAt: new Date("2026-08-24T15:00:00.000Z"),
      provider: "local",
      startsAt: new Date("2026-08-24T14:00:00.000Z"),
      timezone: "UTC",
      title: "Other private title",
      userId: otherUserId,
    });

    const review = await service.createReview(userId, { scope: { type: "all_outstanding" } });

    expect(review.state).toBe("maintained_with_questions");
    expect(review.findings.map(({ kind }) => kind)).toContain("event_overlap");
    expect(review.scopeStart).toBe("2026-07-24T12:00:00.000Z");
    expect(review.scopeEnd).toBe("2026-11-21T12:00:00.000Z");
    const rows = await database.db.select().from(calendarReviews);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.userId).toBe(userId);
    expect(rows[0]?.findingSnapshots).toEqual(review.findings);
    expect(JSON.stringify(rows[0])).not.toMatch(
      /Planning meeting|Second private meeting|private note|attendee@example.com|Private profile|profile-buffer-secret/,
    );
    await expect(database.db.select().from(auditEvents)).resolves.toHaveLength(0);
  });

  it("coalesces an unchanged current review but publishes changed ledger inputs", async () => {
    const first = await service.createReview(userId, { scope: { type: "all_outstanding" } });
    now = new Date(initialNow.getTime() + 60_000);
    const unchanged = await service.createReview(userId, { scope: { type: "all_outstanding" } });
    expect(unchanged.id).toBe(first.id);
    await expect(database.db.select().from(calendarReviews)).resolves.toHaveLength(1);

    await database.db
      .update(calendarEvents)
      .set({ remoteEtag: "coalescing-change-v3", updatedAt: new Date(now.getTime() + 1_000) })
      .where(eq(calendarEvents.id, firstEventId));
    const changed = await service.createReview(userId, { scope: { type: "all_outstanding" } });
    expect(changed.id).not.toBe(first.id);
    await expect(database.db.select().from(calendarReviews)).resolves.toHaveLength(2);
  });

  it("falls back from a blank provider etag to the event update revision", async () => {
    await database.db
      .update(calendarEvents)
      .set({ remoteEtag: "", updatedAt: new Date("2026-08-23T12:00:01.000Z") })
      .where(eq(calendarEvents.id, firstEventId));

    const review = await service.createReview(userId, { scope: { type: "all_outstanding" } });

    expect(
      review.findings
        .flatMap(({ sourceReferences }) => sourceReferences)
        .find(({ remoteId }) => remoteId === "first-event")?.revision,
    ).toBe("2026-08-23T12:00:01.000Z");
  });

  it("publishes with a max-one pool and does not reserve a second connection for its snapshot", async () => {
    const singleConnectionDatabase = createDatabaseClient({
      connectionString: container.getConnectionUri(),
      max: 1,
    });
    const singleConnectionService = createCalendarStewardshipService({
      db: singleConnectionDatabase.db,
      now: () => now,
    });
    try {
      await expect(
        singleConnectionService.createReview(userId, { scope: { type: "all_outstanding" } }),
      ).resolves.toMatchObject({ state: "maintained_with_questions" });
    } finally {
      await singleConnectionDatabase.close();
    }
  });

  it("publishes concurrent owners without exhausting a pool sized to those owners", async () => {
    const boundedDatabase = createDatabaseClient({
      connectionString: container.getConnectionUri(),
      max: 2,
    });
    const boundedService = createCalendarStewardshipService({
      db: boundedDatabase.db,
      now: () => now,
    });
    try {
      const reviews = await Promise.all([
        boundedService.createReview(userId, { scope: { type: "all_outstanding" } }),
        boundedService.createReview(otherUserId, { scope: { type: "all_outstanding" } }),
      ]);
      expect(reviews).toHaveLength(2);
      expect(reviews[0]?.state).toBe("maintained_with_questions");
      expect(reviews[1]?.state).toBe("blocked");
    } finally {
      await boundedDatabase.close();
    }
  });

  it("evicts the physical connection without failing a committed review when session unlock fails", async () => {
    const pool = (database.db as typeof database.db & { $client: Pool }).$client;
    const originalPoolConnect = pool.connect;
    const connect = originalPoolConnect.bind(pool) as () => Promise<PoolClient>;
    const unlockFailure = new Error("forced advisory unlock failure");
    let cleanupClient: (() => Promise<void>) | undefined;
    let releasedWith: Error | boolean | undefined;
    pool.connect = (async () => {
      const client = await connect();
      const originalQuery = client.query.bind(client) as (...arguments_: unknown[]) => unknown;
      const originalRelease = client.release.bind(client);
      client.query = ((...arguments_: unknown[]) => {
        const query = arguments_[0];
        if (typeof query === "string" && query.includes("pg_advisory_unlock")) {
          return Promise.reject(unlockFailure);
        }
        return originalQuery(...arguments_);
      }) as typeof client.query;
      client.release = ((error?: Error | boolean) => {
        releasedWith = error;
      }) as typeof client.release;
      cleanupClient = async () => {
        await originalQuery("select pg_advisory_unlock(hashtextextended('calendar:' || $1, 0))", [
          userId,
        ]);
        originalRelease();
      };
      return client;
    }) as typeof pool.connect;

    let review: Awaited<ReturnType<typeof service.createReview>> | undefined;
    try {
      review = await service.createReview(userId, { scope: { type: "all_outstanding" } });
    } finally {
      pool.connect = originalPoolConnect;
      await cleanupClient?.();
    }
    expect(review).toMatchObject({ state: "maintained_with_questions" });
    expect(releasedWith).toBe(unlockFailure);
    await expect(database.db.select().from(calendarReviews)).resolves.toHaveLength(1);
  });

  it("rejects unsupported scopes before writing derived state", async () => {
    const operation = service.createReview(userId, {
      scope: {
        end: "2026-08-25T00:00:00.000Z",
        start: "2026-08-24T00:00:00.000Z",
        type: "window",
      },
    });

    await expect(operation).rejects.toMatchObject({
      code: "invalid_request",
      message: "This Calendar release supports all-outstanding reviews only.",
    });
    await expect(database.db.select().from(calendarFindings)).resolves.toHaveLength(0);
    await expect(database.db.select().from(calendarReviews)).resolves.toHaveLength(0);
  });

  it("resolves absent stable findings, reopens them with the same identity, and never crosses owners", async () => {
    const first = await service.createReview(userId, { scope: { type: "all_outstanding" } });
    const overlap = first.findings.find(({ kind }) => kind === "event_overlap");
    if (!overlap) throw new Error("Overlap finding was not created.");

    await database.db
      .update(calendarEvents)
      .set({
        endsAt: new Date("2026-08-24T17:00:00.000Z"),
        startsAt: new Date("2026-08-24T16:00:00.000Z"),
        updatedAt: now,
      })
      .where(eq(calendarEvents.id, secondEventId));
    const second = await service.createReview(userId, { scope: { type: "all_outstanding" } });
    expect(second.findings).not.toContainEqual(expect.objectContaining({ id: overlap.id }));
    const [resolved] = await database.db
      .select()
      .from(calendarFindings)
      .where(eq(calendarFindings.id, overlap.id));
    expect(resolved?.status).toBe("resolved");
    expect(resolved?.resolvedAt).toEqual(now);

    await database.db
      .update(calendarEvents)
      .set({
        endsAt: new Date("2026-08-24T15:30:00.000Z"),
        startsAt: new Date("2026-08-24T14:30:00.000Z"),
        updatedAt: now,
      })
      .where(eq(calendarEvents.id, secondEventId));
    const third = await service.createReview(userId, { scope: { type: "all_outstanding" } });
    expect(third.findings).toContainEqual(
      expect.objectContaining({
        id: overlap.id,
        firstObservedAt: overlap.firstObservedAt,
        status: "open",
      }),
    );
    await expect(service.getStatus(otherUserId)).resolves.toMatchObject({
      latestReview: null,
      lifecycle: "never_maintained",
    });
  });

  it("preserves prior findings while required source evidence is unsettled", async () => {
    const first = await service.createReview(userId, { scope: { type: "all_outstanding" } });
    const overlap = first.findings.find(({ kind }) => kind === "event_overlap");
    if (!overlap) throw new Error("Overlap finding was not created.");

    await database.db
      .update(calendarEvents)
      .set({
        endsAt: new Date("2026-08-24T17:00:00.000Z"),
        startsAt: new Date("2026-08-24T16:00:00.000Z"),
        updatedAt: now,
      })
      .where(eq(calendarEvents.id, secondEventId));
    const staleAt = new Date("2026-08-23T11:00:00.000Z");
    await database.db
      .update(calendarAccounts)
      .set({ lastSyncedAt: staleAt })
      .where(eq(calendarAccounts.id, accountId));
    await database.db
      .update(calendars)
      .set({ lastSyncedAt: staleAt })
      .where(eq(calendars.id, calendarId));

    const blocked = await service.createReview(userId, { scope: { type: "all_outstanding" } });

    expect(blocked.state).toBe("blocked");
    expect(blocked.findings).toContainEqual(expect.objectContaining({ id: overlap.id }));
    await expect(service.getStatus(userId)).resolves.toMatchObject({
      backlog: { actionable: null, openFindings: null },
    });
    const [preserved] = await database.db
      .select()
      .from(calendarFindings)
      .where(eq(calendarFindings.id, overlap.id));
    expect(preserved?.status).toBe("open");
    expect(preserved?.resolvedAt).toBeNull();
  });

  it("returns a bounded conflict immediately when the owner review lock is busy", async () => {
    await database.db.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`calendar:${userId}`}, 0))`,
      );
      await expect(
        service.createReview(userId, { scope: { type: "all_outstanding" } }),
      ).rejects.toMatchObject({
        code: "conflict",
        message: "A Calendar review is already being published. Try again shortly.",
      });
    });
    await expect(
      service.createReview(userId, { scope: { type: "all_outstanding" } }),
    ).resolves.toMatchObject({ state: "maintained_with_questions" });
  });

  it("invalidates live status for event, source, profile, and freshness changes", async () => {
    await service.createReview(userId, { scope: { type: "all_outstanding" } });
    await expect(service.getStatus(userId)).resolves.toMatchObject({
      lifecycle: "maintained_with_questions",
    });

    await database.db
      .update(calendarEvents)
      .set({ remoteEtag: "changed-v3", updatedAt: new Date(now.getTime() + 1_000) })
      .where(eq(calendarEvents.id, firstEventId));
    await expect(service.getStatus(userId)).resolves.toMatchObject({ lifecycle: "stale" });

    await service.createReview(userId, { scope: { type: "all_outstanding" } });
    await database.db
      .update(calendars)
      .set({ updatedAt: new Date(now.getTime() + 2_000) })
      .where(eq(calendars.id, calendarId));
    await expect(service.getStatus(userId)).resolves.toMatchObject({ lifecycle: "stale" });

    await service.createReview(userId, { scope: { type: "all_outstanding" } });
    await database.db
      .update(domainProfiles)
      .set({ updatedAt: new Date(now.getTime() + 3_000), version: 2 })
      .where(eq(domainProfiles.id, profileId));
    await expect(service.getStatus(userId)).resolves.toMatchObject({ lifecycle: "stale" });

    await service.createReview(userId, { scope: { type: "all_outstanding" } });
    now = new Date(initialNow.getTime() + 15 * 60_000 + 1);
    await expect(service.getStatus(userId)).resolves.toMatchObject({ lifecycle: "stale" });
  });

  it("expires review reuse at the selected source freshness transition", async () => {
    const lastSyncedAt = new Date(initialNow.getTime() - 14 * 60_000);
    await database.db
      .update(calendarAccounts)
      .set({ lastSyncedAt })
      .where(eq(calendarAccounts.id, accountId));
    await database.db.update(calendars).set({ lastSyncedAt }).where(eq(calendars.id, calendarId));

    const first = await service.createReview(userId, { scope: { type: "all_outstanding" } });
    expect(first.nextMaintenanceAt).toBe("2026-08-23T12:01:00.001Z");

    now = new Date("2026-08-23T12:01:00.001Z");
    await expect(service.getStatus(userId)).resolves.toMatchObject({
      lifecycle: "stale",
      readiness: "degraded",
      sources: [expect.objectContaining({ state: "stale" })],
    });
    const second = await service.createReview(userId, { scope: { type: "all_outstanding" } });
    expect(second.id).not.toBe(first.id);
    expect(second.state).toBe("blocked");
    await expect(database.db.select().from(calendarReviews)).resolves.toHaveLength(2);
  });

  it("counts newly assessed findings in settled live status before they are persisted", async () => {
    await database.db
      .update(calendarEvents)
      .set({
        endsAt: new Date("2026-08-24T17:00:00.000Z"),
        startsAt: new Date("2026-08-24T16:00:00.000Z"),
      })
      .where(eq(calendarEvents.id, secondEventId));
    const review = await service.createReview(userId, { scope: { type: "all_outstanding" } });
    expect(review.findings).toHaveLength(0);
    await database.db
      .update(calendarEvents)
      .set({
        endsAt: new Date("2026-08-24T15:30:00.000Z"),
        remoteEtag: "new-overlap-v3",
        startsAt: new Date("2026-08-24T14:30:00.000Z"),
      })
      .where(eq(calendarEvents.id, secondEventId));

    await expect(service.getStatus(userId)).resolves.toMatchObject({
      backlog: { actionable: 1, openFindings: 1 },
      lifecycle: "stale",
    });
  });

  it("blocks unavailable and recurrence-incomplete evidence without claiming zero backlog", async () => {
    await database.db
      .update(calendarAccounts)
      .set({
        syncError: "Safe reconnect required",
        syncErrorCategory: "authorization",
        syncErrorCode: "authorization_required",
        syncFailureCount: 1,
        syncRecovery: "reconnect",
        syncStatus: "error",
      })
      .where(eq(calendarAccounts.id, accountId));
    await database.db
      .update(calendarEvents)
      .set({ recurrence: ["RRULE:FREQ=WEEKLY;PRIVATE=provider-recurrence-secret"] })
      .where(eq(calendarEvents.id, firstEventId));

    const review = await service.createReview(userId, { scope: { type: "all_outstanding" } });
    expect(review.state).toBe("blocked");
    expect(review.findings.map(({ kind }) => kind)).toEqual(
      expect.arrayContaining(["source_unavailable", "recurrence_unassessed"]),
    );
    expect(JSON.stringify(review)).not.toContain("provider-recurrence-secret");
    await expect(service.getStatus(userId)).resolves.toMatchObject({
      backlog: {
        actionable: null,
        ambiguousEffects: null,
        awaitingApproval: null,
        awaitingInput: null,
        blocked: 1,
        failed: null,
        openFindings: null,
      },
      lifecycle: "blocked",
      readiness: "degraded",
      validNextOperations: expect.arrayContaining([
        "assess_calendar",
        "open_connections",
        "review_findings",
      ]),
    });
  });

  it("offers connection repair only for reconnect recovery, not scheduled operator retry", async () => {
    await database.db
      .update(calendarAccounts)
      .set({
        syncError: "Operator retry is scheduled",
        syncErrorCategory: "configuration",
        syncErrorCode: "operator_retry_scheduled",
        syncFailureCount: 1,
        syncRecovery: "operator",
        syncStatus: "error",
      })
      .where(eq(calendarAccounts.id, accountId));
    await service.createReview(userId, { scope: { type: "all_outstanding" } });
    expect((await service.getStatus(userId)).validNextOperations).not.toContain("open_connections");

    await database.db
      .update(calendarAccounts)
      .set({
        syncError: "Reconnect authorization required",
        syncErrorCategory: "authorization",
        syncErrorCode: "authorization_required",
        syncRecovery: "reconnect",
        updatedAt: new Date(now.getTime() + 1_000),
      })
      .where(eq(calendarAccounts.id, accountId));
    await service.createReview(userId, { scope: { type: "all_outstanding" } });
    expect((await service.getStatus(userId)).validNextOperations).toContain("open_connections");
  });

  it("degrades malformed recurrence and profile JSON without throwing or carrying private values", async () => {
    await database.db
      .update(domainProfiles)
      .set({
        preferences: {
          afterBufferMinutes: 15.5,
          automaticEventCreation: false,
          automaticEventEvidence: [],
          beforeBufferMinutes: 15,
          busyBlockPrivacy: "busy",
          defaultCalendarId: calendarId,
          defaultTimezone: "UTC",
          privateProfileMaterial: "malformed-profile-secret",
        },
      })
      .where(eq(domainProfiles.id, profileId));
    await database.pool.query("update calendar_events set recurrence = $1::jsonb where id = $2", [
      JSON.stringify({ privateRule: "malformed-recurrence-secret" }),
      firstEventId,
    ]);

    const review = await service.createReview(userId, { scope: { type: "all_outstanding" } });

    expect(review.state).toBe("blocked");
    expect(review.profileVersion).toBeNull();
    expect(review.findings.map(({ kind }) => kind)).toContain("recurrence_unassessed");
    expect(JSON.stringify(review)).not.toMatch(
      /malformed-profile-secret|malformed-recurrence-secret/,
    );
    await expect(service.getStatus(userId)).resolves.toMatchObject({
      readiness: "setup_required",
      setupBlockers: ["Activate a Calendar profile before relying on stewardship assessments."],
    });
  });

  it("marks an over-budget event projection partial and bounds published findings", async () => {
    const startsAt = new Date("2026-09-01T00:00:00.000Z");
    await database.db.insert(calendarEvents).values(
      Array.from({ length: CALENDAR_ASSESSMENT_BUDGETS.events }, (_, index) => ({
        calendarId,
        endsAt: new Date(startsAt.getTime() + index * 5 * 60_000 + 60_000),
        provider: "google" as const,
        remoteEtag: `budget-${index}`,
        remoteEventId: `budget-${index}`,
        startsAt: new Date(startsAt.getTime() + index * 5 * 60_000),
        timezone: "UTC",
        title: `Private budget event ${index}`,
        userId,
      })),
    );

    const review = await service.createReview(userId, { scope: { type: "all_outstanding" } });

    expect(review.state).toBe("blocked");
    expect(review.sourceFreshness[0]?.completeness).toBe("partial");
    expect(review.findings.length).toBeLessThanOrEqual(CALENDAR_ASSESSMENT_BUDGETS.findings);
  });

  it("recovers a supported finding ledger that exceeded its read budget", async () => {
    await database.db
      .update(calendarEvents)
      .set({
        endsAt: new Date("2026-08-24T17:00:00.000Z"),
        startsAt: new Date("2026-08-24T16:00:00.000Z"),
        updatedAt: now,
      })
      .where(eq(calendarEvents.id, secondEventId));
    await database.db.insert(calendarFindings).values(
      Array.from({ length: CALENDAR_ASSESSMENT_BUDGETS.findings + 1 }, (_, index) => ({
        evidence: { accountId, calendarId, type: "source" as const },
        evidenceCutoff: now,
        fingerprint: index.toString(16).padStart(64, "0"),
        firstObservedAt: now,
        kind: "source_stale" as const,
        lastObservedAt: now,
        playbookVersion: "1.0.0",
        rulebookVersion: "calendar-profile/v1",
        severity: "attention" as const,
        sourceReferences: [],
        status: "open" as const,
        summary: "Previously observed source evidence.",
        userId,
      })),
    );

    const review = await service.createReview(userId, { scope: { type: "all_outstanding" } });
    const openFindings = await database.db
      .select()
      .from(calendarFindings)
      .where(and(eq(calendarFindings.userId, userId), eq(calendarFindings.status, "open")));

    expect(review.sourceFreshness[0]?.state).toBe("current");
    expect(openFindings).toHaveLength(0);
  });

  it("excludes unselected, disabled, and soft-deleted sources plus events outside the fixed horizon", async () => {
    const [excludedCalendar] = await database.db
      .insert(calendars)
      .values({
        accountId,
        isSelected: false,
        name: "Excluded",
        provider: "google",
        remoteCalendarId: "excluded-calendar",
        timezone: "UTC",
        userId,
      })
      .returning();
    if (!excludedCalendar) throw new Error("Excluded calendar fixture was not created.");
    const [disabledAccount] = await database.db
      .insert(calendarAccounts)
      .values({
        calendarEnabled: false,
        label: "Disabled account",
        lastSyncedAt: now,
        provider: "google",
        providerAccountId: "disabled-calendar-stewardship",
        userId,
      })
      .returning();
    if (!disabledAccount) throw new Error("Disabled account fixture was not created.");
    const [disabledCalendar, deletedCalendar] = await database.db
      .insert(calendars)
      .values([
        {
          accountId: disabledAccount.id,
          lastSyncedAt: now,
          name: "Disabled source",
          provider: "google",
          remoteCalendarId: "disabled-calendar",
          timezone: "UTC",
          userId,
        },
        {
          accountId,
          deletedAt: now,
          lastSyncedAt: now,
          name: "Deleted source",
          provider: "google",
          remoteCalendarId: "deleted-calendar",
          timezone: "UTC",
          userId,
        },
      ])
      .returning();
    if (!disabledCalendar || !deletedCalendar) {
      throw new Error("Disabled and deleted Calendar fixtures were not created.");
    }
    await database.db.insert(calendarEvents).values([
      {
        calendarId,
        endsAt: new Date("2025-01-01T13:00:00.000Z"),
        provider: "google",
        recurrence: ["RRULE:FREQ=WEEKLY"],
        startsAt: new Date("2025-01-01T12:00:00.000Z"),
        timezone: "UTC",
        title: "Recurring master predating horizon",
        userId,
      },
      {
        calendarId: excludedCalendar.id,
        endsAt: new Date("2026-08-24T17:00:00.000Z"),
        provider: "google",
        recurrence: ["RRULE:FREQ=WEEKLY"],
        startsAt: new Date("2026-08-24T16:00:00.000Z"),
        timezone: "UTC",
        title: "Excluded recurrence",
        userId,
      },
      {
        calendarId: disabledCalendar.id,
        endsAt: new Date("2026-08-24T18:00:00.000Z"),
        provider: "google",
        recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;PRIVATE=provider-payload"],
        startsAt: new Date("2026-08-24T17:00:00.000Z"),
        timezone: "UTC",
        title: "Disabled recurrence",
        userId,
      },
      {
        calendarId: deletedCalendar.id,
        endsAt: new Date("2026-08-24T19:00:00.000Z"),
        provider: "google",
        recurrence: ["RRULE:FREQ=DAILY;PRIVATE=provider-payload"],
        startsAt: new Date("2026-08-24T18:00:00.000Z"),
        timezone: "UTC",
        title: "Deleted recurrence",
        userId,
      },
    ]);

    const review = await service.createReview(userId, { scope: { type: "all_outstanding" } });

    expect(review.sourceFreshness).toHaveLength(1);
    expect(review.sourceFreshness[0]?.calendarId).toBe(calendarId);
    expect(review.findings.map(({ kind }) => kind)).toContain("recurrence_unassessed");
  });

  it("preserves open findings from unsupported future playbook kinds", async () => {
    const futureFindingId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    await database.db.insert(calendarFindings).values({
      evidence: { accountId, calendarId, type: "source" },
      evidenceCutoff: now,
      fingerprint: "b".repeat(64),
      firstObservedAt: now,
      id: futureFindingId,
      kind: "future_calendar_kind" as (typeof calendarFindings.$inferInsert)["kind"],
      lastObservedAt: now,
      playbookVersion: "2.0.0",
      rulebookVersion: "calendar-profile/future",
      severity: "attention",
      sourceReferences: [],
      status: "open",
      summary: "Future safe summary.",
      userId,
    });

    const review = await service.createReview(userId, { scope: { type: "all_outstanding" } });

    const [preserved] = await database.db
      .select()
      .from(calendarFindings)
      .where(eq(calendarFindings.id, futureFindingId));
    expect(preserved?.status).toBe("open");
    expect(preserved?.resolvedAt).toBeNull();
    expect(review.state).toBe("blocked");
    await expect(service.getStatus(userId)).resolves.toMatchObject({
      backlog: { blocked: 1, openFindings: null },
      lifecycle: "blocked",
      readiness: "degraded",
      health: expect.arrayContaining([
        expect.objectContaining({ dimension: "source_trust", signal: "healthy" }),
      ]),
    });
  });

  it("reports exact authority groups, honest counts, and setup readiness", async () => {
    const review = await service.createReview(userId, { scope: { type: "all_outstanding" } });
    const status = await service.getStatus(userId);

    expect(status.authority).toEqual({
      approvedRule: [],
      automatic: ["inspect", "assess"],
      individualApproval: [
        "create_event",
        "move_event",
        "resize_event",
        "trash_event",
        "restore_event",
      ],
      unavailable: [
        "rsvp",
        "invite",
        "cancel_attended_event",
        "book_travel",
        "send_correspondence",
      ],
    });
    expect(status.backlog).toEqual({
      actionable: review.findings.length,
      ambiguousEffects: null,
      awaitingApproval: null,
      awaitingInput: null,
      blocked: 0,
      failed: null,
      openFindings: review.findings.length,
    });
    expect(status.readiness).toBe("ready");
    expect(status.setupBlockers).toEqual([]);

    await database.db
      .update(domainProfiles)
      .set({ status: "draft", updatedAt: now, version: 2 })
      .where(and(eq(domainProfiles.id, profileId), eq(domainProfiles.userId, userId)));
    await database.db
      .update(calendars)
      .set({ isSelected: false, updatedAt: now })
      .where(and(eq(calendars.id, calendarId), eq(calendars.userId, userId)));
    const blockedReview = await service.createReview(userId, {
      scope: { type: "all_outstanding" },
    });
    expect(blockedReview.state).toBe("blocked");
    expect(blockedReview.findings).toEqual(review.findings);
    const persistedFindings = await database.db
      .select()
      .from(calendarFindings)
      .where(eq(calendarFindings.userId, userId));
    expect(persistedFindings.some(({ status }) => status === "open")).toBe(true);
    await expect(service.getStatus(userId)).resolves.toMatchObject({
      backlog: { actionable: null, blocked: 2, openFindings: null },
      health: expect.arrayContaining([
        expect.objectContaining({
          dimension: "source_trust",
          signal: "unknown",
          summary: "No selected Calendar source is available to assess.",
        }),
        expect.objectContaining({
          dimension: "hard_conflicts",
          signal: "unknown",
          summary: "Conflict coverage is unavailable because no Calendar source is selected.",
        }),
      ]),
      readiness: "setup_required",
      setupBlockers: [
        "Select at least one enabled Calendar source before relying on stewardship assessments.",
        "Activate a Calendar profile before relying on stewardship assessments.",
      ],
    });
  });
});
