import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { createDatabaseClient, migrateDatabase } from "@personal-os/database";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { loadFinanceAuthorization, requireFinanceMutation } from "./finance/context.js";
import { migrationsWithout } from "./test-migrations.js";

const migrationsFolder = resolve(process.cwd(), "packages/database/migrations");

describe.sequential("global execution policy migration", () => {
  it("preserves only aligned grants and never confers budget activation authority", async () => {
    const container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    const database = createDatabaseClient(container.getConnectionUri());
    const beforePolicy = await migrationsWithout(migrationsFolder, "nohmi-execution-policy-", [
      "0083_global_execution_policy",
      "0084_finance_setup_profile_lineage",
      "0085_finance_context_capture",
    ]);
    try {
      await migrateDatabase(database.db, beforePolicy);
      const cases = [
        [true, true],
        [true, false],
        [false, true],
        [false, false],
        [true, null],
        [null, true],
        [false, null],
        [null, false],
        [null, null],
      ] as const;
      const fixtures = cases.map(([automation, agent]) => ({
        userId: crypto.randomUUID(),
        automation,
        agent,
      }));
      for (const fixture of fixtures) {
        await database.pool.query(
          `INSERT INTO users (id, email, password_hash, display_name) VALUES ($1, $2, 'unused', 'Migration')`,
          [fixture.userId, `${fixture.userId}@example.com`],
        );
        for (const [table, enabled] of [
          ["finance_automation_settings", fixture.automation],
          ["finance_agent_settings", fixture.agent],
        ] as const) {
          if (enabled !== null)
            await database.pool.query(
              `INSERT INTO ${table} (user_id, review_bypass_enabled) VALUES ($1, $2)`,
              [fixture.userId, enabled],
            );
        }
      }

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
        rows: fixtures
          .filter(({ automation, agent }) => automation !== null || agent !== null)
          .sort((a, b) => a.userId.localeCompare(b.userId))
          .map(({ userId, automation, agent }) => ({
            review_bypass_enabled: automation === true && agent === true,
            user_id: userId,
            version: 1,
          })),
      });
      for (const { userId, automation, agent } of fixtures) {
        const context = await loadFinanceAuthorization({
          db: database.db,
          principal: {
            actorId: "migration-agent",
            actorType: "agent",
            scopes: new Set(["finances:write"]),
            userId,
          },
          requestId: "migration-authority",
        });
        expect(context).toMatchObject({
          bypassEnabled: automation === true && agent === true,
          canMutate: true,
          canSelfApprove: false,
        });
        expect(() =>
          requireFinanceMutation(context, { approvalSource: "agent_self_approval" }),
        ).toThrow("explicit Finance budget activation policy");
      }
    } finally {
      await database.close();
      await container.stop();
      await rm(beforePolicy, { force: true, recursive: true });
    }
  }, 120_000);
});
