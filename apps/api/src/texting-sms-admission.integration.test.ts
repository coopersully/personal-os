import { createHmac, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  createDatabaseClient,
  type Database,
  type DatabaseClient,
  migrateDatabase,
  textInboundClaims,
  textingConnections,
  textingVerificationChallenges,
  textMessages,
  textReplyBindings,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq, sql } from "drizzle-orm";
import { encryptJson } from "./security.js";
import {
  bindInboundReply as bindInboundReplyWithPolicy,
  createTextReplyBindings,
  expireOpenReplyBindings,
  transitionReplyChild,
} from "./texting-reply-binding.js";
import { createTextingService } from "./texting-service.js";
import {
  createSmsAdmission,
  isTextingSmsRetryableError,
  type TextingTransaction,
} from "./texting-sms-admission.js";

const admitSmsAnswer = createSmsAdmission({ enabled: () => true });
const bindInboundReply = (db: Database, userId: string, inboundMessageId: string) =>
  bindInboundReplyWithPolicy(db, userId, inboundMessageId, () => true);

describe.sequential("signed SMS child admission", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  const encryptionKey = Buffer.alloc(32, 7).toString("base64");
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
  }, 120_000);
  afterAll(async () => {
    await database?.close();
    await container?.stop();
  });

  async function fixture(body = "1: Dinner with Sam\n---\n2: Taxi for client") {
    const userId = randomUUID();
    const phone = `+1${userId.replaceAll("-", "").slice(0, 10)}`;
    await database.db.insert(users).values({
      id: userId,
      email: `${userId}@example.com`,
      displayName: "SMS",
      passwordHash: "unused",
    });
    const [connection] = await database.db
      .insert(textingConnections)
      .values({
        userId,
        encryptedPhoneNumber: encryptJson({ e164: phone }, encryptionKey),
        phoneFingerprint: createHmac("sha256", encryptionKey).update(phone).digest("hex"),
        phoneLastFour: "0001",
        country: "US",
        state: "active",
        consentVersion: "test",
        verifiedAt: new Date(),
      })
      .returning();
    if (!connection) throw new Error("No connection");
    const [outbound] = await database.db
      .insert(textMessages)
      .values({
        userId,
        connectionId: connection.id,
        body: "1) Purpose? 2) Purpose?",
        direction: "outbound",
        status: "queued",
        providerMessageSid: randomUUID(),
        occurredAt: new Date(),
        occurredAtSource: "nohmi",
      })
      .returning();
    const [inbound] = await database.db
      .insert(textMessages)
      .values({
        userId,
        connectionId: connection.id,
        body,
        direction: "inbound",
        status: "delivered",
        occurredAt: new Date(),
        occurredAtSource: "provider",
        providerMessageSid: randomUUID(),
      })
      .returning();
    if (!outbound || !inbound) throw new Error("No message");
    const [claim] = await database.db
      .insert(textInboundClaims)
      .values({
        userId,
        connectionId: connection.id,
        messageId: inbound.id,
        consentEpoch: connection.consentEpoch,
      })
      .returning();
    if (!claim) throw new Error("No claim");
    return { userId, connection, outbound, inbound, claim, phone };
  }

  function service(options: { blockSend?: boolean } = {}) {
    return createTextingService({
      apiBaseUrl: "https://api.example.com",
      db: database.db,
      enabled: true,
      encryptionKey,
      senderPhoneNumber: "+18885550100",
      twilio: {
        checkVerification: async () => "approved",
        getMessageOccurredAt: async () => new Date(),
        sendMessage: async () => {
          if (options.blockSend) throw Object.assign(new Error("opted out"), { code: 21610 });
          return { sid: randomUUID(), status: "queued" };
        },
        startVerification: async () => ({ sid: randomUUID(), status: "pending" }),
        validateWebhook: () => true,
      },
    });
  }

  async function singleBinding(f: Awaited<ReturnType<typeof fixture>>) {
    const operationId = randomUUID();
    const work = {
      domain: "finances" as const,
      kind: "question" as const,
      id: randomUUID(),
      revision: "1",
      actionRevision: "1",
    };
    const [binding] = await database.db.transaction(async (tx) =>
      createTextReplyBindings(tx, f.userId, f.connection, f.outbound.id, [
        {
          outboundMessageId: f.outbound.id,
          itemNumber: 1,
          answerMode: "free_text",
          answerVocabulary: null,
          operationId,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          work,
        },
      ]),
    );
    if (!binding) throw new Error("Missing binding");
    return { binding, operationId, work };
  }

  it.each([
    "failed",
    "undelivered",
  ] as const)("does not attach or admit a reply to a terminal %s outbound", async (status) => {
    const f = await fixture("Purpose");
    const { binding, operationId, work } = await singleBinding(f);
    await database.db
      .update(textMessages)
      .set({ status })
      .where(eq(textMessages.id, f.outbound.id));
    expect(await bindInboundReply(database.db, f.userId, f.inbound.id)).toEqual({
      state: "unavailable",
      reason: "delivery_failed",
    });
    expect(
      (
        await database.db
          .select()
          .from(textReplyBindings)
          .where(eq(textReplyBindings.id, binding.id))
      )[0]?.state,
    ).toBe("open");
    await database.db.transaction(async (tx) => {
      expect(
        (
          await admitSmsAnswer(tx, {
            userId: f.userId,
            operationId,
            work,
            text: "Purpose",
            inboundMessageId: f.inbound.id,
            replyBindingId: binding.id,
          })
        ).state,
      ).toBe("unavailable");
    });
  });

  it("rejects a pending answer after a terminal delivery callback without consuming it", async () => {
    const f = await fixture("Purpose");
    const { binding, operationId, work } = await singleBinding(f);
    expect((await bindInboundReply(database.db, f.userId, f.inbound.id)).state).toBe("pending");
    await service().updateStatus({
      MessageSid: f.outbound.providerMessageSid ?? "",
      MessageStatus: "failed",
    });
    expect(
      (await database.db.select().from(textMessages).where(eq(textMessages.id, f.outbound.id)))[0]
        ?.status,
    ).toBe("failed");
    await database.db.transaction(async (tx) => {
      expect(
        (
          await admitSmsAnswer(tx, {
            userId: f.userId,
            operationId,
            work,
            text: "Purpose",
            inboundMessageId: f.inbound.id,
            replyBindingId: binding.id,
          })
        ).state,
      ).toBe("unavailable");
    });
    expect(
      (
        await database.db
          .select()
          .from(textReplyBindings)
          .where(eq(textReplyBindings.id, binding.id))
      )[0]?.state,
    ).toBe("pending");
  });

  it("lets a terminal callback win the outbound lock before admission with no partial consume", async () => {
    const f = await fixture("Purpose");
    const { binding, operationId, work } = await singleBinding(f);
    expect((await bindInboundReply(database.db, f.userId, f.inbound.id)).state).toBe("pending");
    let releaseWriter: (() => void) | undefined;
    let writerHeld: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      writerHeld = resolve;
    });
    const released = new Promise<void>((resolve) => {
      releaseWriter = resolve;
    });
    const callback = database.db.transaction(async (tx) => {
      await tx
        .update(textMessages)
        .set({ status: "failed" })
        .where(eq(textMessages.id, f.outbound.id));
      writerHeld?.();
      await released;
    });
    await held;
    try {
      await expect(
        database.db.transaction((tx) =>
          admitSmsAnswer(tx, {
            userId: f.userId,
            operationId,
            work,
            text: "Purpose",
            inboundMessageId: f.inbound.id,
            replyBindingId: binding.id,
          }),
        ),
      ).rejects.toMatchObject({ cause: { code: "55P03" } });
    } finally {
      releaseWriter?.();
      await callback;
    }
    await database.db.transaction(async (tx) => {
      expect(
        (
          await admitSmsAnswer(tx, {
            userId: f.userId,
            operationId,
            work,
            text: "Purpose",
            inboundMessageId: f.inbound.id,
            replyBindingId: binding.id,
          })
        ).state,
      ).toBe("unavailable");
    });
    expect(
      (
        await database.db
          .select()
          .from(textReplyBindings)
          .where(eq(textReplyBindings.id, binding.id))
      )[0]?.state,
    ).toBe("pending");
  });

  it("keeps unconfirmed delivery and reversible disablement retryable without attaching", async () => {
    const f = await fixture("Purpose");
    const { binding, operationId, work } = await singleBinding(f);
    await database.db
      .update(textMessages)
      .set({ providerMessageSid: null })
      .where(eq(textMessages.id, f.outbound.id));
    expect(await bindInboundReply(database.db, f.userId, f.inbound.id)).toEqual({
      state: "waiting",
      reason: "delivery_unconfirmed",
    });
    await database.db
      .update(textMessages)
      .set({ providerMessageSid: randomUUID() })
      .where(eq(textMessages.id, f.outbound.id));
    let enabled = false;
    expect(
      await bindInboundReplyWithPolicy(database.db, f.userId, f.inbound.id, () => enabled),
    ).toEqual({
      state: "waiting",
      reason: "texting_disabled",
    });
    await expect(
      database.db.transaction((tx) =>
        createSmsAdmission({ enabled: () => enabled })(tx, {
          userId: f.userId,
          operationId,
          work,
          text: "Purpose",
          inboundMessageId: f.inbound.id,
          replyBindingId: binding.id,
        }),
      ),
    ).rejects.toMatchObject({ kind: "texting_sms_uncertain", reasonCode: "texting_disabled" });
    await expect(
      bindInboundReplyWithPolicy(database.db, f.userId, f.inbound.id, () => {
        throw new Error("Policy source unavailable");
      }),
    ).rejects.toMatchObject({ kind: "texting_sms_uncertain", reasonCode: "policy_check_failed" });
    await expect(
      database.db.transaction((tx) =>
        createSmsAdmission({
          enabled: () => {
            throw new Error("Policy source unavailable");
          },
        })(tx, {
          userId: f.userId,
          operationId,
          work,
          text: "Purpose",
          inboundMessageId: f.inbound.id,
          replyBindingId: binding.id,
        }),
      ),
    ).rejects.toMatchObject({ kind: "texting_sms_uncertain", reasonCode: "policy_check_failed" });
    enabled = true;
    expect(
      await bindInboundReplyWithPolicy(database.db, f.userId, f.inbound.id, () => enabled),
    ).toMatchObject({
      state: "pending",
    });
    await database.db
      .update(textMessages)
      .set({ status: "unknown" })
      .where(eq(textMessages.id, f.outbound.id));
    try {
      await database.db.transaction((tx) =>
        createSmsAdmission({ enabled: () => true })(tx, {
          userId: f.userId,
          operationId,
          work,
          text: "Purpose",
          inboundMessageId: f.inbound.id,
          replyBindingId: binding.id,
        }),
      );
      throw new Error("Expected retryable delivery error");
    } catch (error) {
      expect(isTextingSmsRetryableError(error)).toBe(true);
      if (isTextingSmsRetryableError(error)) expect(error.reasonCode).toBe("delivery_unconfirmed");
    }
  });

  it("rolls back consume when Texting is disabled after admission", async () => {
    const f = await fixture("Purpose");
    const { binding, operationId, work } = await singleBinding(f);
    expect((await bindInboundReply(database.db, f.userId, f.inbound.id)).state).toBe("pending");
    let enabled = true;
    await expect(
      database.db.transaction(async (tx) => {
        const admission = await createSmsAdmission({ enabled: () => enabled })(tx, {
          userId: f.userId,
          operationId,
          work,
          text: "Purpose",
          inboundMessageId: f.inbound.id,
          replyBindingId: binding.id,
        });
        if (admission.state !== "verified") throw new Error("Not verified");
        enabled = false;
        await admission.consume({
          operationId,
          state: "accepted",
          work: [],
          resultRevision: "2",
          reasonCode: null,
        });
      }),
    ).rejects.toMatchObject({ kind: "texting_sms_uncertain", reasonCode: "texting_disabled" });
    expect(
      (
        await database.db
          .select()
          .from(textReplyBindings)
          .where(eq(textReplyBindings.id, binding.id))
      )[0]?.state,
    ).toBe("pending");
    let checks = 0;
    await expect(
      database.db.transaction(async (tx) => {
        const admission = await createSmsAdmission({
          enabled: () => {
            checks += 1;
            if (checks === 3) throw new Error("Policy source unavailable");
            return true;
          },
        })(tx, {
          userId: f.userId,
          operationId,
          work,
          text: "Purpose",
          inboundMessageId: f.inbound.id,
          replyBindingId: binding.id,
        });
        if (admission.state !== "verified") throw new Error("Not verified");
        await admission.consume({
          operationId,
          state: "accepted",
          work: [],
          resultRevision: "2",
          reasonCode: null,
        });
      }),
    ).rejects.toMatchObject({ kind: "texting_sms_uncertain", reasonCode: "policy_check_failed" });
    expect(
      (
        await database.db
          .select()
          .from(textReplyBindings)
          .where(eq(textReplyBindings.id, binding.id))
      )[0]?.state,
    ).toBe("pending");
  });

  it("sweeps only expired open bindings and permits their owner-live cleanup", async () => {
    const f = await fixture("Purpose");
    const { binding: pending } = await singleBinding(f);
    expect((await bindInboundReply(database.db, f.userId, f.inbound.id)).state).toBe("pending");
    const [expired] = await database.db
      .insert(textReplyBindings)
      .values({
        userId: f.userId,
        connectionId: f.connection.id,
        outboundMessageId: f.outbound.id,
        consentEpoch: f.connection.consentEpoch,
        itemNumber: 2,
        workKind: "question",
        workId: randomUUID(),
        workRevision: "1",
        actionRevision: "1",
        answerMode: "free_text",
        answerVocabulary: null,
        expiresAt: new Date(Date.now() - 60_000),
        operationId: randomUUID(),
      })
      .returning();
    if (!expired) throw new Error("Missing expired binding");
    const [fresh] = await database.db
      .insert(textReplyBindings)
      .values({
        userId: f.userId,
        connectionId: f.connection.id,
        outboundMessageId: f.outbound.id,
        consentEpoch: f.connection.consentEpoch,
        itemNumber: 3,
        workKind: "question",
        workId: randomUUID(),
        workRevision: "1",
        actionRevision: "1",
        answerMode: "free_text",
        answerVocabulary: null,
        expiresAt: new Date(Date.now() + 60_000),
        operationId: randomUUID(),
      })
      .returning();
    if (!fresh) throw new Error("Missing fresh binding");
    await expect(
      database.db
        .update(textReplyBindings)
        .set({ state: "expired" })
        .where(eq(textReplyBindings.id, fresh.id)),
    ).rejects.toThrow();
    await expect(
      database.db.delete(textReplyBindings).where(eq(textReplyBindings.id, expired.id)),
    ).rejects.toThrow();
    expect(await expireOpenReplyBindings(database.db, f.userId)).toBe(1);
    expect(await expireOpenReplyBindings(database.db, f.userId)).toBe(0);
    expect(
      (
        await database.db
          .select()
          .from(textReplyBindings)
          .where(eq(textReplyBindings.id, pending.id))
      )[0]?.state,
    ).toBe("pending");
    expect(
      (
        await database.db
          .select()
          .from(textReplyBindings)
          .where(eq(textReplyBindings.id, expired.id))
      )[0]?.state,
    ).toBe("expired");
    expect(
      (
        await database.db.select().from(textReplyBindings).where(eq(textReplyBindings.id, fresh.id))
      )[0]?.state,
    ).toBe("open");
    await database.db.delete(textReplyBindings).where(eq(textReplyBindings.id, expired.id));
  });

  it("keeps numbered choice syntax after a mixed-mode sibling is answered", async () => {
    const f = await fixture("1: Dinner");
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    await database.db.transaction((tx) =>
      createTextReplyBindings(tx, f.userId, f.connection, f.outbound.id, [
        {
          outboundMessageId: f.outbound.id,
          itemNumber: 1,
          answerMode: "free_text",
          answerVocabulary: null,
          operationId: randomUUID(),
          expiresAt,
          work: {
            domain: "finances",
            kind: "question",
            id: randomUUID(),
            revision: "1",
            actionRevision: "1",
          },
        },
        {
          outboundMessageId: f.outbound.id,
          itemNumber: 2,
          answerMode: "choices",
          answerVocabulary: ["yes", "no"],
          operationId: randomUUID(),
          expiresAt,
          work: {
            domain: "finances",
            kind: "question",
            id: randomUUID(),
            revision: "1",
            actionRevision: "1",
          },
        },
      ]),
    );
    expect(await bindInboundReply(database.db, f.userId, f.inbound.id)).toMatchObject({
      state: "pending",
      children: [{ answer: "Dinner" }],
    });
    const [second] = await database.db
      .insert(textMessages)
      .values({
        userId: f.userId,
        connectionId: f.connection.id,
        body: "2: yes",
        direction: "inbound",
        status: "delivered",
        occurredAt: new Date(),
        occurredAtSource: "provider",
        providerMessageSid: randomUUID(),
      })
      .returning();
    if (!second) throw new Error("Missing second inbound");
    await database.db.insert(textInboundClaims).values({
      userId: f.userId,
      connectionId: f.connection.id,
      messageId: second.id,
      consentEpoch: f.connection.consentEpoch,
    });
    expect(await bindInboundReply(database.db, f.userId, second.id)).toMatchObject({
      state: "pending",
      children: [{ answer: "yes" }],
    });
  });

  it("binds two distinct canonical answers to one signed inbound and consumes each once", async () => {
    const f = await fixture();
    const operations = [randomUUID(), randomUUID()];
    const workIds = [randomUUID(), randomUUID()];
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    await database.db.transaction(async (tx) =>
      createTextReplyBindings(
        tx,
        f.userId,
        f.connection,
        f.outbound.id,
        operations.map((operationId, index) => ({
          outboundMessageId: f.outbound.id,
          itemNumber: index + 1,
          answerMode: "free_text",
          answerVocabulary: null,
          operationId,
          expiresAt,
          work: {
            domain: "finances",
            kind: "question",
            id: workIds[index] ?? randomUUID(),
            revision: "1",
            actionRevision: "1",
          },
        })),
      ),
    );
    const bound = await bindInboundReply(database.db, f.userId, f.inbound.id);
    expect(bound).toMatchObject({
      state: "pending",
      children: [
        { operationId: operations[0], answer: "Dinner with Sam" },
        { operationId: operations[1], answer: "Taxi for client" },
      ],
    });
    expect(await bindInboundReply(database.db, f.userId, f.inbound.id)).toEqual(bound);
    if (bound.state !== "pending") throw new Error("Not bound");
    for (let index = 0; index < 2; index += 1) {
      const child = bound.children[index];
      if (!child) throw new Error("Missing child");
      await database.db.transaction(async (tx) => {
        const expected = {
          userId: f.userId,
          operationId: child.operationId,
          work: {
            domain: "finances" as const,
            kind: "question" as const,
            id: workIds[index] ?? "",
            revision: "1",
            actionRevision: "1",
          },
          text: child.answer,
          inboundMessageId: f.inbound.id,
          replyBindingId: child.bindingId,
        };
        const admission = await admitSmsAnswer(tx, expected);
        expect(admission.state).toBe("verified");
        if (admission.state !== "verified") throw new Error("Not verified");
        await admission.consume({
          operationId: child.operationId,
          state: "accepted",
          work: [],
          resultRevision: "2",
          reasonCode: null,
        });
        await expect(
          admission.consume({
            operationId: child.operationId,
            state: "accepted",
            work: [],
            resultRevision: "2",
            reasonCode: null,
          }),
        ).rejects.toThrow();
      });
    }
    const rows = await database.db
      .select()
      .from(textReplyBindings)
      .where(eq(textReplyBindings.userId, f.userId));
    expect(rows.map((row) => row.state)).toEqual(["accepted", "accepted"]);
    await database.db.transaction(async (tx) => {
      const child = bound.children[0];
      if (!child) throw new Error("Missing child");
      expect(
        (
          await admitSmsAnswer(tx, {
            userId: f.userId,
            operationId: child.operationId,
            work: {
              domain: "finances",
              kind: "question",
              id: workIds[0] ?? "",
              revision: "1",
              actionRevision: "1",
            },
            text: child.answer,
            inboundMessageId: f.inbound.id,
            replyBindingId: child.bindingId,
          })
        ).state,
      ).toBe("unavailable");
    });
  });

  it("rejects cross-connection evidence and preserves pending history until explicit cleanup", async () => {
    const f = await fixture("Purpose");
    const foreign = await fixture("Foreign");
    await expect(
      database.db.insert(textInboundClaims).values({
        userId: f.userId,
        connectionId: f.connection.id,
        messageId: foreign.inbound.id,
        consentEpoch: 1,
      }),
    ).rejects.toThrow();
    const [binding] = await database.db.transaction(async (tx) =>
      createTextReplyBindings(tx, f.userId, f.connection, f.outbound.id, [
        {
          outboundMessageId: f.outbound.id,
          itemNumber: 1,
          answerMode: "free_text",
          answerVocabulary: null,
          operationId: randomUUID(),
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          work: {
            domain: "finances",
            kind: "question",
            id: randomUUID(),
            revision: "1",
            actionRevision: "1",
          },
        },
      ]),
    );
    if (!binding) throw new Error("No binding");
    expect(await bindInboundReply(database.db, f.userId, f.inbound.id)).toMatchObject({
      state: "pending",
    });
    expect(
      await transitionReplyChild(database.db, f.userId, binding.id, binding.operationId, {
        state: "pending",
        reasonCode: "different",
      }),
    ).toBe(false);
    await expect(
      database.db.delete(textMessages).where(eq(textMessages.id, f.inbound.id)),
    ).rejects.toThrow();
    await expect(
      database.db.delete(textMessages).where(eq(textMessages.id, f.outbound.id)),
    ).rejects.toThrow();
    await expect(
      database.db.delete(textInboundClaims).where(eq(textInboundClaims.id, f.claim.id)),
    ).rejects.toThrow();
    await expect(
      database.db.delete(textReplyBindings).where(eq(textReplyBindings.id, binding.id)),
    ).rejects.toThrow();
    expect(
      await transitionReplyChild(database.db, f.userId, binding.id, binding.operationId, {
        state: "waiting",
        reasonCode: "dependency_unavailable",
      }),
    ).toBe(true);
    expect(
      await transitionReplyChild(database.db, f.userId, binding.id, binding.operationId, {
        state: "pending",
        reasonCode: null,
      }),
    ).toBe(true);
    expect(
      await transitionReplyChild(database.db, f.userId, binding.id, binding.operationId, {
        state: "blocked",
        reasonCode: "stale_revision",
      }),
    ).toBe(true);
    expect(
      await transitionReplyChild(database.db, f.userId, binding.id, binding.operationId, {
        state: "blocked",
        reasonCode: "stale_revision",
      }),
    ).toBe(true);
    await database.db.delete(users).where(eq(users.id, f.userId));
    expect(
      await database.db
        .select()
        .from(textReplyBindings)
        .where(eq(textReplyBindings.userId, f.userId)),
    ).toHaveLength(0);
  });

  it("enforces same-owner message/claim/outbound connection identity at the database boundary", async () => {
    const f = await fixture("Purpose");
    // Current production schema permits only one connection per owner. Removing that
    // unrelated unique index inside a rolled-back transaction proves the composite FKs
    // remain correct if the one-connection policy later changes.
    const withSecondConnection = async (
      test: (tx: TextingTransaction, id: string) => Promise<void>,
    ) =>
      database.db.transaction(async (tx) => {
        await tx.execute(sql`DROP INDEX texting_connections_user_idx`);
        const [second] = await tx
          .insert(textingConnections)
          .values({
            userId: f.userId,
            encryptedPhoneNumber: { ciphertext: "fixture" } as never,
            phoneFingerprint: randomUUID(),
            phoneLastFour: "0002",
            country: "US",
            state: "disconnected",
            consentVersion: "test",
            verifiedAt: new Date(),
          })
          .returning({ id: textingConnections.id });
        if (!second) throw new Error("No second connection");
        await test(tx, second.id);
        await tx.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`);
      });
    await expect(
      withSecondConnection(async (tx, connectionId) => {
        await tx.insert(textInboundClaims).values({
          userId: f.userId,
          connectionId,
          messageId: f.inbound.id,
          consentEpoch: 1,
        });
      }),
    ).rejects.toThrow();
    await expect(
      withSecondConnection(async (tx, connectionId) => {
        await tx.insert(textReplyBindings).values({
          userId: f.userId,
          connectionId,
          outboundMessageId: f.outbound.id,
          consentEpoch: 1,
          itemNumber: 1,
          workKind: "question",
          workId: randomUUID(),
          workRevision: "1",
          actionRevision: "1",
          answerMode: "free_text",
          answerVocabulary: null,
          expiresAt: new Date(Date.now() + 60_000),
          operationId: randomUUID(),
        });
      }),
    ).rejects.toThrow();
  });

  it("rolls back accepted consumption with its caller transaction and retains acceptance after disconnect", async () => {
    const f = await fixture("Purpose");
    const operationId = randomUUID();
    const work = {
      domain: "finances" as const,
      kind: "question" as const,
      id: randomUUID(),
      revision: "1",
      actionRevision: "1",
    };
    const [binding] = await database.db.transaction(async (tx) =>
      createTextReplyBindings(tx, f.userId, f.connection, f.outbound.id, [
        {
          outboundMessageId: f.outbound.id,
          itemNumber: 1,
          answerMode: "free_text",
          answerVocabulary: null,
          operationId,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          work,
        },
      ]),
    );
    if (!binding) throw new Error("Missing binding");
    await bindInboundReply(database.db, f.userId, f.inbound.id);
    const expected = {
      userId: f.userId,
      operationId,
      work,
      text: "Purpose",
      inboundMessageId: f.inbound.id,
      replyBindingId: binding.id,
    };
    await expect(
      database.db.transaction(async (tx) => {
        const admission = await admitSmsAnswer(tx, expected);
        if (admission.state !== "verified") throw new Error("Not verified");
        await admission.consume({
          operationId,
          state: "accepted",
          work: [],
          resultRevision: "2",
          reasonCode: null,
        });
        throw new Error("caller rolled back after consume");
      }),
    ).rejects.toThrow("caller rolled back after consume");
    expect(
      (
        await database.db
          .select()
          .from(textReplyBindings)
          .where(eq(textReplyBindings.id, binding.id))
      )[0]?.state,
    ).toBe("pending");
    await database.db.transaction(async (tx) => {
      const admission = await admitSmsAnswer(tx, expected);
      if (admission.state !== "verified") throw new Error("Not verified");
      await admission.consume({
        operationId,
        state: "accepted",
        work: [],
        resultRevision: "2",
        reasonCode: null,
      });
    });
    await service().disconnect(f.userId);
    expect(
      (
        await database.db
          .select()
          .from(textReplyBindings)
          .where(eq(textReplyBindings.id, binding.id))
      )[0]?.state,
    ).toBe("accepted");
    await database.db.transaction(async (tx) => {
      expect((await admitSmsAnswer(tx, expected)).state).toBe("unavailable");
    });
  });

  it("orders admission against disconnect, STOP, message status, and queued owner deletion", async () => {
    const f = await fixture("Purpose");
    const operationId = randomUUID();
    const work = {
      domain: "finances" as const,
      kind: "question" as const,
      id: randomUUID(),
      revision: "1",
      actionRevision: "1",
    };
    const [binding] = await database.db.transaction(async (tx) =>
      createTextReplyBindings(tx, f.userId, f.connection, f.outbound.id, [
        {
          outboundMessageId: f.outbound.id,
          itemNumber: 1,
          answerMode: "free_text",
          answerVocabulary: null,
          operationId,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          work,
        },
      ]),
    );
    if (!binding) throw new Error("Missing binding");
    expect((await bindInboundReply(database.db, f.userId, f.inbound.id)).state).toBe("pending");
    let releaseAdmission: (() => void) | undefined;
    let admissionHeld: (() => void) | undefined;
    const held = new Promise<void>((resolveHeld) => {
      admissionHeld = resolveHeld;
    });
    const released = new Promise<void>((resolveReleased) => {
      releaseAdmission = resolveReleased;
    });
    const admitting = database.db.transaction(async (tx) => {
      await tx.select({ id: users.id }).from(users).where(eq(users.id, f.userId)).for("key share");
      const admission = await admitSmsAnswer(tx, {
        userId: f.userId,
        operationId,
        work,
        text: "Purpose",
        inboundMessageId: f.inbound.id,
        replyBindingId: binding.id,
      });
      expect(admission.state).toBe("verified");
      if (admission.state !== "verified") throw new Error("Not verified");
      admissionHeld?.();
      await released;
      await admission.consume({
        operationId,
        state: "accepted",
        work: [],
        resultRevision: "2",
        reasonCode: null,
      });
    });
    await held;
    const statusWriter = service().updateStatus({
      MessageSid: f.outbound.providerMessageSid ?? "",
      MessageStatus: "failed",
    });
    expect(
      await Promise.race([
        statusWriter.then(() => "finished"),
        new Promise((resolve) => setTimeout(() => resolve("waiting"), 30)),
      ]),
    ).toBe("waiting");
    const disconnect = service().disconnect(f.userId);
    expect(
      await Promise.race([
        disconnect.then(() => "finished"),
        new Promise((resolve) => setTimeout(() => resolve("waiting"), 30)),
      ]),
    ).toBe("waiting");
    releaseAdmission?.();
    await admitting;
    await statusWriter;
    await disconnect;
    expect(
      (
        await database.db
          .select()
          .from(textReplyBindings)
          .where(eq(textReplyBindings.id, binding.id))
      )[0]?.state,
    ).toBe("accepted");
    expect(
      (await database.db.select().from(textMessages).where(eq(textMessages.id, f.outbound.id)))[0]
        ?.status,
    ).toBe("failed");
    await database.db.transaction(async (tx) => {
      expect(
        (
          await admitSmsAnswer(tx, {
            userId: f.userId,
            operationId,
            work,
            text: "Purpose",
            inboundMessageId: f.inbound.id,
            replyBindingId: binding.id,
          })
        ).state,
      ).toBe("unavailable");
    });

    const stop = await fixture("Purpose");
    const stopOperationId = randomUUID();
    const stopWork = {
      domain: "finances" as const,
      kind: "question" as const,
      id: randomUUID(),
      revision: "1",
      actionRevision: "1",
    };
    const [stopBinding] = await database.db.transaction(async (tx) =>
      createTextReplyBindings(tx, stop.userId, stop.connection, stop.outbound.id, [
        {
          outboundMessageId: stop.outbound.id,
          itemNumber: 1,
          answerMode: "free_text",
          answerVocabulary: null,
          operationId: stopOperationId,
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          work: stopWork,
        },
      ]),
    );
    if (!stopBinding) throw new Error("Missing stop binding");
    expect((await bindInboundReply(database.db, stop.userId, stop.inbound.id)).state).toBe(
      "pending",
    );
    let releaseStop: (() => void) | undefined;
    let stopHeld: (() => void) | undefined;
    const stopHeldPromise = new Promise<void>((resolveHeld) => {
      stopHeld = resolveHeld;
    });
    const stopReleasePromise = new Promise<void>((resolveReleased) => {
      releaseStop = resolveReleased;
    });
    const stopWriter = database.db.transaction(async (tx) => {
      await tx
        .update(textingConnections)
        .set({ state: "opted_out", consentEpoch: stop.connection.consentEpoch + 1 })
        .where(eq(textingConnections.id, stop.connection.id));
      stopHeld?.();
      await stopReleasePromise;
    });
    await stopHeldPromise;
    await expect(
      database.db.transaction(async (tx) => {
        await tx
          .select()
          .from(textingConnections)
          .where(eq(textingConnections.id, stop.connection.id))
          .for("share", { noWait: true });
      }),
    ).rejects.toThrow();
    releaseStop?.();
    await stopWriter;
    await database.db.transaction(async (tx) => {
      expect(
        (
          await admitSmsAnswer(tx, {
            userId: stop.userId,
            operationId: stopOperationId,
            work: stopWork,
            text: "Purpose",
            inboundMessageId: stop.inbound.id,
            replyBindingId: stopBinding.id,
          })
        ).state,
      ).toBe("unavailable");
    });
    expect(
      (
        await database.db
          .select()
          .from(textReplyBindings)
          .where(eq(textReplyBindings.id, stopBinding.id))
      )[0]?.state,
    ).toBe("pending");
    await service().inbound({ From: stop.phone, MessageSid: randomUUID(), Body: "STOP" });
    const stopClaims = await database.db
      .select()
      .from(textInboundClaims)
      .where(eq(textInboundClaims.userId, stop.userId));
    expect(stopClaims).toHaveLength(1); // the original ordinary message only

    const status = await fixture("Purpose");
    await service().updateStatus({
      MessageSid: status.inbound.providerMessageSid ?? "",
      MessageStatus: "sent",
    });
    const unchanged = await database.db
      .select()
      .from(textMessages)
      .where(eq(textMessages.id, status.inbound.id));
    expect(unchanged[0]?.status).toBe("delivered");

    const deleting = await fixture("Purpose");
    let releaseOwner: (() => void) | undefined;
    let ownerHeld: (() => void) | undefined;
    const ownerHeldPromise = new Promise<void>((resolveHeld) => {
      ownerHeld = resolveHeld;
    });
    const ownerReleasePromise = new Promise<void>((resolveReleased) => {
      releaseOwner = resolveReleased;
    });
    const ownerReader = database.db.transaction(async (tx) => {
      await tx.select().from(users).where(eq(users.id, deleting.userId)).for("key share");
      ownerHeld?.();
      await ownerReleasePromise;
    });
    await ownerHeldPromise;
    const remove = database.db.delete(users).where(eq(users.id, deleting.userId));
    const removing = Promise.resolve(remove);
    expect(
      await Promise.race([
        removing.then(() => "finished"),
        new Promise((resolve) => setTimeout(() => resolve("waiting"), 30)),
      ]),
    ).toBe("waiting");
    releaseOwner?.();
    await ownerReader;
    await removing;
  });

  it("waits for admission before verification, manual send, notification send, and provider block", async () => {
    async function barrier(
      run: (f: Awaited<ReturnType<typeof fixture>>) => Promise<unknown>,
      failure = false,
    ) {
      const f = await fixture("Purpose");
      let release: (() => void) | undefined;
      let held: (() => void) | undefined;
      const heldPromise = new Promise<void>((resolveHeld) => {
        held = resolveHeld;
      });
      const releasePromise = new Promise<void>((resolveRelease) => {
        release = resolveRelease;
      });
      const reader = database.db.transaction(async (tx) => {
        await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, f.userId))
          .for("key share");
        await tx
          .select()
          .from(textingConnections)
          .where(eq(textingConnections.id, f.connection.id))
          .for("share", { noWait: true });
        held?.();
        await releasePromise;
      });
      await heldPromise;
      const writer = run(f);
      const observed = writer.then(
        () => "finished",
        () => "failed",
      );
      expect(
        await Promise.race([
          observed,
          new Promise((resolve) => setTimeout(() => resolve("waiting"), 30)),
        ]),
      ).toBe("waiting");
      release?.();
      await reader;
      if (failure) await expect(writer).rejects.toThrow();
      else await writer;
    }

    await barrier(async (f) => {
      const [challenge] = await database.db
        .insert(textingVerificationChallenges)
        .values({
          userId: f.userId,
          encryptedPhoneNumber: encryptJson({ e164: f.phone }, encryptionKey),
          phoneFingerprint: f.connection.phoneFingerprint,
          phoneLastFour: "0001",
          country: "US",
          consentVersion: "test",
          providerVerificationSid: randomUUID(),
          status: "pending",
          expiresAt: new Date(Date.now() + 60_000),
        })
        .returning();
      if (!challenge) throw new Error("Missing challenge");
      await service().checkVerification(f.userId, challenge.id, "123456");
    });
    await barrier(async (f) => {
      const texting = service();
      const principal = {
        userId: f.userId,
        actorId: f.userId,
        actorType: "user" as const,
        scopes: new Set(["texting:read" as const, "texting:write" as const]),
      };
      const read = await texting.conversation(principal, "UTC", { limit: 10 });
      await texting.send(principal, "UTC", {
        body: "Acknowledged.",
        contentKind: "concise",
        conversationReceipt: read.conversationReceipt ?? "",
      });
    });
    await barrier(async (f) => {
      await service().sendNotification(f.userId, async () => ({
        body: "Question available.",
        queued: async () => undefined,
      }));
    });
    await barrier(async (f) => {
      const texting = service({ blockSend: true });
      const principal = {
        userId: f.userId,
        actorId: f.userId,
        actorType: "user" as const,
        scopes: new Set(["texting:read" as const, "texting:write" as const]),
      };
      const read = await texting.conversation(principal, "UTC", { limit: 10 });
      await texting.send(principal, "UTC", {
        body: "Acknowledged.",
        contentKind: "concise",
        conversationReceipt: read.conversationReceipt ?? "",
      });
    }, true);
  });
});
