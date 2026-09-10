import { resolve } from "node:path";
import type { MailSyncResult } from "@personal-os/connectors";
import {
  calendarAccounts,
  createDatabaseClient,
  type DatabaseClient,
  desktopMailActivity,
  mailboxes,
  mailThreads,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createDesktopActivityService, recordDesktopMailSync } from "./desktop-activity-service.js";

describe("desktop mail activity", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  let userId: string;
  let accountId: string;
  const base = new Date("2026-09-08T12:00:00Z");
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve("packages/database/migrations"));
    const [user] = await database.db
      .insert(users)
      .values({ email: "desktop-test@example.com", displayName: "Desktop", passwordHash: "unused" })
      .returning();
    if (!user) throw new Error("Missing test user");
    userId = user.id;
    const [account] = await database.db
      .insert(calendarAccounts)
      .values({
        userId,
        provider: "google",
        label: "Mail",
        email: "desktop-test@example.com",
        mailEnabled: true,
      })
      .returning();
    if (!account) throw new Error("Missing test account");
    accountId = account.id;
    await database.db.insert(mailboxes).values({
      userId,
      accountId,
      provider: "google",
      remoteMailboxId: "INBOX",
      role: "inbox",
      name: "Inbox",
    });
    await database.db.insert(mailThreads).values({
      userId,
      accountId,
      provider: "google",
      remoteThreadId: "thread",
      subject: "Hello",
      snippet: "",
      bodyText: "",
      from: { address: "sender@example.com", name: "Sender" },
      to: [],
      receivedAt: base,
      remoteMailboxIds: ["INBOX"],
    });
  }, 60000);
  afterAll(async () => {
    await database?.close();
    await container?.stop();
  });
  const projection = (ids: string[], time: Date) =>
    [
      {
        remoteThreadId: "thread",
        messages: ids.map((remoteMessageId) => ({ remoteMessageId, receivedAt: time })),
      },
    ] as MailSyncResult["value"]["threads"];
  it("baselines imports, detects new messages within threads and deduplicates replay", async () => {
    const service = createDesktopActivityService(database.db);
    await recordDesktopMailSync(
      database.db,
      userId,
      accountId,
      projection(["imported"], base),
      base,
    );
    const initial = await service.list(userId, undefined);
    expect(initial.events).toEqual([]);
    await recordDesktopMailSync(
      database.db,
      userId,
      accountId,
      projection(["new-1", "new-2"], new Date(base.getTime() + 60000)),
      new Date(base.getTime() + 120000),
    );
    const first = await service.list(userId, initial.cursor, 1);
    expect(first.events).toHaveLength(1);
    expect(first.hasMore).toBe(true);
    expect(first.events[0]).toMatchObject({ subject: "Hello", sender: "Sender", accountId });
    const second = await service.list(userId, first.cursor, 1);
    expect(second.events).toHaveLength(1);
    expect(second.hasMore).toBe(false);
    await recordDesktopMailSync(
      database.db,
      userId,
      accountId,
      projection(["new-1", "new-2"], new Date(base.getTime() + 60000)),
      new Date(base.getTime() + 180000),
    );
    expect((await service.list(userId, second.cursor)).events).toEqual([]);
    expect(await database.db.select().from(desktopMailActivity)).toHaveLength(3);
    expect((await service.list(crypto.randomUUID(), "0")).events).toEqual([]);
    expect((await service.list(userId, "9999999999999999999")).events).toEqual([]);
  });
  it("suppresses historical backfill after baseline", async () => {
    const service = createDesktopActivityService(database.db);
    const initial = await service.list(userId, undefined);
    await recordDesktopMailSync(
      database.db,
      userId,
      accountId,
      projection(["backfill"], new Date(base.getTime() - 86400000)),
      new Date(base.getTime() + 240000),
    );
    expect((await service.list(userId, initial.cursor)).events).toEqual([]);
  });

  it("only notifies for received inbox messages within mixed inbox and sent conversations", async () => {
    const service = createDesktopActivityService(database.db);
    await recordDesktopMailSync(database.db, userId, accountId, projection([], base), base);
    const initial = await service.list(userId, undefined);
    const receivedAt = new Date(base.getTime() + 300000);
    const threads = projection([], receivedAt);
    const thread = threads[0];
    if (!thread) throw new Error("Missing thread fixture");
    thread.messages = [
      { remoteMessageId: "sent-reply", mailboxIds: ["SENT"] },
      { remoteMessageId: "draft-reply", mailboxIds: ["DRAFT"] },
      { remoteMessageId: "archived-reply", mailboxIds: [] },
      { remoteMessageId: "received-reply", mailboxIds: ["INBOX", "UNREAD"] },
    ].map((message) => ({
      attachments: [],
      bodyText: "",
      cc: [],
      from: { address: "sender@example.com", name: null },
      to: [],
      receivedAt,
      ...message,
    }));
    await recordDesktopMailSync(database.db, userId, accountId, threads, receivedAt);
    const page = await service.list(userId, initial.cursor);
    expect(page.events).toHaveLength(1);
    const recorded = await database.db.select().from(desktopMailActivity);
    const eligibleIds = recorded
      .filter((item) => item.eligible && item.receivedAt.getTime() === receivedAt.getTime())
      .map((item) => item.remoteMessageId);
    expect(eligibleIds).toEqual(["received-reply"]);
    // Moving an already observed sent message to the inbox is not a new arrival.
    thread.messages = thread.messages.map((message) => ({ ...message, mailboxIds: ["INBOX"] }));
    await recordDesktopMailSync(database.db, userId, accountId, threads, receivedAt);
    expect((await service.list(userId, page.cursor)).events).toEqual([]);
  });

  it("uses inbox context for older connector messages without membership metadata", async () => {
    const service = createDesktopActivityService(database.db);
    await recordDesktopMailSync(database.db, userId, accountId, projection([], base), base);
    const initial = await service.list(userId, undefined);
    const receivedAt = new Date(base.getTime() + 600000);
    await recordDesktopMailSync(
      database.db,
      userId,
      accountId,
      projection(["legacy-inbox"], receivedAt),
      receivedAt,
    );
    expect((await service.list(userId, initial.cursor)).events).toHaveLength(1);
  });
});
