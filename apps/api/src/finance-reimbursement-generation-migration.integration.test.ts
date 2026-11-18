import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { createDatabaseClient, type DatabaseClient, migrateDatabase } from "@personal-os/database";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { describe, expect, it } from "vitest";
import { createFinanceReimbursementService } from "./finance-reimbursement-service.js";
import { migrationsWithout } from "./test-migrations.js";
import type { Principal } from "./types.js";

const migrationsFolder = resolve(process.cwd(), "packages/database/migrations");
const migrationTag = "0122_finance_reimbursement_relationship_generation";
const now = new Date("2026-10-18T12:00:00Z");
const evidence = { summary: "Person corrected the historical receipt", sourceRefs: [] };

// Raw historical inserts intentionally do not reference any post-0121 column.
async function historicalFixture(database: DatabaseClient) {
  const owner = crypto.randomUUID();
  const account = crypto.randomUUID();
  const category = crypto.randomUUID();
  const expense = crypto.randomUUID();
  const credit = crypto.randomUUID();
  const unmatched = crypto.randomUUID();
  const allocation = crypto.randomUUID();
  const claim = crypto.randomUUID();
  const match = crypto.randomUUID();
  await database.pool.query(
    "INSERT INTO users(id,email,password_hash,display_name) VALUES($1,$2,'unused','Historical owner')",
    [owner, `generation-upgrade-${owner}@example.com`],
  );
  await database.pool.query(
    "INSERT INTO finance_accounts(id,user_id,provider,institution,name) VALUES($1,$2,'manual','Historical bank','Cash')",
    [account, owner],
  );
  await database.pool.query(
    "INSERT INTO finance_categories(id,user_id,name,slug,\"group\") VALUES($1,$2,'Shared','shared','expenses')",
    [category, owner],
  );
  await database.pool.query(
    `INSERT INTO finance_transactions(id,user_id,account_id,amount_cents,currency_code,direction,merchant,transaction_date)
     VALUES($1,$4,$5,20000,'EUR','expense','Shared meal','2026-10-01'),
           ($2,$4,$5,5000,'EUR','income','Repayment','2026-10-05'),
           ($3,$4,$5,1000,'EUR','income','Unmatched credit','2026-10-06')`,
    [expense, credit, unmatched, owner, account],
  );
  await database.pool.query(
    `INSERT INTO finance_transaction_allocations(id,user_id,transaction_id,category_id,amount_cents,allocation_order,treatment)
     VALUES($1,$2,$3,$4,10000,0,'reimbursable')`,
    [allocation, owner, expense, category],
  );
  await database.pool.query(
    `INSERT INTO finance_reimbursements(id,user_id,allocation_id,expected_amount_cents,received_amount_cents,status,payer,rationale,evidence)
     VALUES($1,$2,$3,10000,5000,'partially_received','Alex','Historical shared meal',$4::jsonb)`,
    [claim, owner, allocation, JSON.stringify(evidence)],
  );
  await database.pool.query(
    `INSERT INTO finance_reimbursement_matches(id,user_id,reimbursement_id,credit_transaction_id,amount_cents,rationale,evidence)
     VALUES($1,$2,$3,$4,5000,'Historical receipt',$5::jsonb)`,
    [match, owner, claim, credit, JSON.stringify(evidence)],
  );
  return { owner, account, expense, credit, unmatched, claim, match };
}

async function generationColumns(database: DatabaseClient) {
  return (
    await database.pool.query(
      `SELECT table_name,column_name FROM information_schema.columns
     WHERE table_schema='public' AND table_name IN ('finance_transactions','finance_balance_inclusions')
       AND column_name IN ('reimbursement_relationship_revision','reimbursement_relationship_state')
     ORDER BY table_name,column_name`,
    )
  ).rows;
}

describe.sequential("Populated reimbursement relationship generation migration", () => {
  it("baselines historical matches atomically and increments only subsequent real changes", async () => {
    const container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    const database = createDatabaseClient(container.getConnectionUri());
    const historical = await migrationsWithout(migrationsFolder, "nohmi-generation-upgrade-", [
      migrationTag,
    ]);
    try {
      await migrateDatabase(database.db, historical);
      const f = await historicalFixture(database);
      expect(await generationColumns(database)).toEqual([]);
      await migrateDatabase(database.db, migrationsFolder);
      const read = async (id: string) =>
        (
          await database.pool.query(
            `SELECT contextual_revision::text,reimbursement_relationship_revision::text,reimbursement_relationship_state
         FROM finance_transactions WHERE id=$1`,
            [id],
          )
        ).rows[0];
      expect(await read(f.credit)).toEqual({
        contextual_revision: "1",
        reimbursement_relationship_revision: "1",
        reimbursement_relationship_state: [[f.match, f.owner, f.claim, 5000]],
      });
      expect(await read(f.unmatched)).toEqual({
        contextual_revision: "1",
        reimbursement_relationship_revision: "1",
        reimbursement_relationship_state: [],
      });
      await migrateDatabase(database.db, migrationsFolder);
      expect((await read(f.credit)).reimbursement_relationship_revision).toBe("1");
      const principal: Principal = {
        userId: f.owner,
        actorId: f.owner,
        actorType: "user",
        scopes: new Set(["finances:read", "finances:write"]),
      };
      const service = createFinanceReimbursementService({ db: database.db, now: () => now });
      const input = {
        operation: "unmatch_credit" as const,
        reimbursementId: f.claim,
        expectedRevision: 1,
        matchId: f.match,
        rationale: "Person corrected the historical match",
        evidence,
        idempotencyKey: crypto.randomUUID(),
      };
      const context = { principal, requestId: crypto.randomUUID() };
      const result = await service.reconcile(input, context);
      expect(result).toMatchObject({ receivedAmount: 0, revision: 2, matches: [] });
      expect(await read(f.credit)).toEqual({
        contextual_revision: "1",
        reimbursement_relationship_revision: "2",
        reimbursement_relationship_state: [],
      });
      expect(await service.reconcile(input, context)).toEqual(result);
      expect((await read(f.credit)).reimbursement_relationship_revision).toBe("2");
    } finally {
      await database.close();
      await container.stop();
      await rm(historical, { recursive: true, force: true });
    }
  }, 120_000);

  it("rejects an oversized populated upgrade without partial schema, data or migration cursor changes", async () => {
    const container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    const database = createDatabaseClient(container.getConnectionUri());
    const historical = await migrationsWithout(migrationsFolder, "nohmi-generation-bound-", [
      migrationTag,
    ]);
    try {
      await migrateDatabase(database.db, historical);
      const f = await historicalFixture(database);
      await database.pool.query(
        `INSERT INTO finance_transactions(user_id,account_id,amount_cents,direction,merchant,transaction_date)
         SELECT $1,$2,1,'income','Historical extra','2026-10-06' FROM generate_series(1,9998)`,
        [f.owner, f.account],
      );
      const cursor = await database.pool.query(
        "SELECT * FROM drizzle.__drizzle_migrations ORDER BY id",
      );
      const matches = await database.pool.query(
        "SELECT * FROM finance_reimbursement_matches ORDER BY id",
      );
      expect(await generationColumns(database)).toEqual([]);
      await expect(migrateDatabase(database.db, migrationsFolder)).rejects.toMatchObject({
        cause: {
          code: "23514",
          message:
            "Reimbursement generation migration exceeds 10000 transactions or matches; operational backfill required",
        },
      });
      expect(await generationColumns(database)).toEqual([]);
      expect(
        (await database.pool.query("SELECT * FROM drizzle.__drizzle_migrations ORDER BY id")).rows,
      ).toEqual(cursor.rows);
      expect(
        (await database.pool.query("SELECT * FROM finance_reimbursement_matches ORDER BY id")).rows,
      ).toEqual(matches.rows);
      expect(
        (await database.pool.query("SELECT count(*)::int AS count FROM finance_transactions")).rows,
      ).toEqual([{ count: 10001 }]);
      expect(
        (
          await database.pool.query(
            "SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('finance_transactions_reimbursement_relationship_guard','finance_reimbursement_relationship_touch','finance_reimbursement_match_owner_guard','finance_reimbursement_relationship_reject_truncate')",
          )
        ).rows,
      ).toEqual([]);
      // The original contextual guard and historical row remain usable after rollback.
      await expect(
        database.pool.query(
          "UPDATE finance_transactions SET contextual_revision=contextual_revision+1 WHERE id=$1",
          [f.credit],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      expect(
        (
          await database.pool.query(
            "SELECT contextual_revision::text FROM finance_transactions WHERE id=$1",
            [f.credit],
          )
        ).rows,
      ).toEqual([{ contextual_revision: "1" }]);
    } finally {
      await database.close();
      await container.stop();
      await rm(historical, { recursive: true, force: true });
    }
  }, 120_000);
});
