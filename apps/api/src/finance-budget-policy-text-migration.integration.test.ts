import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { createDatabaseClient, migrateDatabase } from "@personal-os/database";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { migrationsWithout } from "./test-migrations.js";

it("corrects published empty-text admission without weakening validation or rewriting history", async () => {
  const container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
  const database = createDatabaseClient(container.getConnectionUri());
  const folder = resolve(process.cwd(), "packages/database/migrations");
  const prior = await migrationsWithout(folder, "nohmi-policy-text-", [
    "0088_finance_budget_policy_nonempty_text",
    "0089_finance_contextual_questions",
  ]);
  const plan = {
    userId: randomUUID(),
    planId: randomUUID(),
    revision: { id: randomUUID(), revision: "1" },
    month: "2026-09",
    resources: [{ key: "income", kind: "income", sourceId: null, amountCents: 100 }],
    allocations: [{ key: "buffer", kind: "buffer", targetId: null, amountCents: 100 }],
  };
  const malformed = [
    { ...plan, resources: [{ ...plan.resources[0], key: "" }] },
    { ...plan, allocations: [{ ...plan.allocations[0], key: "" }] },
    { ...plan, revision: { ...plan.revision, revision: "" } },
  ];
  try {
    await migrateDatabase(database.db, prior);
    // Exercise the published 0087 validator in real PostgreSQL before the correction.
    expect(
      (await database.pool.query(`SELECT public.finance_budget_policy_text('""',80) AS valid`))
        .rows[0].valid,
    ).toBe(true);
    for (const packet of malformed) {
      expect(
        (
          await database.pool.query(
            "SELECT public.finance_budget_policy_json_valid($1,'plan') AS valid",
            [JSON.stringify(packet)],
          )
        ).rows[0].valid,
      ).toBe(true);
    }
    await migrateDatabase(database.db, folder);
    const client = await database.pool.connect();
    try {
      await client.query("CREATE SCHEMA hostile");
      await client.query(
        `CREATE FUNCTION hostile.finance_budget_policy_text(jsonb,integer,boolean DEFAULT true) RETURNS boolean LANGUAGE sql IMMUTABLE AS 'SELECT true'`,
      );
      await client.query(
        `CREATE FUNCTION hostile.regexp_split_to_table(text,text) RETURNS SETOF text LANGUAGE sql IMMUTABLE AS 'SELECT ''x'''`,
      );
      await client.query("SET search_path=hostile,public,pg_catalog");
      await client.query(
        "CREATE TEMP TABLE packets(value jsonb CHECK (public.finance_budget_policy_json_valid(value,'plan') IS TRUE))",
      );
      for (const packet of malformed) {
        await expect(
          client.query("INSERT INTO packets VALUES($1)", [JSON.stringify(packet)]),
        ).rejects.toMatchObject({ code: "23514" });
      }
      await client.query("INSERT INTO packets VALUES($1)", [JSON.stringify(plan)]);
      for (const [value, maximum, expected] of [
        ["", 80, false],
        ["a", 1, true],
        ["😀", 2, true],
        ["😀", 1, false],
        [" a", 80, false],
      ] as const) {
        expect(
          (
            await client.query("SELECT public.finance_budget_policy_text($1,$2) AS valid", [
              JSON.stringify(value),
              maximum,
            ])
          ).rows[0].valid,
        ).toBe(expected);
      }
      expect(
        (await client.query(`SELECT public.finance_budget_policy_text('""',80,false) AS valid`))
          .rows[0].valid,
      ).toBe(false);
      const fn = (
        await client.query(
          "SELECT proconfig,prosecdef,provolatile FROM pg_proc WHERE oid='public.finance_budget_policy_text(jsonb,integer,boolean)'::regprocedure",
        )
      ).rows[0];
      expect(fn).toMatchObject({
        proconfig: ["search_path=pg_catalog"],
        prosecdef: false,
        provolatile: "i",
      });
    } finally {
      client.release();
    }
  } finally {
    await rm(prior, { recursive: true, force: true });
    await database.close();
    await container.stop();
  }
}, 120_000);
