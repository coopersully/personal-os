import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  accessTokens,
  automationHostSchedules,
  createDatabaseClient,
  type DatabaseClient,
  financeAnswerContinuations,
  migrateDatabase,
  oauthClients,
  oauthRefreshTokens,
  users,
  workspaceMaintenanceRuns,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq, sql } from "drizzle-orm";
import { createAutomationHostService } from "./automation-host-service.js";
import { reconcileFinanceContinuations } from "./finance/continuation-reconciliation.js";
import { requireHostRunAuthority } from "./finance/host-run-authority.js";
import { createFinanceHostDispatcher } from "./finance-host-dispatcher.js";
import { createOAuthService } from "./oauth-service.js";
import { encryptJson, hashToken } from "./security.js";
import type { Principal } from "./types.js";

const encryptionKey = Buffer.alloc(32, 7).toString("base64");
const now = () => new Date("2026-10-09T15:00:00Z");
describe.sequential("tenant-bound host schedules", () => {
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
  beforeEach(async () => {
    await database.db.delete(users);
  });
  async function fixture() {
    const userId = randomUUID(),
      connectionId = randomUUID();
    await database.db.insert(users).values({
      id: userId,
      email: `${userId}@example.com`,
      displayName: "Host owner",
      passwordHash: "unused",
    });
    const [token] = await database.db
      .insert(accessTokens)
      .values({
        userId,
        name: "Original host",
        authorizationConnectionId: connectionId,
        tokenHash: randomUUID(),
        scopes: ["finances:maintain"],
        expiresAt: new Date("2026-10-10T15:00:00Z"),
      })
      .returning();
    if (!token) throw new Error("token");
    const human: Principal = {
      userId,
      actorId: userId,
      actorType: "user",
      scopes: new Set(["finances:read", "finances:write"]),
    };
    const agent: Principal = {
      userId,
      actorId: token.id,
      actorType: "agent",
      authorizationConnectionId: connectionId,
      scopes: new Set(["finances:maintain"]),
    };
    const service = createAutomationHostService({ db: database.db, now, encryptionKey });
    return { userId, connectionId, human, agent, token, service };
  }
  const input = (connectionId: string) => ({
    tenantAuthorizationConnectionId: connectionId,
    label: "Finance",
    requestedScopes: ["finances:maintain"],
    hostSurface: "codex_desktop",
    trigger: {
      type: "recurring",
      recurrence: { type: "interval", everyMinutes: 15, timeZone: "America/New_York" },
    },
  });
  it("requires explicit human setup and one owner's live grant", async () => {
    const f = await fixture(),
      other = await fixture();
    await expect(f.service.create(f.agent, input(f.connectionId))).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(f.service.create(f.human, input(other.connectionId))).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(
      f.service.create(f.human, {
        ...input(f.connectionId),
        requestedScopes: ["finances:maintain", "finances:write"],
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await f.service.connections(f.human)).toEqual([
      { id: f.connectionId, label: "Original host", scopes: ["finances:maintain"] },
    ]);
    await expect(f.service.connections(f.agent)).rejects.toMatchObject({ code: "forbidden" });
    const created = await f.service.create(f.human, input(f.connectionId));
    expect(created.schedule.state).toBe("setup_pending");
    expect(created.health.state).toBe("setup_pending");
    expect(await other.service.list(other.human)).toEqual([]);
    await expect(
      other.service.bind(other.human, created.schedule.id, {
        expectedVersion: 1,
        expectedState: "setup_pending",
        hostSurface: "codex_desktop",
        hostAutomationId: "schedule",
        nextExpectedAt: "2026-10-09T15:15:00Z",
      }),
    ).rejects.toMatchObject({ code: "not_found" });
  });
  it("keeps host settings metadata private to the interactive owner", async () => {
    const f = await fixture();
    await f.service.create(f.human, input(f.connectionId));
    const principals: Principal[] = [
      { ...f.agent, scopes: new Set(["finances:read"]) },
      { ...f.agent, scopes: new Set(["finances:read", "finances:maintain"]) },
      { ...f.human, actorId: randomUUID() },
    ];
    for (const principal of principals) {
      await expect(f.service.list(principal)).rejects.toMatchObject({ code: "forbidden" });
    }
    expect(await f.service.list(f.human)).toHaveLength(1);
  });
  it("binds exact versions and reports health without manufacturing host execution", async () => {
    const f = await fixture();
    const created = await f.service.create(f.human, input(f.connectionId));
    const bind = {
      expectedVersion: 1,
      expectedState: "setup_pending",
      hostSurface: "codex_desktop",
      hostAutomationId: "host-schedule",
      nextExpectedAt: "2026-10-09T15:15:00Z",
    };
    await expect(f.service.bind(f.agent, created.schedule.id, bind)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(
      f.service.bind(f.human, created.schedule.id, {
        ...bind,
        nextExpectedAt: "2026-10-09T14:00:00Z",
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      f.service.bind(f.human, created.schedule.id, {
        expectedVersion: 1,
        expectedState: "setup_pending",
        hostSurface: "claude_code_routine",
        hostAutomationId: "routine",
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    const bound = await f.service.bind(f.human, created.schedule.id, bind);
    expect(bound.schedule.state).toBe("active");
    expect(bound.schedule.version).toBe(2);
    await expect(f.service.bind(f.human, created.schedule.id, bind)).rejects.toMatchObject({
      code: "conflict",
    });
    const observation = {
      expectedVersion: 2,
      expectedState: "active",
      hostSurface: "codex_desktop",
      observedState: "active",
      observedAt: now().toISOString(),
      nextExpectedAt: "2026-10-09T15:15:00Z",
    };
    await expect(
      f.service.observe(f.human, created.schedule.id, observation),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      f.service.observe(
        { ...f.agent, authorizationConnectionId: randomUUID() },
        created.schedule.id,
        observation,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      f.service.observe(f.agent, created.schedule.id, {
        ...observation,
        observedAt: "2026-10-09T14:00:00Z",
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    const observed = await f.service.observe(f.agent, created.schedule.id, observation);
    expect(observed.schedule.lastObservedAt).toBe(now().toISOString());
    const paused = await f.service.observe(f.agent, created.schedule.id, {
      ...observation,
      expectedVersion: 3,
      observedState: "paused",
      nextExpectedAt: null,
    });
    expect(paused.health.state).toBe("paused");
    const revoked = await f.service.revoke(f.human, created.schedule.id, {
      expectedVersion: 4,
      expectedState: "paused",
    });
    expect(revoked.health.state).toBe("revoked");
    await expect(f.service.continuations(f.agent, created.schedule.id)).rejects.toMatchObject({
      code: "forbidden",
    });
  });
  it("rejects a malformed Claude trigger ID before binding the schedule", async () => {
    const f = await fixture();
    const created = await f.service.create(f.human, {
      ...input(f.connectionId),
      hostSurface: "claude_code_routine",
      trigger: { type: "event", expectedMaximumLatencyMinutes: 15 },
    });
    const binding = {
      expectedVersion: 1,
      expectedState: "setup_pending",
      hostSurface: "claude_code_routine",
      hostAutomationId: "wrong-routine-id",
    };
    await expect(f.service.bind(f.human, created.schedule.id, binding)).rejects.toMatchObject({
      code: "invalid_request",
    });
    const bound = await f.service.bind(f.human, created.schedule.id, {
      ...binding,
      hostAutomationId: "trig_01ABCDEFGHJKLMNOPQRSTUVW",
    });
    expect(bound.schedule.state).toBe("active");
    expect(bound.schedule.version).toBe(2);
  });
  it("keeps routine tokens encrypted, owner-only and out of public status", async () => {
    const f = await fixture();
    const created = await f.service.create(f.human, {
      ...input(f.connectionId),
      hostSurface: "claude_code_routine",
      trigger: { type: "event", expectedMaximumLatencyMinutes: 15 },
    });
    await f.service.bind(f.human, created.schedule.id, {
      expectedVersion: 1,
      expectedState: "setup_pending",
      hostSurface: "claude_code_routine",
      hostAutomationId: "trig_01ABCDEFGHJKLMNOPQRSTUVW",
    });
    const token = "sk-ant-oat01-abcdefghijklmno";
    await expect(
      f.service.saveFireToken(f.agent, created.schedule.id, token, 2),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      f.service.saveFireToken(f.human, created.schedule.id, "bad-token", 2),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      f.service.saveFireToken(f.human, created.schedule.id, token, 1),
    ).rejects.toMatchObject({ code: "conflict" });
    await f.service.saveFireToken(f.human, created.schedule.id, token, 2);
    expect(JSON.stringify(await f.service.list(f.human))).not.toContain(token);
    const [stored] = await database.db
      .select()
      .from(automationHostSchedules)
      .where(eq(automationHostSchedules.id, created.schedule.id));
    expect(JSON.stringify(stored?.encryptedFireCredentials)).not.toContain(token);
    await database.db
      .update(accessTokens)
      .set({ revokedAt: now() })
      .where(eq(accessTokens.id, f.token.id));
    await expect(
      f.service.observe(f.agent, created.schedule.id, {
        expectedVersion: 3,
        expectedState: "active",
        hostSurface: "claude_code_routine",
        observedState: "active",
        observedAt: now().toISOString(),
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await f.service.connections(f.human)).toEqual([]);
    await f.service.revoke(f.human, created.schedule.id, {
      expectedVersion: 3,
      expectedState: "active",
    });
    const [ended] = await database.db
      .select()
      .from(automationHostSchedules)
      .where(eq(automationHostSchedules.id, created.schedule.id));
    expect(ended?.encryptedFireCredentials).toBeNull();
  });
  it("cancels setup and fences rename and cancellation against stale versions", async () => {
    const f = await fixture();
    const created = await f.service.create(f.human, input(f.connectionId));
    await expect(
      f.service.update(f.agent, created.schedule.id, { expectedVersion: 1, label: "New" }),
    ).rejects.toMatchObject({ code: "forbidden" });
    const updated = await f.service.update(f.human, created.schedule.id, {
      expectedVersion: 1,
      label: "New",
    });
    expect(updated.schedule.label).toBe("New");
    await expect(
      f.service.cancel(f.human, created.schedule.id, {
        expectedVersion: 1,
        expectedState: "setup_pending",
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(
      (
        await f.service.cancel(f.human, created.schedule.id, {
          expectedVersion: 2,
          expectedState: "setup_pending",
        })
      ).schedule.state,
    ).toBe("cancelled");
    await expect(
      f.service.update(f.human, created.schedule.id, { expectedVersion: 3, label: "Again" }),
    ).rejects.toMatchObject({ code: "conflict" });
  });
  async function fireFixture() {
    const f = await fixture();
    const setup = await f.service.create(f.human, {
      ...input(f.connectionId),
      hostSurface: "claude_code_routine",
      trigger: { type: "event", expectedMaximumLatencyMinutes: 15 },
    });
    await f.service.bind(f.human, setup.schedule.id, {
      expectedVersion: 1,
      expectedState: "setup_pending",
      hostSurface: "claude_code_routine",
      hostAutomationId: "trig_01ABCDEFGHJKLMNOPQRSTUVW",
    });
    await f.service.saveFireToken(f.human, setup.schedule.id, "sk-ant-oat01-abcdefghijklmno", 2);
    const [answer] = await database.db
      .insert(financeAnswerContinuations)
      .values({
        userId: f.userId,
        operationId: randomUUID(),
        reviewCaseId: randomUUID(),
        transactionId: randomUUID(),
        resultingWorkRevision: 2n,
        automationScheduleId: setup.schedule.id,
      })
      .returning();
    if (!answer) throw new Error("answer");
    return { ...f, scheduleId: setup.schedule.id, answer };
  }
  async function expiringOAuthGrant(f: Awaited<ReturnType<typeof fireFixture>>) {
    const clientId = randomUUID(),
      refreshToken = randomUUID(),
      resource = "https://nohmi.test/mcp";
    await database.db
      .insert(oauthClients)
      .values({ id: clientId, name: "Routine host", redirectUris: ["https://host.test/callback"] });
    await database.db
      .update(accessTokens)
      .set({ clientId, audience: resource, expiresAt: new Date(now().getTime() - 60_000) })
      .where(eq(accessTokens.id, f.token.id));
    const [refresh] = await database.db
      .insert(oauthRefreshTokens)
      .values({
        accessTokenId: f.token.id,
        clientId,
        userId: f.userId,
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(now().getTime() + 30 * 86_400_000),
      })
      .returning();
    if (!refresh) throw new Error("refresh grant");
    return {
      clientId,
      refreshToken,
      resource,
      refresh,
      oauth: createOAuthService({ db: database.db, now, resource }),
    };
  }
  it("serializes in-flight refresh with revocation and leaves no renewed host grant", async () => {
    const f = await fireFixture();
    const g = await expiringOAuthGrant(f);
    let ready!: () => void, release!: () => void;
    const paused = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const resume = new Promise<void>((resolve) => {
      release = resolve;
    });
    const db = new Proxy(database.db, {
      get(target, key) {
        if (key === "transaction")
          return (fn: Parameters<DatabaseClient["db"]["transaction"]>[0]) =>
            target.transaction((tx) =>
              fn(
                new Proxy(tx, {
                  get(transaction, method) {
                    if (method === "insert")
                      return (table: Parameters<typeof tx.insert>[0]) => {
                        const insert = transaction.insert(table);
                        if (table !== accessTokens) return insert;
                        return new Proxy(insert, {
                          get(builder, operation) {
                            if (operation === "values")
                              return (values: Parameters<typeof insert.values>[0]) => {
                                const query = builder.values(values);
                                return new Proxy(query, {
                                  get(statement, result) {
                                    if (result === "returning")
                                      return async () => {
                                        ready();
                                        await resume;
                                        return statement.returning();
                                      };
                                    const value = Reflect.get(statement, result);
                                    return typeof value === "function"
                                      ? value.bind(statement)
                                      : value;
                                  },
                                });
                              };
                            const value = Reflect.get(builder, operation);
                            return typeof value === "function" ? value.bind(builder) : value;
                          },
                        });
                      };
                    const value = Reflect.get(transaction, method);
                    return typeof value === "function" ? value.bind(transaction) : value;
                  },
                }),
              ),
            );
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const refresh = createOAuthService({ db, now, resource: g.resource }).refresh({
      clientId: g.clientId,
      refreshToken: g.refreshToken,
      resource: g.resource,
    });
    await paused;
    const revocation = g.oauth.revokeAuthorizedClient(f.userId, g.clientId);
    try {
      await vi.waitFor(async () => {
        const result = await database.pool.query(
          "SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted",
        );
        expect(result.rowCount).toBeGreaterThan(0);
      });
    } finally {
      release();
    }
    await refresh;
    await revocation;
    const tokens = await database.db
      .select()
      .from(accessTokens)
      .where(eq(accessTokens.userId, f.userId));
    expect(tokens).toHaveLength(2);
    expect(tokens.every((token) => token.revokedAt !== null)).toBe(true);
    expect(await f.service.connections(f.human)).toEqual([]);
    expect(await f.service.list(f.human)).toMatchObject([{ connectionAvailable: false }]);
    await expect(
      g.oauth.refresh({ clientId: g.clientId, refreshToken: g.refreshToken, resource: g.resource }),
    ).rejects.toMatchObject({ code: "unauthorized" });
  });
  it("fires an idle OAuth host after access expiry and preserves its connection through refresh", async () => {
    const f = await fireFixture();
    const g = await expiringOAuthGrant(f);
    expect(await f.service.connections(f.human)).toMatchObject([{ id: f.connectionId }]);
    expect(await f.service.list(f.human)).toMatchObject([{ connectionAvailable: true }]);
    const fetch = vi.fn(async () =>
      Response.json({ type: "routine_fire", claude_code_session_id: "session_abcdefghijkl" }),
    );
    expect(
      await createFinanceHostDispatcher({ db: database.db, now, encryptionKey, fetch })(),
    ).toEqual({ processed: 1 });
    expect(fetch).toHaveBeenCalledTimes(1);
    await g.oauth.refresh({
      clientId: g.clientId,
      refreshToken: g.refreshToken,
      resource: g.resource,
    });
    const tokens = await database.db
      .select()
      .from(accessTokens)
      .where(eq(accessTokens.userId, f.userId));
    expect(tokens).toHaveLength(2);
    expect(tokens.every((token) => token.authorizationConnectionId === f.connectionId)).toBe(true);
    expect(await f.service.connections(f.human)).toHaveLength(1);
    const run = await waitingRun(f);
    await expect(
      database.db.transaction((tx) => requireHostRunAuthority(tx, run, f.agent, now())),
    ).rejects.toMatchObject({ code: "forbidden" });
    const renewed = tokens.find((token) => token.id !== f.token.id);
    if (!renewed) throw new Error("renewed token");
    await database.db.transaction((tx) =>
      requireHostRunAuthority(tx, run, { ...f.agent, actorId: renewed.id }, now()),
    );
    expect(await f.service.list(f.human)).toMatchObject([{ connectionAvailable: true }]);
    await g.oauth.revokeAuthorizedClient(f.userId, g.clientId);
    expect(await f.service.connections(f.human)).toEqual([]);
    expect(await f.service.list(f.human)).toMatchObject([{ connectionAvailable: false }]);
  });
  it.each([
    "expired",
    "replaced",
    "revoked",
    "foreign_owner",
    "foreign_client",
    "missing_scope",
    "personal_token",
  ] as const)("does not fire an expired bearer with %s refresh authority", async (mode) => {
    const f = await fireFixture();
    const g = await expiringOAuthGrant(f);
    if (mode === "expired")
      await database.db
        .update(oauthRefreshTokens)
        .set({ expiresAt: new Date(now().getTime() - 1) })
        .where(eq(oauthRefreshTokens.id, g.refresh.id));
    if (mode === "replaced")
      await database.db
        .update(oauthRefreshTokens)
        .set({ replacedAt: now() })
        .where(eq(oauthRefreshTokens.id, g.refresh.id));
    if (mode === "revoked") await g.oauth.revokeAuthorizedClient(f.userId, g.clientId);
    if (mode === "foreign_owner") {
      const other = await fixture();
      await database.db
        .update(oauthRefreshTokens)
        .set({ userId: other.userId })
        .where(eq(oauthRefreshTokens.id, g.refresh.id));
    }
    if (mode === "foreign_client") {
      const otherClientId = randomUUID();
      await database.db.insert(oauthClients).values({
        id: otherClientId,
        name: "Other",
        redirectUris: ["https://other.test/callback"],
      });
      await database.db
        .update(oauthRefreshTokens)
        .set({ clientId: otherClientId })
        .where(eq(oauthRefreshTokens.id, g.refresh.id));
    }
    if (mode === "missing_scope")
      await database.db
        .update(accessTokens)
        .set({ scopes: ["finances:read"] })
        .where(eq(accessTokens.id, f.token.id));
    if (mode === "personal_token")
      await database.db
        .update(accessTokens)
        .set({ audience: null, clientId: null })
        .where(eq(accessTokens.id, f.token.id));
    expect(await f.service.connections(f.human)).toEqual([]);
    expect(await f.service.list(f.human)).toMatchObject([{ connectionAvailable: false }]);
    await expect(f.service.create(f.human, input(f.connectionId))).rejects.toMatchObject({
      code: "forbidden",
    });
    const fetch = vi.fn();
    expect(
      await createFinanceHostDispatcher({ db: database.db, now, encryptionKey, fetch })(),
    ).toEqual({ processed: 0 });
    expect(fetch).not.toHaveBeenCalled();
    const [answer] = await database.db
      .select()
      .from(financeAnswerContinuations)
      .where(eq(financeAnswerContinuations.id, f.answer.id));
    expect(answer?.fireState).toBe("pending");
  });
  it("rotates bounded schedule pages past blocked owners and ignores duplicate pending rows", async () => {
    const fixtures = [];
    for (let index = 0; index < 26; index++) fixtures.push(await fireFixture());
    fixtures.sort((left, right) => left.scheduleId.localeCompare(right.scheduleId));
    const healthy = fixtures[25];
    if (!healthy) throw new Error("healthy fixture");
    for (const blocked of fixtures.slice(0, 25)) {
      await database.db.insert(financeAnswerContinuations).values({
        userId: blocked.userId,
        operationId: randomUUID(),
        reviewCaseId: randomUUID(),
        transactionId: randomUUID(),
        resultingWorkRevision: 2n,
        automationScheduleId: blocked.scheduleId,
        fireState: "uncertain",
      });
    }
    const first = fixtures[0];
    if (!first) throw new Error("first fixture");
    await database.db.insert(financeAnswerContinuations).values(
      Array.from({ length: 30 }, () => ({
        userId: first.userId,
        operationId: randomUUID(),
        reviewCaseId: randomUUID(),
        transactionId: randomUUID(),
        resultingWorkRevision: 2n,
        automationScheduleId: first.scheduleId,
      })),
    );
    const fetch = vi.fn(async () =>
      Response.json({
        type: "routine_fire",
        claude_code_session_id: "session_01HJKLMNOPQRSTUVWXYZ",
      }),
    );
    const dispatch = createFinanceHostDispatcher({ db: database.db, now, encryptionKey, fetch });
    expect(await dispatch()).toEqual({ processed: 1 });
    expect(await dispatch()).toEqual({ processed: 0 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(
      (
        await database.db
          .select()
          .from(financeAnswerContinuations)
          .where(eq(financeAnswerContinuations.id, healthy.answer.id))
      )[0]?.fireState,
    ).toBe("accepted");
    expect(await dispatch()).toEqual({ processed: 0 });
  }, 30_000);
  it.each([
    "timeout",
    "malformed",
    "oversized",
    "rejected",
  ] as const)("retains %s delivery outcome without a second routine fire", async (mode) => {
    const f = await fireFixture();
    const fetch = vi.fn(async () => {
      if (mode === "timeout") throw new Error("lost response");
      if (mode === "rejected") return new Response("denied", { status: 403 });
      if (mode === "oversized") return new Response("x".repeat(16385));
      return Response.json({ type: "wrong" });
    });
    const log = vi.fn();
    const dispatch = createFinanceHostDispatcher({
      db: database.db,
      now,
      encryptionKey,
      fetch,
      log,
    });
    expect(await dispatch()).toEqual({ processed: 1 });
    expect(await dispatch()).toEqual({ processed: 0 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "finance_host_handoff",
        requestId: f.answer.id,
        claimCount: 1,
        hostOutcome: mode === "rejected" ? "unavailable" : "uncertain",
        code:
          mode === "timeout"
            ? "transport_uncertain"
            : mode === "rejected"
              ? "provider_rejected"
              : "invalid_response",
        durationMs: expect.any(Number),
      }),
    );
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/sk-ant|routine_fire|denied|lost response/);
    const [answer] = await database.db
      .select()
      .from(financeAnswerContinuations)
      .where(eq(financeAnswerContinuations.id, f.answer.id));
    expect(answer).toMatchObject({
      state: "pending",
      fireState: mode === "rejected" ? "unavailable" : "uncertain",
      hostSessionId: null,
    });
  });
  it.each([
    "server_error",
    "empty_body",
    "null_payload",
    "missing_session",
    "numeric_session",
    "invalid_session",
    "broken_json",
  ])("keeps %s host delivery uncertain and never repeats the fire", async (mode) => {
    const f = await fireFixture();
    const fetch = vi.fn(async () => {
      if (mode === "server_error") return new Response("unavailable", { status: 500 });
      if (mode === "empty_body") return new Response(null);
      if (mode === "null_payload") return Response.json(null);
      if (mode === "missing_session") return Response.json({ type: "routine_fire" });
      if (mode === "numeric_session")
        return Response.json({ type: "routine_fire", claude_code_session_id: 12 });
      if (mode === "invalid_session")
        return Response.json({ type: "routine_fire", claude_code_session_id: "wrong_identifier" });
      return new Response("not JSON");
    });
    const dispatch = createFinanceHostDispatcher({ db: database.db, now, encryptionKey, fetch });
    expect(await dispatch()).toEqual({ processed: 1 });
    expect(await dispatch()).toEqual({ processed: 0 });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [saved] = await database.db
      .select()
      .from(financeAnswerContinuations)
      .where(eq(financeAnswerContinuations.id, f.answer.id));
    expect(saved).toMatchObject({ state: "pending", fireState: "uncertain", hostSessionId: null });
  });
  it("commits a successful host handoff even when its diagnostic logger fails", async () => {
    const f = await fireFixture();
    const fetch = vi.fn(async () =>
      Response.json({ type: "routine_fire", claude_code_session_id: "session_abcdefghijkl" }),
    );
    const dispatch = createFinanceHostDispatcher({
      db: database.db,
      now,
      encryptionKey,
      fetch,
      log: () => {
        throw new Error("logger unavailable");
      },
    });
    expect(await dispatch()).toEqual({ processed: 1 });
    expect(await dispatch()).toEqual({ processed: 0 });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [saved] = await database.db
      .select()
      .from(financeAnswerContinuations)
      .where(eq(financeAnswerContinuations.id, f.answer.id));
    expect(saved).toMatchObject({ fireState: "accepted", hostSessionId: "session_abcdefghijkl" });
  });
  it("does not fire revoked grants and leaves shutdown claims visibly unavailable", async () => {
    const f = await fireFixture();
    await database.db
      .update(accessTokens)
      .set({ revokedAt: now() })
      .where(eq(accessTokens.id, f.token.id));
    const fetch = vi.fn(async () => Response.json({}));
    const dispatch = createFinanceHostDispatcher({ db: database.db, now, encryptionKey, fetch });
    expect(await dispatch()).toEqual({ processed: 0 });
    await database.db
      .update(accessTokens)
      .set({ revokedAt: null })
      .where(eq(accessTokens.id, f.token.id));
    let checks = 0;
    expect(await dispatch(() => ++checks === 1)).toEqual({ processed: 1 });
    expect(fetch).not.toHaveBeenCalled();
    expect(
      (
        await database.db
          .select()
          .from(financeAnswerContinuations)
          .where(eq(financeAnswerContinuations.id, f.answer.id))
      )[0]?.fireState,
    ).toBe("unavailable");
  });
  it("fires one case at a time and starts the pending sibling only after the observed run settles", async () => {
    const f = await fireFixture();
    await database.db.insert(financeAnswerContinuations).values({
      ...f.answer,
      id: randomUUID(),
      operationId: randomUUID(),
      reviewCaseId: randomUUID(),
    });
    const fetch = vi.fn(async () =>
      Response.json({ type: "routine_fire", claude_code_session_id: "session_abcdefghijkl" }),
    );
    const dispatch = createFinanceHostDispatcher({ db: database.db, now, encryptionKey, fetch });
    expect(await dispatch()).toEqual({ processed: 1 });
    const rows = await database.db
      .select()
      .from(financeAnswerContinuations)
      .where(eq(financeAnswerContinuations.userId, f.userId));
    const submitted = rows.find((row) => row.fireState === "accepted");
    if (!submitted) throw new Error("submitted");
    expect(rows.filter((row) => row.fireState === "pending")).toHaveLength(1);
    const run = await waitingRun(f);
    await database.db
      .update(workspaceMaintenanceRuns)
      .set({
        scope: { type: "target", entityType: "finance_review_case", id: submitted.reviewCaseId },
      })
      .where(eq(workspaceMaintenanceRuns.id, run.id));
    await database.db
      .update(financeAnswerContinuations)
      .set({ state: "accepted", maintenanceRunId: run.id })
      .where(eq(financeAnswerContinuations.id, submitted.id));
    expect(await dispatch()).toEqual({ processed: 0 });
    expect(fetch).toHaveBeenCalledTimes(1);
    await database.db
      .update(workspaceMaintenanceRuns)
      .set({ status: "completed" })
      .where(eq(workspaceMaintenanceRuns.id, run.id));
    expect(await dispatch()).toEqual({ processed: 1 });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(
      (
        await database.db
          .select()
          .from(financeAnswerContinuations)
          .where(eq(financeAnswerContinuations.id, submitted.id))
      )[0]?.state,
    ).toBe("completed");
  });
  it("wakes the same original waiting case for a new answer without dispatching an unrelated case", async () => {
    const f = await fireFixture();
    const fetch = vi.fn(async () =>
      Response.json({ type: "routine_fire", claude_code_session_id: "session_abcdefghijkl" }),
    );
    const dispatch = createFinanceHostDispatcher({ db: database.db, now, encryptionKey, fetch });
    expect(await dispatch()).toEqual({ processed: 1 });
    const run = await waitingRun(f);
    await database.db
      .update(workspaceMaintenanceRuns)
      .set({
        scope: { type: "target", entityType: "finance_review_case", id: f.answer.reviewCaseId },
      })
      .where(eq(workspaceMaintenanceRuns.id, run.id));
    await database.db
      .update(financeAnswerContinuations)
      .set({ state: "accepted", maintenanceRunId: run.id })
      .where(eq(financeAnswerContinuations.id, f.answer.id));
    const unrelatedId = randomUUID();
    await database.db.insert(financeAnswerContinuations).values({
      ...f.answer,
      id: unrelatedId,
      operationId: randomUUID(),
      reviewCaseId: randomUUID(),
      createdAt: new Date(f.answer.createdAt.getTime() - 1000),
    });
    await database.db
      .insert(financeAnswerContinuations)
      .values({ ...f.answer, id: randomUUID(), operationId: randomUUID() });
    expect(await dispatch()).toEqual({ processed: 1 });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(
      (
        await database.db
          .select()
          .from(financeAnswerContinuations)
          .where(eq(financeAnswerContinuations.id, unrelatedId))
      )[0]?.fireState,
    ).toBe("pending");
  });
  it("lets a human recover a never-submitted answer from a revoked host without retrying uncertain delivery", async () => {
    const f = await fireFixture();
    await f.service.revoke(f.human, f.scheduleId, {
      expectedVersion: 3,
      expectedState: "active",
    });
    const next = await f.service.create(f.human, input(f.connectionId));
    const bound = await f.service.bind(f.human, next.schedule.id, {
      expectedVersion: 1,
      expectedState: "setup_pending",
      hostSurface: "codex_desktop",
      hostAutomationId: "replacement-host",
      nextExpectedAt: "2026-10-09T15:15:00Z",
    });
    expect(await f.service.bindAnswer(f.human, f.answer.id, bound.schedule.id)).toEqual({
      id: f.answer.id,
    });
    for (const state of ["submitting", "uncertain", "accepted"] as const) {
      await database.db
        .update(financeAnswerContinuations)
        .set({ fireState: state })
        .where(eq(financeAnswerContinuations.id, f.answer.id));
      await expect(
        f.service.bindAnswer(f.human, f.answer.id, bound.schedule.id),
      ).rejects.toMatchObject({ code: "conflict" });
    }
  });
  it("requires the saved host connection even for same-owner run resume and challenge authority", async () => {
    const f = await fireFixture();
    const [run] = await database.db
      .insert(workspaceMaintenanceRuns)
      .values({
        userId: f.userId,
        domain: "finances",
        scope: { type: "all_outstanding" },
        rulebookVersion: "test",
        authorizationConnectionId: f.connectionId,
        automationScheduleId: f.scheduleId,
      })
      .returning();
    if (!run) throw new Error("run");
    await database.db.transaction((tx) => requireHostRunAuthority(tx, run, f.agent, now()));
    await expect(
      database.db.transaction((tx) =>
        requireHostRunAuthority(
          tx,
          run,
          { ...f.agent, authorizationConnectionId: randomUUID() },
          now(),
        ),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    await database.db
      .update(accessTokens)
      .set({ revokedAt: now() })
      .where(eq(accessTokens.id, f.token.id));
    await expect(
      database.db.transaction((tx) => requireHostRunAuthority(tx, run, f.agent, now())),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
  it("recovers an inspected lost session after its deadline without repeating a completed sibling", async () => {
    const f = await fireFixture();
    const siblings = await database.db
      .insert(financeAnswerContinuations)
      .values([
        { ...f.answer, id: randomUUID(), operationId: randomUUID() },
        { ...f.answer, id: randomUUID(), operationId: randomUUID() },
      ])
      .returning();
    const [completed, waiting] = siblings;
    if (!completed || !waiting) throw new Error("siblings");
    const fetch = vi.fn(async () =>
      Response.json({ type: "routine_fire", claude_code_session_id: "session_abcdefghijkl" }),
    );
    const log = vi.fn(() => {
      throw new Error("logger unavailable");
    });
    const dispatch = createFinanceHostDispatcher({
      db: database.db,
      now,
      encryptionKey,
      fetch,
      log,
    });
    // Reproduce retained coalesced evidence from an earlier process; no silent replay is allowed.
    await database.db
      .update(financeAnswerContinuations)
      .set({ fireState: "accepted", hostSessionId: "session_abcdefghijkl" })
      .where(eq(financeAnswerContinuations.userId, f.userId));
    const [submitted] = await database.db
      .select()
      .from(financeAnswerContinuations)
      .where(eq(financeAnswerContinuations.id, f.answer.id));
    if (!submitted) throw new Error("submitted");
    await expect(
      f.service.reconcileDelivery(f.human, submitted.id, {
        expectedUpdatedAt: submitted.updatedAt.toISOString(),
        hostChecked: true,
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    const run = await waitingRun(f);
    await database.db
      .update(workspaceMaintenanceRuns)
      .set({ status: "completed" })
      .where(eq(workspaceMaintenanceRuns.id, run.id));
    await database.db
      .update(financeAnswerContinuations)
      .set({ state: "accepted", maintenanceRunId: run.id })
      .where(eq(financeAnswerContinuations.id, completed.id));
    const stale = new Date(now().getTime() - 16 * 60_000);
    await database.db
      .update(financeAnswerContinuations)
      .set({ updatedAt: stale })
      .where(eq(financeAnswerContinuations.userId, f.userId));
    await expect(
      f.service.reconcileDelivery(f.human, completed.id, {
        expectedUpdatedAt: stale.toISOString(),
        hostChecked: true,
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    for (const row of [f.answer, waiting]) {
      await f.service.reconcileDelivery(f.human, row.id, {
        expectedUpdatedAt: stale.toISOString(),
        hostChecked: true,
      });
      await f.service.bindAnswer(f.human, row.id, f.scheduleId);
      if (row.id === f.answer.id) expect(await dispatch()).toEqual({ processed: 0 });
    }
    expect(await dispatch()).toEqual({ processed: 1 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenLastCalledWith(
      expect.objectContaining({ hostOutcome: "accepted", claimCount: 1 }),
    );
    const [preserved] = await database.db
      .select()
      .from(financeAnswerContinuations)
      .where(eq(financeAnswerContinuations.id, completed.id));
    expect(preserved).toMatchObject({ state: "completed", maintenanceRunId: run.id });
  });

  async function waitingRun(f: Awaited<ReturnType<typeof fireFixture>>) {
    const [run] = await database.db
      .insert(workspaceMaintenanceRuns)
      .values({
        userId: f.userId,
        domain: "finances",
        scope: { type: "all_outstanding" },
        rulebookVersion: "test",
        status: "awaiting_agent_challenge",
        automationScheduleId: f.scheduleId,
        authorizationConnectionId: f.connectionId,
        checkpoint: { saved: "evidence" },
      })
      .returning();
    if (!run) throw new Error("run");
    return run;
  }
  it.each([
    "completed",
    "completed_with_questions",
    "failed_terminal",
  ] as const)("projects a %s run independently of the continue entry point and frees the routine", async (status) => {
    const f = await fireFixture();
    const run = await waitingRun(f);
    await database.db
      .update(financeAnswerContinuations)
      .set({ state: "accepted", fireState: "accepted", maintenanceRunId: run.id })
      .where(eq(financeAnswerContinuations.id, f.answer.id));
    await database.db
      .update(workspaceMaintenanceRuns)
      .set({ status })
      .where(eq(workspaceMaintenanceRuns.id, run.id));
    await reconcileFinanceContinuations(database.db, now(), f.userId);
    const [answer] = await database.db
      .select()
      .from(financeAnswerContinuations)
      .where(eq(financeAnswerContinuations.id, f.answer.id));
    expect(answer?.state).toBe(status === "failed_terminal" ? "unavailable" : "completed");
    expect((await f.service.continuations(f.agent, f.scheduleId)).continuations).toHaveLength(0);
  });
  it("projects stale submitting claims as uncertain and requires explicit human inspection before refire", async () => {
    const f = await fireFixture();
    const fetch = vi.fn(async () =>
      Response.json({ type: "routine_fire", claude_code_session_id: "session_abcdefghijkl" }),
    ) as unknown as typeof globalThis.fetch;
    await database.db
      .update(financeAnswerContinuations)
      .set({ fireState: "submitting", updatedAt: new Date(now().getTime() - 120001) })
      .where(eq(financeAnswerContinuations.id, f.answer.id));
    const dispatch = createFinanceHostDispatcher({ db: database.db, now, encryptionKey, fetch });
    expect(await dispatch()).toEqual({ processed: 0 });
    expect(fetch).not.toHaveBeenCalled();
    const [answer] = await database.db
      .select()
      .from(financeAnswerContinuations)
      .where(eq(financeAnswerContinuations.id, f.answer.id));
    if (!answer) throw new Error("answer");
    expect(answer.fireState).toBe("uncertain");
    await expect(
      f.service.reconcileDelivery(f.agent, answer.id, {
        expectedUpdatedAt: answer.updatedAt.toISOString(),
        hostChecked: true,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(f.service.bindAnswer(f.human, answer.id, f.scheduleId)).rejects.toMatchObject({
      code: "conflict",
    });
    await f.service.reconcileDelivery(f.human, answer.id, {
      expectedUpdatedAt: answer.updatedAt.toISOString(),
      hostChecked: true,
    });
    await expect(
      f.service.reconcileDelivery(f.human, answer.id, {
        expectedUpdatedAt: answer.updatedAt.toISOString(),
        hostChecked: true,
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    await f.service.bindAnswer(f.human, answer.id, f.scheduleId);
    expect(await dispatch()).toEqual({ processed: 1 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([
    "revoked_grant",
    "cancelled_schedule",
    "claimed_elsewhere",
    "completed_elsewhere",
  ] as const)("fences %s committed between claim preparation and host transport", async (mode) => {
    const f = await fireFixture();
    let transactions = 0;
    const db = new Proxy(database.db, {
      get(target, key) {
        if (key === "transaction")
          return async (fn: Parameters<DatabaseClient["db"]["transaction"]>[0]) => {
            const result = await target.transaction(fn);
            if (++transactions === 1) {
              if (mode === "revoked_grant")
                await target
                  .update(accessTokens)
                  .set({ revokedAt: now() })
                  .where(eq(accessTokens.id, f.token.id));
              if (mode === "cancelled_schedule")
                await f.service.revoke(f.human, f.scheduleId, {
                  expectedVersion: 3,
                  expectedState: "active",
                });
              if (mode === "claimed_elsewhere")
                await target
                  .update(financeAnswerContinuations)
                  .set({ fireState: "uncertain" })
                  .where(eq(financeAnswerContinuations.id, f.answer.id));
              if (mode === "completed_elsewhere")
                await target
                  .update(financeAnswerContinuations)
                  .set({ state: "completed" })
                  .where(eq(financeAnswerContinuations.id, f.answer.id));
            }
            return result;
          };
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const fetch = vi.fn(async () =>
      Response.json({ type: "routine_fire", claude_code_session_id: "session_abcdefghijkl" }),
    );
    const log = vi.fn();
    expect(await createFinanceHostDispatcher({ db, now, encryptionKey, fetch, log })()).toEqual({
      processed: 1,
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        hostOutcome: "unavailable",
        code:
          mode === "claimed_elsewhere" || mode === "completed_elsewhere"
            ? "claim_changed"
            : "authority_changed",
      }),
    );
    const [saved] = await database.db
      .select()
      .from(financeAnswerContinuations)
      .where(eq(financeAnswerContinuations.id, f.answer.id));
    expect(saved?.hostSessionId).toBeNull();
    expect(saved?.fireState).toBe(mode === "claimed_elsewhere" ? "uncertain" : "unavailable");
    if (mode === "completed_elsewhere") expect(saved?.state).toBe("completed");
  });
  it.each([
    "revoked_grant",
    "paused_schedule",
    "other_run",
    "other_handoff",
  ] as const)("rechecks %s arriving after the dispatcher scan before claiming", async (mode) => {
    const f = await fireFixture();
    let first = true;
    const db = new Proxy(database.db, {
      get(target, key) {
        if (key === "transaction")
          return async (fn: Parameters<DatabaseClient["db"]["transaction"]>[0]) => {
            if (first) {
              first = false;
              if (mode === "revoked_grant")
                await target
                  .update(accessTokens)
                  .set({ revokedAt: now() })
                  .where(eq(accessTokens.id, f.token.id));
              if (mode === "paused_schedule") {
                const [saved] = await target
                  .select()
                  .from(automationHostSchedules)
                  .where(eq(automationHostSchedules.id, f.scheduleId));
                if (
                  saved?.schedule.hostSurface !== "claude_code_routine" ||
                  saved.schedule.state !== "active"
                )
                  throw new Error("schedule");
                await target
                  .update(automationHostSchedules)
                  .set({ schedule: { ...saved.schedule, state: "paused" } })
                  .where(eq(automationHostSchedules.id, f.scheduleId));
              }
              if (mode === "other_run") await waitingRun(f);
              if (mode === "other_handoff")
                await target.insert(financeAnswerContinuations).values({
                  ...f.answer,
                  id: randomUUID(),
                  operationId: randomUUID(),
                  fireState: "uncertain",
                });
            }
            return target.transaction(fn);
          };
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const fetch = vi.fn();
    expect(await createFinanceHostDispatcher({ db, now, encryptionKey, fetch })()).toEqual({
      processed: 0,
    });
    expect(fetch).not.toHaveBeenCalled();
    const [answer] = await database.db
      .select()
      .from(financeAnswerContinuations)
      .where(eq(financeAnswerContinuations.id, f.answer.id));
    expect(answer?.fireState).toBe("pending");
    expect(answer?.hostSessionId).toBeNull();
  });
  it.each([
    "entity",
    "case",
    "schedule",
    "connection",
    "running",
  ] as const)("blocks a newly arrived run with mismatched %s before firing the host", async (mode) => {
    const f = await fireFixture();
    let first = true;
    const db = new Proxy(database.db, {
      get(target, key) {
        if (key === "transaction")
          return async (fn: Parameters<DatabaseClient["db"]["transaction"]>[0]) => {
            if (first) {
              first = false;
              const run = await waitingRun(f);
              await target
                .update(workspaceMaintenanceRuns)
                .set({
                  scope: {
                    type: "target",
                    entityType: mode === "entity" ? "finance_transaction" : "finance_review_case",
                    id: mode === "case" ? randomUUID() : f.answer.reviewCaseId,
                  },
                  automationScheduleId: mode === "schedule" ? null : f.scheduleId,
                  authorizationConnectionId: mode === "connection" ? randomUUID() : f.connectionId,
                  status: mode === "running" ? "running" : "awaiting_agent_challenge",
                  leaseClaimId: mode === "running" ? randomUUID() : null,
                  leaseExpiresAt: mode === "running" ? new Date(now().getTime() + 60_000) : null,
                })
                .where(eq(workspaceMaintenanceRuns.id, run.id));
            }
            return target.transaction(fn);
          };
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const fetch = vi.fn();
    expect(await createFinanceHostDispatcher({ db, now, encryptionKey, fetch })()).toEqual({
      processed: 0,
    });
    expect(fetch).not.toHaveBeenCalled();
    const [saved] = await database.db
      .select()
      .from(financeAnswerContinuations)
      .where(eq(financeAnswerContinuations.id, f.answer.id));
    expect(saved?.fireState).toBe("pending");
    expect(saved?.hostSessionId).toBeNull();
  });
  it("leaves a locked owner's handoff pending for a later dispatcher pass", async () => {
    const f = await fireFixture();
    const held = await database.pool.connect();
    const fetch = vi.fn(async () =>
      Response.json({ type: "routine_fire", claude_code_session_id: "session_abcdefghijkl" }),
    );
    const dispatch = createFinanceHostDispatcher({ db: database.db, now, encryptionKey, fetch });
    try {
      await held.query("BEGIN");
      await held.query("SELECT id FROM users WHERE id=$1 FOR NO KEY UPDATE", [f.userId]);
      expect(await dispatch()).toEqual({ processed: 0 });
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      await held.query("ROLLBACK");
      held.release();
    }
    expect(await dispatch()).toEqual({ processed: 1 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("refuses a decryptable credential with an invalid provider token without a network attempt", async () => {
    const f = await fireFixture();
    await database.db
      .update(automationHostSchedules)
      .set({ encryptedFireCredentials: encryptJson({ token: "invalid" }, encryptionKey) })
      .where(eq(automationHostSchedules.id, f.scheduleId));
    const fetch = vi.fn();
    expect(
      await createFinanceHostDispatcher({ db: database.db, now, encryptionKey, fetch })(),
    ).toEqual({ processed: 0 });
    expect(fetch).not.toHaveBeenCalled();
    const [saved] = await database.db
      .select()
      .from(financeAnswerContinuations)
      .where(eq(financeAnswerContinuations.id, f.answer.id));
    expect(saved?.fireState).toBe("unavailable");
  });
  it("isolates an unreadable routine credential and continues other owners", async () => {
    const bad = await fireFixture();
    const good = await fireFixture();
    await database.db
      .update(automationHostSchedules)
      .set({
        encryptedFireCredentials: encryptJson(
          { token: "sk-ant-oat01-abcdefghijklmno" },
          Buffer.alloc(32, 99).toString("base64"),
        ),
      })
      .where(eq(automationHostSchedules.id, bad.scheduleId));
    const fetch = vi.fn(async () =>
      Response.json({ type: "routine_fire", claude_code_session_id: "session_abcdefghijkl" }),
    ) as unknown as typeof globalThis.fetch;
    expect(
      await createFinanceHostDispatcher({ db: database.db, now, encryptionKey, fetch })(),
    ).toEqual({ processed: 1 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(
      (
        await database.db
          .select()
          .from(financeAnswerContinuations)
          .where(eq(financeAnswerContinuations.id, bad.answer.id))
      )[0]?.fireState,
    ).toBe("unavailable");
    expect(
      (
        await database.db
          .select()
          .from(financeAnswerContinuations)
          .where(eq(financeAnswerContinuations.id, good.answer.id))
      )[0]?.fireState,
    ).toBe("accepted");
  });
  it("reconciles every un-fired claim when host polling accepts one in the dispatch gap", async () => {
    const f = await fireFixture();
    const run = await waitingRun(f);
    await database.db
      .insert(financeAnswerContinuations)
      .values({ ...f.answer, id: randomUUID(), operationId: randomUUID() });
    let transactions = 0;
    const db = new Proxy(database.db, {
      get(target, key) {
        if (key === "transaction")
          return async (fn: Parameters<DatabaseClient["db"]["transaction"]>[0]) => {
            const result = await target.transaction(fn);
            if (++transactions === 1)
              await target
                .update(financeAnswerContinuations)
                .set({ state: "accepted", maintenanceRunId: run.id })
                .where(eq(financeAnswerContinuations.id, f.answer.id));
            return result;
          };
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const fetch = vi.fn(async () => Response.json({}));
    await createFinanceHostDispatcher({ db, now, encryptionKey, fetch })();
    expect(fetch).not.toHaveBeenCalled();
    const answers = await database.db
      .select()
      .from(financeAnswerContinuations)
      .where(eq(financeAnswerContinuations.userId, f.userId));
    expect(answers).toHaveLength(2);
    expect(answers.every((answer) => answer.fireState === "pending")).toBe(true);
  });
  it("lets only a human move an idle revoked-host run while preserving its checkpoint and fencing execution", async () => {
    const f = await fireFixture();
    const run = await waitingRun(f);
    await f.service.revoke(f.human, f.scheduleId, { expectedVersion: 3, expectedState: "active" });
    const connectionId = randomUUID();
    const [token] = await database.db
      .insert(accessTokens)
      .values({
        userId: f.userId,
        name: "Replacement",
        authorizationConnectionId: connectionId,
        tokenHash: randomUUID(),
        scopes: ["finances:maintain"],
        expiresAt: new Date(now().getTime() + 86400000),
      })
      .returning();
    if (!token) throw new Error("token");
    const setup = await f.service.create(f.human, input(connectionId));
    await f.service.bind(f.human, setup.schedule.id, {
      expectedVersion: 1,
      expectedState: "setup_pending",
      hostSurface: "codex_desktop",
      hostAutomationId: "replacement",
      nextExpectedAt: "2026-10-09T15:15:00Z",
    });
    const recovery = {
      scheduleId: setup.schedule.id,
      expectedScheduleId: f.scheduleId,
      expectedConnectionId: f.connectionId,
      expectedUpdatedAt: run.updatedAt.toISOString(),
      hostChecked: true,
    };
    const eventSetup = await f.service.create(f.human, {
      ...input(connectionId),
      hostSurface: "claude_code_routine",
      trigger: { type: "event", expectedMaximumLatencyMinutes: 15 },
    });
    await f.service.bind(f.human, eventSetup.schedule.id, {
      expectedVersion: 1,
      expectedState: "setup_pending",
      hostSurface: "claude_code_routine",
      hostAutomationId: "trig_01ABCDEFGHJKLMNOPQRSTUVW",
    });
    await expect(
      f.service.recoverHostRun(f.human, run.id, {
        ...recovery,
        scheduleId: eventSetup.schedule.id,
      }),
    ).rejects.toThrow("Choose a polling Codex host");
    await expect(f.service.recoverHostRun(f.agent, run.id, recovery)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(
      f.service.recoverHostRun(f.human, run.id, {
        ...recovery,
        expectedUpdatedAt: "2026-01-01T00:00:00Z",
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    await database.db
      .update(workspaceMaintenanceRuns)
      .set({
        status: "running",
        leaseClaimId: randomUUID(),
        leaseExpiresAt: new Date(now().getTime() + 120000),
      })
      .where(eq(workspaceMaintenanceRuns.id, run.id));
    await expect(f.service.recoverHostRun(f.human, run.id, recovery)).rejects.toMatchObject({
      code: "conflict",
    });
    await database.db
      .update(workspaceMaintenanceRuns)
      .set({ status: "awaiting_agent_challenge", leaseClaimId: null, leaseExpiresAt: null })
      .where(eq(workspaceMaintenanceRuns.id, run.id));
    await f.service.recoverHostRun(f.human, run.id, recovery);
    const [rebound] = await database.db
      .select()
      .from(workspaceMaintenanceRuns)
      .where(eq(workspaceMaintenanceRuns.id, run.id));
    if (!rebound) throw new Error("run");
    expect(rebound.checkpoint).toEqual(run.checkpoint);
    expect(rebound.status).toBe(run.status);
    await database.db.transaction((tx) =>
      requireHostRunAuthority(
        tx,
        rebound,
        { ...f.agent, actorId: token.id, authorizationConnectionId: connectionId },
        now(),
      ),
    );
    await expect(
      database.db.transaction((tx) => requireHostRunAuthority(tx, rebound, f.agent, now())),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
  it("pages past 100 pending answers with exact database cursor precision and rejects foreign cursors", async () => {
    const f = await fireFixture();
    await database.db.insert(financeAnswerContinuations).values(
      Array.from({ length: 101 }, () => ({
        ...f.answer,
        id: randomUUID(),
        operationId: randomUUID(),
      })),
    );
    await database.db.execute(
      sql`UPDATE finance_answer_continuations SET created_at='2026-10-09 15:00:00.000123+00' WHERE user_id=${f.userId}::uuid`,
    );
    const first = await f.service.continuations(f.agent, f.scheduleId);
    expect(first.continuations).toHaveLength(100);
    expect(first.hasMore).toBe(true);
    const second = await f.service.continuations(
      f.agent,
      f.scheduleId,
      first.nextCursor ?? undefined,
    );
    expect(second.continuations).toHaveLength(2);
    expect(second.hasMore).toBe(false);
    expect(
      new Set([...first.continuations, ...second.continuations].map((row) => row.id)).size,
    ).toBe(102);
    const humanFirst = await f.service.pendingAnswers(f.human);
    expect(humanFirst.continuations).toHaveLength(100);
    const humanSecond = await f.service.pendingAnswers(f.human, humanFirst.nextCursor ?? undefined);
    expect(humanSecond.continuations).toHaveLength(2);
    expect(humanSecond.nextCursor).toBeNull();
    expect(
      new Set([...humanFirst.continuations, ...humanSecond.continuations].map((row) => row.id))
        .size,
    ).toBe(102);
    await expect(f.service.pendingAnswers(f.agent)).rejects.toMatchObject({ code: "forbidden" });
    const other = await fireFixture();
    await expect(
      f.service.continuations(f.agent, f.scheduleId, other.answer.id),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(f.service.pendingAnswers(f.human, other.answer.id)).rejects.toMatchObject({
      code: "invalid_request",
    });
  });
});
