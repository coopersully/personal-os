import { createHmac } from "node:crypto";
import { resolve } from "node:path";
import type { TwilioConnector } from "@personal-os/connectors";
import {
  automationHostSchedules,
  createDatabaseClient,
  type DatabaseClient,
  migrateDatabase,
  textingAgentRuns,
  textingAgentSettings,
  textingConnections,
  textMessages,
  users,
} from "@personal-os/database";
import { textingConsentVersion } from "@personal-os/domain";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { and, eq } from "drizzle-orm";
import { encryptJson } from "./security.js";
import { textingHostBindingFingerprint } from "./texting-agent-authority.js";
import { createTextingAgentNotices } from "./texting-agent-notices.js";
import { createTextingService } from "./texting-service.js";

describe.sequential("durable SMS handoff notices", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  const encryptionKey = Buffer.alloc(32, 9).toString("base64");
  let sequence = 700;
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
    let current = new Date();
    const now = () => current;
    const userId = crypto.randomUUID(),
      connectionId = crypto.randomUUID(),
      scheduleId = crypto.randomUUID(),
      authorizationConnectionId = crypto.randomUUID();
    const phone = `+12125550${sequence++}`;
    await database.db.insert(users).values({
      id: userId,
      email: `${userId}@example.test`,
      displayName: "Notice fixture",
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
    await database.db.insert(automationHostSchedules).values({
      id: scheduleId,
      userId,
      authorizationConnectionId,
      encryptedFireCredentials: encryptJson({ token: "notice-fixture-token" }, encryptionKey),
      schedule: {
        id: scheduleId,
        tenantAuthorizationConnectionId: authorizationConnectionId,
        label: "Notice fixture",
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
    await database.db
      .insert(textingAgentSettings)
      .values({ userId, scheduleId, createdAt: now(), updatedAt: now() });
    const twilio: TwilioConnector = {
      startVerification: vi.fn(),
      checkVerification: vi.fn(),
      getMessageOccurredAt: vi.fn(),
      validateWebhook: () => true,
      sendMessage: vi.fn(async () => ({
        sid: `SM${crypto.randomUUID()}`,
        status: "queued",
        dateCreated: now(),
      })),
    };
    const texting = createTextingService({
      db: database.db,
      now,
      enabled: true,
      encryptionKey,
      apiBaseUrl: "https://api.example.test",
      senderPhoneNumber: "+18885550100",
      twilio,
    });
    const notices = createTextingAgentNotices({
      db: database.db,
      now,
      enabled: () => true,
      texting,
    });
    const addRun = async (
      state: "blocked" | "uncertain" | "running" | "completed" = "blocked",
      reason: string | null = "host_rejected",
      inputMessageIds: string[] = [],
    ) => {
      const schedule = await database.db.query.automationHostSchedules.findFirst({
        where: eq(automationHostSchedules.id, scheduleId),
      });
      const [run] = await database.db
        .insert(textingAgentRuns)
        .values({
          userId,
          connectionId,
          consentEpoch: 1,
          scheduleId,
          authorizationConnectionId,
          hostBindingFingerprint: textingHostBindingFingerprint(schedule),
          inputMessageIds,
          state,
          reason,
          createdAt: now(),
          updatedAt: now(),
        })
        .returning();
      if (!run) throw new Error("Missing run");
      return run;
    };
    const messages = () =>
      database.db.select().from(textMessages).where(eq(textMessages.userId, userId));
    return {
      userId,
      connectionId,
      scheduleId,
      twilio,
      notices,
      addRun,
      messages,
      advance: (ms: number) => {
        current = new Date(current.getTime() + ms);
      },
    };
  }

  it("commits one distinct system notice under concurrent scans and preserves run failure", async () => {
    const f = await fixture();
    const run = await f.addRun();
    await Promise.all([f.notices(), f.notices()]);
    await f.notices();
    expect(f.twilio.sendMessage).toHaveBeenCalledTimes(1);
    const messages = await f.messages();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ senderKind: "system", agentRunId: null, workspaces: [] });
    const [stored] = await database.db
      .select()
      .from(textingAgentRuns)
      .where(eq(textingAgentRuns.id, run.id));
    expect(stored).toMatchObject({
      state: "blocked",
      failureNoticeMessageId: messages[0]?.id,
      replyMessageId: null,
    });
  });
  it("retains uncertain transport without resending", async () => {
    const f = await fixture();
    await f.addRun("uncertain", "host_uncertain");
    vi.mocked(f.twilio.sendMessage).mockRejectedValueOnce(new Error("timeout"));
    await f.notices().catch(() => undefined);
    await f.notices();
    expect(f.twilio.sendMessage).toHaveBeenCalledTimes(1);
    expect((await f.messages())[0]?.body).toContain("couldn't confirm");
  });
  it("suppresses notice floods across runs for fifteen minutes", async () => {
    const f = await fixture();
    await f.addRun();
    await f.notices();
    await f.addRun();
    await f.notices();
    expect(f.twilio.sendMessage).toHaveBeenCalledTimes(1);
    f.advance(16 * 60_000);
    await f.notices();
    expect(f.twilio.sendMessage).toHaveBeenCalledTimes(2);
  });
  it("does not send to revoked consent or a changed routine", async () => {
    const f = await fixture();
    await f.addRun();
    await database.db
      .update(textingConnections)
      .set({ state: "opted_out" })
      .where(eq(textingConnections.id, f.connectionId));
    await f.notices();
    expect(f.twilio.sendMessage).not.toHaveBeenCalled();
    await database.db
      .update(textingConnections)
      .set({ state: "active", consentEpoch: 2 })
      .where(eq(textingConnections.id, f.connectionId));
    await f.notices();
    expect(f.twilio.sendMessage).not.toHaveBeenCalled();
    await database.db
      .update(textingConnections)
      .set({ consentEpoch: 1 })
      .where(eq(textingConnections.id, f.connectionId));
    await database.db.delete(textingAgentSettings).where(eq(textingAgentSettings.userId, f.userId));
    await f.notices();
    expect(f.twilio.sendMessage).not.toHaveBeenCalled();
  });
  it("notifies a stalled session after five minutes, but never a completed run", async () => {
    const f = await fixture();
    const run = await f.addRun("running", null);
    await f.notices();
    expect(f.twilio.sendMessage).not.toHaveBeenCalled();
    f.advance(300_000);
    await f.notices();
    expect(f.twilio.sendMessage).toHaveBeenCalledTimes(1);
    expect((await f.messages())[0]?.body).toContain("hasn't finished");
    await database.db
      .update(textingAgentRuns)
      .set({ state: "completed", failureNoticeMessageId: null })
      .where(and(eq(textingAgentRuns.id, run.id), eq(textingAgentRuns.userId, f.userId)));
    f.advance(16 * 60_000);
    await f.notices();
    expect(f.twilio.sendMessage).toHaveBeenCalledTimes(1);
  });
  it("retains rate-limited request linkage after queue membership is released", async () => {
    const f = await fixture();
    const [input] = await database.db
      .insert(textMessages)
      .values({
        userId: f.userId,
        connectionId: f.connectionId,
        direction: "inbound",
        status: "accepted",
        body: "Review tasks",
        occurredAt: new Date(),
        occurredAtSource: "provider",
        workspaces: ["tasks"],
        senderKind: "human",
      })
      .returning();
    if (!input) throw new Error("Missing input");
    await f.addRun("blocked", "rate_limited", [input.id]);
    await f.notices();
    const notice = (await f.messages()).find((message) => message.direction === "outbound");
    expect(notice).toMatchObject({
      workspaces: ["tasks"],
      replyToMessageIds: [input.id],
      senderKind: "system",
    });
  });
});
