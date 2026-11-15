import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  accessTokens,
  createDatabaseClient,
  type DatabaseClient,
  knowledgeDerivations,
  knowledgeReceipts,
  knowledgeRecords,
  knowledgeRelationships,
  knowledgeRevisionMetadata,
  knowledgeRevisions,
  knowledgeSources,
  knowledgeTombstones,
  migrateDatabase,
  sessions,
  users,
} from "@personal-os/database";
import {
  type KnowledgeContextPack,
  type KnowledgeMutationInput,
  knowledgeReceiptSchema,
  knowledgeTrashRetentionMs,
} from "@personal-os/domain";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { and, eq, or } from "drizzle-orm";
import { hashToken } from "../security.js";
import type { Principal } from "../types.js";
import { createKnowledgeContextService } from "./context-service.js";
import { createKnowledgeExportService } from "./export-service.js";
import { createKnowledgeLifecycleService } from "./lifecycle-service.js";
import { createKnowledgePurgeService } from "./purge-service.js";
import { createKnowledgeRecordService } from "./record-service.js";
import { createKnowledgeSearchService } from "./search-service.js";

const planning = { purpose: "planning" } as const;

function fact(value: string, overrides?: Partial<KnowledgeMutationInput>): KnowledgeMutationInput {
  return {
    mutationKey: randomUUID(),
    content: {
      kind: "fact",
      value: {
        subject: `Fixture ${randomUUID()}`,
        predicate: "planning detail",
        value: { type: "string", value },
      },
    },
    scope: { workspace: null },
    sensitivity: "standard",
    purposes: ["planning", "review"],
    evidence: [{ type: "statement", wording: "The owner stated this explicitly." }],
    relatedRecordIds: [],
    ...overrides,
  };
}

function derivedFrom(source: { id: string; revision: number }, value: string) {
  return fact(value, {
    evidence: [
      { type: "statement", wording: "The owner stated this explicitly." },
      { type: "domain_record", domain: "knowledge", id: source.id, revision: source.revision },
    ],
  });
}

function packIds(pack: KnowledgeContextPack) {
  return [...pack.stated, ...pack.inferred, ...pack.tentative, ...pack.conflicts].map(
    ({ id }) => id,
  );
}

describe("memory trash and purge", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  const fixtureIds: string[] = [];

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
  }, 120_000);
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
      expiresAt: new Date("2027-12-01T00:00:00Z"),
    });
    const owner: Principal = {
      userId,
      actorId: userId,
      actorType: "user",
      sessionId,
      scopes: new Set(),
    };
    const actorId = randomUUID();
    await database.db.insert(accessTokens).values({
      id: actorId,
      userId,
      name: "Memory agent",
      tokenHash: hashToken(randomUUID()),
      scopes: [...scopes],
    });
    const agent: Principal = { userId, actorId, actorType: "agent", scopes: new Set(scopes) };
    let clock = Date.parse("2026-11-12T12:00:00Z");
    const config = {
      db: database.db,
      now: () => new Date(clock),
      encryptionKey: Buffer.alloc(32, 11).toString("base64"),
    };
    const records = createKnowledgeRecordService(config);
    const lifecycle = createKnowledgeLifecycleService(config);
    function act(
      action: "trash" | "restore" | "delete_now",
      record: { id: string; revision: number },
      principal: Principal = owner,
    ) {
      return lifecycle.mutate(principal, {
        action,
        recordId: record.id,
        expectedRevision: record.revision,
        mutationKey: randomUUID(),
      });
    }
    return {
      owner,
      agent,
      records,
      lifecycle,
      act,
      search: createKnowledgeSearchService(config),
      context: createKnowledgeContextService(config),
      exporter: createKnowledgeExportService(config),
      purge: createKnowledgePurgeService(config),
      advance: (ms: number) => {
        clock += ms;
      },
      async save(input: KnowledgeMutationInput, principal = owner) {
        return knowledgeReceiptSchema.parse(await records.create(principal, input)).record;
      },
    };
  }

  it("trash_hides_record_and_derived_copies_from_agents", async () => {
    const f = await fixture();
    const a = await f.save(fact("trash-source-value"));
    const b = await f.save(derivedFrom(a, "trash-derived-value"));
    const kept = await f.save(fact("kept-value"));
    expect(await f.records.get(f.agent, { id: b.id, ...planning })).toMatchObject({ id: b.id });

    expect(await f.act("trash", a)).toMatchObject({ recordId: a.id, outcome: "trashed" });

    for (const id of [a.id, b.id])
      await expect(f.records.get(f.agent, { id, ...planning })).rejects.toMatchObject({
        status: 404,
      });
    for (const id of [a.id, b.id])
      await expect(f.search.history(f.agent, { recordId: id, ...planning })).rejects.toMatchObject({
        status: 404,
      });
    for (const principal of [f.agent, f.owner]) {
      const page = await f.search.search(principal, { ...planning, limit: 50 });
      expect(page.items.map(({ id }) => id)).toEqual([kept.id]);
      expect(JSON.stringify(page)).not.toMatch(/trash-(source|derived)-value/);
    }
    const pack = await f.context.context(f.agent, { ...planning, limit: 50 });
    expect(packIds(pack)).toEqual([kept.id]);
    expect(JSON.stringify(pack)).not.toMatch(/trash-(source|derived)-value/);
    const exported = await f.exporter.exportPage(f.owner, {});
    expect(exported.items.map(({ id }) => id)).toEqual([kept.id]);

    const trashed = await f.search.search(f.owner, { ...planning, status: "trashed", limit: 50 });
    expect(trashed.items.map(({ id }) => id).sort()).toEqual([a.id, b.id].sort());
    for (const item of trashed.items)
      expect(item).toMatchObject({ trashGroupId: a.id, trashedAt: "2026-11-12T12:00:00.000Z" });
    await expect(
      f.search.search(f.agent, { ...planning, status: "trashed" }),
    ).rejects.toMatchObject({ status: 403 });
    expect(await f.records.get(f.owner, { id: b.id, ...planning })).toMatchObject({
      id: b.id,
      trashGroupId: a.id,
    });
  });

  it("trash_does_not_cascade_to_linked_relationships", async () => {
    const f = await fixture();
    const person = await f.save(fact("linked-person-private-detail"));
    const other = await f.save(fact("linked-other-person"));
    const relationship = await f.save(
      fact("unused", {
        content: {
          kind: "relationship",
          value: {
            subjectId: person.id,
            objectId: other.id,
            relationship: "partner",
            direction: "bidirectional",
          },
        },
      }),
    );
    expect(await f.act("trash", person)).toMatchObject({ outcome: "trashed" });

    const trashed = await f.search.search(f.owner, { ...planning, status: "trashed", limit: 50 });
    expect(trashed.items.map(({ id }) => id)).toEqual([person.id]);
    await expect(f.records.get(f.agent, { id: person.id, ...planning })).rejects.toMatchObject({
      status: 404,
    });
    for (const read of [
      () => f.records.get(f.agent, { id: relationship.id, ...planning }),
      async () =>
        (await f.search.search(f.agent, { ...planning, limit: 50 })).items.find(
          ({ id }) => id === relationship.id,
        ),
    ]) {
      const visible = await read();
      expect(visible).toMatchObject({
        id: relationship.id,
        status: "active",
        trashedAt: null,
        content: { value: { subjectId: person.id, objectId: other.id } },
      });
      expect(JSON.stringify(visible)).not.toContain("linked-person-private-detail");
    }

    f.advance(knowledgeTrashRetentionMs + 1);
    expect(await f.purge.purgeExpired({ limit: 100 })).toMatchObject({ purged: 1 });
    const afterPurge = await f.records.get(f.agent, { id: relationship.id, ...planning });
    expect(afterPurge).toMatchObject({ id: relationship.id, status: "active" });
    expect(JSON.stringify(afterPurge)).not.toContain("linked-person-private-detail");
    expect(await f.records.get(f.owner, { id: person.id, ...planning })).toMatchObject({
      id: person.id,
      state: "forgotten",
    });
  });

  it("restore_returns_only_its_trash_group", async () => {
    const f = await fixture();
    const a = await f.save(fact("restore-source"));
    const b = await f.save(derivedFrom(a, "restore-derived"));
    const c = await f.save(derivedFrom(b, "restore-descendant"));
    await f.act("trash", b);
    await f.act("trash", a);
    const trashed = await f.search.search(f.owner, { ...planning, status: "trashed", limit: 50 });
    expect(
      Object.fromEntries(trashed.items.map(({ id, trashGroupId }) => [id, trashGroupId])),
    ).toEqual({ [a.id]: a.id, [b.id]: b.id, [c.id]: b.id });

    await expect(f.act("restore", c)).rejects.toMatchObject({ status: 409 });
    const restored = await f.act("restore", a);
    expect(restored).toMatchObject({
      outcome: "readable",
      record: { id: a.id, status: "active", trashedAt: null, trashGroupId: null },
    });
    expect(await f.records.get(f.agent, { id: a.id, ...planning })).toMatchObject({
      id: a.id,
      status: "active",
    });
    for (const id of [b.id, c.id])
      await expect(f.records.get(f.agent, { id, ...planning })).rejects.toMatchObject({
        status: 404,
      });
    const still = await f.search.search(f.owner, { ...planning, status: "trashed", limit: 50 });
    expect(still.items.map(({ id }) => id).sort()).toEqual([b.id, c.id].sort());
    await f.act("restore", b);
    expect(await f.records.get(f.agent, { id: c.id, ...planning })).toMatchObject({ id: c.id });
  });

  it("restore_refuses_while_a_source_is_trashed_elsewhere", async () => {
    const f = await fixture();
    const a = await f.save(fact("elsewhere-source"));
    const b = await f.save(derivedFrom(a, "elsewhere-derived"));
    await f.act("trash", b);
    await f.act("trash", a);

    await expect(f.act("restore", b)).rejects.toMatchObject({
      status: 409,
      details: { blockedBy: [a.id] },
    });
    await expect(f.records.get(f.agent, { id: b.id, ...planning })).rejects.toMatchObject({
      status: 404,
    });
    await f.act("restore", a);
    expect(await f.act("restore", b)).toMatchObject({ outcome: "readable", record: { id: b.id } });
    expect(await f.records.get(f.agent, { id: b.id, ...planning })).toMatchObject({ id: b.id });
  });

  it("purging_a_source_purges_derived_copies_in_other_groups", async () => {
    const f = await fixture();
    const a = await f.save(fact("multi-source-a"));
    const d = await f.save(fact("multi-source-d"));
    const b = await f.save(
      fact("multi-derived-secret", {
        evidence: [
          { type: "statement", wording: "The owner stated this explicitly." },
          { type: "domain_record", domain: "knowledge", id: a.id, revision: 1 },
          { type: "domain_record", domain: "knowledge", id: d.id, revision: 1 },
        ],
      }),
    );
    await f.act("trash", a);
    expect(await f.act("delete_now", d)).toMatchObject({ outcome: "forgotten" });

    for (const id of [b.id, d.id])
      expect(await f.records.get(f.owner, { id, ...planning })).toMatchObject({
        id,
        state: "forgotten",
      });
    expect(
      await database.db
        .select()
        .from(knowledgeRevisions)
        .where(eq(knowledgeRevisions.recordId, b.id)),
    ).toEqual([]);
    expect(await f.act("restore", a)).toMatchObject({ outcome: "readable", record: { id: a.id } });
    await expect(f.records.get(f.agent, { id: b.id, ...planning })).rejects.toMatchObject({
      status: 404,
    });
    const page = await f.search.search(f.agent, { ...planning, limit: 50 });
    expect(page.items.map(({ id }) => id)).toEqual([a.id]);
    expect(JSON.stringify(page)).not.toContain("multi-derived-secret");
  });

  it("restore_refuses_when_a_source_was_already_purged", async () => {
    const f = await fixture();
    const a = await f.save(fact("purged-elsewhere-a"));
    const d = await f.save(fact("purged-elsewhere-d"));
    const b = await f.save(
      fact("purged-elsewhere-derived", {
        evidence: [
          { type: "domain_record", domain: "knowledge", id: a.id, revision: 1 },
          { type: "domain_record", domain: "knowledge", id: d.id, revision: 1 },
        ],
      }),
    );
    await f.act("trash", a);
    // A source purged without its dependents (as an earlier purge could): its edges are gone,
    // but B's revisions still name it.
    await database.db.delete(knowledgeRecords).where(eq(knowledgeRecords.id, d.id));
    await database.db.insert(knowledgeTombstones).values({
      userId: f.owner.userId,
      recordId: d.id,
      trashedAt: new Date("2026-11-12T12:00:00Z"),
      purgedAt: new Date("2026-11-12T12:00:00Z"),
    });

    await expect(f.act("restore", a)).rejects.toMatchObject({
      status: 409,
      details: { blockedBy: [d.id] },
    });
    for (const id of [a.id, b.id])
      await expect(f.records.get(f.agent, { id, ...planning })).rejects.toMatchObject({
        status: 404,
      });
  });

  async function people(f: Awaited<ReturnType<typeof fixture>>) {
    return {
      person: await f.save(fact("endpoint-person-detail")),
      other: await f.save(fact("endpoint-other-person")),
    };
  }
  function relationshipContent(subjectId: string, objectId: string) {
    return {
      kind: "relationship" as const,
      value: { subjectId, objectId, relationship: "partner", direction: "bidirectional" as const },
    };
  }
  async function expectAllStored(ids: string[]) {
    for (const id of ids)
      expect(
        await database.db
          .select({ id: knowledgeRevisions.id })
          .from(knowledgeRevisions)
          .where(eq(knowledgeRevisions.recordId, id)),
      ).not.toHaveLength(0);
  }

  it("restore_refuses_a_relationship_that_cites_its_trashed_endpoint_as_evidence", async () => {
    const f = await fixture();
    const { person, other } = await people(f);
    const relationship = await f.save(
      fact("unused", {
        content: relationshipContent(person.id, other.id),
        evidence: [{ type: "domain_record", domain: "knowledge", id: person.id, revision: 1 }],
      }),
    );
    await f.act("trash", relationship);
    await f.act("trash", person);

    await expect(f.act("restore", relationship)).rejects.toMatchObject({
      status: 409,
      details: { blockedBy: [person.id] },
    });
    expect(await f.act("delete_now", person)).toMatchObject({ outcome: "forgotten" });
    for (const id of [person.id, relationship.id])
      expect(await f.records.get(f.owner, { id, ...planning })).toMatchObject({
        id,
        state: "forgotten",
      });
    await expectAllStored([other.id]);
  });

  it("evidence_in_an_earlier_revision_still_counts_after_it_becomes_an_endpoint", async () => {
    const f = await fixture();
    const { person, other } = await people(f);
    const cited = await f.save(derivedFrom(person, "cites-the-person"));
    const revised = await f.lifecycle.mutate(f.owner, {
      action: "revise",
      recordId: cited.id,
      expectedRevision: 1,
      mutationKey: randomUUID(),
      content: relationshipContent(person.id, other.id),
    });
    expect(revised).toMatchObject({ outcome: "readable", record: { revision: 2 } });
    const relationship = { id: cited.id, revision: 2 };
    await f.act("trash", relationship);
    await f.act("trash", person);

    await expect(f.act("restore", relationship)).rejects.toMatchObject({
      status: 409,
      details: { blockedBy: [person.id] },
    });
    await f.act("restore", person);
    await f.act("restore", relationship);
    // Trashing the person again moves the record cited by revision 1 with it.
    await f.act("trash", person);
    const trashed = await f.search.search(f.owner, { ...planning, status: "trashed", limit: 50 });
    expect(
      Object.fromEntries(trashed.items.map(({ id, trashGroupId }) => [id, trashGroupId])),
    ).toEqual({ [person.id]: person.id, [cited.id]: person.id });
  });

  it("purge_guard_erases_nothing_when_a_derived_record_is_not_in_trash", async () => {
    const f = await fixture();
    const a = await f.save(fact("guard-source"));
    const b = await f.save(derivedFrom(a, "guard-derived"));
    await f.act("trash", a);
    // Force the state no API path reaches: a derived record outside Trash.
    await database.db
      .update(knowledgeRecords)
      .set({ trashedAt: null, trashGroupId: null, statusBeforeTrash: null })
      .where(eq(knowledgeRecords.id, b.id));

    await expect(f.act("delete_now", a)).rejects.toMatchObject({
      status: 500,
      details: { recordIds: [b.id] },
    });
    f.advance(knowledgeTrashRetentionMs + 1);
    await expect(f.purge.purgeExpired({ limit: 100 })).rejects.toMatchObject({ status: 500 });
    await expectAllStored([a.id, b.id]);
    expect(
      await database.db
        .select()
        .from(knowledgeTombstones)
        .where(eq(knowledgeTombstones.userId, f.owner.userId)),
    ).toEqual([]);
    expect(await f.records.get(f.owner, { id: a.id, ...planning })).toMatchObject({
      id: a.id,
      trashGroupId: a.id,
    });
  });

  it("trash_invalidates_open_cursors", async () => {
    const f = await fixture();
    for (const value of ["cursor-one", "cursor-two", "cursor-three"]) await f.save(fact(value));
    const order = (await f.search.search(f.agent, { ...planning, limit: 50 })).items;
    const first = await f.search.search(f.agent, { ...planning, limit: 1 });
    expect(first.items.map(({ id }) => id)).toEqual([order[0]?.id]);
    if (!first.nextCursor || !order[1]) throw new Error("Expected a continuation.");

    await f.act("trash", order[1]);

    await expect(
      f.search.search(f.agent, { ...planning, limit: 1, cursor: first.nextCursor }),
    ).rejects.toMatchObject({ status: 409 });
    const fresh = await f.search.search(f.agent, { ...planning, limit: 50 });
    expect(fresh.items.map(({ id }) => id)).not.toContain(order[1].id);
    expect(fresh.items).toHaveLength(2);
  });

  it("purge_after_30_days_leaves_only_tombstone", async () => {
    const f = await fixture();
    const a = await f.save(fact("purge-secret-value"));
    const b = await f.save(derivedFrom(a, "purge-derived-value"));
    const linked = await f.save(fact("linked-value", { relatedRecordIds: [a.id] }));
    const trashedAt = new Date("2026-11-12T12:00:00Z");
    await f.act("trash", a);

    f.advance(knowledgeTrashRetentionMs);
    expect(await f.purge.purgeExpired({ limit: 100 })).toMatchObject({ purged: 0 });
    f.advance(1);
    expect(await f.purge.purgeExpired({ limit: 100 })).toMatchObject({ purged: 2 });

    const { db } = database;
    for (const id of [a.id, b.id]) {
      expect(await db.select().from(knowledgeRecords).where(eq(knowledgeRecords.id, id))).toEqual(
        [],
      );
      expect(
        await db.select().from(knowledgeRevisions).where(eq(knowledgeRevisions.recordId, id)),
      ).toEqual([]);
      expect(
        await db
          .select()
          .from(knowledgeRevisionMetadata)
          .where(eq(knowledgeRevisionMetadata.recordId, id)),
      ).toEqual([]);
      expect(
        await db.select().from(knowledgeSources).where(eq(knowledgeSources.recordId, id)),
      ).toEqual([]);
      expect(
        await db
          .select()
          .from(knowledgeRelationships)
          .where(
            or(
              eq(knowledgeRelationships.recordId, id),
              eq(knowledgeRelationships.relatedRecordId, id),
            ),
          ),
      ).toEqual([]);
      expect(
        await db
          .select()
          .from(knowledgeDerivations)
          .where(
            or(eq(knowledgeDerivations.recordId, id), eq(knowledgeDerivations.sourceRecordId, id)),
          ),
      ).toEqual([]);
      expect(
        await db
          .select()
          .from(knowledgeTombstones)
          .where(
            and(
              eq(knowledgeTombstones.userId, f.owner.userId),
              eq(knowledgeTombstones.recordId, id),
            ),
          ),
      ).toEqual([
        {
          userId: f.owner.userId,
          recordId: id,
          trashedAt,
          purgedAt: new Date(trashedAt.getTime() + knowledgeTrashRetentionMs + 1),
        },
      ]);
    }
    const [linkedRevision] = await db
      .select({ snapshot: knowledgeRevisions.snapshot })
      .from(knowledgeRevisions)
      .where(eq(knowledgeRevisions.recordId, linked.id));
    expect(linkedRevision?.snapshot.relatedRecordIds).toEqual([a.id]);
    const receipts = await db
      .select()
      .from(knowledgeReceipts)
      .where(eq(knowledgeReceipts.recordId, a.id));
    expect(receipts.length).toBeGreaterThan(0);

    expect(await f.records.get(f.owner, { id: a.id, ...planning })).toEqual({
      id: a.id,
      state: "forgotten",
      trashedAt: trashedAt.toISOString(),
      purgedAt: new Date(trashedAt.getTime() + knowledgeTrashRetentionMs + 1).toISOString(),
    });
    await expect(f.records.get(f.agent, { id: a.id, ...planning })).rejects.toMatchObject({
      status: 404,
    });
    await expect(f.search.history(f.owner, { recordId: a.id, ...planning })).rejects.toMatchObject({
      status: 404,
    });
    const exported = JSON.stringify(await f.exporter.exportPage(f.owner, {}));
    expect(exported).not.toMatch(/purge-(secret|derived)-value/);
    expect(await f.records.get(f.agent, { id: linked.id, ...planning })).toMatchObject({
      id: linked.id,
      relatedRecordIds: [],
    });
  });

  it("delete_now_purges_immediately", async () => {
    const f = await fixture();
    const a = await f.save(fact("delete-now-value"));
    const b = await f.save(derivedFrom(a, "delete-now-derived"));
    expect(await f.act("delete_now", a)).toMatchObject({ recordId: a.id, outcome: "forgotten" });
    for (const id of [a.id, b.id]) {
      expect(
        await database.db
          .select()
          .from(knowledgeRevisions)
          .where(eq(knowledgeRevisions.recordId, id)),
      ).toEqual([]);
      expect(await f.records.get(f.owner, { id, ...planning })).toMatchObject({
        id,
        state: "forgotten",
      });
    }
    const trashed = await f.save(fact("delete-trashed-value"));
    await f.act("trash", trashed);
    expect(await f.act("delete_now", trashed)).toMatchObject({ outcome: "forgotten" });
    expect(await f.purge.purgeExpired({ limit: 100 })).toMatchObject({ purged: 0 });
  });

  it("purge_is_idempotent", async () => {
    const f = await fixture();
    const a = await f.save(fact("idempotent-value"));
    await f.act("trash", a);
    f.advance(knowledgeTrashRetentionMs + 1);
    expect(await f.purge.purgeExpired({ limit: 100 })).toMatchObject({ purged: 1 });
    expect(await f.purge.purgeExpired({ limit: 100 })).toMatchObject({ purged: 0 });
    expect(
      await database.db
        .select()
        .from(knowledgeTombstones)
        .where(eq(knowledgeTombstones.recordId, a.id)),
    ).toHaveLength(1);
  });

  it("replay_after_trash_is_content_free", async () => {
    const f = await fixture();
    const ownerInput = fact("replay-owner-value");
    const agentInput = fact("replay-agent-value", {
      evidence: [{ type: "observation", reference: "Observed in a planning session." }],
    });
    const ownerSaved = await f.save(ownerInput);
    const agentReceipt = await f.records.create(f.agent, agentInput);
    await f.act("trash", ownerSaved);
    await f.act("trash", { id: agentReceipt.recordId, revision: 1 });

    const ownerReplay = await f.records.create(f.owner, ownerInput);
    expect(ownerReplay).toEqual({
      receiptId: expect.any(String),
      recordId: ownerSaved.id,
      outcome: "trashed",
    });
    const agentReplay = await f.records.create(f.agent, agentInput);
    expect(agentReplay).toEqual({
      receiptId: agentReceipt.receiptId,
      recordId: agentReceipt.recordId,
      outcome: "forgotten",
    });
    expect(JSON.stringify([ownerReplay, agentReplay])).not.toMatch(/replay-(owner|agent)-value/);

    f.advance(knowledgeTrashRetentionMs + 1);
    expect(await f.purge.purgeExpired({ limit: 100 })).toMatchObject({ purged: 2 });
    expect(await f.records.create(f.owner, ownerInput)).toEqual({
      receiptId: ownerReplay.receiptId,
      recordId: ownerSaved.id,
      outcome: "forgotten",
    });
    await expect(
      f.records.create(f.owner, { ...ownerInput, purposes: ["review"] }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("agent_cannot_trash_restore_or_delete_now", async () => {
    const f = await fixture();
    const a = await f.save(fact("agent-denied-value"));
    for (const action of ["trash", "restore", "delete_now"] as const)
      await expect(f.act(action, a, f.agent)).rejects.toMatchObject({ status: 403 });
    await f.act("trash", a);
    for (const action of ["restore", "delete_now"] as const)
      await expect(f.act(action, a, f.agent)).rejects.toMatchObject({ status: 403 });
    expect(
      (await f.search.search(f.owner, { ...planning, status: "trashed" })).items.map(
        ({ id }) => id,
      ),
    ).toEqual([a.id]);
  });
});
