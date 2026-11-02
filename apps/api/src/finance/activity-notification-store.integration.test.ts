import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  auditEvents,
  createDatabaseClient,
  type DatabaseClient,
  financeConversationMessages,
  financeMutationRecords,
  migrateDatabase,
  notificationAttemptItems,
  notificationDeliveryAttempts,
  notificationIntents,
  textingConnections,
  textMessages,
  users,
  workspaceMaintenanceRuns,
} from "@personal-os/database";
import type { FinanceConversationEffectReceipt } from "@personal-os/domain";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { encryptJson } from "../security.js";
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
    await database.db.insert(users).values({
      id: owner,
      email: `${owner}@example.test`,
      displayName: "Activity fixture",
      passwordHash: "unused",
    });
    await database.db.insert(textingConnections).values({
      id: connection,
      userId: owner,
      encryptedPhoneNumber: encryptJson(
        { e164: "+12125550123" },
        Buffer.alloc(32, 7).toString("base64"),
      ),
      phoneFingerprint: owner,
      phoneLastFour: "0123",
      country: "US",
      state: "active",
      consentVersion: "fixture",
      verifiedAt: new Date(),
    });
    await database.db.insert(workspaceMaintenanceRuns).values({
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
    await database.db.insert(notificationDeliveryAttempts).values({
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
    await database.db.insert(textMessages).values({
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
    await database.db.insert(notificationDeliveryAttempts).values({
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
  it("keeps legacy default entries and coverage unchanged until a reader explicitly opts in", async () => {
    const f = await fixture();
    await attempt(f, "2026-11-01T12:00:00Z");
    const service = createFinanceActivityService({
      db: database.db,
      cursorSecret: "aware-fixture",
    });
    const legacy = await service.listActivity(f.owner, { limit: 10 });
    expect(legacy.entries).toEqual([]);
    expect(legacy.coverage.reasons).toEqual([
      "financial_actions_outside_committed_candidate_receipts_not_projected",
      "historical_decisions_without_causal_message_not_projected",
    ]);
    expect(
      await service.listActivity(f.owner, { limit: 10, includeNotificationDeliveries: false }),
    ).toEqual(legacy);
    const aware = await service.listActivity(f.owner, {
      limit: 10,
      includeNotificationDeliveries: true,
    });
    expect(aware.entries.map((entry) => entry.kind)).toEqual(["notification_delivery"]);
    expect(aware.coverage.reasons).toContain(
      "notification_delivery_without_complete_owned_evidence_not_projected",
    );
    const explicit = await service.listActivity(f.owner, {
      limit: 10,
      type: "notification_delivery",
    });
    expect(explicit.entries).toEqual(aware.entries);
  });
  it("paginates all three kinds at the exact same PostgreSQL microsecond and UUID without loss or repetition", async () => {
    const f = await fixture();
    const stamp = "2026-11-01T12:00:00.000001Z";
    const notification = await attempt(f, stamp);
    const id = notification.id,
      operationId = randomUUID(),
      questionId = randomUUID();
    await database.db.insert(auditEvents).values({
      id,
      userId: f.owner,
      actorType: "user",
      actorId: f.owner,
      requestId: "mixed-kind-answer",
      action: "finance.contextual_answer.accepted",
      entityType: "finance_contextual_question",
      entityId: questionId,
      before: { revision: "1" },
      after: { answerId: randomUUID(), revision: "2", operationId, state: "accepted" },
      createdAt: sql`${stamp}::timestamptz`,
    });
    await database.db.insert(financeConversationMessages).values({
      userId: f.owner,
      sequence: 1n,
      authorKind: "user",
      text: "Exact historical answer",
      recordRefs: [{ kind: "contextual_question", id: questionId }],
      sourceOperationId: operationId,
      idempotencyKey: `answer:${operationId}`,
      createdAt: sql`${stamp}::timestamptz`,
    });
    await database.db.insert(financeMutationRecords).values({
      id: operationId,
      userId: f.owner,
      idempotencyKey: operationId,
      operation: "answer_contextual_question_v1",
      requestHash: "fixture",
      actorType: "user",
      actorId: f.owner,
      status: "completed",
      response: { state: "accepted", operationId, resultRevision: "2" },
      completedAt: new Date(stamp),
    });
    const auditId = randomUUID(),
      transactionId = randomUUID(),
      candidateId = randomUUID();
    const requestId = `finance-candidate-effect:${id}`;
    await database.db.insert(auditEvents).values({
      id: auditId,
      userId: f.owner,
      actorType: "user",
      actorId: f.owner,
      requestId,
      action: "finance.transaction.classified",
      entityType: "finance_transaction",
      entityId: transactionId,
      before: { category: null },
      after: { category: "Food" },
      createdAt: sql`${stamp}::timestamptz`,
    });
    const receipt: FinanceConversationEffectReceipt = {
      id,
      runId: f.run,
      candidateId,
      candidateRevision: `sha256:${"a".repeat(64)}`,
      automationScheduleId: null,
      authorizationConnectionId: null,
      committedAt: stamp,
      requestId,
      originRequestId: "mixed-kind-fixture",
      actor: { type: "user", id: f.owner },
      authorityBasis: "authenticated_owner",
      humanApproval: null,
      sourceMessageIds: [],
      explanation: "Exact committed fixture",
      auditEventIds: [auditId],
      recordRefs: [{ kind: "finance_transaction", id: transactionId }],
      outcome: "committed",
      actionFamilies: ["transaction"],
      status: "applied",
      significance: "routine",
    };
    await database.db.insert(financeMutationRecords).values({
      id,
      userId: f.owner,
      idempotencyKey: `finance-candidate-effect:${candidateId}:${receipt.candidateRevision}`,
      operation: "commit_finance_candidate_effect_v1",
      requestHash: "fixture",
      actorType: "user",
      actorId: f.owner,
      status: "completed",
      response: { financeEffectReceipt: receipt },
      completedAt: new Date(stamp),
    });
    const service = createFinanceActivityService({
      db: database.db,
      cursorSecret: "mixed-kind-fixture",
    });
    const found: string[] = [];
    let firstAwareCursor: string | null = null;
    let cursor: string | undefined;
    for (let n = 0; n < 3; n++) {
      const page = await service.listActivity(f.owner, {
        limit: 1,
        includeNotificationDeliveries: true,
        ...(cursor ? { cursor } : {}),
      });
      if (n === 0) firstAwareCursor = page.nextCursor;
      expect(page.entries).toHaveLength(1);
      expect(page.entries[0]?.id).toBe(id);
      const entry = page.entries[0];
      if (!entry) throw new Error("Missing mixed-kind entry");
      found.push(entry.kind);
      cursor = page.nextCursor ?? undefined;
      if (n < 2) expect(cursor).toBeDefined();
    }
    expect(found).toEqual(["notification_delivery", "human_answer_decision", "financial_action"]);
    expect(cursor).toBeUndefined();
    if (!firstAwareCursor) throw new Error("Expected aware mixed-kind continuation");
    await expect(
      service.listActivity(f.owner, { limit: 1, cursor: firstAwareCursor }),
    ).rejects.toThrow("exact filters");
    const legacyFirst = await service.listActivity(f.owner, { limit: 1 });
    expect(legacyFirst.entries.map((entry) => entry.kind)).toEqual(["human_answer_decision"]);
    expect(legacyFirst.coverage.reasons).not.toContain(
      "notification_delivery_without_complete_owned_evidence_not_projected",
    );
    if (!legacyFirst.nextCursor) throw new Error("Expected legacy financial continuation");
    await expect(
      service.listActivity(f.owner, {
        limit: 1,
        includeNotificationDeliveries: true,
        cursor: legacyFirst.nextCursor,
      }),
    ).rejects.toThrow("exact filters");
    const legacyNext = await service.listActivity(f.owner, {
      limit: 1,
      cursor: legacyFirst.nextCursor,
    });
    expect(legacyNext.entries.map((entry) => entry.kind)).toEqual(["financial_action"]);
    expect(legacyNext.nextCursor).toBeNull();
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
