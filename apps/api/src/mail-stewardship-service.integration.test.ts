import { resolve } from "node:path";
import {
  auditEvents,
  calendarAccounts,
  createDatabaseClient,
  type DatabaseClient,
  mailDrafts,
  mailMessages,
  mailObligations,
  mailReviews,
  mailRuleProposals,
  mailSnoozes,
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
import { createWorkspaceMaintenanceService } from "./workspace-maintenance-service.js";

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

  it("fences mutations to the owner and validates obligation evidence", async () => {
    const input = {
      dueAt: "2026-08-27T12:00:00.000Z",
      goalIds: ["goal-1"],
      kind: "follow_up" as const,
      nextReviewAt: "2026-08-26T12:00:00.000Z",
      owner: { kind: "user" as const },
      rationale: "Follow up outside Mail.",
      sourceMessageId: null,
      sourceThreadRevision: threadUpdatedAt,
    };

    await expect(
      service.createObligation(principal.userId, threadId, input, {
        principal: otherPrincipal,
        requestId: "foreign-create",
      }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      service.createObligation(
        principal.userId,
        threadId,
        { ...input, sourceMessageId: "00000000-0000-4000-8000-000000000001" },
        { principal, requestId: "invalid-message" },
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });

    const [message] = await database.db
      .insert(mailMessages)
      .values({
        bodyText: "Private source message.",
        from: { address: "sender@example.com", name: "Sender" },
        receivedAt: now,
        remoteMessageId: "stewardship-message",
        threadId,
        to: [],
      })
      .returning();
    if (!message) throw new Error("Message fixture was not created.");

    const created = await service.createObligation(
      principal.userId,
      threadId,
      { ...input, sourceMessageId: message.id },
      { principal, requestId: "dated-obligation" },
    );
    expect(created).toMatchObject({
      dueAt: input.dueAt,
      nextReviewAt: input.nextReviewAt,
      sourceMessageId: message.id,
    });

    const cleared = await service.updateObligation(
      principal.userId,
      created.id,
      { dueAt: null, expectedVersion: 1, nextReviewAt: null },
      { principal, requestId: "clear-schedule" },
    );
    expect(cleared).toMatchObject({ dueAt: null, nextReviewAt: null, version: 2 });
    const rescheduled = await service.updateObligation(
      principal.userId,
      created.id,
      {
        dueAt: "2026-08-29T12:00:00.000Z",
        expectedVersion: 2,
        nextReviewAt: "2026-08-28T12:00:00.000Z",
      },
      { principal, requestId: "restore-schedule" },
    );
    expect(rescheduled).toMatchObject({
      dueAt: "2026-08-29T12:00:00.000Z",
      nextReviewAt: "2026-08-28T12:00:00.000Z",
      version: 3,
    });
    await expect(
      service.updateObligation(
        principal.userId,
        "00000000-0000-4000-8000-000000000002",
        { expectedVersion: 1, state: "resolved" },
        { principal, requestId: "missing-obligation" },
      ),
    ).rejects.toMatchObject({ code: "not_found" });
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

  it("replaces an existing disposition once and rejects settled or stale answers", async () => {
    await service.setDisposition(
      principal.userId,
      threadId,
      {
        disposition: "active",
        expectedThreadUpdatedAt: threadUpdatedAt,
        rationale: "Initially active.",
      },
      { principal, requestId: "initial-answer-disposition" },
    );
    const [question] = await database.db
      .insert(mailStewardshipQuestions)
      .values({
        accountId,
        evidence: [],
        fingerprint: "e".repeat(64),
        kind: "needs_disposition",
        reason: "Choose the current disposition.",
        threadId,
        userId: principal.userId,
      })
      .returning();
    if (!question) throw new Error("Question fixture was not created.");

    await expect(
      service.answerQuestion(
        principal.userId,
        question.id,
        { answer: "resolved", expectedVersion: 1, generalize: false },
        { principal, requestId: "replace-answer-disposition" },
      ),
    ).resolves.toMatchObject({ status: "answered", version: 2 });
    await expect(service.listDispositionHistory(principal.userId, threadId)).resolves.toEqual([
      expect.objectContaining({ current: true, disposition: "resolved", version: 2 }),
      expect.objectContaining({ current: false, disposition: "active", version: 1 }),
    ]);
    await expect(
      service.answerQuestion(
        principal.userId,
        question.id,
        { answer: "reference", expectedVersion: 1, generalize: false },
        { principal, requestId: "stale-question-answer" },
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      service.answerQuestion(
        principal.userId,
        question.id,
        { answer: "reference", expectedVersion: 2, generalize: false },
        { principal, requestId: "settled-question-answer" },
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      service.answerQuestion(
        principal.userId,
        "00000000-0000-4000-8000-000000000003",
        { answer: "reference", expectedVersion: 1, generalize: false },
        { principal, requestId: "missing-question-answer" },
      ),
    ).rejects.toMatchObject({ code: "not_found" });
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

  it("reopens incorrect obligations and records proposal exceptions without approving rules", async () => {
    const obligation = await service.createObligation(
      principal.userId,
      threadId,
      {
        dueAt: null,
        goalIds: [],
        kind: "decide",
        nextReviewAt: null,
        owner: { kind: "user" },
        rationale: "Decision was believed complete.",
        sourceMessageId: null,
        sourceThreadRevision: threadUpdatedAt,
      },
      { principal, requestId: "feedback-obligation" },
    );
    await service.updateObligation(
      principal.userId,
      obligation.id,
      { expectedVersion: 1, state: "resolved" },
      { principal, requestId: "feedback-resolve" },
    );
    await service.createFeedback(
      principal.userId,
      {
        comment: "The obligation is still open.",
        kind: "incorrect",
        targetId: obligation.id,
        targetType: "obligation",
      },
      { principal, requestId: "feedback-reopen" },
    );
    await expect(service.getThreadStewardship(principal.userId, threadId)).resolves.toMatchObject({
      obligations: [expect.objectContaining({ id: obligation.id, state: "open", version: 3 })],
    });

    const [proposal] = await database.db
      .insert(mailRuleProposals)
      .values({
        examples: ["question:example"],
        fingerprint: "f".repeat(64),
        rationale: "Treat matching mail as reference.",
        userId: principal.userId,
      })
      .returning();
    if (!proposal) throw new Error("Rule proposal fixture was not created.");
    const feedback = await service.createFeedback(
      principal.userId,
      {
        comment: "Except when the sender asks for a decision.",
        kind: "exception",
        targetId: proposal.id,
        targetType: "rule_proposal",
      },
      { principal, requestId: "proposal-exception" },
    );
    expect(feedback).toMatchObject({ evidence: [], kind: "exception" });
    await expect(service.listRuleProposals(principal.userId)).resolves.toEqual([
      expect.objectContaining({
        approvedRuleId: null,
        counterexamples: ["Except when the sender asks for a decision."],
        exceptions: ["Except when the sender asks for a decision."],
        status: "proposed",
        version: 2,
      }),
    ]);
  });

  it("routes question and review feedback while rejecting every missing target type", async () => {
    const [question] = await database.db
      .insert(mailStewardshipQuestions)
      .values({
        accountId,
        evidence: [],
        fingerprint: "1".repeat(64),
        kind: "needs_owner",
        reason: "Confirm the owner.",
        threadId,
        userId: principal.userId,
      })
      .returning();
    const [review] = await database.db
      .insert(mailReviews)
      .values({
        effectCounts: { failed: 0, pending: 0, reconcile: 0 },
        evidenceCutoff: now,
        health: [],
        ledgerFingerprint: "2".repeat(64),
        nextMaintenanceAt: new Date(now.getTime() + 86_400_000),
        obligationCounts: { deferred: 0, dismissed: 0, open: 0, resolved: 0, waiting: 0 },
        openQuestionCount: 1,
        playbookVersion: "1.0.0",
        profileVersion: null,
        rulebookVersion: "initial",
        sourceFreshness: "current",
        state: "maintained_with_questions",
        userId: principal.userId,
      })
      .returning();
    if (!question || !review) throw new Error("Feedback fixtures were not created.");

    await expect(
      service.createFeedback(
        principal.userId,
        {
          comment: "The ownership evidence is outdated.",
          kind: "outdated",
          targetId: question.id,
          targetType: "question",
        },
        { principal, requestId: "question-feedback" },
      ),
    ).resolves.toMatchObject({
      evidence: [expect.objectContaining({ sourceType: "mail_thread" })],
    });
    await expect(
      service.createFeedback(
        principal.userId,
        {
          comment: "The review is accurate.",
          kind: "correct",
          targetId: review.id,
          targetType: "review",
        },
        { principal, requestId: "review-feedback" },
      ),
    ).resolves.toMatchObject({ evidence: [] });
    await expect(
      database.db
        .select()
        .from(mailStewardshipQuestions)
        .where(eq(mailStewardshipQuestions.userId, principal.userId)),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: question.id, kind: "needs_owner" }),
        expect.objectContaining({ kind: "needs_disposition", status: "open" }),
      ]),
    );

    const missingId = "00000000-0000-4000-8000-000000000005";
    for (const targetType of [
      "obligation",
      "disposition",
      "question",
      "rule_proposal",
      "review",
    ] as const) {
      await expect(
        service.createFeedback(
          principal.userId,
          { comment: "Missing target.", kind: "correct", targetId: missingId, targetType },
          { principal, requestId: `missing-${targetType}` },
        ),
      ).rejects.toMatchObject({ code: "not_found" });
    }
  });

  it("scopes snapshots and reports partial, stale, and unavailable evidence honestly", async () => {
    await database.db.insert(mailMessages).values([
      {
        bodyText: "Inbound private content.",
        from: { address: "sender@example.com", name: "Sender" },
        providerMailboxIds: ["INBOX"],
        providerRevision: "inbound-v1",
        receivedAt: now,
        remoteMessageId: "snapshot-inbound",
        threadId,
        to: [],
      },
      {
        bodyText: "Outbound private content.",
        from: { address: "owner@example.com", name: "Owner" },
        providerMailboxIds: ["SENT"],
        providerRevision: "outbound-v1",
        receivedAt: new Date(now.getTime() + 60_000),
        remoteMessageId: "snapshot-outbound",
        threadId,
        to: [],
      },
    ]);
    await database.db.insert(mailSnoozes).values({
      threadId,
      until: new Date(now.getTime() + 86_400_000),
      userId: principal.userId,
    });
    await service.createObligation(
      principal.userId,
      threadId,
      {
        dueAt: null,
        goalIds: ["goal-linked"],
        kind: "reply",
        nextReviewAt: null,
        owner: { kind: "user" },
        rationale: "Reply outside Ilo and record the linked decision.",
        sourceMessageId: null,
        sourceThreadRevision: threadUpdatedAt,
      },
      { principal, requestId: "snapshot-obligation" },
    );
    await expect(
      service.snapshot(principal.userId, {
        entityType: "task",
        id: threadId,
        type: "target",
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      service.snapshot(principal.userId, {
        end: "2026-08-24",
        start: "2026-08-24",
        type: "window",
      }),
    ).resolves.toMatchObject({ sourceFreshness: "current", threads: [] });

    const targetSnapshot = await service.snapshot(principal.userId, {
      entityType: "mail_thread",
      id: threadId,
      type: "target",
    });
    expect(targetSnapshot).toMatchObject({
      threads: [
        expect.objectContaining({
          goalLinked: true,
          messages: [
            expect.objectContaining({ direction: "inbound", revision: "inbound-v1" }),
            expect.objectContaining({ direction: "outbound", revision: "outbound-v1" }),
          ],
          snoozedUntil: "2026-08-26T15:00:00.000Z",
        }),
      ],
    });
    const targetAssessment = assessMail(targetSnapshot, MAIL_PLAYBOOK);
    expect(targetAssessment).toMatchObject({
      dispositionTransitions: [expect.objectContaining({ disposition: "deferred" })],
      obligationTransitions: [expect.objectContaining({ nextState: "resolved" })],
    });
    await expect(
      service.reconcileAssessment(principal.userId, targetSnapshot, targetAssessment),
    ).resolves.toMatchObject({ dispositions: 1, obligations: 1, questions: 1 });
    await expect(
      service.reconcileAssessment(principal.userId, targetSnapshot, {
        ...targetAssessment,
        obligationTransitions: [],
      }),
    ).resolves.toMatchObject({ dispositions: 0, obligations: 0, questions: 0 });
    await expect(
      service.reconcileAssessment(principal.userId, targetSnapshot, {
        ...targetAssessment,
        ledgerFingerprint: "0".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "conflict" });

    const firstReview = await service.createReview(
      principal.userId,
      targetSnapshot,
      targetAssessment,
    );
    await expect(
      service.createReview(principal.userId, targetSnapshot, targetAssessment),
    ).resolves.toEqual(firstReview);
    await expect(
      service.createReview(principal.userId, targetSnapshot, {
        ...targetAssessment,
        ledgerFingerprint: "3".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "conflict" });

    await database.db.insert(calendarAccounts).values({
      label: "Unsynced Mail account",
      lastSyncedAt: null,
      mailEnabled: true,
      provider: "icloud",
      providerAccountId: "mail-stewardship-unsynced",
      syncStatus: "idle",
      userId: principal.userId,
    });
    await expect(
      service.snapshot(principal.userId, { type: "all_outstanding" }),
    ).resolves.toMatchObject({ sourceFreshness: "partial" });

    await database.db
      .update(calendarAccounts)
      .set({ lastSyncedAt: new Date(now.getTime() - 86_400_000) })
      .where(eq(calendarAccounts.id, accountId));
    await expect(service.getStatus(principal.userId)).resolves.toMatchObject({
      freshness: { state: "stale" },
      state: "blocked",
    });

    await database.db
      .update(calendarAccounts)
      .set({ lastSyncedAt: null })
      .where(eq(calendarAccounts.userId, principal.userId));
    await expect(
      service.snapshot(principal.userId, { type: "all_outstanding" }),
    ).resolves.toMatchObject({ sourceFreshness: "unavailable" });
    await expect(
      service.getReview(principal.userId, "00000000-0000-4000-8000-000000000004"),
    ).rejects.toMatchObject({ code: "not_found" });
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

  it("distinguishes needs-work and clean status while projecting an active durable turn", async () => {
    await service.setDisposition(
      principal.userId,
      threadId,
      {
        disposition: "reference",
        expectedThreadUpdatedAt: threadUpdatedAt,
        rationale: "This is durable reference material.",
      },
      { principal, requestId: "status-disposition" },
    );
    await expect(service.getStatus(principal.userId)).resolves.toMatchObject({
      activeRun: null,
      details: { latestReview: null },
      state: "needs_work",
    });

    const sourceSnapshot = await service.snapshot(principal.userId, { type: "all_outstanding" });
    const assessment = assessMail(sourceSnapshot, MAIL_PLAYBOOK);
    await service.createReview(principal.userId, sourceSnapshot, assessment);
    await expect(service.getStatus(principal.userId)).resolves.toMatchObject({ state: "clean" });

    const workspace = createWorkspaceMaintenanceService({ db: database.db, now: () => now });
    const run = await workspace.createOrResume(
      principal.userId,
      "mail",
      { type: "all_outstanding" },
      "mail-maintenance-v1:1.0.0",
    );
    await expect(service.getStatus(principal.userId)).resolves.toMatchObject({
      activeRun: { id: run.id, status: "queued" },
      state: "clean",
    });
  });
});
