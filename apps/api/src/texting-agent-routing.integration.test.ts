import { createHmac } from "node:crypto";
import { resolve } from "node:path";
import type { TwilioConnector } from "@personal-os/connectors";
import {
  automationHostSchedules,
  createDatabaseClient,
  type DatabaseClient,
  migrateDatabase,
  textInboundClaims,
  textingAgentQueue,
  textingAgentSettings,
  textingConnections,
  textMessages,
  textReplyBindings,
  users,
} from "@personal-os/database";
import { textingConsentVersion } from "@personal-os/domain";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import { encryptJson } from "./security.js";
import { bindInboundReply } from "./texting-reply-binding.js";
import { createTextingService } from "./texting-service.js";

describe.sequential("general SMS and Finance reply admission", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  const encryptionKey = Buffer.alloc(32, 8).toString("base64");
  let sequence = 200;
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
  }, 120_000);
  afterAll(async () => {
    await database?.close();
    await container?.stop();
  });

  async function fixture(enabled = true) {
    const userId = crypto.randomUUID(),
      connectionId = crypto.randomUUID(),
      scheduleId = crypto.randomUUID();
    const phone = `+12125550${sequence++}`;
    let current = new Date("2026-11-05T16:00:00Z");
    const now = () => current;
    await database.db.insert(users).values({
      id: userId,
      email: `${userId}@example.test`,
      displayName: "Routing fixture",
      passwordHash: "unused",
    });
    await database.db.insert(textingConnections).values({
      id: connectionId,
      userId,
      encryptedPhoneNumber: encryptJson({ e164: phone }, encryptionKey),
      phoneFingerprint: createHmac("sha256", encryptionKey).update(phone).digest("hex"),
      phoneLastFour: phone.slice(-4),
      country: "US",
      consentVersion: textingConsentVersion,
      verifiedAt: now(),
    });
    if (enabled) {
      await database.db.insert(automationHostSchedules).values({
        id: scheduleId,
        userId,
        authorizationConnectionId: crypto.randomUUID(),
        schedule: {
          id: scheduleId,
          tenantAuthorizationConnectionId: crypto.randomUUID(),
          label: "Routing fixture",
          effectiveScopes: ["finances:maintain"],
          version: 1,
          createdAt: now().toISOString(),
          updatedAt: now().toISOString(),
          lastObservedAt: null,
          hostSurface: "claude_code_routine",
          hostAutomationId: "trig_12345678901",
          trigger: { type: "event", expectedMaximumLatencyMinutes: 5 },
          state: "active",
          nextExpectedAt: null,
        },
      });
      await database.db.insert(textingAgentSettings).values({ userId, scheduleId });
    }
    const twilio: TwilioConnector = {
      startVerification: vi.fn(async () => ({
        sid: `VE${crypto.randomUUID()}`,
        status: "pending",
      })),
      checkVerification: vi.fn(async () => "approved" as const),
      getMessageOccurredAt: vi.fn(async () => now()),
      sendMessage: vi.fn(async () => ({
        sid: `SM${crypto.randomUUID()}`,
        status: "queued",
        dateCreated: now(),
      })),
      validateWebhook: () => true,
    };
    const service = createTextingService({
      db: database.db,
      now,
      enabled: true,
      encryptionKey,
      apiBaseUrl: "https://api.example.test",
      senderPhoneNumber: "+18885550100",
      twilio,
    });
    const inbound = async (body: string) => {
      current = new Date(current.getTime() + 1000);
      await service.inbound({
        From: phone,
        To: "+18885550100",
        MessageSid: `SM${crypto.randomUUID()}`,
        Body: body,
      });
    };
    async function questions(modes: ("choices" | "free_text")[], submitted = true) {
      const [outbound] = await database.db
        .insert(textMessages)
        .values({
          userId,
          connectionId,
          direction: "outbound",
          status: "sent",
          body: "Finance questions",
          occurredAt: now(),
          occurredAtSource: "nohmi",
          ...(submitted
            ? { providerMessageSid: `SM${crypto.randomUUID()}`, providerSubmittedAt: now() }
            : {}),
        })
        .returning();
      if (!outbound) throw new Error("Missing message");
      for (const [index, answerMode] of modes.entries())
        await database.db.insert(textReplyBindings).values({
          userId,
          connectionId,
          outboundMessageId: outbound.id,
          consentEpoch: 1,
          itemNumber: index + 1,
          workKind: "question",
          workId: crypto.randomUUID(),
          workRevision: "1",
          actionRevision: "1",
          answerMode,
          answerVocabulary: answerMode === "choices" ? ["yes", "no"] : null,
          expiresAt: new Date(current.getTime() + 60_000),
          operationId: crypto.randomUUID(),
          createdAt: now(),
          updatedAt: now(),
        });
    }
    const queue = () =>
      database.db.select().from(textingAgentQueue).where(eq(textingAgentQueue.userId, userId));
    async function legacyReply() {
      const [claim] = await database.db
        .select()
        .from(textInboundClaims)
        .where(eq(textInboundClaims.userId, userId));
      if (!claim) throw new Error("Missing claim");
      return bindInboundReply(database.db, userId, claim.messageId, () => true, now());
    }
    return { service, inbound, questions, queue, legacyReply, userId, phone };
  }

  it("keeps new workspace requests out of an open free-text Finance question", async () => {
    const f = await fixture();
    await f.questions(["free_text"]);
    await f.inbound("Schedule lunch tomorrow");
    expect(await f.queue()).toHaveLength(1);
    expect(await f.legacyReply()).toMatchObject({ state: "unavailable" });
  });
  it("preserves exact bounded choice answers and explicitly numbered free-text answers", async () => {
    const choice = await fixture();
    await choice.questions(["choices"]);
    await choice.inbound("yes");
    expect(await choice.queue()).toHaveLength(0);
    expect(await choice.legacyReply()).toMatchObject({ state: "pending" });
    const text = await fixture();
    await text.questions(["free_text"]);
    await text.inbound("1: Yes, with Sam");
    expect(await text.queue()).toHaveLength(0);
    expect(await text.legacyReply()).toMatchObject({ state: "pending" });
  });
  it("keeps ambiguous multi-item answers and unconfirmed outbound evidence in the general queue", async () => {
    const ambiguous = await fixture();
    await ambiguous.questions(["choices", "choices"]);
    await ambiguous.inbound("yes");
    expect(await ambiguous.queue()).toHaveLength(1);
    const unconfirmed = await fixture();
    await unconfirmed.questions(["choices"], false);
    await unconfirmed.inbound("yes");
    expect(await unconfirmed.queue()).toHaveLength(1);
  });
  it("preserves unopted legacy free-text handling", async () => {
    const f = await fixture(false);
    await f.questions(["free_text"]);
    await f.inbound("Yes, with Sam");
    expect(await f.queue()).toHaveLength(0);
    expect(await f.legacyReply()).toMatchObject({ state: "pending" });
  });
  it("records HELP without creating executable reply work", async () => {
    const f = await fixture();
    await f.questions(["free_text"]);
    await f.inbound("HELP");
    expect(await f.queue()).toHaveLength(0);
    expect(
      await database.db
        .select()
        .from(textInboundClaims)
        .where(eq(textInboundClaims.userId, f.userId)),
    ).toHaveLength(0);
    expect(
      (await database.db.select().from(textMessages).where(eq(textMessages.userId, f.userId))).some(
        (message) => message.body === "HELP",
      ),
    ).toBe(true);
  });
  it.each([
    "stop",
    "disconnect",
    "reverify",
  ])("cancels queued work after %s without releasing its routing ownership", async (action) => {
    const f = await fixture();
    await f.inbound("Create a task for tomorrow");
    if (action === "stop") await f.inbound("STOP");
    else if (action === "disconnect") await f.service.disconnect(f.userId);
    else {
      const challenge = await f.service.startVerification(f.userId, {
        country: "US",
        phoneNumber: f.phone,
        consentAccepted: true,
        consentVersion: textingConsentVersion,
      });
      await f.service.checkVerification(f.userId, challenge.id, "123456");
    }
    const queued = await f.queue();
    expect(queued).toHaveLength(1);
    expect(queued[0]?.cancelledAt).toBeInstanceOf(Date);
    expect(await f.legacyReply()).toMatchObject({ state: "unavailable" });
  });
});
