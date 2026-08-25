import { resolve } from "node:path";
import {
  auditEvents,
  calendarAccounts,
  createDatabaseClient,
  type DatabaseClient,
  mailObligations,
  mailReviews,
  mailStewardshipFeedback,
  mailThreadDispositions,
  mailThreads,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import { createMailStewardshipService } from "./mail-stewardship-service.js";
import type { Principal } from "./types.js";

const initialNow = new Date("2026-08-25T15:00:00.000Z");

describe.sequential("Mail stewardship service", () => {
  let accountId: string;
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  let now: Date;
  let otherPrincipal: Principal;
  let principal: Principal;
  let service: ReturnType<typeof createMailStewardshipService>;
  let threadId: string;
  let threadUpdatedAt: string;

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
          displayName: "Mail owner",
          email: "mail-stewardship@example.com",
          passwordHash: "unused",
          planningTimezone: "UTC",
        },
        {
          displayName: "Other owner",
          email: "other-mail-stewardship@example.com",
          passwordHash: "unused",
          planningTimezone: "UTC",
        },
      ])
      .returning();
    if (!user || !otherUser) throw new Error("User fixtures were not created.");
    principal = {
      actorId: user.id,
      actorType: "user",
      scopes: new Set(),
      userId: user.id,
    };
    otherPrincipal = {
      actorId: otherUser.id,
      actorType: "user",
      scopes: new Set(),
      userId: otherUser.id,
    };

    const [account] = await database.db
      .insert(calendarAccounts)
      .values({
        label: "Mail account",
        provider: "google",
        providerAccountId: "mail-stewardship-owner",
        syncStatus: "idle",
        userId: user.id,
      })
      .returning();
    if (!account) throw new Error("Account fixture was not created.");
    accountId = account.id;

    const [thread] = await database.db
      .insert(mailThreads)
      .values({
        accountId,
        bodyText: "Private mail body that must not enter audit snapshots.",
        from: { address: "sender@example.com", name: "Sender" },
        provider: "google",
        receivedAt: now,
        remoteThreadId: "stewardship-thread",
        snippet: "Private snippet",
        subject: "Private subject",
        to: [{ address: "owner@example.com", name: "Owner" }],
        updatedAt: now,
        userId: user.id,
      })
      .returning();
    if (!thread) throw new Error("Thread fixture was not created.");
    threadId = thread.id;
    threadUpdatedAt = thread.updatedAt.toISOString();
    service = createMailStewardshipService({ db: database.db, now: () => now });
  });

  it("creates an owned obligation and exposes only the owner's thread stewardship", async () => {
    const obligation = await service.createObligation(
      principal.userId,
      threadId,
      {
        dueAt: null,
        goalIds: [],
        kind: "reply",
        nextReviewAt: null,
        owner: { kind: "user" },
        rationale: "Private rationale from the message.",
        sourceMessageId: null,
        sourceThreadRevision: threadUpdatedAt,
      },
      { principal, requestId: "create-obligation" },
    );

    expect(obligation).toMatchObject({
      confidence: "explicit",
      kind: "reply",
      state: "open",
      threadId,
      version: 1,
    });
    await expect(
      service.getThreadStewardship(otherPrincipal.userId, threadId),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(service.getThreadStewardship(principal.userId, threadId)).resolves.toMatchObject({
      disposition: null,
      obligations: [{ id: obligation.id }],
      questions: [],
      threadId,
      threadUpdatedAt,
    });

    const [audit] = await database.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.requestId, "create-obligation"));
    expect(audit?.after).toEqual({ id: obligation.id, threadId, version: 1 });
    expect(JSON.stringify(audit)).not.toContain("Private rationale");
    expect(JSON.stringify(audit)).not.toContain("Private mail body");
  });

  it("rejects stale thread evidence and stale obligation versions", async () => {
    const staleRevision = new Date(now.getTime() - 1_000).toISOString();
    await expect(
      service.createObligation(
        principal.userId,
        threadId,
        {
          dueAt: null,
          goalIds: [],
          kind: "decide",
          nextReviewAt: null,
          owner: { kind: "user" },
          rationale: "Decision needed.",
          sourceMessageId: null,
          sourceThreadRevision: staleRevision,
        },
        { principal, requestId: "stale-create" },
      ),
    ).rejects.toMatchObject({ code: "conflict" });

    const obligation = await service.createObligation(
      principal.userId,
      threadId,
      {
        dueAt: null,
        goalIds: [],
        kind: "decide",
        nextReviewAt: null,
        owner: { kind: "user" },
        rationale: "Decision needed.",
        sourceMessageId: null,
        sourceThreadRevision: threadUpdatedAt,
      },
      { principal, requestId: "fresh-create" },
    );
    await service.updateObligation(
      principal.userId,
      obligation.id,
      { expectedVersion: 1, state: "resolved" },
      { principal, requestId: "resolve" },
    );
    await expect(
      service.updateObligation(
        principal.userId,
        obligation.id,
        { expectedVersion: 1, state: "dismissed" },
        { principal, requestId: "stale-update" },
      ),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("keeps disposition history while allowing exactly one current disposition", async () => {
    const first = await service.setDisposition(
      principal.userId,
      threadId,
      {
        disposition: "active",
        expectedThreadUpdatedAt: threadUpdatedAt,
        rationale: "Still needs attention.",
      },
      { principal, requestId: "first-disposition" },
    );
    const second = await service.setDisposition(
      principal.userId,
      threadId,
      {
        disposition: "resolved",
        expectedThreadUpdatedAt: threadUpdatedAt,
        rationale: "The obligation was handled outside mail.",
      },
      { principal, requestId: "second-disposition" },
    );

    expect(first).toMatchObject({ current: true, version: 1 });
    expect(second).toMatchObject({ current: true, version: 2 });
    await expect(service.listDispositionHistory(principal.userId, threadId)).resolves.toEqual([
      expect.objectContaining({ current: true, id: second.id, version: 2 }),
      expect.objectContaining({ current: false, id: first.id, version: 1 }),
    ]);
    await expect(
      service.setDisposition(
        principal.userId,
        threadId,
        {
          disposition: "noise",
          expectedThreadUpdatedAt: new Date(now.getTime() - 1_000).toISOString(),
          rationale: "Stale judgment.",
        },
        { principal, requestId: "stale-disposition" },
      ),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("serializes concurrent disposition judgments behind the owned thread revision", async () => {
    await Promise.all([
      service.setDisposition(
        principal.userId,
        threadId,
        {
          disposition: "waiting",
          expectedThreadUpdatedAt: threadUpdatedAt,
          rationale: "Waiting on another person.",
        },
        { principal, requestId: "concurrent-waiting" },
      ),
      service.setDisposition(
        principal.userId,
        threadId,
        {
          disposition: "active",
          expectedThreadUpdatedAt: threadUpdatedAt,
          rationale: "Still active.",
        },
        { principal, requestId: "concurrent-active" },
      ),
    ]);

    const history = await service.listDispositionHistory(principal.userId, threadId);
    expect(history.map((row) => row.version)).toEqual([2, 1]);
    expect(history.filter((row) => row.current)).toHaveLength(1);
  });

  it("removes thread-bound state but retains safe feedback and reviews when source mail disappears", async () => {
    const disposition = await service.setDisposition(
      principal.userId,
      threadId,
      {
        disposition: "reference",
        expectedThreadUpdatedAt: threadUpdatedAt,
        rationale: "Keep as reference.",
      },
      { principal, requestId: "deletion-disposition" },
    );
    const [feedback] = await database.db
      .insert(mailStewardshipFeedback)
      .values({
        comment: "This remains a safe learning observation.",
        kind: "correct",
        targetId: disposition.id,
        targetType: "disposition",
        userId: principal.userId,
      })
      .returning();
    const [review] = await database.db
      .insert(mailReviews)
      .values({
        effectCounts: { failed: 0, pending: 0, reconcile: 0 },
        evidenceCutoff: now,
        health: [],
        ledgerFingerprint: "a".repeat(64),
        nextMaintenanceAt: new Date(now.getTime() + 86_400_000),
        obligationCounts: { deferred: 0, dismissed: 0, open: 0, resolved: 0, waiting: 0 },
        openQuestionCount: 0,
        playbookVersion: "1.0.0",
        profileVersion: null,
        rulebookVersion: "initial",
        sourceFreshness: "current",
        state: "maintained",
        userId: principal.userId,
      })
      .returning();
    if (!feedback || !review) throw new Error("Retention fixtures were not created.");

    await database.db.delete(mailThreads).where(eq(mailThreads.id, threadId));

    await expect(
      database.db.select().from(mailObligations).where(eq(mailObligations.threadId, threadId)),
    ).resolves.toEqual([]);
    await expect(
      database.db
        .select()
        .from(mailThreadDispositions)
        .where(eq(mailThreadDispositions.threadId, threadId)),
    ).resolves.toEqual([]);
    await expect(
      database.db
        .select({ id: mailStewardshipFeedback.id })
        .from(mailStewardshipFeedback)
        .where(eq(mailStewardshipFeedback.id, feedback.id)),
    ).resolves.toEqual([{ id: feedback.id }]);
    await expect(
      database.db
        .select({ id: mailReviews.id })
        .from(mailReviews)
        .where(eq(mailReviews.id, review.id)),
    ).resolves.toEqual([{ id: review.id }]);
  });
});
