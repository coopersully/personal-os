import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  createDatabaseClient,
  type DatabaseClient,
  migrateDatabase,
  notificationAttemptItems,
  notificationDeliveryAttempts,
  notificationIntents,
  textingConnections,
  textMessages,
  users,
  workspaceMaintenanceRuns,
} from "@personal-os/database";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createFinanceActivityService } from "./activity-service.js";
/** AUTHORED NOT_RUN: owning read adapter and real schema/keyset; no provider invocation. */
describe.sequential("Finance Activity notification tenant and cursor persistence", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
  }, 120000);
  afterAll(async () => {
    await database?.close();
    await container?.stop();
  });
  async function fixture() {
    const owner = randomUUID(),
      run = randomUUID(),
      connection = randomUUID();
    await database.db
      .insert(users)
      .values({
        id: owner,
        email: `${owner}@example.test`,
        displayName: "Activity fixture",
        passwordHash: "unused",
      });
    await database.db
      .insert(textingConnections)
      .values({
        id: connection,
        userId: owner,
        encryptedPhoneNumber: "not-read",
        phoneFingerprint: owner,
        phoneLastFour: "0123",
        country: "US",
        state: "active",
        consentVersion: "fixture",
        verifiedAt: new Date(),
      });
    await database.db
      .insert(workspaceMaintenanceRuns)
      .values({
        id: run,
        userId: owner,
        domain: "finances",
        scope: { type: "all_outstanding" },
        status: "blocked",
        rulebookVersion: "fixture",
      });
    return { owner, run, connection };
  }
  async function attempt(f: Awaited<ReturnType<typeof fixture>>, stamp: string, revision = f.run) {
    const id = randomUUID(),
      intentId = randomUUID();
    const work = {
      domain: "finances" as const,
      kind: "repair" as const,
      id: randomUUID(),
      revision,
      actionRevision: "r1",
    };
    await database.db
      .insert(notificationIntents)
      .values({ id: intentId, userId: f.owner, domain: "finances", workId: work.id, work });
    await database.db
      .insert(notificationDeliveryAttempts)
      .values({
        id,
        userId: f.owner,
        state: "claimed",
        connectionId: f.connection,
        consentEpoch: 1,
        claimId: randomUUID(),
        leaseUntil: new Date("2026-11-02T00:00:00Z"),
        createdAt: sql`${stamp}::timestamptz`,
        updatedAt: sql`${stamp}::timestamptz`,
      });
    await database.db
      .insert(notificationAttemptItems)
      .values({ userId: f.owner, attemptId: id, intentId, work });
    return { id, intentId, work };
  }
  it("binds owner at attempt/membership/run lookup and never adopts a foreign run", async () => {
    const mine = await fixture(),
      other = await fixture();
    const own = await attempt(mine, "2026-11-01T12:00:00.000001Z", other.run);
    const theirs = await attempt(other, "2026-11-01T12:00:01.000001Z");
    const service = createFinanceActivityService({
      db: database.db,
      cursorSecret: "activity-fixture",
    });
    const page = await service.listActivity(mine.owner, {
      type: "notification_delivery",
      limit: 10,
    });
    expect(page.entries.map((e) => e.id)).toEqual([own.id]);
    expect(JSON.stringify(page)).not.toContain(theirs.id);
    const entry = page.entries[0];
    if (entry?.kind !== "notification_delivery") throw new Error("Expected delivery entry");
    expect(entry.actor).toBeNull();
    expect(entry.auditEventIds).toEqual([]);
    expect(entry.delivery.work[0]?.runId).toBeNull();
    expect(entry.targets).toEqual([]);
    expect(
      (
        await service.listActivity(mine.owner, {
          type: "notification_delivery",
          recordId: other.run,
          limit: 10,
        })
      ).entries,
    ).toEqual([]);
    expect(
      (
        await service.listActivity(mine.owner, {
          type: "notification_delivery",
          actor: "system",
          limit: 10,
        })
      ).entries,
    ).toEqual([]);
  });
  it("reads only safe message receipt fields and preserves frozen membership when the intent changes", async () => {
    const f = await fixture(),
      messageId = randomUUID(),
      id = randomUUID(),
      intentId = randomUUID();
    const stamp = new Date("2026-11-01T12:00:00Z");
    const work = {
      domain: "finances" as const,
      kind: "repair" as const,
      id: randomUUID(),
      revision: f.run,
      actionRevision: "r1",
    };
    await database.db
      .insert(textMessages)
      .values({
        id: messageId,
        userId: f.owner,
        connectionId: f.connection,
        direction: "outbound",
        status: "accepted",
        providerMessageSid: `SMfixture${randomUUID()}`,
        body: "PRIVATE MESSAGE CANARY",
        occurredAt: stamp,
        occurredAtSource: "provider",
        providerSubmittedAt: stamp,
      });
    await database.db
      .insert(notificationIntents)
      .values({ id: intentId, userId: f.owner, domain: "finances", workId: work.id, work });
    await database.db
      .insert(notificationDeliveryAttempts)
      .values({
        id,
        userId: f.owner,
        state: "accepted",
        connectionId: f.connection,
        consentEpoch: 1,
        claimId: randomUUID(),
        leaseUntil: stamp,
        messageId,
        submittedAt: stamp,
        timeZone: "UTC",
        timezoneRevision: stamp,
        createdAt: stamp,
        updatedAt: stamp,
      });
    await database.db
      .insert(notificationAttemptItems)
      .values({ userId: f.owner, attemptId: id, intentId, work });
    await database.db
      .update(notificationIntents)
      .set({ work: { ...work, revision: "later" }, updatedAt: new Date() })
      .where(eq(notificationIntents.id, intentId));
    const service = createFinanceActivityService({
      db: database.db,
      cursorSecret: "activity-fixture",
    });
    const page = await service.listActivity(f.owner, { type: "notification_delivery", limit: 10 });
    const entry = page.entries[0];
    if (entry?.kind !== "notification_delivery") throw new Error("Expected delivery entry");
    expect(entry.delivery.work[0]?.work.revision).toBe(f.run);
    expect(entry.delivery.work[0]?.runId).toBe(f.run);
    expect(entry.delivery.messageId).toBe(messageId);
    expect(entry.status).toBe("accepted");
    expect(entry.delivery.deliveredAt).toBeNull();
    expect(JSON.stringify(page)).not.toMatch(
      /PRIVATE MESSAGE CANARY|SMfixture|encryptedPhoneNumber|phoneFingerprint/u,
    );
  });
  it("uses immutable microsecond creation order after status updates and signs owner/filter cursors", async () => {
    const f = await fixture();
    const older = await attempt(f, "2026-11-01T12:00:00.000001Z");
    const newer = await attempt(f, "2026-11-01T12:00:00.000002Z");
    const service = createFinanceActivityService({
      db: database.db,
      cursorSecret: "activity-fixture",
    });
    const page = await service.listActivity(f.owner, { type: "notification_delivery", limit: 1 });
    expect(page.entries[0]?.id).toBe(newer.id);
    if (!page.nextCursor) throw new Error("Expected real continuation");
    await database.db
      .update(notificationDeliveryAttempts)
      .set({ state: "suppressed", updatedAt: new Date("2026-11-02T12:00:00Z") })
      .where(eq(notificationDeliveryAttempts.id, older.id));
    const next = await service.listActivity(f.owner, {
      type: "notification_delivery",
      limit: 1,
      cursor: page.nextCursor,
    });
    expect(next.entries.map((e) => e.id)).toEqual([older.id]);
    expect(next.entries[0]?.status).toBe("suppressed");
    await expect(
      service.listActivity(f.owner, { limit: 1, cursor: page.nextCursor }),
    ).rejects.toThrow("exact filters");
    const other = await fixture();
    await expect(
      service.listActivity(other.owner, {
        type: "notification_delivery",
        limit: 1,
        cursor: page.nextCursor,
      }),
    ).rejects.toThrow("exact filters");
  });
});
