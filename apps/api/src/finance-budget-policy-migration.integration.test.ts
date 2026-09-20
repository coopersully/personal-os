import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { createDatabaseClient, type DatabaseClient, migrateDatabase } from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { migrationsWithout } from "./test-migrations.js";

describe.sequential("budget policy management migration", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  const owner = randomUUID();
  const other = randomUUID();
  const plan = randomUUID();
  const foreignPlan = randomUUID();
  let historical: unknown[];
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    const folder = resolve(process.cwd(), "packages/database/migrations");
    const prior = await migrationsWithout(
      folder,
      "nohmi-budget-policy-",
      existsSync(resolve(folder, "0087_finance_budget_policy_management.sql"))
        ? ["0087_finance_budget_policy_management"]
        : [],
    );
    try {
      await migrateDatabase(database.db, prior);
      for (const [userId, planId] of [
        [owner, plan],
        [other, foreignPlan],
      ]) {
        await database.pool.query(
          "INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,'Test','unused')",
          [userId, `${userId}@example.test`],
        );
        await database.pool.query("INSERT INTO finance_budget_plans(id,user_id) VALUES($1,$2)", [
          planId,
          userId,
        ]);
      }
      for (const [version, status] of [
        [1, "retired"],
        [2, "active"],
      ]) {
        await database.pool.query(
          "INSERT INTO finance_budget_versions(plan_id,user_id,version,status,effective_from,expected_resources_cents,allocated_total_cents,balance_delta_cents,rationale,approved_by_actor_type,approved_by_actor_id,approved_at) VALUES($1,$2,$3,$4,'2026-09',100,100,0,'Original human budget','user',$2::uuid::text,now())",
          [plan, owner, version, status],
        );
      }
      historical = (
        await database.pool.query("SELECT * FROM finance_budget_versions ORDER BY version")
      ).rows;
      await migrateDatabase(database.db, folder);
    } finally {
      await rm(prior, { recursive: true, force: true });
    }
  }, 120_000);
  afterAll(async () => {
    await database?.close();
    await container?.stop();
  });
  it("preserves historical approvals and creates no policies or baselines", async () => {
    expect(
      (await database.pool.query("SELECT * FROM finance_budget_versions ORDER BY version")).rows,
    ).toEqual(historical);
    for (const table of [
      "finance_budget_policies",
      "finance_budget_policy_versions",
      "finance_budget_revision_proposals",
      "finance_budget_policy_previews",
      "finance_budget_period_baselines",
    ])
      expect(
        (await database.pool.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count,
      ).toBe(0);
  });
  it("rejects cross-tenant policies and active authority", async () => {
    const insert =
      "INSERT INTO finance_budget_policies(user_id,plan_id,lifecycle_revision,state,created_by_actor_id) VALUES($1,$2,1,$3,$1::uuid::text)";
    await expect(database.pool.query(insert, [owner, foreignPlan, "draft"])).rejects.toThrow();
    await expect(database.pool.query(insert, [owner, plan, "active"])).rejects.toThrow();
    await expect(database.pool.query(insert, [owner, plan, "disabled"])).rejects.toThrow();
    await database.pool.query(insert, [owner, plan, "draft"]);
  });
  it("keeps the full history tenant-bound, bounded and deletable with its owner", async () => {
    const policy = (
      await database.pool.query("SELECT id FROM finance_budget_policies WHERE user_id=$1", [owner])
    ).rows[0].id;
    const budget = (historical[0] as { id: string }).id;
    const version = (
      await database.pool.query(
        `INSERT INTO finance_budget_policy_versions(user_id,policy_id,version,baseline_budget_version_id,period_month,period_from,period_through,timezone,expires_at,per_change_cap_cents,monthly_cap_cents,currency,rollover,accounting,usage_scope,directions,protections,created_by_actor_id) VALUES($1,$2,1,$3,'2026-09','2026-09-01','2026-09-30','UTC','2026-10-01',100,200,'USD','none','gross_positive_allocation_deltas','user_month_all_policy_versions','[]','[]',$1::uuid::text) RETURNING id`,
        [owner, policy, budget],
      )
    ).rows[0].id;
    for (const [field, value] of [
      ["per_change_cap_cents", -1],
      ["monthly_cap_cents", -1],
      ["version", 0],
      ["rollover", "carry"],
      ["currency", "EUR"],
      ["period_through", "2026-09-29"],
      ["directions", {}],
    ]) {
      await expect(
        database.pool.query(`UPDATE finance_budget_policy_versions SET ${field}=$1 WHERE id=$2`, [
          typeof value === "object" ? JSON.stringify(value) : value,
          version,
        ]),
      ).rejects.toThrow();
    }
    const proposal = (
      await database.pool.query(
        `INSERT INTO finance_budget_revision_proposals(user_id,policy_id,policy_version_id,plan_id,baseline_budget_version_id,candidate_snapshot,candidate_hash,state,lifecycle_revision,created_by_actor_id) VALUES($1,$2,$3,$4,$5,'{}',$6,'inactive',1,$1::uuid::text) RETURNING id`,
        [owner, policy, version, plan, budget, `sha256:${"a".repeat(64)}`],
      )
    ).rows[0].id;
    const previewSql = `INSERT INTO finance_budget_policy_previews(user_id,proposal_id,policy_version_id,policy_lifecycle_revision,proposal_lifecycle_revision,input_snapshot,result_snapshot,preview_hash,evaluated_at,expires_at,created_by_actor_id) VALUES($1,$2,$3,1,1,'{}',$4,$5,'2026-09-20','2026-09-21',$1::uuid::text)`;
    const args = [
      owner,
      proposal,
      version,
      JSON.stringify({ kind: "denied", executionAvailable: false }),
      `sha256:${"b".repeat(64)}`,
    ];
    await database.pool.query(previewSql, args);
    await expect(database.pool.query(previewSql, [other, ...args.slice(1)])).rejects.toThrow();
    await expect(
      database.pool.query(previewSql, [
        owner,
        proposal,
        version,
        JSON.stringify({ kind: "hypothetical_preview", executionAvailable: true }),
        args[4],
      ]),
    ).rejects.toThrow();
    await expect(
      database.pool.query("DELETE FROM finance_budget_revision_proposals WHERE id=$1", [proposal]),
    ).rejects.toThrow();
    await database.pool.query(
      `INSERT INTO finance_budget_period_baselines(user_id,plan_id,period_month,period_from,period_through,timezone,budget_version_id,confirmed_by_actor_id,confirmed_at) VALUES($1,$2,'2026-09','2026-09-01','2026-09-30','UTC',$3,$1::uuid::text,now())`,
      [owner, plan, budget],
    );
    await expect(
      database.pool.query(
        `INSERT INTO finance_budget_period_baselines(user_id,plan_id,period_month,period_from,period_through,timezone,budget_version_id,confirmed_by_actor_id,confirmed_at) VALUES($1,$2,'2026-09','2026-09-01','2026-09-30','America/New_York',$3,$1::uuid::text,now())`,
        [owner, plan, budget],
      ),
    ).rejects.toThrow();
  });
  it("admits owner deletion without preserving policy authority", async () => {
    await database.pool.query("DELETE FROM users WHERE id=$1", [owner]);
    expect(
      (await database.pool.query("SELECT count(*)::int AS count FROM finance_budget_policies"))
        .rows[0].count,
    ).toBe(0);
  });
});
