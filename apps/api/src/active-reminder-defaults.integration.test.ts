import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  createDatabaseClient,
  type DatabaseClient,
  migrateDatabase,
  users,
} from "@personal-os/database";
import {
  createReminderInputSchema,
  createTaskInputSchema,
  updateReminderInputSchema,
  updateTaskInputSchema,
} from "@personal-os/domain";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createReminderService } from "./reminder-service.js";
import { createTaskService } from "./task-service.js";
import type { Principal } from "./types.js";

const owner = randomUUID();
const other = randomUUID();
const principal = (id = owner): Principal => ({
  userId: id,
  actorId: id,
  actorType: "user",
  scopes: new Set(),
});
const context = (id = owner) => ({
  principal: principal(id),
  policy: "approve_each" as const,
  requestId: randomUUID(),
});

describe.sequential("active reminder defaults and item contracts", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  let reminders: ReturnType<typeof createReminderService>;
  let tasks: ReturnType<typeof createTaskService>;
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve("packages/database/migrations"));
    await database.db.insert(users).values(
      [owner, other].map((id) => ({
        id,
        email: `${id}@example.test`,
        displayName: "Active reminder fixture",
        passwordHash: "unused",
      })),
    );
    reminders = createReminderService({ db: database.db, now: () => new Date() });
    tasks = createTaskService({
      movePreviewSecret: "active-reminder-test",
      db: database.db,
      now: () => new Date(),
    });
  }, 120_000);
  afterAll(async () => {
    await database?.close();
    await container?.stop();
  });
  const setDefault = async (value: boolean) => {
    await database.pool.query(
      `INSERT INTO active_reminder_preferences(user_id, default_active_reminder, revision) VALUES($1,$2,1) ON CONFLICT(user_id) DO UPDATE SET default_active_reminder=$2, revision=active_reminder_preferences.revision+1`,
      [owner, value],
    );
  };
  it("starts new task and reminder flags false without a preference row", async () => {
    expect(
      await reminders.create(
        createReminderInputSchema.parse({ title: "Default reminder" }),
        context(),
      ),
    ).toMatchObject({ activeReminder: false });
    expect(
      await tasks.create(createTaskInputSchema.parse({ title: "Default task" }), context()),
    ).toMatchObject({ activeReminder: false });
  });
  it("resolves omissions from the account default and preserves explicit false", async () => {
    await setDefault(true);
    for (const activeReminder of [undefined, false, true]) {
      const expected = activeReminder ?? true;
      expect(
        await reminders.create(
          createReminderInputSchema.parse({ title: "Reminder", activeReminder }),
          context(),
        ),
      ).toMatchObject({ activeReminder: expected });
      expect(
        await tasks.create(
          createTaskInputSchema.parse({ title: "Task", activeReminder }),
          context(),
        ),
      ).toMatchObject({ activeReminder: expected });
    }
    expect(
      await reminders.create(
        createReminderInputSchema.parse({ title: "Other owner" }),
        context(other),
      ),
    ).toMatchObject({ activeReminder: false });
  });
  it("preserves update omission and does not rewrite old items on default changes", async () => {
    await setDefault(true);
    const reminder = await reminders.create(
      createReminderInputSchema.parse({ title: "Keep reminder" }),
      context(),
    );
    const task = await tasks.create(createTaskInputSchema.parse({ title: "Keep task" }), context());
    await setDefault(false);
    expect(
      await reminders.update(
        reminder.id,
        updateReminderInputSchema.parse({
          title: "Renamed",
          expectedUpdatedAt: reminder.updatedAt,
        }),
        context(),
      ),
    ).toMatchObject({ activeReminder: true });
    expect(
      await tasks.update(
        task.id,
        updateTaskInputSchema.parse({ title: "Renamed", expectedRevision: task.revision }),
        context(),
      ),
    ).toMatchObject({ activeReminder: true });
  });
  it("retains caller intent in idempotency replay after the default changes", async () => {
    await setDefault(true);
    const input = createTaskInputSchema.parse({ title: "Replay", idempotencyKey: randomUUID() });
    const created = await tasks.create(input, context());
    await setDefault(false);
    expect(await tasks.create(input, context())).toMatchObject({
      id: created.id,
      activeReminder: true,
    });
    await expect(
      tasks.create({ ...input, activeReminder: false }, context()),
    ).rejects.toMatchObject({ code: "conflict" });
  });
  it("uses normal concurrency and owner checks for flag updates and audits the flag", async () => {
    const reminder = await reminders.create(
      createReminderInputSchema.parse({ title: "Private title", activeReminder: true }),
      context(),
    );
    const changed = await reminders.update(
      reminder.id,
      updateReminderInputSchema.parse({
        activeReminder: false,
        expectedUpdatedAt: reminder.updatedAt,
      }),
      context(),
    );
    expect(changed).toMatchObject({ activeReminder: false });
    await expect(
      reminders.update(
        reminder.id,
        updateReminderInputSchema.parse({
          activeReminder: true,
          expectedUpdatedAt: reminder.updatedAt,
        }),
        context(),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      reminders.update(
        reminder.id,
        updateReminderInputSchema.parse({ activeReminder: true }),
        context(other),
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    const result = await database.pool.query(
      `SELECT after FROM audit_events WHERE entity_id=$1 AND action='reminder.updated'`,
      [reminder.id],
    );
    expect(result.rows.at(-1)?.after).toMatchObject({ activeReminder: false });
  });
});
