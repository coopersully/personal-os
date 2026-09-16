import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { createDatabaseClient, migrateDatabase } from "@personal-os/database";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { migrationsWithout } from "./test-migrations.js";

const migrationsFolder = resolve(process.cwd(), "packages/database/migrations");

describe.sequential("global execution policy migration", () => {
  it("preserves an explicit grant from either legacy Finance setting", async () => {
    const container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    const database = createDatabaseClient(container.getConnectionUri());
    const beforePolicy = await migrationsWithout(migrationsFolder, "nohmi-execution-policy-", [
      "0083_global_execution_policy",
    ]);
    try {
      await migrateDatabase(database.db, beforePolicy);
      const automationGrant = crypto.randomUUID();
      const agentGrant = crypto.randomUUID();
      const disabled = crypto.randomUUID();
      await database.pool.query(
        `INSERT INTO users (id, email, password_hash, display_name)
         VALUES ($1, 'automation-grant@example.com', 'unused', 'Automation grant'),
                ($2, 'agent-grant@example.com', 'unused', 'Agent grant'),
                ($3, 'disabled@example.com', 'unused', 'Disabled')`,
        [automationGrant, agentGrant, disabled],
      );
      await database.pool.query(
        `INSERT INTO finance_automation_settings (user_id, review_bypass_enabled)
         VALUES ($1, true), ($2, false), ($3, false)`,
        [automationGrant, agentGrant, disabled],
      );
      await database.pool.query(
        `INSERT INTO finance_agent_settings (user_id, review_bypass_enabled)
         VALUES ($1, false), ($2, true), ($3, false)`,
        [automationGrant, agentGrant, disabled],
      );

      await migrateDatabase(database.db, migrationsFolder);

      await expect(
        database.pool.query<{
          review_bypass_enabled: boolean;
          user_id: string;
          version: number;
        }>(
          `SELECT user_id, review_bypass_enabled, version
           FROM execution_policy_settings
           ORDER BY user_id`,
        ),
      ).resolves.toMatchObject({
        rows: [automationGrant, agentGrant, disabled].sort().map((userId) => ({
          review_bypass_enabled: userId !== disabled,
          user_id: userId,
          version: 1,
        })),
      });
    } finally {
      await database.close();
      await container.stop();
      await rm(beforePolicy, { force: true, recursive: true });
    }
  }, 120_000);
});
