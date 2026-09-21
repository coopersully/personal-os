import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { createDatabaseClient, type DatabaseClient, migrateDatabase } from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { evaluateFinanceBudgetPolicy } from "./finance/budget-policy-evaluator.js";
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
        `INSERT INTO finance_budget_policy_versions(user_id,policy_id,plan_id,version,baseline_budget_version_id,period_month,period_from,period_through,timezone,expires_at,per_change_cap_cents,monthly_cap_cents,currency,rollover,accounting,usage_scope,directions,protections,created_by_actor_id) VALUES($1,$2,$4,1,$3,'2026-09','2026-09-01','2026-09-30','UTC','2026-10-01',100,200,'USD','none','gross_positive_allocation_deltas','user_month_all_policy_versions','[]','[]',$1::uuid::text) RETURNING id`,
        [owner, policy, budget, plan],
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
        database.pool.query(
          "INSERT INTO finance_budget_policy_versions SELECT (jsonb_populate_record(NULL::finance_budget_policy_versions,to_jsonb(v)||jsonb_build_object('id',gen_random_uuid(),'version',2)||$2::jsonb)).* FROM finance_budget_policy_versions v WHERE id=$1",
          [version, JSON.stringify({ [String(field)]: value })],
        ),
      ).rejects.toThrow();
    }
    const candidate = {
      userId: owner,
      planId: plan,
      revision: { id: randomUUID(), revision: "1" },
      month: "2026-09",
      resources: [{ key: "income", kind: "income", sourceId: null, amountCents: 100 }],
      allocations: [{ key: "buffer", kind: "buffer", targetId: null, amountCents: 100 }],
    };
    const tuple = {
      userId: owner,
      planId: plan,
      policy: { id: version, revision: "1" },
      policyLifecycleRevision: 1,
      profile: null,
      baseline: { id: budget, revision: "1" },
      activeBudget: null,
      latestBudget: null,
      positionRevision: null,
      usageRevision: null,
    };
    const result = evaluateFinanceBudgetPolicy({
      evaluatedAt: "2026-09-20T00:00:00.000Z",
      terms: {
        currency: "USD",
        period: { from: "2026-09-01", through: "2026-09-30", timezone: "UTC" },
        rollover: "none",
        accounting: "gross_positive_allocation_deltas",
        usageScope: "user_month_all_policy_versions",
        perChangeCapCents: 100,
        monthlyCapCents: 200,
        expiresAt: "2026-10-01T00:00:00.000Z",
        baseline: tuple.baseline,
        directions: [],
        protections: [],
      },
      policyState: "draft",
      expected: tuple,
      observed: tuple,
      baseline: null,
      current: null,
      candidate,
      position: { state: "unavailable", reason: "producer_not_registered" },
      usage: { state: "unavailable", reason: "producer_not_registered" },
    });
    const proposal = (
      await database.pool.query(
        `INSERT INTO finance_budget_revision_proposals(user_id,policy_id,policy_version_id,plan_id,baseline_budget_version_id,candidate_snapshot,candidate_hash,state,lifecycle_revision,created_by_actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,'inactive',1,$1::uuid::text) RETURNING id`,
        [
          owner,
          policy,
          version,
          plan,
          budget,
          JSON.stringify(candidate),
          `sha256:${"a".repeat(64)}`,
        ],
      )
    ).rows[0].id;
    const previewSql = `INSERT INTO finance_budget_policy_previews(user_id,proposal_id,policy_version_id,policy_lifecycle_revision,proposal_lifecycle_revision,input_snapshot,result_snapshot,preview_hash,evaluated_at,expires_at,created_by_actor_id) VALUES($1,$2,$3,1,1,$4,$5,$6,'2026-09-20','2026-09-21',$1::uuid::text)`;
    const args = [
      owner,
      proposal,
      version,
      JSON.stringify(result.input),
      JSON.stringify(result),
      `sha256:${"b".repeat(64)}`,
    ];
    await database.pool.query(previewSql, args);
    await expect(database.pool.query(previewSql, [other, ...args.slice(1)])).rejects.toThrow();
    await expect(
      database.pool.query(previewSql, [
        owner,
        proposal,
        version,
        args[3],
        JSON.stringify({ ...result, executionAvailable: true }),
        args[5],
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
  it("enforces exact lifecycle transitions even under a hostile search path", async () => {
    const client = await database.pool.connect();
    try {
      await client.query("CREATE SCHEMA hostile");
      await client.query(
        `CREATE FUNCTION hostile.finance_budget_policy_object(jsonb,text[]) RETURNS boolean LANGUAGE sql IMMUTABLE AS 'SELECT true'`,
      );
      await client.query(
        `CREATE FUNCTION hostile.finance_budget_policy_json_valid(jsonb,text) RETURNS boolean LANGUAGE sql IMMUTABLE AS 'SELECT true'`,
      );
      await client.query(
        `CREATE FUNCTION hostile.to_jsonb(anyelement) RETURNS jsonb LANGUAGE sql IMMUTABLE AS 'SELECT ''{}''::jsonb'`,
      );
      await client.query("SET search_path = hostile, public, pg_catalog");
      expect(
        (await client.query("SELECT public.finance_budget_policy_json_valid('{}','ref') AS valid"))
          .rows[0].valid,
      ).toBe(false);
      await expect(
        client.query(
          "INSERT INTO public.finance_budget_policy_versions SELECT (jsonb_populate_record(NULL::public.finance_budget_policy_versions,pg_catalog.to_jsonb(v)||jsonb_build_object('id',gen_random_uuid(),'version',2,'directions','[{}]'::jsonb))).* FROM public.finance_budget_policy_versions v LIMIT 1",
        ),
      ).rejects.toMatchObject({ code: "23514" });
      const functions = (
        await client.query(
          "SELECT proconfig, prosecdef FROM pg_catalog.pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'finance_budget_policy_%'",
        )
      ).rows;
      expect(functions).toHaveLength(7);
      for (const fn of functions) {
        expect(fn.proconfig).toContain("search_path=pg_catalog");
        expect(fn.prosecdef).toBe(false);
      }
      for (const [table, terminal, attribution] of [
        ["finance_budget_policies", "disabled", "disabled"],
        ["finance_budget_revision_proposals", "withdrawn", "withdrawn"],
      ]) {
        const id = (
          await client.query(`SELECT id FROM public.${table} WHERE user_id=$1 LIMIT 1`, [owner])
        ).rows[0].id;
        if (terminal === "disabled") {
          await client.query(
            `UPDATE public.${table} SET updated_at=updated_at + interval '1 second' WHERE id=$1`,
            [id],
          );
          await expect(
            client.query(`UPDATE public.${table} SET lifecycle_revision=2 WHERE id=$1`, [id]),
          ).rejects.toMatchObject({ code: "23514" });
        }
        const transition = `UPDATE public.${table} SET state=$2,lifecycle_revision=$3,${attribution}_at=now(),${attribution}_by_actor_id=$4 WHERE id=$1`;
        for (const revision of [1, 3, 2147483647]) {
          await expect(
            client.query(transition, [id, terminal, revision, owner]),
          ).rejects.toMatchObject({ code: "23514" });
        }
        await client.query(transition, [id, terminal, 2, owner]);
        for (const change of [
          `${attribution}_by_actor_id='rewritten'`,
          `${attribution}_at=now() + interval '1 day'`,
          "lifecycle_revision=3",
          "updated_at=updated_at",
          "created_by_actor_id='rewritten'",
        ]) {
          await expect(
            client.query(`UPDATE public.${table} SET ${change} WHERE id=$1`, [id]),
          ).rejects.toMatchObject({ code: "23514" });
        }
        // INSERT a ceiling fixture: the transition comparison must reject with
        // the invariant SQLSTATE, never overflow its OLD + 1 expression.
        const ceiling = (
          await client.query(
            `INSERT INTO public.${table} SELECT (jsonb_populate_record(NULL::public.${table},pg_catalog.to_jsonb(v)||jsonb_build_object('id',gen_random_uuid(),'state',$2::text,'lifecycle_revision',2147483647,'${attribution}_at',NULL,'${attribution}_by_actor_id',NULL))).* FROM public.${table} v WHERE id=$1 RETURNING id`,
            [id, terminal === "disabled" ? "draft" : "inactive"],
          )
        ).rows[0].id;
        await expect(
          client.query(transition, [ceiling, terminal, 2147483647, owner]),
        ).rejects.toMatchObject({ code: "23514" });
      }
      await expect(
        client.query("UPDATE public.finance_budget_policy_versions SET version=version"),
      ).rejects.toMatchObject({ code: "23514" });
    } finally {
      await client.query("RESET search_path");
      await client.query("DROP SCHEMA IF EXISTS hostile CASCADE");
      client.release();
    }
  });
  it("admits owner deletion without preserving policy authority", async () => {
    await database.pool.query("DELETE FROM users WHERE id=$1", [owner]);
    expect(
      (await database.pool.query("SELECT count(*)::int AS count FROM finance_budget_policies"))
        .rows[0].count,
    ).toBe(0);
  });
});
