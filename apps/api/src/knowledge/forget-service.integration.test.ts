import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  accessTokens,
  createDatabaseClient,
  type DatabaseClient,
  goals,
  knowledgeDerivations,
  knowledgeRecords,
  knowledgeRevisionMetadata,
  knowledgeRevisions,
  migrateDatabase,
  sessions,
  users,
} from "@personal-os/database";
import {
  type KnowledgeLifecycleInput,
  type KnowledgeMutationInput,
  knowledgeReceiptSchema,
} from "@personal-os/domain";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import { hashToken } from "../security.js";
import type { Principal } from "../types.js";
import {
  createKnowledgeForgetService,
  type KnowledgeDeletionLedgerEntry,
} from "./forget-service.js";
import { createKnowledgeLifecycleService } from "./lifecycle-service.js";
import { createKnowledgeRecordService } from "./record-service.js";

describe("knowledge forgetting", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
  }, 120_000);
  const fixtureIds: string[] = [];
  afterEach(async () => {
    for (const id of fixtureIds.splice(0)) await database.db.delete(users).where(eq(users.id, id));
  });
  afterAll(async () => {
    await database?.close();
    await container?.stop();
  });

  async function fixture() {
    const userId = randomUUID();
    fixtureIds.push(userId);
    const sessionId = randomUUID();
    const agentId = randomUUID();
    const scopes = ["knowledge:read", "knowledge:write"] as const;
    await database.db.insert(users).values({
      id: userId,
      email: `${userId}@example.test`,
      displayName: "Owner",
      passwordHash: "unused",
      planningTimezone: "UTC",
    });
    await database.db.insert(sessions).values({
      id: sessionId,
      userId,
      tokenHash: hashToken(randomUUID()),
      expiresAt: new Date("2027-01-01T00:00:00Z"),
    });
    await database.db.insert(accessTokens).values({
      id: agentId,
      userId,
      name: "Knowledge fixture",
      tokenHash: hashToken(randomUUID()),
      scopes: [...scopes],
    });
    const owner: Principal = {
      userId,
      actorId: userId,
      actorType: "user",
      sessionId,
      scopes: new Set(),
    };
    const agent: Principal = {
      userId,
      actorId: agentId,
      actorType: "agent",
      scopes: new Set(scopes),
    };
    let clock = Date.parse("2026-11-12T12:00:00Z");
    const ledgerEntries = new Map<string, KnowledgeDeletionLedgerEntry>();
    const ledger = {
      append: vi.fn(async (entry: KnowledgeDeletionLedgerEntry) => {
        ledgerEntries.set(entry.operationId, entry);
      }),
      readReceipt: vi.fn(async (id: string) => ledgerEntries.get(id) ?? null),
    };
    const config = {
      db: database.db,
      now: () => new Date(clock),
      suppressionKey: Buffer.alloc(32, 7),
    };
    const forget = createKnowledgeForgetService({ ...config, ledger });
    const records = createKnowledgeRecordService(config);
    const lifecycle = createKnowledgeLifecycleService(config);
    async function save(value: string, overrides?: Partial<KnowledgeMutationInput>) {
      return knowledgeReceiptSchema.parse(await records.create(owner, input(value, overrides)))
        .record;
    }
    async function admit(recordId: string) {
      const { previewId, ownerEpoch } = await forget.preview(owner, { recordId });
      const request = { previewId, ownerEpoch, mutationKey: randomUUID() };
      const receipt = await forget.forget(owner, request);
      if (receipt.outcome !== "pending_erasure") throw new Error("Expected pending erasure");
      return { request, receipt, operationId: receipt.operationId };
    }
    return {
      config,
      owner,
      agent,
      ledger,
      forget,
      records,
      lifecycle,
      save,
      admit,
      advance(ms: number) {
        clock += ms;
      },
    };
  }

  function input(
    value: string,
    overrides?: Partial<KnowledgeMutationInput>,
  ): KnowledgeMutationInput {
    return {
      mutationKey: randomUUID(),
      content: {
        kind: "fact",
        value: { subject: "Person", predicate: "preferred day", value: { type: "string", value } },
      },
      scope: { workspace: null },
      sensitivity: "standard",
      purposes: ["planning"],
      evidence: [{ type: "statement", wording: `Owner said ${value}` }],
      relatedRecordIds: [],
      ...overrides,
    };
  }

  it("forget_erases_history_and_transitive_copies", async () => {
    const f = await fixture();
    const secrets = Array.from({ length: 4 }, () => randomUUID());
    const [first, corrected, copied, transitive] = secrets as [string, string, string, string];
    const original = input(first);
    const receipt = knowledgeReceiptSchema.parse(await f.records.create(f.owner, original));
    const root = receipt.record;
    const revision: KnowledgeLifecycleInput = {
      action: "revise",
      mutationKey: randomUUID(),
      recordId: root.id,
      expectedRevision: 1,
      content: input(corrected).content,
      evidence: input(corrected).evidence,
    };
    const revisionReceipt = await f.lifecycle.mutate(f.owner, revision);
    const copy = await f.save(copied, {
      evidence: [{ type: "domain_record", domain: "knowledge", id: root.id, revision: 2 }],
    });
    const next = await f.save(transitive, {
      evidence: [{ type: "domain_record", domain: "knowledge", id: copy.id, revision: 1 }],
    });
    const independent = await f.save("independently observed", {
      relatedRecordIds: [root.id.toUpperCase(), next.id],
    });
    await f.lifecycle.mutate(f.owner, {
      action: "revise",
      mutationKey: randomUUID(),
      recordId: independent.id,
      expectedRevision: 1,
      content: independent.content,
    });
    const preview = await f.forget.preview(f.owner, { recordId: root.id });
    expect(preview).toMatchObject({ dependentCopyCount: 2, historyCount: 4 });
    const { request, operationId, receipt: pending } = await f.admit(root.id);
    await expect(
      f.records.get(f.owner, { id: independent.id, purpose: "planning" }),
    ).rejects.toMatchObject({ status: 503 });
    await expect(f.records.create(f.owner, original)).rejects.toMatchObject({ status: 503 });
    expect(await f.forget.forget(f.owner, request)).toEqual(pending);
    expect(await f.forget.status(f.owner, { operationId })).toEqual({
      operationId,
      status: "pending",
    });
    await f.forget.runOnce();
    expect(await f.forget.status(f.owner, { operationId })).toEqual({
      operationId,
      status: "completed",
    });
    expect(await f.forget.forget(f.owner, request)).toEqual({
      receiptId: pending.receiptId,
      recordId: root.id,
      outcome: "forgotten",
    });
    expect(await f.records.create(f.owner, original)).toEqual({
      receiptId: receipt.receiptId,
      recordId: root.id,
      outcome: "forgotten",
    });
    expect(await f.lifecycle.mutate(f.owner, revision)).toEqual({
      receiptId: revisionReceipt.receiptId,
      recordId: root.id,
      outcome: "forgotten",
    });
    await expect(
      f.records.create(f.owner, { ...original, content: input("changed").content }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      f.lifecycle.mutate(f.owner, { ...revision, content: input("changed").content }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await f.records.get(f.owner, { id: independent.id, purpose: "planning" })).toMatchObject(
      {
        content: independent.content,
        relatedRecordIds: [],
      },
    );
    for (const id of [root.id, copy.id, next.id]) {
      await expect(f.records.get(f.owner, { id, purpose: "planning" })).rejects.toMatchObject({
        status: 404,
      });
    }
    for (const table of [
      "knowledge_revisions",
      "knowledge_sources",
      "knowledge_receipts",
      "knowledge_revision_metadata",
      "audit_events",
    ]) {
      const { rows } = await database.pool.query(`SELECT * FROM ${table} WHERE user_id = $1`, [
        f.owner.userId,
      ]);
      for (const secret of secrets) expect(JSON.stringify(rows)).not.toContain(secret);
      if (table === "knowledge_revisions" || table === "knowledge_revision_metadata") {
        const survivingRows = rows.filter((row) => row.record_id === independent.id);
        expect(survivingRows).toHaveLength(2);
        expect(JSON.stringify(survivingRows).toLowerCase()).not.toContain(root.id);
        expect(JSON.stringify(survivingRows).toLowerCase()).not.toContain(next.id);
      }
      if (table === "knowledge_receipts")
        expect(rows.find((row) => row.id === receipt.receiptId)?.request_hash).toBeNull();
    }
    expect(f.ledger.append).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId,
        ownerId: f.owner.userId,
        recordIds: [root.id, copy.id, next.id].sort(),
      }),
      expect.any(AbortSignal),
    );
  });

  it("changed_derivation_invalidates_preview", async () => {
    const f = await fixture();
    const root = await f.save("initial");
    const { previewId, ownerEpoch } = await f.forget.preview(f.owner, { recordId: root.id });
    const [copy, stale] = await Promise.allSettled([
      f.save("dependent", {
        evidence: [{ type: "domain_record", domain: "knowledge", id: root.id, revision: 1 }],
      }),
      f.forget.forget(f.owner, { previewId, ownerEpoch, mutationKey: randomUUID() }),
    ]);
    // Either the copy wins and invalidates the preview, or the forget fence wins.
    if (copy.status === "fulfilled") {
      expect(stale).toMatchObject({ status: "rejected", reason: { status: 409 } });
    } else {
      expect(copy.reason).toMatchObject({ status: 503 });
      expect(stale).toMatchObject({ status: "fulfilled", value: { outcome: "pending_erasure" } });
    }
    if (stale.status === "fulfilled") {
      await f.forget.runOnce();
    }
    const newRoot = await f.save("another root");
    const old = await f.forget.preview(f.owner, { recordId: newRoot.id });
    await f.save("new dependency", {
      evidence: [{ type: "domain_record", domain: "knowledge", id: newRoot.id, revision: 1 }],
    });
    await expect(
      f.forget.forget(f.owner, {
        previewId: old.previewId,
        ownerEpoch: old.ownerEpoch,
        mutationKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("keeps private replay content-free, isolates owners, and permits repeated forget", async () => {
    const f = await fixture();
    const another = await fixture();
    const original = input(randomUUID(), { sensitivity: "sensitive", evidence: [] });
    const receipt = await f.records.create(f.agent, original);
    expect(receipt.outcome).toBe("pending_owner_review");
    await expect(
      f.forget.preview(another.owner, { recordId: receipt.recordId }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(f.forget.preview(f.agent, { recordId: receipt.recordId })).rejects.toMatchObject({
      status: 403,
    });
    // Simulate a receipt from the previous migration; its actor is still in the redacted audit event.
    await database.pool.query("UPDATE knowledge_receipts SET actor_id = NULL WHERE id = $1", [
      receipt.receiptId,
    ]);
    const admitted = await f.admit(receipt.recordId);
    await expect(
      f.forget.status(another.owner, { operationId: admitted.operationId }),
    ).rejects.toMatchObject({ status: 404 });
    await f.forget.runOnce();
    expect(await f.records.create(f.agent, original)).toEqual({
      receiptId: receipt.receiptId,
      recordId: receipt.recordId,
      outcome: "forgotten",
    });
    const { previewId, ownerEpoch } = await f.forget.preview(f.owner, {
      recordId: receipt.recordId,
    });
    const repeat = { previewId, ownerEpoch, mutationKey: randomUUID() };
    const repeatedReceipt = await f.forget.forget(f.owner, repeat);
    expect(repeatedReceipt).toMatchObject({ outcome: "forgotten", recordId: receipt.recordId });
    expect(await f.forget.forget(f.owner, repeat)).toEqual(repeatedReceipt);
    const other = await f.save("another live record");
    const next = await f.forget.preview(f.owner, { recordId: other.id });
    await expect(
      f.forget.forget(f.owner, {
        mutationKey: repeat.mutationKey,
        previewId: next.previewId,
        ownerEpoch: next.ownerEpoch,
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      f.records.create(f.owner, input("unrelated write", { mutationKey: repeat.mutationKey })),
    ).rejects.toMatchObject({ status: 409 });
    await database.db.delete(users).where(eq(users.id, f.owner.userId));
    expect(
      (
        await database.pool.query(
          "SELECT * FROM knowledge_forget_replay_bindings WHERE user_id = $1",
          [f.owner.userId],
        )
      ).rows,
    ).toEqual([]);
    expect(f.ledger.append).toHaveBeenCalledTimes(1);
  });

  it.each([
    "no sidecar",
    "null claim sidecar",
  ])("suppresses the declared legacy generated claim with %s", async (legacyShape) => {
    const f = await fixture();
    const request = input("legacy", { evidence: [] });
    const legacy = knowledgeReceiptSchema.parse(await f.records.create(f.agent, request)).record;
    expect(legacy.content.kind).toBe("inference");
    if (legacyShape === "no sidecar")
      await database.db
        .delete(knowledgeRevisionMetadata)
        .where(eq(knowledgeRevisionMetadata.recordId, legacy.id));
    else
      await database.db
        .update(knowledgeRevisionMetadata)
        .set({ claimKey: null })
        .where(eq(knowledgeRevisionMetadata.recordId, legacy.id));

    const preview = await f.forget.preview(f.owner, { recordId: legacy.id });
    expect(preview.dependentCopyCount).toBe(0);
    expect(new Set(preview.affected.map(({ recordId }) => recordId))).toEqual(new Set([legacy.id]));
    const { operationId } = await f.admit(legacy.id);
    await f.forget.runOnce();
    expect(await f.forget.status(f.owner, { operationId })).toMatchObject({ status: "completed" });
    await expect(
      f.records.create(f.agent, { ...request, mutationKey: randomUUID() }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("keeps suppression on same-claim survivor edits and rechecks the session on re-add", async () => {
    const f = await fixture();
    const forgotten = await f.save("forgotten");
    const survivor = await f.save("surviving");
    const { operationId } = await f.admit(forgotten.id);
    await f.forget.runOnce();
    expect(await f.forget.status(f.owner, { operationId })).toMatchObject({ status: "completed" });
    await f.lifecycle.mutate(f.owner, {
      action: "revise",
      mutationKey: randomUUID(),
      recordId: survivor.id,
      expectedRevision: 1,
      content: survivor.content,
      validity: { validFrom: null, validUntil: "2026-12-01T00:00:00Z" },
    });
    await expect(
      f.records.create(f.agent, input("forgotten", { evidence: [] })),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      f.lifecycle.mutate(f.agent, {
        action: "revise",
        mutationKey: randomUUID(),
        recordId: survivor.id,
        expectedRevision: 2,
        content: survivor.content,
      }),
    ).rejects.toMatchObject({ status: 409 });
    const { sessionId: _, ...noSession } = f.owner;
    await expect(f.records.create(noSession, input("explicit re-add"))).rejects.toMatchObject({
      status: 403,
    });
    const replace: KnowledgeLifecycleInput = {
      action: "revise",
      mutationKey: randomUUID(),
      recordId: survivor.id,
      expectedRevision: 2,
      content: input("explicit revised value").content,
    };
    await expect(f.lifecycle.mutate(noSession, replace)).rejects.toMatchObject({ status: 403 });
    expect(await f.lifecycle.mutate(f.owner, replace)).toMatchObject({ outcome: "readable" });
  });

  it("checks agent decision reason changes while allowing a metadata-only edit", async () => {
    const f = await fixture();
    const decision = (reason: string) => ({
      kind: "decision" as const,
      value: { subject: "Independent decision", option: "Keep", reason, evidenceIds: [] },
    });
    const erased = decision(randomUUID());
    const root = await f.save("owner decision", { content: erased });
    const original = decision("Surviving reason");
    const peer = knowledgeReceiptSchema.parse(
      await f.records.create(
        f.agent,
        input("agent decision", {
          content: original,
          evidence: [],
        }),
      ),
    ).record;
    const { operationId } = await f.admit(root.id);
    await f.forget.runOnce();
    expect(await f.forget.status(f.owner, { operationId })).toMatchObject({ status: "completed" });

    expect(
      await f.lifecycle.mutate(f.agent, {
        action: "revise",
        mutationKey: randomUUID(),
        recordId: peer.id,
        expectedRevision: 1,
        content: original,
        validity: { validFrom: null, validUntil: "2026-12-01T00:00:00Z" },
      }),
    ).toMatchObject({ outcome: "readable", record: { revision: 2 } });
    await expect(
      f.lifecycle.mutate(f.agent, {
        action: "revise",
        mutationKey: randomUUID(),
        recordId: peer.id,
        expectedRevision: 2,
        content: erased,
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      f.lifecycle.mutate(f.agent, {
        action: "revise",
        mutationKey: randomUUID(),
        recordId: peer.id,
        expectedRevision: 2,
        content: original,
        evidence: [
          {
            type: "statement",
            wording: erased.value.reason,
            sessionRef: "session-ref",
            messageRef: "message-ref",
          },
        ],
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await f.records.get(f.owner, { id: peer.id, purpose: "planning" })).toMatchObject({
      revision: 2,
    });
  });

  it("cannot bypass structural suppression by changing the UUID case", async () => {
    const f = await fixture();
    const source = await f.save("source entity");
    const request = input("meaning", {
      evidence: [],
      content: {
        kind: "entity_meaning",
        value: { recordId: source.id.toUpperCase(), meaning: "example", purpose: "planning" },
      },
    });
    const memory = knowledgeReceiptSchema.parse(await f.records.create(f.agent, request)).record;
    await database.db
      .update(knowledgeRevisionMetadata)
      .set({
        claimKey: JSON.stringify([null, "entity_meaning", source.id.toUpperCase(), "planning"]),
      })
      .where(eq(knowledgeRevisionMetadata.recordId, memory.id));
    const peer = await f.save("other meaning", {
      content: {
        kind: "entity_meaning",
        value: { recordId: source.id, meaning: "other", purpose: "planning" },
      },
    });
    expect(peer.conflictRecordIds).toContain(memory.id);
    const { operationId } = await f.admit(memory.id);
    await f.forget.runOnce();
    expect(await f.forget.status(f.owner, { operationId })).toMatchObject({ status: "completed" });
    await expect(
      f.records.create(f.agent, {
        ...request,
        mutationKey: randomUUID(),
        content: {
          kind: "entity_meaning",
          value: { recordId: source.id, meaning: "example", purpose: "planning" },
        },
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("persists capped retry delays and repairs a blocked operation", async () => {
    const f = await fixture();
    const record = await f.save("forgotten when durable");
    const { operationId } = await f.admit(record.id);
    f.ledger.append.mockRejectedValue(new Error("provider payload must never escape"));
    for (const [index, minutes] of [1, 5, 30].entries()) {
      await f.forget.runOnce();
      expect(f.ledger.append).toHaveBeenCalledTimes(index + 1);
      expect(await f.forget.status(f.owner, { operationId })).toEqual({
        operationId,
        status: "pending",
      });
      f.advance(minutes * 60_000 - 1);
      await f.forget.runOnce();
      expect(f.ledger.append).toHaveBeenCalledTimes(index + 1);
      f.advance(1);
    }
    await f.forget.runOnce();
    expect(await f.forget.status(f.owner, { operationId })).toEqual({
      operationId,
      status: "blocked",
    });
    await expect(f.records.create(f.owner, input("during repair"))).rejects.toMatchObject({
      status: 503,
    });
    f.ledger.append.mockReset().mockImplementation(async (entry) => {
      f.ledger.readReceipt.mockResolvedValue(entry);
    });
    await f.forget.retry(f.owner, { operationId });
    await f.forget.runOnce();
    expect(await f.forget.status(f.owner, { operationId })).toEqual({
      operationId,
      status: "completed",
    });
    await database.db.delete(users).where(eq(users.id, f.owner.userId));
    for (const table of [
      "knowledge_forget_operations",
      "knowledge_forget_targets",
      "knowledge_forget_suppressions",
      "knowledge_forget_previews",
      "knowledge_receipts",
      "knowledge_records",
    ]) {
      const { rows } = await database.pool.query(`SELECT * FROM ${table} WHERE user_id = $1`, [
        f.owner.userId,
      ]);
      expect(rows).toEqual([]);
    }
  });
  it("paginates revisions and erases at most 100 records per worker transaction", async () => {
    const f = await fixture();
    const root = await f.save("root of a large dependency graph");
    const children = Array.from({ length: 102 }, () => randomUUID());
    const [original] = await database.db
      .select({ snapshot: knowledgeRevisions.snapshot })
      .from(knowledgeRevisions)
      .where(eq(knowledgeRevisions.recordId, root.id));
    if (!original) throw new Error("Expected root revision");
    await database.db.transaction(async (tx) => {
      await tx
        .insert(knowledgeRecords)
        .values(children.map((id) => ({ id, userId: f.owner.userId })));
      await tx.insert(knowledgeRevisions).values(
        children.map((id) => ({
          userId: f.owner.userId,
          recordId: id,
          revision: 1,
          snapshot: { ...original.snapshot, id, sources: [] },
        })),
      );
      await tx.insert(knowledgeDerivations).values(
        children.map((recordId) => ({
          userId: f.owner.userId,
          recordId,
          revision: 1,
          sourceRecordId: root.id,
          sourceRevision: 1,
          kind: "source_record" as const,
        })),
      );
    });
    const first = await f.forget.preview(f.owner, { recordId: root.id });
    expect(first).toMatchObject({ dependentCopyCount: 102, historyCount: 103 });
    expect(first.affected).toHaveLength(50);
    if (!first.nextCursor) throw new Error("Expected page 2");
    const second = await f.forget.preview(f.owner, { recordId: root.id, cursor: first.nextCursor });
    expect(second.affected).toHaveLength(50);
    if (!second.nextCursor) throw new Error("Expected page 3");
    const third = await f.forget.preview(f.owner, { recordId: root.id, cursor: second.nextCursor });
    expect(third.affected).toHaveLength(3);
    expect(third.nextCursor).toBeNull();
    expect(
      [...first.affected, ...second.affected, ...third.affected].map((row) => row.recordId),
    ).toEqual([root.id, ...children].sort());

    const { operationId } = await f.admit(root.id);
    await f.forget.runOnce();
    const {
      rows: [{ count }],
    } = await database.pool.query(
      "SELECT count(*)::int FROM knowledge_forget_targets WHERE operation_id = $1 AND erased",
      [operationId],
    );
    expect(count).toBe(100);
    expect(f.ledger.append).not.toHaveBeenCalled();
    expect(await f.forget.status(f.owner, { operationId })).toMatchObject({ status: "pending" });
    await f.forget.runOnce();
    expect(await f.forget.status(f.owner, { operationId })).toMatchObject({ status: "completed" });
  }, 20_000);

  it("includes legacy implicit copies and required relationship endpoints in the closure", async () => {
    const f = await fixture();
    const root = await f.save("legacy entity");
    const independent = await f.save("other endpoint");
    const meaning = await f.save("copy", {
      content: {
        kind: "entity_meaning",
        value: { recordId: root.id, purpose: "planning", meaning: "copied context" },
      },
    });
    const relation = await f.save("link", {
      content: {
        kind: "relationship",
        value: {
          subjectId: meaning.id,
          objectId: independent.id,
          relationship: "depends",
          direction: "directed",
        },
      },
    });
    // Match the old shape: the source is present only as a required content reference.
    for (const recordId of [meaning.id, relation.id]) {
      await database.db
        .delete(knowledgeDerivations)
        .where(eq(knowledgeDerivations.recordId, recordId));
      if (recordId === relation.id)
        await database.db
          .delete(knowledgeRevisionMetadata)
          .where(eq(knowledgeRevisionMetadata.recordId, recordId));
    }
    const preview = await f.forget.preview(f.owner, { recordId: root.id });
    expect(preview.affected.map((row) => row.recordId)).toEqual(
      [root.id, meaning.id, relation.id].sort(),
    );
    const { operationId } = await f.admit(root.id);
    await f.forget.runOnce();
    expect(await f.forget.status(f.owner, { operationId })).toMatchObject({ status: "completed" });
    await expect(
      f.records.get(f.owner, { id: relation.id, purpose: "planning" }),
    ).rejects.toMatchObject({ status: 404 });
    expect(await f.records.get(f.owner, { id: independent.id, purpose: "planning" })).toMatchObject(
      { content: independent.content },
    );
  });

  it("requires a live human session at preview, admission, and status replay", async () => {
    const f = await fixture();
    const root = await f.save("live owner session");
    const { sessionId, ...noSession } = f.owner;
    await expect(f.forget.preview(noSession, { recordId: root.id })).rejects.toMatchObject({
      status: 403,
    });
    const { previewId, ownerEpoch } = await f.forget.preview(f.owner, { recordId: root.id });
    await database.db.delete(sessions).where(eq(sessions.id, sessionId as string));
    await expect(
      f.forget.forget(f.owner, { previewId, ownerEpoch, mutationKey: randomUUID() }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(f.forget.status(f.owner, { operationId: randomUUID() })).rejects.toMatchObject({
      status: 403,
    });
  });

  it("keeps an independently owned source domain record", async () => {
    const f = await fixture();
    const id = randomUUID();
    const title = "Original goal outside memory";
    await database.db.insert(goals).values({ id, title, userId: f.owner.userId });
    const memory = await f.save("context only", {
      content: { kind: "goal", value: { goalId: id } },
    });
    const { operationId } = await f.admit(memory.id);
    await f.forget.runOnce();
    expect(await f.forget.status(f.owner, { operationId })).toMatchObject({ status: "completed" });
    expect(
      await database.db
        .select({ id: goals.id, title: goals.title })
        .from(goals)
        .where(eq(goals.id, id)),
    ).toEqual([{ id, title }]);
  });

  it("aborts a hanging ledger attempt after ten seconds without reporting success", async () => {
    const f = await fixture();
    const root = await f.save("hanging ledger");
    const { operationId } = await f.admit(root.id);
    let outboundSignal: AbortSignal | undefined;
    const unavailable = createKnowledgeForgetService({
      ...f.config,
      ledger: {
        readReceipt: async (_, signal) => {
          outboundSignal = signal;
          return new Promise(() => undefined);
        },
        append: f.ledger.append,
      },
    });
    const started = performance.now();
    const attempt = unavailable.runOnce();
    await vi.waitFor(() => expect(outboundSignal).toBeDefined(), { timeout: 3_000 });
    expect(await f.forget.runOnce()).toBe(false);
    await attempt;
    expect(performance.now() - started).toBeGreaterThanOrEqual(9_900);
    expect(outboundSignal?.aborted).toBe(true);
    expect(f.ledger.append).not.toHaveBeenCalled();
    expect(await f.forget.status(f.owner, { operationId })).toEqual({
      operationId,
      status: "pending",
    });
    await expect(
      f.records.get(f.owner, { id: root.id, purpose: "planning" }),
    ).rejects.toMatchObject({ status: 503 });
  }, 17_000);

  it("recovers a shutdown after durable append without a second submission", async () => {
    const f = await fixture();
    const root = await f.save("crash after append");
    const { operationId } = await f.admit(root.id);
    const shutdown = new AbortController();
    const append = f.ledger.append.getMockImplementation();
    f.ledger.append.mockImplementation(async (entry) => {
      await append?.(entry);
      shutdown.abort();
      throw new Error("The process did not receive the durable acknowledgement.");
    });
    await f.forget.runOnce({ signal: shutdown.signal });
    expect(f.ledger.append).toHaveBeenCalledTimes(1);
    expect(await f.forget.status(f.owner, { operationId })).toEqual({
      operationId,
      status: "pending",
    });
    expect(await f.forget.runOnce()).toBe(false);
    const restarted = createKnowledgeForgetService({ ...f.config, ledger: f.ledger });
    f.advance(30_000);
    expect(await restarted.runOnce()).toBe(true);
    expect(await restarted.status(f.owner, { operationId })).toEqual({
      operationId,
      status: "completed",
    });
    expect(f.ledger.append).toHaveBeenCalledTimes(1);
  });

  it("does not start transport after an expired handoff is reclaimed", async () => {
    const f = await fixture();
    const record = await f.save("expired handoff");
    const { operationId } = await f.admit(record.id);
    const delayedDb = Object.create(f.config.db) as typeof f.config.db;
    let transactions = 0;
    delayedDb.transaction = async (run, config) => {
      const count = ++transactions;
      const result = await f.config.db.transaction(run, config);
      if (count === 5) {
        // Delay returning the committed handoff to the first worker.
        f.advance(30_001);
        expect(await f.forget.runOnce()).toBe(true);
      }
      return result;
    };
    const staleLedger = { append: vi.fn(async () => {}), readReceipt: vi.fn(async () => null) };
    const staleWorker = createKnowledgeForgetService({
      ...f.config,
      db: delayedDb,
      ledger: staleLedger,
    });
    expect(await staleWorker.runOnce()).toBe(true);
    expect(staleLedger.readReceipt).not.toHaveBeenCalled();
    expect(staleLedger.append).not.toHaveBeenCalled();
    expect(f.ledger.append).toHaveBeenCalledTimes(1);
    expect(await f.forget.status(f.owner, { operationId })).toEqual({
      operationId,
      status: "completed",
    });
  });

  it("rejects an unverified ledger response and fails closed on missing or wrong suppression keys", async () => {
    const f = await fixture();
    const original = input("suppressed owner fact");
    const root = knowledgeReceiptSchema.parse(await f.records.create(f.owner, original)).record;
    const { previewId, ownerEpoch } = await f.forget.preview(f.owner, { recordId: root.id });
    const request = { previewId, ownerEpoch, mutationKey: randomUUID() };
    const unavailable = createKnowledgeForgetService({ db: f.config.db, now: f.config.now });
    await expect(unavailable.forget(f.owner, request)).rejects.toMatchObject({ status: 503 });
    expect(await f.records.get(f.owner, { id: root.id, purpose: "planning" })).toMatchObject({
      id: root.id,
    });
    const { operationId } = await f.admit(root.id);
    const mismatched = createKnowledgeForgetService({
      ...f.config,
      ledger: {
        append: f.ledger.append,
        readReceipt: async (id) => {
          const receipt = await f.ledger.readReceipt(id);
          return receipt ? { ...receipt, recordIds: [] } : null;
        },
      },
    });
    await mismatched.runOnce();
    expect(await f.forget.status(f.owner, { operationId })).toMatchObject({ status: "pending" });
    f.advance(60_000);
    await f.forget.runOnce();
    expect(await f.forget.status(f.owner, { operationId })).toMatchObject({ status: "completed" });
    for (const key of [undefined, Buffer.alloc(32, 4)]) {
      const records = createKnowledgeRecordService({
        db: f.config.db,
        now: f.config.now,
        ...(key ? { suppressionKey: key } : {}),
      });
      await expect(
        records.create(f.agent, input("trying to recreate", { evidence: [] })),
      ).rejects.toMatchObject({ status: 503 });
    }
  });
});
