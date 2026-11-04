import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  createDatabaseClient,
  type DatabaseClient,
  financeAccounts,
  financeCategories,
  financeContextualAnswers,
  financeContextualQuestions,
  financeMaintenanceCandidateItems,
  financeMaintenanceCandidates,
  financeMutationRecords,
  financeReviewCases,
  financeTransactions,
  migrateDatabase,
  users,
  workspaceMaintenanceRuns,
} from "@personal-os/database";
import {
  createFinanceTransactionInputSchema,
  type FinanceContextualQuestion,
  type FinanceHumanWorkRef,
} from "@personal-os/domain";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { AppError, errorResponse } from "../errors.js";
import { createFinanceService } from "../finance-service.js";
import { registerFinanceRoutes } from "../routes/finances.js";
import type { AppEnv, Principal } from "../types.js";
import { type FinanceTransaction, loadFinanceAuthorization } from "./context.js";
import { readFinanceContextualWork } from "./contextual-question-projection.js";
import { createFinanceContextualQuestionService } from "./contextual-question-service.js";
import {
  currentContextualParents,
  eligibleContextualTransaction,
  lockContextualQuestion,
  lockContextualTransaction,
} from "./contextual-question-store.js";
import { guardFinanceExecutionTransaction } from "./execution-owner-guard.js";
import { createInboxService } from "./inbox-service.js";
import { resolveContextualWorks, resolveSmsQuestion } from "./work-resolver.js";

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
  async function batchFixture() {
    const first = await questionFixture();
    const [account] = await database.db
      .insert(financeAccounts)
      .values({ userId: first.userId, provider: "manual", institution: "Manual", name: "Second" })
      .returning();
    if (!account) throw new Error("Missing second account");
    const [transaction] = await database.db
      .insert(financeTransactions)
      .values({
        userId: first.userId,
        accountId: account.id,
        amount: 2100,
        merchant: "Dinner",
        direction: "expense",
        transactionDate: "2026-09-22",
      })
      .returning();
    if (!transaction) throw new Error("Missing second transaction");
    const created = await first.service.createQuestion(
      transaction.id,
      { operationId: randomUUID() },
      first.context,
    );
    if (created.state !== "available") throw new Error("Missing second question");
    return { first, second: created.question, account, transaction };
  }
  it("resolves a reversed two-parent notification batch using exact current work", async () => {
    const f = await batchFixture();
    const refs = [f.second.work, f.first.question.work];
    const results = await database.db.transaction((tx) =>
      resolveContextualWorks(f.first.userId, refs, tx),
    );
    expect(results).toHaveLength(2);
    expect(results.map((result) => result.state)).toEqual(["current", "current"]);
    expect(results[0]).toMatchObject({ value: { work: refs[0] } });
    expect(results[1]).toMatchObject({ value: { work: refs[1] } });
  });
  it("keeps exact resolved, stale, foreign and unsupported work unavailable to notification publication", async () => {
    const f = await batchFixture();
    expect(await f.first.service.answerWork(f.first.answer, f.first.context)).toMatchObject({
      state: "accepted",
    });
    const foreign = await questionFixture();
    const refs = [
      f.first.question.work,
      { ...f.first.question.work, id: randomUUID() },
      { ...f.second.work, actionRevision: "2" },
      foreign.question.work,
      { ...f.second.work, id: randomUUID(), kind: "approval" as const },
    ];
    expect(
      (await database.db.transaction((tx) => resolveContextualWorks(f.first.userId, refs, tx))).map(
        (result) => result.state,
      ),
    ).toEqual(["resolved", "unavailable", "stale", "unavailable", "unavailable"]);
    expect(
      (
        await database.db.transaction((tx) =>
          resolveContextualWorks(f.first.userId, [f.second.work], tx),
        )
      ).map((result) => result.state),
    ).toEqual(["current"]);
  });
  it("rejects duplicate batch IDs and preserves the 1–100 work contract", async () => {
    const f = await questionFixture();
    await expect(
      database.db.transaction((tx) =>
        resolveContextualWorks(f.userId, [f.question.work, f.question.work], tx),
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      database.db.transaction((tx) =>
        resolveContextualWorks(
          f.userId,
          [f.question.work, { ...f.question.work, id: f.question.id.toUpperCase() }],
          tx,
        ),
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      database.db.transaction((tx) => resolveContextualWorks(f.userId, [], tx)),
    ).rejects.toThrow();
    const hundred = Array.from({ length: 100 }, () => ({
      ...f.question.work,
      id: randomUUID(),
      kind: "approval" as const,
    }));
    expect(
      (await database.db.transaction((tx) => resolveContextualWorks(f.userId, hundred, tx))).map(
        (result) => result.state,
      ),
    ).toEqual(Array(100).fill("unavailable"));
    await expect(
      database.db.transaction((tx) =>
        resolveContextualWorks(
          f.userId,
          Array.from({ length: 101 }, (_, index) => ({
            ...f.question.work,
            id: index ? randomUUID() : f.question.id,
          })),
          tx,
        ),
      ),
    ).rejects.toThrow();
  });
  it.each([
    "finance_accounts",
    "finance_transactions",
    "finance_review_cases",
    "finance_contextual_questions",
  ])("maps %s batch lock contention to a retryable conflict", async (table) => {
    const f = await batchFixture();
    const id =
      table === "finance_accounts"
        ? f.account.id
        : table === "finance_transactions"
          ? f.transaction.id
          : table === "finance_review_cases"
            ? f.second.reviewCaseId
            : f.second.id;
    const blocker = await database.pool.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query(`SELECT id FROM ${table} WHERE id=$1 FOR UPDATE`, [id]);
      await expect(
        database.db.transaction((tx) =>
          resolveContextualWorks(f.first.userId, [f.first.question.work, f.second.work], tx),
        ),
      ).rejects.toMatchObject({ code: "conflict", details: { retryable: true } });
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
    }
    expect(
      (
        await database.db.transaction((tx) =>
          resolveContextualWorks(f.first.userId, [f.second.work, f.first.question.work], tx),
        )
      ).map((result) => result.state),
    ).toEqual(["current", "current"]);
  });
  it.each([
    "finance_accounts",
    "finance_transactions",
    "finance_review_cases",
    "finance_contextual_questions",
  ])("aborts a batch when %s disappears after the owned preview", async (table) => {
    const f = await questionFixture();
    const id =
      table === "finance_accounts"
        ? f.account.id
        : table === "finance_transactions"
          ? f.transaction.id
          : table === "finance_review_cases"
            ? f.question.reviewCaseId
            : f.question.id;
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
        await database.pool.query(`DELETE FROM ${table} WHERE id=$1`, [id]);
      }
      return result;
    }) as typeof client.query);
    client.release();
    try {
      await expect(
        single.db.transaction((tx) => resolveContextualWorks(f.userId, [f.question.work], tx)),
      ).rejects.toMatchObject({ code: "conflict", details: { retryable: true } });
      expect(deleted).toBe(true);
    } finally {
      query.mockRestore();
      await single.close();
    }
  });
  it.each([
    ["40001", true],
    ["23514", false],
  ])("classifies PostgreSQL %s during a batch parent lock", async (code, retryable) => {
    const f = await questionFixture();
    const single = createDatabaseClient({ connectionString: container.getConnectionUri(), max: 1 });
    const client = await single.pool.connect();
    const original = client.query.bind(client);
    let intercepted = false;
    const query = vi.spyOn(client, "query").mockImplementation((async (
      input: { text: string },
      values: unknown[],
    ) => {
      if (/from "finance_accounts"/i.test(input.text) && /for share nowait/i.test(input.text)) {
        intercepted = true;
        throw Object.assign(new Error("simulated PostgreSQL failure"), { code });
      }
      return original(input, values);
    }) as typeof client.query);
    client.release();
    try {
      const resolving = single.db.transaction((tx) =>
        resolveContextualWorks(f.userId, [f.question.work], tx),
      );
      if (retryable) {
        await expect(resolving).rejects.toMatchObject({
          code: "conflict",
          details: { retryable: true },
        });
      } else {
        await expect(resolving).rejects.toMatchObject({ cause: { code } });
      }
      expect(intercepted).toBe(true);
    } finally {
      query.mockRestore();
      await single.close();
    }
  });
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
  it("resolves SMS questions with minimal disclosure and preserves exact lifecycle states", async () => {
    const f = await questionFixture();
    const resolveSms = (work: FinanceHumanWorkRef = f.question.work, userId = f.userId) =>
      database.db.transaction((tx) => resolveSmsQuestion(userId, work, tx));
    expect(await resolveSms()).toEqual({
      state: "current",
      prompt: "What was this transaction for?",
      value: {
        work: f.question.work,
        active: true,
        expiresAt: null,
        disclosure: "minimal",
        questionPrompt: "What was this transaction for?",
        context: null,
        occurredAt: null,
        destination: `/finances/review?contextualQuestion=${f.question.id}`,
      },
    });
    expect(await resolveSms({ ...f.question.work, revision: "2" })).toEqual({ state: "stale" });
    const foreign = await fixture();
    expect(await resolveSms(f.question.work, foreign.userId)).toEqual({ state: "unavailable" });
    expect(await resolveSms({ ...f.question.work, kind: "approval" })).toEqual({
      state: "unavailable",
    });
    await f.service.answerWork(f.answer, f.context);
    expect(await resolveSms()).toEqual({ state: "resolved" });
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
              "SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE '%users%' AND query ILIKE '%no key update%'",
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
      const answers = [f.question.work, secondQuestion.question.work].map((work) =>
        f.service.answerWork({ ...f.answer, operationId: randomUUID(), work }, f.context),
      );
      try {
        await vi.waitFor(async () => {
          const blocked = await database.pool.query(
            "SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND cardinality(pg_blocking_pids(pid))>0 AND query ILIKE '%users%' AND query ILIKE '%no key update%'",
          );
          expect(blocked.rows).toHaveLength(2);
        });
      } finally {
        release();
      }
      expect(await projecting).toEqual({ created: 2, total: 2 });
      for (const answer of await Promise.all(answers))
        expect(answer).toMatchObject({ state: "blocked" });
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
                "SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE '%users%' AND query ILIKE '%no key update%'",
              )
            ).rows.length,
          ).toBeGreaterThan(0);
        });
        // The outer owner guard serializes projection before any source-row locks.
        // Releasing the accepted answer lets projection reread the committed revision.
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
  // Native values remain private in this closure; only finite states/derived predicates escape.
  async function mechanismSnapshot(userId: string, question: FinanceContextualQuestion) {
    const baseline = await database.db.transaction(async (tx) => {
      const locked = await lockContextualQuestion(tx, userId, question.id, false);
      if (!locked) throw new Error("Mechanism fixture question unavailable.");
      return locked;
    });
    return async (
      phase: "before" | "after_backfill" | "after_noop",
      writerCompletionObserved = false,
    ) =>
      database.db.transaction(async (tx) => {
        const locked = await lockContextualQuestion(tx, userId, question.id, false);
        if (!locked) throw new Error("Mechanism fixture question unavailable.");
        const selected = await tx
          .select({ id: financeTransactions.id })
          .from(financeTransactions)
          .where(or(isNull(financeTransactions.merchantId), isNull(financeTransactions.categoryId)))
          .orderBy(desc(financeTransactions.createdAt))
          .limit(100);
        const activeReviews = await tx
          .select({ id: financeReviewCases.id, updatedAt: financeReviewCases.updatedAt })
          .from(financeReviewCases)
          .where(
            and(
              eq(financeReviewCases.userId, userId),
              eq(financeReviewCases.transactionId, locked.transaction.id),
              inArray(financeReviewCases.status, ["deferred", "open"]),
            ),
          )
          .orderBy(desc(financeReviewCases.updatedAt))
          .limit(2);
        const answers = await tx
          .select({ id: financeContextualAnswers.id })
          .from(financeContextualAnswers)
          .where(
            and(
              eq(financeContextualAnswers.userId, userId),
              eq(financeContextualAnswers.questionId, question.id),
            ),
          )
          .limit(1);
        const current = currentContextualParents(locked);
        const safe = {
          targetSelected: selected.some((row) => row.id === locked.transaction.id),
          uniqueLatestActiveReview:
            activeReviews[0]?.id === locked.review.id &&
            (activeReviews.length === 1 ||
              activeReviews[0]?.updatedAt.getTime() !== activeReviews[1]?.updatedAt.getTime()),
          questionState: locked.question.state,
          questionStatus:
            locked.question.state === "answered"
              ? "answered"
              : locked.question.state === "open" && current
                ? "open"
                : "stale",
          sameQuestionAndWork:
            locked.question.id === question.id &&
            locked.question.workRevision.toString() === question.work.revision &&
            locked.question.actionRevision.toString() === question.work.actionRevision &&
            locked.question.state === baseline.question.state &&
            locked.question.accountRevision === baseline.question.accountRevision &&
            locked.question.transactionRevision === baseline.question.transactionRevision &&
            locked.question.reviewRevision === baseline.question.reviewRevision,
          accountGenerationUnchanged:
            locked.account.contextualRevision === baseline.account.contextualRevision,
          transactionGenerationUnchanged:
            locked.transaction.contextualRevision === baseline.transaction.contextualRevision,
          reviewGenerationUnchanged:
            locked.review.contextualRevision === baseline.review.contextualRevision,
          reviewGenerationAdvancedOne:
            locked.review.contextualRevision === baseline.review.contextualRevision + 1n,
          sameReview: locked.review.id === baseline.review.id,
          accountMatchesFrozen:
            locked.question.accountRevision === locked.account.contextualRevision,
          transactionMatchesFrozen:
            locked.question.transactionRevision === locked.transaction.contextualRevision,
          reviewMatchesFrozen: locked.question.reviewRevision === locked.review.contextualRevision,
          transactionEligible: eligibleContextualTransaction(locked),
          merchantPersisted: locked.transaction.merchantId !== null,
          categoryAbsent:
            locked.transaction.category === null && locked.transaction.categoryId === null,
          needsReview: locked.transaction.needsReview,
          pending: locked.transaction.pending,
          reviewStructurallyEligible:
            locked.review.status === "open" &&
            locked.review.economicEventId === null &&
            locked.review.suggestedCategoryId === null &&
            locked.review.reopenedFromId === null &&
            locked.review.proposedResolution === null &&
            locked.review.resolution === null &&
            Object.keys(locked.review.evidence).length === 0,
          rationaleUnchanged: locked.review.rationale === baseline.review.rationale,
          rationaleChanged: locked.review.rationale !== baseline.review.rationale,
          rationaleIsContextRequest: locked.review.rationale === "Context requested by the person.",
          rationaleIsCanonicalBackfill:
            locked.review.rationale === "Backfilled without a confident category.",
          allContextualParentsCurrent: current,
          noAnswer: answers.length === 0,
        };
        console.info(
          JSON.stringify({
            event: "finance-context-backfill-mechanism",
            phase,
            ...safe,
            writerCompletionObserved,
          }),
        );
        return safe;
      });
  }

  it("keeps a canonically created manual question current under repeated authorized reads without learning backfill", async () => {
    const f = await fixture();
    const writer = createFinanceService({ db: database.db, now: () => new Date() });
    const target = await writer.createTransaction(
      createFinanceTransactionInputSchema.parse({
        accountId: f.account.id,
        amount: 120,
        date: "2026-09-15",
        direction: "expense",
        merchant: `Unclassified fixture ${randomUUID()}`,
      }),
      f.context,
    );
    const service = createFinanceContextualQuestionService({ db: database.db });
    const created = await service.createQuestion(
      target.id,
      { operationId: randomUUID() },
      f.context,
    );
    expect(created.state).toBe("available");
    if (created.state !== "available") throw new Error("Mechanism fixture question unavailable.");
    const question = created.question;
    expect(question.status).toBe("open");
    const observe = await mechanismSnapshot(f.userId, question);
    expect(await observe("before")).toMatchObject({
      questionState: "open",
      questionStatus: "open",
      sameQuestionAndWork: true,
      accountMatchesFrozen: true,
      transactionMatchesFrozen: true,
      reviewMatchesFrozen: true,
      transactionEligible: true,
      reviewStructurallyEligible: true,
      merchantPersisted: true,
      categoryAbsent: true,
      needsReview: true,
      pending: false,
      rationaleIsContextRequest: true,
      noAnswer: true,
    });
    for (let read = 0; read < 2; read++) {
      const result = await service.getQuestion(question.id, f.context);
      expect(result.state).toBe("available");
      if (result.state !== "available") throw new Error("Mechanism fixture question unavailable.");
      expect(result.question.status).toBe("open");
      expect(
        result.question.id === question.id &&
          result.question.work.id === question.work.id &&
          result.question.work.domain === question.work.domain &&
          result.question.work.kind === question.work.kind &&
          result.question.work.revision === question.work.revision &&
          result.question.work.actionRevision === question.work.actionRevision,
      ).toBe(true);
      expect(await observe("before")).toMatchObject({
        accountGenerationUnchanged: true,
        transactionGenerationUnchanged: true,
        reviewGenerationUnchanged: true,
        rationaleUnchanged: true,
        allContextualParentsCurrent: true,
        noAnswer: true,
      });
    }
  });

  it("preserves an open contextual review against rationale-only learning backfill and still fences genuine edits", async () => {
    const f = await fixture();
    const writer = createFinanceService({ db: database.db, now: () => new Date() });
    const target = await writer.createTransaction(
      createFinanceTransactionInputSchema.parse({
        accountId: f.account.id,
        amount: 120,
        date: "2026-09-15",
        direction: "expense",
        merchant: `Unclassified fixture ${randomUUID()}`,
      }),
      f.context,
    );
    const service = createFinanceContextualQuestionService({ db: database.db });
    const created = await service.createQuestion(
      target.id,
      { operationId: randomUUID() },
      f.context,
    );
    expect(created.state).toBe("available");
    if (created.state !== "available") throw new Error("Mechanism fixture question unavailable.");
    const question = created.question;
    const observe = await mechanismSnapshot(f.userId, question);
    const initialRead = await service.getQuestion(question.id, f.context);
    expect(initialRead.state).toBe("available");
    if (initialRead.state !== "available")
      throw new Error("Mechanism fixture question unavailable.");
    expect(initialRead.question.status).toBe("open");
    expect(await observe("before")).toMatchObject({
      targetSelected: true,
      uniqueLatestActiveReview: true,
      questionState: "open",
      questionStatus: "open",
      sameQuestionAndWork: true,
      accountMatchesFrozen: true,
      transactionMatchesFrozen: true,
      reviewMatchesFrozen: true,
      transactionEligible: true,
      reviewStructurallyEligible: true,
      merchantPersisted: true,
      categoryAbsent: true,
      needsReview: true,
      pending: false,
      rationaleIsContextRequest: true,
      noAnswer: true,
    });
    await writer.backfillLearning(100);
    const afterRead = await service.getQuestion(question.id, f.context);
    expect(afterRead.state).toBe("available");
    if (afterRead.state !== "available") throw new Error("Mechanism fixture question unavailable.");
    expect(afterRead.question.status).toBe("open");
    expect(
      afterRead.question.id === question.id &&
        afterRead.question.work.id === question.work.id &&
        afterRead.question.work.domain === question.work.domain &&
        afterRead.question.work.kind === question.work.kind &&
        afterRead.question.work.revision === question.work.revision &&
        afterRead.question.work.actionRevision === question.work.actionRevision,
    ).toBe(true);
    expect(await observe("after_backfill", true)).toMatchObject({
      targetSelected: true,
      uniqueLatestActiveReview: true,
      questionState: "open",
      questionStatus: "open",
      sameQuestionAndWork: true,
      accountGenerationUnchanged: true,
      transactionGenerationUnchanged: true,
      reviewGenerationUnchanged: true,
      reviewGenerationAdvancedOne: false,
      sameReview: true,
      accountMatchesFrozen: true,
      transactionMatchesFrozen: true,
      reviewMatchesFrozen: true,
      transactionEligible: true,
      reviewStructurallyEligible: true,
      merchantPersisted: true,
      categoryAbsent: true,
      rationaleUnchanged: true,
      rationaleChanged: false,
      rationaleIsContextRequest: true,
      rationaleIsCanonicalBackfill: false,
      allContextualParentsCurrent: true,
      noAnswer: true,
    });
    const observeNoop = await mechanismSnapshot(f.userId, question);
    await writer.backfillLearning(100);
    const noopRead = await service.getQuestion(question.id, f.context);
    expect(noopRead.state).toBe("available");
    if (noopRead.state !== "available") throw new Error("Mechanism fixture question unavailable.");
    expect(noopRead.question.status).toBe("open");
    expect(await observeNoop("after_noop", true)).toMatchObject({
      questionState: "open",
      questionStatus: "open",
      sameQuestionAndWork: true,
      accountGenerationUnchanged: true,
      transactionGenerationUnchanged: true,
      reviewGenerationUnchanged: true,
      rationaleUnchanged: true,
      sameReview: true,
      accountMatchesFrozen: true,
      transactionMatchesFrozen: true,
      reviewMatchesFrozen: true,
      transactionEligible: true,
      reviewStructurallyEligible: true,
      merchantPersisted: true,
      categoryAbsent: true,
      rationaleIsContextRequest: true,
      rationaleIsCanonicalBackfill: false,
      allContextualParentsCurrent: true,
      noAnswer: true,
    });
    await writer.updateTransaction(
      target.id,
      { notes: "Meaningful owning source edit" },
      f.context,
    );
    const changed = await service.getQuestion(question.id, f.context);
    expect(changed.state).toBe("available");
    if (changed.state !== "available") throw new Error("Protected fixture question unavailable.");
    expect(changed.question.status).toBe("stale");
    expect(await observe("after_noop", true)).toMatchObject({
      transactionGenerationUnchanged: false,
      allContextualParentsCurrent: false,
      noAnswer: true,
    });
    expect(
      (
        await service.answerWork(
          {
            operationId: randomUUID(),
            work: question.work,
            text: "Old work must not be accepted",
            source: { kind: "app", messageId: null },
          },
          f.context,
        )
      ).state,
    ).toBe("blocked");
    expect(await observe("after_noop", true)).toMatchObject({ noAnswer: true });
  });
  it("keeps ordinary unbound reviews eligible for the real learning rationale refresh", async () => {
    const f = await fixture();
    const writer = createFinanceService({ db: database.db, now: () => new Date() });
    const target = await writer.createTransaction(
      createFinanceTransactionInputSchema.parse({
        accountId: f.account.id,
        amount: 120,
        date: "2026-09-15",
        direction: "expense",
        merchant: `Unclassified fixture ${randomUUID()}`,
      }),
      f.context,
    );
    const [ordinary] = await database.db
      .insert(financeReviewCases)
      .values({
        userId: f.userId,
        transactionId: target.id,
        reason: "unknown_merchant",
        rationale: "Ordinary unbound review",
      })
      .returning();
    if (!ordinary) throw new Error("Ordinary fixture review unavailable.");
    const eligibleRows = await database.db
      .select()
      .from(financeTransactions)
      .where(eq(financeTransactions.id, target.id));
    expect(
      eligibleRows.length === 1 &&
        eligibleRows[0]?.merchantId !== null &&
        eligibleRows[0]?.categoryId === null &&
        eligibleRows[0]?.category === null &&
        eligibleRows[0]?.needsReview === true &&
        eligibleRows[0]?.pending === false,
    ).toBe(true);
    const selected = await database.db
      .select({ id: financeTransactions.id })
      .from(financeTransactions)
      .where(or(isNull(financeTransactions.merchantId), isNull(financeTransactions.categoryId)))
      .orderBy(desc(financeTransactions.createdAt))
      .limit(100);
    expect(selected.some((row) => row.id === target.id)).toBe(true);
    const absent = await database.pool.query(
      "SELECT EXISTS (SELECT 1 FROM finance_contextual_questions WHERE user_id=$1 AND transaction_id=$2) AS present",
      [f.userId, target.id],
    );
    expect(absent.rows[0]?.present === false).toBe(true);
    await writer.backfillLearning(100);
    const [after] = await database.db
      .select()
      .from(financeReviewCases)
      .where(eq(financeReviewCases.id, ordinary.id));
    if (!after) throw new Error("Ordinary fixture review unavailable.");
    expect(after.contextualRevision === ordinary.contextualRevision + 1n).toBe(true);
    expect(after.rationale === "Backfilled without a confident category.").toBe(true);
  });

  it.each([
    "reason",
    "suggested category",
  ] as const)("retains meaningful %s review refreshes even with an open native question", async (change) => {
    const f = await fixture();
    const writer = createFinanceService({ db: database.db, now: () => new Date() });
    const target = await writer.createTransaction(
      createFinanceTransactionInputSchema.parse({
        accountId: f.account.id,
        amount: 120,
        date: "2026-09-15",
        direction: "expense",
        merchant: `Unclassified fixture ${randomUUID()}`,
      }),
      f.context,
    );
    const service = createFinanceContextualQuestionService({ db: database.db });
    const created = await service.createQuestion(
      target.id,
      { operationId: randomUUID() },
      f.context,
    );
    if (created.state !== "available") throw new Error("Protected fixture question unavailable.");
    if (change === "reason") {
      await database.db
        .update(financeReviewCases)
        .set({ reason: "low_confidence" })
        .where(eq(financeReviewCases.id, created.question.reviewCaseId));
    } else {
      const [category] = await database.db
        .insert(financeCategories)
        .values({
          userId: f.userId,
          name: "Fixture suggestion",
          slug: "fixture-suggestion",
          group: "needs",
        })
        .returning();
      if (!category) throw new Error("Fixture category unavailable.");
      await database.db
        .update(financeReviewCases)
        .set({ suggestedCategoryId: category.id })
        .where(eq(financeReviewCases.id, created.question.reviewCaseId));
    }
    const [before] = await database.db
      .select()
      .from(financeReviewCases)
      .where(eq(financeReviewCases.id, created.question.reviewCaseId));
    if (!before) throw new Error("Protected fixture review unavailable.");
    expect(
      change === "reason"
        ? before.reason !== "unknown_merchant"
        : before.suggestedCategoryId !== null,
    ).toBe(true);
    await writer.backfillLearning(100);
    const [after] = await database.db
      .select()
      .from(financeReviewCases)
      .where(eq(financeReviewCases.id, before.id));
    if (!after) throw new Error("Protected fixture review unavailable.");
    expect(after.contextualRevision === before.contextualRevision + 1n).toBe(true);
    expect(
      after.reason === "unknown_merchant" &&
        after.suggestedCategoryId === null &&
        after.rationale === "Backfilled without a confident category.",
    ).toBe(true);
    const result = await service.getQuestion(created.question.id, f.context);
    expect(result.state).toBe("available");
    if (result.state !== "available") throw new Error("Protected fixture question unavailable.");
    expect(result.question.status).toBe("stale");
  });

  it("serializes background refresh behind an uncommitted contextual owner without clobbering it", async () => {
    const f = await fixture();
    const writer = createFinanceService({ db: database.db, now: () => new Date() });
    const target = await writer.createTransaction(
      createFinanceTransactionInputSchema.parse({
        accountId: f.account.id,
        amount: 120,
        date: "2026-09-15",
        direction: "expense",
        merchant: `Unclassified fixture ${randomUUID()}`,
      }),
      f.context,
    );
    const top = await database.db
      .select({ id: financeTransactions.id })
      .from(financeTransactions)
      .where(or(isNull(financeTransactions.merchantId), isNull(financeTransactions.categoryId)))
      .orderBy(desc(financeTransactions.createdAt))
      .limit(100);
    expect(top[0]?.id === target.id).toBe(true);
    const service = createFinanceContextualQuestionService({ db: database.db });
    let ready!: () => void;
    let release!: () => void;
    let blockerPid: number | undefined;
    const reached = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const creating = database.db.transaction(async (tx) => {
      const created = await service.createQuestion(
        target.id,
        { operationId: randomUUID() },
        f.context,
        tx,
      );
      if (created.state !== "available") throw new Error("Atomic fixture question unavailable.");
      blockerPid = (await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)).rows[0]
        ?.pid;
      if (typeof blockerPid !== "number")
        throw new Error("Atomic fixture lock identity unavailable.");
      ready();
      await gate;
      return created.question;
    });
    const operations: Promise<unknown>[] = [creating];
    let drain = Promise.allSettled(operations);
    try {
      await Promise.race([
        reached,
        creating.then(() => {
          throw new Error("Atomic creator did not hold its commit gate.");
        }),
      ]);
      const backfill = writer.backfillLearning(100);
      operations.push(backfill);
      drain = Promise.allSettled(operations);
      await vi.waitFor(async () => {
        const blocked = await database.pool.query(
          "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1::int = ANY(pg_blocking_pids(pid)) AND wait_event_type='Lock' AND query ILIKE '%users%') AS blocked",
          [blockerPid],
        );
        expect(blocked.rows[0]?.blocked === true).toBe(true);
      });
    } finally {
      release();
      await drain;
    }
    await Promise.all(operations);
    const question = await creating;
    const result = await service.getQuestion(question.id, f.context);
    expect(result.state).toBe("available");
    if (result.state !== "available") throw new Error("Atomic fixture question unavailable.");
    expect(result.question.status).toBe("open");
    const observe = await mechanismSnapshot(f.userId, question);
    expect(await observe("after_backfill", true)).toMatchObject({
      rationaleIsContextRequest: true,
      allContextualParentsCurrent: true,
      noAnswer: true,
    });
  });

  it("lets a contextual creator observe committed background refresh without an inverse lock order", async () => {
    const f = await fixture();
    const writer = createFinanceService({ db: database.db, now: () => new Date() });
    const target = await writer.createTransaction(
      createFinanceTransactionInputSchema.parse({
        accountId: f.account.id,
        amount: 120,
        date: "2026-09-15",
        direction: "expense",
        merchant: `Unclassified fixture ${randomUUID()}`,
      }),
      f.context,
    );
    const top = await database.db
      .select({ id: financeTransactions.id })
      .from(financeTransactions)
      .where(or(isNull(financeTransactions.merchantId), isNull(financeTransactions.categoryId)))
      .orderBy(desc(financeTransactions.createdAt))
      .limit(100);
    expect(top[0]?.id === target.id).toBe(true);
    let ready!: () => void;
    let release!: () => void;
    let blockerPid: number | undefined;
    let gated = false;
    const reached = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const wrapped = new Proxy(database.db, {
      get(targetDb, key, receiver) {
        if (key === "transaction")
          return <T>(run: (tx: FinanceTransaction) => Promise<T>) =>
            targetDb.transaction(async (tx) => {
              const result = await run(tx);
              if (!gated) {
                gated = true;
                const [review] = await tx
                  .select({ id: financeReviewCases.id })
                  .from(financeReviewCases)
                  .where(
                    and(
                      eq(financeReviewCases.userId, f.userId),
                      eq(financeReviewCases.transactionId, target.id),
                    ),
                  )
                  .orderBy(desc(financeReviewCases.updatedAt))
                  .limit(1);
                expect(
                  typeof result === "object" &&
                    result !== null &&
                    "id" in result &&
                    result.id === review?.id,
                ).toBe(true);
                blockerPid = (
                  await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`)
                ).rows[0]?.pid;
                if (typeof blockerPid !== "number")
                  throw new Error("Atomic fixture lock identity unavailable.");
                ready();
                await gate;
              }
              return result;
            });
        return Reflect.get(targetDb, key, receiver);
      },
    });
    const background = createFinanceService({
      db: wrapped,
      now: () => new Date(),
    }).backfillLearning(100);
    const operations: Promise<unknown>[] = [background];
    let drain = Promise.allSettled(operations);
    const service = createFinanceContextualQuestionService({ db: database.db });
    let creating: ReturnType<typeof service.createQuestion> | undefined;
    try {
      await Promise.race([
        reached,
        background.then(() => {
          throw new Error("Atomic background did not hold its commit gate.");
        }),
      ]);
      creating = service.createQuestion(target.id, { operationId: randomUUID() }, f.context);
      operations.push(creating);
      drain = Promise.allSettled(operations);
      await vi.waitFor(async () => {
        const blocked = await database.pool.query(
          "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1::int = ANY(pg_blocking_pids(pid)) AND wait_event_type='Lock' AND query ILIKE '%users%') AS blocked",
          [blockerPid],
        );
        expect(blocked.rows[0]?.blocked === true).toBe(true);
      });
    } finally {
      release();
      await drain;
    }
    await Promise.all(operations);
    if (!creating) throw new Error("Atomic creator was not started.");
    const created = await creating;
    if (created.state !== "available") throw new Error("Atomic fixture question unavailable.");
    const result = await service.getQuestion(created.question.id, f.context);
    expect(result.state).toBe("available");
    if (result.state !== "available") throw new Error("Atomic fixture question unavailable.");
    expect(result.question.status).toBe("open");
    const observe = await mechanismSnapshot(f.userId, created.question);
    expect(await observe("after_backfill", true)).toMatchObject({
      rationaleIsContextRequest: true,
      allContextualParentsCurrent: true,
      noAnswer: true,
    });
  });

  async function backfillBusyFixture() {
    const f = await fixture();
    // Remove only this fixture's raw seed so the two canonical targets are the actual global top two.
    await database.db
      .delete(financeTransactions)
      .where(eq(financeTransactions.id, f.transaction.id));
    const writer = createFinanceService({ db: database.db, now: () => new Date() });
    const target = await writer.createTransaction(
      createFinanceTransactionInputSchema.parse({
        accountId: f.account.id,
        amount: 120,
        date: "2026-09-15",
        direction: "expense",
        merchant: `Unclassified busy fixture ${randomUUID()}`,
      }),
      f.context,
    );
    expect(target.merchantId !== null && target.categoryId === null).toBe(true);
    return { ...f, target, writer };
  }
  async function backfillReviewSnapshot(transactionId: string) {
    return database.db
      .select()
      .from(financeReviewCases)
      .where(eq(financeReviewCases.transactionId, transactionId))
      .orderBy(financeReviewCases.id);
  }
  function hasNativeCode(error: unknown, expected: string): boolean {
    const seen = new Set<object>();
    let current: unknown = error;
    for (let depth = 0; depth < 16; depth += 1) {
      if (typeof current !== "object" || current === null || seen.has(current)) return false;
      seen.add(current);
      if ("code" in current && current.code === expected) return true;
      current = "cause" in current ? current.cause : undefined;
    }
    return false;
  }
  async function assertBusySelection(busyId: string, laterId: string) {
    const top = await database.db
      .select({ id: financeTransactions.id })
      .from(financeTransactions)
      .where(or(isNull(financeTransactions.merchantId), isNull(financeTransactions.categoryId)))
      .orderBy(desc(financeTransactions.createdAt))
      .limit(2);
    expect(top.length === 2 && top[0]?.id === busyId && top[1]?.id === laterId).toBe(true);
  }
  it("defers only a genuinely locked parent after rollback and processes a later selected owner", async () => {
    const later = await backfillBusyFixture();
    await database.db
      .delete(financeReviewCases)
      .where(eq(financeReviewCases.transactionId, later.target.id));
    const [ordinary] = await database.db
      .insert(financeReviewCases)
      .values({
        userId: later.userId,
        transactionId: later.target.id,
        reason: "unknown_merchant",
        rationale: "Unbound fixture before background processing",
      })
      .returning();
    if (!ordinary) throw new Error("Busy fixture ordinary review unavailable.");
    const busy = await backfillBusyFixture();
    const service = createFinanceContextualQuestionService({ db: database.db });
    const created = await service.createQuestion(
      busy.target.id,
      { operationId: randomUUID() },
      busy.context,
    );
    if (created.state !== "available") throw new Error("Busy fixture question unavailable.");
    const observe = await mechanismSnapshot(busy.userId, created.question);
    await assertBusySelection(busy.target.id, later.target.id);
    const snapshot = async () => ({
      transactions: await database.db
        .select()
        .from(financeTransactions)
        .where(eq(financeTransactions.id, busy.target.id)),
      reviews: await backfillReviewSnapshot(busy.target.id),
      questions: await database.db
        .select()
        .from(financeContextualQuestions)
        .where(eq(financeContextualQuestions.id, created.question.id)),
    });
    const before = await snapshot();
    let ready!: () => void;
    let release!: () => void;
    const reached = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holder = database.db.transaction(async (tx) => {
      await tx
        .select()
        .from(financeTransactions)
        .where(eq(financeTransactions.id, busy.target.id))
        .for("update");
      ready();
      await gate;
    });
    const drained = Promise.allSettled([holder]);
    try {
      await Promise.race([
        reached,
        holder.then(() => {
          throw new Error("Busy fixture lock gate was not held.");
        }),
      ]);
      let nativeBusy = false;
      try {
        await database.db.transaction(async (tx) => {
          await guardFinanceExecutionTransaction(tx, busy.userId, { hostSchedules: true });
          await lockContextualTransaction(tx, busy.userId, busy.target.id, true);
        });
      } catch (error) {
        nativeBusy = hasNativeCode(error, "55P03");
      }
      expect(nativeBusy).toBe(true);
      expect(await busy.writer.backfillLearning(2)).toEqual({ processed: 1 });
      expect(isDeepStrictEqual(before, await snapshot())).toBe(true);
      const [advanced] = await backfillReviewSnapshot(later.target.id);
      expect(
        advanced?.id === ordinary.id &&
          advanced.contextualRevision === ordinary.contextualRevision + 1n &&
          advanced.rationale === "Backfilled without a confident category.",
      ).toBe(true);
    } finally {
      release();
      await drained;
    }
    await holder;
    expect(await observe("after_backfill", true)).toMatchObject({
      transactionEligible: true,
      allContextualParentsCurrent: true,
      rationaleUnchanged: true,
      noAnswer: true,
    });
    expect(await busy.writer.backfillLearning(2)).toEqual({ processed: 2 });
    expect(await observe("after_noop", true)).toMatchObject({
      allContextualParentsCurrent: true,
      rationaleUnchanged: true,
      reviewGenerationUnchanged: true,
    });
  });

  it.each([
    "logical conflict",
    "different owner",
    "native busy at entry",
    "native busy at review",
    "serialization at parent",
    "constraint at parent",
    "missing parent",
  ] as const)("does not defer %s outside the proven parent-busy boundary", async (failure) => {
    const later = await backfillBusyFixture();
    const busy = await backfillBusyFixture();
    await assertBusySelection(busy.target.id, later.target.id);
    const laterBefore = await backfillReviewSnapshot(later.target.id);
    const single = createDatabaseClient({ connectionString: container.getConnectionUri(), max: 1 });
    const client = await single.pool.connect();
    const original = client.query.bind(client);
    let injected = false;
    let parentAcquired = false;
    const query = vi.spyOn(client, "query").mockImplementation(
      new Proxy(original, {
        apply(target, thisArg, argumentsList) {
          const input: unknown = argumentsList[0];
          const text =
            typeof input === "string"
              ? input
              : typeof input === "object" &&
                  input !== null &&
                  "text" in input &&
                  typeof input.text === "string"
                ? input.text
                : "";
          const parentQuery =
            /from "finance_transactions"/i.test(text) && /for update nowait/i.test(text);
          const reviewQuery = /from "finance_review_cases"/i.test(text) && /for update/i.test(text);
          if (
            !injected &&
            ((failure === "native busy at review" && reviewQuery) ||
              ((failure === "serialization at parent" || failure === "constraint at parent") &&
                parentQuery))
          ) {
            injected = true;
            if (failure === "native busy at review")
              return original("DO $$ BEGIN RAISE SQLSTATE '55P03'; END $$");
            if (failure === "serialization at parent")
              return original("DO $$ BEGIN RAISE SQLSTATE '40001'; END $$");
            return original("DO $$ BEGIN RAISE SQLSTATE '23514'; END $$");
          }
          const result = Reflect.apply(target, thisArg, argumentsList);
          if (parentQuery && result instanceof Promise)
            return result.then((value) => {
              parentAcquired = true;
              return value;
            });
          return result;
        },
      }),
    );
    client.release();
    const conflict = new AppError("conflict", "Unrelated owning fixture conflict.");
    let entered = false;
    const wrapped = new Proxy(single.db, {
      get(target, key, receiver) {
        if (key === "transaction")
          return <T>(run: (tx: FinanceTransaction) => Promise<T>) =>
            target.transaction(async (tx) => {
              if (!entered) {
                entered = true;
                if (failure === "logical conflict") throw conflict;
                if (failure === "different owner")
                  await guardFinanceExecutionTransaction(tx, later.userId, { hostSchedules: true });
                if (failure === "native busy at entry")
                  await tx.execute(sql`DO $$ BEGIN RAISE SQLSTATE '55P03'; END $$`);
                if (failure === "missing parent")
                  await database.db
                    .delete(financeTransactions)
                    .where(eq(financeTransactions.id, busy.target.id));
              }
              return run(tx);
            });
        return Reflect.get(target, key, receiver);
      },
    });
    let caught: unknown;
    try {
      try {
        await createFinanceService({ db: wrapped, now: () => new Date() }).backfillLearning(2);
      } catch (error) {
        caught = error;
      }
      expect(entered && caught !== undefined).toBe(true);
      if (failure === "logical conflict") expect(caught === conflict).toBe(true);
      else if (failure === "different owner") expect(hasNativeCode(caught, "forbidden")).toBe(true);
      else if (failure === "missing parent") expect(hasNativeCode(caught, "not_found")).toBe(true);
      else {
        const code =
          failure === "serialization at parent"
            ? "40001"
            : failure === "constraint at parent"
              ? "23514"
              : "55P03";
        expect(hasNativeCode(caught, code)).toBe(true);
        if (failure !== "native busy at entry") expect(injected).toBe(true);
        if (failure === "native busy at review") expect(parentAcquired).toBe(true);
      }
      expect(isDeepStrictEqual(laterBefore, await backfillReviewSnapshot(later.target.id))).toBe(
        true,
      );
    } finally {
      query.mockRestore();
      await single.close();
    }
  });
});
