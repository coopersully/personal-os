import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { TwilioConnector } from "@personal-os/connectors";
import {
  createDatabaseClient,
  type DatabaseClient,
  financeAccounts,
  financeTransactions,
  migrateDatabase,
  notificationAttemptItems,
  notificationDeliveryAttempts,
  notificationIntents,
  textingConnections,
  textMessages,
  users,
} from "@personal-os/database";
import type { FinanceHumanWorkRef } from "@personal-os/domain";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createNotificationService } from "../notification-service.js";
import { encryptJson } from "../security.js";
import { createTextingService } from "../texting-service.js";
import type { Principal } from "../types.js";
import { createFinanceContextualQuestionService } from "./contextual-question-service.js";
import { resolveContextualWorks } from "./work-resolver.js";

const encryptionKey = Buffer.alloc(32, 9).toString("base64");
const now = () => new Date("2026-09-23T12:00:00Z");

describe.sequential("Finance notification composition", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  let send: ReturnType<typeof vi.fn>;

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
    send = vi.fn(async () => ({ sid: `SM${randomUUID()}`, status: "queued" }));
  });

  async function createOwner(label: string) {
    const userId = randomUUID();
    await database.db.insert(users).values({
      id: userId,
      displayName: label,
      email: `${userId}@example.test`,
      passwordHash: "unused",
      planningTimezone: "America/New_York",
    });
    await database.db.insert(textingConnections).values({
      userId,
      encryptedPhoneNumber: encryptJson({ e164: "+12125550123" }, encryptionKey),
      phoneFingerprint: userId,
      phoneLastFour: "0123",
      country: "US",
      state: "active",
      consentVersion: "test",
      verifiedAt: now(),
    });
    const principal: Principal = {
      userId,
      actorId: userId,
      actorType: "user",
      scopes: new Set(["finances:read", "finances:write", "texting:read", "texting:write"]),
    };
    const questions = createFinanceContextualQuestionService({ db: database.db, now });
    const account = await database.db
      .insert(financeAccounts)
      .values({ userId, provider: "manual", institution: "Manual", name: "Cash" })
      .returning()
      .then(([value]) => value);
    if (!account) throw new Error("Missing Finance account.");
    return { userId, principal, questions, account };
  }

  async function createQuestion(owner: Awaited<ReturnType<typeof createOwner>>, merchant: string) {
    const transaction = await database.db
      .insert(financeTransactions)
      .values({
        userId: owner.userId,
        accountId: owner.account.id,
        amount: 1200,
        merchant,
        direction: "expense",
        transactionDate: "2026-09-22",
      })
      .returning()
      .then(([value]) => value);
    if (!transaction) throw new Error("Missing Finance transaction.");
    const created = await owner.questions.createQuestion(
      transaction.id,
      { operationId: randomUUID() },
      { principal: owner.principal, requestId: `create-${merchant}` },
    );
    if (created.state !== "available") throw new Error("Missing contextual question.");
    return { transaction, question: created.question };
  }

  function notifications(
    resolveWork: typeof resolveContextualWorks | null = resolveContextualWorks,
  ) {
    const texting = createTextingService({
      db: database.db,
      apiBaseUrl: "https://nohmi.test",
      enabled: true,
      encryptionKey,
      senderPhoneNumber: "+12125550124",
      now,
      twilio: { sendMessage: send } as unknown as TwilioConnector,
    });
    return createNotificationService({
      db: database.db,
      origin: "https://nohmi.test",
      transport: texting,
      now,
      ...(resolveWork === null ? {} : { resolveWork }),
    });
  }

  async function answer(owner: Awaited<ReturnType<typeof createOwner>>, work: FinanceHumanWorkRef) {
    return owner.questions.answerWork(
      {
        operationId: randomUUID(),
        work,
        text: "Lunch with a friend",
        source: { kind: "app", messageId: null },
      },
      { principal: owner.principal, requestId: `answer-${work.id}` },
    );
  }

  async function notificationRows() {
    return {
      attempts: await database.db.select().from(notificationDeliveryAttempts),
      intents: await database.db.select().from(notificationIntents),
      items: await database.db.select().from(notificationAttemptItems),
      messages: await database.db.select().from(textMessages),
    };
  }

  it("publishes one ordered real Finance batch atomically", async () => {
    const owner = await createOwner("Ordered batch");
    const first = await createQuestion(owner, "Lunch");
    const second = await createQuestion(owner, "Dinner");
    const refs = [second.question.work, first.question.work];
    const resolver = vi.fn(resolveContextualWorks);

    await expect(notifications(resolver).publish(owner.principal, { work: refs })).resolves.toEqual(
      {
        state: "accepted",
        intentIds: [expect.any(String), expect.any(String)],
      },
    );

    expect(resolver).toHaveBeenCalledTimes(1);
    expect(resolver.mock.calls[0]?.[1]).toEqual(refs);
    expect(
      (await database.db.select().from(notificationIntents)).map((intent) => intent.work),
    ).toEqual(expect.arrayContaining(refs));
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    "foreign",
    "stale",
    "unsupported",
  ] as const)("rejects a mixed %s Finance batch before any notification write", async (kind) => {
    const owner = await createOwner(`Invalid ${kind}`);
    const current = await createQuestion(owner, "Current");
    let invalid: FinanceHumanWorkRef;
    if (kind === "foreign") {
      const other = await createOwner("Other owner");
      invalid = (await createQuestion(other, "Foreign")).question.work;
    } else if (kind === "stale") {
      const stale = await createQuestion(owner, "Stale");
      invalid = { ...stale.question.work, actionRevision: "2" };
    } else {
      invalid = { ...current.question.work, id: randomUUID(), kind: "approval" };
    }

    await expect(
      notifications().publish(owner.principal, { work: [current.question.work, invalid] }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(notificationRows()).resolves.toEqual({
      attempts: [],
      intents: [],
      items: [],
      messages: [],
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("rolls back a contended real Finance batch before notification writes", async () => {
    const owner = await createOwner("Contended batch");
    const first = await createQuestion(owner, "First");
    const second = await createQuestion(owner, "Second");
    const blocker = await database.pool.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT id FROM finance_contextual_questions WHERE id=$1 FOR UPDATE", [
        second.question.id,
      ]);
      await expect(
        notifications().publish(owner.principal, {
          work: [first.question.work, second.question.work],
        }),
      ).rejects.toMatchObject({ code: "conflict", details: { retryable: true } });
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
    }
    await expect(notificationRows()).resolves.toEqual({
      attempts: [],
      intents: [],
      items: [],
      messages: [],
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("rechecks a real Finance answer at claim and keeps the current sibling", async () => {
    const owner = await createOwner("Claim recheck");
    const answered = await createQuestion(owner, "Answered");
    const current = await createQuestion(owner, "Current");
    const service = notifications();
    await service.publish(owner.principal, {
      work: [answered.question.work, current.question.work],
    });

    await expect(answer(owner, answered.question.work)).resolves.toMatchObject({
      state: "accepted",
    });
    const claim = await service.claim(owner.principal);
    expect(claim.state).toBe("claimed");
    expect(
      (await database.db.select().from(notificationAttemptItems)).map((item) => item.work),
    ).toEqual([current.question.work]);
    expect(
      (await database.db.select().from(notificationIntents)).map((intent) => ({
        id: intent.work.id,
        reason: intent.reason,
        state: intent.state,
      })),
    ).toEqual(
      expect.arrayContaining([
        { id: answered.question.id, reason: "resolved", state: "resolved" },
        { id: current.question.id, reason: null, state: "pending" },
      ]),
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("suppresses a claimed real Finance batch when its writer answers one item", async () => {
    const owner = await createOwner("Delivery recheck");
    const first = await createQuestion(owner, "First");
    const second = await createQuestion(owner, "Second");
    const service = notifications();
    await service.publish(owner.principal, { work: [first.question.work, second.question.work] });
    const claim = await service.claim(owner.principal);
    if (claim.state !== "claimed") throw new Error(`Expected claim, got ${claim.state}.`);

    await expect(answer(owner, second.question.work)).resolves.toMatchObject({ state: "accepted" });
    await service.deliver(owner.principal, claim);

    expect((await service.status(owner.principal)).attempts[0]).toMatchObject({
      state: "suppressed",
      reason: "resolved",
    });
    expect(await database.db.select().from(textMessages)).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  it("holds real Finance locks through queued delivery before one provider submission", async () => {
    const owner = await createOwner("Delivery lock race");
    const first = await createQuestion(owner, "First");
    const second = await createQuestion(owner, "Second");
    const service = notifications();
    await service.publish(owner.principal, { work: [first.question.work, second.question.work] });
    const claim = await service.claim(owner.principal);
    if (claim.state !== "claimed") throw new Error(`Expected claim, got ${claim.state}.`);

    let releaseResolver = () => {};
    let reportLocked = () => {};
    const held = new Promise<void>((resolve) => {
      releaseResolver = resolve;
    });
    const locked = new Promise<void>((resolve) => {
      reportLocked = resolve;
    });
    const gatedResolver: typeof resolveContextualWorks = async (userId, work, tx) => {
      const resolved = await resolveContextualWorks(userId, work, tx);
      reportLocked();
      await held;
      return resolved;
    };
    const delivery = notifications(gatedResolver).deliver(owner.principal, claim);
    try {
      await locked;
      await expect(answer(owner, second.question.work)).rejects.toMatchObject({
        code: "conflict",
        details: { retryable: true },
      });
      expect(send).not.toHaveBeenCalled();
      expect(await database.db.select().from(textMessages)).toEqual([]);
    } finally {
      releaseResolver();
      await delivery;
    }

    expect(send).toHaveBeenCalledTimes(1);
    expect(await database.db.select().from(textMessages)).toHaveLength(1);
    expect(
      (await database.db.select().from(notificationAttemptItems)).map((item) => item.work),
    ).toEqual(expect.arrayContaining([first.question.work, second.question.work]));
    expect((await service.status(owner.principal)).attempts[0]).toMatchObject({
      state: "accepted",
    });
  });

  it("keeps the unregistered production boundary representable", async () => {
    const owner = await createOwner("Unregistered boundary");
    const question = await createQuestion(owner, "Unregistered");
    const service = notifications(null);

    await expect(
      service.publish(owner.principal, { work: [question.question.work] }),
    ).resolves.toEqual({ state: "unavailable", reason: "producer_not_registered" });
    expect(await service.status(owner.principal)).toMatchObject({
      capability: "unavailable",
      reason: "producer_not_registered",
    });
    await expect(notificationRows()).resolves.toEqual({
      attempts: [],
      intents: [],
      items: [],
      messages: [],
    });
    expect(send).not.toHaveBeenCalled();
  });
});
