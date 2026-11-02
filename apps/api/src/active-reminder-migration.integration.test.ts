import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { createDatabaseClient, migrateDatabase } from "@personal-os/database";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { migrationsWithout } from "./test-migrations.js";

const mainHistory = [
  "0124_finance_transaction_coverage",
  "0125_finance_bypass_confirmation_provenance",
  "0126_finance_spending_list_default",
  "0127_finance_spending_week_default",
  "0128_shared_agent_accounts",
  "0129_finance_review_batches",
  "0130_finance_provider_account_identity",
];

it.each([
  "main",
  "feature",
])("preserves historical material when upgrading the %s migration history", async (history) => {
  const folder = resolve("packages/database/migrations");
  const previous = await migrationsWithout(
    folder,
    "nohmi-active-reminders-",
    [
      ...(history === "main" ? ["0124_active_reminders"] : mainHistory),
      "0131_active_reminders_reconcile",
    ],
    history === "main" ? mainHistory : [],
  );
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
    if (history === "feature") {
      await database.pool.query("UPDATE reminders SET active_reminder=true WHERE user_id=$1", [
        owner,
      ]);
      await database.pool.query(
        "INSERT INTO active_reminder_preferences(user_id,default_active_reminder,revision) VALUES($1,true,3)",
        [owner],
      );
    }
    const before = (await database.pool.query("SELECT * FROM reminders WHERE user_id=$1", [owner]))
      .rows;
    await migrateDatabase(database.db, folder);
    await migrateDatabase(database.db, folder);
    expect(
      (await database.pool.query("SELECT * FROM reminders WHERE user_id=$1", [owner])).rows,
    ).toEqual(before.map((row) => ({ active_reminder: false, ...row })));
    expect(
      (
        await database.pool.query(
          "SELECT user_id,default_active_reminder,revision FROM active_reminder_preferences",
        )
      ).rows,
    ).toEqual(
      history === "feature" ? [{ user_id: owner, default_active_reminder: true, revision: 3 }] : [],
    );
  } finally {
    await database.close();
    await container.stop();
    await rm(previous, { recursive: true, force: true });
  }
}, 120_000);
