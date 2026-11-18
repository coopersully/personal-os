import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { createDatabaseClient, migrateDatabase } from "@personal-os/database";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { prepareBaselineEvidence } from "./finance/baseline-qualification-evidence.js";
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
    // Seed the 0123-era contract: qualifications have an owner ID but no actor-type column.
    // Use the historical defaults for optional fields and derive evidence from persisted sources.
    const plan = await database.pool.query<{ id: string }>(
      "INSERT INTO finance_budget_plans (user_id) VALUES ($1) RETURNING id",
      [one],
    );
    const cash = await database.pool.query<{ id: string }>(
      "INSERT INTO finance_accounts (user_id,provider,institution,name,currency_code) VALUES ($1,'manual','Fixture','Baseline cash','USD') RETURNING id",
      [one],
    );
    const planId = plan.rows[0]?.id;
    const accountId = cash.rows[0]?.id;
    if (!planId || !accountId) throw new Error("Missing baseline sources");
    const budget = await database.pool.query<{ id: string }>(
      `INSERT INTO finance_budget_versions
        (user_id,plan_id,version,status,effective_from,expected_resources_cents,allocated_total_cents,
         balance_delta_cents,resources,rationale,approved_by_actor_type,approved_by_actor_id,approved_at)
       VALUES ($1,$2,1,'active','2026-10',10000,10000,0,$3,'Existing human budget','user',$1::uuid::text,'2026-10-01T12:00:00Z')
       RETURNING *`,
      [one, planId, JSON.stringify([{ key: "income", kind: "income", amount: 10000 }])],
    );
    const budgetVersionId = budget.rows[0]?.id;
    if (!budgetVersionId) throw new Error("Missing baseline budget");
    await database.pool.query(
      `INSERT INTO finance_budget_allocations
        (user_id,budget_version_id,allocation_key,kind,amount_cents,legacy_category)
       VALUES ($1,$2,'food','spending',10000,'Food')`,
      [one, budgetVersionId],
    );
    const evidence = await database.db.transaction((tx) =>
      prepareBaselineEvidence(tx, one, {
        budgetVersionId,
        accountIds: [accountId],
        currency: "USD",
        month: "2026-10",
        timezone: "UTC",
      }),
    );
    const review = await database.pool.query<{ id: string }>(
      `INSERT INTO finance_budget_baseline_reviews
        (user_id,period_month,plan_id,budget_version_id,snapshot,fingerprint,source_fingerprint,created_at)
       VALUES ($1,'2026-10',$2,$3,$4,$5,$6,'2026-10-02T12:00:00Z') RETURNING *`,
      [
        one,
        planId,
        budgetVersionId,
        evidence.snapshot,
        evidence.fingerprint,
        evidence.sourceFingerprint,
      ],
    );
    const reviewId = review.rows[0]?.id;
    if (!reviewId) throw new Error("Missing baseline review");
    const qualification = await database.pool.query(
      `INSERT INTO finance_budget_baseline_qualifications
        (user_id,period_month,review_id,snapshot,fingerprint,confirmed_by_actor_id,confirmed_at,qualification_kind)
       VALUES ($1,'2026-10',$2,$3,$4,$1::uuid::text,'2026-10-02T12:01:00Z','current') RETURNING *`,
      [one, reviewId, evidence.snapshot, evidence.fingerprint],
    );
    expect(qualification.rows).toHaveLength(1);
    expect(qualification.rows[0]).not.toHaveProperty("confirmed_by_actor_type");
    for (const pass of ["upgrade", "idempotent rerun"]) {
      await migrateDatabase(database.db, folder);
      expect(
        (
          await database.pool.query(
            "SELECT * FROM finance_budget_baseline_qualifications WHERE user_id=$1",
            [one],
          )
        ).rows,
        pass,
      ).toEqual([{ ...qualification.rows[0], confirmed_by_actor_type: "user" }]);
      expect(
        (
          await database.pool.query(
            "SELECT * FROM finance_budget_baseline_reviews WHERE user_id=$1",
            [one],
          )
        ).rows,
      ).toEqual(review.rows);
      expect(
        (await database.pool.query("SELECT * FROM finance_budget_versions WHERE user_id=$1", [one]))
          .rows,
      ).toEqual(budget.rows);
    }
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
