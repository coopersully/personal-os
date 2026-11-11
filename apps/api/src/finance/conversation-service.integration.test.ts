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
  financeConversationTurns,
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
import { createAutomationHostService } from "../automation-host-service.js";
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
import {
  createFinanceHostInstructionService,
  readFinanceHostInstructionSummary,
} from "./host-instructions-service.js";
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
  it("pages latest history backwards losslessly and isolates owners", async () => {
    const f = await fixture();
    const other = await fixture();
    const service = createFinanceConversationService({ db: database.db });
    const start = 9007199254740993n;
    await database.db.insert(financeConversationMessages).values(
      Array.from({ length: 53 }, (_, index) => ({
        userId: f.userId,
        sequence: start + BigInt(index),
        authorKind: "user" as const,
        text: `Message ${index}`,
        idempotencyKey: `history-${index}`,
        createdAt: new Date(),
      })),
    );
    const latest = await service.history(f.userId, "0", 50, {});
    expect(latest.messages).toHaveLength(50);
    expect(latest.messages[0]?.sequence).toBe(String(start + 3n));
    expect(latest.messages.at(-1)?.text).toBe("Message 52");
    const older = await service.history(f.userId, "0", 50, {
      before: latest.nextCursor ?? undefined,
    });
    expect(older.messages.map((m) => m.sequence)).toEqual(
      [start, start + 1n, start + 2n].map(String),
    );
    expect(older.nextCursor).toBeNull();
    expect((await service.history(other.userId, "0", 50, {})).messages).toEqual([]);
    expect((await service.history(f.userId, String(start), 1)).messages[0]?.sequence).toBe(
      String(start + 1n),
    );
  });

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

  it("host status uses canonical readiness and loses readiness on replacement proof", async () => {
    const f = await hostFixture();
    const hosts = createAutomationHostService({
      db: database.db,
      now: () => new Date(),
      encryptionKey: Buffer.alloc(32, 7).toString("base64"),
    });
    const status = (await hosts.list(f.principal)).find(
      (item) => item.schedule.id === f.scheduleId,
    );
    expect(status?.chatCapability).toEqual({ state: "verified", reason: "ready", canSend: true });
    await f.conversation.issueChallenge(f.principal, f.scheduleId);
    const replaced = (await hosts.list(f.principal)).find(
      (item) => item.schedule.id === f.scheduleId,
    );
    expect(replaced?.chatCapability).toEqual({
      state: "unverified",
      reason: "challenge_required",
      canSend: false,
    });
  });

  it("processes fresh chat beside an old blocked unbound run and recovers partial replies without changing financial evidence", async () => {
    const f = await hostFixture();
    const old = await canonicalRun(f.userId);
    await database.db
      .update(workspaceMaintenanceRuns)
      .set({ status: "blocked" })
      .where(eq(workspaceMaintenanceRuns.id, old.id));
    expect(await f.conversation.beginTurn(f.agent, f.scheduleId)).toEqual({
      turn: null,
      messages: [],
    });
    const first = await f.conversation.send(f.principal, {
      text: "Hello",
      idempotencyKey: randomUUID(),
      caseId: null,
      recordRefs: [],
    });
    const second = await f.conversation.send(f.principal, {
      text: "Any update?",
      idempotencyKey: randomUUID(),
      caseId: null,
      recordRefs: [],
    });
    const [a, b] = await Promise.all([
      f.conversation.beginTurn(f.agent, f.scheduleId),
      f.conversation.beginTurn(f.agent, f.scheduleId),
    ]);
    expect(a).toEqual(b);
    if (!a.turn) throw new Error("turn");
    expect(a.messages.map((m) => m.id)).toEqual([first.id, second.id]);
    await f.conversation.acknowledgeTurn(f.agent, a.turn.id, [first.id, second.id]);
    expect((await f.conversation.beginTurn(f.agent, f.scheduleId)).messages).toHaveLength(2);
    const reply = {
      text: "Hello! Bookkeeping is still blocked.",
      idempotencyKey: randomUUID(),
      sourceMessageIds: [first.id],
    };
    const committed = await f.conversation.replyToTurn(f.agent, a.turn.id, reply);
    expect(await f.conversation.replyToTurn(f.agent, a.turn.id, reply)).toEqual(committed);
    await expect(
      f.conversation.replyToTurn(f.agent, a.turn.id, { ...reply, text: "Changed" }),
    ).rejects.toMatchObject({ code: "conflict" });
    const later = await f.conversation.send(f.principal, {
      text: "New question",
      idempotencyKey: randomUUID(),
      caseId: null,
      recordRefs: [],
    });
    const resumed = await f.conversation.beginTurn(f.agent, f.scheduleId);
    expect(resumed.turn).toEqual(a.turn);
    expect(resumed.messages.map((m) => m.id)).toEqual([second.id]);
    await expect(
      f.conversation.replyToTurn(f.agent, a.turn.id, {
        ...reply,
        idempotencyKey: randomUUID(),
        sourceMessageIds: [later.id],
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    await f.conversation.replyToTurn(f.agent, a.turn.id, {
      ...reply,
      idempotencyKey: randomUUID(),
      sourceMessageIds: [second.id],
    });
    const next = await f.conversation.beginTurn(f.agent, f.scheduleId);
    expect(next.turn?.id).not.toBe(a.turn.id);
    expect(next.messages.map((m) => m.id)).toEqual([later.id]);
    const [saved] = await database.db
      .select()
      .from(workspaceMaintenanceRuns)
      .where(eq(workspaceMaintenanceRuns.id, old.id));
    expect(saved).toMatchObject({
      status: "blocked",
      automationScheduleId: null,
      authorizationConnectionId: null,
    });
    expect(
      await database.db
        .select()
        .from(financeConversationBatches)
        .where(eq(financeConversationBatches.userId, f.userId)),
    ).toEqual([]);
  });
  it("fences turns by owner, original live connection and replacement proof", async () => {
    const f = await hostFixture(),
      other = await hostFixture();
    const message = await f.conversation.send(f.principal, {
      text: "Hello",
      idempotencyKey: randomUUID(),
      caseId: null,
      recordRefs: [],
    });
    const opened = await f.conversation.beginTurn(f.agent, f.scheduleId);
    if (!opened.turn) throw new Error("turn");
    await expect(other.conversation.beginTurn(other.agent, f.scheduleId)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(
      other.conversation.replyToTurn(other.agent, opened.turn.id, {
        text: "No",
        idempotencyKey: randomUUID(),
        sourceMessageIds: [message.id],
      }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      f.conversation.beginTurn(
        { ...f.agent, authorizationConnectionId: randomUUID() },
        f.scheduleId,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    await f.conversation.issueChallenge(f.principal, f.scheduleId);
    await expect(f.conversation.beginTurn(f.agent, f.scheduleId)).rejects.toMatchObject({
      code: "forbidden",
    });
    await f.verify();
    await database.db
      .update(accessTokens)
      .set({ revokedAt: new Date() })
      .where(eq(accessTokens.id, f.token.id));
    await expect(
      f.conversation.replyToTurn(f.agent, opened.turn.id, {
        text: "No",
        idempotencyKey: randomUUID(),
        sourceMessageIds: [message.id],
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(
      await database.db
        .select()
        .from(financeConversationTurns)
        .where(eq(financeConversationTurns.userId, f.userId)),
    ).toHaveLength(1);
  });

  it("bounds turns at 100 and preserves decimal sequences above the JavaScript integer limit", async () => {
    const f = await hostFixture();
    const base = 9007199254740993n;
    await database.db
      .insert(financeConversations)
      .values({ userId: f.userId, nextSequence: base + 101n });
    await database.db.insert(financeConversationMessages).values(
      Array.from({ length: 101 }, (_, index) => ({
        userId: f.userId,
        authorKind: "user" as const,
        text: `Question ${index}`,
        sequence: base + BigInt(index + 1),
        idempotencyKey: randomUUID(),
        createdAt: new Date(),
      })),
    );
    const first = await f.conversation.beginTurn(f.agent, f.scheduleId);
    if (!first.turn) throw new Error("turn");
    expect(first.messages).toHaveLength(100);
    expect(first.turn.cutoffSequence).toBe((base + 100n).toString());
    await f.conversation.replyToTurn(f.agent, first.turn.id, {
      text: "Received all questions",
      idempotencyKey: randomUUID(),
      sourceMessageIds: first.messages.map((message) => message.id),
    });
    const next = await f.conversation.beginTurn(f.agent, f.scheduleId);
    expect(next.messages).toHaveLength(1);
    expect(next.turn?.cutoffSequence).toBe((base + 101n).toString());
  });

  it("serves current instructions without Chat proof, deduplicates delivery and records separate explicit adoption", async () => {
    const f = await hostFixture(false);
    const instructions = createFinanceHostInstructionService({
      db: database.db,
      now: () => new Date(),
    });
    const operationId = randomUUID();
    const [a, b] = await Promise.all([
      instructions.loadInstructions(f.agent, f.scheduleId, { operationId }),
      instructions.loadInstructions(f.agent, f.scheduleId, { operationId }),
    ]);
    expect(a).toEqual(b);
    expect(a).toMatchObject({
      actorId: f.agent.actorId,
      authorizationConnectionId: f.connectionId,
      instructionVersion: 1,
      scheduleVersion: 1,
      acknowledgedAt: null,
    });
    expect(a.text).toContain("begin_finance_conversation_turn");
    expect(
      await readFinanceHostInstructionSummary(database.db, f.userId, f.scheduleId),
    ).toMatchObject({ latestServed: { receiptId: a.receiptId }, latestAcknowledged: null });
    await expect(
      instructions.acknowledgeInstructions(f.agent, f.scheduleId, {
        receiptId: a.receiptId,
        instructionVersion: 2,
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    const acknowledged = await instructions.acknowledgeInstructions(f.agent, f.scheduleId, {
      receiptId: a.receiptId,
      instructionVersion: 1,
    });
    expect(acknowledged.acknowledgedAt).toBeTruthy();
    expect(
      await instructions.acknowledgeInstructions(f.agent, f.scheduleId, {
        receiptId: a.receiptId,
        instructionVersion: 1,
      }),
    ).toEqual(acknowledged);
    const next = await instructions.loadInstructions(f.agent, f.scheduleId, {
      operationId: randomUUID(),
    });
    const history = await instructions.instructionHistory(f.agent, f.scheduleId, { limit: 1 });
    expect(history.receipts.map((r) => r.receiptId)).toEqual([next.receiptId]);
    expect(
      (
        await instructions.instructionHistory(f.agent, f.scheduleId, {
          limit: 1,
          before: history.nextCursor,
        })
      ).receipts.map((r) => r.receiptId),
    ).toEqual([a.receiptId]);
    const summary = await readFinanceHostInstructionSummary(database.db, f.userId, f.scheduleId);
    expect(summary).toMatchObject({
      latestServed: { receiptId: next.receiptId, acknowledgedAt: null },
      latestAcknowledged: { receiptId: a.receiptId },
      acknowledgementMeaning: "host_reported_adoption_not_proof_of_obedience",
    });
    const [host] = await database.db
      .select()
      .from(automationHostSchedules)
      .where(eq(automationHostSchedules.id, f.scheduleId));
    if (!host) throw new Error("host");
    await database.db
      .update(automationHostSchedules)
      .set({ schedule: { ...host.schedule, version: 2 } })
      .where(eq(automationHostSchedules.id, f.scheduleId));
    await expect(
      instructions.acknowledgeInstructions(f.agent, f.scheduleId, {
        receiptId: next.receiptId,
        instructionVersion: 1,
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    await database.db
      .update(accessTokens)
      .set({ revokedAt: new Date() })
      .where(eq(accessTokens.id, f.token.id));
    await expect(
      instructions.loadInstructions(f.agent, f.scheduleId, { operationId: randomUUID() }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      instructions.acknowledgeInstructions(f.agent, f.scheduleId, {
        receiptId: a.receiptId,
        instructionVersion: 1,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("observes a revocation committed while a turn is waiting for its original credential", async () => {
    const f = await hostFixture();
    await f.conversation.send(f.principal, {
      text: "Please reply",
      idempotencyKey: randomUUID(),
      caseId: null,
      recordRefs: [],
    });
    let release: () => void = () => {};
    let changed: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      changed = resolve;
    });
    const revoke = database.db.transaction(async (tx) => {
      await tx
        .update(accessTokens)
        .set({ revokedAt: new Date() })
        .where(eq(accessTokens.id, f.token.id));
      changed();
      await held;
    });
    await ready;
    const pending = f.conversation.beginTurn(f.agent, f.scheduleId);
    const denied = expect(pending).rejects.toMatchObject({ code: "forbidden" });
    release();
    await revoke;
    await denied;
    expect(
      await database.db
        .select()
        .from(financeConversationTurns)
        .where(eq(financeConversationTurns.userId, f.userId)),
    ).toEqual([]);
  });

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
