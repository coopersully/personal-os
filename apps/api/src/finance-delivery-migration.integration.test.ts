import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { createDatabaseClient, migrateDatabase } from "@personal-os/database";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { migrationsWithout } from "./test-migrations.js";

it("upgrades existing Finance evidence and preferences without rewriting owner choices", async () => {
  const folder = resolve(process.cwd(), "packages/database/migrations");
  const historical = await migrationsWithout(folder, "nohmi-finance-delivery-upgrade-", [
    "0124_finance_transaction_coverage",
    "0125_finance_bypass_confirmation_provenance",
    "0126_finance_spending_list_default",
    "0127_finance_spending_week_default",
    "0128_shared_agent_accounts",
    "0129_finance_review_batches",
  ]);
  const container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
  const database = createDatabaseClient(container.getConnectionUri());
  try {
    await migrateDatabase(database.db, historical);
    const owners = await database.pool.query<{ id: string }>(
      "INSERT INTO users (email,password_hash,display_name) VALUES ('upgrade-one@nohmi.test','unused','One'),('upgrade-two@nohmi.test','unused','Two') RETURNING id",
    );
    const one = owners.rows[0]?.id;
    const two = owners.rows[1]?.id;
    if (!one || !two) throw new Error("Missing owners");
    await database.pool.query(
      "INSERT INTO finances_workspace_settings (user_id,finance_spending_view,finance_spending_period) VALUES ($1,'bubbles','month')",
      [one],
    );
    const goals = await database.pool.query<{ id: string }>(
      "INSERT INTO finance_goals (user_id,name,target_amount_cents) VALUES ($1,'Existing goal',10000) RETURNING id",
      [one],
    );
    await database.pool.query(
      "INSERT INTO finance_planning_evidence (user_id,goal_id,source_revision,amount_cents,currency_code,as_of,actor_user_id) VALUES ($1,$2,1,2500,'USD','2026-10-01',$1)",
      [one, goals.rows[0]?.id],
    );
    await migrateDatabase(database.db, folder);
    await migrateDatabase(database.db, folder);
    expect(
      (
        await database.pool.query(
          "SELECT finance_spending_view,finance_spending_period FROM finances_workspace_settings WHERE user_id=$1",
          [one],
        )
      ).rows,
    ).toEqual([{ finance_spending_view: "bubbles", finance_spending_period: "month" }]);
    await database.pool.query("INSERT INTO finances_workspace_settings (user_id) VALUES ($1)", [
      two,
    ]);
    expect(
      (
        await database.pool.query(
          "SELECT finance_spending_view,finance_spending_period FROM finances_workspace_settings WHERE user_id=$1",
          [two],
        )
      ).rows,
    ).toEqual([{ finance_spending_view: "list", finance_spending_period: "week" }]);
    expect(
      (
        await database.pool.query(
          "SELECT actor_user_id,approval_actor,amount_cents FROM finance_planning_evidence WHERE user_id=$1",
          [one],
        )
      ).rows,
    ).toEqual([{ actor_user_id: one, approval_actor: null, amount_cents: "2500" }]);
    expect(
      (await database.pool.query("SELECT count(*) FROM finance_transaction_coverage")).rows[0]
        ?.count,
    ).toBe("0");
    const accounts = await database.pool.query<{ id: string }>(
      "INSERT INTO agent_accounts (user_id,display_name) VALUES ($1,'Existing owner agent') RETURNING id",
      [one],
    );
    await expect(
      database.pool.query(
        "INSERT INTO agent_account_connections (user_id,authorization_connection_id,agent_account_id) VALUES ($1,gen_random_uuid(),$2)",
        [two, accounts.rows[0]?.id],
      ),
    ).rejects.toMatchObject({ code: "23503" });
  } finally {
    await database.close();
    await container.stop();
    await rm(historical, { recursive: true, force: true });
  }
}, 120_000);
