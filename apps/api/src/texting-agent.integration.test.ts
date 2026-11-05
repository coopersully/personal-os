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
import { automationHostScheduleSchema } from "@personal-os/domain";
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
  async function runningFixture() {
    const f = await fixture();
    await f.inbound();
    current = new Date(current.getTime() + 6000);
    await f.dispatch();
    const run = (await f.service.status(f.human)).runs[0];
    if (!run) throw new Error("Missing run");
    const invocationId = crypto.randomUUID();
    const batch = await f.service.claim(f.agent, run.id, { invocationId });
    const message = batch.messages[0];
    if (!message) throw new Error("Missing input");
    return { ...f, run, invocationId, message };
  }

  it("rejects unqualified setup without replacing the owner's existing binding", async () => {
    const f = await fixture();
    await expect(f.service.configure(f.agent, { scheduleId: null })).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(
      f.service.configure(f.human, {
        scheduleId: crypto.randomUUID(),
        subscriptionOnlyConfirmed: true,
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await database.db
      .update(executionPolicySettings)
      .set({ reviewBypassEnabled: false })
      .where(eq(executionPolicySettings.userId, f.userId));
    await expect(
      f.service.configure(f.human, { scheduleId: f.scheduleId, subscriptionOnlyConfirmed: true }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect((await f.service.status(f.human)).scheduleId).toBe(f.scheduleId);
    await database.db
      .update(executionPolicySettings)
      .set({ reviewBypassEnabled: true })
      .where(eq(executionPolicySettings.userId, f.userId));
    await database.db
      .update(automationHostSchedules)
      .set({ encryptedFireCredentials: null })
      .where(eq(automationHostSchedules.id, f.scheduleId));
    await expect(
      f.service.configure(f.human, { scheduleId: f.scheduleId, subscriptionOnlyConfirmed: true }),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("requires the exact agent invocation for writes and owner identity for recovery", async () => {
    const f = await runningFixture();
    const principals: Principal[] = [f.human, { ...f.agent, scopes: new Set(["texting:read"]) }];
    for (const principal of principals) {
      await expect(
        f.service.claim(principal, f.run.id, { invocationId: f.invocationId }),
      ).rejects.toMatchObject({ code: "forbidden" });
    }
    await expect(
      f.service.checkpoint(f.agent, f.run.id, { invocationId: crypto.randomUUID(), work: [] }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      f.service.recover(f.agent, f.run.id, { action: "close", hostStopped: true }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      f.service.recover(f.human, crypto.randomUUID(), { action: "retry" }),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(f.twilio.sendMessage).not.toHaveBeenCalled();
    expect((await f.service.status(f.human)).runs[0]?.state).toBe("running");
  });

  it("rejects duplicate classifications and self references atomically", async () => {
    const f = await runningFixture();
    const annotation = { messageId: f.message.id, workspaces: ["tasks"] };
    await expect(
      f.service.checkpoint(f.agent, f.run.id, {
        invocationId: f.invocationId,
        work: [],
        annotations: [annotation, annotation],
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      f.service.checkpoint(f.agent, f.run.id, {
        invocationId: f.invocationId,
        work: [],
        annotations: [{ ...annotation, replyToMessageIds: [f.message.id] }],
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    const [stored] = await database.db
      .select()
      .from(textMessages)
      .where(eq(textMessages.id, f.message.id));
    expect(stored?.classifiedAt).toBeNull();
    expect(stored?.workspaces).toEqual([]);
  });

  it("requires complete input classification and valid topic references before sending", async () => {
    const f = await runningFixture();
    const reply = {
      invocationId: f.invocationId,
      body: "Task result",
      workspaces: ["tasks"],
      replyToMessageIds: [f.message.id],
    };
    await expect(
      f.service.reply(f.agent, f.run.id, {
        ...reply,
        replyToMessageIds: [f.message.id, f.message.id],
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      f.service.reply(f.agent, f.run.id, { ...reply, replyToMessageIds: [crypto.randomUUID()] }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(f.service.reply(f.agent, f.run.id, reply)).rejects.toMatchObject({
      code: "conflict",
    });
    await f.service.checkpoint(f.agent, f.run.id, {
      invocationId: f.invocationId,
      work: [],
      annotations: [{ messageId: f.message.id, workspaces: [] }],
    });
    await expect(f.service.reply(f.agent, f.run.id, reply)).rejects.toMatchObject({
      code: "invalid_request",
    });
    expect(f.twilio.sendMessage).not.toHaveBeenCalled();
  });

  it("bounds topic replies and rejects changed retries without duplicating delivery", async () => {
    const f = await runningFixture();
    await f.service.checkpoint(f.agent, f.run.id, {
      invocationId: f.invocationId,
      work: [],
      annotations: [{ messageId: f.message.id, workspaces: ["tasks"] }],
    });
    const reply = {
      invocationId: f.invocationId,
      body: "Task result",
      workspaces: ["tasks"],
      replyToMessageIds: [f.message.id],
      final: false,
    };
    for (let i = 0; i < 3; i++)
      await f.service.reply(f.agent, f.run.id, { ...reply, replyKey: `topic-${i}` });
    await expect(
      f.service.reply(f.agent, f.run.id, { ...reply, replyKey: "topic-0", body: "Changed result" }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      f.service.reply(f.agent, f.run.id, { ...reply, replyKey: "topic-3" }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await f.service.reply(f.agent, f.run.id, { ...reply, replyKey: "topic-3", final: true });
    await expect(
      f.service.checkpoint(f.agent, f.run.id, { invocationId: f.invocationId, work: [] }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      f.service.reply(f.agent, f.run.id, { ...reply, replyKey: "extra", final: true }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      f.service.recover(f.human, f.run.id, { action: "close", hostStopped: true }),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(f.twilio.sendMessage).toHaveBeenCalledTimes(4);
  });

  it("makes completed work immutable across checkpoints and new sessions", async () => {
    const f = await runningFixture();
    const completed = {
      domain: "tasks",
      key: "immutable-work",
      state: "completed",
      note: "Saved task",
      references: ["task:fixture"],
    };
    await f.service.checkpoint(f.agent, f.run.id, {
      invocationId: f.invocationId,
      work: [completed],
    });
    await expect(
      f.service.checkpoint(f.agent, f.run.id, {
        invocationId: f.invocationId,
        work: [{ ...completed, state: "pending" }],
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    await f.service.recover(f.human, f.run.id, { action: "close", hostStopped: true });
    await f.inbound("Continue safely");
    current = new Date(current.getTime() + 6000);
    await f.dispatch();
    const next = (await f.service.status(f.human)).runs[0];
    if (!next) throw new Error("Missing next run");
    const invocationId = crypto.randomUUID();
    await f.service.claim(f.agent, next.id, { invocationId });
    await expect(
      f.service.checkpoint(f.agent, next.id, {
        invocationId,
        work: [{ ...completed, state: "pending" }],
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    expect((await f.service.status(f.human)).runs.find((run) => run.id === f.run.id)?.work).toEqual(
      [completed],
    );
  });

  it("preserves pending work as uncertain on owner close and pages it across sessions", async () => {
    const f = await runningFixture();
    const work = Array.from({ length: 100 }, (_, i) => ({
      domain: "tasks",
      key: `pending-${String(i).padStart(3, "0")}`,
      state: "pending",
      note: "Read domain state before retry",
      references: [],
    }));
    for (let offset = 0; offset < work.length; offset += 20)
      await f.service.checkpoint(f.agent, f.run.id, {
        invocationId: f.invocationId,
        work: work.slice(offset, offset + 20),
      });
    await expect(
      f.service.checkpoint(f.agent, f.run.id, {
        invocationId: f.invocationId,
        work: [{ ...work[0], key: "overflow" }],
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await f.service.recover(f.human, f.run.id, { action: "close", hostStopped: true });
    expect(
      (await f.service.status(f.human)).runs[0]?.work.every((item) => item.state === "uncertain"),
    ).toBe(true);
    await f.inbound("Continue the remaining work");
    current = new Date(current.getTime() + 6000);
    await f.dispatch();
    const next = (await f.service.status(f.human)).runs[0];
    if (!next) throw new Error("Missing next run");
    const invocationId = crypto.randomUUID();
    await f.service.claim(f.agent, next.id, { invocationId });
    await f.service.checkpoint(f.agent, next.id, {
      invocationId,
      work: [{ ...work[0], key: "pending-100" }],
    });
    const first = await f.service.claim(f.agent, next.id, { invocationId });
    expect(first.pendingWork).toHaveLength(100);
    expect(first.nextPendingWorkCursor).toEqual({ domain: "tasks", key: "pending-099" });
    const last = await f.service.claim(f.agent, next.id, {
      invocationId,
      pendingWorkAfter: first.nextPendingWorkCursor,
    });
    expect(last.pendingWork.map(({ item }) => item.key)).toEqual(["pending-100"]);
    expect(last.nextPendingWorkCursor).toBeNull();
  });

  it("blocks an active stale host binding before dispatching later input", async () => {
    const f = await runningFixture();
    await database.db
      .update(automationHostSchedules)
      .set({
        encryptedFireCredentials: encryptJson(
          { token: "replacement-fixture-token" },
          encryptionKey,
        ),
      })
      .where(eq(automationHostSchedules.id, f.scheduleId));
    await f.inbound("Use the newly configured host");
    current = new Date(current.getTime() + 6000);
    await f.dispatch();
    const runs = (await f.service.status(f.human)).runs;
    expect(runs.find((run) => run.id === f.run.id)).toMatchObject({
      state: "blocked",
      reason: "authority_changed",
    });
    expect(runs[0]?.state).toBe("started");
    expect(f.fetch).toHaveBeenCalledTimes(2);
    await expect(
      f.service.claim(f.agent, f.run.id, { invocationId: f.invocationId }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("fences corrupt stored credentials without exposing them or retrying transport", async () => {
    const f = await fixture();
    await database.db
      .update(automationHostSchedules)
      .set({
        encryptedFireCredentials: encryptJson(
          { token: "fixture-routine-token" },
          Buffer.alloc(32, 8).toString("base64"),
        ),
      })
      .where(eq(automationHostSchedules.id, f.scheduleId));
    await f.inbound();
    current = new Date(current.getTime() + 6000);
    await f.dispatch();
    await f.dispatch();
    expect(f.fetch).not.toHaveBeenCalled();
    expect((await f.service.status(f.human)).runs[0]).toMatchObject({
      state: "uncertain",
      reason: "host_uncertain",
    });
  });

  it("does not reserve queued work while dispatch is disabled or stopped", async () => {
    const f = await fixture();
    await f.inbound();
    current = new Date(current.getTime() + 6000);
    const disabled = createTextingAgentDispatcher({
      db: database.db,
      enabled: () => false,
      now,
      encryptionKey,
      fetch: f.fetch,
    });
    await disabled();
    await f.dispatch(() => false);
    expect((await f.service.status(f.human)).runs).toEqual([]);
    expect(f.fetch).not.toHaveBeenCalled();
    await f.dispatch();
    expect(f.fetch).toHaveBeenCalledTimes(1);
  });

  it("limits starts within the rolling hour while preserving queued input for later", async () => {
    const f = await runningFixture();
    await f.service.recover(f.human, f.run.id, { action: "close", hostStopped: true });
    const [historical] = await database.db
      .select()
      .from(textingAgentRuns)
      .where(eq(textingAgentRuns.id, f.run.id));
    if (!historical) throw new Error("Missing historical run");
    await database.db.insert(textingAgentRuns).values(
      Array.from({ length: 24 }, () => ({
        ...historical,
        id: crypto.randomUUID(),
        invocationId: null,
      })),
    );
    await f.inbound("Wait for capacity");
    current = new Date(current.getTime() + 6000);
    await f.dispatch();
    expect(f.fetch).toHaveBeenCalledTimes(1);
    expect((await f.service.status(f.human)).pendingCount).toBe(1);
    current = new Date(current.getTime() + 3_600_001);
    await f.dispatch();
    expect(f.fetch).toHaveBeenCalledTimes(2);
    expect((await f.service.status(f.human)).pendingCount).toBe(0);
  });

  it("refuses rejected-run retries after credentials or execution permission changes", async () => {
    const f = await fixture();
    f.fetch.mockResolvedValue(new Response(null, { status: 403 }));
    await f.inbound();
    current = new Date(current.getTime() + 6000);
    await f.dispatch();
    const run = (await f.service.status(f.human)).runs[0];
    if (!run) throw new Error("Missing rejected run");
    const [originalHost] = await database.db
      .select({ encryptedFireCredentials: automationHostSchedules.encryptedFireCredentials })
      .from(automationHostSchedules)
      .where(eq(automationHostSchedules.id, f.scheduleId));
    if (!originalHost) throw new Error("Missing original host");
    await database.db
      .update(automationHostSchedules)
      .set({
        encryptedFireCredentials: encryptJson(
          { token: "replacement-fixture-token" },
          encryptionKey,
        ),
      })
      .where(eq(automationHostSchedules.id, f.scheduleId));
    await expect(f.service.recover(f.human, run.id, { action: "retry" })).rejects.toMatchObject({
      code: "forbidden",
    });
    await database.db
      .update(automationHostSchedules)
      .set({ encryptedFireCredentials: originalHost.encryptedFireCredentials })
      .where(eq(automationHostSchedules.id, f.scheduleId));
    await database.db
      .update(executionPolicySettings)
      .set({ reviewBypassEnabled: false })
      .where(eq(executionPolicySettings.userId, f.userId));
    await expect(f.service.recover(f.human, run.id, { action: "retry" })).rejects.toMatchObject({
      code: "forbidden",
    });
    expect((await f.service.status(f.human)).runs[0]).toMatchObject({
      id: run.id,
      reason: "host_rejected",
    });
    expect(f.fetch).toHaveBeenCalledTimes(1);
  });

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
      annotations: batch.messages.map((m) => ({
        messageId: m.id,
        workspaces: ["tasks", "calendar"],
      })),
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
      workspaces: ["tasks", "calendar"],
      replyToMessageIds: batch.messages.map((m) => m.id),
    });
    await f.service.reply(f.agent, run.id, {
      invocationId,
      body: "Your task list is up to date. Calendar access is needed.",
      workspaces: ["tasks", "calendar"],
      replyToMessageIds: batch.messages.map((m) => m.id),
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
    const claimed = await f.service.claim(f.agent, run.id, { invocationId });
    const replyToMessageIds = claimed.messages.map((m) => m.id);
    await f.service.checkpoint(f.agent, run.id, {
      invocationId,
      work: [],
      annotations: claimed.messages.map((m) => ({
        messageId: m.id,
        workspaces: ["tasks", "calendar"],
      })),
    });
    vi.mocked(f.twilio.sendMessage).mockRejectedValue(new Error("timeout"));
    await expect(
      f.service.reply(f.agent, run.id, {
        invocationId,
        body: "Here is your update.",
        workspaces: ["tasks"],
        replyToMessageIds,
      }),
    ).rejects.toThrow();
    await f.service.reply(f.agent, run.id, {
      invocationId,
      body: "Here is your update.",
      workspaces: ["tasks"],
      replyToMessageIds,
    });
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
    const claimed = await f.service.claim(f.agent, run.id, { invocationId });
    const replyToMessageIds = claimed.messages.map((m) => m.id);
    await f.service.checkpoint(f.agent, run.id, {
      invocationId,
      work: [],
      annotations: claimed.messages.map((m) => ({
        messageId: m.id,
        workspaces: ["tasks", "calendar"],
      })),
    });
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
      workspaces: ["tasks", "calendar"],
      replyToMessageIds,
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
  it("classifies originals, filters before pagination and proves only a delivered current agent reply", async () => {
    const f = await fixture();
    expect(await f.service.status(f.human)).toMatchObject({ chatReady: false, verifiedAt: null });
    await f.inbound("What is on my calendar and task list?");
    current = new Date(current.getTime() + 1000);
    await f.inbound("Also check mail");
    current = new Date(current.getTime() + 6000);
    await f.dispatch();
    const run = (await f.service.status(f.human)).runs[0];
    if (!run) throw new Error("Missing run");
    const invocationId = crypto.randomUUID();
    const batch = await f.service.claim(f.agent, run.id, { invocationId });
    const mixed = batch.messages.find((m) => m.text.includes("calendar"));
    const mail = batch.messages.find((m) => m.text.includes("mail"));
    if (!mixed || !mail) throw new Error("Missing messages");
    const taskReply = {
      invocationId,
      body: "Finish the proposal first.",
      workspaces: ["tasks"],
      replyToMessageIds: [mixed.id],
      replyKey: "tasks",
      final: false,
    };
    await expect(f.service.reply(f.agent, run.id, taskReply)).rejects.toMatchObject({
      code: "conflict",
    });
    await f.service.checkpoint(f.agent, run.id, {
      invocationId,
      work: [],
      annotations: [
        { messageId: mixed.id, workspaces: ["tasks", "calendar"] },
        { messageId: mail.id, workspaces: ["mail"] },
      ],
    });
    await expect(
      f.service.reply(f.agent, run.id, { ...taskReply, workspaces: ["finances"] }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await f.service.reply(f.agent, run.id, taskReply);
    await f.service.checkpoint(f.agent, run.id, {
      invocationId,
      work: [],
      annotations: [{ messageId: mixed.id, workspaces: ["calendar"] }],
    });
    expect(
      (
        await f.texting.conversation(f.human, "UTC", { limit: 100, workspace: "tasks" })
      ).messages.some((message) => message.id === mixed.id),
    ).toBe(true);
    await f.service.reply(f.agent, run.id, taskReply);
    expect(f.twilio.sendMessage).toHaveBeenCalledTimes(1);
    await expect(
      f.service.reply(f.agent, run.id, { ...taskReply, workspaces: ["calendar"] }),
    ).rejects.toMatchObject({ code: "conflict" });
    const first = await f.texting.conversation(f.human, "UTC", { limit: 1, workspace: "tasks" });
    expect(first.messages).toHaveLength(1);
    expect(first.messages[0]).toMatchObject({
      text: expect.stringContaining("Finish the proposal"),
      senderKind: "agent",
      workspaces: ["tasks"],
      replyToMessageIds: [mixed.id],
    });
    expect(first.conversationReceipt).toBeNull();
    expect(first.hasEarlierMessages).toBe(true);
    const older = await f.texting.conversation(f.human, "UTC", {
      limit: 1,
      workspace: "tasks",
      beforeCursor: first.earlierCursor ?? undefined,
    });
    expect(older.messages.map((m) => m.text)).toEqual([mixed.text]);
    expect(older.hasEarlierMessages).toBe(false);
    expect(
      (
        await f.texting.conversation(f.human, "UTC", { limit: 100, workspace: "mail" })
      ).messages.map((m) => m.text),
    ).toEqual([mail.text]);
    expect(await f.service.status(f.human)).toMatchObject({ chatReady: false, verifiedAt: null });
    const [outbound] = await database.db
      .select()
      .from(textMessages)
      .where(eq(textMessages.id, first.messages[0]?.id ?? ""));
    if (!outbound?.providerMessageSid) throw new Error("No submission evidence");
    await f.texting.updateStatus({
      MessageSid: outbound.providerMessageSid,
      MessageStatus: "delivered",
    });
    expect(await f.service.status(f.human)).toMatchObject({
      chatReady: true,
      verifiedAt: current.toISOString(),
    });
    await database.db
      .update(textMessages)
      .set({ senderKind: "system" })
      .where(eq(textMessages.id, outbound.id));
    expect((await f.service.status(f.human)).chatReady).toBe(false);
    await database.db
      .update(textMessages)
      .set({ senderKind: "agent" })
      .where(eq(textMessages.id, outbound.id));
    const [scheduleBefore] = await database.db
      .select()
      .from(automationHostSchedules)
      .where(eq(automationHostSchedules.id, f.scheduleId));
    if (!scheduleBefore) throw new Error("Missing schedule");
    await database.db
      .update(automationHostSchedules)
      .set({ encryptedFireCredentials: encryptJson({ token: "rotated-token" }, encryptionKey) })
      .where(eq(automationHostSchedules.id, f.scheduleId));
    expect((await f.service.status(f.human)).chatReady).toBe(false);
    await expect(f.service.claim(f.agent, run.id, { invocationId })).rejects.toMatchObject({
      code: "forbidden",
    });
    await database.db
      .update(automationHostSchedules)
      .set({
        encryptedFireCredentials: scheduleBefore.encryptedFireCredentials,
        schedule: automationHostScheduleSchema.parse({
          ...scheduleBefore.schedule,
          hostAutomationId: "trig_99999999999",
        }),
      })
      .where(eq(automationHostSchedules.id, f.scheduleId));
    expect((await f.service.status(f.human)).chatReady).toBe(false);
    await database.db
      .update(automationHostSchedules)
      .set({ schedule: scheduleBefore.schedule })
      .where(eq(automationHostSchedules.id, f.scheduleId));
    expect((await f.service.status(f.human)).chatReady).toBe(true);
    current = new Date(current.getTime() + 1000);
    await f.service.configure(f.human, {
      scheduleId: f.scheduleId,
      subscriptionOnlyConfirmed: true,
    });
    expect((await f.service.status(f.human)).chatReady).toBe(true);
    await f.service.configure(f.human, { scheduleId: null });
    expect((await f.service.status(f.human)).chatReady).toBe(false);
    await f.service.configure(f.human, {
      scheduleId: f.scheduleId,
      subscriptionOnlyConfirmed: true,
    });
    expect((await f.service.status(f.human)).chatReady).toBe(false);
    await f.service.reply(f.agent, run.id, {
      invocationId,
      body: "Your afternoon is free.",
      workspaces: ["calendar"],
      replyToMessageIds: [mixed.id],
      replyKey: "calendar",
      final: true,
    });
    expect((await f.service.status(f.human)).runs[0]?.state).toBe("completed");
    expect(f.twilio.sendMessage).toHaveBeenCalledTimes(2);
  });
  it("rejects cross-owner classification and references while preserving linked human follow-ups", async () => {
    const other = await fixture();
    await other.inbound("Other owner private message");
    const foreign = (await other.texting.conversation(other.human, "UTC", { limit: 100 }))
      .messages[0];
    if (!foreign) throw new Error("Missing foreign message");
    const f = await fixture();
    await f.inbound("Can you check tasks?");
    current = new Date(current.getTime() + 1000);
    await f.inbound("Yes, do that");
    current = new Date(current.getTime() + 6000);
    await f.dispatch();
    const run = (await f.service.status(f.human)).runs[0];
    if (!run) throw new Error("Missing run");
    const invocationId = crypto.randomUUID();
    const batch = await f.service.claim(f.agent, run.id, { invocationId });
    const question = batch.messages.find((m) => m.text.startsWith("Can"));
    const followup = batch.messages.find((m) => m.text.startsWith("Yes"));
    if (!question || !followup) throw new Error("Missing batch");
    await expect(
      f.service.checkpoint(f.agent, run.id, {
        invocationId,
        work: [],
        annotations: [{ messageId: foreign.id, workspaces: ["tasks"] }],
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      f.service.checkpoint(f.agent, run.id, {
        invocationId,
        work: [],
        annotations: [
          { messageId: question.id, workspaces: ["tasks"], replyToMessageIds: [foreign.id] },
        ],
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      f.service.checkpoint(f.agent, run.id, {
        invocationId,
        work: [],
        annotations: [
          { messageId: question.id, workspaces: ["tasks"], replyToMessageIds: [followup.id] },
        ],
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await f.service.checkpoint(f.agent, run.id, {
      invocationId,
      work: [],
      annotations: [
        { messageId: question.id, workspaces: ["tasks"] },
        { messageId: followup.id, workspaces: ["tasks"], replyToMessageIds: [question.id] },
      ],
    });
    await expect(
      f.service.reply(f.agent, run.id, {
        invocationId,
        body: "Done",
        workspaces: ["tasks"],
        replyToMessageIds: [question.id, foreign.id],
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    const view = await f.texting.conversation(f.human, "UTC", { limit: 100, workspace: "tasks" });
    expect(view.messages.find((m) => m.id === followup.id)?.replyToMessageIds).toEqual([
      question.id,
    ]);
    expect(
      (await f.texting.conversation(other.human, "UTC", { limit: 100, workspace: "tasks" }))
        .messages,
    ).toEqual([]);
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
