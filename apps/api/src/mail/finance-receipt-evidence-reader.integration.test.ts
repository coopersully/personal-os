import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import * as databaseSchema from "@personal-os/database";
import {
  accessTokens,
  calendarAccounts,
  createDatabaseClient,
  type DatabaseClient,
  mailMessages,
  mailThreads,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Principal } from "../types.js";
import { createMailFinanceReceiptEvidenceReader } from "./finance-receipt-evidence-reader.js";

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing fixture result");
  return value;
}

const stamp = new Date("2026-10-01T12:00:00Z");
const reader = createMailFinanceReceiptEvidenceReader();
describe.sequential("exact Mail receipt source reads", () => {
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
    const owner = randomUUID(),
      accountId = randomUUID(),
      threadId = randomUUID(),
      messageId = randomUUID();
    await database.db.insert(users).values({
      id: owner,
      email: `${owner}@example.com`,
      displayName: "Receipt owner",
      passwordHash: "unused",
    });
    await database.db.insert(calendarAccounts).values({
      id: accountId,
      userId: owner,
      provider: "icloud",
      label: "Mail",
      mailEnabled: true,
    });
    await database.db.insert(mailThreads).values({
      id: threadId,
      accountId,
      userId: owner,
      provider: "icloud",
      remoteThreadId: randomUUID(),
      subject: "Receipt",
      snippet: "Order",
      bodyText: "Thread aggregate is not the receipt",
      from: { address: "shop@example.com", name: null },
      to: [],
      receivedAt: stamp,
      updatedAt: stamp,
    });
    await database.db.insert(mailMessages).values({
      id: messageId,
      threadId,
      remoteMessageId: randomUUID(),
      bodyText: "Order TEST-RECEIPT-0001\nUSD42.00",
      from: { address: "shop@example.com", name: null },
      to: [],
      receivedAt: stamp,
      providerRevision: "p1",
      updatedAt: stamp,
    });
    const principal: Principal = {
      userId: owner,
      actorId: owner,
      actorType: "user",
      scopes: new Set(["mail:read"]),
    };
    return { owner, principal, ref: { accountId, threadId, messageId } };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  async function read(
    f: Fixture,
    expected?: Awaited<ReturnType<typeof reader.readLocked>>[number]["version"][],
  ) {
    return database.db.transaction(async (tx) => {
      // Integration caller establishes owner ordering before token/source locks.
      await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, f.owner))
        .for("no key update");
      return reader.readLocked({
        tx,
        principal: f.principal,
        sources: [f.ref],
        ...(expected ? { expected } : {}),
      });
    });
  }
  async function agent(f: Fixture) {
    const actorId = randomUUID(),
      connection = randomUUID();
    await database.db.insert(accessTokens).values({
      id: actorId,
      userId: f.owner,
      name: "Read only",
      tokenHash: randomUUID(),
      authorizationConnectionId: connection,
      scopes: ["mail:read"],
      expiresAt: new Date("2100-01-01"),
    });
    f.principal = {
      ...f.principal,
      actorType: "agent",
      actorId,
      authorizationConnectionId: connection,
    };
    return actorId;
  }
  it("returns exact message bytes and stable source identity without changing Mail", async () => {
    const f = await fixture();
    const [a] = await read(f);
    expect(a?.bodyText).toBe("Order TEST-RECEIPT-0001\nUSD42.00");
    expect(a?.version.contentSha256).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(await read(f, [required(a).version])).toEqual([a]);
    const [stored] = await database.db
      .select()
      .from(mailMessages)
      .where(eq(mailMessages.id, f.ref.messageId));
    expect(stored?.updatedAt).toEqual(stamp);
  });
  it.each([
    "body",
    "provider_revision",
    "message_revision",
    "thread_revision",
  ])("rejects changed %s against admitted identity", async (field) => {
    const f = await fixture();
    const [prior] = await read(f);
    if (field === "thread_revision")
      await database.db
        .update(mailThreads)
        .set({ updatedAt: new Date(stamp.getTime() + 1) })
        .where(eq(mailThreads.id, f.ref.threadId));
    else
      await database.db
        .update(mailMessages)
        .set(
          field === "body"
            ? { bodyText: "Different source" }
            : field === "provider_revision"
              ? { providerRevision: "p2" }
              : { updatedAt: new Date(stamp.getTime() + 1) },
        )
        .where(eq(mailMessages.id, f.ref.messageId));
    await expect(read(f, [required(prior).version])).rejects.toMatchObject({ code: "conflict" });
  });
  it.each([
    "foreign",
    "membership",
    "disabled",
    "deleted_thread",
    "deleted_message",
  ])("does not disclose %s sources", async (variant) => {
    const f = await fixture();
    if (variant === "foreign") {
      const other = (await fixture()).owner;
      f.principal = { ...f.principal, userId: other, actorId: other };
    }
    if (variant === "membership") f.ref.threadId = (await fixture()).ref.threadId;
    if (variant === "disabled")
      await database.db
        .update(calendarAccounts)
        .set({ mailEnabled: false })
        .where(eq(calendarAccounts.id, f.ref.accountId));
    if (variant === "deleted_thread")
      await database.db
        .update(mailThreads)
        .set({ deletedAt: stamp })
        .where(eq(mailThreads.id, f.ref.threadId));
    if (variant === "deleted_message")
      await database.db.delete(mailMessages).where(eq(mailMessages.id, f.ref.messageId));
    await expect(read(f)).rejects.toMatchObject({
      code: "not_found",
      message: "The requested Mail receipt sources are unavailable.",
    });
  });
  it.each([
    "scope",
    "revoked",
    "expired",
    "connection",
    "stored_scope",
    "foreign_token",
  ])("requires current exact read authority: %s", async (variant) => {
    const f = await fixture();
    const id = await agent(f);
    if (variant === "scope") f.principal = { ...f.principal, scopes: new Set() };
    if (variant === "revoked")
      await database.db
        .update(accessTokens)
        .set({ revokedAt: stamp })
        .where(eq(accessTokens.id, id));
    if (variant === "expired")
      await database.db
        .update(accessTokens)
        .set({ expiresAt: stamp })
        .where(eq(accessTokens.id, id));
    if (variant === "connection")
      f.principal = { ...f.principal, authorizationConnectionId: randomUUID() };
    if (variant === "stored_scope")
      await database.db
        .update(accessTokens)
        .set({ scopes: ["finances:read"] })
        .where(eq(accessTokens.id, id));
    if (variant === "foreign_token") f.principal = { ...f.principal, actorId: randomUUID() };
    await expect(read(f)).rejects.toMatchObject({ code: "forbidden" });
  });
  it("does not require provider reauthorization to read still-owned cached Mail", async () => {
    const f = await fixture();
    await agent(f);
    await database.db
      .update(calendarAccounts)
      .set({
        syncStatus: "error",
        syncErrorCode: "authorization_failed",
        syncError: "Reconnect required",
        syncErrorCategory: "authorization",
        syncRecovery: "reconnect",
        syncFailureCount: 1,
      })
      .where(eq(calendarAccounts.id, f.ref.accountId));
    expect(await read(f)).toHaveLength(1);
  });
  it("rejects duplicate, missing expected, oversized and cancelled reads rather than returning subsets", async () => {
    const f = await fixture();
    const [a] = await read(f);
    await expect(
      database.db.transaction((tx) =>
        reader.readLocked({ tx, principal: f.principal, sources: [f.ref, f.ref] }),
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(read(f, [])).rejects.toMatchObject({ code: "conflict" });
    await database.db
      .update(mailMessages)
      .set({ bodyText: "é".repeat(66_000) })
      .where(eq(mailMessages.id, f.ref.messageId));
    await expect(read(f)).rejects.toMatchObject({ code: "invalid_request" });
    const signal = AbortSignal.abort();
    await expect(
      database.db.transaction((tx) =>
        reader.readLocked({ tx, principal: f.principal, sources: [required(a).source], signal }),
      ),
    ).rejects.toMatchObject({ code: "service_unavailable" });
  });
  it.each([
    "rewrite",
    "delete",
    "disable",
    "revoke",
  ])("retains real source/authority locks through the caller transaction: %s", async (operation) => {
    const f = await fixture();
    const token = await agent(f);
    let unlock!: () => void, locked!: () => void;
    const held = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const released = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    const reading = database.db.transaction(async (tx) => {
      await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, f.owner))
        .for("no key update");
      const source = await reader.readLocked({ tx, principal: f.principal, sources: [f.ref] });
      locked();
      await released;
      return source;
    });
    await held;
    let pid = 0;
    const writing = database.db.transaction(async (tx) => {
      pid =
        (await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`)).rows[0]?.pid ?? 0;
      if (operation === "rewrite")
        await tx
          .update(mailMessages)
          .set({ bodyText: "Changed after read" })
          .where(eq(mailMessages.id, f.ref.messageId));
      if (operation === "delete")
        await tx.delete(mailThreads).where(eq(mailThreads.id, f.ref.threadId));
      if (operation === "disable")
        await tx
          .update(calendarAccounts)
          .set({ mailEnabled: false })
          .where(eq(calendarAccounts.id, f.ref.accountId));
      if (operation === "revoke")
        await tx
          .update(accessTokens)
          .set({ revokedAt: new Date() })
          .where(eq(accessTokens.id, token));
    });
    try {
      await vi.waitFor(
        async () => {
          expect(pid).toBeGreaterThan(0);
          const r = await database.db.execute<{ wait: string | null }>(
            sql`select wait_event_type as wait from pg_stat_activity where pid=${pid}`,
          );
          expect(r.rows[0]?.wait).toBe("Lock");
        },
        { timeout: 2000, interval: 20 },
      );
    } finally {
      unlock();
    }
    const [source] = await reading;
    await writing;
    await expect(read(f, [required(source).version])).rejects.toMatchObject({
      code:
        operation === "rewrite" ? "conflict" : operation === "revoke" ? "forbidden" : "not_found",
    });
  });
  it("keeps source hashes stable across request order and rejects any missing member", async () => {
    const f = await fixture();
    const messageId = randomUUID();
    await database.db.insert(mailMessages).values({
      id: messageId,
      threadId: f.ref.threadId,
      remoteMessageId: randomUUID(),
      bodyText: "Shipment USD42.00",
      from: { address: "shop@example.com", name: null },
      to: [],
      receivedAt: stamp,
      updatedAt: stamp,
    });
    const second = { ...f.ref, messageId };
    const first = await database.db.transaction((tx) =>
      reader.readLocked({ tx, principal: f.principal, sources: [f.ref, second] }),
    );
    const reversed = await database.db.transaction((tx) =>
      reader.readLocked({
        tx,
        principal: f.principal,
        sources: [second, f.ref],
        expected: first.map((row) => row.version),
      }),
    );
    expect(reversed.map((row) => row.version)).toEqual(
      [...first].reverse().map((row) => row.version),
    );
    await database.db.delete(mailMessages).where(eq(mailMessages.id, messageId));
    await expect(
      database.db.transaction((tx) =>
        reader.readLocked({ tx, principal: f.principal, sources: [f.ref, second] }),
      ),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("turns a real source-lock timeout into unavailable without source content", async () => {
    const f = await fixture();
    let unlock!: () => void, locked!: () => void;
    const held = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const release = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    const writer = database.db.transaction(async (tx) => {
      await tx
        .select({ id: mailMessages.id })
        .from(mailMessages)
        .where(eq(mailMessages.id, f.ref.messageId))
        .for("update");
      locked();
      await release;
    });
    await held;
    try {
      await expect(
        database.db.transaction(async (tx) => {
          await tx.execute(sql`set local lock_timeout='30ms'`);
          return reader.readLocked({ tx, principal: f.principal, sources: [f.ref] });
        }),
      ).rejects.toMatchObject({
        code: "service_unavailable",
        message: "Mail receipt sources could not be read. Retry the exact selection.",
      });
    } finally {
      unlock();
      await writer;
    }
  });
  it("rejects the root database and structural mocks before reading any sources", async () => {
    const f = await fixture();
    type Tx = Parameters<typeof reader.readLocked>[0]["tx"];
    await expect(
      reader.readLocked({
        tx: database.db as unknown as Tx,
        principal: f.principal,
        sources: [f.ref],
      }),
    ).rejects.toMatchObject({ code: "internal_error" });
    const select = vi.fn(),
      execute = vi.fn();
    await expect(
      reader.readLocked({
        tx: { select, execute } as unknown as Tx,
        principal: f.principal,
        sources: [f.ref],
      }),
    ).rejects.toMatchObject({ code: "internal_error" });
    expect(select).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });
  it("rejects oversized storage content before issuing the body projection", async () => {
    const f = await fixture();
    await database.db
      .update(mailMessages)
      .set({ bodyText: "x".repeat(140_000) })
      .where(eq(mailMessages.id, f.ref.messageId));
    const queries: string[] = [];
    const observed = drizzle(database.pool, {
      schema: databaseSchema,
      logger: {
        logQuery(query) {
          queries.push(query);
        },
      },
    });
    await expect(
      observed.transaction((tx) =>
        reader.readLocked({ tx, principal: f.principal, sources: [f.ref] }),
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    const sourceReads = queries.filter((query) => query.includes('from "mail_messages"'));
    expect(sourceReads).toHaveLength(1);
    expect(sourceReads[0]).toContain("octet_length");
    expect(sourceReads[0]).not.toContain('"body_text",');
  });
  it("does not return source observations through an already-ended transaction handle", async () => {
    const f = await fixture();
    type Tx = Parameters<typeof reader.readLocked>[0]["tx"];
    let ended: Tx | undefined;
    await database.db.transaction(async (tx) => {
      ended = tx;
    });
    await expect(
      reader.readLocked({ tx: required(ended), principal: f.principal, sources: [f.ref] }),
    ).rejects.toMatchObject({
      code: "internal_error",
      message: "The caller-owned Mail evidence transaction has ended.",
    });
  });
});
