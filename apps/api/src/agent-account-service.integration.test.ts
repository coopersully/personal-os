import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  accessTokens,
  agentAccountConnections,
  agentAccounts,
  auditEvents,
  createDatabaseClient,
  type DatabaseClient,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { and, eq, sql } from "drizzle-orm";
import { createAgentAccountService, ensureAgentAccount } from "./agent-account-service.js";
import type { Principal } from "./types.js";

describe.sequential("shared agent account identities", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  const now = () => new Date("2026-10-24T15:00:00Z");
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
      connectionId = randomUUID(),
      actorId = randomUUID();
    await database.db.insert(users).values({
      id: userId,
      email: `${userId}@example.test`,
      displayName: "Owner",
      passwordHash: "unused",
    });
    await database.db.insert(accessTokens).values({
      id: actorId,
      userId,
      authorizationConnectionId: connectionId,
      name: "Claude Code",
      tokenHash: randomUUID(),
      scopes: ["finances:maintain"],
    });
    const human: Principal = { userId, actorId: userId, actorType: "user", scopes: new Set() };
    const agent: Principal = {
      userId,
      actorId,
      actorType: "agent",
      authorizationConnectionId: connectionId,
      scopes: new Set(["finances:maintain"]),
    };
    return {
      human,
      agent,
      connectionId,
      service: createAgentAccountService({ db: database.db, now }),
    };
  }
  it("registers once under concurrent calls and ignores account-id spoofing", async () => {
    const f = await fixture();
    expect(await f.service.current(f.agent)).toBeNull();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => f.service.register(f.agent, { platform: "claude" })),
    );
    expect(new Set(results.map((a) => a.id)).size).toBe(1);
    expect(results[0]).toMatchObject({
      platform: "claude",
      identitySource: "connection",
      avatarVersion: 1,
    });
    expect((await f.service.list(f.human)).accounts).toHaveLength(1);
    expect(
      await database.db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.action, "agent_account.registered")),
    ).toHaveLength(1);
    await expect(f.service.register(f.agent, { agentAccountId: randomUUID() })).rejects.toThrow();
    await expect(f.service.register(f.human, {})).rejects.toMatchObject({ code: "forbidden" });
  });
  it.each([
    "codex",
    "unknown",
  ] as const)("preserves an owner's concurrent %s correction and returns the committed profile", async (platform) => {
    const f = await fixture();
    const account = await f.service.register(f.agent, {});
    let registration: ReturnType<typeof f.service.register> | undefined;
    try {
      await database.db.transaction(async (tx) => {
        // Keep the real owner update uncommitted: registration reads the old
        // unknown profile, then waits on its UPDATE until this transaction commits.
        const owner = createAgentAccountService({ db: tx, now });
        await owner.update(f.human, account.id, { platform });
        registration = f.service.register(f.agent, { platform: "claude" });
        await vi.waitFor(async () => {
          const waiting = await database.pool.query(
            "SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE 'update \"agent_accounts\"%'",
          );
          expect(waiting.rowCount).toBe(1);
        });
      });
      expect(await registration).toMatchObject({
        id: account.id,
        platform,
        identitySource: "user_confirmed",
      });
      expect(await f.service.current(f.agent)).toMatchObject({
        platform,
        identitySource: "user_confirmed",
      });
    } finally {
      await registration;
    }
  });
  it("accepts one platform declaration but never replaces a known or owner-confirmed platform", async () => {
    const f = await fixture();
    const account = await f.service.register(f.agent, {});
    expect(await f.service.register(f.agent, { platform: "claude" })).toMatchObject({
      id: account.id,
      platform: "claude",
      identitySource: "connection",
    });
    for (const platform of ["codex", "other", "unknown"] as const)
      expect(await f.service.register(f.agent, { platform })).toMatchObject({
        id: account.id,
        platform: "claude",
      });
    for (const platform of ["codex", "unknown"] as const) {
      await f.service.update(f.human, account.id, { platform });
      for (const declaration of ["claude", "codex", "other"] as const)
        expect(await f.service.register(f.agent, { platform: declaration })).toMatchObject({
          id: account.id,
          platform,
          identitySource: "user_confirmed",
        });
      expect(await f.service.current(f.agent)).toMatchObject({
        platform,
        identitySource: "user_confirmed",
      });
    }
  });
  it.each([
    "register",
    "link",
  ] as const)("serializes first registration against owner linking with %s queued first", async (first) => {
    const f = await fixture();
    const target = await f.service.register(f.agent, { platform: "claude" });
    const connectionId = randomUUID();
    const [token] = await database.db
      .insert(accessTokens)
      .values({
        userId: f.human.userId,
        authorizationConnectionId: connectionId,
        tokenHash: randomUUID(),
        name: "Second surface",
        scopes: ["mail:read"],
      })
      .returning();
    if (!token) throw new Error("token");
    const agent: Principal = {
      ...f.agent,
      actorId: token.id,
      authorizationConnectionId: connectionId,
      scopes: new Set(["mail:read"]),
    };
    const pending: ReturnType<typeof f.service.register>[] = [];
    const actions = {
      register: () => f.service.register(agent, { platform: "claude" }),
      link: () => f.service.link(f.human, connectionId, { agentAccountId: target.id }),
    };
    try {
      await database.db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`agent-account:${f.human.userId}:${connectionId}`}, 0))`,
        );
        for (const action of [first, first === "register" ? "link" : "register"] as const) {
          pending.push(actions[action]());
          await vi.waitFor(async () => {
            const waiting = await database.pool.query(
              "SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND NOT granted",
            );
            expect(waiting.rowCount).toBe(pending.length);
          });
        }
      });
      const results = await Promise.all(pending);
      expect(results[first === "link" ? 0 : 1]?.id).toBe(target.id);
      if (first === "link") expect(results[1]?.id).toBe(target.id);
      expect(await f.service.current(agent)).toMatchObject({
        id: target.id,
        identitySource: "user_confirmed",
      });
      expect(await f.service.register(agent, {})).toMatchObject({ id: target.id });
      const directory = await f.service.list(f.human);
      expect(directory.connections.find((c) => c.id === connectionId)).toMatchObject({
        agentAccountId: target.id,
        scopes: ["mail:read"],
      });
      expect(directory.accounts).toHaveLength(first === "link" ? 1 : 2);
    } finally {
      await Promise.allSettled(pending);
    }
  });
  it("links two surfaces to one account without altering their scopes", async () => {
    const f = await fixture();
    const first = await f.service.register(f.agent, { platform: "claude" });
    const connectionId = randomUUID();
    await database.db.insert(accessTokens).values({
      userId: f.human.userId,
      authorizationConnectionId: connectionId,
      tokenHash: randomUUID(),
      name: "Claude Cowork",
      scopes: ["mail:read"],
    });
    const second = await f.service.link(f.human, connectionId, { agentAccountId: first.id });
    expect(second.id).toBe(first.id);
    const directory = await f.service.list(f.human);
    expect(directory.accounts).toHaveLength(1);
    expect(directory.connections.map((c) => c.agentAccountId)).toEqual([first.id, first.id]);
    expect(directory.connections.find((c) => c.id === connectionId)?.scopes).toEqual(["mail:read"]);
    expect(directory.connections.find((c) => c.id === f.connectionId)?.scopes).toEqual([
      "finances:maintain",
    ]);
    await expect(
      f.service.link(f.agent, connectionId, { agentAccountId: first.id }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
  it("isolates account updates, linking, directory and database foreign keys by owner", async () => {
    const f = await fixture(),
      other = await fixture();
    const account = await f.service.register(f.agent, {});
    await expect(
      other.service.update(other.human, account.id, { displayName: "Stolen" }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      other.service.link(other.human, other.connectionId, { agentAccountId: account.id }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      other.service.link(other.human, f.connectionId, { agentAccountId: null }),
    ).rejects.toMatchObject({ code: "not_found" });
    expect((await other.service.list(other.human)).accounts).toHaveLength(0);
    await expect(f.service.list(f.agent)).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      database.db.insert(agentAccountConnections).values({
        userId: other.human.userId,
        authorizationConnectionId: randomUUID(),
        agentAccountId: account.id,
      }),
    ).rejects.toThrow();
  });
  it("keeps identity through token rotation, labels, and independent revocation", async () => {
    const f = await fixture();
    const account = await f.service.register(f.agent, { platform: "codex" });
    await f.service.update(f.human, account.id, {
      displayName: "My helper",
      accountLabel: "Personal",
    });
    await database.db
      .update(accessTokens)
      .set({ revokedAt: now() })
      .where(eq(accessTokens.id, f.agent.actorId));
    await database.db.insert(accessTokens).values({
      userId: f.human.userId,
      authorizationConnectionId: f.connectionId,
      tokenHash: randomUUID(),
      name: "Codex",
      scopes: ["mail:read"],
      lastUsedAt: now(),
    });
    const current = await database.db.transaction((tx) =>
      ensureAgentAccount(tx, f.human.userId, f.connectionId, "codex", now()),
    );
    expect(current).toMatchObject({
      id: account.id,
      avatarSeed: account.avatarSeed,
      displayName: "My helper",
      accountLabel: "Personal",
    });
    const directory = await f.service.list(f.human);
    expect(directory.connections).toHaveLength(1);
    expect(directory.connections[0]).toMatchObject({
      active: true,
      scopes: ["mail:read"],
      lastUsedAt: now().toISOString(),
    });
    await database.db
      .update(accessTokens)
      .set({ revokedAt: now() })
      .where(eq(accessTokens.userId, f.human.userId));
    expect((await f.service.list(f.human)).connections[0]).toMatchObject({
      active: false,
      scopes: [],
    });
    expect((await f.service.list(f.human)).accounts[0]?.id).toBe(account.id);
  });
  it("can separate a mistakenly grouped connection and preserves the other account", async () => {
    const f = await fixture();
    const first = await f.service.register(f.agent, { platform: "claude" });
    const second = await f.service.link(f.human, f.connectionId, {
      agentAccountId: null,
      platform: "claude",
    });
    expect(second.id).not.toBe(first.id);
    expect(await f.service.current(f.agent)).toMatchObject({
      id: second.id,
      identitySource: "user_confirmed",
    });
    expect(
      await database.db
        .select()
        .from(agentAccounts)
        .where(and(eq(agentAccounts.id, first.id), eq(agentAccounts.userId, f.human.userId))),
    ).toHaveLength(1);
    await f.service.update(f.human, second.id, { platform: "codex" });
    await expect(
      f.service.link(f.human, f.connectionId, { agentAccountId: first.id }),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });
});
