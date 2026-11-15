import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  accessTokens,
  createDatabaseClient,
  type DatabaseClient,
  goals,
  knowledgeContextUses,
  knowledgeOwnerEpochs,
  knowledgeRecords,
  knowledgeRevisionMetadata,
  knowledgeRevisions,
  migrateDatabase,
  sessions,
  users,
} from "@personal-os/database";
import {
  type KnowledgeMutationInput,
  knowledgeContextExplanationSchema,
  knowledgeContextPackSchema,
  knowledgePageSchema,
  knowledgeQuerySchema,
  knowledgeReceiptSchema,
} from "@personal-os/domain";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { and, eq, sql } from "drizzle-orm";
import { hashToken } from "../security.js";
import type { Principal } from "../types.js";
import { createKnowledgeContextService } from "./context-service.js";
import { createKnowledgeExportService } from "./export-service.js";
import { createKnowledgeLifecycleService } from "./lifecycle-service.js";
import { createKnowledgeRecordService } from "./record-service.js";
import { createKnowledgeSearchService } from "./search-service.js";

const day = 24 * 60 * 60 * 1000;
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

describe("purpose-bound memory retrieval", () => {
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

  async function extendFixtureHistory(userId: string, recordId: string) {
    const [first] = await database.db
      .select({ snapshot: knowledgeRevisions.snapshot })
      .from(knowledgeRevisions)
      .where(eq(knowledgeRevisions.recordId, recordId));
    if (!first) throw new Error("Expected the original fixture revision.");
    await database.db.transaction(async (tx) => {
      await tx.insert(knowledgeRevisions).values(
        Array.from({ length: 101 }, (_, i) => ({
          userId: userId,
          recordId: recordId,
          revision: i + 2,
          snapshot: { ...first.snapshot, revision: i + 2 },
        })),
      );
      await tx
        .update(knowledgeRecords)
        .set({ revision: 102 })
        .where(eq(knowledgeRecords.id, recordId));
    });
  }

  async function fixture() {
    const userId = randomUUID();
    fixtureIds.push(userId);
    const sessionId = randomUUID();
    const scopes = ["knowledge:read", "knowledge:write", "goals:read", "tasks:read"] as const;
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
    async function newAgent(): Promise<Principal> {
      const actorId = randomUUID();
      await database.db.insert(accessTokens).values({
        id: actorId,
        userId,
        name: "Memory reader",
        tokenHash: hashToken(randomUUID()),
        scopes: [...scopes],
      });
      return { userId, actorId, actorType: "agent", scopes: new Set(scopes) };
    }
    const agent = await newAgent();
    let clock = Date.parse("2026-11-12T12:00:00Z");
    const config = {
      db: database.db,
      now: () => new Date(clock),
      encryptionKey: Buffer.alloc(32, 11).toString("base64"),
    };
    const records = createKnowledgeRecordService(config);
    const lifecycle = createKnowledgeLifecycleService(config);
    return {
      owner,
      agent,
      newAgent,
      lifecycle,
      records,
      search: createKnowledgeSearchService(config),
      context: createKnowledgeContextService(config),
      exporter: createKnowledgeExportService(config),
      advance: (ms: number) => {
        clock += ms;
      },
      async save(input: KnowledgeMutationInput, principal = owner) {
        return knowledgeReceiptSchema.parse(await records.create(principal, input)).record;
      },
    };
  }

  it("fresh_agent_discovers_relevant_corrected_memory", async () => {
    const f = await fixture();
    const foreign = await fixture();
    const meeting = (value: string) => ({
      kind: "fact" as const,
      value: {
        subject: "Team meeting",
        predicate: "Schedule",
        value: { type: "string" as const, value },
      },
    });
    const entry = await f.save(
      fact("unused", { content: meeting("weekly team meeting on Tuesdays") }),
    );
    const secondary = await f.save(fact("meeting preparation"));
    await f.save(
      fact("unused", {
        content: meeting("weekly weekly weekly team meeting private"),
        sensitivity: "sensitive",
      }),
    );
    await f.save(fact("weekly team meeting restricted", { purposes: ["review"] }));
    await f.save(fact("weekly team meeting finance", { scope: { workspace: "finances" } }));
    const otherOwner = await foreign.save(fact("weekly team meeting another owner"));
    await f.lifecycle.mutate(f.owner, {
      action: "revise",
      recordId: entry.id,
      expectedRevision: 1,
      mutationKey: randomUUID(),
      content: meeting("weekly team meeting on Thursdays"),
    });
    const fresh = await f.newAgent();
    const page = knowledgePageSchema.parse(
      await f.search.search(fresh, {
        ...planning,
        text: "meetings",
        limit: 2,
      }),
    );
    expect(page.items.map(({ id, revision }) => ({ id, revision }))).toEqual(
      expect.arrayContaining([
        { id: entry.id, revision: 2 },
        { id: secondary.id, revision: 1 },
      ]),
    );
    expect(page.nextCursor).toBeNull();
    expect(page.state).toBe("available");
    expect(page.items.find(({ id }) => id === entry.id)?.conflictRecordIds).toEqual([]);
    expect(JSON.stringify(page)).toContain("Thursdays");
    expect(JSON.stringify(page)).not.toMatch(/Tuesdays|private|restricted|finance|another owner/);
    const history = await f.search.history(f.owner, { ...planning, recordId: entry.id });
    expect(history.items.map((record) => record.revision)).toEqual([2, 1]);
    expect(JSON.stringify(history)).toContain("Tuesdays");
    await expect(
      f.search.search(fresh, { ...planning, entityRefs: [otherOwner.id] }),
    ).rejects.toMatchObject({ status: 404 });
    expect(
      (await f.search.search(fresh, { ...planning, entityRefs: [entry.id] })).items.map(
        (record) => record.id,
      ),
    ).toEqual([entry.id]);
  });

  it("old_context_cannot_resurrect_forgotten_value", async () => {
    const f = await fixture();
    const forgotten = await f.save(fact("secret-river-fixture"));
    const restricted = await f.save(fact("restricted-river-fixture"));
    const context = await f.context.context(f.agent, { ...planning, text: "river" });
    const next = await f.context.context(f.agent, { ...planning, text: "river", limit: 1 });
    if (!next.nextCursor) throw new Error("Expected a context cursor.");
    const explain = { contextUseId: context.contextUseId };
    const receipt = await database.db
      .select()
      .from(knowledgeContextUses)
      .where(eq(knowledgeContextUses.id, context.contextUseId));
    expect(receipt).toHaveLength(1);
    expect(JSON.stringify(receipt)).not.toMatch(/secret-river|restricted-river|"river"/);
    expect(
      knowledgeContextExplanationSchema.parse(await f.context.explain(f.agent, explain)),
    ).toMatchObject({
      state: "available",
      references: expect.arrayContaining([
        expect.objectContaining({ recordId: forgotten.id, revision: 1 }),
      ]),
    });
    expect(await f.context.explain(await f.newAgent(), explain)).toMatchObject({
      state: "unavailable",
    });
    await f.lifecycle.mutate(f.owner, {
      action: "restrict",
      recordId: restricted.id,
      expectedRevision: 1,
      mutationKey: randomUUID(),
      restrictions: { purposes: ["review"] },
    });
    await expect(
      f.context.context(f.agent, { ...planning, text: "river", limit: 1, cursor: next.nextCursor }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      f.search.history(f.agent, { ...planning, recordId: restricted.id }),
    ).rejects.toMatchObject({ status: 403 });
    const deleted = await f.lifecycle.mutate(f.owner, {
      action: "delete_now",
      recordId: forgotten.id,
      expectedRevision: 1,
      mutationKey: randomUUID(),
    });
    expect(deleted.outcome).toBe("forgotten");
    expect(await f.context.explain(f.agent, explain)).toMatchObject({ state: "unavailable" });
    await expect(
      f.search.history(f.owner, { ...planning, recordId: forgotten.id }),
    ).rejects.toMatchObject({ status: 404 });
    expect(JSON.stringify(await f.exporter.exportPage(f.owner, {}))).not.toContain(
      "secret-river-fixture",
    );
  });

  it("bounded_context_is_honest", async () => {
    const f = await fixture();
    const large = Array.from({ length: 7 }, (_, i) =>
      fact("unused", {
        content: {
          kind: "fact",
          value: {
            subject: `large fixture ${i}`,
            predicate: "planning detail",
            value: { type: "string", value: "🙂".repeat(1000) },
          },
        },
        evidence: [{ type: "statement", wording: "🙂".repeat(700) }],
      }),
    );
    const ids: string[] = [];
    for (const input of large) ids.push((await f.save(input)).id);
    const page = knowledgeContextPackSchema.parse(
      await f.context.context(f.agent, { ...planning, limit: 50 }),
    );
    expect(Buffer.byteLength(JSON.stringify(page), "utf8")).toBeLessThanOrEqual(32_768);
    expect(page.stated).toHaveLength(4);
    expect(page.stated.map(({ id }) => id)).toEqual(ids.sort().slice(0, 4));
    expect(page.truncated).toBe(true);
    expect(page.nextFetchRefs).toEqual([{ recordId: ids[4], revision: 1 }]);
    if (!page.nextCursor) throw new Error("Expected a byte-limited continuation.");
    expect(
      (
        await f.context.context(f.agent, { ...planning, limit: 50, cursor: page.nextCursor })
      ).stated.map(({ id }) => id),
    ).toEqual(ids.slice(4));

    const expired = await f.save(
      fact("obsolete", {
        validity: { validFrom: null, validUntil: "2026-11-11T00:00:00Z" },
      }),
    );
    const disputed = await f.save(fact("contested"));
    await f.lifecycle.mutate(f.owner, {
      action: "dispute",
      recordId: disputed.id,
      expectedRevision: 1,
      mutationKey: randomUUID(),
    });
    const proposed = await f.save(fact("concise", { evidence: [] }), f.agent);
    f.advance(91 * day);
    const inactive = await f.context.context(f.agent, {
      ...planning,
      text: "obsolete OR contested OR concise",
    });
    expect([...inactive.stated, ...inactive.inferred]).toEqual([]);
    expect(inactive.tentative.map(({ id }) => id).sort()).toEqual([expired.id, proposed.id].sort());
    expect(inactive.conflicts.map(({ id }) => id)).toEqual([disputed.id]);
    expect(inactive.missingInputs).toContain("no_current_memory");
    const search = { ...planning, text: "obsolete OR contested OR concise", limit: 1 } as const;
    expect((await f.search.search(f.owner, { ...search, reviewView: "accepted" })).items).toEqual(
      [],
    );
    const review = { ...search, reviewView: "needs_review" } as const;
    const firstReview = await f.search.search(f.owner, review);
    if (!firstReview.nextCursor) throw new Error("Expected another review candidate");
    const secondReview = await f.search.search(f.owner, {
      ...review,
      cursor: firstReview.nextCursor,
    });
    expect([...firstReview.items, ...secondReview.items].map(({ id }) => id).sort()).toEqual(
      [disputed.id, proposed.id].sort(),
    );
    await expect(
      f.search.search(f.owner, {
        ...search,
        reviewView: "accepted",
        cursor: firstReview.nextCursor,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(knowledgeQuerySchema.safeParse({ ...planning, limit: 51 }).success).toBe(false);
  });

  it("paginates more than 50 records without skipping any at the envelope limits", async () => {
    const f = await fixture();
    for (let i = 0; i < 51; i++) {
      await f.save(fact("Small memory", { evidence: [] }));
    }
    const first = await f.context.context(f.agent, { ...planning, limit: 50 });
    expect(first.stated.length).toBeLessThanOrEqual(50);
    expect(first.truncated).toBe(true);
    if (!first.nextCursor) throw new Error("Expected continuation at the envelope limit.");
    const next = await f.context.context(f.agent, {
      ...planning,
      limit: 50,
      cursor: first.nextCursor,
    });
    expect(new Set([...first.stated, ...next.stated].map(({ id }) => id)).size).toBe(51);
    expect(first.nextFetchRefs).toEqual([{ recordId: next.stated[0]?.id, revision: 1 }]);
    expect(next.truncated).toBe(false);
  }, 60_000);

  it("binds cursors to current actor, authority, filters and 15-minute lifetime", async () => {
    const f = await fixture();
    await f.save(fact("agenda planning"));
    await f.save(fact("agenda agenda agenda", { scope: { workspace: "tasks" } }));
    const query = { ...planning, text: "agenda", limit: 1 };
    const first = await f.search.search(f.agent, query);
    expect(first.items[0]?.scope.workspace).toBe("tasks");
    if (!first.nextCursor) throw new Error("Expected search continuation.");
    const next = { ...query, cursor: first.nextCursor };
    expect((await f.search.search(f.agent, next)).items[0]?.scope.workspace).toBeNull();
    expect(first.nextCursor).not.toContain(f.agent.actorId);
    await expect(f.search.search(await f.newAgent(), next)).rejects.toMatchObject({ status: 409 });
    await expect(f.search.search(f.agent, { ...next, purpose: "review" })).rejects.toMatchObject({
      status: 409,
    });
    await expect(f.search.search(f.agent, { ...next, text: "planning" })).rejects.toMatchObject({
      status: 409,
    });
    await expect(
      f.search.search(f.agent, { ...next, cursor: `${next.cursor.slice(0, -6)}zzzzzz` }),
    ).rejects.toMatchObject({ status: 409 });
    await database.db
      .update(accessTokens)
      .set({ scopes: ["knowledge:read", "knowledge:write"] })
      .where(eq(accessTokens.id, f.agent.actorId));
    const [epoch] = await database.db
      .select()
      .from(knowledgeOwnerEpochs)
      .where(eq(knowledgeOwnerEpochs.userId, f.owner.userId));
    expect(epoch?.epoch).toBe(first.epoch);
    await expect(f.search.search(f.agent, next)).rejects.toMatchObject({ status: 409 });
    const narrowed = await f.search.search(f.agent, query);
    expect(narrowed.items).toHaveLength(1);
    expect(narrowed.nextCursor).toBeNull();
    await f.save(fact("second global agenda"));
    const fresh = await f.search.search(f.agent, query);
    if (!fresh.nextCursor) throw new Error("Expected renewed cursor.");
    f.advance(15 * 60 * 1000);
    await expect(
      f.search.search(f.agent, { ...query, cursor: fresh.nextCursor }),
    ).rejects.toMatchObject({ status: 409 });
    expect(knowledgeQuerySchema.safeParse({ ...planning, text: "x".repeat(501) }).success).toBe(
      false,
    );
    expect(
      knowledgeQuerySchema.safeParse({ ...planning, freeFormPurpose: "planning" }).success,
    ).toBe(false);
  });

  it("distinguishes missing eligible evidence from empty search without returning its body", async () => {
    const f = await fixture();
    const empty = await f.search.search(f.agent, planning);
    expect(empty).toMatchObject({ items: [], state: "available" });
    const goalId = randomUUID();
    await database.db
      .insert(goals)
      .values({ id: goalId, userId: f.owner.userId, title: "Fixture goal" });
    await f.save(fact("unused", { content: { kind: "goal", value: { goalId } } }));
    const initial = await f.context.context(f.agent, planning);
    expect(initial.stated).toHaveLength(1);
    await database.db.delete(goals).where(eq(goals.id, goalId));
    const search = await f.search.search(f.agent, planning);
    expect(search).toMatchObject({ items: [], state: "unavailable" });
    expect(JSON.stringify(search)).not.toContain(goalId);
    expect(await f.context.context(f.agent, planning)).toMatchObject({
      stated: [],
      missingInputs: expect.arrayContaining(["source_unavailable", "no_current_memory"]),
    });
    expect(await f.context.explain(f.agent, { contextUseId: initial.contextUseId })).toMatchObject({
      state: "unavailable",
    });
    await database.db
      .update(accessTokens)
      .set({ scopes: ["knowledge:read"] })
      .where(eq(accessTokens.id, f.agent.actorId));
    expect(await f.search.search(f.agent, planning)).toMatchObject({
      items: [],
      state: "available",
    });
  });

  it("does not let a derived value outlive or broaden its supporting claim", async () => {
    const f = await fixture();
    const source = await f.save(
      fact("meeting source", {
        validity: { validFrom: null, validUntil: "2026-11-13T12:00:00.000Z" },
      }),
    );
    const evidence = {
      type: "domain_record" as const,
      domain: "knowledge" as const,
      id: source.id,
      revision: 1,
    };
    const child = await f.save(fact("derived orchard", { evidence: [evidence] }));
    const independent = await f.save(
      fact("independent orchard", {
        evidence: [
          { type: "statement", wording: "The owner stated this independently." },
          evidence,
        ],
      }),
    );
    const query = { ...planning, text: "orchard" };
    expect((await f.search.search(f.agent, query)).items.map(({ id }) => id).sort()).toEqual(
      [child.id, independent.id].sort(),
    );
    f.advance(day);
    const expiredSupport = await f.search.search(f.agent, query);
    expect(expiredSupport.state).toBe("partial");
    expect(expiredSupport.items.map(({ id }) => id)).toEqual([independent.id]);
    expect(expiredSupport.items[0]?.sources).toEqual([
      expect.objectContaining({ classification: "owner_statement" }),
      expect.objectContaining({ classification: "domain_record", availability: "unavailable" }),
    ]);
    await f.lifecycle.mutate(f.owner, {
      action: "restrict",
      recordId: source.id,
      expectedRevision: 1,
      mutationKey: randomUUID(),
      restrictions: { purposes: ["review"] },
    });
    expect(await f.search.search(f.agent, query)).toMatchObject({ state: "available", items: [] });
    expect(await f.context.context(f.owner, query)).toMatchObject({
      stated: [],
      missingInputs: ["no_current_memory"],
    });
  });

  it("prefers an exact owned entity match over a related record on a relevance tie", async () => {
    const f = await fixture();
    const target = await f.save(fact("orchard decision"));
    f.advance(1000);
    const related = await f.save(fact("orchard decision", { relatedRecordIds: [target.id] }));
    const result = await f.search.search(f.agent, {
      ...planning,
      text: "orchard",
      entityRefs: [target.id],
    });
    expect(result.items.map(({ id }) => id)).toEqual([target.id, related.id]);
  });

  it("returns a fetch reference for an individually oversized record and continues at the next one", async () => {
    const f = await fixture();
    const oversized = await f.save(
      fact("orchard orchard orchard", {
        evidence: Array.from({ length: 20 }, () => ({
          type: "statement",
          wording: "a".repeat(2048),
        })),
      }),
    );
    const small = await f.save(fact("orchard"));
    const query = { ...planning, text: "orchard" };
    const first = await f.context.context(f.agent, query);
    expect(first).toMatchObject({
      stated: [],
      truncated: true,
      nextFetchRefs: [{ recordId: oversized.id, revision: 1 }],
    });
    expect(Buffer.byteLength(JSON.stringify(first), "utf8")).toBeLessThanOrEqual(32_768);
    if (!first.nextCursor) throw new Error("Expected continuation after the oversized record.");
    const next = await f.context.context(f.agent, { ...query, cursor: first.nextCursor });
    expect(next).toMatchObject({
      stated: [expect.objectContaining({ id: small.id })],
      truncated: false,
    });
  });

  it("retains the inferred origin of a tentative context reference", async () => {
    const f = await fixture();
    const record = await f.save(fact("tentative orchard", { evidence: [] }), f.agent);
    const pack = await f.context.context(f.agent, planning);
    expect(pack.tentative.map(({ id }) => id)).toEqual([record.id]);
    expect(
      knowledgeContextExplanationSchema.parse(
        await f.context.explain(f.agent, {
          contextUseId: pack.contextUseId,
        }),
      ),
    ).toMatchObject({
      state: "available",
      references: [{ recordId: record.id, reason: "tentative", origin: "inferred" }],
    });
  });

  it("redacts a restricted ordinary link and still withholds a true copy", async () => {
    const f = await fixture();
    const source = await f.save(fact("source fixture"));
    const ordinary = await f.save(fact("independent orchard", { relatedRecordIds: [source.id] }));
    await f.lifecycle.mutate(f.owner, {
      action: "revise",
      recordId: ordinary.id,
      expectedRevision: 1,
      mutationKey: randomUUID(),
      content: ordinary.content,
    });
    // Earlier sidecars inherited ordinary links along with actual sources.
    await database.db
      .update(knowledgeRevisionMetadata)
      .set({
        metadata: sql`jsonb_set(${knowledgeRevisionMetadata.metadata}, '{inheritedRecordIds}', ${JSON.stringify([source.id])}::jsonb)`,
      })
      .where(
        and(
          eq(knowledgeRevisionMetadata.recordId, ordinary.id),
          eq(knowledgeRevisionMetadata.revision, 2),
        ),
      );
    const copy = await f.save(
      fact("copied orchard", {
        evidence: [
          { type: "statement", wording: "Owner stated the copy." },
          {
            type: "domain_record",
            domain: "knowledge",
            id: source.id,
            revision: 1,
          },
        ],
        relatedRecordIds: [source.id],
      }),
    );
    await f.lifecycle.mutate(f.owner, {
      action: "restrict",
      recordId: source.id,
      expectedRevision: 1,
      mutationKey: randomUUID(),
      restrictions: { purposes: ["review"] },
    });
    for (const principal of [f.agent, f.owner]) {
      const page = await f.search.search(principal, { ...planning, text: "orchard" });
      expect(page.items.map(({ id, relatedRecordIds }) => ({ id, relatedRecordIds }))).toEqual([
        { id: ordinary.id, relatedRecordIds: [] },
      ]);
      expect(await f.records.get(principal, { ...planning, id: ordinary.id })).toMatchObject({
        id: ordinary.id,
        relatedRecordIds: [],
      });
      await expect(f.records.get(principal, { ...planning, id: copy.id })).rejects.toMatchObject({
        status: 403,
      });
      expect(
        (await f.search.history(principal, { ...planning, recordId: ordinary.id })).items,
      ).toMatchObject([
        { id: ordinary.id, revision: 2, relatedRecordIds: [] },
        { id: ordinary.id, revision: 1, relatedRecordIds: [] },
      ]);
      await expect(
        f.search.history(principal, { ...planning, recordId: copy.id }),
      ).rejects.toMatchObject({ status: 403 });
    }
  });

  it("redacts an ordinary goal link for a reader without goal scope", async () => {
    const f = await fixture();
    const goalId = randomUUID();
    await database.db
      .insert(goals)
      .values({ id: goalId, userId: f.owner.userId, title: "Fixture goal" });
    const goal = await f.save(fact("unused", { content: { kind: "goal", value: { goalId } } }));
    const linked = await f.save(fact("independent orchard", { relatedRecordIds: [goal.id] }));
    expect(await f.records.get(f.agent, { ...planning, id: linked.id })).toMatchObject({
      relatedRecordIds: [goal.id],
    });
    await database.db
      .update(accessTokens)
      .set({ scopes: ["knowledge:read"] })
      .where(eq(accessTokens.id, f.agent.actorId));
    expect(await f.records.get(f.agent, { ...planning, id: linked.id })).toMatchObject({
      id: linked.id,
      relatedRecordIds: [],
    });
    expect((await f.search.search(f.agent, { ...planning, text: "orchard" })).items).toMatchObject([
      { id: linked.id, relatedRecordIds: [] },
    ]);
  });

  it("ranks current exact matches above expired matches with extra links", async () => {
    const f = await fixture();
    const goalId = randomUUID();
    await database.db
      .insert(goals)
      .values({ id: goalId, userId: f.owner.userId, title: "Fixture goal" });
    const link = await f.save(fact("additional detail"));
    const active = await f.save(
      fact("unused", {
        content: { kind: "goal", value: { goalId } },
      }),
    );
    const expired = await f.save(
      fact("unused", {
        content: { kind: "goal", value: { goalId } },
        relatedRecordIds: [link.id],
        validity: { validFrom: null, validUntil: "2026-11-11T00:00:00.000Z" },
      }),
    );
    const page = await f.search.search(f.agent, { ...planning, entityRefs: [goalId, link.id] });
    const ids = page.items.map(({ id }) => id);
    expect(ids).toEqual(expect.arrayContaining([active.id, expired.id, link.id]));
    expect(ids.indexOf(active.id)).toBeLessThan(ids.indexOf(expired.id));
  });

  it("continues history and export without reprojecting previously disclosed revisions", async () => {
    const f = await fixture();
    const record = await f.save(fact("first revision"));
    for (let expectedRevision = 1; expectedRevision <= 51; expectedRevision++) {
      await f.lifecycle.mutate(f.owner, {
        action: "revise",
        recordId: record.id,
        expectedRevision,
        mutationKey: randomUUID(),
        content: fact(`revision ${expectedRevision + 1}`).content,
      });
    }
    const historyInput = { ...planning, recordId: record.id };
    const history = await f.search.history(f.owner, historyInput);
    const exported = await f.exporter.exportPage(f.owner, {});
    expect(history.items.map(({ revision }) => revision)).toEqual(
      Array.from({ length: 50 }, (_, i) => 52 - i),
    );
    expect(exported.items.map(({ revision }) => revision)).toEqual(
      history.items.map(({ revision }) => revision),
    );
    if (!history.nextCursor || !exported.nextCursor)
      throw new Error("Expected both continuations.");
    // A prior non-current row with an invalid body must never be projected again.
    await database.db
      .update(knowledgeRevisions)
      .set({ snapshot: sql`jsonb_set(${knowledgeRevisions.snapshot}, '{content}', 'null')` })
      .where(and(eq(knowledgeRevisions.recordId, record.id), eq(knowledgeRevisions.revision, 10)));
    const nextHistory = await f.search.history(f.owner, {
      ...historyInput,
      cursor: history.nextCursor,
    });
    const nextExport = await f.exporter.exportPage(f.owner, { cursor: exported.nextCursor });
    expect(nextHistory.items.map(({ revision }) => revision)).toEqual([2, 1]);
    expect(nextExport.items.map(({ revision }) => revision)).toEqual([2, 1]);
    expect(nextHistory.nextCursor).toBeNull();
    expect(nextExport.nextCursor).toBeNull();
  });

  it("persists and explains a context receipt with an epoch greater than a 32-bit integer", async () => {
    const f = await fixture();
    const record = await f.save(fact("wide epoch"));
    await database.db
      .update(knowledgeOwnerEpochs)
      .set({ epoch: 2_147_483_648 })
      .where(eq(knowledgeOwnerEpochs.userId, f.owner.userId));
    const pack = await f.context.context(f.agent, planning);
    expect(pack.epoch).toBe(2_147_483_648);
    expect(await f.context.explain(f.agent, { contextUseId: pack.contextUseId })).toMatchObject({
      state: "available",
      references: [{ recordId: record.id }],
    });
  });

  it("does not expose a continuation for more than 100 denied export revisions", async () => {
    const f = await fixture();
    const source = await f.save(
      fact("available source", {
        purposes: ["planning", "review", "recovery"],
      }),
    );
    const copy = await f.save(
      fact("denied copy fixture", {
        evidence: [{ type: "domain_record", domain: "knowledge", id: source.id, revision: 1 }],
      }),
    );
    await extendFixtureHistory(f.owner.userId, copy.id);
    await f.lifecycle.mutate(f.owner, {
      action: "restrict",
      recordId: source.id,
      expectedRevision: 1,
      mutationKey: randomUUID(),
      restrictions: { purposes: ["recovery"] },
    });
    const page = await f.exporter.exportPage(f.owner, {});
    expect(page.nextCursor).toBeNull();
    expect(page.state).toBe("available");
    expect(page.items.map(({ id, revision }) => ({ id, revision }))).toEqual([
      { id: source.id, revision: 2 },
      { id: source.id, revision: 1 },
    ]);
    expect(JSON.stringify(page)).not.toContain("denied copy fixture");
  });

  it("exports permitted history despite more than 100 distinct denied records", async () => {
    const f = await fixture();
    const source = await f.save(
      fact("recovery source", {
        purposes: ["planning", "review", "recovery"],
      }),
    );
    const seed = await f.save(
      fact("denied copy fixture", {
        evidence: [{ type: "domain_record", domain: "knowledge", id: source.id, revision: 1 }],
      }),
    );
    const [revision] = await database.db
      .select({ snapshot: knowledgeRevisions.snapshot })
      .from(knowledgeRevisions)
      .where(eq(knowledgeRevisions.recordId, seed.id));
    if (!revision) throw new Error("Expected the original copy revision.");

    await f.lifecycle.mutate(f.owner, {
      action: "restrict",
      recordId: source.id,
      expectedRevision: 1,
      mutationKey: randomUUID(),
      restrictions: { purposes: ["recovery"] },
    });
    const baseline = await f.exporter.exportPage(f.owner, {});
    expect(baseline.items.map(({ id, revision }) => ({ id, revision }))).toEqual([
      { id: source.id, revision: 2 },
      { id: source.id, revision: 1 },
    ]);
    const ids = Array.from({ length: 101 }, () => randomUUID());
    await database.db.transaction(async (tx) => {
      await tx.insert(knowledgeRecords).values(ids.map((id) => ({ id, userId: f.owner.userId })));
      await tx.insert(knowledgeRevisions).values(
        ids.map((recordId) => ({
          userId: f.owner.userId,
          recordId,
          revision: 1,
          snapshot: { ...revision.snapshot, id: recordId },
        })),
      );
    });

    expect(await f.exporter.exportPage(f.owner, {})).toEqual(baseline);
    expect(baseline.nextCursor).toBeNull();
    expect(baseline.state).toBe("available");
  });

  it("reports unavailable when a bounded history scan cannot verify completion", async () => {
    const f = await fixture();
    const goalId = randomUUID();
    await database.db
      .insert(goals)
      .values({ id: goalId, userId: f.owner.userId, title: "Retired goal" });
    const record = await f.save(fact("unused", { content: { kind: "goal", value: { goalId } } }));
    await extendFixtureHistory(f.owner.userId, record.id);
    await f.lifecycle.mutate(f.owner, {
      action: "revise",
      recordId: record.id,
      expectedRevision: 102,
      mutationKey: randomUUID(),
      content: fact("current independent detail").content,
    });
    await database.db.delete(goals).where(eq(goals.id, goalId));

    await expect(f.exporter.exportPage(f.owner, {})).rejects.toMatchObject({
      code: "service_unavailable",
      status: 503,
    });
    await expect(
      f.search.history(f.owner, { ...planning, recordId: record.id }),
    ).rejects.toMatchObject({
      code: "service_unavailable",
      status: 503,
    });
  });

  it("exports owner-only pages including permitted history and invalidates them after an epoch change", async () => {
    const f = await fixture();
    const entry = await f.save(fact("earlier export wording", { sensitivity: "sensitive" }));
    await f.lifecycle.mutate(f.owner, {
      action: "revise",
      recordId: entry.id,
      expectedRevision: 1,
      mutationKey: randomUUID(),
      content: fact("corrected export wording").content,
    });
    for (let i = 0; i < 49; i++) {
      await f.save(
        fact("export filler", {
          content: {
            kind: "fact",
            value: {
              subject: `Export ${i}`,
              predicate: "detail",
              value: { type: "integer", value: i },
            },
          },
        }),
      );
    }
    await expect(f.exporter.exportPage(f.agent, {})).rejects.toMatchObject({ status: 403 });
    await expect(
      f.exporter.exportPage({ ...f.owner, sessionId: randomUUID() }, {}),
    ).rejects.toMatchObject({ status: 403 });
    const first = await f.exporter.exportPage(f.owner, {});
    expect(first).toMatchObject({ schemaVersion: 1, state: "available" });
    expect(first.items).toHaveLength(50);
    if (!first.nextCursor) throw new Error("Expected export cursor.");
    const second = await f.exporter.exportPage(f.owner, { cursor: first.nextCursor });
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    const exported = [...first.items, ...second.items].filter(({ id }) => id === entry.id);
    expect(exported.map(({ revision }) => revision)).toEqual([2, 1]);
    expect(JSON.stringify(exported)).toMatch(/owner_statement/);
    expect(JSON.stringify(exported)).toContain("earlier export wording");
    await f.save(fact("later export"));
    await expect(
      f.exporter.exportPage(f.owner, { cursor: first.nextCursor }),
    ).rejects.toMatchObject({ status: 409 });
  });
});
