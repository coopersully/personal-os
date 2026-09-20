import { resolve } from "node:path";
import type { TwilioConnector } from "@personal-os/connectors";
import {
  createDatabaseClient,
  type DatabaseClient,
  migrateDatabase,
  notificationAttemptItems,
  notificationDeliveryAttempts,
  notificationIntents,
  textingConnections,
  textingConsentEvents,
  textMessages,
  users,
} from "@personal-os/database";
import {
  defaultNotificationPreferences,
  type FinanceHumanWorkRef,
  type NotificationWork,
} from "@personal-os/domain";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq, sql } from "drizzle-orm";
import { createNotificationService } from "./notification-service.js";
import type { NotificationWorkResolver } from "./notification-work-resolver.js";
import { encryptJson } from "./security.js";
import { createTextingService } from "./texting-service.js";
import type { Principal } from "./types.js";

const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const ref: FinanceHumanWorkRef = {
  id: "33333333-3333-4333-8333-333333333333",
  domain: "finances",
  kind: "question",
  revision: "r1",
  actionRevision: "a1",
};
const principal: Principal = {
  userId: owner,
  actorId: owner,
  actorType: "user",
  scopes: new Set(["texting:read", "texting:write", "finances:read"]),
};
const encryptionKey = Buffer.alloc(32, 7).toString("base64");

describe.sequential("durable notifications", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  let current = new Date("2026-03-08T12:00:00Z");
  let send: ReturnType<typeof vi.fn>;
  let service: ReturnType<typeof createNotificationService>;
  let texting: ReturnType<typeof createTextingService>;
  let resolver: NotificationWorkResolver;
  const now = () => current;
  const makeService = (resolveWork: NotificationWorkResolver | undefined = resolver) =>
    createNotificationService({
      db: database.db,
      origin: "https://nohmi.test",
      transport: texting,
      now,
      resolveWork,
    });
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
    // An injected domain fixture with real PostgreSQL locking proves the adapter's transactional
    // handoff. This is not a claim that the future Finance producer's mutation paths are wired.
    await database.db.execute(
      sql`CREATE TABLE notification_test_work (id uuid PRIMARY KEY, user_id uuid NOT NULL, value jsonb NOT NULL)`,
    );
    resolver = async (userId, work, tx) => {
      const result = await tx.execute(
        sql`SELECT value FROM notification_test_work WHERE id=${work.id} AND user_id=${userId} FOR UPDATE`,
      );
      const value = result.rows[0]?.value as NotificationWork | undefined;
      return value ? { state: "current", value } : { state: "unavailable" };
    };
  }, 120_000);
  afterAll(async () => {
    await database.close();
    await container.stop();
  });
  beforeEach(async () => {
    await database.db.execute(sql`TRUNCATE notification_test_work, users CASCADE`);
    current = new Date("2026-03-08T12:00:00Z");
    for (const userId of [owner, other]) {
      await database.db.insert(users).values({
        id: userId,
        email: `${userId}@example.test`,
        displayName: "Test",
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
        verifiedAt: current,
      });
    }
    await putWork(ref);
    send = vi.fn(async () => ({ sid: `SM${crypto.randomUUID()}`, status: "queued" }));
    texting = createTextingService({
      db: database.db,
      apiBaseUrl: "https://nohmi.test",
      enabled: true,
      encryptionKey,
      senderPhoneNumber: "+12125550124",
      now,
      twilio: { sendMessage: send } as unknown as TwilioConnector,
    });
    service = makeService();
  });
  async function putWork(work: FinanceHumanWorkRef, extra: Partial<NotificationWork> = {}) {
    const value: NotificationWork = {
      work,
      active: true,
      expiresAt: null,
      disclosure: "context",
      context: "Dinner",
      occurredAt: "2026-03-07T23:00:00Z",
      destination: "/settings?section=reviews",
      ...extra,
    };
    await database.db.execute(sql`INSERT INTO notification_test_work VALUES (${work.id}, ${owner}, ${JSON.stringify(value)}::jsonb)
      ON CONFLICT (id) DO UPDATE SET value=EXCLUDED.value`);
  }
  async function claimed() {
    const result = await service.claim(principal);
    if (result.state !== "claimed") throw new Error(`Expected claim, got ${result.state}`);
    return result;
  }
  it("keeps absent producers unavailable and rejects missing caller authority", async () => {
    const unavailable = createNotificationService({
      db: database.db,
      origin: "https://nohmi.test",
      transport: texting,
      now,
    });
    expect(await unavailable.publish(principal, { work: [ref] })).toEqual({
      state: "unavailable",
      reason: "producer_not_registered",
    });
    expect(await unavailable.drain(principal)).toEqual({
      state: "unavailable",
      reason: "producer_not_registered",
    });
    expect((await unavailable.status(principal)).capability).toBe("unavailable");
    await expect(
      service.publish({ ...principal, scopes: new Set(["texting:read"]) }, { work: [ref] }),
    ).rejects.toThrow("requires");
    expect(send).not.toHaveBeenCalled();
  });
  it("persists human preferences with revision fencing, audit and inherited disclosure ceiling", async () => {
    await service.savePreferences(principal, "global", {
      expectedRevision: null,
      preferences: { ...defaultNotificationPreferences, detail: "minimal" },
    });
    await service.savePreferences(principal, "finances", {
      expectedRevision: null,
      preferences: defaultNotificationPreferences,
    });
    expect((await service.status(principal)).effective.detail).toBe("minimal");
    await expect(
      service.savePreferences(principal, "global", {
        expectedRevision: null,
        preferences: defaultNotificationPreferences,
      }),
    ).rejects.toThrow("changed");
    await expect(
      service.savePreferences({ ...principal, actorType: "agent" }, "global", {
        expectedRevision: 1,
        preferences: defaultNotificationPreferences,
      }),
    ).rejects.toThrow("Only the person");
    await service.savePreferences(principal, "global", {
      expectedRevision: 1,
      preferences: defaultNotificationPreferences,
    });
    const audits = await database.db.query.auditEvents.findMany();
    expect(audits).toHaveLength(3);
    expect((await service.status({ ...principal, userId: other })).preferences).toEqual([]);
  });
  it("deduplicates wording and evidence refreshes while keeping semantic attempt history", async () => {
    await service.publish(principal, { work: [ref] });
    await service.drain(principal);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0].body).toContain("Dinner (yesterday)");
    expect(send.mock.calls[0]?.[0].body).toContain("Reply STOP");
    const refreshed = { ...ref, revision: "r2" };
    await putWork(refreshed, { context: "Changed wording" });
    await service.publish(principal, { work: [refreshed] });
    await service.drain(principal);
    expect(send).toHaveBeenCalledTimes(1);
    const material = { ...refreshed, actionRevision: "a2" };
    await putWork(material);
    await service.publish(principal, { work: [material] });
    await service.drain(principal);
    expect(send).toHaveBeenCalledTimes(2);
    const items = await database.db.select().from(notificationAttemptItems);
    expect(items.map((item) => item.work.actionRevision).sort()).toEqual(["a1", "a2"]);
    expect(await database.db.select().from(notificationIntents)).toHaveLength(1);
  });
  it("revalidates resolved, expired or superseded work after quiet hours and before submission", async () => {
    current = new Date("2026-03-08T11:59:00Z");
    await service.publish(principal, { work: [ref] });
    await service.drain(principal);
    expect((await service.status(principal)).intents[0]?.reason).toBe("quiet_hours");
    current = new Date("2026-03-08T12:00:00Z");
    const claim = await claimed();
    await putWork(ref, { active: false });
    await service.deliver(principal, claim);
    expect(send).not.toHaveBeenCalled();
    expect((await service.status(principal)).attempts[0]?.state).toBe("suppressed");
    await putWork(ref, { expiresAt: current.toISOString() });
    await service.drain(principal);
    expect((await service.status(principal)).intents[0]?.reason).toBe("expired");
    await putWork({ ...ref, revision: "new" });
    await service.publish(principal, { work: [{ ...ref, revision: "new" }] });
    const freshClaim = await claimed();
    await putWork({ ...ref, revision: "newer" });
    await service.deliver(principal, freshClaim);
    expect(send).not.toHaveBeenCalled();
  });
  it("reclaims expired leases with fencing and never repeats an uncertain provider attempt", async () => {
    await service.publish(principal, { work: [ref] });
    const oldClaim = await claimed();
    expect((await service.claim(principal)).state).toBe("pending");
    current = new Date(current.getTime() + 60_001);
    const newClaim = await claimed();
    expect(newClaim.id).toBe(oldClaim.id);
    expect(newClaim.claimId).not.toBe(oldClaim.claimId);
    await expect(service.deliver(principal, oldClaim)).rejects.toThrow("stale");
    send.mockRejectedValueOnce(new Error("provider secret canary"));
    await service.deliver(principal, newClaim);
    current = new Date(current.getTime() + 60_001);
    expect((await service.status(principal)).attempts[0]?.state).toBe("uncertain");
    await service.drain(principal);
    expect(send).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(await service.status(principal))).not.toContain("canary");
  });
  it("preserves queued process-loss evidence and reconciles provider delivery without resend", async () => {
    await service.publish(principal, { work: [ref] });
    await service.drain(principal);
    const [attempt] = await database.db.select().from(notificationDeliveryAttempts);
    if (!attempt?.messageId) throw new Error("Expected durable message link");
    await database.db
      .update(textMessages)
      .set({ status: "unknown", providerMessageSid: null })
      .where(eq(textMessages.id, attempt.messageId));
    await database.db
      .update(notificationDeliveryAttempts)
      .set({ state: "submitting" })
      .where(eq(notificationDeliveryAttempts.id, attempt.id));
    current = new Date(current.getTime() + 60_001);
    expect((await service.status(principal)).attempts[0]?.state).toBe("uncertain");
    await service.drain(principal);
    expect(send).toHaveBeenCalledTimes(1);
    await database.db
      .update(textMessages)
      .set({ status: "delivered", providerMessageSid: "SMreconciled" })
      .where(eq(textMessages.id, attempt.messageId));
    expect((await service.status(principal)).attempts[0]?.state).toBe("accepted");
  });
  it("rechecks consent epoch, STOP state, disablement, and canonical timezone at send", async () => {
    await service.publish(principal, { work: [ref] });
    const claim = await claimed();
    await database.db
      .update(textingConnections)
      .set({ consentEpoch: 2 })
      .where(eq(textingConnections.userId, owner));
    await service.deliver(principal, claim);
    expect(send).not.toHaveBeenCalled();
    expect((await service.status(principal)).attempts[0]?.reason).toBe("consent_changed");
    const next = await claimed();
    await database.db
      .update(textingConnections)
      .set({ state: "opted_out" })
      .where(eq(textingConnections.userId, owner));
    await service.deliver(principal, next);
    expect(send).not.toHaveBeenCalled();
    current = new Date(current.getTime() + 60_001);
    await database.db
      .update(textingConnections)
      .set({ state: "active" })
      .where(eq(textingConnections.userId, owner));
    const retry = await claimed();
    await database.db.update(users).set({ planningTimezone: "invalid" }).where(eq(users.id, owner));
    await service.deliver(principal, retry);
    expect(send).not.toHaveBeenCalled();
    expect((await service.status(principal)).attempts[0]?.reason).toBe("timezone_unavailable");
  });
  it("isolates intent lookup, attempts, and composite references across tenants", async () => {
    await expect(service.publish({ ...principal, userId: other }, { work: [ref] })).rejects.toThrow(
      "unavailable",
    );
    await service.publish(principal, { work: [ref] });
    const claim = await claimed();
    await expect(service.deliver({ ...principal, userId: other }, claim)).rejects.toThrow("stale");
    expect((await service.status({ ...principal, userId: other })).intents).toEqual([]);
    const [intent] = await database.db.select().from(notificationIntents);
    if (!intent) throw new Error("Expected intent");
    await expect(
      database.db
        .insert(notificationAttemptItems)
        .values({ userId: other, attemptId: claim.id, intentId: intent.id, work: ref }),
    ).rejects.toThrow();
  });
  it("serializes concurrent claims and keeps domain locks only until queued commit", async () => {
    await service.publish(principal, { work: [ref] });
    const claims = await Promise.all([service.claim(principal), service.claim(principal)]);
    expect(claims.filter((c) => c.state === "claimed")).toHaveLength(1);
    const claim = claims.find((c) => c.state === "claimed");
    if (claim?.state !== "claimed") throw new Error("Expected claim");
    send.mockImplementationOnce(async () => {
      // A separate transaction can acquire and resolve domain work during provider I/O.
      await putWork(ref, { active: false });
      return { sid: "SMnetwork", status: "queued" };
    });
    await service.deliver(principal, claim);
    expect(send).toHaveBeenCalledTimes(1);
    expect((await service.status(principal)).attempts[0]?.state).toBe("accepted");
    await service.drain(principal);
    expect((await service.status(principal)).intents[0]?.state).toBe("resolved");
  });
  it("holds authoritative fixture locks through handoff and detects later provider failure", async () => {
    await service.publish(principal, { work: [ref] });
    const claim = await claimed();
    let release: () => void = () => {};
    let entered: () => void = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const locked = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const waitingResolver: NotificationWorkResolver = async (userId, work, tx) => {
      const result = await resolver(userId, work, tx);
      entered();
      await blocked;
      return result;
    };
    const delivering = makeService(waitingResolver).deliver(principal, claim);
    await locked;
    try {
      await expect(
        database.db.transaction(async (tx) => {
          await tx.execute(
            sql`SELECT id FROM notification_test_work WHERE id=${ref.id} FOR UPDATE NOWAIT`,
          );
        }),
      ).rejects.toThrow();
      expect(send).not.toHaveBeenCalled();
    } finally {
      release();
    }
    await delivering;
    const [attempt] = await database.db.select().from(notificationDeliveryAttempts);
    if (!attempt?.messageId) throw new Error("Expected message");
    await database.db
      .update(textMessages)
      .set({ status: "undelivered" })
      .where(eq(textMessages.id, attempt.messageId));
    expect((await service.status(principal)).attempts[0]?.state).toBe("failed");
  });
  it("rejects unsafe configured origins and accepts local HTTP", async () => {
    for (const origin of [
      "javascript:alert(1)",
      "https://user:password@example.test",
      "https://example.test/path",
      "https://example.test?secret=x",
      "https://example.test#fragment",
      "not a url",
    ]) {
      expect(() =>
        createNotificationService({ db: database.db, origin, transport: texting }),
      ).toThrow();
    }
    expect(
      createNotificationService({
        db: database.db,
        origin: "http://localhost:3000/",
        transport: texting,
      }),
    ).toBeDefined();
    const unavailable = createNotificationService({
      db: database.db,
      origin: "https://NOHMI.test/",
      transport: texting,
    });
    await unavailable.publish(principal, { work: [ref] });
    await unavailable.drain(principal);
    expect(await database.db.select().from(notificationIntents)).toEqual([]);
    expect(await database.db.select().from(notificationDeliveryAttempts)).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });
  it("rolls back mixed invalid references and serializes preference/zone changes without blocking FK consent inserts", async () => {
    await expect(service.publish(principal, { work: [ref, ref] })).rejects.toThrow("once");
    await expect(
      service.publish(principal, {
        work: [ref, { ...ref, id: "ffffffff-ffff-4fff-8fff-ffffffffffff" }],
      }),
    ).rejects.toThrow("unavailable");
    expect(await database.db.select().from(notificationIntents)).toEqual([]);
    let release: () => void = () => {};
    let entered: () => void = () => {};
    const wait = new Promise<void>((r) => {
      release = r;
    });
    const started = new Promise<void>((r) => {
      entered = r;
    });
    const writing = makeService(async (userId, work, tx) => {
      const result = await resolver(userId, work, tx);
      entered();
      await wait;
      return result;
    }).publish(principal, { work: [ref] });
    await started;
    try {
      await database.db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL lock_timeout='300ms'`);
        const [connection] = await tx
          .select()
          .from(textingConnections)
          .where(eq(textingConnections.userId, owner))
          .for("update");
        if (!connection) throw new Error("Expected connection");
        await tx.insert(textingConsentEvents).values({
          userId: owner,
          connectionId: connection.id,
          phoneFingerprint: owner,
          kind: "verified_opt_in",
          source: "nohmi",
          occurredAt: current,
        });
      });
      await expect(
        database.db.transaction(async (tx) => {
          await tx.execute(sql`SET LOCAL lock_timeout='100ms'`);
          await tx.update(users).set({ planningTimezone: "UTC" }).where(eq(users.id, owner));
        }),
      ).rejects.toThrow();
      await expect(
        database.db.transaction(async (tx) => {
          await tx.execute(sql`SELECT id FROM users WHERE id=${owner} FOR UPDATE NOWAIT`);
        }),
      ).rejects.toThrow();
    } finally {
      release();
    }
    await writing;
    await database.db.update(users).set({ planningTimezone: "UTC" }).where(eq(users.id, owner));
    await service.drain(principal);
    expect((await database.db.select().from(notificationDeliveryAttempts))[0]?.timeZone).toBe(
      "UTC",
    );
    await database.db.delete(users).where(eq(users.id, owner));
    expect(await database.db.select().from(notificationDeliveryAttempts)).toEqual([]);
    expect(await database.db.select().from(notificationIntents)).toEqual([]);
  });
  it("rechecks changed preferences, final expiry, and date rollover before queuing", async () => {
    await service.publish(principal, { work: [ref] });
    const first = await claimed();
    await service.savePreferences(principal, "global", {
      expectedRevision: null,
      preferences: { ...defaultNotificationPreferences, enabled: false },
    });
    await service.deliver(principal, first);
    expect(send).not.toHaveBeenCalled();
    await service.savePreferences(principal, "global", {
      expectedRevision: 1,
      preferences: defaultNotificationPreferences,
    });
    const next = await claimed();
    await putWork(ref, { expiresAt: new Date(current.getTime() + 1000).toISOString() });
    const advancing: NotificationWorkResolver = async (userId, work, tx) => {
      const result = await resolver(userId, work, tx);
      current = new Date(current.getTime() + 1001);
      return result;
    };
    await makeService(advancing).deliver(principal, next);
    expect(send).not.toHaveBeenCalled();
    await putWork(ref);
    current = new Date("2026-03-09T12:00:00Z");
    await service.drain(principal);
    expect(send.mock.calls[0]?.[0].body).not.toContain("yesterday");
  });
  it("preserves failed and opted-out outcomes and respects disabled transport", async () => {
    await service.publish(principal, { work: [ref] });
    send.mockRejectedValueOnce({ status: 400, code: 21610, message: "secret canary" });
    await service.drain(principal);
    expect((await service.status(principal)).attempts[0]?.state).toBe("failed");
    expect(
      (
        await database.db
          .select()
          .from(textingConnections)
          .where(eq(textingConnections.userId, owner))
      )[0]?.state,
    ).toBe("opted_out");
    expect((await service.claim(principal)).state).toBe("pending");
    expect(JSON.stringify(await service.status(principal))).not.toContain("canary");
    await database.db
      .update(textingConnections)
      .set({ state: "active" })
      .where(eq(textingConnections.userId, owner));
    current = new Date(current.getTime() + 8 * 86400000);
    const disabled = createTextingService({
      db: database.db,
      apiBaseUrl: "https://nohmi.test",
      enabled: false,
      encryptionKey,
      senderPhoneNumber: "",
      now,
    });
    const off = createNotificationService({
      db: database.db,
      origin: "https://nohmi.test",
      transport: disabled,
      resolveWork: resolver,
      now,
    });
    await off.drain(principal);
    expect(send).toHaveBeenCalledTimes(1);
    expect(
      (await off.status(principal)).attempts.some((a) => a.reason === "delivery_blocked"),
    ).toBe(true);
  });
  it("aggregates bounded work and falls back to minimal Unicode disclosure", async () => {
    const refs = Array.from({ length: 4 }, () => ({ ...ref, id: crypto.randomUUID() }));
    for (const work of refs) await putWork(work, { context: "Dinner 🍜" });
    await service.publish(principal, { work: refs });
    await service.drain(principal);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0].body).toContain("4 Finance items need review");
    expect(send.mock.calls[0]?.[0].body).not.toContain("🍜");
    expect(await database.db.select().from(notificationAttemptItems)).toHaveLength(4);
  });
  it("rolls back the queued message when durable linkage fails and enforces transport limits", async () => {
    await expect(
      texting.sendNotification(owner, async () => ({
        body: "nohmi: Review",
        queued: async () => {
          throw new Error("link failed");
        },
      })),
    ).rejects.toThrow("link failed");
    expect(await database.db.select().from(textMessages)).toEqual([]);
    expect(send).not.toHaveBeenCalled();
    await expect(
      texting.sendNotification(owner, async () => ({
        body: "x".repeat(1000),
        queued: async () => {},
      })),
    ).rejects.toThrow("limit");
    const [connection] = await database.db
      .select()
      .from(textingConnections)
      .where(eq(textingConnections.userId, owner));
    if (!connection) throw new Error("Expected connection");
    await database.db.insert(textMessages).values(
      Array.from({ length: 5 }, () => ({
        userId: owner,
        connectionId: connection.id,
        body: "Earlier",
        direction: "outbound" as const,
        status: "accepted" as const,
        occurredAtSource: "nohmi" as const,
        occurredAt: current,
        createdAt: current,
      })),
    );
    await expect(
      texting.sendNotification(owner, async () => ({
        body: "nohmi: Review",
        queued: async () => {},
      })),
    ).rejects.toThrow("quota");
    expect(send).not.toHaveBeenCalled();
  });
});
