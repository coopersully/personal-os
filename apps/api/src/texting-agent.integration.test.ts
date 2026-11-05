import { resolve } from "node:path";
import type { TwilioConnector } from "@personal-os/connectors";
import {
  accessTokens,
  automationHostSchedules,
  createDatabaseClient,
  type DatabaseClient,
  executionPolicySettings,
  migrateDatabase,
  textInboundClaims,
  textingAgentQueue,
  textingAgentRuns,
  textingConnections,
  textMessages,
  textReplyBindings,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq, isNull } from "drizzle-orm";
import { encryptJson } from "./security.js";
import { createTextingAgentDispatcher } from "./texting-agent-dispatcher.js";
import { createTextingAgentService } from "./texting-agent-service.js";
import { bindInboundReply } from "./texting-reply-binding.js";
import { createTextingService } from "./texting-service.js";
import type { Principal } from "./types.js";

describe.sequential("Texting agent lifecycle", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  const encryptionKey = Buffer.alloc(32, 7).toString("base64");
  let current = new Date("2026-11-05T16:00:00Z");
  const now = () => current;
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
  }, 120_000);
  afterAll(async () => {
    await database?.close();
    await container?.stop();
  });
  let phoneSequence = 123;
  async function fixture() {
    const phone = `+12125550${phoneSequence++}`;
    const userId = crypto.randomUUID(),
      tokenId = crypto.randomUUID(),
      connectionId = crypto.randomUUID(),
      scheduleId = crypto.randomUUID();
    await database.db.insert(users).values({
      id: userId,
      email: `${userId}@example.com`,
      displayName: "SMS fixture",
      passwordHash: "unused",
    });
    await database.db.insert(accessTokens).values({
      id: tokenId,
      userId,
      authorizationConnectionId: connectionId,
      name: "Claude",
      tokenHash: tokenId,
      scopes: ["texting:read", "texting:write", "texting:execute"],
    });
    await database.db.insert(executionPolicySettings).values({ userId, reviewBypassEnabled: true });
    await database.db.insert(automationHostSchedules).values({
      id: scheduleId,
      userId,
      authorizationConnectionId: connectionId,
      encryptedFireCredentials: encryptJson({ token: "fixture-routine-token" }, encryptionKey),
      schedule: {
        id: scheduleId,
        version: 1,
        tenantAuthorizationConnectionId: connectionId,
        label: "Personal Claude",
        effectiveScopes: ["finances:maintain"],
        hostSurface: "claude_code_routine",
        hostAutomationId: "trig_12345678901",
        trigger: { type: "event", expectedMaximumLatencyMinutes: 5 },
        state: "active",
        nextExpectedAt: null,
        lastObservedAt: null,
        createdAt: now().toISOString(),
        updatedAt: now().toISOString(),
      },
    });
    const agent: Principal = {
      userId,
      actorId: tokenId,
      actorType: "agent",
      authorizationConnectionId: connectionId,
      scopes: new Set(["texting:read", "texting:write", "texting:execute"]),
    };
    const human: Principal = { ...agent, actorId: userId, actorType: "user" };
    const twilio: TwilioConnector = {
      startVerification: vi.fn(async () => ({
        sid: `VE${crypto.randomUUID()}`,
        status: "pending",
      })),
      checkVerification: vi.fn(async () => "approved" as const),
      getMessageOccurredAt: vi.fn(async () => now()),
      sendMessage: vi.fn(async () => ({
        sid: `SM${crypto.randomUUID()}`,
        status: "queued",
        dateCreated: now(),
      })),
      validateWebhook: () => true,
    };
    const texting = createTextingService({
      db: database.db,
      now,
      enabled: true,
      encryptionKey,
      apiBaseUrl: "https://api.example.com",
      senderPhoneNumber: "+18885550100",
      twilio,
    });
    // Unique numbers are not needed: this fixture disconnects the prior connection.
    await database.db.update(textingConnections).set({ state: "disconnected" });
    const challenge = await texting.startVerification(userId, {
      country: "US",
      phoneNumber: phone,
      consentAccepted: true,
      consentVersion: "2026-10-07-v2",
    });
    await texting.checkVerification(userId, challenge.id, "123456");
    const service = createTextingAgentService({
      db: database.db,
      enabled: () => true,
      now,
      texting,
    });
    await service.configure(human, { scheduleId, subscriptionOnlyConfirmed: true });
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ type: "routine_fire", claude_code_session_id: "session_12345678901" }),
    );
    const dispatch = createTextingAgentDispatcher({
      db: database.db,
      enabled: () => true,
      now,
      encryptionKey,
      fetch,
    });
    const inbound = (body = "Check my calendar and tasks", sid = `SM${crypto.randomUUID()}`) =>
      texting.inbound({ From: phone, To: "+18885550100", MessageSid: sid, Body: body });
    return {
      userId,
      tokenId,
      scheduleId,
      service,
      agent,
      human,
      texting,
      twilio,
      inbound,
      dispatch,
      fetch,
    };
  }
  it("waits for the latest message in a staggered five-second burst", async () => {
    const f = await fixture();
    await f.inbound("Check my calendar");
    current = new Date(current.getTime() + 4000);
    await f.inbound("And my tasks");
    current = new Date(current.getTime() + 1000);
    await f.dispatch();
    expect(f.fetch).not.toHaveBeenCalled();
    current = new Date(current.getTime() + 4000);
    await f.dispatch();
    expect(f.fetch).toHaveBeenCalledTimes(1);
    const run = (await f.service.status(f.human)).runs[0];
    if (!run) throw new Error("Missing run");
    const batch = await f.service.claim(f.agent, run.id, { invocationId: crypto.randomUUID() });
    expect(batch.messages.map((message) => message.text)).toEqual([
      "Check my calendar",
      "And my tasks",
    ]);
  });
  it("deduplicates webhooks, freezes a batch and fences competing sessions", async () => {
    const f = await fixture();
    const sid = `SM${crypto.randomUUID()}`;
    await f.inbound("Check my calendar and tasks", sid);
    await f.inbound("Check my calendar and tasks", sid);
    await f.inbound("And tell me about my spending");
    await f.dispatch();
    expect(f.fetch).not.toHaveBeenCalled();
    current = new Date(current.getTime() + 6000);
    await Promise.all([f.dispatch(), f.dispatch()]);
    expect(f.fetch).toHaveBeenCalledTimes(1);
    const run = (await f.service.status(f.human)).runs[0];
    if (!run) throw new Error("Missing run");
    const invocationId = crypto.randomUUID();
    const batch = await f.service.claim(f.agent, run.id, { invocationId });
    expect(batch.messages).toHaveLength(2);
    await f.inbound("A later message");
    expect((await f.service.claim(f.agent, run.id, { invocationId })).messages).toHaveLength(2);
    await expect(
      f.service.claim(f.agent, run.id, { invocationId: crypto.randomUUID() }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      f.service.claim({ ...f.agent, authorizationConnectionId: crypto.randomUUID() }, run.id, {
        invocationId,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await f.service.checkpoint(f.agent, run.id, {
      invocationId,
      work: [
        {
          domain: "tasks",
          key: "task-check",
          state: "completed",
          note: "Read task list",
          references: [],
        },
        {
          domain: "calendar",
          key: "calendar-check",
          state: "blocked",
          note: "Permission needed",
          references: [],
        },
      ],
    });
    await f.service.reply(f.agent, run.id, {
      invocationId,
      body: "Your task list is up to date. Calendar access is needed.",
    });
    await f.service.reply(f.agent, run.id, {
      invocationId,
      body: "Your task list is up to date. Calendar access is needed.",
    });
    expect(f.twilio.sendMessage).toHaveBeenCalledTimes(1);
    const completed = (await f.service.status(f.human)).runs[0];
    if (!completed) throw new Error("Missing run");
    expect(completed.state).toBe("completed");
    expect(completed.work[1]?.state).toBe("blocked");
  });
  it("retains uncertain handoff without firing again and rejects revoked consent", async () => {
    const f = await fixture();
    await f.inbound();
    current = new Date(current.getTime() + 6000);
    f.fetch.mockRejectedValue(new Error("lost response"));
    await f.dispatch();
    await f.dispatch();
    expect(f.fetch).toHaveBeenCalledTimes(1);
    const run = (await f.service.status(f.human)).runs[0];
    if (!run) throw new Error("Missing run");
    expect(run.state).toBe("uncertain");
    await f.inbound("STOP");
    await expect(
      f.service.claim(f.agent, run.id, { invocationId: crypto.randomUUID() }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect((await f.texting.conversation(f.human, "UTC", { limit: 100 })).messages).toHaveLength(2);
  });
  it("keeps a reply recorded when SMS submission is uncertain without resending", async () => {
    const f = await fixture();
    await f.inbound();
    current = new Date(current.getTime() + 6000);
    await f.dispatch();
    const run = (await f.service.status(f.human)).runs[0];
    if (!run) throw new Error("Missing run");
    const invocationId = crypto.randomUUID();
    await f.service.claim(f.agent, run.id, { invocationId });
    vi.mocked(f.twilio.sendMessage).mockRejectedValue(new Error("timeout"));
    await expect(
      f.service.reply(f.agent, run.id, { invocationId, body: "Here is your update." }),
    ).rejects.toThrow();
    await f.service.reply(f.agent, run.id, { invocationId, body: "Here is your update." });
    expect(f.twilio.sendMessage).toHaveBeenCalledTimes(1);
    const [stored] = await database.db
      .select()
      .from(textMessages)
      .where(eq(textMessages.userId, f.userId));
    expect(stored).toBeDefined();
  });
  it("persists blocked work into a later session and allows identical completed checkpoints", async () => {
    const f = await fixture();
    await f.inbound();
    current = new Date(current.getTime() + 6000);
    await f.dispatch();
    const run = (await f.service.status(f.human)).runs[0];
    if (!run) throw new Error("Missing run");
    const invocationId = crypto.randomUUID();
    await f.service.claim(f.agent, run.id, { invocationId });
    const work = [
      {
        domain: "tasks",
        key: "stable-task",
        state: "completed",
        note: "Task created",
        references: ["task:fixture"],
      },
      {
        domain: "calendar",
        key: "stable-event",
        state: "uncertain",
        note: "Read back event before retrying",
        references: ["event:fixture"],
      },
    ];
    await f.service.checkpoint(f.agent, run.id, { invocationId, work });
    await f.service.checkpoint(f.agent, run.id, { invocationId, work });
    await f.service.reply(f.agent, run.id, {
      invocationId,
      body: "Task created. Calendar needs verification.",
    });
    await f.inbound("What is still pending?");
    current = new Date(current.getTime() + 6000);
    await f.dispatch();
    const next = (await f.service.status(f.human)).runs[0];
    if (!next) throw new Error("Missing run");
    const batch = await f.service.claim(f.agent, next.id, { invocationId: crypto.randomUUID() });
    expect(batch.pendingWork.map((p) => p.item.key)).toEqual(["stable-event"]);
    expect(batch.pendingWork[0]?.item.state).toBe("uncertain");
  });
  it("does not fire after grant revocation or route cancelled general messages to Finance", async () => {
    const f = await fixture();
    await f.inbound("Finance: Save this note");
    const [claim] = await database.db
      .select()
      .from(textInboundClaims)
      .where(eq(textInboundClaims.userId, f.userId));
    if (!claim) throw new Error("Missing claim");
    await f.service.configure(f.human, { scheduleId: null });
    expect(
      await bindInboundReply(database.db, f.userId, claim.messageId, () => true, now()),
    ).toMatchObject({ state: "unavailable" });
    expect(
      (
        await database.db
          .select()
          .from(textingAgentQueue)
          .where(eq(textingAgentQueue.userId, f.userId))
      )[0]?.cancelledAt,
    ).not.toBeNull();
    await f.service.configure(f.human, {
      scheduleId: f.scheduleId,
      subscriptionOnlyConfirmed: true,
    });
    await f.inbound("Another request");
    current = new Date(current.getTime() + 6000);
    await database.db
      .update(accessTokens)
      .set({ revokedAt: now() })
      .where(eq(accessTokens.id, f.tokenId));
    await f.dispatch();
    expect(f.fetch).not.toHaveBeenCalled();
    expect((await f.service.status(f.human)).readiness).toBe("permission_required");
  });
  it("preserves the exact Finance question route instead of adding a general queue entry", async () => {
    const f = await fixture();
    const [connection] = await database.db
      .select()
      .from(textingConnections)
      .where(eq(textingConnections.userId, f.userId));
    if (!connection) throw new Error("Missing connection");
    const [outbound] = await database.db
      .insert(textMessages)
      .values({
        userId: f.userId,
        connectionId: connection.id,
        direction: "outbound",
        status: "sent",
        body: "Was this a shared expense?",
        providerMessageSid: `SM${crypto.randomUUID()}`,
        providerSubmittedAt: new Date(current.getTime() - 1000),
        occurredAt: now(),
        occurredAtSource: "nohmi",
      })
      .returning();
    if (!outbound) throw new Error("Missing outbound");
    await database.db.insert(textReplyBindings).values({
      userId: f.userId,
      connectionId: connection.id,
      outboundMessageId: outbound.id,
      consentEpoch: connection.consentEpoch,
      itemNumber: 1,
      workKind: "question",
      workId: crypto.randomUUID(),
      workRevision: "1",
      actionRevision: "1",
      answerMode: "free_text",
      answerVocabulary: null,
      expiresAt: new Date(current.getTime() + 60000),
      operationId: crypto.randomUUID(),
    });
    await f.inbound("1: Yes, with Sam");
    expect(
      await database.db
        .select()
        .from(textingAgentQueue)
        .where(eq(textingAgentQueue.userId, f.userId)),
    ).toHaveLength(0);
  });
  it("backs off after a definite usage rejection and never treats it as a reply", async () => {
    const f = await fixture();
    await f.inbound();
    current = new Date(current.getTime() + 6000);
    f.fetch.mockResolvedValueOnce(new Response("", { status: 429 }));
    await f.dispatch();
    await f.dispatch();
    expect(f.fetch).toHaveBeenCalledTimes(1);
    expect((await f.service.status(f.human)).runs[0]).toMatchObject({
      state: "blocked",
      reason: "rate_limited",
      replyMessageId: null,
    });
    current = new Date(current.getTime() + 3_600_001);
    await f.dispatch();
    expect(f.fetch).toHaveBeenCalledTimes(2);
  });
  it("requires an explicit owner confirmation to release an uncertain run without replay", async () => {
    const f = await fixture();
    await f.inbound();
    current = new Date(current.getTime() + 6000);
    f.fetch.mockRejectedValueOnce(new Error("lost"));
    await f.dispatch();
    const run = (await f.service.status(f.human)).runs[0];
    if (!run) throw new Error("Missing run");
    await expect(
      f.service.recover(f.agent, run.id, { action: "close", hostStopped: true }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(f.service.recover(f.human, run.id, { action: "close" })).rejects.toThrow();
    await expect(f.service.recover(f.human, run.id, { action: "retry" })).rejects.toMatchObject({
      code: "conflict",
    });
    await f.service.recover(f.human, run.id, { action: "close", hostStopped: true });
    await expect(
      f.service.claim(f.agent, run.id, { invocationId: crypto.randomUUID() }),
    ).rejects.toMatchObject({ code: "conflict" });
    await f.dispatch();
    expect(f.fetch).toHaveBeenCalledTimes(1);
  });
  it("rejects foreign owner reads and mismatched provider destinations", async () => {
    const f = await fixture();
    await f.texting.inbound({
      From: "+12125550123",
      To: "+18885550199",
      MessageSid: "SMwrong",
      Body: "Wrong destination",
    });
    await f.inbound();
    current = new Date(current.getTime() + 6000);
    await f.dispatch();
    const run = (await f.service.status(f.human)).runs[0];
    if (!run) throw new Error("Missing run");
    const other = await fixture();
    await expect(
      other.service.claim(other.agent, run.id, { invocationId: crypto.randomUUID() }),
    ).rejects.toMatchObject({ code: "not_found" });
    expect((await other.service.status(other.human)).runs).toEqual([]);
  });

  it("releases a definitely unsubmitted batch during graceful shutdown", async () => {
    await database.db
      .update(textingAgentQueue)
      .set({ cancelledAt: now() })
      .where(isNull(textingAgentQueue.runId));
    const f = await fixture();
    await f.inbound();
    current = new Date(current.getTime() + 6000);
    let observations = 0;
    await f.dispatch(() => ++observations < 3);
    expect(f.fetch).not.toHaveBeenCalled();
    expect((await f.service.status(f.human)).runs[0]).toMatchObject({
      state: "blocked",
      reason: "shutdown_deferred",
    });
    current = new Date(current.getTime() + 6000);
    await f.dispatch();
    expect(f.fetch).toHaveBeenCalledTimes(1);
  });
  it("checkpoints one independent work item for every input in a full batch", async () => {
    const f = await fixture();
    for (let i = 0; i < 25; i++) await f.inbound(`Task request ${i}`);
    current = new Date(current.getTime() + 6000);
    await f.dispatch();
    const run = (await f.service.status(f.human)).runs[0];
    if (!run) throw new Error("Missing run");
    const invocationId = crypto.randomUUID();
    expect((await f.service.claim(f.agent, run.id, { invocationId })).messages).toHaveLength(25);
    const items = Array.from({ length: 25 }, (_, i) => ({
      domain: "tasks",
      key: `task-${i}`,
      state: "pending",
      note: `Saved request ${i}`,
      references: [],
    }));
    await f.service.checkpoint(f.agent, run.id, { invocationId, work: items.slice(0, 20) });
    expect(
      (await f.service.checkpoint(f.agent, run.id, { invocationId, work: items.slice(20) })).work,
    ).toHaveLength(25);
  });
  it("pages older rejected runs without exposing another owner cursor", async () => {
    const f = await fixture();
    const [connection] = await database.db
      .select()
      .from(textingConnections)
      .where(eq(textingConnections.userId, f.userId));
    if (!connection) throw new Error("Missing connection");
    await database.db.insert(textingAgentRuns).values(
      Array.from({ length: 22 }, (_, i) => ({
        userId: f.userId,
        connectionId: connection.id,
        consentEpoch: connection.consentEpoch,
        scheduleId: f.scheduleId,
        authorizationConnectionId: f.agent.authorizationConnectionId ?? "",
        state: "blocked" as const,
        reason: "host_rejected",
        createdAt: new Date(current.getTime() - i * 1000),
      })),
    );
    const first = await f.service.status(f.human);
    expect(first.runs).toHaveLength(20);
    expect(first.nextRunCursor).not.toBeNull();
    const second = await f.service.status(f.human, first.nextRunCursor ?? undefined);
    expect(second.runs).toHaveLength(2);
    expect(second.nextRunCursor).toBeNull();
    const other = await fixture();
    await expect(
      other.service.status(other.human, first.nextRunCursor ?? undefined),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });
  it("makes a rejected-run retry idempotent and rejects closing its stale recovery control", async () => {
    const f = await fixture();
    await f.inbound();
    current = new Date(current.getTime() + 6000);
    f.fetch.mockResolvedValueOnce(new Response("", { status: 401 }));
    await f.dispatch();
    const run = (await f.service.status(f.human)).runs[0];
    if (!run) throw new Error("Missing run");
    await f.service.recover(f.human, run.id, { action: "retry" });
    await f.service.recover(f.human, run.id, { action: "retry" });
    expect((await f.service.status(f.human)).runs[0]?.reason).toBe("retry_requested");
    await expect(
      f.service.recover(f.human, run.id, { action: "close", hostStopped: true }),
    ).rejects.toMatchObject({ code: "conflict" });
    current = new Date(current.getTime() + 6000);
    await f.dispatch();
    expect(f.fetch).toHaveBeenCalledTimes(2);
  });
});
