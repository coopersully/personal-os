import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  accessTokens,
  auditEvents,
  createDatabaseClient,
  type DatabaseClient,
  goals,
  knowledgeReceipts,
  knowledgeRecords,
  knowledgeRelationships,
  knowledgeRevisions,
  knowledgeSources,
  migrateDatabase,
  users,
} from "@personal-os/database";
import {
  type AccessScope,
  type KnowledgeMutationInput,
  knowledgeMutationInputSchema,
} from "@personal-os/domain";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import { hashToken } from "../security.js";
import type { Principal } from "../types.js";
import { createKnowledgeRecordService } from "./record-service.js";

describe.sequential("persistent scoped knowledge", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  const now = () => new Date("2026-10-25T12:00:00Z");
  const service = () => createKnowledgeRecordService({ db: database.db, now });
  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
  }, 120_000);
  afterAll(async () => {
    await database?.close();
    await container?.stop();
  });
  beforeEach(async () => {
    await database.db.delete(users);
  });
  async function fixture(scopes: AccessScope[] = ["knowledge:read", "knowledge:write"]) {
    const userId = randomUUID(),
      actorId = randomUUID(),
      token = randomUUID();
    await database.db.insert(users).values({
      id: userId,
      email: `${userId}@example.test`,
      displayName: "Owner",
      passwordHash: "unused",
    });
    await database.db.insert(accessTokens).values({
      id: actorId,
      userId,
      name: "Knowledge caller",
      tokenHash: hashToken(token),
      scopes,
    });
    const human: Principal = { userId, actorId: userId, actorType: "user", scopes: new Set() };
    const agent: Principal = { userId, actorId, actorType: "agent", scopes: new Set(scopes) };
    return { human, agent, token };
  }
  const input = (overrides: Partial<KnowledgeMutationInput> = {}): KnowledgeMutationInput => ({
    mutationKey: randomUUID(),
    content: {
      kind: "fact",
      value: {
        subject: "owner",
        predicate: "preferred day",
        value: { type: "string", value: "Tuesday" },
      },
    },
    scope: { workspace: null },
    sensitivity: "standard",
    purposes: ["planning"],
    evidence: [{ type: "statement", wording: "I prefer Tuesday." }],
    relatedRecordIds: [],
    ...overrides,
  });
  const persistedKnowledge = () =>
    Promise.all([
      database.db.select().from(knowledgeRecords),
      database.db.select().from(knowledgeRevisions),
      database.db.select().from(knowledgeSources),
      database.db.select().from(knowledgeRelationships),
      database.db.select().from(knowledgeReceipts),
      database.db.select().from(auditEvents),
    ]);
  it("rechecks credential expiry for a cached principal before reads and exact retries", async () => {
    const f = await fixture();
    const request = input({ evidence: [] });
    await database.db
      .update(accessTokens)
      .set({ expiresAt: new Date(now().getTime() + 60_000) })
      .where(eq(accessTokens.id, f.agent.actorId));
    const saved = await service().create(f.agent, request);
    expect(await service().get(f.agent, { id: saved.record.id, purpose: "planning" })).toEqual(
      saved.record,
    );
    expect(await service().create(f.agent, request)).toEqual(saved);
    const before = await persistedKnowledge();

    await database.db
      .update(accessTokens)
      .set({ expiresAt: now() })
      .where(eq(accessTokens.id, f.agent.actorId));
    await expect(
      service().get(f.agent, { id: saved.record.id, purpose: "planning" }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(service().create(f.agent, request)).rejects.toMatchObject({ status: 403 });
    expect(await persistedKnowledge()).toEqual(before);
  });
  it("rejects duplicate related IDs before persisting any knowledge or audit changes", async () => {
    const f = await fixture();
    const related = await service().create(f.human, input());
    const before = await persistedKnowledge();

    await expect(
      service().create(
        f.human,
        input({ relatedRecordIds: [related.record.id, related.record.id] }),
      ),
    ).rejects.toMatchObject({
      issues: [
        {
          path: ["relatedRecordIds"],
          message: "Relationships must be unique.",
        },
      ],
    });
    expect(await persistedKnowledge()).toEqual(before);
  });
  it("records_user_fact_and_rejects_forged_source", async () => {
    const f = await fixture(),
      request = input();
    const saved = await service().create(f.human, request);
    expect(saved.record.status).toBe("active");
    expect(saved.record.sources[0]?.classification).toBe("owner_statement");
    expect((await service().create(f.human, request)).receiptId).toBe(saved.receiptId);
    expect(await service().get(f.human, { id: saved.record.id, purpose: "planning" })).toEqual(
      saved.record,
    );
    const other = await fixture();
    await expect(
      service().get(other.human, { id: saved.record.id, purpose: "planning" }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      service().create(
        f.human,
        input({ evidence: [{ type: "signed_inbound_message", id: randomUUID() }] }),
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(await database.db.select().from(knowledgeRevisions)).toHaveLength(1);
    expect(await database.db.select().from(knowledgeSources)).toHaveLength(1);
    const audits = await database.db.select().from(auditEvents);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: "knowledge.created",
      actorId: f.human.actorId,
      entityId: saved.record.id,
      after: { receiptId: saved.receiptId, revision: 1 },
    });
    expect(JSON.stringify(audits)).not.toContain("Tuesday");
  });
  it("deduplicates concurrent retries and conflicts on changed payload", async () => {
    const f = await fixture(),
      request = input();
    const receipts = await Promise.all(
      Array.from({ length: 4 }, () => service().create(f.human, request)),
    );
    expect(new Set(receipts.map((receipt) => receipt.receiptId)).size).toBe(1);
    expect(await database.db.select().from(knowledgeRecords)).toHaveLength(1);
    await expect(
      service().create(f.human, { ...request, purposes: ["review"] }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("keeps agent interpretations proposed and external statements explicitly attributed", async () => {
    const f = await fixture();
    const inferred = await service().create(f.agent, input({ evidence: [] }));
    expect(inferred.record).toMatchObject({
      content: { kind: "inference" },
      status: "proposed",
      confidence: 0,
    });
    const stated = await service().create(
      f.agent,
      input({
        evidence: [
          {
            type: "statement",
            wording: "I prefer Tuesday.",
            sessionRef: "host/session-1",
            messageRef: "message-1",
          },
        ],
      }),
    );
    expect(stated.record).toMatchObject({
      status: "active",
      sources: [{ classification: "agent_recorded_statement", actorId: f.agent.actorId }],
    });
    await expect(service().create(f.agent, input())).rejects.toMatchObject({ status: 400 });
    await expect(
      service().create(
        f.agent,
        input({
          evidence: [{ type: "statement", wording: "yes", sessionRef: "s", messageRef: "m" }],
          sensitivity: "sensitive",
        }),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
  it.each<AccessScope[]>([
    ["knowledge:read"],
    ["knowledge:write"],
    ["tasks:write"],
  ])("does not expand existing grants (%j)", async (...scopes) => {
    const f = await fixture(scopes);
    await expect(service().create(f.agent, input({ evidence: [] }))).rejects.toMatchObject({
      status: 403,
    });
  });
  it("checks purpose, workspace, live scope narrowing and revoked credentials before retries", async () => {
    const f = await fixture(["knowledge:read", "knowledge:write", "finances:read"]),
      request = input({ scope: { workspace: "finances" }, evidence: [] });
    const saved = await service().create(f.agent, request);
    await expect(
      service().get(f.agent, { id: saved.record.id, purpose: "communication" }),
    ).rejects.toMatchObject({ status: 403 });
    await database.db
      .update(accessTokens)
      .set({ scopes: ["knowledge:read", "knowledge:write"] })
      .where(eq(accessTokens.id, f.agent.actorId));
    await expect(
      service().get(f.agent, { id: saved.record.id, purpose: "planning" }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(service().create(f.agent, request)).rejects.toMatchObject({ status: 403 });
    await database.db
      .update(accessTokens)
      .set({ revokedAt: now() })
      .where(eq(accessTokens.id, f.agent.actorId));
    await expect(
      service().get(f.agent, { id: saved.record.id, purpose: "planning" }),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("rejects cross-owner relations and stale or inaccessible source revisions", async () => {
    const f = await fixture(),
      other = await fixture();
    const own = await service().create(f.human, input()),
      foreign = await service().create(other.human, input());
    await expect(
      service().create(f.human, input({ relatedRecordIds: [foreign.record.id] })),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      service().create(
        f.human,
        input({
          evidence: [
            { type: "domain_record", domain: "knowledge", id: own.record.id, revision: 2 },
          ],
        }),
      ),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      service().create(
        f.human,
        input({
          evidence: [
            { type: "domain_record", domain: "knowledge", id: foreign.record.id, revision: 1 },
          ],
        }),
      ),
    ).rejects.toMatchObject({ status: 404 });
    const linked = await service().create(f.human, input({ relatedRecordIds: [own.record.id] }));
    expect(linked.record.relatedRecordIds).toEqual([own.record.id]);
    expect(await database.db.select().from(knowledgeRelationships)).toHaveLength(1);
  });
  it("preserves source disclosure on derived knowledge and rechecks inherited scopes", async () => {
    const f = await fixture(["knowledge:read", "knowledge:write", "finances:read"]);
    const source = await service().create(
      f.human,
      input({ scope: { workspace: "finances" }, purposes: ["planning"] }),
    );
    await expect(
      service().create(f.human, input({ relatedRecordIds: [source.record.id] })),
    ).rejects.toMatchObject({ status: 403 });
    const derived = await service().create(
      f.agent,
      input({
        scope: { workspace: "finances" },
        relatedRecordIds: [source.record.id],
        evidence: [],
      }),
    );
    expect(derived.record.requiredReadScopes).toContain("finances:read");
    await database.db
      .update(accessTokens)
      .set({ scopes: ["knowledge:read", "knowledge:write"] })
      .where(eq(accessTokens.id, f.agent.actorId));
    await expect(
      service().get(f.agent, { id: derived.record.id, purpose: "planning" }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service().create(
        f.human,
        input({
          scope: { workspace: "finances" },
          purposes: ["review"],
          evidence: [
            { type: "domain_record", domain: "knowledge", id: source.record.id, revision: 1 },
          ],
        }),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("persists owned relationship endpoints and rejects foreign or broader disclosure", async () => {
    const f = await fixture();
    const other = await fixture();
    const subject = await service().create(f.human, input({ scope: { workspace: "finances" } }));
    const object = await service().create(f.human, input({ scope: { workspace: "finances" } }));
    const foreign = await service().create(other.human, input());
    const content: KnowledgeMutationInput["content"] = {
      kind: "relationship",
      value: {
        subjectId: subject.record.id,
        objectId: object.record.id,
        relationship: "supports",
        direction: "directed",
      },
    };
    const request = input({
      content,
      scope: { workspace: "finances" },
      relatedRecordIds: [subject.record.id, object.record.id],
    });
    const saved = await service().create(f.human, request);
    expect(saved.record.content).toEqual(content);
    expect(saved.record.relatedRecordIds).toEqual(request.relatedRecordIds);
    expect(await service().get(f.human, { id: saved.record.id, purpose: "planning" })).toEqual(
      saved.record,
    );
    expect(await service().create(f.human, request)).toEqual(saved);
    const relationships = await database.db
      .select()
      .from(knowledgeRelationships)
      .where(eq(knowledgeRelationships.recordId, saved.record.id));
    expect(relationships).toHaveLength(2);
    expect(relationships.map((row) => row.relatedRecordId).sort()).toEqual(
      [...request.relatedRecordIds].sort(),
    );
    const before = await persistedKnowledge();
    // Omit relatedRecordIds so content endpoints must enforce ownership themselves.
    for (const endpoint of ["subjectId", "objectId"] as const) {
      await expect(
        service().create(
          f.human,
          input({
            content: { ...content, value: { ...content.value, [endpoint]: foreign.record.id } },
            scope: { workspace: "finances" },
          }),
        ),
      ).rejects.toMatchObject({ status: 404 });
    }
    await expect(service().create(f.human, input({ content }))).rejects.toMatchObject({
      status: 403,
    });
    expect(await persistedKnowledge()).toEqual(before);
  });
  it("inherits entity-meaning source purpose and scopes without changing canonical goals", async () => {
    const f = await fixture();
    const other = await fixture();
    const [goal] = await database.db
      .insert(goals)
      .values({ userId: f.human.userId, title: "Plan weekly meals" })
      .returning();
    if (!goal) throw new Error("Goal fixture was not created.");
    const source = await service().create(
      f.human,
      input({ content: { kind: "goal", value: { goalId: goal.id } } }),
    );
    const foreign = await service().create(other.human, input());
    const content: KnowledgeMutationInput["content"] = {
      kind: "entity_meaning",
      value: { recordId: source.record.id, meaning: "Weekly planning intent", purpose: "planning" },
    };
    const saved = await service().create(f.human, input({ content }));
    expect(saved.record.content).toEqual(content);
    expect(saved.record.scope).toEqual({ workspace: null });
    expect(saved.record.requiredReadScopes).toEqual(["goals:read", "knowledge:read"]);
    await expect(
      service().get(f.agent, { id: saved.record.id, purpose: "planning" }),
    ).rejects.toMatchObject({ status: 403 });
    const scopes: AccessScope[] = ["knowledge:read", "knowledge:write", "goals:read"];
    await database.db
      .update(accessTokens)
      .set({ scopes })
      .where(eq(accessTokens.id, f.agent.actorId));
    const authorized: Principal = { ...f.agent, scopes: new Set(scopes) };
    expect(await service().get(authorized, { id: saved.record.id, purpose: "planning" })).toEqual(
      saved.record,
    );
    const before = await persistedKnowledge();
    await database.db
      .update(accessTokens)
      .set({ scopes: ["knowledge:read", "knowledge:write"] })
      .where(eq(accessTokens.id, f.agent.actorId));
    await expect(
      service().get(authorized, { id: saved.record.id, purpose: "planning" }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service().get(f.human, { id: saved.record.id, purpose: "review" }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service().create(
        f.human,
        input({ content: { ...content, value: { ...content.value, purpose: "review" } } }),
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service().create(f.human, input({ content, purposes: ["planning", "review"] })),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service().create(
        f.human,
        input({
          content: { ...content, value: { ...content.value, recordId: foreign.record.id } },
        }),
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(await persistedKnowledge()).toEqual(before);
    expect(await database.db.select().from(goals).where(eq(goals.id, goal.id))).toEqual([goal]);
  });
  it("bounds serialized Unicode values, evidence and relationships and rejects forged fields", async () => {
    const oversized = input({
      content: {
        kind: "decision",
        value: {
          subject: "💡".repeat(1600),
          option: "a".repeat(2000),
          reason: "b".repeat(2000),
          evidenceIds: [],
        },
      },
    });
    expect(knowledgeMutationInputSchema.safeParse(oversized).success).toBe(false);
    expect(
      knowledgeMutationInputSchema.safeParse(
        input({
          evidence: Array.from({ length: 21 }, () => ({ type: "observation", reference: "r" })),
        }),
      ).success,
    ).toBe(false);
    expect(
      knowledgeMutationInputSchema.safeParse(
        input({ relatedRecordIds: Array.from({ length: 21 }, () => randomUUID()) }),
      ).success,
    ).toBe(false);
    expect(
      knowledgeMutationInputSchema.safeParse({ ...input(), actorId: randomUUID() }).success,
    ).toBe(false);
    expect(
      knowledgeMutationInputSchema.safeParse(
        input({
          evidence: [
            {
              type: "statement",
              wording: "original",
              classification: "signed_inbound_message",
            } as never,
          ],
        }),
      ).success,
    ).toBe(false);
  });
  it("cascades owner deletion through content, sources, relations and receipts", async () => {
    const f = await fixture(),
      first = await service().create(f.human, input());
    await service().create(f.human, input({ relatedRecordIds: [first.record.id] }));
    await database.db.delete(users).where(eq(users.id, f.human.userId));
    for (const table of [
      knowledgeRecords,
      knowledgeRevisions,
      knowledgeSources,
      knowledgeRelationships,
      knowledgeReceipts,
    ])
      expect(await database.db.select().from(table)).toHaveLength(0);
  });
});
