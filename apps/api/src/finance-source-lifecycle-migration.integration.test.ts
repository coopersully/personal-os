import { access, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { createDatabaseClient, migrateDatabase } from "@personal-os/database";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { migrationsWithout } from "./test-migrations.js";

const migrationsFolder = resolve(process.cwd(), "packages/database/migrations");
const migrationTag = "0081_finance_legacy_disconnect_repair";
const migrationPath = resolve(migrationsFolder, `${migrationTag}.sql`);

describe.sequential("Finance source lifecycle migration", () => {
  it("detaches legacy disconnected accounts and deletes only orphaned credential Items", async () => {
    await expect(access(migrationPath)).resolves.toBeUndefined();
    const container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    const database = createDatabaseClient(container.getConnectionUri());
    const beforeRepair = await migrationsWithout(migrationsFolder, "nohmi-source-repair-", [
      migrationTag,
      "0082_finance_maintenance_lineage",
      "0083_global_execution_policy",
      "0084_finance_setup_profile_lineage",
      "0085_finance_context_capture",
      "0086_notification_foundation",
      "0087_finance_budget_policy_management",
      "0088_finance_budget_policy_nonempty_text",
      "0089_finance_contextual_questions",
    ]);

    try {
      await migrateDatabase(database.db, beforeRepair);
      const user = await database.pool.query<{ id: string }>(
        `INSERT INTO users (email, password_hash, display_name)
         VALUES ('finance-source-repair@example.com', 'unused', 'Finance source repair')
         RETURNING id`,
      );
      const userId = user.rows[0]?.id;
      if (!userId) throw new Error("Finance source repair user was not created.");
      const foreignUser = await database.pool.query<{ id: string }>(
        `INSERT INTO users (email, password_hash, display_name)
         VALUES ('finance-source-repair-foreign@example.com', 'unused', 'Foreign source owner')
         RETURNING id`,
      );
      const foreignUserId = foreignUser.rows[0]?.id;
      if (!foreignUserId) throw new Error("Foreign source owner was not created.");

      const items = await database.pool.query<{ id: string; provider_item_id: string }>(
        `INSERT INTO finance_provider_items (
           user_id, provider, provider_item_id, encrypted_credentials, sync_state, next_sync_at
         ) VALUES
           ($1, 'plaid', 'legacy-final', '{"value":"final"}'::jsonb, 'current', NOW()),
           ($1, 'plaid', 'legacy-siblings', '{"value":"siblings"}'::jsonb, 'current', NOW()),
           ($1, 'plaid', 'unrelated-orphan', '{"value":"unrelated"}'::jsonb, 'current', NOW())
         RETURNING id, provider_item_id`,
        [userId],
      );
      const finalItemId = items.rows.find((row) => row.provider_item_id === "legacy-final")?.id;
      const siblingItemId = items.rows.find(
        (row) => row.provider_item_id === "legacy-siblings",
      )?.id;
      if (!finalItemId || !siblingItemId) throw new Error("Finance source repair Items missing.");
      const foreignItem = await database.pool.query<{ id: string }>(
        `INSERT INTO finance_provider_items (
           user_id, provider, provider_item_id, encrypted_credentials, sync_state, next_sync_at
         ) VALUES ($1, 'plaid', 'foreign-orphan', '{"value":"foreign"}'::jsonb, 'current', NOW())
         RETURNING id`,
        [foreignUserId],
      );
      const foreignItemId = foreignItem.rows[0]?.id;
      if (!foreignItemId) throw new Error("Foreign source Item was not created.");

      await database.pool.query(
        `INSERT INTO finance_accounts (
           user_id, institution, name, provider, status, provider_account_id, provider_item_id,
           provider_item_record_id, encrypted_credentials, sync_state, next_sync_at
         ) VALUES
           ($1, 'Fixture Bank', 'Legacy final', 'plaid', 'needs_reauth', NULL, NULL,
            $2, NULL, 'current', NOW()),
           ($1, 'Fixture Bank', 'Legacy sibling', 'plaid', 'needs_reauth', NULL, NULL,
            $3, NULL, 'current', NOW()),
           ($1, 'Fixture Bank', 'Legacy foreign pointer', 'plaid', 'needs_reauth', NULL, NULL,
            $4, NULL, 'current', NOW()),
           ($1, 'Fixture Bank', 'Connected sibling', 'plaid', 'connected', 'remote-sibling',
            'legacy-siblings', $3, NULL, 'current', NOW())`,
        [userId, finalItemId, siblingItemId, foreignItemId],
      );

      await migrateDatabase(database.db, migrationsFolder);

      await expect(
        database.pool.query<{
          name: string;
          next_sync_at: Date | null;
          provider_item_record_id: string | null;
          sync_error_code: string | null;
          sync_recovery: string | null;
          sync_state: string;
        }>(
          `SELECT name, provider_item_record_id, sync_state, sync_error_code, sync_recovery,
                  next_sync_at
           FROM finance_accounts
           WHERE user_id = $1
           ORDER BY name`,
          [userId],
        ),
      ).resolves.toMatchObject({
        rows: [
          {
            name: "Connected sibling",
            provider_item_record_id: siblingItemId,
            sync_error_code: null,
            sync_recovery: null,
            sync_state: "current",
          },
          {
            name: "Legacy final",
            next_sync_at: null,
            provider_item_record_id: null,
            sync_error_code: "finance_account_legacy_disconnected",
            sync_recovery: "reconnect",
            sync_state: "blocked",
          },
          {
            name: "Legacy foreign pointer",
            next_sync_at: null,
            provider_item_record_id: null,
            sync_error_code: "finance_account_legacy_disconnected",
            sync_recovery: "reconnect",
            sync_state: "blocked",
          },
          {
            name: "Legacy sibling",
            next_sync_at: null,
            provider_item_record_id: null,
            sync_error_code: "finance_account_legacy_disconnected",
            sync_recovery: "reconnect",
            sync_state: "blocked",
          },
        ],
      });
      await expect(
        database.pool.query<{ provider_item_id: string }>(
          `SELECT provider_item_id FROM finance_provider_items
           WHERE user_id = $1
           ORDER BY provider_item_id`,
          [userId],
        ),
      ).resolves.toMatchObject({
        rows: [{ provider_item_id: "legacy-siblings" }, { provider_item_id: "unrelated-orphan" }],
      });
      await expect(
        database.pool.query<{ provider_item_id: string }>(
          `SELECT provider_item_id FROM finance_provider_items WHERE user_id = $1`,
          [foreignUserId],
        ),
      ).resolves.toMatchObject({ rows: [{ provider_item_id: "foreign-orphan" }] });
    } finally {
      await database.close();
      await container.stop();
      await rm(beforeRepair, { force: true, recursive: true });
    }
  }, 120_000);
});
