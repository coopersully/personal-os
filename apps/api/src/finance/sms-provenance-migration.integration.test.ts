import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import {
  createDatabaseClient,
  type DatabaseClient,
  financeAccounts,
  financeTransactions,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { migrationsWithout } from "../test-migrations.js";

describe("Finance SMS provenance migration", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  let previous: string;
  const folder = resolve(process.cwd(), "packages/database/migrations");
  beforeAll(async () => {
    previous = await migrationsWithout(folder, "finance-sms-before-", [
      "0092_finance_sms_answer_provenance",
    ]);
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, previous);
  }, 120000);
  afterAll(async () => {
    await database?.close();
    await container?.stop();
    if (previous) await rm(previous, { recursive: true, force: true });
  });
  it("preserves existing app and agent answer provenance while adding the nullable historical binding fence", async () => {
    const userId = randomUUID();
    await database.db.insert(users).values({
      id: userId,
      email: `${userId}@example.com`,
      displayName: "Migration",
      passwordHash: "unused",
    });
    const [account] = await database.db
      .insert(financeAccounts)
      .values({ userId, provider: "manual", institution: "Cash", name: "Cash" })
      .returning();
    if (!account) throw new Error("account");
    for (const source of ["app", "agent"]) {
      const [transaction] = await database.db
        .insert(financeTransactions)
        .values({
          userId,
          accountId: account.id,
          amount: 500,
          merchant: "Legacy",
          direction: "expense",
          transactionDate: "2026-09-23",
        })
        .returning();
      if (!transaction) throw new Error("transaction");
      // Seed the published pre-0092 schema directly. Today's service also writes
      // action-authority columns introduced by later migrations.
      const reviewId = randomUUID();
      const questionId = randomUUID();
      await database.pool.query(
        "INSERT INTO finance_review_cases(id,user_id,transaction_id,stable_key,reason,reason_code,rationale) VALUES($1,$2,$3,$4,'unknown_merchant','missing_provenance','Context requested by the person.')",
        [reviewId, userId, transaction.id, `contextual-purpose:${transaction.id}`],
      );
      await database.pool.query(
        "INSERT INTO finance_contextual_questions(id,user_id,subtype,review_case_id,transaction_id,account_id,account_revision,transaction_revision,review_revision,prompt,merchant,transaction_date,amount_cents) VALUES($1,$2,'manual_transaction_purpose_v1',$3,$4,$5,1,1,1,'What was this transaction for?','Legacy','2026-09-23',500)",
        [questionId, userId, reviewId, transaction.id, account.id],
      );
      await database.pool.query(
        "INSERT INTO finance_contextual_answers(user_id,question_id,operation_id,answered_work_revision,answered_action_revision,resulting_work_revision,text,source_kind,source_message_id,actor_type,actor_id,request_id,recorded_at) VALUES($1,$2,$3,1,1,2,'Legacy answer',$4,NULL,$5,$6,'legacy',now())",
        [
          userId,
          questionId,
          randomUUID(),
          source,
          source === "app" ? "user" : "agent",
          source === "app" ? userId : "legacy-agent",
        ],
      );
    }
    const before = await database.pool.query(
      "SELECT * FROM finance_contextual_answers ORDER BY id",
    );
    await migrateDatabase(database.db, folder);
    const after = await database.pool.query("SELECT * FROM finance_contextual_answers ORDER BY id");
    expect(after.rows).toEqual(
      before.rows.map((row) => ({ ...row, source_reply_binding_id: null })),
    );
    const constraints = await database.pool.query(
      "SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='finance_contextual_answers'::regclass AND contype='f'",
    );
    expect(constraints.rows).toHaveLength(1);
    expect(constraints.rows[0]?.definition).toContain("finance_contextual_questions");
  });
});
