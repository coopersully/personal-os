import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { createDatabaseClient, migrateDatabase } from "@personal-os/database";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { describe, expect, it } from "vitest";
import { migrationsWithout } from "./test-migrations.js";

describe.sequential("Finance account-semantics migration recovery", () => {
  it("applies the published Finance transition after a texting-only migration cursor", async () => {
    const container = await new PostgreSqlContainer("postgres:17.5-alpine")
      .withDatabase("personal_os")
      .withUsername("personal_os")
      .withPassword("personal_os")
      .start();
    const database = createDatabaseClient(container.getConnectionUri());
    const migrationsFolder = resolve(process.cwd(), "packages/database/migrations");
    const textingOnlyMigrations = await migrationsWithout(
      migrationsFolder,
      "ilo-finance-account-semantics-recovery-",
<<<<<<< HEAD
      [
        "0072_finance_account_semantics",
        "0073_finance_account_semantics_recovery",
        "0074_finance_budget_buckets",
      ],
=======
      ["0072_finance_account_semantics", "0073_finance_account_semantics_recovery"],
>>>>>>> origin/main
    );

    try {
      await migrateDatabase(database.db, textingOnlyMigrations);
      await expect(
        database.pool.query<{ column_name: string }>(
          `SELECT column_name
           FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'finance_accounts'
             AND column_name = 'kind_source'`,
        ),
      ).resolves.toMatchObject({ rows: [] });

      const user = await database.pool.query<{ id: string }>(
        `INSERT INTO users (email, password_hash, display_name)
         VALUES ('finance-migration-recovery@example.com', 'unused', 'Finance migration recovery')
         RETURNING id`,
      );
      const userId = user.rows[0]?.id;
      if (!userId) throw new Error("Finance migration recovery user was not created.");
      await database.pool.query(
        `INSERT INTO finance_accounts (user_id, provider, institution, name)
         VALUES ($1, 'manual', 'Recovery Bank', 'Existing account')`,
        [userId],
      );

      await migrateDatabase(database.db, migrationsFolder);

      await expect(
        database.pool.query<{
          include_in_planning: boolean;
          kind_source: string;
          ownership_share_bps: number | null;
          ownership_type: string;
          provider_subtype: string | null;
          provider_type: string | null;
        }>(
          `SELECT kind_source, provider_type, provider_subtype, include_in_planning,
                  ownership_type, ownership_share_bps
           FROM finance_accounts
           WHERE user_id = $1`,
          [userId],
        ),
      ).resolves.toMatchObject({
        rows: [
          {
            include_in_planning: true,
            kind_source: "default",
            ownership_share_bps: null,
            ownership_type: "unknown",
            provider_subtype: null,
            provider_type: null,
          },
        ],
      });
      await expect(
        database.pool.query<{ conname: string }>(
          `SELECT conname
           FROM pg_constraint
           WHERE conname IN (
             'finance_accounts_kind_source_check',
             'finance_accounts_provider_type_check',
             'finance_accounts_ownership_check'
           )
           ORDER BY conname`,
        ),
      ).resolves.toMatchObject({
        rows: [
          { conname: "finance_accounts_kind_source_check" },
          { conname: "finance_accounts_ownership_check" },
          { conname: "finance_accounts_provider_type_check" },
        ],
      });
    } finally {
      await database.close();
      await container.stop();
      await rm(textingOnlyMigrations, { force: true, recursive: true });
    }
  }, 120_000);
});
