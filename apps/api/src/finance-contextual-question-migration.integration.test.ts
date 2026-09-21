import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  createDatabaseClient,
  type DatabaseClient,
  financeAccounts,
  financeContextualAnswers,
  financeContextualQuestions,
  financeReviewCases,
  financeTransactions,
  migrateDatabase,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq, sql } from "drizzle-orm";

describe.sequential("contextual question storage", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
  }, 120_000);
  afterAll(async () => {
    await database?.close();
    await container?.stop();
  });
  async function fixture() {
    const userId = randomUUID();
    await database.db.insert(users).values({
      id: userId,
      displayName: "Context",
      email: `${userId}@example.com`,
      passwordHash: "unused",
    });
    const [account] = await database.db
      .insert(financeAccounts)
      .values({ userId, provider: "manual", institution: "Manual", name: "Cash" })
      .returning();
    if (!account) throw new Error("Missing account");
    const [transaction] = await database.db
      .insert(financeTransactions)
      .values({
        userId,
        accountId: account.id,
        amount: 1200,
        merchant: "Lunch",
        direction: "expense",
        transactionDate: "2026-09-21",
      })
      .returning();
    if (!transaction) throw new Error("Missing transaction");
    const [review] = await database.db
      .insert(financeReviewCases)
      .values({ userId, transactionId: transaction.id })
      .returning();
    if (!review) throw new Error("Missing review");
    return { userId, account, transaction, review };
  }
  it("fences semantic ABA while ignoring account sync telemetry and case observation time", async () => {
    const { account, transaction, review } = await fixture();
    const generation = async (table: string, id: string) => {
      const result = await database.db.execute<{ revision: string | null }>(
        sql`select to_jsonb(r)->>'contextual_revision' as revision from ${sql.identifier(table)} r where id=${id}`,
      );
      return result.rows[0]?.revision;
    };
    expect(await generation("finance_accounts", account.id)).toBe("1");
    await database.db
      .update(financeAccounts)
      .set({ lastSyncAttemptAt: new Date(), updatedAt: new Date() })
      .where(eq(financeAccounts.id, account.id));
    expect(await generation("finance_accounts", account.id)).toBe("1");
    await database.db
      .update(financeTransactions)
      .set({ notes: "Different" })
      .where(eq(financeTransactions.id, transaction.id));
    await database.db
      .update(financeTransactions)
      .set({ notes: null })
      .where(eq(financeTransactions.id, transaction.id));
    expect(await generation("finance_transactions", transaction.id)).toBe("3");
    await database.db
      .update(financeReviewCases)
      .set({ lastSeenAt: new Date() })
      .where(eq(financeReviewCases.id, review.id));
    expect(await generation("finance_review_cases", review.id)).toBe("1");
    await database.db
      .update(financeReviewCases)
      .set({ evidence: { prompt: "Changed" } })
      .where(eq(financeReviewCases.id, review.id));
    expect(await generation("finance_review_cases", review.id)).toBe("2");
  });
  async function question() {
    const parent = await fixture();
    const [row] = await database.db
      .insert(financeContextualQuestions)
      .values({
        userId: parent.userId,
        subtype: "manual_transaction_purpose_v1",
        reviewCaseId: parent.review.id,
        transactionId: parent.transaction.id,
        accountId: parent.account.id,
        accountRevision: 1n,
        transactionRevision: 1n,
        reviewRevision: 1n,
        prompt: "What was this transaction for?",
        merchant: "Lunch",
        transactionDate: "2026-09-21",
        amount: 1200,
      })
      .returning();
    if (!row) throw new Error("Missing question");
    return { ...parent, question: row };
  }
  it("does not allow reparenting authoritative work or reviving an answered question", async () => {
    const parent = await question();
    const [other] = await database.db
      .insert(financeReviewCases)
      .values({ userId: parent.userId, transactionId: parent.transaction.id })
      .returning();
    if (!other) throw new Error("Missing case");
    await expect(
      database.db
        .update(financeContextualQuestions)
        .set({ reviewCaseId: other.id })
        .where(eq(financeContextualQuestions.id, parent.question.id)),
    ).rejects.toThrow();
    await database.db
      .update(financeContextualQuestions)
      .set({ state: "answered", workRevision: 2n })
      .where(eq(financeContextualQuestions.id, parent.question.id));
    await expect(
      database.db
        .update(financeContextualQuestions)
        .set({ state: "open", workRevision: 3n })
        .where(eq(financeContextualQuestions.id, parent.question.id)),
    ).rejects.toThrow();
  });
  it("retains exact immutable answer provenance and cascades it when source work is deleted", async () => {
    const parent = await question();
    const value = {
      userId: parent.userId,
      questionId: parent.question.id,
      operationId: randomUUID(),
      answeredWorkRevision: 1n,
      answeredActionRevision: 1n,
      resultingWorkRevision: 2n,
      text: "Lunch with a friend",
      sourceKind: "app" as const,
      actorType: "user" as const,
      actorId: parent.userId,
      requestId: "original-request",
      recordedAt: new Date(),
    };
    const [answer] = await database.db.insert(financeContextualAnswers).values(value).returning();
    if (!answer) throw new Error("Missing answer");
    await expect(
      database.db
        .update(financeContextualAnswers)
        .set({ text: "Different" })
        .where(eq(financeContextualAnswers.id, answer.id)),
    ).rejects.toThrow();
    await expect(
      database.db.insert(financeContextualAnswers).values({
        ...value,
        operationId: randomUUID(),
        answeredWorkRevision: 2n,
        resultingWorkRevision: 4n,
      }),
    ).rejects.toThrow();
    await expect(
      database.db
        .insert(financeContextualAnswers)
        .values({ ...value, operationId: randomUUID(), sourceMessageId: "unverified" }),
    ).rejects.toThrow();
    await expect(
      database.db
        .insert(financeContextualAnswers)
        .values({ ...value, operationId: randomUUID(), actorType: "agent" }),
    ).rejects.toThrow();
    const stored = await database.db
      .select()
      .from(financeContextualAnswers)
      .where(eq(financeContextualAnswers.id, answer.id));
    expect(stored[0]).toMatchObject({ ...value, id: answer.id });
    await database.db
      .delete(financeTransactions)
      .where(eq(financeTransactions.id, parent.transaction.id));
    expect(
      await database.db
        .select()
        .from(financeContextualQuestions)
        .where(eq(financeContextualQuestions.id, parent.question.id)),
    ).toEqual([]);
    expect(
      await database.db
        .select()
        .from(financeContextualAnswers)
        .where(eq(financeContextualAnswers.id, answer.id)),
    ).toEqual([]);
  });
  it("rejects mismatched owned parent tuples and repeats across terminal states", async () => {
    const parent = await question();
    const other = await fixture();
    const { id: _id, ...values } = parent.question;
    await expect(
      database.db
        .insert(financeContextualQuestions)
        .values({ ...values, reviewCaseId: other.review.id }),
    ).rejects.toThrow();
    await database.db
      .update(financeContextualQuestions)
      .set({ state: "invalidated", workRevision: 2n })
      .where(eq(financeContextualQuestions.id, parent.question.id));
    const [newCase] = await database.db
      .insert(financeReviewCases)
      .values({ userId: parent.userId, transactionId: parent.transaction.id })
      .returning();
    if (!newCase) throw new Error("Missing new case");
    await expect(
      database.db
        .insert(financeContextualQuestions)
        .values({ ...values, reviewCaseId: newCase.id }),
    ).rejects.toThrow();
    await expect(
      database.db.execute(
        sql`update finance_transactions set contextual_revision=1 where id=${parent.transaction.id}`,
      ),
    ).resolves.toBeDefined();
    await expect(
      database.db.execute(
        sql`update finance_transactions set contextual_revision=0 where id=${parent.transaction.id}`,
      ),
    ).rejects.toThrow();
  });
  it.each([
    "finance_accounts",
    "finance_transactions",
    "finance_review_cases",
  ])("rejects generation overflow and reset on %s", async (table) => {
    const f = await fixture();
    const id =
      table === "finance_accounts"
        ? f.account.id
        : table === "finance_transactions"
          ? f.transaction.id
          : f.review.id;
    const semantic =
      table === "finance_accounts"
        ? "status='disconnected'"
        : table === "finance_transactions"
          ? "notes='overflow'"
          : "rationale='overflow'";
    // Privileged fixture setup only: the public insert/update path cannot manufacture MAX.
    const connection = await database.pool.connect();
    try {
      await connection.query("BEGIN");
      await connection.query(`ALTER TABLE ${table} DISABLE TRIGGER ${table}_contextual_generation`);
      await connection.query(
        `UPDATE ${table} SET contextual_revision=9223372036854775807 WHERE id=$1`,
        [id],
      );
      await connection.query(`ALTER TABLE ${table} ENABLE TRIGGER ${table}_contextual_generation`);
      await connection.query("COMMIT");
    } finally {
      connection.release();
    }
    await expect(
      database.pool.query(`UPDATE ${table} SET ${semantic} WHERE id=$1`, [id]),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      database.pool.query(`UPDATE ${table} SET contextual_revision=1 WHERE id=$1`, [id]),
    ).rejects.toMatchObject({ code: "23514" });
    expect(
      (await database.pool.query(`SELECT contextual_revision FROM ${table} WHERE id=$1`, [id]))
        .rows,
    ).toEqual([{ contextual_revision: "9223372036854775807" }]);
  });
  it("rejects a same-owner case/transaction tuple mismatch independently of ownership", async () => {
    const f = await fixture();
    const [other] = await database.db
      .insert(financeTransactions)
      .values({
        userId: f.userId,
        accountId: f.account.id,
        merchant: "Other",
        amount: 100,
        direction: "expense",
        transactionDate: "2026-09-21",
      })
      .returning();
    if (!other) throw new Error("Missing transaction");
    await expect(
      database.db.insert(financeContextualQuestions).values({
        userId: f.userId,
        subtype: "manual_transaction_purpose_v1",
        reviewCaseId: f.review.id,
        transactionId: other.id,
        accountId: f.account.id,
        accountRevision: 1n,
        transactionRevision: 1n,
        reviewRevision: 1n,
        prompt: "What was this for?",
        merchant: "Other",
        transactionDate: "2026-09-21",
        amount: 100,
      }),
    ).rejects.toThrow();
  });
});
