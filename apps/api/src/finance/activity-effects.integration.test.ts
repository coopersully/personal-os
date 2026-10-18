import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  auditEvents,
  createDatabaseClient,
  type DatabaseClient,
  financeConversationBatches,
  financeConversationEvidence,
  financeConversationMessages,
  financeMutationRecords,
  migrateDatabase,
  users,
  workspaceMaintenanceRuns,
} from "@personal-os/database";
import type { FinanceConversationEffectReceipt } from "@personal-os/domain";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq, sql } from "drizzle-orm";
import { createFinanceActivityService } from "./activity-service.js";

/** AUTHORED, NOT RUN: real PostgreSQL projection/source-binding gate, scheduled by the Lead.
 * Core producer atomicity is separately exercised by finance-effect-lineage.integration.test.ts.
 * These fixtures seed its exact persisted contract to challenge owner/audit/source retrieval.
 */
describe.sequential("Finance Activity actual receipt and immutable-source projection", () => {
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
  async function fixture(count = 1, source = true) {
    const owner = randomUUID(),
      mutationId = randomUUID(),
      candidateId = randomUUID(),
      runId = randomUUID(),
      messageId = randomUUID(),
      stamp = new Date("2026-10-18T10:00:00Z");
    await database.db.insert(users).values({
      id: owner,
      displayName: "Activity owner",
      email: `${owner}@example.com`,
      passwordHash: "unused",
    });
    await database.db.insert(workspaceMaintenanceRuns).values({
      id: runId,
      userId: owner,
      domain: "finances",
      scope: { type: "all_outstanding" },
      status: "completed",
      rulebookVersion: "test",
    });
    await database.db.insert(financeConversationBatches).values({
      runId,
      userId: owner,
      cursorKey: "test",
      cutoffSequence: 9223372036854775807n,
      capturedAt: stamp,
    });
    if (source)
      await database.db.insert(financeConversationMessages).values({
        id: messageId,
        userId: owner,
        sequence: 9223372036854775807n,
        authorKind: "user",
        text: "Immutable exact source",
        idempotencyKey: randomUUID(),
        createdAt: stamp,
      });
    const audits = Array.from({ length: count }, () => ({
      id: randomUUID(),
      userId: owner,
      actorType: "user" as const,
      actorId: owner,
      requestId: `finance-candidate-effect:${mutationId}`,
      action: "finance.transaction.classified",
      entityType: "finance_transaction",
      entityId: randomUUID(),
      before: { category: "Uncategorized" },
      after: { category: "Food" },
      createdAt: stamp,
    }));
    await database.db.insert(auditEvents).values(audits);
    const receipt: FinanceConversationEffectReceipt = {
      id: mutationId,
      runId,
      candidateId,
      candidateRevision: `sha256:${"a".repeat(64)}`,
      automationScheduleId: null,
      authorizationConnectionId: null,
      committedAt: stamp.toISOString(),
      requestId: `finance-candidate-effect:${mutationId}`,
      originRequestId: "original-human-request",
      actor: { type: "user", id: owner },
      authorityBasis: "authenticated_owner",
      humanApproval: null,
      sourceMessageIds: source ? [messageId] : [],
      explanation: "Committed classification",
      auditEventIds: audits.map((audit) => audit.id),
      recordRefs: audits.map((audit) => ({ kind: audit.entityType, id: audit.entityId })),
      outcome: "committed",
      actionFamilies: ["transaction"],
      status: "applied",
      significance: "routine",
    };
    const key = `finance-candidate-effect:${candidateId}:${receipt.candidateRevision}`;
    await database.db.insert(financeMutationRecords).values({
      id: mutationId,
      userId: owner,
      idempotencyKey: key,
      operation: "commit_finance_candidate_effect_v1",
      requestHash: "server-hash",
      actorType: "user",
      actorId: owner,
      status: "completed",
      response: { financeEffectReceipt: receipt },
      completedAt: stamp,
    });
    if (source)
      await database.db.insert(financeConversationEvidence).values({
        userId: owner,
        runId,
        sourceContext: { caseId: null },
        actionKey: key,
        sourceOperationId: candidateId,
        sourceMessageIds: [messageId],
        explanation: receipt.explanation,
        effectRefs: audits.map((audit) => ({ kind: "audit_event", id: audit.id })),
        createdAt: stamp,
      });
    return {
      owner,
      receipt,
      audits,
      messageId,
      service: createFinanceActivityService({ db: database.db, cursorSecret: "existing-test-key" }),
    };
  }
  it("keeps 101 changes reachable as one action with exact immutable source and decimal sequence", async () => {
    const f = await fixture(101);
    const page = await f.service.listActivity(f.owner, { type: "financial_action", limit: 1 });
    expect(page.entries).toHaveLength(1);
    expect(page.nextCursor).toBeNull();
    const entry = page.entries[0];
    if (!entry) throw new Error("missing entry");
    expect(entry.changes).toHaveLength(100);
    expect(entry.sourceMessages[0]).toMatchObject({
      id: f.messageId,
      text: "Immutable exact source",
      sequence: "9223372036854775807",
      excerpt: null,
    });
    const next = entry.evidence?.nextCursor;
    if (!next) throw new Error("missing continuation");
    const last = await f.service.readEvidence(f.owner, entry.id, { cursor: next });
    expect(last.changes).toHaveLength(1);
    expect(last.nextCursor).toBeNull();
    expect(new Set([...entry.changes, ...last.changes].map((change) => change.id)).size).toBe(101);
  });
  it("does not expose foreign receipt IDs or permit foreign/malformed/changed receipt evidence cursors", async () => {
    const f = await fixture(101, false);
    const foreign = await fixture();
    const first = await f.service.readEvidence(f.owner, f.receipt.id);
    if (!first.nextCursor) throw new Error("continuation");
    await expect(f.service.readEvidence(foreign.owner, f.receipt.id)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(f.service.readEvidence(foreign.owner, randomUUID())).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(
      f.service.readEvidence(f.owner, f.receipt.id, { cursor: `${first.nextCursor}x` }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await database.db
      .update(financeMutationRecords)
      .set({ response: { financeEffectReceipt: { ...f.receipt, explanation: "Changed receipt" } } })
      .where(eq(financeMutationRecords.id, f.receipt.id));
    await expect(
      f.service.readEvidence(f.owner, f.receipt.id, { cursor: first.nextCursor }),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });
  it("rejects missing or unrelated owned audit evidence instead of fabricating a change", async () => {
    const f = await fixture();
    const audit = f.audits[0];
    if (!audit) throw new Error("audit");
    await database.db
      .update(auditEvents)
      .set({ requestId: "unrelated-caller-request" })
      .where(eq(auditEvents.id, audit.id));
    expect(
      (await f.service.listActivity(f.owner, { limit: 50, type: "financial_action" })).entries,
    ).toEqual([]);
    await expect(f.service.readEvidence(f.owner, f.receipt.id)).rejects.toMatchObject({
      code: "not_found",
    });
  });
  it("does not substitute a same-text or foreign source message for the receipt's immutable message", async () => {
    const f = await fixture();
    const other = await fixture();
    await database.db
      .update(financeMutationRecords)
      .set({
        response: { financeEffectReceipt: { ...f.receipt, sourceMessageIds: [other.messageId] } },
      })
      .where(eq(financeMutationRecords.id, f.receipt.id));
    expect(
      (await f.service.listActivity(f.owner, { limit: 50, type: "financial_action" })).entries,
    ).toEqual([]);
    await expect(f.service.readEvidence(f.owner, f.receipt.id)).rejects.toMatchObject({
      code: "not_found",
    });
  });
  it("paginates actual effects alongside accepted human decisions without losing submillisecond ordering", async () => {
    const f = await fixture(1, false);
    const operationId = randomUUID(),
      auditId = randomUUID(),
      questionId = randomUUID(),
      answerId = randomUUID();
    await database.db.insert(auditEvents).values({
      id: auditId,
      userId: f.owner,
      actorType: "user",
      actorId: f.owner,
      requestId: "accepted-human-answer",
      action: "finance.contextual_answer.accepted",
      entityType: "finance_contextual_question",
      entityId: questionId,
      after: { state: "accepted", operationId, answerId, revision: "2" },
      createdAt: sql`'2026-10-18T10:00:00.000123Z'::timestamptz`,
    });
    await database.db.insert(financeConversationMessages).values({
      userId: f.owner,
      sequence: 1n,
      authorKind: "user",
      text: "Human answer retained separately",
      sourceOperationId: operationId,
      idempotencyKey: `answer:${operationId}`,
      recordRefs: [{ kind: "contextual_question", id: questionId }],
      createdAt: new Date("2026-10-18T10:00:00Z"),
    });
    await database.db.insert(financeMutationRecords).values({
      userId: f.owner,
      idempotencyKey: operationId,
      operation: "answer_contextual_question_v1",
      requestHash: "server-hash",
      actorType: "user",
      actorId: f.owner,
      status: "completed",
      response: { state: "accepted", operationId, resultRevision: "2" },
    });
    const first = await f.service.listActivity(f.owner, { limit: 1 });
    expect(first.entries.map((entry) => entry.id)).toEqual([auditId]);
    if (!first.nextCursor) throw new Error("Expected combined continuation");
    const second = await f.service.listActivity(f.owner, { limit: 1, cursor: first.nextCursor });
    expect(second.entries.map((entry) => entry.id)).toEqual([f.receipt.id]);
    expect(second.nextCursor).toBeNull();
    await expect(
      f.service.listActivity(f.owner, {
        limit: 1,
        type: "financial_action",
        cursor: first.nextCursor,
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });
  it("binds the combined list cursor to exact filters and preserves record-filter pagination", async () => {
    const f = await fixture();
    const record = f.audits[0]?.entityId;
    if (!record) throw new Error("record");
    const page = await f.service.listActivity(f.owner, {
      limit: 1,
      recordId: record,
      type: "financial_action",
    });
    expect(page.entries.map((entry) => entry.id)).toEqual([f.receipt.id]);
    expect(page.entries[0]?.changes[0]?.recordRef).toEqual({
      kind: "transaction",
      id: record,
      sourceKind: "finance_transaction",
    });
  });
});
