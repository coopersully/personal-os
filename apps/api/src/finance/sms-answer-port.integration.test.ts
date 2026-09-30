import { createHmac, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  auditEvents,
  createDatabaseClient,
  type DatabaseClient,
  financeAccounts,
  financeContextualAnswers,
  financeContextualQuestions,
  financeMutationRecords,
  financeTransactions,
  migrateDatabase,
  textInboundClaims,
  textingConnections,
  textMessages,
  textReplyBindings,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import { encryptJson } from "../security.js";
import { bindInboundReply, createTextReplyBindings } from "../texting-reply-binding.js";
import { createTextingService } from "../texting-service.js";
import { createSmsAdmission, isTextingSmsRetryableError } from "../texting-sms-admission.js";
import type { Principal } from "../types.js";
import { createFinanceContextualQuestionService } from "./contextual-question-service.js";
import { type AdmitSmsAnswer, createFinanceSmsPort } from "./sms-answer-port.js";

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
  async function fixture(handoff: "valid" | "missing" | "equal" | "future" = "valid") {
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
          work: created.question.work,
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
      work: created.question.work,
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
  it("denies a STOP that committed before admission and retains no receipt", async () => {
    const f = await fixture();
    await texting().inbound({ From: f.phone, MessageSid: randomUUID(), Body: "STOP" });
    const before = await state(f);
    expect(await answer(f)).toMatchObject({ state: "unavailable" });
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
  it("denies an already disconnected owner and does not create a receipt", async () => {
    const f = await fixture();
    await texting().disconnect(f.userId);
    const before = await state(f);
    expect(await answer(f)).toMatchObject({ state: "unavailable" });
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
    else expect(await answer(f)).toMatchObject({ state: "unavailable" });
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
  it("rejects foreign tuples, altered answers, unsupported kinds and missing scope without admission", async () => {
    const f = await fixture();
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
  it("rolls back Finance and Texting when consumption fails after accepting the child", async () => {
    const f = await fixture();
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
  it("returns blocked for stale Finance work without consuming and replays blocked without T", async () => {
    const f = await fixture();
    await database.db
      .update(financeTransactions)
      .set({ notes: "changed" })
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
