import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  createDatabaseClient,
  type DatabaseClient,
  financeAccounts,
  financeAgentActionReviews,
  financeConversationMessages,
  financeConversations,
  financeMaintenanceCandidates,
  financeReviewCases,
  financeTransactions,
  migrateDatabase,
  nativePushDeliveries,
  nativePushDevices,
  nativePushEvents,
  notificationPreferences,
  sessions,
  users,
  workspaceMaintenanceRuns,
} from "@personal-os/database";
import { defaultNotificationPreferences } from "@personal-os/domain";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq, sql } from "drizzle-orm";
import { createFinanceContextualQuestionService } from "./finance/contextual-question-service.js";
import { issueMaintenanceReviewQuestion } from "./finance/review-action-service.js";
import { createNativePushRuntime } from "./native-push-runtime.js";
import { createNativePushService, enqueueNativePushEvent } from "./native-push-service.js";
import type { NativePushProviderResult } from "./native-push-transport.js";
import type { Principal } from "./types.js";

describe.sequential("private native Finance delivery", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  const baseline = new Date(new Date().setUTCHours(14, 0, 0, 0));
  let clock = baseline;
  const config = {
    enabled: true,
    teamId: "TESTTEAM00",
    keyId: "TESTKEY000",
    privateKey: "unused",
    topic: "app.personal-os.mobile",
    environment: "production" as const,
  };
  const encryptionKey = Buffer.alloc(32, 9).toString("base64");
  let providerResult: NativePushProviderResult = "accepted";
  const transport = vi.fn(
    async (_input: Parameters<import("./native-push-transport.js").NativePushTransport>[0]) =>
      providerResult,
  );
  const service = () =>
    createNativePushService({
      appBaseUrl: "https://app.example.com",
      db: database.db,
      encryptionKey,
      config,
      transport,
      now: () => clock,
    });
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
  }, 60_000);
  afterAll(async () => {
    await database?.close();
    await container?.stop();
  });
  beforeEach(async () => {
    await database.db.delete(users);
    transport.mockClear();
    providerResult = "accepted";
    clock = baseline;
  });
  async function owner() {
    const id = randomUUID(),
      sessionId = randomUUID();
    await database.db.insert(users).values({
      id,
      email: `${id}@example.com`,
      displayName: "Push",
      passwordHash: "unused",
      planningTimezone: "UTC",
    });
    await database.db.insert(sessions).values({
      id: sessionId,
      userId: id,
      tokenHash: randomUUID(),
      expiresAt: new Date(baseline.getTime() + 7 * 86_400_000),
    });
    const principal: Principal = {
      userId: id,
      actorId: id,
      actorType: "user",
      sessionId,
      scopes: new Set(),
    };
    return principal;
  }
  function deviceInput(installationId = randomUUID(), token = "ab".repeat(32)) {
    return { installationId, token, environment: "production" as const, financeEnabled: true };
  }
  async function event(principal: Principal, createdAt = clock) {
    const id = randomUUID();
    await database.db.insert(workspaceMaintenanceRuns).values({
      id,
      userId: principal.userId,
      domain: "finances",
      status: "blocked",
      scope: { type: "all_outstanding" },
      rulebookVersion: "1",
      createdAt,
      updatedAt: createdAt,
    });
    await database.db.transaction((tx) =>
      enqueueNativePushEvent(tx, {
        userId: principal.userId,
        sourceId: id,
        sourceType: "maintenance_run",
        kind: "attention",
        sourceRevision: "blocked",
        createdAt,
      }),
    );
    const row = (await database.db.select().from(nativePushEvents))[0];
    if (!row) throw new Error("missing event");
    return row;
  }
  it("encrypts tokens, preserves enrollment identity on replay, dedupes and sends only private IDs", async () => {
    const principal = await owner(),
      input = deviceInput();
    const first = await service().register(principal, input);
    expect(await service().register(principal, input)).toEqual(first);
    const source = await event(principal);
    await database.db.transaction((tx) =>
      enqueueNativePushEvent(tx, {
        userId: principal.userId,
        sourceId: source.sourceId,
        sourceType: "maintenance_run",
        kind: "attention",
        sourceRevision: "blocked",
        createdAt: clock,
      }),
    );
    expect(await database.db.select().from(nativePushDeliveries)).toHaveLength(1);
    const stored = (await database.db.select().from(nativePushDevices))[0];
    expect(JSON.stringify(stored)).not.toContain(input.token);
    await service().dispatch();
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0]).toBeDefined();
    expect(await service().resolve(principal, source.id, input.installationId)).toMatchObject({
      audience: first.audience,
      destination: "finance_attention",
    });
    expect((await database.db.select().from(nativePushDeliveries))[0]?.state).toBe("accepted");
  });
  it("isolates owners, agents, revoked sessions and stale owner-switch audiences", async () => {
    const a = await owner(),
      b = await owner(),
      input = deviceInput();
    await service().register(a, input);
    const source = await event(a);
    await expect(service().register({ ...a, actorType: "agent" }, input)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(service().resolve(b, source.id, input.installationId)).rejects.toMatchObject({
      code: "not_found",
    });
    await service().register(b, input);
    await service().dispatch();
    expect(transport).not.toHaveBeenCalled();
    await database.db.delete(sessions).where(eq(sessions.id, String(b.sessionId)));
    await expect(service().register(b, input)).rejects.toMatchObject({ code: "unauthorized" });
    expect(await database.db.select().from(nativePushDevices)).toHaveLength(0);
  });
  it("rolls back publication and does not enroll devices into historical events", async () => {
    const principal = await owner();
    await event(principal);
    await service().register(principal, deviceInput());
    expect(await database.db.select().from(nativePushDeliveries)).toHaveLength(0);
    await expect(
      database.db.transaction(async (tx) => {
        await enqueueNativePushEvent(tx, {
          userId: principal.userId,
          sourceId: randomUUID(),
          kind: "reply",
          sourceRevision: "1",
          createdAt: clock,
        });
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");
    expect(await database.db.select().from(nativePushEvents)).toHaveLength(1);
  });
  it("fences unknown outcomes, bounds explicit rejection retries and invalidates tokens", async () => {
    const principal = await owner();
    await service().register(principal, deviceInput());
    await event(principal);
    providerResult = "uncertain";
    await service().dispatch();
    clock = new Date(clock.getTime() + 120000);
    await service().dispatch();
    expect(transport).toHaveBeenCalledTimes(1);
    await database.db.delete(nativePushEvents);
    await database.db.delete(workspaceMaintenanceRuns);
    await event(principal);
    providerResult = "retryable";
    for (let i = 0; i < 4; i++) {
      await service().dispatch();
      clock = new Date(clock.getTime() + 120000);
    }
    expect((await database.db.select().from(nativePushDeliveries))[0]).toMatchObject({
      state: "failed",
      attempts: 3,
    });
    await database.db.delete(nativePushEvents);
    await database.db.delete(workspaceMaintenanceRuns);
    await event(principal);
    providerResult = "invalid_token";
    await service().dispatch();
    expect((await database.db.select().from(nativePushDevices))[0]?.financeEnabled).toBe(false);
  });
  it("recovers process loss without replay and suppresses expired or resolved sources", async () => {
    const principal = await owner();
    await service().register(principal, deviceInput());
    await event(principal);
    await database.db
      .update(nativePushDeliveries)
      .set({ state: "submitting", leaseUntil: new Date(clock.getTime() - 1) });
    await service().dispatch();
    expect((await database.db.select().from(nativePushDeliveries))[0]?.state).toBe("uncertain");
    expect(transport).not.toHaveBeenCalled();
    await database.db.delete(nativePushEvents);
    await database.db.delete(workspaceMaintenanceRuns);
    const source = await event(principal);
    clock = new Date(clock.getTime() + 86_400_001);
    await service().dispatch();
    expect(transport).not.toHaveBeenCalled();
    clock = baseline;
    await database.db.delete(nativePushEvents);
    await database.db.delete(workspaceMaintenanceRuns);
    await event(principal);
    await database.db.update(workspaceMaintenanceRuns).set({ status: "completed" });
    await service().dispatch();
    expect(transport).not.toHaveBeenCalled();
    await expect(
      service().resolve(principal, source.id, deviceInput().installationId),
    ).rejects.toMatchObject({ code: "not_found" });
  });
  it("discovers canonical current work without repeated unchanged-blocker pushes", async () => {
    const principal = await owner();
    await service().register(principal, deviceInput());
    await event(principal);
    await database.db.delete(nativePushEvents);
    const runtime = createNativePushRuntime({
      db: database.db,
      enabled: () => true,
      dispatch: service().dispatch,
    });
    await runtime.run();
    await runtime.run();
    expect(transport).toHaveBeenCalledTimes(1);
    runtime.quiesce();
    expect(runtime.run()).toBeNull();
    await runtime.waitForIdle();
  });
  it("honors opt-out and quiet hours without exhausting provider attempts", async () => {
    const principal = await owner(),
      input = deviceInput();
    await service().register(principal, input);
    await event(principal);
    await database.db.insert(notificationPreferences).values({
      userId: principal.userId,
      scope: "finances",
      revision: 1,
      preferences: {
        ...defaultNotificationPreferences,
        quietMode: "window",
        quietStartMinute: 0,
        quietEndMinute: 1439,
      },
    });
    for (let i = 0; i < 5; i++) {
      await service().dispatch();
      clock = new Date(clock.getTime() + 120000);
    }
    expect(transport).not.toHaveBeenCalled();
    expect((await database.db.select().from(nativePushDeliveries))[0]).toMatchObject({
      state: "pending",
      attempts: 0,
      outcomeCode: "quiet_hours",
    });
    await service().disable(principal, input.installationId);
    await service().dispatch();
    expect(transport).not.toHaveBeenCalled();
    expect((await database.db.select().from(nativePushDeliveries))[0]?.state).toBe("suppressed");
  });
  it("rejects unavailable delivery and wrong environments and serializes concurrent enrollment", async () => {
    const principal = await owner(),
      input = deviceInput();
    const disabled = createNativePushService({
      appBaseUrl: "https://app.example.com",
      db: database.db,
      encryptionKey,
      config: { ...config, enabled: false },
      transport,
      now: () => clock,
    });
    await expect(disabled.register(principal, input)).rejects.toMatchObject({
      code: "service_unavailable",
    });
    await expect(
      service().register(principal, { ...input, environment: "sandbox" }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    const [a, b] = await Promise.all([
      service().register(principal, input),
      service().register(principal, input),
    ]);
    expect(a).toEqual(b);
    expect(await database.db.select().from(nativePushDevices)).toHaveLength(1);
    await service().register(principal, deviceInput(randomUUID(), input.token));
    expect(await database.db.select().from(nativePushDevices)).toHaveLength(1);
  });
  it("locks session revocation and device rebinding while provider submission is in flight", async () => {
    const principal = await owner(),
      input = deviceInput();
    await service().register(principal, input);
    await event(principal);
    let release: (result: NativePushProviderResult) => void = () => {};
    let started: () => void = () => {};
    const begun = new Promise<void>((resolve) => {
      started = resolve;
    });
    const result = new Promise<NativePushProviderResult>((resolve) => {
      release = resolve;
    });
    const active = createNativePushService({
      appBaseUrl: "https://app.example.com",
      db: database.db,
      encryptionKey,
      config,
      now: () => clock,
      transport: async () => {
        started();
        return result;
      },
    });
    const dispatch = active.dispatch();
    await begun;
    try {
      await expect(
        database.db.transaction((tx) =>
          tx.execute(
            sql`SELECT id FROM sessions WHERE id=${String(principal.sessionId)}::uuid FOR UPDATE NOWAIT`,
          ),
        ),
      ).rejects.toThrow();
      await expect(
        database.db.transaction((tx) =>
          tx.execute(
            sql`SELECT id FROM native_push_devices WHERE installation_id=${input.installationId}::uuid FOR UPDATE NOWAIT`,
          ),
        ),
      ).rejects.toThrow();
    } finally {
      release("accepted");
    }
    await dispatch;
    await database.db.delete(sessions).where(eq(sessions.id, String(principal.sessionId)));
    await expect(active.register(principal, input)).rejects.toMatchObject({ code: "unauthorized" });
  });
  it("resolves a pending agent approval to its current actionable source without exposing private payloads", async () => {
    const principal = await owner(),
      input = deviceInput(),
      sourceId = randomUUID();
    await service().register(principal, input);
    await database.db.insert(financeAgentActionReviews).values({
      id: sourceId,
      userId: principal.userId,
      requestingAgentId: randomUUID(),
      actionKind: "categorize_transaction",
      privatePayload: { secret: "must-not-leak" },
      fingerprint: randomUUID(),
      createdAt: clock,
      updatedAt: clock,
    });
    await database.db.transaction((tx) =>
      enqueueNativePushEvent(tx, {
        userId: principal.userId,
        sourceId,
        sourceType: "action_review",
        kind: "attention",
        sourceRevision: String(clock.getTime()),
        createdAt: clock,
      }),
    );
    const [push] = await database.db.select().from(nativePushEvents);
    if (!push) throw new Error("missing event");
    await service().dispatch();
    const resolved = await service().resolve(principal, push.id, input.installationId);
    expect(resolved).toMatchObject({
      destination: "finance_attention",
      detail: {
        title: "An agent action needs your approval",
        status: "pending",
        webPath: `/finances/review?approval=${sourceId}`,
        webUrl: `https://app.example.com/finances/review?approval=${sourceId}`,
      },
    });
    expect(resolved.detail?.summary).toContain("categorize transaction");
    expect(JSON.stringify(resolved)).not.toContain("must-not-leak");
    const other = await owner();
    await expect(service().resolve(other, push.id, input.installationId)).rejects.toMatchObject({
      code: "not_found",
    });
    await database.db
      .update(financeAgentActionReviews)
      .set({ status: "dismissed" })
      .where(eq(financeAgentActionReviews.id, sourceId));
    await expect(service().resolve(principal, push.id, input.installationId)).rejects.toMatchObject(
      { code: "not_found" },
    );
  });
  it("bounds discovery to 25, resumes the cursor and honors disabled delivery", async () => {
    const principal = await owner(),
      input = deviceInput();
    await service().register(principal, input);
    const ids = Array.from({ length: 26 }, () => randomUUID()).sort();
    await database.db.insert(workspaceMaintenanceRuns).values(
      ids.map((id) => ({
        id,
        userId: principal.userId,
        domain: "finances" as const,
        status: "completed" as const,
        scope: { type: "all_outstanding" as const },
        rulebookVersion: "1",
        createdAt: clock,
        updatedAt: clock,
      })),
    );
    let enabled = false;
    const runtime = createNativePushRuntime({
      db: database.db,
      enabled: () => enabled,
      dispatch: service().dispatch,
    });
    await runtime.run();
    expect(transport).not.toHaveBeenCalled();
    enabled = true;
    await runtime.run();
    expect(await database.db.select().from(nativePushEvents)).toHaveLength(25);
    await runtime.run();
    expect(await database.db.select().from(nativePushEvents)).toHaveLength(26);
    expect(transport).toHaveBeenCalledTimes(26);
    const [completion] = await database.db.select().from(nativePushEvents);
    if (!completion) throw new Error("missing completion");
    expect(await service().resolve(principal, completion.id, input.installationId)).toMatchObject({
      destination: "finance_activity",
    });
  });

  it("discovers fresh work without filling the batch with expired post-enrollment work", async () => {
    const principal = await owner();
    const currentTime = new Date();
    const expiredTime = new Date(currentTime.getTime() - 25 * 60 * 60 * 1000);
    clock = new Date(currentTime.getTime() - 26 * 60 * 60 * 1000);
    await service().register(principal, deviceInput());
    clock = baseline;

    const ids = Array.from({ length: 26 }, () => randomUUID()).sort();
    const freshId = ids.at(-1);
    await database.db.insert(workspaceMaintenanceRuns).values(
      ids.map((id) => ({
        id,
        userId: principal.userId,
        domain: "finances" as const,
        status: "completed" as const,
        scope: { type: "all_outstanding" as const },
        rulebookVersion: "1",
        createdAt: id === freshId ? baseline : expiredTime,
        updatedAt: id === freshId ? baseline : expiredTime,
      })),
    );
    const runtime = createNativePushRuntime({
      db: database.db,
      enabled: () => true,
      dispatch: service().dispatch,
    });

    await runtime.run();

    const events = await database.db.select().from(nativePushEvents);
    expect(events.map((event) => event.sourceId)).toEqual([freshId]);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("routes a committed agent reply to chat and denies a principal without a session", async () => {
    const principal = await owner(),
      input = deviceInput();
    const { sessionId: _sessionId, ...noSession } = principal;
    await expect(service().register(noSession, input)).rejects.toMatchObject({ code: "forbidden" });
    expect(await service().register(principal, { ...input, financeEnabled: false })).toMatchObject({
      status: "disabled",
    });
    await service().register(principal, input);
    await database.db
      .insert(financeConversations)
      .values({ userId: principal.userId, nextSequence: 2n });
    const sourceId = randomUUID();
    await database.db.insert(financeConversationMessages).values({
      id: sourceId,
      userId: principal.userId,
      authorKind: "agent",
      text: "Private reply",
      sequence: 1n,
      idempotencyKey: randomUUID(),
      createdAt: clock,
    });
    await database.db.transaction((tx) =>
      enqueueNativePushEvent(tx, {
        userId: principal.userId,
        sourceId,
        kind: "reply",
        sourceRevision: "1",
        createdAt: clock,
      }),
    );
    await service().dispatch();
    const [reply] = await database.db.select().from(nativePushEvents);
    if (!reply) throw new Error("missing reply event");
    expect(await service().resolve(principal, reply.id, input.installationId)).toMatchObject({
      destination: "finance_chat",
    });
  });

  it("defers an unavailable timezone and fences a thrown transport outcome", async () => {
    const principal = await owner();
    await service().register(principal, deviceInput());
    await event(principal);
    await database.db
      .update(users)
      .set({ planningTimezone: "Invalid/Timezone" })
      .where(eq(users.id, principal.userId));
    await service().dispatch();
    expect(transport).not.toHaveBeenCalled();
    expect((await database.db.select().from(nativePushDeliveries))[0]).toMatchObject({
      state: "pending",
      attempts: 0,
      outcomeCode: "timezone_unavailable",
    });
    await database.db
      .update(users)
      .set({ planningTimezone: "UTC" })
      .where(eq(users.id, principal.userId));
    clock = new Date(clock.getTime() + 120_000);
    transport.mockRejectedValueOnce(new Error("provider connection lost"));
    await service().dispatch();
    clock = new Date(clock.getTime() + 120_000);
    await service().dispatch();
    expect(transport).toHaveBeenCalledTimes(1);
    expect((await database.db.select().from(nativePushDeliveries))[0]).toMatchObject({
      state: "uncertain",
      outcomeCode: "uncertain",
    });
  });

  it("inherits global notification opt-out and stops a claim when quiescing", async () => {
    const principal = await owner();
    await service().register(principal, deviceInput());
    await event(principal);
    await database.db.insert(notificationPreferences).values({
      userId: principal.userId,
      scope: "global",
      revision: 1,
      preferences: { ...defaultNotificationPreferences, enabled: false },
    });
    await service().dispatch(() => false);
    expect((await database.db.select().from(nativePushDeliveries))[0]?.state).toBe("pending");
    let checks = 0;
    await service().dispatch(() => ++checks < 2);
    expect((await database.db.select().from(nativePushDeliveries))[0]?.state).toBe("pending");
    await service().dispatch();
    expect((await database.db.select().from(nativePushDeliveries))[0]).toMatchObject({
      state: "suppressed",
      outcomeCode: "preferences_disabled",
    });
    expect(transport).not.toHaveBeenCalled();
  });
  it("distinguishes bookkeeping approval from failure and links to the supported surface", async () => {
    const principal = await owner(),
      input = deviceInput();
    await service().register(principal, input);
    const [approval, failure] = await database.db
      .insert(workspaceMaintenanceRuns)
      .values(
        (["awaiting_approval", "failed_terminal"] as const).map((status) => ({
          userId: principal.userId,
          domain: "finances" as const,
          status,
          scope: { type: "all_outstanding" as const },
          rulebookVersion: "1",
          createdAt: clock,
          updatedAt: clock,
        })),
      )
      .returning();
    const runtime = createNativePushRuntime({
      db: database.db,
      enabled: () => true,
      dispatch: service().dispatch,
    });
    await runtime.run();
    const events = await database.db.select().from(nativePushEvents);
    const approvalEvent = events.find((row) => row.sourceId === approval?.id);
    const failureEvent = events.find((row) => row.sourceId === failure?.id);
    if (!approvalEvent || !failureEvent) throw new Error("missing maintenance notifications");
    expect(
      await service().resolve(principal, approvalEvent.id, input.installationId),
    ).toMatchObject({
      detail: {
        status: "awaiting_approval",
        summary: expect.stringContaining("waiting for approval"),
        webPath: "/finances/review",
      },
    });
    expect(await service().resolve(principal, failureEvent.id, input.installationId)).toMatchObject(
      {
        detail: {
          status: "failed_terminal",
          summary: expect.stringContaining("encountered a problem"),
          webPath: "/finances/activity",
        },
      },
    );
  });
  it("routes contextual questions and maintenance review cases to their own answer forms", async () => {
    const principal = await owner(),
      input = deviceInput();
    await service().register(principal, input);
    const [account] = await database.db
      .insert(financeAccounts)
      .values({ userId: principal.userId, provider: "manual", institution: "Manual", name: "Cash" })
      .returning();
    if (!account) throw new Error("missing account");
    const [transaction] = await database.db
      .insert(financeTransactions)
      .values({
        userId: principal.userId,
        accountId: account.id,
        amount: 1200,
        merchant: "Lunch",
        direction: "expense",
        transactionDate: "2026-09-21",
      })
      .returning();
    if (!transaction) throw new Error("missing transaction");
    const questions = createFinanceContextualQuestionService({ db: database.db, now: () => clock });
    const context = {
      principal: { ...principal, scopes: new Set(["finances:read", "finances:write"] as const) },
      requestId: randomUUID(),
    };
    const created = await questions.createQuestion(
      transaction.id,
      { operationId: randomUUID() },
      context,
    );
    if (created.state !== "available") throw new Error("missing question");
    const runtime = createNativePushRuntime({
      db: database.db,
      enabled: () => true,
      dispatch: service().dispatch,
    });
    await runtime.run();
    const [push] = await database.db.select().from(nativePushEvents);
    if (!push) throw new Error("missing question notification");
    expect(await service().resolve(principal, push.id, input.installationId)).toMatchObject({
      detail: {
        status: "open",
        summary: created.question.prompt,
        webPath: `/finances/review?contextualQuestion=${created.question.id}`,
      },
    });
    expect(JSON.stringify(transport.mock.calls[0]?.[0].payload)).not.toContain(
      created.question.prompt,
    );
    const [run] = await database.db
      .insert(workspaceMaintenanceRuns)
      .values({
        userId: principal.userId,
        domain: "finances",
        scope: { type: "all_outstanding" },
        rulebookVersion: "1",
        status: "completed_with_questions",
        createdAt: clock,
        updatedAt: clock,
      })
      .returning();
    if (!run) throw new Error("missing run");
    const [candidate] = await database.db
      .insert(financeMaintenanceCandidates)
      .values({
        userId: principal.userId,
        runId: run.id,
        revision: "native-push-review",
        state: "challenged",
      })
      .returning();
    if (!candidate) throw new Error("missing candidate");
    await database.db
      .update(financeReviewCases)
      .set({
        rationale: null,
        updatedAt: clock,
        evidence: {
          prompt: "What did this transaction represent?",
          maintenanceRunId: run.id,
          candidateId: candidate.id,
          candidateRevision: candidate.revision,
        },
      })
      .where(eq(financeReviewCases.id, created.question.reviewCaseId));
    await database.db.transaction((tx) =>
      issueMaintenanceReviewQuestion(tx, principal.userId, created.question.reviewCaseId),
    );
    await runtime.run();
    const reviewEvent = (await database.db.select().from(nativePushEvents)).find(
      (row) => row.sourceId === created.question.reviewCaseId,
    );
    if (!reviewEvent) throw new Error("missing maintenance case notification");
    expect(await service().resolve(principal, reviewEvent.id, input.installationId)).toMatchObject({
      detail: {
        status: "open",
        summary: expect.stringContaining("Review this transaction"),
        webPath: `/finances/review?case=${created.question.reviewCaseId}`,
      },
    });
  });
  it("quiesces while reading discovery and leaves work for the next runtime", async () => {
    const principal = await owner();
    await service().register(principal, deviceInput());
    await event(principal);
    await database.db.delete(nativePushEvents);
    const options = { db: database.db, enabled: () => true, dispatch: service().dispatch };
    const runtime = createNativePushRuntime(options);
    const execute = database.db.execute.bind(database.db);
    const spy = vi.spyOn(database.db, "execute").mockImplementationOnce((query) => {
      runtime.quiesce();
      return execute(query);
    });
    try {
      await runtime.run();
      expect(await database.db.select().from(nativePushEvents)).toHaveLength(0);
      expect(transport).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
    await createNativePushRuntime(options).run();
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
