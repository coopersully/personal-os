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
  "0131_finance_institution_branding",
];

it.each([
  "main",
  "feature",
  "active-settings",
])("preserves historical material when upgrading the %s migration history", async (history) => {
  const folder = resolve("packages/database/migrations");
  const previous = await migrationsWithout(
    folder,
    "nohmi-active-reminders-",
    history === "active-settings"
      ? ["0131_finance_institution_branding", "0133_finance_branding_reconcile"]
      : [
          ...(history === "main" ? ["0124_active_reminders"] : mainHistory),
          "0131_active_reminders_reconcile",
        ],
    history === "active-settings"
      ? ["0131_active_reminders_reconcile", "0132_active_reminder_creation_defaults"]
      : history === "main"
        ? mainHistory
        : [],
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
    const item = randomUUID();
    await database.pool.query(
      "INSERT INTO finance_provider_items(id,user_id,provider,provider_item_id,encrypted_credentials) VALUES($1,$2,'plaid','historical-item','{}')",
      [item, owner],
    );
    if (history === "main") {
      await database.pool.query(
        "UPDATE finance_provider_items SET institution_id='ins_fixture', institution_branding=$2, branding_next_refresh_at='2026-11-01T12:00:00Z', branding_failure_code='unavailable' WHERE id=$1",
        [item, { name: "Historical bank" }],
      );
    }
    const itemBefore = (
      await database.pool.query("SELECT * FROM finance_provider_items WHERE id=$1", [item])
    ).rows;
    if (history !== "main") {
      await database.pool.query("UPDATE reminders SET active_reminder=true WHERE user_id=$1", [
        owner,
      ]);
      await database.pool.query(
        "INSERT INTO active_reminder_preferences(user_id,default_active_reminder,revision) VALUES($1,true,3)",
        [owner],
      );
    }
    if (history === "active-settings") {
      await database.pool.query(
        "UPDATE active_reminder_preferences SET default_task_active_reminder=true, default_reminder_active_reminder=false WHERE user_id=$1",
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
      history !== "main" ? [{ user_id: owner, default_active_reminder: true, revision: 3 }] : [],
    );
    expect(
      (await database.pool.query("SELECT * FROM finance_provider_items WHERE id=$1", [item])).rows,
    ).toEqual(
      itemBefore.map((row) => ({
        institution_id: null,
        institution_branding: null,
        branding_next_refresh_at: null,
        branding_failure_code: null,
        ...row,
      })),
    );
    if (history === "active-settings") {
      expect(
        (
          await database.pool.query(
            "SELECT default_task_active_reminder,default_reminder_active_reminder FROM active_reminder_preferences WHERE user_id=$1",
            [owner],
          )
        ).rows,
      ).toEqual([{ default_task_active_reminder: true, default_reminder_active_reminder: false }]);
    }
  } finally {
    await database.close();
    await container.stop();
    await rm(previous, { recursive: true, force: true });
  }
}, 120_000);
