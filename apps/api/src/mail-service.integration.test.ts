import { cp, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  calendarAccounts,
  createDatabaseClient,
  type DatabaseClient,
  domainProfiles,
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
import { eq } from "drizzle-orm";
import { createMailService } from "./mail-service.js";

describe.sequential("mail service", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  let service: ReturnType<typeof createMailService>;
  let userId: string;
  let enabledAccountId: string;
  let disabledAccountId: string;
  let inboxId: string;
  let profileId: string;
  let threadId: string;
  let legacyRuleId: string;
  let temporaryMigrationsFolder: string | null = null;
  const gateway = { send: vi.fn(async () => undefined), update: vi.fn(async () => undefined) };

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine")
      .withDatabase("personal_os")
      .withUsername("personal_os")
      .withPassword("personal_os")
      .start();
    database = createDatabaseClient(container.getConnectionUri());
    const migrationsFolder = resolve(process.cwd(), "packages/database/migrations");
    temporaryMigrationsFolder = await mkdtemp(join(tmpdir(), "ilo-mail-migrations-"));
    await cp(migrationsFolder, temporaryMigrationsFolder, { recursive: true });
    await unlink(join(temporaryMigrationsFolder, "0038_agent_setup_foundation.sql"));
    const journalPath = join(temporaryMigrationsFolder, "meta/_journal.json");
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
      entries: Array<{ tag: string }>;
    };
    journal.entries = journal.entries.filter(
      (entry) => entry.tag !== "0038_agent_setup_foundation",
    );
    await writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
    await migrateDatabase(database.db, temporaryMigrationsFolder);
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
    const legacyRule = await database.pool.query<{ id: string }>(
      `INSERT INTO mail_rules (user_id, name, query, action, enabled)
       VALUES ($1, 'Legacy archive', 'legacy newsletter', 'archive', true)
       RETURNING id`,
      [userId],
    );
    const migratedRuleId = legacyRule.rows[0]?.id;
    if (!migratedRuleId) throw new Error("Legacy rule fixture was not created.");
    legacyRuleId = migratedRuleId;
    await migrateDatabase(database.db, migrationsFolder);
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
    const [profile] = await database.db
      .insert(domainProfiles)
      .values({
        categories: [],
        domain: "mail",
        instructions: [],
        objective: "Keep mail useful.",
        preferences: {},
        sourceContexts: [],
        status: "draft",
        summary: "Mail setup.",
        userId,
      })
      .returning();
    if (!profile) throw new Error("Fixture profile was not created.");
    profileId = profile.id;
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
    if (temporaryMigrationsFolder)
      await rm(temporaryMigrationsFolder, { force: true, recursive: true });
  });

  it("preserves and normalizes legacy rules through the setup migration", async () => {
    const [stored] = await database.db
      .select()
      .from(mailRules)
      .where(eq(mailRules.id, legacyRuleId));
    expect(stored).toMatchObject({
      actions: [{ afterDays: 0, mailboxId: null, type: "archive" }],
      condition: { field: "any", operator: "contains", value: "legacy newsletter" },
      enabled: true,
      legacyAction: "archive",
      legacyQuery: "legacy newsletter",
      policy: "approved_rule",
    });
    await expect(service.listRules(userId)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          condition: { field: "any", operator: "contains", value: "legacy newsletter" },
          id: legacyRuleId,
          policy: "approved_rule",
        }),
      ]),
    );
    const oldWriterRule = await database.pool.query<{ id: string }>(
      `INSERT INTO mail_rules (user_id, name, query, action, enabled)
       VALUES ($1, 'Overlap rule', 'legacy overlap', 'mark_read', true)
       RETURNING id`,
      [userId],
    );
    const oldWriterRuleId = oldWriterRule.rows[0]?.id;
    if (!oldWriterRuleId) throw new Error("Rolling-deploy rule fixture was not created.");
    await expect(service.listRules(userId)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actions: [{ afterDays: 0, mailboxId: null, type: "mark_read" }],
          condition: { field: "any", operator: "contains", value: "legacy overlap" },
          id: oldWriterRuleId,
          policy: "approved_rule",
        }),
      ]),
    );
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
    const rule = await service.createRule(
      {
        actions: [{ afterDays: 1, mailboxId: null, type: "archive" }],
        condition: { field: "subject", operator: "contains", value: "Project" },
        confidenceThreshold: null,
        description: "Archive old project updates.",
        enabled: false,
        name: "Archive newsletters",
        policy: "preview",
        profileId: null,
        sourceIds: [enabledAccountId],
      },
      {
        principal: {
          actorId: userId,
          actorType: "user",
          scopes: new Set(["mail:read", "mail:write"]),
          userId,
        },
        requestId: "request-rule",
      },
    );
    await expect(
      service.previewRule(userId, {
        actions: rule.actions,
        condition: rule.condition,
        confidenceThreshold: null,
        description: rule.description,
        sourceIds: rule.sourceIds,
      }),
    ).resolves.toMatchObject({
      candidates: [expect.objectContaining({ id: threadId })],
      matchedCount: 1,
    });
    await expect(
      service.updateRule(
        rule.id,
        { enabled: true, expectedVersion: rule.version, policy: "approved_rule" },
        {
          principal: {
            actorId: userId,
            actorType: "user",
            scopes: new Set(["mail:read", "mail:write"]),
            userId,
          },
          requestId: "request-rule-update",
        },
      ),
    ).resolves.toMatchObject({ enabled: true, policy: "approved_rule", version: 2 });
    await expect(service.listRules(userId)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ enabled: true, id: rule.id, version: 2 })]),
    );
    await expect(database.db.select().from(mailRules)).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: rule.id })]),
    );
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

  it("validates rule references and preserves explicit partial updates", async () => {
    const context = {
      principal: {
        actorId: userId,
        actorType: "user" as const,
        scopes: new Set(["mail:read" as const, "mail:write" as const]),
        userId,
      },
      requestId: "rule-validation",
    };
    const baseRule = {
      actions: [{ afterDays: 0, mailboxId: null, type: "mark_read" as const }],
      condition: {
        field: "sender" as const,
        operator: "ends_with" as const,
        value: "@example.com",
      },
      confidenceThreshold: 0.9,
      description: "Read known senders.",
      enabled: false as const,
      name: "Known senders",
      policy: "preview" as const,
      profileId,
      sourceIds: [enabledAccountId],
    };
    await expect(
      service.createRule({ ...baseRule, profileId: disabledAccountId }, context),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      service.createRule({ ...baseRule, sourceIds: [disabledAccountId] }, context),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      service.createRule(
        {
          ...baseRule,
          actions: [{ afterDays: 0, mailboxId: disabledAccountId, type: "add_label" }],
        },
        context,
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      service.createRule(
        {
          ...baseRule,
          actions: [{ afterDays: 0, mailboxId: inboxId, type: "add_label" }],
          sourceIds: [],
        },
        context,
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });

    const rule = await service.createRule(
      {
        ...baseRule,
        actions: [{ afterDays: 0, mailboxId: inboxId, type: "add_label" }],
      },
      context,
    );
    expect(rule).toMatchObject({
      confidenceThreshold: 0.9,
      profileId,
      sourceIds: [enabledAccountId],
    });
    await expect(
      service.previewRule(userId, {
        actions: baseRule.actions,
        condition: baseRule.condition,
        confidenceThreshold: 0.9,
        description: baseRule.description,
        sourceIds: [],
      }),
    ).resolves.toMatchObject({ matchedCount: 2, scannedCount: 2 });
    await expect(
      service.updateRule(disabledAccountId, { enabled: true, expectedVersion: 1 }, context),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      service.updateRule(rule.id, { enabled: true, expectedVersion: 99 }, context),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      service.updateRule(
        rule.id,
        {
          actions: baseRule.actions,
          confidenceThreshold: null,
          expectedVersion: rule.version,
          profileId: null,
          sourceIds: [],
        },
        context,
      ),
    ).resolves.toMatchObject({
      confidenceThreshold: null,
      profileId: null,
      sourceIds: [],
      version: 2,
    });
  });
});
