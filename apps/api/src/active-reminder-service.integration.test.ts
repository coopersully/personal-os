import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import {
  createDatabaseClient,
  type DatabaseClient,
  migrateDatabase,
  reminders,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createActiveReminderService } from "./active-reminder-service.js";
import { migrationsWithout } from "./test-migrations.js";
import type { Principal } from "./types.js";

const owner = randomUUID();
const other = randomUUID();
const legacyEnabled = randomUUID();
const legacyDisabled = randomUUID();
const instant = new Date("2026-10-22T12:00:00Z");
const principal: Principal = {
  userId: owner,
  actorId: owner,
  actorType: "user",
  scopes: new Set(),
};
describe.sequential("active reminder API persistence", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  let service: ReturnType<typeof createActiveReminderService>;
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    const priorMigrations = await migrationsWithout(
      resolve("packages/database/migrations"),
      "active-reminder-migration-",
      ["0132_active_reminder_creation_defaults"],
    );
    try {
      await migrateDatabase(database.db, priorMigrations);
    } finally {
      await rm(priorMigrations, { recursive: true, force: true });
    }
    await database.db.insert(users).values(
      [owner, other, legacyEnabled, legacyDisabled].map((id) => ({
        id,
        email: `${id}@example.test`,
        displayName: "Active fixture",
        passwordHash: "unused",
      })),
    );
    await database.pool.query(
      "INSERT INTO active_reminder_preferences(user_id, default_active_reminder, revision) VALUES ($1,true,7),($2,false,2)",
      [legacyEnabled, legacyDisabled],
    );
    await database.db
      .insert(reminders)
      .values({ userId: legacyEnabled, title: "Existing item", activeReminder: false });
    await migrateDatabase(database.db, resolve("packages/database/migrations"));
    service = createActiveReminderService({
      db: database.db,
      now: () => instant,
      cursorSecret: "test-cursor-secret",
    });
  }, 120_000);
  afterAll(async () => {
    await database?.close();
    await container?.stop();
  });
  it("preserves pre-migration enabled and disabled defaults without changing existing items or revisions", async () => {
    expect(await service.getPreferences(legacyEnabled)).toEqual({
      defaultActiveReminder: true,
      defaultTaskActiveReminder: true,
      defaultReminderActiveReminder: true,
      revision: 7,
    });
    expect(await service.getPreferences(legacyDisabled)).toEqual({
      defaultActiveReminder: false,
      defaultTaskActiveReminder: false,
      defaultReminderActiveReminder: false,
      revision: 2,
    });
    const result = await database.pool.query(
      "SELECT active_reminder FROM reminders WHERE user_id=$1",
      [legacyEnabled],
    );
    expect(result.rows).toEqual([{ active_reminder: false }]);
  });
  it("atomically saves owner preferences with revision conflicts and an audit", async () => {
    expect(await service.getPreferences(owner)).toEqual({
      defaultActiveReminder: false,
      defaultTaskActiveReminder: false,
      defaultReminderActiveReminder: false,
      revision: 0,
    });
    const context = { principal, requestId: randomUUID() };
    expect(
      await service.savePreferences(
        owner,
        { defaultActiveReminder: true, expectedRevision: 0 },
        context,
      ),
    ).toEqual({
      defaultActiveReminder: true,
      defaultTaskActiveReminder: true,
      defaultReminderActiveReminder: true,
      revision: 1,
    });
    const concurrent = await Promise.allSettled(
      [true, false].map((defaultActiveReminder) =>
        service.savePreferences(owner, { defaultActiveReminder, expectedRevision: 1 }, context),
      ),
    );
    expect(concurrent.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(concurrent.filter((x) => x.status === "rejected")).toHaveLength(1);
    await expect(
      service.savePreferences(other, { defaultActiveReminder: true, expectedRevision: 0 }, context),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await service.getPreferences(other)).toEqual({
      defaultActiveReminder: false,
      defaultTaskActiveReminder: false,
      defaultReminderActiveReminder: false,
      revision: 0,
    });
    expect(
      (
        await database.pool.query(
          "SELECT count(*)::int n FROM audit_events WHERE action='active_reminder.preferences_saved' AND user_id=$1",
          [owner],
        )
      ).rows[0]?.n,
    ).toBe(2);
  });
  it("saves independent defaults, rejects stale writes, and lets legacy callers set both", async () => {
    const context = { principal, requestId: randomUUID() };
    const before = await service.getPreferences(owner);
    expect(
      await service.savePreferences(
        owner,
        {
          defaultTaskActiveReminder: true,
          defaultReminderActiveReminder: false,
          expectedRevision: before.revision,
        },
        context,
      ),
    ).toEqual({
      defaultActiveReminder: false,
      defaultTaskActiveReminder: true,
      defaultReminderActiveReminder: false,
      revision: before.revision + 1,
    });
    await expect(
      service.savePreferences(
        owner,
        {
          defaultTaskActiveReminder: false,
          defaultReminderActiveReminder: true,
          expectedRevision: before.revision,
        },
        context,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(
      await service.savePreferences(
        owner,
        { defaultActiveReminder: true, expectedRevision: before.revision + 1 },
        { ...context, requestId: randomUUID() },
      ),
    ).toMatchObject({ defaultTaskActiveReminder: true, defaultReminderActiveReminder: true });
    const audit = await database.pool.query(
      "SELECT after FROM audit_events WHERE request_id=$1 ORDER BY created_at LIMIT 1",
      [context.requestId],
    );
    expect(audit.rows[0]?.after).toMatchObject({
      defaultTaskActiveReminder: true,
      defaultReminderActiveReminder: false,
    });
  });
  it("pages beyond pet limits with a fixed cutoff and owner-bound signed cursors", async () => {
    const { rows: lists } = await database.pool.query(
      "SELECT id FROM task_lists WHERE user_id=$1 AND kind='inbox'",
      [owner],
    );
    const listId = lists[0]?.id;
    await database.db.insert(reminders).values(
      Array.from({ length: 205 }, (_, i) => ({
        userId: owner,
        title: `Due ${i}`,
        activeReminder: true,
        dueAt: new Date("2025-01-01T12:00:00Z"),
        ...(i % 2
          ? {
              kind: "task" as const,
              taskLifecycle: "open" as const,
              taskListId: listId,
              taskRevision: 1,
            }
          : {}),
      })),
    );
    await database.db.insert(reminders).values([
      { userId: other, title: "Foreign", activeReminder: true, dueAt: instant },
      { userId: owner, title: "Off", activeReminder: false, dueAt: instant },
      { userId: owner, title: "Untimed", activeReminder: true },
      {
        userId: owner,
        title: "Too far",
        activeReminder: true,
        dueAt: new Date(instant.getTime() + 86400001),
      },
      {
        userId: owner,
        title: "Completed",
        activeReminder: true,
        dueAt: instant,
        completedAt: instant,
      },
      { userId: owner, title: "Deleted", activeReminder: true, dueAt: instant, deletedAt: instant },
      {
        userId: owner,
        title: "Cancelled",
        activeReminder: true,
        dueAt: instant,
        status: "cancelled",
      },
    ]);
    const first = await service.listCandidates(owner, { limit: 100 });
    expect(first.items).toHaveLength(100);
    expect(first.nextCursor).toBeTruthy();
    await expect(
      service.listCandidates(other, { cursor: first.nextCursor!, limit: 100 }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      service.listCandidates(owner, { cursor: "invalid", limit: 100 }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    const second = await service.listCandidates(owner, { cursor: first.nextCursor!, limit: 100 });
    const third = await service.listCandidates(owner, { cursor: second.nextCursor!, limit: 100 });
    const all = [...first.items, ...second.items, ...third.items];
    expect(all).toHaveLength(205);
    expect(new Set(all.map((x) => x.id)).size).toBe(205);
    expect(all.every((x) => x.title.startsWith("Due "))).toBe(true);
    expect(third.nextCursor).toBeNull();
  });
});
