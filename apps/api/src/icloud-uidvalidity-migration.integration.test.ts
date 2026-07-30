import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import {
  attentionItems,
  createDatabaseClient,
  type DatabaseClient,
  mailDrafts,
  mailSnoozes,
  mailThreads,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import { migrationsWithout } from "./test-migrations.js";

describe.sequential("iCloud UIDVALIDITY identity migration", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  let migrationsBeforeUidValidity: string | undefined;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine")
      .withDatabase("personal_os")
      .withUsername("personal_os")
      .withPassword("personal_os")
      .start();
    database = createDatabaseClient(container.getConnectionUri());
    const migrationsFolder = resolve(process.cwd(), "packages/database/migrations");
    migrationsBeforeUidValidity = await migrationsWithout(
      migrationsFolder,
      "ilo-icloud-uidvalidity-migration-",
      [
        "0047_icloud_uidvalidity_identity",
        "0048_connector_sync_generation",
        "0049_attention_item_versions",
      ],
    );
    await migrateDatabase(database.db, migrationsBeforeUidValidity);
  }, 120_000);

  afterAll(async () => {
    try {
      await database?.close();
    } finally {
      try {
        await container?.stop();
      } finally {
        if (migrationsBeforeUidValidity) {
          await rm(migrationsBeforeUidValidity, { force: true, recursive: true });
        }
      }
    }
  });

  it("retires legacy source identity without cascading user-owned thread references", async () => {
    const [user] = await database.db
      .insert(users)
      .values({
        displayName: "iCloud migration",
        email: "icloud-migration@example.com",
        passwordHash: "unused",
        planningTimezone: "UTC",
      })
      .returning();
    if (!user) throw new Error("Migration user was not created.");
    const accountResult = await database.pool.query<{ id: string }>(
      `INSERT INTO calendar_accounts (
         user_id, provider, label, provider_account_id, email
       )
       VALUES ($1, 'icloud', 'iCloud', 'icloud-migration', 'icloud-migration@example.com')
       RETURNING id`,
      [user.id],
    );
    const accountId = accountResult.rows[0]?.id;
    if (!accountId) throw new Error("Migration account was not created.");
    const [thread] = await database.db
      .insert(mailThreads)
      .values({
        accountId,
        bodyText: "Historical source body",
        from: { address: "sender@example.com", name: null },
        provider: "icloud",
        receivedAt: new Date("2026-07-20T12:00:00.000Z"),
        remoteMailboxIds: ["INBOX"],
        remoteThreadId: "INBOX:42",
        snippet: "Historical source",
        subject: "Historical source",
        to: [{ address: user.email, name: null }],
        userId: user.id,
      })
      .returning();
    if (!thread) throw new Error("Migration thread was not created.");
    const [snooze] = await database.db
      .insert(mailSnoozes)
      .values({
        threadId: thread.id,
        until: new Date("2026-08-01T12:00:00.000Z"),
        userId: user.id,
      })
      .returning();
    const [draft] = await database.db
      .insert(mailDrafts)
      .values({
        accountId,
        body: "Keep this reply",
        subject: "Re: Historical source",
        threadId: thread.id,
        to: [{ address: "sender@example.com", name: null }],
        userId: user.id,
      })
      .returning();
    const attentionResult = await database.pool.query<{ id: string }>(
      `INSERT INTO attention_items (
         user_id, domain, kind, importance, title, summary, source,
         related_entity_type, related_entity_id
       )
       VALUES ($1, 'mail', 'important', 'normal', $2, $3, $4::jsonb, 'mail_thread', $5)
       RETURNING id`,
      [
        user.id,
        "Review historical source",
        "Historical source needs review.",
        JSON.stringify({
          accountId,
          provider: "icloud",
          remoteId: thread.remoteThreadId,
          revision: thread.updatedAt.toISOString(),
          sourceType: "mail_thread",
        }),
        thread.id,
      ],
    );
    const attentionId = attentionResult.rows[0]?.id;
    if (!snooze || !draft || !attentionId) throw new Error("Dependent fixtures were not created.");

    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));

    const [newEpochThread] = await database.db
      .insert(mailThreads)
      .values({
        accountId,
        bodyText: "Current epoch body",
        from: { address: "different-sender@example.com", name: null },
        provider: "icloud",
        receivedAt: new Date("2026-07-29T12:00:00.000Z"),
        remoteMailboxIds: ["INBOX"],
        remoteThreadId: "INBOX:777:42",
        snippet: "Current epoch source",
        subject: "Current epoch source",
        to: [{ address: user.email, name: null }],
        userId: user.id,
      })
      .returning();
    if (!newEpochThread) throw new Error("Current-epoch thread was not created.");
    const [retiredThread] = await database.db
      .select()
      .from(mailThreads)
      .where(eq(mailThreads.id, thread.id));
    const [preservedSnooze] = await database.db
      .select()
      .from(mailSnoozes)
      .where(eq(mailSnoozes.id, snooze.id));
    const [preservedDraft] = await database.db
      .select()
      .from(mailDrafts)
      .where(eq(mailDrafts.id, draft.id));
    const [preservedAttention] = await database.db
      .select()
      .from(attentionItems)
      .where(eq(attentionItems.id, attentionId));

    expect(retiredThread).toMatchObject({
      id: thread.id,
      remoteThreadId: "INBOX:42",
    });
    expect(retiredThread?.deletedAt).toBeInstanceOf(Date);
    expect(newEpochThread.id).not.toBe(thread.id);
    expect(newEpochThread.deletedAt).toBeNull();
    expect(preservedSnooze?.threadId).toBe(thread.id);
    expect(preservedDraft?.threadId).toBe(thread.id);
    expect(preservedAttention).toMatchObject({
      relatedEntityId: thread.id,
      relatedEntityType: "mail_thread",
      source: {
        accountId,
        provider: "icloud",
        remoteId: "INBOX:42",
        revision: thread.updatedAt.toISOString(),
        sourceType: "mail_thread",
      },
    });
  }, 120_000);
});
