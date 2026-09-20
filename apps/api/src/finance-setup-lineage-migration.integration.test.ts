import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { createDatabaseClient, migrateDatabase } from "@personal-os/database";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { migrationsWithout } from "./test-migrations.js";

it("preserves legacy setup/profile rows without inferred lineage and enforces tenant references", async () => {
  const folder = resolve(process.cwd(), "packages/database/migrations");
  const prior = await migrationsWithout(folder, "nohmi-setup-lineage-", [
    "0084_finance_setup_profile_lineage",
    "0085_finance_context_capture",
    "0086_notification_foundation",
    "0087_finance_budget_policy_management",
  ]);
  const container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
  const database = createDatabaseClient(container.getConnectionUri());
  const owner = crypto.randomUUID();
  const other = crypto.randomUUID();
  const profile = crypto.randomUUID();
  try {
    await migrateDatabase(database.db, prior);
    for (const user of [owner, other])
      await database.pool.query(
        "INSERT INTO users(id,email,password_hash,display_name) VALUES ($1,$2,'unused','Migration')",
        [user, `${user}@example.com`],
      );
    await database.pool.query(
      "INSERT INTO finance_profile_versions(id,user_id,version,household_size) VALUES ($1,$2,1,2)",
      [profile, owner],
    );
    await database.pool.query(
      "INSERT INTO finance_setup_sessions(user_id,current_question_key) VALUES ($1,'profile:monthly_take_home')",
      [owner],
    );
    await migrateDatabase(database.db, folder);
    expect(
      (
        await database.pool.query(
          "SELECT planning,household_size FROM finance_profile_versions WHERE id=$1",
          [profile],
        )
      ).rows,
    ).toEqual([{ planning: null, household_size: 2 }]);
    expect(
      (
        await database.pool.query(
          "SELECT skipped_questions,question_profile_version_id,proposal_profile_version_id FROM finance_setup_sessions WHERE user_id=$1",
          [owner],
        )
      ).rows,
    ).toEqual([
      {
        skipped_questions: [],
        question_profile_version_id: null,
        proposal_profile_version_id: null,
      },
    ]);
    await expect(
      database.pool.query(
        "INSERT INTO finance_setup_sessions(user_id,question_profile_version_id) VALUES ($1,$2)",
        [other, profile],
      ),
    ).rejects.toMatchObject({ code: "23503" });
    await expect(
      database.pool.query(
        "INSERT INTO finance_setup_sessions(user_id,proposal_profile_version_id) VALUES ($1,$2)",
        [other, profile],
      ),
    ).rejects.toMatchObject({ code: "23503" });
    const plan = crypto.randomUUID();
    await database.pool.query("INSERT INTO finance_budget_plans(id,user_id) VALUES ($1,$2)", [
      plan,
      other,
    ]);
    await expect(
      database.pool.query(
        "INSERT INTO finance_budget_versions(plan_id,user_id,version,effective_from,expected_resources_cents,allocated_total_cents,balance_delta_cents,rationale,profile_version_id) VALUES ($1,$2,1,'2026-09',0,0,0,'Fixture',$3)",
        [plan, other, profile],
      ),
    ).rejects.toMatchObject({ code: "23503" });
  } finally {
    await database.close();
    await container.stop();
    await rm(prior, { recursive: true, force: true });
  }
}, 120_000);
