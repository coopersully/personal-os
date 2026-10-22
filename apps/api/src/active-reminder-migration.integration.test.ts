import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { createDatabaseClient, migrateDatabase } from "@personal-os/database";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { migrationsWithout } from "./test-migrations.js";

it("adds inactive flags and preference storage without changing historical material", async () => {
  const folder = resolve("packages/database/migrations");
  const previous = await migrationsWithout(folder, "nohmi-active-reminders-", [
    "0124_active_reminders",
  ]);
  const container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
  const database = createDatabaseClient(container.getConnectionUri());
  try {
    await migrateDatabase(database.db, previous);
    const owner = randomUUID();
    await database.pool.query(
      "INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,'Fixture','unused')",
      [owner, `${owner}@example.test`],
    );
    await database.pool.query(
      "INSERT INTO reminders(user_id,title,notes,due_at) VALUES($1,'Historical','Keep notes','2025-01-01T12:00:00Z')",
      [owner],
    );
    const before = (await database.pool.query("SELECT * FROM reminders WHERE user_id=$1", [owner]))
      .rows;
    await migrateDatabase(database.db, folder);
    await migrateDatabase(database.db, folder);
    expect(
      (await database.pool.query("SELECT * FROM reminders WHERE user_id=$1", [owner])).rows,
    ).toEqual(before.map((row) => ({ ...row, active_reminder: false })));
    expect((await database.pool.query("SELECT * FROM active_reminder_preferences")).rows).toEqual(
      [],
    );
  } finally {
    await database.close();
    await container.stop();
    await rm(previous, { recursive: true, force: true });
  }
}, 120_000);
