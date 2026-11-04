import { resolve } from "node:path";
import {
  createDatabaseClient,
  type DatabaseClient,
  migrateDatabase,
  notificationAttemptItems,
  notificationDeliveryAttempts,
  notificationIntents,
  notificationPreferences,
  textingConnections,
  textMessages,
  users,
} from "@personal-os/database";
import {
  defaultNotificationPreferences,
  type FinanceHumanWorkRef,
  notificationAttemptDetailSchema,
} from "@personal-os/domain";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { errorResponse } from "./errors.js";
import { createNotificationService } from "./notification-service.js";
import { registerNotificationRoutes } from "./routes/notifications.js";
import { encryptJson } from "./security.js";
import type { AppEnv, Principal } from "./types.js";

const owner = "11111111-1111-4111-8111-111111111111";
const foreign = "22222222-2222-4222-8222-222222222222";
const current = new Date("2026-11-03T12:00:00.000Z");
const uuid = (n: number) => `40000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const principal: Principal = {
  userId: owner,
  actorId: owner,
  actorType: "user",
  scopes: new Set(["texting:read", "finances:read"]),
};
const work = (n: number): FinanceHumanWorkRef => ({
  id: uuid(n + 1000),
  domain: "finances",
  kind: n % 3 === 0 ? "repair" : n % 2 === 0 ? "approval" : "question",
  revision: `frozen-${n}`,
  actionRevision: `action-${n}`,
});

describe.sequential("strict native notification attempt reader", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  let readOnly: DatabaseClient;
  let service: ReturnType<typeof createNotificationService>;
  const sendNotification =
    vi.fn<Parameters<typeof createNotificationService>[0]["transport"]["sendNotification"]>();
  const resolveWork =
    vi.fn<NonNullable<Parameters<typeof createNotificationService>[0]["resolveWork"]>>();
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
    // All successful and denied inspections run under PostgreSQL read-only protection.
    // An accidental status/reconcile or INSERT/UPDATE/DELETE therefore fails instead of silently passing.
    readOnly = createDatabaseClient({
      connectionString: container.getConnectionUri(),
      options: "-c default_transaction_read_only=on",
    });
    service = createNotificationService({
      db: readOnly.db,
      origin: "https://nohmi.test",
      transport: { sendNotification },
      resolveWork,
      now: () => current,
    });
  }, 120_000);
  afterAll(async () => {
    await readOnly?.close();
    await database?.close();
    await container?.stop();
  });
  beforeEach(async () => {
    await database.db.delete(users);
    sendNotification.mockClear();
    resolveWork.mockClear();
    for (const id of [owner, foreign]) {
      await database.db.insert(users).values({
        id,
        email: `${id}@example.test`,
        displayName: "Reader fixture",
        passwordHash: "unused",
        planningTimezone: "UTC",
        updatedAt: current,
      });
      await database.db.insert(textingConnections).values({
        id: id === owner ? uuid(1) : uuid(2),
        userId: id,
        encryptedPhoneNumber: encryptJson(
          { e164: id === owner ? "+12125550123" : "+12125550124" },
          Buffer.alloc(32, 7).toString("base64"),
        ),
        phoneFingerprint: id,
        phoneLastFour: "0123",
        country: "US",
        state: "active",
        consentVersion: "test",
        consentEpoch: 1,
        verifiedAt: current,
        updatedAt: current,
      });
    }
    await database.db.insert(textMessages).values({
      id: uuid(3),
      userId: owner,
      connectionId: uuid(1),
      direction: "outbound",
      status: "unknown",
      body: "PRIVATE message not diagnostic output",
      providerMessageSid: `SM${"a".repeat(32)}`,
      providerSubmittedAt: current,
      occurredAt: current,
      occurredAtSource: "provider",
      updatedAt: current,
    });
    await database.db.insert(notificationDeliveryAttempts).values({
      id: uuid(4),
      userId: owner,
      state: "uncertain",
      reason: "delivery_uncertain",
      claimId: uuid(5),
      leaseUntil: current,
      connectionId: uuid(1),
      consentEpoch: 1,
      messageId: uuid(3),
      timeZone: "America/New_York",
      timezoneRevision: current,
      submittedAt: current,
      createdAt: current,
      updatedAt: current,
    });
    await addMembership(2);
  });
  async function addMembership(count: number, start = 1) {
    for (let n = start; n < start + count; n++) {
      await database.db.insert(notificationIntents).values({
        id: uuid(n + 100),
        userId: owner,
        domain: "finances",
        workId: work(n).id,
        work: work(n),
        state: "pending",
      });
      await database.db
        .insert(notificationAttemptItems)
        .values({ userId: owner, attemptId: uuid(4), intentId: uuid(n + 100), work: work(n) });
    }
  }
  async function inspect(as: Principal = principal) {
    const value = await service.getAttempt(as, uuid(4));
    expect(sendNotification).not.toHaveBeenCalled();
    expect(resolveWork).not.toHaveBeenCalled();
    return value;
  }
  it("returns native membership in deterministic order and never reconciles uncertain handoff or exposes private text/SID/phone", async () => {
    // Existing status() would reconcile this native submitting/unknown mismatch with an UPDATE.
    // The strict reader must preserve it, and a regression to that writer fails the read-only session.
    await database.db
      .update(notificationDeliveryAttempts)
      .set({ state: "submitting" })
      .where(eq(notificationDeliveryAttempts.id, uuid(4)));
    const before = await database.db.select().from(notificationDeliveryAttempts);
    const result = await inspect();
    expect(result.state).toBe("submitting");
    expect(notificationAttemptDetailSchema.parse(result)).toEqual(result);
    expect(result.membership.map((item) => item.intentId)).toEqual([uuid(101), uuid(102)]);
    expect(result.membership.map((item) => item.work)).toEqual([work(1), work(2)]);
    expect(result.coverage).toMatchObject({
      state: "partial",
      membership: "complete",
      returnedItems: 2,
      hasMore: false,
    });
    expect(result.transport.message).toMatchObject({
      id: uuid(3),
      status: "unknown",
      providerSubmittedAt: current.toISOString(),
    });
    expect(result.transport.callbackProvenance).toEqual({
      basis: "unavailable",
      reason: "not_persisted",
    });
    expect(result.initiatingActor).toEqual({ basis: "unavailable" });
    expect(result.recovery).toBe("inspect_delivery_do_not_resend");
    expect(JSON.stringify(result)).not.toMatch(
      /PRIVATE|SMaaaaaaaa|encryptedPhone|phoneLastFour|phoneFingerprint|providerMessageSid|claimId/,
    );
    expect(await database.db.select().from(notificationDeliveryAttempts)).toEqual(before);
  });
  it("returns the actual strict native result through the existing authenticated route composition with no-store", async () => {
    const app = new Hono<AppEnv>();
    app.onError(errorResponse);
    app.use("*", async (context, next) => {
      context.set("principal", principal);
      context.set("requestId", "native-read");
      await next();
    });
    registerNotificationRoutes({ app, notifications: service });
    const response = await app.request(`/v1/texting/notifications/attempts/${uuid(4)}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const result = notificationAttemptDetailSchema.parse(await response.json());
    expect(result.id).toBe(uuid(4));
    expect(result.membership.map((item) => item.work)).toEqual([work(1), work(2)]);
    expect(sendNotification).not.toHaveBeenCalled();
    expect(resolveWork).not.toHaveBeenCalled();
  });
  it("supports an actually read-scoped agent without inventing execution authority", async () => {
    const result = await inspect({ ...principal, actorType: "agent", actorId: uuid(90) });
    expect(result.id).toBe(uuid(4));
  });
  it.each([
    { scopes: ["texting:read"] },
    { scopes: ["finances:read"] },
    { scopes: [] },
  ] as const)("denies missing material read scopes %j without writer/provider calls", async ({
    scopes,
  }) => {
    await expect(
      service.getAttempt(
        { ...principal, scopes: new Set<"texting:read" | "finances:read">(scopes) },
        uuid(4),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(sendNotification).not.toHaveBeenCalled();
    expect(resolveWork).not.toHaveBeenCalled();
  });
  it("makes foreign and missing attempts indistinguishable and rejects unvalidated IDs", async () => {
    await expect(
      service.getAttempt({ ...principal, userId: foreign }, uuid(4)),
    ).rejects.toMatchObject({ code: "not_found", message: "Notification attempt not found." });
    await expect(service.getAttempt(principal, uuid(99))).rejects.toMatchObject({
      code: "not_found",
      message: "Notification attempt not found.",
    });
    await expect(service.getAttempt(principal, "not-an-id")).rejects.toThrow();
  });
  it("keeps frozen exact revisions separate from current intent state and reason", async () => {
    await database.db
      .update(notificationIntents)
      .set({
        work: {
          ...work(1),
          revision: "current-new-revision",
          actionRevision: "current-new-action",
        },
        state: "resolved",
        reason: "resolved",
      })
      .where(eq(notificationIntents.id, uuid(101)));
    const result = await inspect();
    expect(result.membership[0]?.work).toEqual(work(1));
    expect(result.membership[0]?.currentIntent).toMatchObject({
      basis: "current",
      state: "resolved",
      work: { revision: "current-new-revision", actionRevision: "current-new-action" },
    });
    expect(result.membership[1]?.work).toEqual(work(2));
  });
  it("labels current preferences/timezone/consent separately from absent historical policy and old recorded epochs", async () => {
    await database.db.insert(notificationPreferences).values({
      userId: owner,
      scope: "global",
      revision: 3,
      preferences: { ...defaultNotificationPreferences, enabled: false, detail: "minimal" },
    });
    await database.db.insert(notificationPreferences).values({
      userId: owner,
      scope: "finances",
      revision: 5,
      preferences: { ...defaultNotificationPreferences, enabled: true, detail: "context" },
    });
    await database.db
      .update(textingConnections)
      .set({ consentEpoch: 2, state: "opted_out" })
      .where(eq(textingConnections.id, uuid(1)));
    const result = await inspect();
    expect(result.policy.historicalPreferences).toEqual({
      basis: "unavailable",
      reason: "not_persisted",
    });
    expect(result.policy.recordedAttempt).toMatchObject({
      consentEpoch: 1,
      timeZone: "America/New_York",
    });
    expect(result.policy.current).toMatchObject({
      basis: "current",
      timeZone: "UTC",
      effective: { enabled: false, detail: "minimal" },
      connection: { consentEpoch: 2, state: "opted_out", matchesRecordedEpoch: false },
    });
    expect(result.policy.current.preferences.map((p) => p.revision).sort()).toEqual([3, 5]);
  });
  it("reports max100 overflow honestly with deterministic membership, without inventing an empty/send-complete result", async () => {
    await addMembership(99, 3);
    const first = await inspect();
    const second = await inspect();
    expect(first.membership).toHaveLength(100);
    expect(second.membership).toEqual(first.membership);
    expect(first.coverage).toMatchObject({
      state: "partial",
      membership: "partial",
      hasMore: true,
      returnedItems: 100,
      limit: 100,
    });
    expect(first.coverage.reasons).toContain("membership_limit");
  });
  it("shows cascaded missing membership as unavailable without inferring no-send or changing the attempt", async () => {
    await database.db.delete(notificationIntents);
    const result = await inspect();
    expect(result.membership).toEqual([]);
    expect(result.coverage).toMatchObject({
      membership: "unavailable",
      returnedItems: 0,
      hasMore: false,
    });
    expect(result.coverage.reasons).toContain("membership_unavailable");
    expect(result.state).toBe("uncertain");
    expect(result.recovery).toBe("inspect_delivery_do_not_resend");
  });
  it("does not turn an inbound native message into outbound delivery evidence", async () => {
    await database.db.insert(textMessages).values({
      id: uuid(6),
      userId: owner,
      connectionId: uuid(1),
      direction: "inbound",
      status: "sent",
      body: "PRIVATE inbound",
      occurredAt: current,
      occurredAtSource: "provider",
    });
    await database.db
      .update(notificationDeliveryAttempts)
      .set({ messageId: uuid(6) })
      .where(eq(notificationDeliveryAttempts.id, uuid(4)));
    const result = await inspect();
    expect(result.transport.message).toBeNull();
    expect(result.coverage.reasons).toContain("message_unavailable");
    expect(result.recovery).toBe("inspect_delivery_do_not_resend");
  });
  it("redacts unknown stored reason strings and preserves accepted/delivered facts without financial-completion claims", async () => {
    await database.db
      .update(notificationDeliveryAttempts)
      .set({ reason: "PRIVATE provider diagnostic", state: "accepted" })
      .where(eq(notificationDeliveryAttempts.id, uuid(4)));
    await database.db
      .update(textMessages)
      .set({ status: "delivered", deliveredAt: current })
      .where(eq(textMessages.id, uuid(3)));
    const result = await inspect();
    expect(result.reason).toBe("unknown_reason");
    expect(result.transport.message?.status).toBe("delivered");
    expect(result.transport.message?.deliveredAt).toBe(current.toISOString());
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
    expect(result.recovery).toBe("inspect_delivery_do_not_resend");
  });
  it.each([
    { connectionInvalid: true, messageInvalid: false },
    { connectionInvalid: false, messageInvalid: true },
    { connectionInvalid: true, messageInvalid: true },
  ])("projects unknown stored enums without losing evidence or granting resend: %j", async ({
    connectionInvalid,
    messageInvalid,
  }) => {
    await database.db
      .update(notificationDeliveryAttempts)
      .set({ state: "failed" })
      .where(eq(notificationDeliveryAttempts.id, uuid(4)));
    await database.db
      .update(textMessages)
      .set({ status: "failed" })
      .where(eq(textMessages.id, uuid(3)));
    // Neither attempt nor known message selects inspect-delivery; unknown projection must cause it.
    expect((await inspect()).recovery).toBe("review_in_app");
    if (connectionInvalid)
      await database.db.execute(
        sql`UPDATE texting_connections SET state = ${"reader-state-canary"} WHERE id = ${uuid(1)}`,
      );
    if (messageInvalid)
      await database.db.execute(
        sql`UPDATE text_messages SET status = ${"reader-status-canary"} WHERE id = ${uuid(3)}`,
      );
    const before = {
      connections: await database.db.select().from(textingConnections),
      messages: await database.db.select().from(textMessages),
      attempts: await database.db.select().from(notificationDeliveryAttempts),
    };
    const result = await inspect();
    expect(result.membership.map((item) => item.intentId)).toEqual([uuid(101), uuid(102)]);
    expect(result.policy.current.connection).toMatchObject({
      id: uuid(1),
      state: connectionInvalid ? "unknown" : "active",
      consentEpoch: 1,
      updatedAt: current.toISOString(),
      matchesRecordedEpoch: true,
    });
    expect(result.transport.message).toMatchObject({
      id: uuid(3),
      status: messageInvalid ? "unknown" : "failed",
      providerSubmittedAt: current.toISOString(),
      updatedAt: current.toISOString(),
    });
    expect(result.coverage.reasons.includes("connection_state_unrecognized")).toBe(
      connectionInvalid,
    );
    expect(result.coverage.reasons.includes("message_status_unrecognized")).toBe(messageInvalid);
    expect(result.recovery).toBe("inspect_delivery_do_not_resend");
    expect(JSON.stringify(result)).not.toMatch(
      /reader-state-canary|reader-status-canary|PRIVATE|SMaaaaaaaa/,
    );
    expect({
      connections: await database.db.select().from(textingConnections),
      messages: await database.db.select().from(textMessages),
      attempts: await database.db.select().from(notificationDeliveryAttempts),
    }).toEqual(before);
  });
  it.each([
    { connectionState: "active", messageStatus: "accepted" },
    { connectionState: "opted_out", messageStatus: "delivered" },
    { connectionState: "active", messageStatus: "unknown" },
  ] as const)("preserves known stored enum facts without invalid-value coverage: %j", async ({
    connectionState,
    messageStatus,
  }) => {
    await database.db
      .update(textingConnections)
      .set({ state: connectionState })
      .where(eq(textingConnections.id, uuid(1)));
    await database.db
      .update(textMessages)
      .set({ status: messageStatus, deliveredAt: messageStatus === "delivered" ? current : null })
      .where(eq(textMessages.id, uuid(3)));
    const result = await inspect();
    expect(result.policy.current.connection).toMatchObject({
      id: uuid(1),
      state: connectionState,
      consentEpoch: 1,
      updatedAt: current.toISOString(),
    });
    expect(result.transport.message).toMatchObject({
      id: uuid(3),
      status: messageStatus,
      providerSubmittedAt: current.toISOString(),
      deliveredAt: messageStatus === "delivered" ? current.toISOString() : null,
    });
    expect(result.coverage.reasons).not.toContain("connection_state_unrecognized");
    expect(result.coverage.reasons).not.toContain("message_status_unrecognized");
  });
});
