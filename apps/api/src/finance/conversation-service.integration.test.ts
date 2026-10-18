import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  accessTokens,
  automationHostSchedules,
  createDatabaseClient,
  type DatabaseClient,
  executionPolicySettings,
  financeAccounts,
  financeAnswerContinuations,
  financeConversationBatches,
  financeConversationBatchMessages,
  financeConversationMessages,
  financeConversationReadCursors,
  financeConversations,
  financeTransactions,
  migrateDatabase,
  users,
  workspaceMaintenanceRuns,
} from "@personal-os/database";
import { automationHostScheduleSchema } from "@personal-os/domain";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { and, eq } from "drizzle-orm";
import type { Principal } from "../types.js";
import { createFinanceContextualQuestionService } from "./contextual-question-service.js";
import { createFinanceConversationService } from "./conversation-persistence.js";
import {
  captureFinanceConversationBatch,
  postgresConversationBatchStore,
} from "./conversation-service.js";

/** Authored for the exclusive PostgreSQL verification slot; never run as a unit substitute. */
describe.sequential("durable Finance conversation intake", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
  }, 120_000);
  afterAll(async () => {
    await database?.close();
    await container?.stop();
  });
  async function fixture() {
    const userId = randomUUID();
    await database.db.insert(users).values({
      id: userId,
      displayName: "Conversation",
      email: `${userId}@example.com`,
      passwordHash: "unused",
    });
    const [account] = await database.db
      .insert(financeAccounts)
      .values({ userId, provider: "manual", institution: "Manual", name: "Cash" })
      .returning();
    if (!account) throw new Error("account");
    const [transaction] = await database.db
      .insert(financeTransactions)
      .values({
        userId,
        accountId: account.id,
        amount: 1200,
        merchant: "Lunch",
        direction: "expense",
        transactionDate: "2026-10-18",
      })
      .returning();
    if (!transaction) throw new Error("transaction");
    const principal: Principal = {
      userId,
      actorId: userId,
      actorType: "user",
      scopes: new Set(["finances:read", "finances:write"]),
    };
    const context = { principal, requestId: randomUUID() };
    const questions = createFinanceContextualQuestionService({ db: database.db });
    const question = await questions.createQuestion(
      transaction.id,
      { operationId: randomUUID() },
      context,
    );
    if (question.state !== "available") throw new Error("question");
    const answer = {
      operationId: randomUUID(),
      work: question.question.work,
      text: "Lunch with a friend",
      source: { kind: "app", messageId: null },
    };
    return {
      userId,
      account,
      transaction,
      principal,
      context,
      questions,
      question: question.question,
      answer,
    };
  }
  async function canonicalRun(userId: string) {
    const [run] = await database.db
      .insert(workspaceMaintenanceRuns)
      .values({
        userId,
        domain: "finances",
        scope: { type: "all_outstanding" },
        rulebookVersion: "conversation-fixture",
      })
      .returning();
    if (!run) throw new Error("run");
    return run;
  }
  async function hostFixture() {
    const f = await fixture();
    const connectionId = randomUUID();
    const scheduleId = randomUUID();
    const scopes = [
      "finances:read",
      "finances:write",
      "finances:execute",
      "finances:maintain",
    ] as const;
    const [token] = await database.db
      .insert(accessTokens)
      .values({
        userId: f.userId,
        name: "Conversation host",
        authorizationConnectionId: connectionId,
        tokenHash: randomUUID(),
        scopes: [...scopes],
      })
      .returning();
    if (!token) throw new Error("token");
    await database.db
      .insert(executionPolicySettings)
      .values({ userId: f.userId, reviewBypassEnabled: true });
    const stamp = new Date().toISOString();
    await database.db.insert(automationHostSchedules).values({
      id: scheduleId,
      userId: f.userId,
      authorizationConnectionId: connectionId,
      schedule: automationHostScheduleSchema.parse({
        id: scheduleId,
        tenantAuthorizationConnectionId: connectionId,
        hostSurface: "codex_desktop",
        hostAutomationId: "conversation-fixture",
        label: "Conversation",
        effectiveScopes: [...scopes],
        trigger: {
          type: "recurring",
          recurrence: { type: "interval", everyMinutes: 2, timeZone: "America/New_York" },
        },
        state: "active",
        lastObservedAt: stamp,
        nextExpectedAt: stamp,
        version: 1,
        createdAt: stamp,
        updatedAt: stamp,
      }),
    });
    const agent: Principal = {
      userId: f.userId,
      actorId: token.id,
      actorType: "agent",
      authorizationConnectionId: connectionId,
      scopes: new Set(scopes),
    };
    const conversation = createFinanceConversationService({ db: database.db });
    const challenge = await conversation.issueChallenge(f.principal, scheduleId);
    const fetched = await conversation.advanceChallenge(agent, challenge.challengeId, {
      kind: "fetch",
    });
    if (!fetched.nonce) throw new Error("nonce");
    await conversation.advanceChallenge(agent, challenge.challengeId, {
      kind: "acknowledge",
      challengeId: challenge.challengeId,
      nonce: fetched.nonce,
    });
    await conversation.advanceChallenge(agent, challenge.challengeId, {
      kind: "respond",
      challengeId: challenge.challengeId,
      response: "Finance message protocol ready",
    });
    return { ...f, conversation, agent, scheduleId, connectionId, token };
  }
  it("keeps protocol traffic outside history and freezes sending on original grant loss", async () => {
    const f = await hostFixture();
    expect((await f.conversation.getReadiness(f.userId)).canSend).toBe(true);
    expect((await f.conversation.history(f.userId)).messages).toHaveLength(0);
    await f.conversation.send(f.principal, {
      text: "A question",
      idempotencyKey: "first",
      caseId: null,
      recordRefs: [],
    });
    await database.db
      .update(accessTokens)
      .set({ revokedAt: new Date() })
      .where(eq(accessTokens.id, f.token.id));
    expect((await f.conversation.getReadiness(f.userId)).canSend).toBe(false);
    expect((await f.conversation.history(f.userId)).messages).toHaveLength(1);
    await expect(
      f.conversation.send(f.principal, {
        text: "later",
        idempotencyKey: "second",
        caseId: null,
        recordRefs: [],
      }),
    ).rejects.toThrow("Verify");
  });
  it("retries pages without admitting later messages or acknowledging unseen members, keeping human read state separate", async () => {
    const f = await hostFixture();
    const first = await f.conversation.send(f.principal, {
      text: "first",
      idempotencyKey: "one",
      caseId: null,
      recordRefs: [],
    });
    const second = await f.conversation.send(f.principal, {
      text: "second",
      idempotencyKey: "two",
      caseId: null,
      recordRefs: [],
    });
    const run = await canonicalRun(f.userId);
    await database.db
      .update(workspaceMaintenanceRuns)
      .set({ automationScheduleId: f.scheduleId, authorizationConnectionId: f.connectionId })
      .where(eq(workspaceMaintenanceRuns.id, run.id));
    await database.db.transaction((tx) =>
      captureFinanceConversationBatch({
        tx,
        store: postgresConversationBatchStore,
        userId: f.userId,
        runId: run.id,
        automationScheduleId: f.scheduleId,
        authorizationConnectionId: f.connectionId,
        now: new Date(),
      }),
    );
    const later = await f.conversation.send(f.principal, {
      text: "next run",
      idempotencyKey: "three",
      caseId: null,
      recordRefs: [],
    });
    const page = await f.conversation.pageBatch(f.agent, run.id, "0", 1);
    expect(page.messages.map((message) => message.id)).toEqual([first.id]);
    expect(await f.conversation.pageBatch(f.agent, run.id, "0", 1)).toEqual(page);
    await expect(f.conversation.acknowledgeBatch(f.agent, run.id, [second.id])).rejects.toThrow(
      "exact",
    );
    await f.conversation.acknowledgeBatch(f.agent, run.id, [first.id]);
    expect(
      await database.db
        .select()
        .from(financeConversationReadCursors)
        .where(eq(financeConversationReadCursors.userId, f.userId)),
    ).toHaveLength(0);
    if (!page.nextCursor) throw new Error("cursor");
    const final = await f.conversation.pageBatch(f.agent, run.id, page.nextCursor, 1);
    expect(final.messages.map((message) => message.id)).toEqual([second.id]);
    expect(final.nextCursor).toBeNull();
    expect(final.messages.some((message) => message.id === later.id)).toBe(false);
    await f.conversation.markRendered(f.principal, later.sequence);
    expect(await f.conversation.markRendered(f.principal, first.sequence)).toEqual({
      readThroughSequence: later.sequence,
    });
    await expect(
      f.conversation.reply(f.agent, {
        runId: run.id,
        idempotencyKey: "reply",
        text: "answer",
        sourceMessageIds: [later.id],
      }),
    ).rejects.toThrow("fixed");
  });
  it("shares accepted answer operation and continuation, preserving history and receipt replay after hard source deletion", async () => {
    const f = await fixture();
    expect((await f.questions.answerWork(f.answer, f.context)).state).toBe("accepted");
    expect((await f.questions.answerWork(f.answer, f.context)).state).toBe("accepted");
    const messages = await database.db
      .select()
      .from(financeConversationMessages)
      .where(eq(financeConversationMessages.userId, f.userId));
    const continuations = await database.db
      .select()
      .from(financeAnswerContinuations)
      .where(eq(financeAnswerContinuations.operationId, f.answer.operationId));
    expect(messages).toHaveLength(1);
    expect(continuations).toHaveLength(1);
    expect(messages[0]?.sourceOperationId).toBe(f.answer.operationId);
    expect(messages[0]?.caseId).toBe(f.question.reviewCaseId);
    await expect(
      database.db
        .update(financeConversationMessages)
        .set({ caseId: null, caseOwnerId: null })
        .where(eq(financeConversationMessages.userId, f.userId)),
    ).rejects.toThrow();
    await expect(
      database.db
        .update(financeConversationMessages)
        .set({ text: "rewritten" })
        .where(eq(financeConversationMessages.userId, f.userId)),
    ).rejects.toThrow();
    await database.db
      .delete(financeTransactions)
      .where(eq(financeTransactions.id, f.transaction.id));
    const history = await createFinanceConversationService({ db: database.db }).history(f.userId);
    expect(history.messages).toHaveLength(1);
    expect(history.messages[0]).toMatchObject({
      text: f.answer.text,
      caseId: f.question.reviewCaseId,
    });
    expect((await f.questions.answerWork(f.answer, f.context)).state).toBe("accepted");
  });
  it("rolls back accepted answer, continuation, conversation sequence and message together", async () => {
    const f = await fixture();
    await expect(
      database.db.transaction(async (tx) => {
        const result = await f.questions.answerWork(f.answer, f.context, tx);
        expect(result.state).toBe("accepted");
        throw new Error("forced rollback");
      }),
    ).rejects.toThrow("forced rollback");
    expect(
      await database.db
        .select()
        .from(financeConversationMessages)
        .where(eq(financeConversationMessages.userId, f.userId)),
    ).toHaveLength(0);
    expect(
      await database.db
        .select()
        .from(financeConversations)
        .where(eq(financeConversations.userId, f.userId)),
    ).toHaveLength(0);
    expect(
      await database.db
        .select()
        .from(financeAnswerContinuations)
        .where(eq(financeAnswerContinuations.operationId, f.answer.operationId)),
    ).toHaveLength(0);
    expect((await f.questions.answerWork(f.answer, f.context)).state).toBe("accepted");
  });
  it("captures an empty batch once and leaves a later accepted answer for the next run", async () => {
    const f = await fixture();
    const run = await canonicalRun(f.userId);
    const capture = () =>
      database.db.transaction((tx) =>
        captureFinanceConversationBatch({
          tx,
          store: postgresConversationBatchStore,
          userId: f.userId,
          runId: run.id,
          automationScheduleId: null,
          authorizationConnectionId: null,
          now: new Date(),
        }),
      );
    const first = await capture();
    expect(first.cutoffSequence).toBe("0");
    await f.questions.answerWork(f.answer, f.context);
    expect(await capture()).toEqual(first);
    const members = await database.db
      .select()
      .from(financeConversationBatchMessages)
      .where(eq(financeConversationBatchMessages.runId, run.id));
    expect(members).toHaveLength(0);
    expect(
      await database.db
        .select()
        .from(financeConversationBatches)
        .where(eq(financeConversationBatches.runId, run.id)),
    ).toHaveLength(1);
  });
  it("rejects a foreign owner case link and keeps owner history isolated", async () => {
    const f = await fixture();
    const foreign = await fixture();
    await expect(
      database.db.insert(financeConversationMessages).values({
        userId: f.userId,
        sequence: 1n,
        authorKind: "user",
        text: "foreign",
        caseId: foreign.question.reviewCaseId,
        caseOwnerId: foreign.userId,
        recordRefs: [],
        sourceMessageIds: [],
        idempotencyKey: randomUUID(),
        createdAt: new Date(),
      }),
    ).rejects.toThrow();
    await f.questions.answerWork(f.answer, f.context);
    expect(
      (await createFinanceConversationService({ db: database.db }).history(foreign.userId))
        .messages,
    ).toHaveLength(0);
    expect(
      await database.db
        .select()
        .from(financeConversationMessages)
        .where(
          and(
            eq(financeConversationMessages.userId, foreign.userId),
            eq(financeConversationMessages.caseId, f.question.reviewCaseId),
          ),
        ),
    ).toHaveLength(0);
  });
});
