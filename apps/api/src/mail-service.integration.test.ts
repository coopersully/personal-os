import { resolve } from "node:path";
import {
  calendarAccounts,
  createDatabaseClient,
  type DatabaseClient,
  mailboxes,
  mailDrafts,
  mailMessages,
  mailRules,
  mailSnoozes,
  mailThreads,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createMailService } from "./mail-service.js";

describe.sequential("mail service", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  let service: ReturnType<typeof createMailService>;
  let userId: string;
  let enabledAccountId: string;
  let disabledAccountId: string;
  let inboxId: string;
  let threadId: string;
  const gateway = { send: vi.fn(async () => undefined), update: vi.fn(async () => undefined) };

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine")
      .withDatabase("personal_os")
      .withUsername("personal_os")
      .withPassword("personal_os")
      .start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
    const [user] = await database.db
      .insert(users)
      .values({
        displayName: "Mail Test",
        email: "mail@example.com",
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning();
    if (!user) throw new Error("Fixture user was not created.");
    userId = user.id;
    const [enabled, disabled] = await database.db
      .insert(calendarAccounts)
      .values([
        {
          calendarEnabled: true,
          email: "enabled@example.com",
          label: "Enabled",
          mailEnabled: true,
          provider: "google",
          providerAccountId: "enabled",
          userId,
        },
        {
          calendarEnabled: true,
          email: "disabled@example.com",
          label: "Disabled",
          mailEnabled: false,
          provider: "google",
          providerAccountId: "disabled",
          userId,
        },
      ])
      .returning();
    if (!enabled || !disabled) throw new Error("Fixture accounts were not created.");
    enabledAccountId = enabled.id;
    disabledAccountId = disabled.id;
    const [inbox] = await database.db
      .insert(mailboxes)
      .values({
        accountId: enabled.id,
        name: "Inbox",
        provider: "google",
        remoteMailboxId: "INBOX",
        role: "inbox",
        totalCount: 2,
        unreadCount: 1,
        userId,
      })
      .returning();
    if (!inbox) throw new Error("Fixture mailbox was not created.");
    inboxId = inbox.id;
    await database.db.insert(mailboxes).values({
      accountId: disabled.id,
      name: "Hidden inbox",
      provider: "google",
      remoteMailboxId: "INBOX",
      role: "inbox",
      userId,
    });
    const [thread] = await database.db
      .insert(mailThreads)
      .values({
        accountId: enabled.id,
        bodyText: "Full body",
        from: { address: "ada@example.com", name: "Ada" },
        messageCount: 2,
        provider: "google",
        receivedAt: new Date("2026-07-15T13:00:00.000Z"),
        remoteMailboxIds: ["INBOX", "MISSING"],
        remoteThreadId: "thread-1",
        snippet: "Project preview",
        starred: true,
        subject: "Project update",
        to: [{ address: "mail@example.com", name: null }],
        unread: true,
        userId,
      })
      .returning();
    if (!thread) throw new Error("Fixture thread was not created.");
    threadId = thread.id;
    await database.db.insert(mailThreads).values({
      accountId: enabled.id,
      bodyText: "Second body",
      from: { address: "other@example.com", name: "Other" },
      provider: "google",
      receivedAt: new Date("2026-07-15T12:00:00.000Z"),
      remoteMailboxIds: [],
      remoteThreadId: "thread-2",
      snippet: "Different preview",
      starred: false,
      subject: "Another note",
      to: [],
      unread: false,
      userId,
    });
    service = createMailService({
      db: database.db,
      gateway,
      now: () => new Date("2026-07-16T12:00:00.000Z"),
    });
  }, 120_000);

  afterAll(async () => {
    await database.close();
    await container.stop();
  });

  it("lists enabled mailboxes and serializes mailbox membership", async () => {
    await database.db.insert(mailMessages).values({
      attachments: [
        { contentType: "text/plain", filename: "notes.txt", id: "attachment", size: 4 },
      ],
      bodyText: "Message body",
      cc: [],
      from: { address: "ada@example.com", name: "Ada" },
      receivedAt: new Date("2026-07-15T13:00:00.000Z"),
      remoteMessageId: "message-1",
      threadId,
      to: [],
    });
    await expect(service.listMailboxes(userId)).resolves.toEqual([
      expect.objectContaining({ accountId: enabledAccountId, id: inboxId, unreadCount: 1 }),
    ]);
    await expect(service.getThread(userId, threadId)).resolves.toMatchObject({
      id: threadId,
      mailboxIds: [inboxId],
      messageCount: 2,
      provider: "google",
    });
    await expect(service.getThread(userId, disabledAccountId)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(service.listMessages(userId, threadId)).resolves.toEqual([
      expect.objectContaining({ bodyText: "Message body", threadId }),
    ]);
    await expect(service.listMessages(userId, disabledAccountId)).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("filters conversations by account, unread state, mailbox, and search fields", async () => {
    await expect(service.listThreads(userId, { limit: 100 })).resolves.toHaveLength(2);
    await expect(
      service.listThreads(userId, { accountIds: [], limit: 100, unread: false }),
    ).resolves.toEqual([expect.objectContaining({ subject: "Another note" })]);
    await expect(
      service.listThreads(userId, { accountIds: [enabledAccountId], limit: 100, unread: true }),
    ).resolves.toEqual([expect.objectContaining({ subject: "Project update" })]);
    for (const query of ["Project", "Project preview", "ada@example.com", "Ada"]) {
      await expect(service.listThreads(userId, { limit: 100, query })).resolves.toEqual([
        expect.objectContaining({ id: threadId }),
      ]);
    }
    await expect(service.listThreads(userId, { limit: 100, mailboxId: inboxId })).resolves.toEqual([
      expect.objectContaining({ id: threadId }),
    ]);
    await expect(
      service.listThreads(userId, { limit: 100, mailboxId: disabledAccountId }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("writes through mutations and persists drafts and snoozes", async () => {
    const updated = await service.updateThread(
      userId,
      threadId,
      { mailboxIds: [inboxId], starred: false, unread: false },
      { actorId: userId, actorType: "user" },
      "request-1",
    );
    expect(updated).toMatchObject({ starred: false, unread: false });
    expect(gateway.update).toHaveBeenCalledWith(userId, enabledAccountId, "thread-1", {
      addMailboxIds: [],
      removeMailboxIds: ["STARRED", "UNREAD"],
    });
    const draft = await service.createDraft(userId, {
      accountId: enabledAccountId,
      body: "Hello",
      cc: [],
      subject: "Subject",
      to: [{ address: "ada@example.com", name: "Ada" }],
    });
    if (!draft) throw new Error("Draft was not created.");
    await expect(service.listDrafts(userId)).resolves.toEqual([
      expect.objectContaining({ id: draft.id }),
    ]);
    await service.send(userId, {
      accountId: enabledAccountId,
      body: "Hello",
      cc: [],
      draftId: draft.id,
      subject: "Subject",
      to: [{ address: "ada@example.com", name: "Ada" }],
    });
    expect(gateway.send).toHaveBeenCalledWith(userId, enabledAccountId, {
      body: "Hello",
      cc: [],
      subject: "Subject",
      to: [{ address: "ada@example.com", name: "Ada" }],
    });
    await service.send(userId, {
      accountId: enabledAccountId,
      body: "Reply",
      cc: [],
      subject: "Re: Project update",
      threadId,
      to: [{ address: "ada@example.com", name: "Ada" }],
    });
    expect(gateway.send).toHaveBeenLastCalledWith(userId, enabledAccountId, {
      body: "Reply",
      cc: [],
      subject: "Re: Project update",
      threadId: "thread-1",
      to: [{ address: "ada@example.com", name: "Ada" }],
    });
    await expect(database.db.select().from(mailDrafts)).resolves.toEqual([
      expect.objectContaining({ sentAt: expect.any(Date) }),
    ]);
    await service.snoozeThread(userId, threadId, new Date("2026-07-18T12:00:00.000Z"));
    await expect(database.db.select().from(mailSnoozes)).resolves.toEqual([
      expect.objectContaining({ threadId }),
    ]);
    await expect(service.listThreads(userId, { limit: 100 })).resolves.toEqual([
      expect.objectContaining({ subject: "Another note" }),
    ]);
    const rule = await service.createRule(userId, {
      action: "archive",
      enabled: true,
      name: "Archive newsletters",
      query: "newsletter",
    });
    if (!rule) throw new Error("Rule was not created.");
    await expect(service.listRules(userId)).resolves.toEqual([
      expect.objectContaining({ id: rule.id }),
    ]);
    await expect(database.db.select().from(mailRules)).resolves.toEqual([
      expect.objectContaining({ id: rule.id }),
    ]);
  });

  it("rejects missing messages, drafts, and mailbox memberships", async () => {
    await expect(
      service.send(userId, {
        accountId: enabledAccountId,
        body: "Body",
        cc: [],
        draftId: disabledAccountId,
        subject: "Subject",
        to: [{ address: "to@example.com", name: null }],
      }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      service.send(userId, {
        accountId: enabledAccountId,
        body: "Body",
        cc: [],
        subject: "Subject",
        threadId: disabledAccountId,
        to: [{ address: "to@example.com", name: null }],
      }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      service.snoozeThread(userId, disabledAccountId, new Date("2026-07-18T12:00:00.000Z")),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      service.updateThread(
        userId,
        threadId,
        { mailboxIds: [disabledAccountId], starred: true, unread: true },
        { actorId: userId, actorType: "user" },
        "request-2",
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      service.updateThread(
        userId,
        disabledAccountId,
        { starred: true },
        { actorId: userId, actorType: "user" },
        "request-3",
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      service.updateThread(
        userId,
        threadId,
        { starred: true, unread: true },
        { actorId: userId, actorType: "user" },
        "request-4",
      ),
    ).resolves.toMatchObject({ starred: true, unread: true });
    await expect(
      service.updateThread(
        userId,
        threadId,
        { unread: false },
        { actorId: userId, actorType: "user" },
        "request-5",
      ),
    ).resolves.toMatchObject({ unread: false });
  });
});
