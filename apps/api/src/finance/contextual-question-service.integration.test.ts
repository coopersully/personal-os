import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  createDatabaseClient,
  type DatabaseClient,
  financeAccounts,
  financeContextualAnswers,
  financeMaintenanceCandidateItems,
  financeMaintenanceCandidates,
  financeMutationRecords,
  financeReviewCases,
  financeTransactions,
  migrateDatabase,
  users,
  workspaceMaintenanceRuns,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { errorResponse } from "../errors.js";
import { createFinanceService } from "../finance-service.js";
import { registerFinanceRoutes } from "../routes/finances.js";
import type { AppEnv, Principal } from "../types.js";
import { type FinanceTransaction, loadFinanceAuthorization } from "./context.js";
import { readFinanceContextualWork } from "./contextual-question-projection.js";
import { createFinanceContextualQuestionService } from "./contextual-question-service.js";
import { createInboxService } from "./inbox-service.js";

describe.sequential("real contextual question producer", () => {
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
    const principal: Principal = {
      userId,
      actorId: userId,
      actorType: "user",
      scopes: new Set(["finances:read", "finances:write"]),
    };
    return { userId, account, transaction, context: { principal, requestId: "create-context" } };
  }
  it("saves an exact immutable answer without settling the financial case and replays after source deletion", async () => {
    const input = await fixture();
    const api = createFinanceContextualQuestionService({ db: database.db });
    const created = await api.createQuestion(
      input.transaction.id,
      { operationId: randomUUID() },
      input.context,
    );
    expect(created.state).toBe("available");
    if (created.state !== "available") throw new Error("Expected question");
    const question = created.question;
    const [before] = await database.db
      .select()
      .from(financeReviewCases)
      .where(eq(financeReviewCases.id, question.reviewCaseId));
    const answer = {
      operationId: randomUUID(),
      work: question.work,
      text: "Lunch with a friend",
      source: { kind: "app", messageId: null },
    };
    const outcome = await api.answerWork(answer, input.context);
    expect(outcome).toMatchObject({
      state: "accepted",
      reasonCode: null,
      resultRevision: "2",
      work: [],
    });
    expect(
      await database.db
        .select()
        .from(financeReviewCases)
        .where(eq(financeReviewCases.id, question.reviewCaseId)),
    ).toEqual([before]);
    expect(
      await database.db
        .select()
        .from(financeTransactions)
        .where(eq(financeTransactions.id, input.transaction.id)),
    ).toEqual([input.transaction]);
    const stored = await database.db
      .select()
      .from(financeContextualAnswers)
      .where(eq(financeContextualAnswers.operationId, answer.operationId));
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      text: answer.text,
      answeredWorkRevision: 1n,
      answeredActionRevision: 1n,
      actorId: input.userId,
      sourceKind: "app",
    });
    expect(
      await database.db.transaction((tx) => api.resolveWork(input.userId, question.work, tx)),
    ).toEqual({ state: "resolved" });
    await database.db
      .delete(financeTransactions)
      .where(eq(financeTransactions.id, input.transaction.id));
    expect(await api.answerWork(answer, { ...input.context, requestId: "retry-request" })).toEqual(
      outcome,
    );
    expect(
      await database.db
        .select()
        .from(financeContextualAnswers)
        .where(eq(financeContextualAnswers.operationId, answer.operationId)),
    ).toEqual([]);
  });
  it("resolves current work to the exact contextual question", async () => {
    const f = await questionFixture();
    expect(
      await database.db.transaction((tx) => f.service.resolveWork(f.userId, f.question.work, tx)),
    ).toMatchObject({
      state: "current",
      value: {
        work: f.question.work,
        destination: `/finances/review?contextualQuestion=${encodeURIComponent(f.question.work.id)}`,
      },
    });
  });
  it("rejects unsupported source without a receipt and detects parent ABA at the same timestamp", async () => {
    const input = await fixture();
    const api = createFinanceContextualQuestionService({ db: database.db });
    const created = await api.createQuestion(
      input.transaction.id,
      { operationId: randomUUID() },
      input.context,
    );
    if (created.state !== "available") throw new Error("Expected question");
    const answer = {
      operationId: randomUUID(),
      work: created.question.work,
      text: "Context",
      source: { kind: "sms", messageId: "untrusted" },
    };
    expect(await api.answerWork(answer, input.context)).toMatchObject({
      state: "unavailable",
      reasonCode: "producer_not_registered",
    });
    expect(
      await database.db
        .select()
        .from(financeMutationRecords)
        .where(eq(financeMutationRecords.idempotencyKey, answer.operationId)),
    ).toEqual([]);
    await database.db
      .update(financeTransactions)
      .set({ notes: "changed" })
      .where(eq(financeTransactions.id, input.transaction.id));
    await database.db
      .update(financeTransactions)
      .set({ notes: null })
      .where(eq(financeTransactions.id, input.transaction.id));
    expect(
      await api.answerWork({ ...answer, source: { kind: "app", messageId: null } }, input.context),
    ).toMatchObject({ state: "blocked", reasonCode: "stale_revision" });
    expect(
      await database.db
        .select()
        .from(financeContextualAnswers)
        .where(eq(financeContextualAnswers.operationId, answer.operationId)),
    ).toEqual([]);
  });
  it("creates contextual work through the human HTTP route and rejects forged creator fields", async () => {
    const input = await fixture();
    const service = createFinanceContextualQuestionService({ db: database.db });
    const app = new Hono<AppEnv>();
    app.use("*", async (c, next) => {
      c.set("principal", input.context.principal);
      c.set("requestId", "route-test");
      await next();
    });
    app.onError(errorResponse);
    registerFinanceRoutes({
      app,
      contextualQuestions: service,
      finances: {} as never,
      financeMaintenance: {} as never,
      financeStatus: {} as never,
      mutationContext: (c) => ({ principal: c.get("principal"), requestId: c.get("requestId") }),
    });
    const request = (body: unknown) =>
      app.request(`/v1/finances/transactions/${input.transaction.id}/contextual-question`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const bad = await request({ operationId: randomUUID(), userId: randomUUID() });
    expect(bad.status).toBe(400);
    const created = await request({ operationId: randomUUID() });
    expect(created.status).toBe(200);
    const value = await created.json();
    expect(value).toMatchObject({
      state: "available",
      question: { status: "open", transactionId: input.transaction.id },
    });
    const loaded = await app.request(`/v1/finances/contextual-questions/${value.question.id}`);
    expect(await loaded.json()).toEqual(value);
    const answered = await app.request("/v1/finances/contextual-questions/answer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operationId: randomUUID(),
        work: value.question.work,
        text: "Lunch",
        source: { kind: "app", messageId: null },
      }),
    });
    expect(answered.status).toBe(200);
    expect(await answered.json()).toMatchObject({ state: "accepted", resultRevision: "2" });
    input.context.principal.actorType = "agent";
    expect((await request({ operationId: randomUUID() })).status).toBe(403);
  });

  async function questionFixture() {
    const input = await fixture();
    const service = createFinanceContextualQuestionService({ db: database.db });
    const created = await service.createQuestion(
      input.transaction.id,
      { operationId: randomUUID() },
      input.context,
    );
    if (created.state !== "available") throw new Error("Question unavailable");
    return {
      ...input,
      service,
      question: created.question,
      answer: {
        operationId: randomUUID(),
        work: created.question.work,
        text: "Lunch",
        source: { kind: "app" as const, messageId: null },
      },
    };
  }
  it.each([
    "finance_accounts",
    "finance_transactions",
    "finance_review_cases",
    "finance_contextual_questions",
  ])("aborts NOWAIT contention on %s before receipt insertion and retries the same command", async (table) => {
    const f = await questionFixture();
    const id =
      table === "finance_accounts"
        ? f.account.id
        : table === "finance_transactions"
          ? f.transaction.id
          : table === "finance_review_cases"
            ? f.question.reviewCaseId
            : f.question.id;
    const blocker = await database.pool.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query(`SELECT id FROM ${table} WHERE id=$1 FOR UPDATE`, [id]);
      await expect(f.service.answerWork(f.answer, f.context)).rejects.toMatchObject({
        code: "conflict",
        details: { retryable: true },
      });
      expect(
        (
          await database.pool.query(
            "SELECT id FROM finance_mutation_records WHERE idempotency_key=$1",
            [f.answer.operationId],
          )
        ).rows,
      ).toEqual([]);
      await blocker.query("ROLLBACK");
      expect(await f.service.answerWork(f.answer, f.context)).toMatchObject({ state: "accepted" });
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
    }
  });
  it("retains parent locks through caller commit and fences a real transaction edit", async () => {
    const f = await questionFixture();
    let release!: () => void;
    let admitted!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      admitted = resolve;
    });
    const accepting = database.db.transaction(async (tx) => {
      expect(await f.service.answerWork(f.answer, f.context, tx)).toMatchObject({
        state: "accepted",
      });
      admitted();
      await gate;
    });
    await ready;
    const writer = createFinanceService({
      db: database.db,
      now: () => new Date(),
    }).updateTransaction(f.transaction.id, { notes: "Updated by real editor" }, f.context);
    try {
      // Observe PostgreSQL's actual waiting edge, not a timer-based guess about completion.
      await vi.waitFor(async () => {
        const waiting = await database.pool.query(
          "SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE '%update%finance_transactions%'",
        );
        expect(waiting.rows.length).toBeGreaterThan(0);
      });
    } finally {
      release();
    }
    await accepting;
    await writer;
    expect(
      await database.db.transaction((tx) => f.service.resolveWork(f.userId, f.question.work, tx)),
    ).toEqual({ state: "resolved" });
    expect(
      await database.db.transaction((tx) =>
        f.service.resolveWork(f.userId, { ...f.question.work, actionRevision: "2" }, tx),
      ),
    ).toEqual({ state: "stale" });
  });
  it("uses only the supplied single-connection transaction, reads before admission, and rolls back all effects", async () => {
    const f = await questionFixture();
    const single = createDatabaseClient({
      connectionString: container.getConnectionUri(),
      max: 1,
      connectionTimeoutMillis: 500,
    });
    const client = await single.pool.connect();
    const query = vi.spyOn(client, "query");
    client.release();
    const service = createFinanceContextualQuestionService({ db: single.db });
    const poolQuery = vi.spyOn(single.pool, "query").mockImplementation(() => {
      throw new Error("Unexpected pool query");
    });
    try {
      await expect(
        single.db.transaction(async (tx) => {
          expect(await service.answerWork(f.answer, f.context, tx)).toMatchObject({
            state: "accepted",
          });
          throw new Error("Caller rollback");
        }),
      ).rejects.toThrow("Caller rollback");
      const statements = query.mock.calls.map(([input]) => {
        const statement: unknown = input;
        return typeof statement === "string" ? statement : (statement as { text: string }).text;
      });
      const receipt = statements.findIndex((statement) =>
        /insert into "finance_mutation_records"/i.test(statement),
      );
      expect(receipt).toBeGreaterThan(0);
      expect(
        statements.slice(0, receipt).every((statement) => /^(begin|select)/i.test(statement)),
      ).toBe(true);
      expect(
        statements.slice(0, receipt).filter((statement) => /nowait/i.test(statement)),
      ).toHaveLength(4);
      expect(poolQuery).not.toHaveBeenCalled();
      expect(
        (
          await database.pool.query(
            "SELECT id FROM finance_contextual_answers WHERE operation_id=$1",
            [f.answer.operationId],
          )
        ).rows,
      ).toEqual([]);
      expect(
        (
          await database.pool.query(
            "SELECT id FROM finance_mutation_records WHERE idempotency_key=$1",
            [f.answer.operationId],
          )
        ).rows,
      ).toEqual([]);
      expect(await service.answerWork(f.answer, f.context)).toMatchObject({ state: "accepted" });
    } finally {
      poolQuery.mockRestore();
      query.mockRestore();
      await single.close();
    }
  });
  it("binds replay to authority while allowing a new request ID and hiding foreign work", async () => {
    const f = await questionFixture();
    const accepted = await f.service.answerWork(f.answer, f.context);
    expect(
      await f.service.answerWork(f.answer, { ...f.context, requestId: "retry-request" }),
    ).toEqual(accepted);
    await expect(
      f.service.answerWork(f.answer, {
        ...f.context,
        principal: { ...f.context.principal, actorId: randomUUID() },
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      f.service.answerWork(f.answer, {
        ...f.context,
        principal: { ...f.context.principal, scopes: new Set(["finances:read"]) },
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    const foreign = await fixture();
    expect(await f.service.getQuestion(f.question.id, foreign.context)).toMatchObject({
      state: "unavailable",
    });
    const foreignOperation = randomUUID();
    expect(
      await f.service.answerWork({ ...f.answer, operationId: foreignOperation }, foreign.context),
    ).toMatchObject({ state: "unavailable" });
    expect(
      (
        await database.pool.query(
          "SELECT id FROM finance_mutation_records WHERE idempotency_key=$1",
          [foreignOperation],
        )
      ).rows,
    ).toEqual([]);
  });
  it("projects only current work and never manufactures a second question after acceptance", async () => {
    const f = await questionFixture();
    const items = await readFinanceContextualWork(database.db, {
      userId: f.userId,
      snapshotAt: new Date(),
    });
    expect(items).toMatchObject([
      {
        id: `finance-contextual:${f.question.id}`,
        action: { to: `/finances/review?contextualQuestion=${f.question.id}` },
      },
    ]);
    await f.service.answerWork(f.answer, f.context);
    const again = await f.service.createQuestion(
      f.transaction.id,
      { operationId: randomUUID() },
      f.context,
    );
    expect(again).toMatchObject({
      state: "available",
      question: { id: f.question.id, status: "answered" },
    });
    expect(
      await readFinanceContextualWork(database.db, { userId: f.userId, snapshotAt: new Date() }),
    ).toEqual([]);
    expect(
      (
        await database.pool.query("SELECT id FROM finance_review_cases WHERE transaction_id=$1", [
          f.transaction.id,
        ])
      ).rows,
    ).toHaveLength(1);
  });

  it("serializes an identical in-flight operation into one immutable acceptance", async () => {
    const f = await questionFixture();
    const results = await Promise.all([
      f.service.answerWork(f.answer, f.context),
      f.service.answerWork(f.answer, { ...f.context, requestId: "concurrent" }),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(results[0]).toMatchObject({ state: "accepted" });
    expect(
      (
        await database.pool.query(
          "SELECT id FROM finance_contextual_answers WHERE operation_id=$1",
          [f.answer.operationId],
        )
      ).rows,
    ).toHaveLength(1);
  });
  it("rejects a real writer held before admission, then observes its committed generation", async () => {
    const f = await questionFixture();
    let release!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const admitted = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const writing = database.db.transaction(async (tx) => {
      await createFinanceService({ db: database.db, now: () => new Date() }).updateTransaction(
        f.transaction.id,
        { notes: "Writer first" },
        f.context,
        tx,
      );
      ready();
      await gate;
    });
    await admitted;
    try {
      await expect(f.service.answerWork(f.answer, f.context)).rejects.toMatchObject({
        code: "conflict",
      });
      expect(
        (
          await database.pool.query(
            "SELECT id FROM finance_mutation_records WHERE idempotency_key=$1",
            [f.answer.operationId],
          )
        ).rows,
      ).toEqual([]);
    } finally {
      release();
    }
    await writing;
    expect(await f.service.answerWork(f.answer, f.context)).toMatchObject({ state: "blocked" });
    expect(
      await readFinanceContextualWork(database.db, { userId: f.userId, snapshotAt: new Date() }),
    ).toEqual([]);
  });
  it("holds user deletion admission until commit and cascades private answers and receipts", async () => {
    const f = await questionFixture();
    let release!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const admitted = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const accepting = database.db.transaction(async (tx) => {
      await f.service.answerWork(f.answer, f.context, tx);
      ready();
      await gate;
    });
    await admitted;
    const deletion = database.pool.query("DELETE FROM users WHERE id=$1", [f.userId]);
    try {
      await vi.waitFor(async () => {
        const waiting = await database.pool.query(
          "SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'DELETE FROM users%'",
        );
        expect(waiting.rows.length).toBeGreaterThan(0);
      });
    } finally {
      release();
    }
    await accepting;
    await deletion;
    for (const table of [
      "finance_contextual_questions",
      "finance_contextual_answers",
      "finance_mutation_records",
    ])
      expect(
        (await database.pool.query(`SELECT id FROM ${table} WHERE user_id=$1`, [f.userId])).rows,
      ).toEqual([]);
  });

  const setNullCases = [
    {
      child: "finance_transactions",
      column: "merchant_id",
      parent: "finance_merchants",
      insert:
        "INSERT INTO finance_merchants (id,user_id,display_name,normalized_name) VALUES ($1,$2,'Merchant','merchant')",
    },
    {
      child: "finance_transactions",
      column: "category_id",
      parent: "finance_categories",
      insert:
        "INSERT INTO finance_categories (id,user_id,name,slug,\"group\") VALUES ($1,$2,'Food','food','needs')",
    },
    {
      child: "finance_review_cases",
      column: "suggested_category_id",
      parent: "finance_categories",
      insert:
        "INSERT INTO finance_categories (id,user_id,name,slug,\"group\") VALUES ($1,$2,'Food','food','needs')",
    },
    {
      child: "finance_review_cases",
      column: "economic_event_id",
      parent: "finance_economic_events",
      insert:
        "INSERT INTO finance_economic_events (id,user_id,kind,stable_key) VALUES ($1,$2,'purchase','context-test')",
    },
    {
      child: "finance_review_cases",
      column: "reopened_from_id",
      parent: "finance_review_cases",
      insert:
        "INSERT INTO finance_review_cases (id,user_id,transaction_id) SELECT $1,$2,id FROM finance_transactions WHERE user_id=$2 LIMIT 1",
    },
    {
      child: "finance_accounts",
      column: "provider_item_record_id",
      parent: "finance_provider_items",
      insert:
        "INSERT INTO finance_provider_items (id,user_id,provider,provider_item_id,encrypted_credentials) VALUES ($1::uuid,$2,'plaid',($1::uuid)::text,'{}')",
    },
  ];
  it.each(
    setNullCases,
  )("fences the real $child / $column SET NULL cascade in both lock directions", async ({
    child,
    column,
    parent,
    insert,
  }) => {
    const f = await questionFixture();
    const parentId = randomUUID();
    const childId =
      child === "finance_transactions"
        ? f.transaction.id
        : child === "finance_accounts"
          ? f.account.id
          : f.question.reviewCaseId;
    await database.pool.query(insert, [parentId, f.userId]);
    await database.pool.query(`UPDATE ${child} SET ${column}=$1 WHERE id=$2`, [parentId, childId]);
    const revision = async () =>
      (await database.pool.query(`SELECT contextual_revision FROM ${child} WHERE id=$1`, [childId]))
        .rows[0].contextual_revision;
    expect(await revision()).toBe("2");
    const blocker = await database.pool.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query(`DELETE FROM ${parent} WHERE id=$1`, [parentId]);
      await expect(f.service.answerWork(f.answer, f.context)).rejects.toMatchObject({
        code: "conflict",
        details: { retryable: true },
      });
      expect(
        (
          await database.pool.query(
            "SELECT id FROM finance_mutation_records WHERE idempotency_key=$1",
            [f.answer.operationId],
          )
        ).rows,
      ).toEqual([]);
      await blocker.query("ROLLBACK");
    } finally {
      blocker.release();
    }
    let release!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const admitted = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const answering = database.db.transaction(async (tx) => {
      expect(await f.service.answerWork(f.answer, f.context, tx)).toMatchObject({
        state: "blocked",
      });
      ready();
      await gate;
    });
    await admitted;
    const deletion = database.pool.query(`DELETE FROM ${parent} WHERE id=$1`, [parentId]);
    try {
      await vi.waitFor(async () => {
        const waiting = await database.pool.query(
          "SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query=$1",
          [`DELETE FROM ${parent} WHERE id=$1`],
        );
        expect(waiting.rows.length).toBeGreaterThan(0);
      });
    } finally {
      release();
    }
    await answering;
    await deletion;
    expect(await revision()).toBe("3");
    expect(
      await database.db.transaction((tx) => f.service.resolveWork(f.userId, f.question.work, tx)),
    ).toEqual({ state: "stale" });
  });

  it("aborts membership churn after the owned preview without leaving an unavailable receipt", async () => {
    const f = await questionFixture();
    const single = createDatabaseClient({ connectionString: container.getConnectionUri(), max: 1 });
    const client = await single.pool.connect();
    const original = client.query.bind(client);
    let deleted = false;
    const query = vi.spyOn(client, "query").mockImplementation((async (
      input: { text: string },
      values: unknown[],
    ) => {
      const result = await original(input, values);
      if (!deleted && /from "finance_contextual_questions"/i.test(input.text)) {
        deleted = true;
        await database.db
          .delete(financeTransactions)
          .where(eq(financeTransactions.id, f.transaction.id));
      }
      return result;
    }) as typeof client.query);
    client.release();
    try {
      await expect(
        createFinanceContextualQuestionService({ db: single.db }).answerWork(f.answer, f.context),
      ).rejects.toMatchObject({ code: "conflict", details: { retryable: true } });
      expect(deleted).toBe(true);
      expect(
        (
          await database.pool.query(
            "SELECT id FROM finance_mutation_records WHERE idempotency_key=$1",
            [f.answer.operationId],
          )
        ).rows,
      ).toEqual([]);
    } finally {
      query.mockRestore();
      await single.close();
    }
  });
  it.each(["started", "failed"])("does not reclaim a %s receipt", async (status) => {
    const f = await questionFixture();
    await f.service.answerWork(f.answer, f.context);
    await database.pool.query(
      "UPDATE finance_mutation_records SET status=$1,response=NULL WHERE idempotency_key=$2",
      [status, f.answer.operationId],
    );
    await expect(f.service.answerWork(f.answer, f.context)).rejects.toMatchObject({
      code: "conflict",
    });
    expect(
      (
        await database.pool.query(
          "SELECT id FROM finance_contextual_answers WHERE operation_id=$1",
          [f.answer.operationId],
        )
      ).rows,
    ).toHaveLength(1);
  });
  it("lets an actual legacy clarification wait for contextual acceptance without changing its resolved reference", async () => {
    const f = await questionFixture();
    let release!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const admitted = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const accepting = database.db.transaction(async (tx) => {
      await f.service.answerWork(f.answer, f.context, tx);
      ready();
      await gate;
    });
    await admitted;
    const authority = await loadFinanceAuthorization({ db: database.db, ...f.context });
    const legacy = createInboxService({
      db: database.db,
      now: () => new Date(),
    }).answerFinanceReview(
      f.question.reviewCaseId,
      {
        idempotencyKey: randomUUID(),
        answer: "Additional note",
        resolution: { type: "clarify", clarification: "Additional note" },
      },
      authority,
    );
    try {
      await vi.waitFor(async () => {
        expect(
          (
            await database.pool.query(
              "SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE '%finance_review_cases%'",
            )
          ).rows.length,
        ).toBeGreaterThan(0);
      });
    } finally {
      release();
    }
    await accepting;
    await legacy;
    expect(
      await database.db.transaction((tx) => f.service.resolveWork(f.userId, f.question.work, tx)),
    ).toEqual({ state: "resolved" });
  });
  it.each([
    "maintenance first",
    "answer first",
  ])("closes the real multi-item maintenance X1/R1 to X2 graph: %s", async (order) => {
    const f = await questionFixture();
    const [second] = await database.db
      .insert(financeTransactions)
      .values({
        userId: f.userId,
        accountId: f.account.id,
        amount: 100,
        merchant: "Second",
        direction: "expense",
        transactionDate: "2026-09-21",
      })
      .returning();
    if (!second) throw new Error("Missing second transaction");
    const secondQuestion = await f.service.createQuestion(
      second.id,
      { operationId: randomUUID() },
      f.context,
    );
    if (secondQuestion.state !== "available") throw new Error("Missing question");
    const runId = randomUUID();
    const claimId = randomUUID();
    await database.db.insert(workspaceMaintenanceRuns).values({
      id: runId,
      userId: f.userId,
      domain: "finances",
      status: "running",
      scope: { type: "all_outstanding" },
      rulebookVersion: "rules:v1",
      leaseClaimId: claimId,
      leaseExpiresAt: new Date(Date.now() + 60000),
    });
    const revision = `sha256:${"a".repeat(64)}`;
    const [candidate] = await database.db
      .insert(financeMaintenanceCandidates)
      .values({ userId: f.userId, runId, revision, state: "challenged" })
      .returning();
    if (!candidate) throw new Error("Missing candidate");
    await database.db.insert(financeMaintenanceCandidateItems).values(
      [f.transaction, second].map((transaction, ordinal) => ({
        candidateId: candidate.id,
        actionKind: "question" as const,
        disposition: "question" as const,
        expectedRevision: transaction.updatedAt.toISOString(),
        fingerprint: `sha256:${String(ordinal + 1).repeat(64)}`,
        ordinal,
        privatePayload: {
          prompt: "What was this for?",
          reviewCaseId:
            ordinal === 0 ? f.question.reviewCaseId : secondQuestion.question.reviewCaseId,
          transactionId: transaction.id,
          underlyingAction: "transaction",
        },
        sourceRefs: [],
      })),
    );
    const input = {
      candidateId: candidate.id,
      candidateRevision: revision,
      runId,
      userId: f.userId,
      context: { ...f.context, maintenanceClaim: { claimId, runId } },
    };
    let release!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const admitted = new Promise<void>((resolve) => {
      ready = resolve;
    });
    if (order === "maintenance first") {
      const wrapped = new Proxy(database.db, {
        get(target, key, receiver) {
          if (key === "transaction")
            return (run: (tx: FinanceTransaction) => Promise<unknown>) =>
              target.transaction(async (tx) => {
                const result = await run(tx);
                ready();
                await gate;
                return result;
              });
          return Reflect.get(target, key, receiver);
        },
      });
      const projecting = createFinanceService({
        db: wrapped,
        now: () => new Date(),
      }).projectMaintenanceCandidateQuestionsForUser(input);
      await admitted;
      try {
        for (const work of [f.question.work, secondQuestion.question.work])
          await expect(
            f.service.answerWork({ ...f.answer, operationId: randomUUID(), work }, f.context),
          ).rejects.toMatchObject({ code: "conflict", details: { retryable: true } });
      } finally {
        release();
      }
      expect(await projecting).toEqual({ created: 2, total: 2 });
      expect(await f.service.answerWork(f.answer, f.context)).toMatchObject({ state: "blocked" });
    } else {
      const accepting = database.db.transaction(async (tx) => {
        await f.service.answerWork(
          { ...f.answer, operationId: randomUUID(), work: secondQuestion.question.work },
          f.context,
          tx,
        );
        ready();
        await gate;
      });
      await admitted;
      const projecting = createFinanceService({
        db: database.db,
        now: () => new Date(),
      }).projectMaintenanceCandidateQuestionsForUser(input);
      try {
        await vi.waitFor(async () => {
          expect(
            (
              await database.pool.query(
                "SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE '%finance_transactions%'",
              )
            ).rows.length,
          ).toBeGreaterThan(0);
        });
        // Maintenance holds the first transaction while waiting for the second. C must not wait back on it.
        await expect(f.service.answerWork(f.answer, f.context)).rejects.toMatchObject({
          code: "conflict",
          details: { retryable: true },
        });
      } finally {
        release();
      }
      await accepting;
      expect(await projecting).toEqual({ created: 2, total: 2 });
      expect(
        await database.db.transaction((tx) =>
          f.service.resolveWork(f.userId, secondQuestion.question.work, tx),
        ),
      ).toEqual({ state: "resolved" });
    }
  });

  it("admits agent answers with server actor provenance and rejects unsupported work without receipts", async () => {
    const f = await questionFixture();
    const agent = {
      ...f.context,
      principal: { ...f.context.principal, actorType: "agent" as const, actorId: randomUUID() },
    };
    const unsupported = { ...f.answer, work: { ...f.answer.work, kind: "approval" } };
    expect(await f.service.answerWork(unsupported, f.context)).toMatchObject({
      state: "unavailable",
    });
    expect(
      (
        await database.pool.query(
          "SELECT id FROM finance_mutation_records WHERE idempotency_key=$1",
          [f.answer.operationId],
        )
      ).rows,
    ).toEqual([]);
    expect(
      await f.service.answerWork(
        { ...f.answer, source: { kind: "agent", messageId: null } },
        agent,
      ),
    ).toMatchObject({ state: "accepted" });
    expect(
      (
        await database.pool.query(
          "SELECT actor_id,source_kind FROM finance_contextual_answers WHERE operation_id=$1",
          [f.answer.operationId],
        )
      ).rows,
    ).toEqual([{ actor_id: agent.principal.actorId, source_kind: "agent" }]);
  });
  it("serializes duplicate creation and keeps ineligible transactions receipt-free", async () => {
    const f = await fixture();
    const service = createFinanceContextualQuestionService({ db: database.db });
    const command = { operationId: randomUUID() };
    const created = await Promise.all([
      service.createQuestion(f.transaction.id, command, f.context),
      service.createQuestion(f.transaction.id, command, f.context),
    ]);
    expect(created[0]).toEqual(created[1]);
    expect(
      (
        await database.pool.query(
          "SELECT id FROM finance_contextual_questions WHERE transaction_id=$1",
          [f.transaction.id],
        )
      ).rows,
    ).toHaveLength(1);
    const other = await fixture();
    await database.db
      .update(financeTransactions)
      .set({ pending: true })
      .where(eq(financeTransactions.id, other.transaction.id));
    const operationId = randomUUID();
    expect(
      await service.createQuestion(other.transaction.id, { operationId }, other.context),
    ).toMatchObject({ state: "unavailable" });
    expect(
      (
        await database.pool.query(
          "SELECT id FROM finance_mutation_records WHERE idempotency_key=$1",
          [operationId],
        )
      ).rows,
    ).toEqual([]);
  });
});
