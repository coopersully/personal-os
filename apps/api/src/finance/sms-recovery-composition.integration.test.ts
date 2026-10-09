import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  auditEvents,
  createDatabaseClient,
  type DatabaseClient,
  financeAccounts,
  financeContextualAnswers,
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
import { and, eq } from "drizzle-orm";
import { encryptJson } from "../security.js";
import {
  createTextingRecoveryService,
  type FinanceSmsRecoveryCommand,
} from "../texting-recovery-service.js";
import { bindInboundReply, createTextReplyBindings } from "../texting-reply-binding.js";
import { createSmsAdmission } from "../texting-sms-admission.js";
import type { Principal } from "../types.js";
import { createFinanceContextualQuestionService } from "./contextual-question-service.js";
import { type ContextualPrincipal, contextualTransaction } from "./contextual-question-store.js";
import { type AdmitSmsAnswer, createFinanceSmsPort } from "./sms-answer-port.js";

const encryptionKey = Buffer.alloc(32, 11).toString("base64");

describe.sequential("Finance SMS recovery composition", () => {
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

  beforeEach(async () => {
    await database.db.delete(users);
  });

  async function fixture(label: string) {
    const anchor = new Date();
    const userId = randomUUID();
    const principal: Principal = {
      userId,
      actorId: userId,
      actorType: "user",
      scopes: new Set(["finances:read", "finances:write", "texting:read", "texting:write"]),
    };
    const context: ContextualPrincipal = { principal, requestId: `create-${label}` };
    await database.db.insert(users).values({
      id: userId,
      email: `${userId}@example.test`,
      displayName: label,
      passwordHash: "unused",
      planningTimezone: "America/New_York",
    });
    const [account] = await database.db
      .insert(financeAccounts)
      .values({ userId, provider: "manual", institution: "Manual", name: "Cash" })
      .returning();
    if (!account) throw new Error("Missing Finance account.");
    const [transaction] = await database.db
      .insert(financeTransactions)
      .values({
        userId,
        accountId: account.id,
        amount: 1200,
        merchant: "Private merchant",
        direction: "expense",
        transactionDate: "2026-10-08",
      })
      .returning();
    if (!transaction) throw new Error("Missing Finance transaction.");
    const questions = createFinanceContextualQuestionService({ db: database.db });
    const created = await questions.createQuestion(
      transaction.id,
      { operationId: randomUUID() },
      context,
    );
    if (created.state !== "available") throw new Error("Missing contextual question.");
    const [connection] = await database.db
      .insert(textingConnections)
      .values({
        userId,
        encryptedPhoneNumber: encryptJson({ e164: "+12125550123" }, encryptionKey),
        phoneFingerprint: userId,
        phoneLastFour: "0123",
        country: "US",
        state: "active",
        consentVersion: "test",
        verifiedAt: anchor,
      })
      .returning();
    if (!connection) throw new Error("Missing Texting connection.");
    const [outbound] = await database.db
      .insert(textMessages)
      .values({
        userId,
        connectionId: connection.id,
        body: "What was this transaction for?",
        direction: "outbound",
        status: "sent",
        providerMessageSid: randomUUID(),
        providerSubmittedAt: new Date(anchor.getTime() - 30_000),
        occurredAt: new Date(anchor.getTime() - 30_000),
        occurredAtSource: "nohmi",
      })
      .returning();
    if (!outbound) throw new Error("Missing outbound message.");
    const operationId = randomUUID();
    const [binding] = await database.db.transaction((tx) =>
      createTextReplyBindings(
        tx,
        userId,
        connection,
        outbound.id,
        [
          {
            outboundMessageId: outbound.id,
            itemNumber: 1,
            answerMode: "free_text",
            answerVocabulary: null,
            operationId,
            expiresAt: new Date(anchor.getTime() + 3_600_000).toISOString(),
            work: created.question.work,
          },
        ],
        anchor,
      ),
    );
    if (!binding) throw new Error("Missing reply binding.");
    const text = "Dinner with Sam";
    const [inbound] = await database.db
      .insert(textMessages)
      .values({
        userId,
        connectionId: connection.id,
        body: text,
        direction: "inbound",
        status: "delivered",
        providerMessageSid: randomUUID(),
        occurredAt: new Date(anchor.getTime() + 30_000),
        occurredAtSource: "provider",
      })
      .returning();
    if (!inbound) throw new Error("Missing inbound message.");
    await database.db.insert(textInboundClaims).values({
      userId,
      connectionId: connection.id,
      messageId: inbound.id,
      consentEpoch: connection.consentEpoch,
      createdAt: new Date(anchor.getTime() + 10_000),
    });
    const bound = await bindInboundReply(
      database.db,
      userId,
      inbound.id,
      () => true,
      new Date(anchor.getTime() + 30_000),
    );
    if (bound.state !== "pending") throw new Error(`Reply binding is ${bound.state}.`);
    const command: FinanceSmsRecoveryCommand = {
      operationId,
      work: created.question.work,
      text,
      inboundMessageId: inbound.id,
      replyBindingId: binding.id,
    };
    return { userId, principal, questions, question: created.question, inbound, binding, command };
  }

  function finance(admitSmsAnswer: AdmitSmsAnswer = createSmsAdmission({ enabled: () => true })) {
    return createFinanceSmsPort({ db: database.db, admitSmsAnswer });
  }

  function recovery(port = finance(), afterCommit?: () => never) {
    return createTextingRecoveryService({
      db: database.db,
      enabled: () => true,
      finance: {
        inspectSmsReceipt: port.inspectSmsReceipt,
        executeAnswer: async (userId, command) => {
          const context: ContextualPrincipal = {
            principal: {
              actorId: userId,
              actorType: "user",
              scopes: new Set(["finances:write"]),
              userId,
            },
            requestId: command.operationId,
          };
          const result = await contextualTransaction(database.db, undefined, (tx) =>
            port.answerSmsWork(command, context, tx),
          );
          afterCommit?.();
          return result;
        },
      },
    });
  }

  async function rows(userId: string, bindingId: string) {
    return {
      answers: await database.db
        .select()
        .from(financeContextualAnswers)
        .where(eq(financeContextualAnswers.userId, userId)),
      audits: await database.db
        .select()
        .from(auditEvents)
        .where(
          and(
            eq(auditEvents.userId, userId),
            eq(auditEvents.action, "finance.contextual_answer.accepted"),
          ),
        ),
      binding: await database.db
        .select()
        .from(textReplyBindings)
        .where(eq(textReplyBindings.id, bindingId))
        .then(([value]) => value),
      receipts: await database.db
        .select()
        .from(financeMutationRecords)
        .where(
          and(
            eq(financeMutationRecords.userId, userId),
            eq(financeMutationRecords.operation, "answer_contextual_question_v1"),
          ),
        ),
    };
  }

  async function manualAnswer(
    f: Awaited<ReturnType<typeof fixture>>,
    executor?: Parameters<typeof f.questions.answerWork>[2],
  ) {
    return f.questions.answerWork(
      {
        operationId: randomUUID(),
        work: f.question.work,
        text: "Resolved in the app",
        source: { kind: "app", messageId: null },
      },
      { principal: f.principal, requestId: "manual-answer" },
      executor,
    );
  }

  it("recovers one real Finance answer after the caller is gone and reconciles a committed reply", async () => {
    const f = await fixture("Committed recovery");
    const service = recovery(finance(), () => {
      throw new Error("Caller disappeared after commit.");
    });

    await expect(service.runPage(f.userId, { limit: 10 })).resolves.toMatchObject({
      claims: [
        {
          inboundMessageId: f.inbound.id,
          state: "attached",
          children: [
            {
              bindingId: f.binding.id,
              operationId: f.command.operationId,
              state: "accepted",
              reason: null,
              terminal: true,
            },
          ],
        },
      ],
    });
    await expect(service.inspectClaim(f.userId, f.inbound.id)).resolves.toMatchObject({
      children: [{ state: "accepted", terminal: true }],
    });
    expect(await rows(f.userId, f.binding.id)).toMatchObject({
      answers: [
        {
          operationId: f.command.operationId,
          sourceKind: "sms",
          sourceMessageId: f.inbound.id,
          sourceReplyBindingId: f.binding.id,
        },
      ],
      audits: [expect.objectContaining({ action: "finance.contextual_answer.accepted" })],
      binding: { state: "accepted", resultRevision: "2" },
      receipts: [
        expect.objectContaining({
          idempotencyKey: f.command.operationId,
          operation: "answer_contextual_question_v1",
          status: "completed",
        }),
      ],
    });

    await expect(service.runPage(f.userId, { limit: 10 })).resolves.toMatchObject({ claims: [] });
    const stored = await rows(f.userId, f.binding.id);
    expect(stored.answers).toHaveLength(1);
    expect(stored.audits).toHaveLength(1);
    expect(stored.receipts).toHaveLength(1);
  });

  it("keeps recovery-first Finance locks through binding consumption and rejects a concurrent app answer", async () => {
    const f = await fixture("Recovery first");
    const actualAdmission = createSmsAdmission({ enabled: () => true });
    let releaseConsume = () => {};
    let reportLocked = () => {};
    const held = new Promise<void>((resolve) => {
      releaseConsume = resolve;
    });
    const locked = new Promise<void>((resolve) => {
      reportLocked = resolve;
    });
    const gatedAdmission: AdmitSmsAnswer = async (tx, expected) => {
      const admitted = await actualAdmission(tx, expected);
      if (admitted.state !== "verified") return admitted;
      return {
        state: "verified",
        consume: async (accepted) => {
          reportLocked();
          await held;
          await admitted.consume(accepted);
        },
      };
    };
    const recovering = recovery(finance(gatedAdmission)).runPage(f.userId, { limit: 10 });
    try {
      await Promise.race([
        locked,
        recovering.then(() => {
          throw new Error("Recovery finished before SMS consumption.");
        }),
      ]);
      await expect(manualAnswer(f)).rejects.toMatchObject({
        code: "conflict",
        details: { retryable: true },
      });
      const pending = await rows(f.userId, f.binding.id);
      expect(pending.answers).toEqual([]);
      expect(pending.binding).toMatchObject({ state: "pending" });
    } finally {
      releaseConsume();
      await recovering;
    }

    const stored = await rows(f.userId, f.binding.id);
    expect(stored.answers).toHaveLength(1);
    expect(stored.answers[0]).toMatchObject({
      sourceKind: "sms",
      operationId: f.command.operationId,
    });
    expect(stored.binding).toMatchObject({ state: "accepted", resultRevision: "2" });
  });

  it("lets a concurrent app answer win first, then records one blocked SMS receipt without another answer", async () => {
    const f = await fixture("App first");
    let releaseManual = () => {};
    let reportLocked = () => {};
    const held = new Promise<void>((resolve) => {
      releaseManual = resolve;
    });
    const locked = new Promise<void>((resolve) => {
      reportLocked = resolve;
    });
    const answering = database.db.transaction(async (tx) => {
      const result = await manualAnswer(f, tx);
      reportLocked();
      await held;
      return result;
    });
    const service = recovery();
    let recovering: ReturnType<typeof service.runPage> | undefined;
    let firstPage: Awaited<ReturnType<typeof service.runPage>> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cleanupRejection: PromiseRejectedResult | undefined;
    try {
      await Promise.race([
        locked,
        answering.then(() => {
          throw new Error("App answer finished before the lock signal.");
        }),
      ]);
      recovering = service.runPage(f.userId, { limit: 10 });
      firstPage = await Promise.race([
        recovering,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error("Recovery waited on the app answer lock.")),
            2_000,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      releaseManual();
      const results = await Promise.allSettled([
        answering,
        recovering ?? Promise.resolve(undefined),
      ]);
      cleanupRejection = results.find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
    }
    if (cleanupRejection) throw cleanupRejection.reason;
    expect(firstPage).toMatchObject({
      claims: [
        {
          inboundMessageId: f.inbound.id,
          children: [{ state: "uncertain", reason: "answer_uncertain", terminal: false }],
        },
      ],
    });

    await expect(service.runPage(f.userId, { limit: 10 })).resolves.toMatchObject({
      claims: [
        {
          inboundMessageId: f.inbound.id,
          children: [{ state: "blocked", reason: "stale_revision", terminal: true }],
        },
      ],
    });
    const stored = await rows(f.userId, f.binding.id);
    expect(stored.answers).toHaveLength(1);
    expect(stored.answers[0]).toMatchObject({ sourceKind: "app" });
    expect(stored.binding).toMatchObject({ state: "blocked", reasonCode: "stale_revision" });
    expect(stored.receipts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          idempotencyKey: f.command.operationId,
          status: "completed",
          response: expect.objectContaining({ state: "blocked", reasonCode: "stale_revision" }),
        }),
      ]),
    );
  });
});
