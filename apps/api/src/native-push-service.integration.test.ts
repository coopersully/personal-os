import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  createDatabaseClient,
  type DatabaseClient,
  financeAgentActionReviews,
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
import { createNativePushRuntime } from "./native-push-runtime.js";
import { createNativePushService, enqueueNativePushEvent } from "./native-push-service.js";
import type { NativePushProviderResult } from "./native-push-transport.js";
import type { Principal } from "./types.js";

describe.sequential("private native Finance delivery", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  let clock = new Date("2026-11-10T14:00:00Z");
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
    clock = new Date("2026-11-10T14:00:00Z");
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
      expiresAt: new Date("2027-01-01"),
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
    clock = new Date("2026-11-10T14:00:00Z");
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
});
