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
  financeConversationCapabilities,
  financeConversationMessages,
  financeConversationReadCursors,
  financeConversations,
  financeTransactions,
  migrateDatabase,
  oauthClients,
  oauthRefreshTokens,
  users,
  workspaceMaintenanceRuns,
} from "@personal-os/database";
import { automationHostScheduleSchema } from "@personal-os/domain";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { and, eq } from "drizzle-orm";
import type { FinanceMaintenanceService } from "../finance-maintenance-service.js";
import type { FinanceStatusService } from "../finance-status-service.js";
import { createOAuthService } from "../oauth-service.js";
import { hashToken } from "../security.js";
import type { Principal } from "../types.js";
import { createFinanceContextualQuestionService } from "./contextual-question-service.js";
import { createFinanceConversationService } from "./conversation-persistence.js";
import {
  captureFinanceConversationBatch,
  postgresConversationBatchStore,
} from "./conversation-service.js";
import { createFinanceMaintenanceIntentService } from "./maintenance-intent-service.js";

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
  async function hostFixture(verifyImmediately = true) {
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
    const verify = async (principal = agent) => {
      const challenge = await conversation.issueChallenge(f.principal, scheduleId);
      const fetched = await conversation.advanceChallenge(principal, challenge.challengeId, {
        kind: "fetch",
      });
      if (!fetched.nonce) throw new Error("nonce");
      await conversation.advanceChallenge(principal, challenge.challengeId, {
        kind: "acknowledge",
        challengeId: challenge.challengeId,
        nonce: fetched.nonce,
      });
      await conversation.advanceChallenge(principal, challenge.challengeId, {
        kind: "respond",
        challengeId: challenge.challengeId,
        response: "Finance message protocol ready",
      });
    };
    if (verifyImmediately) await verify();
    return { ...f, conversation, agent, scheduleId, connectionId, token, verify };
  }

  async function refreshableHost() {
    const f = await hostFixture();
    const clientId = randomUUID();
    const refreshToken = randomUUID();
    const resource = "https://nohmi.test/mcp";
    await database.db.insert(oauthClients).values({
      id: clientId,
      name: "Conversation host",
      redirectUris: ["https://host.test/callback"],
    });
    await database.db
      .update(accessTokens)
      .set({
        clientId,
        audience: resource,
        expiresAt: new Date(Date.now() - 60_000),
      })
      .where(eq(accessTokens.id, f.token.id));
    const [refresh] = await database.db
      .insert(oauthRefreshTokens)
      .values({
        accessTokenId: f.token.id,
        clientId,
        userId: f.userId,
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + 86_400_000),
      })
      .returning();
    if (!refresh) throw new Error("refresh");
    return { ...f, clientId, refreshToken, resource, refresh };
  }
  it("keeps Chat ready across bearer expiry and real OAuth rotation without accepting the expired bearer", async () => {
    const f = await refreshableHost();
    for (const result of [
      await f.conversation.getReadiness(f.userId),
      await f.conversation.getHostReadiness(f.userId, f.scheduleId),
    ])
      expect(result).toMatchObject({
        canSend: true,
        reason: "ready",
        messageCapability: "verified",
      });
    const [proof] = await database.db
      .select()
      .from(financeConversationCapabilities)
      .where(eq(financeConversationCapabilities.automationScheduleId, f.scheduleId));
    if (!proof) throw new Error("proof");
    await expect(
      f.conversation.advanceChallenge(f.agent, proof.id, { kind: "fetch" }),
    ).rejects.toMatchObject({ code: "forbidden" });
    const oauth = createOAuthService({
      db: database.db,
      now: () => new Date(),
      resource: f.resource,
    });
    const rotated = await oauth.refresh({
      clientId: f.clientId,
      refreshToken: f.refreshToken,
      resource: f.resource,
    });
    expect(await f.conversation.getReadiness(f.userId)).toMatchObject({
      canSend: true,
      reason: "ready",
    });
    const challenge = await f.conversation.issueChallenge(f.principal, f.scheduleId);
    await expect(
      f.conversation.advanceChallenge(f.agent, challenge.challengeId, { kind: "fetch" }),
    ).rejects.toMatchObject({ code: "forbidden" });
    // A new challenge supersedes proof, independently of credential refresh.
    expect(await f.conversation.getReadiness(f.userId)).toMatchObject({
      canSend: false,
      reason: "challenge_required",
    });
    const [renewed] = await database.db
      .select()
      .from(accessTokens)
      .where(
        and(
          eq(accessTokens.authorizationConnectionId, f.connectionId),
          eq(accessTokens.tokenHash, hashToken(rotated.access_token)),
        ),
      );
    if (!renewed) throw new Error("renewed bearer");
    await f.verify({ ...f.agent, actorId: renewed.id });
    expect(await f.conversation.getHostReadiness(f.userId, f.scheduleId)).toMatchObject({
      canSend: true,
      reason: "ready",
    });
    expect(await f.conversation.history(f.userId, "0", 50)).toMatchObject({ messages: [] });
  });
  it("identifies the same eligible host across surfaces without borrowing another host's proof or run", async () => {
    const f = await hostFixture();
    const [original] = await database.db
      .select()
      .from(automationHostSchedules)
      .where(eq(automationHostSchedules.id, f.scheduleId));
    if (!original) throw new Error("original");
    const otherId = randomUUID(),
      otherConnection = randomUUID();
    await database.db.insert(automationHostSchedules).values({
      ...original,
      id: otherId,
      authorizationConnectionId: otherConnection,
      updatedAt: new Date(Date.now() + 1000),
      schedule: automationHostScheduleSchema.parse({
        ...original.schedule,
        id: otherId,
        tenantAuthorizationConnectionId: otherConnection,
        label: "Unavailable host",
        hostAutomationId: "other",
      }),
    });
    const run = await canonicalRun(f.userId);
    await database.db
      .update(workspaceMaintenanceRuns)
      .set({
        automationScheduleId: f.scheduleId,
        authorizationConnectionId: f.connectionId,
        status: "blocked",
        lastSafeError: {
          code: "host_unavailable",
          message: "Review the original host connection before retrying.",
        },
      })
      .where(eq(workspaceMaintenanceRuns.id, run.id));
    const global = await f.conversation.getReadiness(f.userId);
    const exact = await f.conversation.getHostReadiness(f.userId, f.scheduleId);
    expect(global).toEqual(exact);
    expect(global.host).toMatchObject({
      scheduleId: f.scheduleId,
      connectionId: f.connectionId,
      label: "Conversation",
      latestRun: {
        id: run.id,
        status: "blocked",
        failureMessage: "Review the original host connection before retrying.",
      },
    });
    expect(await f.conversation.getHostReadiness(f.userId, otherId)).toMatchObject({
      canSend: false,
      host: { scheduleId: otherId, latestRun: null },
    });
    const foreign = await fixture();
    await expect(
      f.conversation.getHostReadiness(foreign.userId, f.scheduleId),
    ).rejects.toMatchObject({ code: "not_found" });
  });
  it.each([
    "expired_refresh",
    "replaced_refresh",
    "foreign_refresh_user",
    "foreign_refresh_client",
    "missing_audience",
    "revoked",
    "scope",
    "bypass",
  ] as const)("locks sending after %s even with verified messaging and an expired bearer", async (loss) => {
    const f = await refreshableHost();
    if (loss === "expired_refresh" || loss === "replaced_refresh")
      await database.db
        .update(oauthRefreshTokens)
        .set(loss === "expired_refresh" ? { expiresAt: new Date(0) } : { replacedAt: new Date() })
        .where(eq(oauthRefreshTokens.id, f.refresh.id));
    if (loss === "foreign_refresh_user") {
      const other = await fixture();
      await database.db
        .update(oauthRefreshTokens)
        .set({ userId: other.userId })
        .where(eq(oauthRefreshTokens.id, f.refresh.id));
    }
    if (loss === "foreign_refresh_client") {
      const clientId = randomUUID();
      await database.db.insert(oauthClients).values({
        id: clientId,
        name: "Other host",
        redirectUris: ["https://other.test/callback"],
      });
      await database.db
        .update(oauthRefreshTokens)
        .set({ clientId })
        .where(eq(oauthRefreshTokens.id, f.refresh.id));
    }
    if (loss === "missing_audience")
      await database.db
        .update(accessTokens)
        .set({ audience: null })
        .where(eq(accessTokens.id, f.token.id));
    if (loss === "revoked")
      await database.db
        .update(accessTokens)
        .set({ revokedAt: new Date() })
        .where(eq(accessTokens.id, f.token.id));
    if (loss === "scope")
      await database.db
        .update(accessTokens)
        .set({ scopes: ["finances:maintain", "finances:read", "finances:write"] })
        .where(eq(accessTokens.id, f.token.id));
    if (loss === "bypass")
      await database.db
        .update(executionPolicySettings)
        .set({ reviewBypassEnabled: false })
        .where(eq(executionPolicySettings.userId, f.userId));
    const reason =
      loss === "scope" || loss === "bypass"
        ? "execution_not_authorized"
        : "connection_disconnected";
    expect(await f.conversation.getReadiness(f.userId)).toMatchObject({
      canSend: false,
      reason,
      messageCapability: "verified",
    });
    expect(await f.conversation.getHostReadiness(f.userId, f.scheduleId)).toMatchObject({
      canSend: false,
      reason,
    });
    await expect(
      f.conversation.send(f.principal, {
        text: "Do not accept",
        idempotencyKey: randomUUID(),
        caseId: null,
        recordRefs: [],
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });
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
      .update(executionPolicySettings)
      .set({ reviewBypassEnabled: false })
      .where(eq(executionPolicySettings.userId, f.userId));
    expect(await f.conversation.getReadiness(f.userId)).toMatchObject({
      canSend: false,
      reason: "execution_not_authorized",
      recovery: "authorize_execution",
    });
    await database.db
      .update(executionPolicySettings)
      .set({ reviewBypassEnabled: true })
      .where(eq(executionPolicySettings.userId, f.userId));
    await database.db
      .update(accessTokens)
      .set({ scopes: ["finances:maintain"] })
      .where(eq(accessTokens.id, f.token.id));
    expect(await f.conversation.getReadiness(f.userId)).toMatchObject({
      canSend: false,
      reason: "execution_not_authorized",
      recovery: "authorize_execution",
    });
    await database.db
      .update(accessTokens)
      .set({ scopes: ["finances:read", "finances:write", "finances:execute", "finances:maintain"] })
      .where(eq(accessTokens.id, f.token.id));
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
    const savedReplies = () =>
      database.db
        .select()
        .from(financeConversationMessages)
        .where(
          and(
            eq(financeConversationMessages.userId, f.userId),
            eq(financeConversationMessages.authorKind, "agent"),
          ),
        );
    await expect(
      f.conversation.reply(f.agent, {
        runId: run.id,
        idempotencyKey: "before-fetch",
        text: "Unseen answer",
        sourceMessageIds: [first.id],
      }),
    ).rejects.toThrow("fixed");
    expect(await savedReplies()).toHaveLength(0);
    const page = await f.conversation.pageBatch(f.agent, run.id, "0", 1);
    expect(page.messages.map((message) => message.id)).toEqual([first.id]);
    expect(await f.conversation.pageBatch(f.agent, run.id, "0", 1)).toEqual(page);
    await expect(
      f.conversation.reply(f.agent, {
        runId: run.id,
        idempotencyKey: "unseen-page",
        text: "Unseen page answer",
        sourceMessageIds: [second.id],
      }),
    ).rejects.toThrow("fixed");
    await expect(
      f.conversation.reply(f.agent, {
        runId: run.id,
        idempotencyKey: "mixed-page",
        text: "Mixed source answer",
        sourceMessageIds: [first.id, second.id],
      }),
    ).rejects.toThrow("fixed");
    expect(await savedReplies()).toHaveLength(0);
    const deliveredReply = {
      runId: run.id,
      idempotencyKey: "delivered-reply",
      text: "Answer to the delivered source",
      sourceMessageIds: [first.id],
    };
    const acceptedReply = await f.conversation.reply(f.agent, deliveredReply);
    expect(acceptedReply.sourceMessageIds).toEqual([first.id]);
    expect(await f.conversation.reply(f.agent, deliveredReply)).toEqual(acceptedReply);
    expect(await savedReplies()).toHaveLength(1);
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
  function intent() {
    return createFinanceMaintenanceIntentService({
      db: database.db,
      now: () => new Date(),
      maintenance: { dispatchRun: vi.fn(async () => null) } as unknown as FinanceMaintenanceService,
      recoverHandoff: async () => ({ recovered: false }),
      status: {
        getFinanceStatus: async () => ({
          details: { rulebookVersion: "conversation-intent-fixture" },
          state: "maintained",
          freshness: { blockers: [] },
        }),
      } as unknown as FinanceStatusService,
    });
  }
  it("real resolveRun leaves pending messages unconsumed for manual and unverified starts", async () => {
    const manual = await fixture();
    await manual.questions.answerWork(manual.answer, manual.context);
    const manualRun = await intent().maintainFinances(
      { operation: "start", scope: { type: "all_outstanding" } },
      {
        ...manual.principal,
        scopes: new Set(["finances:read", "finances:write", "finances:maintain"]),
      },
    );
    expect(manualRun.data.run).not.toBeNull();
    expect(manualRun.data.conversationBatch).toBeNull();
    expect(
      await database.db
        .select()
        .from(financeConversationBatchMessages)
        .where(eq(financeConversationBatchMessages.userId, manual.userId)),
    ).toHaveLength(0);
    const host = await hostFixture(false);
    await host.questions.answerWork(host.answer, host.context);
    const maintenance = intent();
    const initial = await maintenance.maintainFinances(
      {
        operation: "start",
        automationScheduleId: host.scheduleId,
        scope: { type: "all_outstanding" },
      },
      host.agent,
    );
    expect(initial.data.conversationBatch).toBeNull();
    if (!initial.data.run) throw new Error("run");
    await host.verify();
    const resumed = await maintenance.maintainFinances(
      { operation: "resume", runId: initial.data.run.id },
      host.agent,
    );
    const coalesced = await maintenance.maintainFinances(
      {
        operation: "start",
        automationScheduleId: host.scheduleId,
        scope: { type: "all_outstanding" },
      },
      host.agent,
    );
    expect(resumed.data.conversationBatch).toBeNull();
    expect(coalesced.data.conversationBatch).toBeNull();
    expect(
      await database.db
        .select()
        .from(financeConversationBatchMessages)
        .where(eq(financeConversationBatchMessages.userId, host.userId)),
    ).toHaveLength(0);
  });
  it("real resolveRun verified concurrent starts capture once, and coalesced start/resume retain cutoff after later arrivals", async () => {
    const f = await hostFixture();
    const maintenance = intent();
    const first = await f.conversation.send(f.principal, {
      text: "before start",
      idempotencyKey: "fixed-one",
      caseId: null,
      recordRefs: [],
    });
    const input = {
      operation: "start" as const,
      automationScheduleId: f.scheduleId,
      scope: { type: "all_outstanding" as const },
    };
    const [started, concurrent] = await Promise.all([
      maintenance.maintainFinances(input, f.agent),
      maintenance.maintainFinances(input, f.agent),
    ]);
    expect(started.data.conversationBatch).not.toBeNull();
    expect(concurrent.data.conversationBatch).toEqual(started.data.conversationBatch);
    if (!started.data.run) throw new Error("run");
    const later = await f.conversation.send(f.principal, {
      text: "next run only",
      idempotencyKey: "fixed-later",
      caseId: null,
      recordRefs: [],
    });
    const coalesced = await maintenance.maintainFinances(input, f.agent);
    const resumed = await maintenance.maintainFinances(
      { operation: "resume", runId: started.data.run.id },
      f.agent,
    );
    expect(coalesced.data.conversationBatch).toEqual(started.data.conversationBatch);
    expect(resumed.data.conversationBatch).toEqual(started.data.conversationBatch);
    expect(started.data.conversationBatch?.cutoffSequence).toBe(first.sequence);
    const page = await f.conversation.pageBatch(f.agent, started.data.run.id);
    expect(page.messages.map((message) => message.id)).toEqual([first.id]);
    expect(page.messages.some((message) => message.id === later.id)).toBe(false);
    expect(
      await database.db
        .select()
        .from(financeConversationBatches)
        .where(eq(financeConversationBatches.userId, f.userId)),
    ).toHaveLength(1);
  });
  it("looks up an exact owner source beyond the first page with bounded surrounding context and hides foreign IDs", async () => {
    const f = await fixture();
    const foreign = await fixture();
    const ids = Array.from({ length: 80 }, () => randomUUID());
    await database.db.insert(financeConversationMessages).values(
      ids.map((id, index) => ({
        id,
        userId: f.userId,
        sequence: BigInt(index + 1),
        authorKind: "user" as const,
        text: `Source ${index + 1}`,
        idempotencyKey: `target-${id}`,
        createdAt: new Date("2026-10-18T12:00:00Z"),
        recordRefs: [],
        sourceMessageIds: [],
      })),
    );
    const conversation = createFinanceConversationService({ db: database.db });
    const targetId = ids[64];
    if (!targetId) throw new Error("target");
    const context = await conversation.messageContext(f.userId, targetId);
    expect(context.targetMessageId).toBe(targetId);
    expect(context.messages).toHaveLength(21);
    expect(context.messages[0]?.sequence).toBe("55");
    expect(context.messages.at(-1)?.sequence).toBe("75");
    expect(context.messages[10]?.id).toBe(targetId);
    await expect(conversation.messageContext(foreign.userId, targetId)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(conversation.messageContext(f.userId, randomUUID())).rejects.toMatchObject({
      code: "not_found",
    });
  });
});
