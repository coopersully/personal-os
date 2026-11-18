import { createHmac, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  auditEvents,
  createDatabaseClient,
  type DatabaseClient,
  financeAccounts,
  financeAnswerContinuations,
  financeContextualAnswers,
  financeContextualQuestions,
  financeMaintenanceCandidates,
  financeMutationRecords,
  financeReviewActionRequests,
  financeReviewAnswers,
  financeReviewCases,
  financeTransactions,
  migrateDatabase,
  textInboundClaims,
  textingConnections,
  textMessages,
  textReplyBindings,
  users,
  workspaceMaintenanceRuns,
} from "@personal-os/database";
import type { FinanceHumanWorkRef } from "@personal-os/domain";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq, sql } from "drizzle-orm";
import { createApp } from "../app.js";
import { loadConfig } from "../config.js";
import { createFinanceNotificationDispatcher } from "../finance-notification-runtime.js";
import { encryptJson } from "../security.js";
import { bindInboundReply, createTextReplyBindings } from "../texting-reply-binding.js";
import { createTextingService } from "../texting-service.js";
import { createSmsAdmission, isTextingSmsRetryableError } from "../texting-sms-admission.js";
import type { Principal } from "../types.js";
import { loadFinanceAuthorization } from "./context.js";
import { createFinanceContextualQuestionService } from "./contextual-question-service.js";
import { createInboxService } from "./inbox-service.js";
import {
  issueMaintenanceReviewQuestion,
  resolveMaintenanceReviewQuestion,
} from "./review-action-service.js";
import { type AdmitSmsAnswer, createFinanceSmsPort } from "./sms-answer-port.js";
import { resolveFinanceWorks } from "./work-resolver.js";

describe.sequential("Finance SMS atomic answer port", () => {
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
  const admit = createSmsAdmission({ enabled: () => true });
  async function fixture(
    handoff: "valid" | "missing" | "equal" | "future" = "valid",
    maintenance = false,
  ) {
    const userId = randomUUID();
    const phone = `+1${userId
      .replaceAll("-", "")
      .slice(0, 10)
      .replace(/[a-f]/g, (c) => String(c.charCodeAt(0) % 10))}`;
    await database.db.insert(users).values({
      id: userId,
      email: `${userId}@example.com`,
      displayName: "SMS context",
      passwordHash: "unused",
    });
    const principal: Principal = {
      userId,
      actorId: userId,
      actorType: "user",
      scopes: new Set(["finances:read", "finances:write"]),
    };
    const context = { principal, requestId: "sms-test" };
    const [account] = await database.db
      .insert(financeAccounts)
      .values({ userId, provider: "manual", institution: "Cash", name: "Cash" })
      .returning();
    if (!account) throw new Error("account");
    const [transaction] = await database.db
      .insert(financeTransactions)
      .values({
        userId,
        accountId: account.id,
        amount: 1200,
        merchant: "Private merchant",
        direction: "expense",
        transactionDate: "2026-09-23",
      })
      .returning();
    if (!transaction) throw new Error("transaction");
    const service = createFinanceContextualQuestionService({ db: database.db });
    const created = await service.createQuestion(
      transaction.id,
      { operationId: randomUUID() },
      context,
    );
    if (created.state !== "available") throw new Error("question");
    let work = created.question.work;
    if (maintenance) {
      const [run] = await database.db
        .insert(workspaceMaintenanceRuns)
        .values({
          userId,
          domain: "finances",
          scope: { type: "all_outstanding" },
          rulebookVersion: "test",
          status: "completed_with_questions",
        })
        .returning();
      if (!run) throw new Error("run");
      const [candidate] = await database.db
        .insert(financeMaintenanceCandidates)
        .values({ userId, runId: run.id, revision: "test-candidate", state: "challenged" })
        .returning();
      if (!candidate) throw new Error("candidate");
      await database.db
        .delete(financeContextualQuestions)
        .where(eq(financeContextualQuestions.id, created.question.id));
      await database.db
        .update(financeReviewCases)
        .set({
          evidence: {
            prompt: "What did this transaction represent?",
            maintenanceRunId: run.id,
            candidateId: candidate.id,
            candidateRevision: candidate.revision,
          },
        })
        .where(eq(financeReviewCases.id, created.question.reviewCaseId));
      await database.db.transaction((tx) =>
        issueMaintenanceReviewQuestion(tx, userId, created.question.reviewCaseId),
      );
      const [review] = await database.db
        .select()
        .from(financeReviewCases)
        .where(eq(financeReviewCases.id, created.question.reviewCaseId));
      if (review?.humanAction.state !== "open") throw new Error("issuance");
      work = {
        id: review.id,
        domain: "finances",
        kind: "question",
        revision: review.contextualRevision.toString(),
        actionRevision: review.actionRevision.toString(),
      };
    }
    const [connection] = await database.db
      .insert(textingConnections)
      .values({
        userId,
        encryptedPhoneNumber: encryptJson({ e164: phone }, Buffer.alloc(32, 7).toString("base64")),
        phoneFingerprint: createHmac("sha256", Buffer.alloc(32, 7).toString("base64"))
          .update(phone)
          .digest("hex"),
        phoneLastFour: "0001",
        country: "US",
        state: "active",
        consentVersion: "test",
        verifiedAt: new Date(),
      })
      .returning();
    if (!connection) throw new Error("connection");
    const now = Date.now();
    const [outbound] = await database.db
      .insert(textMessages)
      .values({
        userId,
        connectionId: connection.id,
        body: "Purpose?",
        direction: "outbound",
        status: "sent",
        providerMessageSid: randomUUID(),
        providerSubmittedAt:
          handoff === "missing"
            ? null
            : new Date(now + (handoff === "equal" ? 30000 : handoff === "future" ? 40000 : -10000)),
        occurredAt: new Date(now - 20000),
        occurredAtSource: "nohmi",
      })
      .returning();
    if (!outbound) throw new Error("outbound");
    const operationId = randomUUID();
    const [binding] = await database.db.transaction((tx) =>
      createTextReplyBindings(tx, userId, connection, outbound.id, [
        {
          outboundMessageId: outbound.id,
          itemNumber: 1,
          answerMode: "free_text",
          answerVocabulary: null,
          operationId,
          expiresAt: new Date(now + 600000).toISOString(),
          work,
        },
      ]),
    );
    if (!binding) throw new Error("binding");
    const text = "Dinner with Sam";
    const [inbound] = await database.db
      .insert(textMessages)
      .values({
        userId,
        connectionId: connection.id,
        body: text,
        direction: "inbound",
        status: "delivered",
        occurredAt: new Date(now + 30000),
        occurredAtSource: "provider",
        providerMessageSid: randomUUID(),
      })
      .returning();
    if (!inbound) throw new Error("inbound");
    const [claim] = await database.db
      .insert(textInboundClaims)
      .values({
        userId,
        connectionId: connection.id,
        messageId: inbound.id,
        consentEpoch: connection.consentEpoch,
        createdAt: new Date(now + 30000),
      })
      .returning();
    if (!claim) throw new Error("claim");
    if (handoff === "valid") {
      expect((await bindInboundReply(database.db, userId, inbound.id, () => true)).state).toBe(
        "pending",
      );
    } else {
      // Model an already attached tuple; admission must independently validate delivery evidence.
      await database.db
        .update(textReplyBindings)
        .set({ state: "pending", inboundClaimId: claim.id, canonicalAnswer: text })
        .where(eq(textReplyBindings.id, binding.id));
    }
    const command = {
      operationId,
      work,
      text,
      inboundMessageId: inbound.id,
      replyBindingId: binding.id,
    };
    return {
      phone,
      userId,
      context,
      service,
      connection,
      transaction,
      outbound,
      inbound,
      binding,
      question: created.question,
      command,
    };
  }
  it.each([
    false,
    true,
  ])("keeps bound question replies retryable when Finance SMS is disabled (maintenance=%s)", async (maintenance) => {
    const f = await fixture("valid", maintenance);
    const app = createApp({
      db: database.db,
      config: loadConfig({
        APP_BASE_URL: "https://nohmi.test",
        API_BASE_URL: "https://nohmi.test",
        GOOGLE_REDIRECT_URI: "https://nohmi.test/google",
        X_REDIRECT_URI: "https://nohmi.test/x",
        APP_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
        DATABASE_URL: container.getConnectionUri(),
        TEXTING_ENABLED: "true",
        FINANCE_SMS_ENABLED: "false",
        TWILIO_ACCOUNT_SID: `AC${"0".repeat(32)}`,
        TWILIO_AUTH_TOKEN: "test",
        TWILIO_MESSAGING_SERVICE_SID: "test",
        TWILIO_VERIFY_SERVICE_SID: "test",
        TWILIO_PHONE_NUMBER: "+12125550123",
      }),
    });
    await expect(app.runTextingRecovery()).resolves.toBeUndefined();
    const saved = await state(f);
    expect(saved.answers).toEqual([]);
    expect(saved.receipts).toEqual([]);
    expect(
      await database.db
        .select()
        .from(financeReviewAnswers)
        .where(eq(financeReviewAnswers.userId, f.userId)),
    ).toEqual([]);
    expect(
      await database.db
        .select()
        .from(financeAnswerContinuations)
        .where(eq(financeAnswerContinuations.userId, f.userId)),
    ).toEqual([]);
    expect(saved.bindings[0]?.state).toBe("pending");
    app.quiesceTextingRecovery();
  });
  function port(admitSmsAnswer: AdmitSmsAnswer = admit) {
    return createFinanceSmsPort({ db: database.db, admitSmsAnswer });
  }
  async function answer(f: Awaited<ReturnType<typeof fixture>>, admission: AdmitSmsAnswer = admit) {
    return database.db.transaction((tx) => port(admission).answerSmsWork(f.command, f.context, tx));
  }
  async function state(f: Awaited<ReturnType<typeof fixture>>) {
    return {
      answers: await database.db
        .select()
        .from(financeContextualAnswers)
        .where(eq(financeContextualAnswers.userId, f.userId)),
      receipts: await database.db
        .select()
        .from(financeMutationRecords)
        .where(eq(financeMutationRecords.idempotencyKey, f.command.operationId)),
      questions: await database.db
        .select()
        .from(financeContextualQuestions)
        .where(eq(financeContextualQuestions.id, f.question.id)),
      bindings: await database.db
        .select()
        .from(textReplyBindings)
        .where(eq(textReplyBindings.id, f.binding.id)),
      audits: await database.db.select().from(auditEvents).where(eq(auditEvents.userId, f.userId)),
    };
  }
  function texting() {
    return createTextingService({
      db: database.db,
      apiBaseUrl: "https://example.com",
      enabled: true,
      encryptionKey: Buffer.alloc(32, 7).toString("base64"),
      senderPhoneNumber: "+18885550100",
      twilio: {
        checkVerification: async () => "approved",
        getMessageOccurredAt: async () => new Date(),
        sendMessage: async () => {
          throw new Error("No sends allowed");
        },
        startVerification: async () => ({ sid: randomUUID(), status: "pending" }),
        validateWebhook: () => true,
      },
    });
  }
  it("keeps immutable question generation through evidence drift, rediscovery, answer and receipt replay", async () => {
    const f = await fixture("valid", true);
    const [original] = await database.db
      .select()
      .from(financeReviewCases)
      .where(eq(financeReviewCases.id, f.command.work.id));
    if (!original) throw new Error("review");
    await database.db
      .update(financeReviewCases)
      .set({ evidence: { ...original.evidence, incidental: "New source observation" } })
      .where(eq(financeReviewCases.id, original.id));
    await database.db.transaction((tx) =>
      issueMaintenanceReviewQuestion(tx, f.userId, original.id),
    );
    const [refreshed] = await database.db
      .select()
      .from(financeReviewCases)
      .where(eq(financeReviewCases.id, original.id));
    expect(refreshed?.contextualRevision).toBeGreaterThan(original.contextualRevision);
    expect(refreshed?.humanAction).toEqual(original.humanAction);
    const publish = vi.fn(async () => ({}) as never);
    const run = createFinanceNotificationDispatcher({
      db: database.db,
      enabled: () => true,
      notifications: { publish, drain: vi.fn(async () => ({}) as never) },
    });
    await run();
    expect(
      publish.mock.calls.some((call) =>
        (call as unknown as [Principal, { work: FinanceHumanWorkRef[] }])[1].work.some(
          (work) => JSON.stringify(work) === JSON.stringify(f.command.work),
        ),
      ),
    ).toBe(true);
    const accepted = await answer(f);
    expect(accepted.state).toBe("accepted");
    expect(await answer(f)).toEqual(accepted);
    expect(await port().inspectSmsReceipt(f.userId, f.command)).toEqual({
      state: "completed",
      outcome: accepted,
    });
    const rows = await database.db
      .select()
      .from(financeReviewAnswers)
      .where(eq(financeReviewAnswers.userId, f.userId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.answeredWorkRevision).toBe(refreshed?.contextualRevision);
    expect(rows[0]?.requestId).toBe(
      original.humanAction.state === "open" ? original.humanAction.request.requestId : null,
    );
    expect(
      await database.db
        .select()
        .from(financeAnswerContinuations)
        .where(eq(financeAnswerContinuations.userId, f.userId)),
    ).toHaveLength(1);
    await database.db
      .update(financeMutationRecords)
      .set({ response: { ...accepted, resultRevision: "999" } })
      .where(eq(financeMutationRecords.idempotencyKey, f.command.operationId));
    await expect(port().inspectSmsReceipt(f.userId, f.command)).rejects.toMatchObject({
      code: "internal_error",
    });
  });
  it("refuses an accepted canonical receipt without its immutable answer evidence", async () => {
    const f = await fixture("valid", true);
    await database.db
      .update(financeReviewCases)
      .set({ reasonCode: "category_ambiguity" })
      .where(eq(financeReviewCases.id, f.command.work.id));
    await database.db.transaction((tx) =>
      issueMaintenanceReviewQuestion(tx, f.userId, f.command.work.id),
    );
    expect(await answer(f)).toMatchObject({ state: "blocked" });
    await database.db
      .update(financeMutationRecords)
      .set({
        response: {
          operationId: f.command.operationId,
          state: "accepted",
          reasonCode: null,
          work: [],
          resultRevision: (BigInt(f.command.work.revision) + 1n).toString(),
        },
      })
      .where(eq(financeMutationRecords.idempotencyKey, f.command.operationId));
    await expect(port().inspectSmsReceipt(f.userId, f.command)).rejects.toMatchObject({
      code: "internal_error",
    });
    expect(
      await database.db
        .select()
        .from(financeReviewAnswers)
        .where(eq(financeReviewAnswers.userId, f.userId)),
    ).toEqual([]);
  });
  it("answers canonical maintenance questions atomically and rediscovery cannot reissue consumed authority", async () => {
    const f = await fixture("valid", true);
    const accepted = await answer(f);
    expect(accepted.state).toBe("accepted");
    expect(await answer(f)).toEqual(accepted);
    const [review] = await database.db
      .select()
      .from(financeReviewCases)
      .where(eq(financeReviewCases.id, f.command.work.id));
    if (!review) throw new Error("review");
    expect(review.humanAction.state).toBe("consumed");
    expect(review.resolution).toMatchObject({ type: "clarify", clarification: f.command.text });
    const answers = await database.db
      .select()
      .from(financeReviewAnswers)
      .where(eq(financeReviewAnswers.userId, f.userId));
    expect(answers).toHaveLength(1);
    expect(answers[0]).toMatchObject({
      text: f.command.text,
      operationId: f.command.operationId,
      sourceKind: "sms",
      resultingWorkRevision: review.contextualRevision,
    });
    const continuations = await database.db
      .select()
      .from(financeAnswerContinuations)
      .where(eq(financeAnswerContinuations.userId, f.userId));
    expect(continuations).toHaveLength(1);
    expect(continuations[0]).toMatchObject({
      state: "pending",
      automationScheduleId: null,
      operationId: f.command.operationId,
    });
    await database.db.transaction((tx) => issueMaintenanceReviewQuestion(tx, f.userId, review.id));
    expect(
      await database.db
        .select()
        .from(financeReviewActionRequests)
        .where(eq(financeReviewActionRequests.userId, f.userId)),
    ).toHaveLength(1);
  });
  it("retires an issued question when its reason changes and rejects delayed replies to the old authority", async () => {
    const f = await fixture("valid", true);
    await database.db
      .update(financeReviewCases)
      .set({ reasonCode: "category_ambiguity" })
      .where(eq(financeReviewCases.id, f.command.work.id));
    await database.db.transaction((tx) =>
      issueMaintenanceReviewQuestion(tx, f.userId, f.command.work.id),
    );
    const issued = await database.db
      .select()
      .from(financeReviewActionRequests)
      .where(eq(financeReviewActionRequests.userId, f.userId));
    expect(issued).toHaveLength(2);
    expect(issued.map((row) => row.state).sort()).toEqual(["open", "withdrawn"]);
    expect(await answer(f)).toMatchObject({ state: "blocked", reasonCode: "stale_revision" });
    expect(
      await database.db
        .select()
        .from(financeReviewAnswers)
        .where(eq(financeReviewAnswers.userId, f.userId)),
    ).toEqual([]);
    expect((await state(f)).bindings[0]?.state).toBe("pending");
  });
  it.each([
    "pending_transaction",
    "not_reviewable",
    "unavailable_account",
    "finished_run",
    "unchallenged_candidate",
  ] as const)("keeps a maintenance question stale after %s without consuming its binding", async (mode) => {
    const f = await fixture("valid", true);
    if (mode === "pending_transaction" || mode === "not_reviewable")
      await database.db
        .update(financeTransactions)
        .set(mode === "pending_transaction" ? { pending: true } : { needsReview: false })
        .where(eq(financeTransactions.id, f.transaction.id));
    if (mode === "unavailable_account")
      await database.db
        .update(financeAccounts)
        .set({ status: "needs_reauth" })
        .where(eq(financeAccounts.id, f.transaction.accountId));
    if (mode === "finished_run")
      await database.db
        .update(workspaceMaintenanceRuns)
        .set({ status: "completed" })
        .where(eq(workspaceMaintenanceRuns.userId, f.userId));
    if (mode === "unchallenged_candidate")
      await database.db
        .update(financeMaintenanceCandidates)
        .set({ state: "ready_for_challenge" })
        .where(eq(financeMaintenanceCandidates.userId, f.userId));
    const resolution = await database.db.transaction((tx) =>
      resolveMaintenanceReviewQuestion(f.userId, f.command.work, tx),
    );
    expect(resolution).toEqual({ state: "stale" });
    expect(await answer(f)).toMatchObject({ state: "blocked", reasonCode: "stale_revision" });
    expect((await state(f)).bindings[0]?.state).toBe("pending");
    expect(
      await database.db
        .select()
        .from(financeReviewAnswers)
        .where(eq(financeReviewAnswers.userId, f.userId)),
    ).toEqual([]);
    expect(
      await database.db
        .select()
        .from(financeAnswerContinuations)
        .where(eq(financeAnswerContinuations.userId, f.userId)),
    ).toEqual([]);
  });
  it("does not issue questions without current maintenance lineage or expose another owner's question", async () => {
    const ordinary = await fixture();
    await database.db.transaction((tx) =>
      issueMaintenanceReviewQuestion(tx, ordinary.userId, ordinary.question.reviewCaseId),
    );
    await database.db.transaction((tx) =>
      issueMaintenanceReviewQuestion(tx, ordinary.userId, randomUUID()),
    );
    expect(
      await database.db
        .select()
        .from(financeReviewActionRequests)
        .where(eq(financeReviewActionRequests.userId, ordinary.userId)),
    ).toEqual([]);
    const f = await fixture("valid", true);
    const resolve = (userId: string, work: FinanceHumanWorkRef = f.command.work) =>
      database.db.transaction((tx) => resolveMaintenanceReviewQuestion(userId, work, tx));
    expect(await resolve(ordinary.userId)).toEqual({ state: "unavailable" });
    expect(await resolve(f.userId, { ...f.command.work, kind: "approval" })).toEqual({
      state: "unavailable",
    });
    expect(await resolve(f.userId)).toMatchObject({ state: "current" });
    await answer(f);
    expect(await resolve(f.userId)).toEqual({ state: "resolved" });
  });
  it.each([
    "finance_accounts",
    "finance_transactions",
    "finance_review_cases",
  ] as const)("maps a busy canonical %s to a retryable conflict and resolves after release", async (table) => {
    const f = await fixture("valid", true);
    const id =
      table === "finance_accounts"
        ? f.transaction.accountId
        : table === "finance_transactions"
          ? f.transaction.id
          : f.command.work.id;
    const held = await database.pool.connect();
    try {
      await held.query("BEGIN");
      await held.query(`SELECT id FROM ${table} WHERE id=$1 FOR UPDATE`, [id]);
      await expect(
        database.db.transaction((tx) => resolveFinanceWorks(f.userId, [f.command.work], tx)),
      ).rejects.toMatchObject({ code: "conflict", details: { retryable: true } });
    } finally {
      await held.query("ROLLBACK");
      held.release();
    }
    expect(
      await database.db.transaction((tx) => resolveFinanceWorks(f.userId, [f.command.work], tx)),
    ).toMatchObject([{ state: "current" }]);
    expect((await state(f)).bindings[0]?.state).toBe("pending");
    expect(
      await database.db
        .select()
        .from(financeReviewAnswers)
        .where(eq(financeReviewAnswers.userId, f.userId)),
    ).toEqual([]);
  });
  it.each([
    "serialization",
    "unknown_error",
    "non_error",
    "cyclic_cause",
  ] as const)("preserves resolver failure semantics for %s without saving an answer", async (mode) => {
    const f = await fixture("valid", true);
    const cycle: { code: string; cause?: unknown } = { code: "unknown" };
    cycle.cause = cycle;
    const failure =
      mode === "serialization"
        ? new Error("transaction aborted", { cause: { code: "40001" } })
        : mode === "unknown_error"
          ? new Error("database unavailable")
          : mode === "cyclic_cause"
            ? cycle
            : null;
    const result = database.db.transaction((tx) => {
      const failed = new Proxy(tx, {
        get(target, key) {
          if (key === "select")
            return () => {
              throw failure;
            };
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      return resolveFinanceWorks(f.userId, [f.command.work], failed);
    });
    if (mode === "serialization")
      await expect(result).rejects.toMatchObject({
        code: "conflict",
        details: { retryable: true },
      });
    else await expect(result).rejects.toBe(failure);
    expect(
      await database.db
        .select()
        .from(financeReviewAnswers)
        .where(eq(financeReviewAnswers.userId, f.userId)),
    ).toEqual([]);
    expect((await state(f)).bindings[0]?.state).toBe("pending");
  });
  it("app clarification consumes the same authority once and persists its continuation", async () => {
    const f = await fixture("valid", true);
    const inbox = createInboxService({ db: database.db, now: () => new Date() });
    const context = await loadFinanceAuthorization({ db: database.db, ...f.context });
    const input = {
      answer: "Business lunch",
      resolution: { type: "clarify" as const, clarification: "Business lunch" },
      idempotencyKey: randomUUID(),
    };
    const result = await inbox.answerFinanceReview(f.command.work.id, input, context);
    expect(await inbox.answerFinanceReview(f.command.work.id, input, context)).toEqual(result);
    expect(
      await database.db
        .select()
        .from(financeReviewAnswers)
        .where(eq(financeReviewAnswers.userId, f.userId)),
    ).toMatchObject([{ text: "Business lunch", sourceKind: "app" }]);
    expect(
      await database.db
        .select()
        .from(financeAnswerContinuations)
        .where(eq(financeAnswerContinuations.userId, f.userId)),
    ).toHaveLength(1);
    expect((await answer(f)).state).not.toBe("accepted");
  });
  it("does not reissue a question already clarified through the app", async () => {
    const f = await fixture("valid", true);
    const inbox = createInboxService({ db: database.db, now: () => new Date() });
    const context = await loadFinanceAuthorization({ db: database.db, ...f.context });
    await inbox.answerFinanceReview(
      f.command.work.id,
      {
        answer: "Client lunch",
        resolution: { type: "clarify", clarification: "Client lunch" },
        idempotencyKey: randomUUID(),
      },
      context,
    );
    await database.db.transaction((tx) =>
      issueMaintenanceReviewQuestion(tx, f.userId, f.command.work.id),
    );
    expect(
      await database.db
        .select()
        .from(financeReviewActionRequests)
        .where(eq(financeReviewActionRequests.userId, f.userId)),
    ).toMatchObject([{ state: "consumed" }]);
    expect(
      await database.db
        .select()
        .from(financeReviewAnswers)
        .where(eq(financeReviewAnswers.userId, f.userId)),
    ).toHaveLength(1);
  });
  it("withdraws SMS authority when the person dismisses the case in the app", async () => {
    const f = await fixture("valid", true);
    const inbox = createInboxService({ db: database.db, now: () => new Date() });
    const context = await loadFinanceAuthorization({ db: database.db, ...f.context });
    await inbox.answerFinanceReview(
      f.command.work.id,
      {
        answer: "Already understood",
        resolution: { type: "dismiss", rationale: "No remaining decision" },
        idempotencyKey: randomUUID(),
      },
      context,
    );
    const [review] = await database.db
      .select()
      .from(financeReviewCases)
      .where(eq(financeReviewCases.id, f.command.work.id));
    expect(review).toMatchObject({ status: "resolved", humanAction: { state: "withdrawn" } });
    expect(
      await database.db.transaction((tx) =>
        resolveMaintenanceReviewQuestion(f.userId, f.command.work, tx),
      ),
    ).toEqual({ state: "resolved" });
    expect(await answer(f)).toMatchObject({ state: "blocked" });
    expect(
      await database.db
        .select()
        .from(financeAnswerContinuations)
        .where(eq(financeAnswerContinuations.userId, f.userId)),
    ).toEqual([]);
    expect(
      await database.db
        .select()
        .from(financeReviewAnswers)
        .where(eq(financeReviewAnswers.userId, f.userId)),
    ).toEqual([]);
  });
  it("refuses app clarification when its original maintenance lineage has finished", async () => {
    const f = await fixture("valid", true);
    await database.db
      .update(workspaceMaintenanceRuns)
      .set({ status: "completed" })
      .where(eq(workspaceMaintenanceRuns.userId, f.userId));
    const inbox = createInboxService({ db: database.db, now: () => new Date() });
    const context = await loadFinanceAuthorization({ db: database.db, ...f.context });
    await expect(
      inbox.answerFinanceReview(
        f.command.work.id,
        {
          answer: "Too late",
          resolution: { type: "clarify", clarification: "Too late" },
          idempotencyKey: randomUUID(),
        },
        context,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    const [review] = await database.db
      .select()
      .from(financeReviewCases)
      .where(eq(financeReviewCases.id, f.command.work.id));
    expect(review?.humanAction.state).toBe("open");
    expect(
      await database.db
        .select()
        .from(financeReviewAnswers)
        .where(eq(financeReviewAnswers.userId, f.userId)),
    ).toEqual([]);
  });
  it("rejects malformed or fabricated issuance and preserves canonical answers after source deletion", async () => {
    const f = await fixture("valid", true);
    await expect(
      database.db.execute(
        sql`UPDATE finance_review_cases SET human_action='{}'::jsonb WHERE id=${f.command.work.id}::uuid`,
      ),
    ).rejects.toThrow();
    await expect(
      database.db.insert(financeReviewActionRequests).values({
        id: randomUUID(),
        userId: f.userId,
        reviewCaseId: f.command.work.id,
        authorityOperationId: randomUUID(),
        actionRevision: 99n,
        request: {} as never,
        prompt: "Fake ask",
      }),
    ).rejects.toThrow();
    expect((await answer(f)).state).toBe("accepted");
    const inbox = createInboxService({ db: database.db, now: () => new Date() });
    const before = await inbox.getFinanceReviewHistoryItem(f.userId, f.command.work.id);
    expect(before).toMatchObject({
      archived: false,
      retainedQuestions: [{ prompt: "What did this transaction represent?", state: "consumed" }],
      retainedAnswers: [{ text: f.command.text, sourceKind: "sms" }],
    });
    await database.db
      .delete(financeTransactions)
      .where(eq(financeTransactions.id, f.transaction.id));
    const after = await inbox.getFinanceReviewHistoryItem(f.userId, f.command.work.id);
    expect(after).toMatchObject({
      archived: true,
      retainedQuestions: before?.retainedQuestions,
      retainedAnswers: before?.retainedAnswers,
    });
    expect(await answer(f)).toMatchObject({ state: "accepted" });
  });
  it("accepts two children from one inbound independently and preserves a successful sibling on rollback", async () => {
    const f = await fixture();
    const [transaction] = await database.db
      .insert(financeTransactions)
      .values({
        userId: f.userId,
        accountId: f.transaction.accountId,
        amount: 2000,
        merchant: "Taxi",
        direction: "expense",
        transactionDate: "2026-09-23",
      })
      .returning();
    if (!transaction) throw new Error("transaction");
    const second = await f.service.createQuestion(
      transaction.id,
      { operationId: randomUUID() },
      f.context,
    );
    if (second.state !== "available") throw new Error("question");
    const [binding] = await database.db.transaction((tx) =>
      createTextReplyBindings(tx, f.userId, f.connection, f.outbound.id, [
        {
          outboundMessageId: f.outbound.id,
          itemNumber: 2,
          answerMode: "free_text",
          answerVocabulary: null,
          operationId: randomUUID(),
          expiresAt: new Date(Date.now() + 600000).toISOString(),
          work: second.question.work,
        },
      ]),
    );
    const [claim] = await database.db
      .select()
      .from(textInboundClaims)
      .where(eq(textInboundClaims.messageId, f.inbound.id));
    if (!binding || !claim) throw new Error("binding");
    await database.db
      .update(textReplyBindings)
      .set({ state: "pending", inboundClaimId: claim.id, canonicalAnswer: "Client taxi" })
      .where(eq(textReplyBindings.id, binding.id));
    const command = {
      ...f.command,
      operationId: binding.operationId,
      replyBindingId: binding.id,
      work: second.question.work,
      text: "Client taxi",
    };
    const first = await answer(f);
    const before = await state(f);
    const faulty: AdmitSmsAnswer = async (tx, expected) => {
      const result = await admit(tx, expected);
      if (result.state !== "verified") return result;
      return {
        state: "verified",
        consume: async (value) => {
          await result.consume(value);
          throw new Error("second rollback");
        },
      };
    };
    await expect(
      database.db.transaction((tx) => port(faulty).answerSmsWork(command, f.context, tx)),
    ).rejects.toThrow("second rollback");
    expect(await state(f)).toEqual(before);
    expect(
      await database.db.transaction((tx) => port().answerSmsWork(command, f.context, tx)),
    ).toMatchObject({ state: "accepted" });
    expect((await state(f)).answers).toHaveLength(2);
    expect(await answer(f)).toEqual(first);
    expect(await port().inspectSmsReceipt(f.userId, command)).toMatchObject({
      state: "completed",
      outcome: { state: "accepted" },
    });
  });
  it.each([
    "texting_connections",
    "text_messages",
    "text_reply_bindings",
  ] as const)("aborts before receipts under %s contention", async (table) => {
    const f = await fixture();
    const before = await state(f);
    const blocker = await database.pool.connect();
    const id =
      table === "texting_connections"
        ? f.connection.id
        : table === "text_messages"
          ? f.outbound.id
          : f.binding.id;
    try {
      await blocker.query("BEGIN");
      await blocker.query(`SELECT id FROM ${table} WHERE id=$1 FOR UPDATE`, [id]);
      await expect(answer(f)).rejects.toMatchObject({
        code: "conflict",
        details: { retryable: true },
      });
      expect(await state(f)).toEqual(before);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
    }
    expect(await answer(f)).toMatchObject({ state: "accepted" });
  });
  it.each([
    "disconnect",
    "delete",
  ] as const)("holds admitted locks through commit against real %s writer", async (writer) => {
    const f = await fixture();
    let release!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const locked = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const admission: AdmitSmsAnswer = async (tx, expected) => {
      const result = await admit(tx, expected);
      ready();
      await gate;
      return result;
    };
    const accepting = answer(f, admission);
    await locked;
    const writing =
      writer === "disconnect"
        ? texting().disconnect(f.userId)
        : database.db.delete(users).where(eq(users.id, f.userId)).execute();
    try {
      await vi.waitFor(async () => {
        const waiting = await database.pool.query(
          "SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND (query ILIKE '%texting_connections%for update%' OR query ILIKE '%update%texting_connections%' OR query ILIKE '%delete%users%')",
        );
        expect(waiting.rows.length).toBeGreaterThan(0);
      });
    } finally {
      release();
    }
    expect(await accepting).toMatchObject({ state: "accepted" });
    await writing;
    if (writer !== "delete") expect((await state(f)).answers).toHaveLength(1);
    else expect((await state(f)).answers).toEqual([]);
  });
  it.each([
    false,
    true,
  ])("denies a STOP that committed before admission and retains no receipt (maintenance=%s)", async (maintenance) => {
    const f = await fixture("valid", maintenance);
    await texting().inbound({ From: f.phone, MessageSid: randomUUID(), Body: "STOP" });
    const before = await state(f);
    expect(await answer(f)).toMatchObject({
      state: "unavailable",
      reasonCode: "blocked_by_policy",
    });
    expect(await state(f)).toEqual(before);
  });
  it("serializes receipt inspection behind an in-flight answer and reads its committed outcome", async () => {
    const f = await fixture();
    let release!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const locked = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const admission: AdmitSmsAnswer = async (tx, expected) => {
      const result = await admit(tx, expected);
      ready();
      await gate;
      return result;
    };
    const accepting = answer(f, admission);
    await locked;
    const inspection = port().inspectSmsReceipt(f.userId, f.command);
    try {
      await vi.waitFor(async () => {
        const waiting = await database.pool.query(
          "SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE '%pg_advisory_xact_lock%'",
        );
        expect(waiting.rows.length).toBeGreaterThan(0);
      });
    } finally {
      release();
    }
    const result = await accepting;
    expect(await inspection).toEqual({ state: "completed", outcome: result });
  });
  it.each([
    false,
    true,
  ])("denies an already disconnected owner and does not create a receipt (maintenance=%s)", async (maintenance) => {
    const f = await fixture("valid", maintenance);
    await texting().disconnect(f.userId);
    const before = await state(f);
    expect(await answer(f)).toMatchObject({
      state: "unavailable",
      reasonCode: "blocked_by_policy",
    });
    expect(await state(f)).toEqual(before);
  });
  it.each([
    "missing",
    "equal",
    "future",
  ] as const)("independently enforces %s provider chronology without a receipt", async (handoff) => {
    const f = await fixture(handoff);
    const before = await state(f);
    if (handoff === "missing")
      await expect(answer(f)).rejects.toMatchObject({ reasonCode: "delivery_unconfirmed" });
    else
      expect(await answer(f)).toMatchObject({
        state: "unavailable",
        reasonCode: "permission_denied",
      });
    expect(await state(f)).toEqual(before);
  });
  it("retains a historical binding fence independently of inbound message or operation", async () => {
    const f = await fixture();
    await answer(f);
    const saved = await state(f);
    const original = saved.answers[0];
    if (!original) throw new Error("answer");
    await database.db.delete(textReplyBindings).where(eq(textReplyBindings.id, f.binding.id));
    await expect(
      database.db.insert(financeContextualAnswers).values({
        ...original,
        id: randomUUID(),
        operationId: randomUUID(),
        sourceMessageId: randomUUID(),
        answeredWorkRevision: 2n,
        resultingWorkRevision: 3n,
      }),
    ).rejects.toMatchObject({
      cause: { code: "23505", constraint: "finance_contextual_answers_sms_binding_unique" },
    });
    await expect(
      database.db
        .update(financeContextualAnswers)
        .set({ text: "replacement" })
        .where(eq(financeContextualAnswers.id, original.id)),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
    await database.db.delete(users).where(eq(users.id, f.userId));
    expect((await state(f)).answers).toEqual([]);
    expect((await state(f)).receipts).toEqual([]);
    await expect(port().inspectSmsReceipt(f.userId, f.command)).rejects.toMatchObject({
      code: "not_found",
    });
  });
  it.each([
    { sourceMessageId: null },
    { sourceMessageId: "SM-provider-id" },
    { sourceReplyBindingId: null },
    { actorType: "agent" as const },
    { actorId: "different-user" },
    { sourceKind: "app" as const },
  ])("rejects structurally invalid SMS provenance %j", async (patch) => {
    const f = await fixture();
    await answer(f);
    const [original] = (await state(f)).answers;
    if (!original) throw new Error("answer");
    await expect(
      database.db.insert(financeContextualAnswers).values({
        ...original,
        id: randomUUID(),
        operationId: randomUUID(),
        sourceReplyBindingId: randomUUID(),
        answeredWorkRevision: 2n,
        resultingWorkRevision: 3n,
        ...patch,
      }),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
  });
  it.each([
    false,
    true,
  ])("rejects foreign tuples, altered answers, unsupported kinds and missing scope without admission (maintenance=%s)", async (maintenance) => {
    const f = await fixture("valid", maintenance);
    const before = await state(f);
    for (const patch of [
      { replyBindingId: randomUUID() },
      { inboundMessageId: randomUUID() },
      { text: "not the attached answer" },
      { work: { ...f.command.work, kind: "approval" as const } },
    ]) {
      expect(
        await database.db.transaction((tx) =>
          port().answerSmsWork({ ...f.command, ...patch }, f.context, tx),
        ),
      ).toMatchObject({ state: "unavailable" });
    }
    await expect(
      database.db.transaction((tx) =>
        port().answerSmsWork(
          f.command,
          { ...f.context, principal: { ...f.context.principal, scopes: new Set() } },
          tx,
        ),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      database.db.transaction((tx) =>
        port().answerSmsWork(
          f.command,
          { ...f.context, principal: { ...f.context.principal, actorId: randomUUID() } },
          tx,
        ),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await state(f)).toEqual(before);
  });
  it("canonicalizes mixed-case UUIDs before Texting admission and receipt hashing", async () => {
    const f = await fixture();
    const upper = {
      ...f.command,
      operationId: f.command.operationId.toUpperCase(),
      inboundMessageId: f.command.inboundMessageId.toUpperCase(),
      replyBindingId: f.command.replyBindingId.toUpperCase(),
      work: { ...f.command.work, id: f.command.work.id.toUpperCase() },
    };
    const result = await database.db.transaction((tx) =>
      port().answerSmsWork(upper, f.context, tx),
    );
    expect(result).toMatchObject({ state: "accepted", operationId: f.command.operationId });
    expect((await state(f)).answers[0]).toMatchObject({
      sourceMessageId: f.inbound.id,
      sourceReplyBindingId: f.binding.id,
    });
    expect(await answer(f)).toEqual(result);
    expect(await port().inspectSmsReceipt(f.userId, upper)).toEqual({
      state: "completed",
      outcome: result,
    });
    const saved = await state(f);
    await expect(
      database.db.transaction((tx) =>
        port().answerSmsWork({ ...upper, text: "Different answer" }, f.context, tx),
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(await state(f)).toEqual(saved);
  });
  it("inspects exact receipts without writes and rejects mismatched or malformed completed evidence", async () => {
    const f = await fixture();
    const before = await state(f);
    expect(await port().inspectSmsReceipt(f.userId, f.command)).toEqual({ state: "absent" });
    expect(await state(f)).toEqual(before);
    const result = await answer(f);
    const saved = await state(f);
    expect(await port().inspectSmsReceipt(f.userId, f.command)).toEqual({
      state: "completed",
      outcome: result,
    });
    expect(await state(f)).toEqual(saved);
    await expect(
      port().inspectSmsReceipt(f.userId, { ...f.command, text: "Other" }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await database.db
      .update(financeMutationRecords)
      .set({ response: { ...result, operationId: randomUUID() } })
      .where(eq(financeMutationRecords.idempotencyKey, f.command.operationId));
    await expect(port().inspectSmsReceipt(f.userId, f.command)).rejects.toMatchObject({
      code: "internal_error",
    });
    await database.db
      .update(financeMutationRecords)
      .set({ response: null })
      .where(eq(financeMutationRecords.idempotencyKey, f.command.operationId));
    await expect(port().inspectSmsReceipt(f.userId, f.command)).rejects.toMatchObject({
      code: "internal_error",
    });
    for (const response of [
      { ...result, resultRevision: null },
      { ...result, resultRevision: "999" },
      { ...result, reasonCode: "stale_revision" },
      { ...result, state: "blocked", reasonCode: "stale_revision" },
      { ...result, state: "pending" },
    ]) {
      await database.db
        .update(financeMutationRecords)
        .set({ response })
        .where(eq(financeMutationRecords.idempotencyKey, f.command.operationId));
      await expect(port().inspectSmsReceipt(f.userId, f.command)).rejects.toMatchObject({
        code: "internal_error",
      });
    }
    for (const status of ["started", "failed"] as const) {
      await database.db
        .update(financeMutationRecords)
        .set({ status })
        .where(eq(financeMutationRecords.idempotencyKey, f.command.operationId));
      const incomplete = await state(f);
      expect(await port().inspectSmsReceipt(f.userId, f.command)).toEqual({
        state: "incomplete",
        status,
      });
      await expect(answer(f)).rejects.toMatchObject({ code: "conflict" });
      expect(await state(f)).toEqual(incomplete);
    }
  });
  it("commits immutable SMS provenance and consumption together, then replays after the Texting binding is deleted", async () => {
    const f = await fixture();
    const result = await answer(f);
    expect(result).toMatchObject({ state: "accepted", resultRevision: "2" });
    const saved = await state(f);
    expect(saved.answers).toHaveLength(1);
    expect(saved.answers[0]).toMatchObject({
      sourceKind: "sms",
      sourceMessageId: f.inbound.id,
      sourceReplyBindingId: f.binding.id,
      actorType: "user",
      actorId: f.userId,
      text: f.command.text,
    });
    expect(saved.bindings[0]).toMatchObject({ state: "accepted", resultRevision: "2" });
    expect(saved.receipts[0]).toMatchObject({ status: "completed", response: result });
    await database.db.delete(textReplyBindings).where(eq(textReplyBindings.userId, f.userId));
    const before = await state(f);
    expect(
      await answer(f, async () => {
        throw new Error("replay must not read T");
      }),
    ).toEqual(result);
    expect(await state(f)).toEqual(before);
  });
  it.each([
    false,
    true,
  ])("rolls back Finance and Texting when consumption fails after accepting the child (maintenance=%s)", async (maintenance) => {
    const f = await fixture("valid", maintenance);
    const before = await state(f);
    const faulty: AdmitSmsAnswer = async (tx, expected) => {
      const admitted = await admit(tx, expected);
      if (admitted.state !== "verified") return admitted;
      return {
        state: "verified",
        consume: async (result) => {
          await admitted.consume(result);
          throw new Error("lost before receipt completion");
        },
      };
    };
    await expect(answer(f, faulty)).rejects.toThrow("lost before receipt completion");
    expect(await state(f)).toEqual(before);
    expect(await answer(f)).toMatchObject({ state: "accepted" });
  });
  it.each([
    "texting_disabled",
    "policy_check_failed",
  ] as const)("propagates %s without a terminal receipt", async (reason) => {
    const f = await fixture();
    const before = await state(f);
    const admission = createSmsAdmission({
      enabled: () => {
        if (reason === "policy_check_failed") throw new Error("policy outage");
        return false;
      },
    });
    const error = await answer(f, admission).catch((error) => error);
    expect(isTextingSmsRetryableError(error)).toBe(true);
    expect(error.reasonCode).toBe(reason);
    expect(await state(f)).toEqual(before);
    expect(await answer(f)).toMatchObject({ state: "accepted" });
  });
  it("rolls back when disabled at consume and retries the unchanged pending command", async () => {
    const f = await fixture();
    const before = await state(f);
    let checks = 0;
    await expect(
      answer(f, createSmsAdmission({ enabled: () => ++checks < 3 })),
    ).rejects.toMatchObject({ reasonCode: "texting_disabled" });
    expect(await state(f)).toEqual(before);
    expect(await answer(f)).toMatchObject({ state: "accepted" });
  });
  it.each([
    "text",
    "inboundMessageId",
    "replyBindingId",
  ] as const)("binds completed receipts to the full canonical %s", async (key) => {
    const f = await fixture();
    await answer(f);
    const before = await state(f);
    await expect(
      database.db.transaction((tx) =>
        port().answerSmsWork(
          { ...f.command, [key]: key === "text" ? "Different answer" : randomUUID() },
          f.context,
          tx,
        ),
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(await state(f)).toEqual(before);
  });
  it.each([
    false,
    true,
  ])("returns blocked for stale Finance work without consuming and replays blocked without T (maintenance=%s)", async (maintenance) => {
    const f = await fixture("valid", maintenance);
    await database.db
      .update(financeTransactions)
      .set(maintenance ? { needsReview: false } : { notes: "changed" })
      .where(eq(financeTransactions.id, f.transaction.id));
    const result = await answer(f);
    expect(result).toMatchObject({ state: "blocked" });
    const saved = await state(f);
    expect(saved.answers).toEqual([]);
    expect(saved.bindings[0]?.state).toBe("pending");
    expect(
      await answer(f, async () => {
        throw new Error("no T on replay");
      }),
    ).toEqual(result);
    expect(await state(f)).toEqual(saved);
  });
  it("rejects public SMS assertions and non-user authority before T", async () => {
    const f = await fixture();
    const before = await state(f);
    expect(
      await f.service.answerWork(
        {
          operationId: f.command.operationId,
          work: f.command.work,
          text: f.command.text,
          source: { kind: "sms", messageId: f.inbound.id },
        },
        f.context,
      ),
    ).toMatchObject({ state: "unavailable" });
    await expect(
      database.db.transaction((tx) =>
        port().answerSmsWork(
          f.command,
          { ...f.context, principal: { ...f.context.principal, actorType: "agent" } },
          tx,
        ),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await state(f)).toEqual(before);
  });
});
