import { resolve } from "node:path";
import {
  auditEvents,
  calendarAccounts,
  createDatabaseClient,
  type DatabaseClient,
  mailDrafts,
  mailObligations,
  mailReviews,
  mailRuleProposals,
  mailStewardshipFeedback,
  mailStewardshipQuestions,
  mailThreadDispositions,
  mailThreads,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import { assessMail } from "./mail-assessment.js";
import { MAIL_PLAYBOOK } from "./mail-playbook.js";
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
        lastSyncedAt: now,
        mailEnabled: true,
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
        starred: true,
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

  it("answers one question without generalizing by default", async () => {
    const [question] = await database.db
      .insert(mailStewardshipQuestions)
      .values({
        accountId,
        evidence: [
          {
            accountId,
            provider: "google",
            remoteId: "stewardship-thread",
            revision: threadUpdatedAt,
            sourceType: "mail_thread",
          },
        ],
        fingerprint: "b".repeat(64),
        kind: "needs_disposition",
        reason: "Choose a disposition.",
        threadId,
        userId: principal.userId,
      })
      .returning();
    if (!question) throw new Error("Question fixture was not created.");

    const answered = await service.answerQuestion(
      principal.userId,
      question.id,
      { answer: "Reference only", expectedVersion: 1, generalize: false },
      { principal, requestId: "answer-without-generalizing" },
    );

    expect(answered).toMatchObject({ answer: "Reference only", status: "answered", version: 2 });
    await expect(service.listRuleProposals(principal.userId)).resolves.toEqual([]);
  });

  it("creates a disabled proposal only when the user explicitly generalizes", async () => {
    const [question] = await database.db
      .insert(mailStewardshipQuestions)
      .values({
        accountId,
        evidence: [
          {
            accountId,
            provider: "google",
            remoteId: "stewardship-thread",
            revision: threadUpdatedAt,
            sourceType: "mail_thread",
          },
        ],
        fingerprint: "c".repeat(64),
        kind: "needs_exception",
        reason: "Should this become a reusable preference?",
        threadId,
        userId: principal.userId,
      })
      .returning();
    if (!question) throw new Error("Question fixture was not created.");

    await service.answerQuestion(
      principal.userId,
      question.id,
      {
        answer: "Treat matching receipts as reference",
        expectedVersion: 1,
        generalize: true,
      },
      { principal, requestId: "answer-with-generalizing" },
    );

    await expect(service.listRuleProposals(principal.userId)).resolves.toEqual([
      expect.objectContaining({
        approvedRuleId: null,
        counterexamples: [],
        examples: [`question:${question.id}`],
        exceptions: [],
        status: "proposed",
        version: 1,
      }),
    ]);
    const [proposal] = await database.db.select().from(mailRuleProposals);
    expect(proposal?.approvedRuleId).toBeNull();
  });

  it("applies only an exact selected disposition from an answered question", async () => {
    const [question] = await database.db
      .insert(mailStewardshipQuestions)
      .values({
        accountId,
        evidence: [
          {
            accountId,
            provider: "google",
            remoteId: "stewardship-thread",
            revision: threadUpdatedAt,
            sourceType: "mail_thread",
          },
        ],
        fingerprint: "d".repeat(64),
        kind: "needs_disposition",
        options: [{ label: "Reference", value: "reference" }],
        reason: "Choose a disposition.",
        threadId,
        userId: principal.userId,
      })
      .returning();
    if (!question) throw new Error("Question fixture was not created.");

    await service.answerQuestion(
      principal.userId,
      question.id,
      { answer: "reference", expectedVersion: 1, generalize: false },
      { principal, requestId: "answer-disposition" },
    );

    await expect(service.getThreadStewardship(principal.userId, threadId)).resolves.toMatchObject({
      disposition: { disposition: "reference", version: 1 },
    });
  });

  it("returns a non-transmittable response brief without persisting correspondence", async () => {
    const beforeDrafts = await database.db.select({ id: mailDrafts.id }).from(mailDrafts);
    const brief = await service.previewResponseBrief(principal.userId, threadId, {
      expectedThreadUpdatedAt: threadUpdatedAt,
      factsToAddress: ["Confirm the recorded decision."],
      materialsNeeded: ["Decision record"],
      openQuestions: ["Who owns the next step?"],
      purpose: "Prepare for a response outside Ilo.",
      toneConsiderations: ["Direct"],
    });

    expect(brief).toMatchObject({
      purpose: "Prepare for a response outside Ilo.",
      sourceThreadRevision: threadUpdatedAt,
      transmittable: false,
    });
    expect(brief).not.toHaveProperty("body");
    expect(brief).not.toHaveProperty("to");
    await expect(database.db.select({ id: mailDrafts.id }).from(mailDrafts)).resolves.toEqual(
      beforeDrafts,
    );
  });

  it("records incorrect feedback and opens one bounded correction question", async () => {
    const disposition = await service.setDisposition(
      principal.userId,
      threadId,
      {
        disposition: "reference",
        expectedThreadUpdatedAt: threadUpdatedAt,
        rationale: "Initial judgment.",
      },
      { principal, requestId: "feedback-target" },
    );

    const feedback = await service.createFeedback(
      principal.userId,
      {
        comment: "This disposition is incorrect.",
        kind: "incorrect",
        targetId: disposition.id,
        targetType: "disposition",
      },
      { principal, requestId: "incorrect-feedback" },
    );

    expect(feedback).toMatchObject({ kind: "incorrect", targetId: disposition.id });
    const questions = await database.db
      .select()
      .from(mailStewardshipQuestions)
      .where(eq(mailStewardshipQuestions.userId, principal.userId));
    expect(questions).toEqual([
      expect.objectContaining({ kind: "needs_correction", status: "open", threadId }),
    ]);
  });

  it("publishes an immutable review and honest status from a content-free snapshot", async () => {
    const sourceSnapshot = await service.snapshot(principal.userId, {
      type: "all_outstanding",
    });
    expect(sourceSnapshot).toMatchObject({
      profileId: null,
      profileVersion: null,
      sourceFreshness: "current",
      threads: [expect.objectContaining({ id: threadId, starred: true })],
    });
    expect(JSON.stringify(sourceSnapshot)).not.toContain("Private mail body");
    expect(JSON.stringify(sourceSnapshot)).not.toContain("Private subject");

    const assessment = assessMail(sourceSnapshot, MAIL_PLAYBOOK);
    await service.reconcileAssessment(principal.userId, sourceSnapshot, assessment);
    const review = await service.createReview(principal.userId, sourceSnapshot, assessment);

    expect(review).toMatchObject({
      ledgerFingerprint: assessment.ledgerFingerprint,
      openQuestionCount: 1,
      playbookVersion: MAIL_PLAYBOOK.version,
      sourceFreshness: "current",
      state: "maintained_with_questions",
    });
    await expect(service.getReview(principal.userId, review.id)).resolves.toEqual(review);
    await expect(service.getStatus(principal.userId)).resolves.toMatchObject({
      details: {
        authority: { unavailable: expect.arrayContaining(["send_email"]) },
        latestReview: { id: review.id },
        openQuestionCount: 1,
      },
      domain: "mail",
      state: "needs_input",
    });
  });
});
