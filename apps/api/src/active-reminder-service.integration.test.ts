import { randomUUID } from "node:crypto";
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
import type { Principal } from "./types.js";

const owner = randomUUID();
const other = randomUUID();
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
    await migrateDatabase(database.db, resolve("packages/database/migrations"));
    await database.db.insert(users).values(
      [owner, other].map((id) => ({
        id,
        email: `${id}@example.test`,
        displayName: "Active fixture",
        passwordHash: "unused",
      })),
    );
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
  it("atomically saves owner preferences with revision conflicts and an audit", async () => {
    expect(await service.getPreferences(owner)).toEqual({
      defaultActiveReminder: false,
      revision: 0,
    });
    const context = { principal, requestId: randomUUID() };
    expect(
      await service.savePreferences(
        owner,
        { defaultActiveReminder: true, expectedRevision: 0 },
        context,
      ),
    ).toEqual({ defaultActiveReminder: true, revision: 1 });
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
