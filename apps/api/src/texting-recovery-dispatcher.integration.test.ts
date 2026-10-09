import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  createDatabaseClient,
  type DatabaseClient,
  migrateDatabase,
  textInboundClaims,
  textingConnections,
  textMessages,
  textReplyBindings,
  users,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { encryptJson } from "./security.js";
import { createTextingRecoveryDispatcher } from "./texting-recovery-dispatcher.js";
import { createTextingRecoveryService } from "./texting-recovery-service.js";

describe.sequential("durable Texting recovery dispatcher", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  const lowerOwner = "11111111-1111-4111-8111-111111111111";
  const upperOwner = "22222222-2222-4222-8222-222222222222";

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
  }, 120_000);
  afterAll(async () => {
    await database?.close();
    await container?.stop();
  });

  async function owner(userId: string) {
    await database.db.insert(users).values({
      id: userId,
      email: `${userId}@example.com`,
      displayName: "Recovery",
      passwordHash: "unused",
    });
    const [connection] = await database.db
      .insert(textingConnections)
      .values({
        userId,
        encryptedPhoneNumber: encryptJson(
          { e164: "+12025550123" },
          Buffer.alloc(32, 7).toString("base64"),
        ),
        phoneFingerprint: randomUUID(),
        phoneLastFour: "0123",
        country: "US",
        state: "active",
        consentVersion: "test",
        verifiedAt: new Date(),
      })
      .returning();
    if (!connection) throw new Error("Missing connection");
    return connection;
  }

  async function claim(userId: string, connectionId: string, consentEpoch: number, n: number) {
    const [message] = await database.db
      .insert(textMessages)
      .values({
        userId,
        connectionId,
        body: "Unbound reply",
        direction: "inbound",
        status: "delivered",
        providerMessageSid: randomUUID(),
        occurredAt: new Date(),
        occurredAtSource: "provider",
      })
      .returning();
    if (!message) throw new Error("Missing message");
    const id = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    await database.db.insert(textInboundClaims).values({
      id,
      userId,
      connectionId,
      messageId: message.id,
      consentEpoch,
    });
    return { id, messageId: message.id };
  }

  it("rotates 25 settled unbound attempts across owners, excludes accepted-only, and rechecks exact ownership", async () => {
    const lower = await owner(lowerOwner);
    const upper = await owner(upperOwner);
    const lowerClaims: { id: string; messageId: string }[] = [];
    for (let n = 1; n <= 26; n++)
      lowerClaims.push(await claim(lowerOwner, lower.id, lower.consentEpoch, n));
    const upperClaim = await claim(upperOwner, upper.id, upper.consentEpoch, 27);
    const acceptedClaim = await claim(upperOwner, upper.id, upper.consentEpoch, 28);
    const [outbound] = await database.db
      .insert(textMessages)
      .values({
        userId: upperOwner,
        connectionId: upper.id,
        body: "Question",
        direction: "outbound",
        status: "sent",
        providerMessageSid: randomUUID(),
        occurredAt: new Date(),
        occurredAtSource: "nohmi",
      })
      .returning();
    if (!outbound) throw new Error("Missing outbound");
    await database.db.insert(textReplyBindings).values({
      userId: upperOwner,
      connectionId: upper.id,
      outboundMessageId: outbound.id,
      consentEpoch: upper.consentEpoch,
      itemNumber: 1,
      workKind: "question",
      workId: randomUUID(),
      workRevision: "1",
      actionRevision: "1",
      answerMode: "free_text",
      answerVocabulary: null,
      expiresAt: new Date(Date.now() + 3_600_000),
      operationId: randomUUID(),
      inboundClaimId: acceptedClaim.id,
      canonicalAnswer: "Answer",
      state: "accepted",
      resultRevision: "2",
    });
    const recovery = createTextingRecoveryService({
      db: database.db,
      enabled: () => false,
      finance: {
        inspectSmsReceipt: async () => {
          throw new Error("No attached pending child");
        },
        executeAnswer: async () => {
          throw new Error("Disabled Texting cannot execute");
        },
      },
    });
    expect(await recovery.recoverClaim(lowerOwner, upperClaim.id)).toBeNull();
    expect(await recovery.recoverClaim(upperOwner, acceptedClaim.id)).toBeNull();
    const attempted: string[] = [];
    const dispatcher = createTextingRecoveryDispatcher({
      db: database.db,
      recovery: {
        recoverClaim: async (userId, claimId) => {
          attempted.push(`${userId}/${claimId}`);
          return recovery.recoverClaim(userId, claimId);
        },
      },
    });
    expect(await dispatcher.runPass()).toEqual({ attempted: 25, failed: 0 });
    expect(attempted).toHaveLength(25);
    expect(attempted.every((key) => key.startsWith(`${lowerOwner}/`))).toBe(true);
    expect(await dispatcher.runPass()).toEqual({ attempted: 2, failed: 0 });
    expect(attempted.slice(25)).toEqual([
      `${lowerOwner}/${lowerClaims[25]?.id}`,
      `${upperOwner}/${upperClaim.id}`,
    ]);
    expect(attempted).not.toContain(`${upperOwner}/${acceptedClaim.id}`);
    expect(await dispatcher.runPass()).toEqual({ attempted: 25, failed: 0 });
    expect(attempted[27]).toBe(`${lowerOwner}/${lowerClaims[0]?.id}`);

    const failures: string[] = [];
    const failingDispatcher = createTextingRecoveryDispatcher({
      db: database.db,
      recovery: {
        recoverClaim: async (userId, claimId) => {
          failures.push(`${userId}/${claimId}`);
          if (claimId === lowerClaims[0]?.id) throw new Error("transient database failure");
          return recovery.recoverClaim(userId, claimId);
        },
      },
    });
    expect(await failingDispatcher.runPass()).toEqual({ attempted: 25, failed: 1 });
    expect(await failingDispatcher.runPass()).toEqual({ attempted: 2, failed: 0 });
    expect(failures[25]).toBe(`${lowerOwner}/${lowerClaims[25]?.id}`);
  }, 120_000);
});
