import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  accessTokens,
  auditEvents,
  createDatabaseClient,
  type DatabaseClient,
  goals,
  knowledgeDerivations,
  knowledgeOwnerEpochs,
  knowledgeRecords,
  knowledgeRevisionMetadata,
  knowledgeRevisions,
  migrateDatabase,
  sessions,
  users,
} from "@personal-os/database";
import {
  type AccessScope,
  type KnowledgeMutationInput,
  knowledgeReceiptSchema,
} from "@personal-os/domain";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import { hashToken } from "../security.js";
import type { Principal } from "../types.js";
import { requireKnowledgeOwner } from "./access.js";
import { createKnowledgeLifecycleService } from "./lifecycle-service.js";
import { createKnowledgeRecordService } from "./record-service.js";

describe("knowledge lifecycle", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;
  const now = () => new Date("2026-11-12T12:00:00Z");
  const records = () => createKnowledgeRecordService({ db: database.db, now });
  const lifecycle = () => createKnowledgeLifecycleService({ db: database.db, now });
  const save = async (principal: Principal, request: KnowledgeMutationInput) =>
    knowledgeReceiptSchema.parse(await records().create(principal, request));
  const epoch = async (userId: string) => {
    const [row] = await database.db
      .select()
      .from(knowledgeOwnerEpochs)
      .where(eq(knowledgeOwnerEpochs.userId, userId));
    return row?.epoch;
  };

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
  }, 120_000);
  afterAll(async () => {
    await database?.close();
    await container?.stop();
  });

  async function fixture(scopes: AccessScope[] = ["knowledge:read", "knowledge:write"]) {
    const userId = randomUUID();
    await database.db.insert(users).values({
      id: userId,
      email: `${userId}@example.test`,
      displayName: "Owner",
      passwordHash: "unused",
    });
    async function addAgent(): Promise<Principal> {
      const actorId = randomUUID();
      await database.db.insert(accessTokens).values({
        id: actorId,
        userId,
        name: "Knowledge caller",
        tokenHash: hashToken(randomUUID()),
        scopes,
      });
      return { userId, actorId, actorType: "agent", scopes: new Set(scopes) };
    }
    const sessionId = randomUUID();
    await database.db.insert(sessions).values({
      id: sessionId,
      userId,
      tokenHash: hashToken(randomUUID()),
      expiresAt: new Date(now().getTime() + 60 * 60_000),
    });
    const human: Principal = {
      userId,
      actorId: userId,
      actorType: "user",
      sessionId,
      scopes: new Set(),
    };
    return { human, agent: await addAgent(), addAgent };
  }

  const input = (
    value: string,
    overrides: Partial<KnowledgeMutationInput> = {},
  ): KnowledgeMutationInput => ({
    mutationKey: randomUUID(),
    content: {
      kind: "fact",
      value: { subject: "Person", predicate: "preferred day", value: { type: "string", value } },
    },
    scope: { workspace: null },
    tags: ["fixture"],
    sensitivity: "standard",
    purposes: ["planning", "review"],
    evidence: [{ type: "statement", wording: `I prefer ${value}.` }],
    relatedRecordIds: [],
    ...overrides,
  });

  it("denies a new lifecycle action and receipt replay after the human session is revoked", async () => {
    const { human } = await fixture();
    const saved = await save(human, input("Tuesday"));
    const action = {
      action: "confirm" as const,
      recordId: saved.recordId,
      expectedRevision: 1,
      mutationKey: randomUUID(),
    };
    await lifecycle().mutate(human, action);
    const before = await epoch(human.userId);
    await database.db.delete(sessions).where(eq(sessions.id, human.sessionId ?? ""));

    const responses = await Promise.allSettled([
      lifecycle().mutate(human, { ...action, expectedRevision: 2, mutationKey: randomUUID() }),
      lifecycle().mutate(human, action),
    ]);
    expect(responses).toEqual(
      Array.from({ length: 2 }, () => ({
        status: "rejected",
        reason: expect.objectContaining({ status: 403 }),
      })),
    );
    expect(await epoch(human.userId)).toBe(before);
  });

  it("owner_correction_wins_and_stale_agent_cannot_overwrite", async () => {
    const { human, agent } = await fixture();
    const saved = await save(human, input("Tuesday"));
    expect(saved.record).toMatchObject({
      revision: 1,
      origin: "stated",
      acceptance: { kind: "owner" },
    });
    const correction = {
      action: "revise" as const,
      recordId: saved.record.id,
      expectedRevision: 1,
      mutationKey: randomUUID(),
      content: input("Wednesday").content,
      evidence: [{ type: "statement" as const, wording: "I now prefer Wednesday." }],
    };
    const oldEpoch = await epoch(human.userId);
    const corrected = await lifecycle().mutate(human, correction);
    expect(corrected).toMatchObject({
      outcome: "readable",
      record: { revision: 2, content: correction.content, status: "active" },
    });
    expect(await lifecycle().mutate(human, correction)).toEqual(corrected);
    expect(await epoch(human.userId)).toBe((oldEpoch ?? 0) + 1);
    await expect(
      lifecycle().mutate(agent, { ...correction, mutationKey: randomUUID() }),
    ).rejects.toMatchObject({
      status: 409,
      details: { current: { revision: 2, content: correction.content } },
    });
    const history = await database.db
      .select()
      .from(knowledgeRevisions)
      .where(eq(knowledgeRevisions.recordId, saved.record.id));
    expect(history.find((row) => row.revision === 1)?.snapshot.sources).toEqual(
      saved.record.sources,
    );
    expect(await records().get(agent, { id: saved.record.id, purpose: "planning" })).toMatchObject({
      revision: 2,
      content: correction.content,
    });
  });

  it("conflicting_claims_remain_visible", async () => {
    const { human } = await fixture();
    const first = await save(
      human,
      input("Tuesday", {
        validity: { validFrom: "2026-11-01T00:00:00Z", validUntil: "2026-12-01T00:00:00Z" },
      }),
    );
    const overlapping = await save(
      human,
      input("Wednesday", {
        validity: { validFrom: "2026-11-12T00:00:00Z", validUntil: "2026-11-22T00:00:00Z" },
      }),
    );
    const later = await save(
      human,
      input("Thursday", {
        validity: { validFrom: "2026-12-01T00:00:00Z", validUntil: null },
      }),
    );
    expect(await records().get(human, { id: first.record.id, purpose: "planning" })).toMatchObject({
      conflictRecordIds: [overlapping.record.id],
    });
    expect(overlapping.record.conflictRecordIds).toEqual([first.record.id]);
    expect(later.record.conflictRecordIds).toEqual([]);
  });
  it("keeps sensitive agent saves readable while only the owner confirms them", async () => {
    const { human, agent } = await fixture();
    const request = input("Allow automatic purchases", {
      sensitivity: "sensitive",
      evidence: [
        {
          type: "statement",
          wording: "Allow automatic purchases.",
          sessionRef: "s",
          messageRef: "m",
        },
      ],
    });
    const saved = knowledgeReceiptSchema.parse(await records().create(agent, request));
    expect(saved.record).toMatchObject({
      status: "active",
      origin: "stated",
      sensitivity: "sensitive",
      ownerHeld: false,
      acceptance: null,
    });
    const confirm = {
      action: "confirm" as const,
      recordId: saved.recordId,
      expectedRevision: 1,
      mutationKey: randomUUID(),
    };
    for (const operation of [confirm, { ...confirm, action: "widen" as const, workspace: null }]) {
      await expect(lifecycle().mutate(agent, operation)).rejects.toMatchObject({ status: 403 });
    }
    expect(() => requireKnowledgeOwner(agent)).toThrow(expect.objectContaining({ status: 403 }));
    const tokens = await database.db
      .select()
      .from(accessTokens)
      .where(eq(accessTokens.userId, human.userId));
    expect(await lifecycle().mutate(human, confirm)).toMatchObject({
      record: {
        revision: 2,
        status: "active",
        ownerHeld: true,
        acceptance: { kind: "owner" },
        author: saved.record.author,
      },
    });
    expect(
      await database.db.select().from(accessTokens).where(eq(accessTokens.userId, human.userId)),
    ).toEqual(tokens);
    expect(await records().create(agent, request)).toMatchObject({
      receiptId: saved.receiptId,
      outcome: "readable",
      record: { revision: 2, sensitivity: "sensitive" },
    });
  });

  it("handles missing source evidence separately from contributor revocation", async () => {
    const { human, agent, addAgent } = await fixture();
    const source = await save(human, input("Tuesday"));
    const request = input("Wednesday", {
      evidence: [
        { type: "statement", wording: "I prefer Wednesday." },
        { type: "domain_record", domain: "knowledge", id: source.record.id, revision: 1 },
      ],
    });
    const copied = await save(human, request);
    const contributionRequest = input("Tuesday", {
      evidence: [{ type: "statement", wording: "Tuesday.", sessionRef: "s", messageRef: "m" }],
    });
    const contribution = await save(agent, contributionRequest);
    await database.db
      .update(accessTokens)
      .set({ revokedAt: now() })
      .where(eq(accessTokens.id, agent.actorId));
    await expect(records().create(agent, contributionRequest)).rejects.toMatchObject({
      status: 403,
    });
    expect(
      await records().get(human, { id: contribution.record.id, purpose: "planning" }),
    ).toMatchObject({
      sources: [{ classification: "agent_recorded_statement", actorId: agent.actorId }],
    });

    await database.db.delete(knowledgeRecords).where(eq(knowledgeRecords.id, source.record.id));
    expect(await records().get(human, { id: copied.record.id, purpose: "planning" })).toMatchObject(
      {
        content: request.content,
        sources: [{ classification: "owner_statement" }, { availability: "unavailable" }],
      },
    );
    const reader = await addAgent();
    expect(
      await records().get(reader, { id: contribution.record.id, purpose: "planning" }),
    ).toMatchObject({
      sources: [{ actorId: agent.actorId }],
    });
    expect(
      await records().get(reader, { id: copied.record.id, purpose: "planning" }),
    ).toMatchObject({
      status: "active",
      evidenceAvailable: true,
      sources: [{ classification: "owner_statement" }, { availability: "unavailable" }],
    });
  });

  it("rejects wrong-owner mutations, supersession cycles and changed-key reuse", async () => {
    const { human } = await fixture();
    const other = await fixture();
    const first = await save(human, input("Tuesday"));
    const second = await save(human, input("Wednesday"));
    const request = {
      action: "supersede" as const,
      recordId: first.record.id,
      expectedRevision: 1,
      replacementId: second.record.id,
      mutationKey: randomUUID(),
    };
    await expect(lifecycle().mutate(other.human, request)).rejects.toMatchObject({ status: 404 });
    const superseded = await lifecycle().mutate(human, request);
    expect(superseded).toMatchObject({
      record: { status: "superseded", supersededBy: second.record.id },
    });
    expect(await lifecycle().mutate(human, request)).toEqual(superseded);
    await expect(
      lifecycle().mutate(human, { ...request, replacementId: first.record.id }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      lifecycle().mutate(human, {
        ...request,
        recordId: second.record.id,
        replacementId: first.record.id,
        mutationKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("keeps owner-confirmed content active while an agent proposes a correction", async () => {
    const { human, agent } = await fixture();
    const accepted = await save(human, input("Tuesday"));
    const proposal = await lifecycle().mutate(agent, {
      action: "revise",
      recordId: accepted.recordId,
      expectedRevision: 1,
      mutationKey: randomUUID(),
      content: input("Wednesday").content,
    });
    expect(proposal).toMatchObject({
      outcome: "readable",
      record: {
        revision: 1,
        status: "proposed",
        origin: "inferred",
        conflictRecordIds: [accepted.recordId],
      },
    });
    expect(proposal.recordId).not.toBe(accepted.recordId);
    expect(
      await database.db
        .select()
        .from(knowledgeDerivations)
        .where(eq(knowledgeDerivations.recordId, proposal.recordId)),
    ).toMatchObject([
      { kind: "revision_proposal", sourceRecordId: accepted.recordId, sourceRevision: 1 },
    ]);
    expect(
      await records().get(agent, { id: accepted.recordId, purpose: "planning" }),
    ).toMatchObject({
      revision: 1,
      status: "active",
      content: accepted.record.content,
      conflictRecordIds: [proposal.recordId],
    });
  });

  it("keeps inherited copy restrictions when an owner replaces its evidence", async () => {
    const { human, agent } = await fixture();
    const related = await save(human, input("Tuesday"));
    const record = await save(
      human,
      input("Wednesday", {
        relatedRecordIds: [related.recordId],
        evidence: [
          { type: "domain_record", domain: "knowledge", id: related.recordId, revision: 1 },
        ],
      }),
    );
    const corrected = await lifecycle().mutate(human, {
      action: "revise",
      recordId: record.recordId,
      expectedRevision: 1,
      mutationKey: randomUUID(),
      content: input("Thursday").content,
      relatedRecordIds: [],
      evidence: [{ type: "statement", wording: "Thursday." }],
    });
    expect(corrected).toMatchObject({ record: { revision: 2, relatedRecordIds: [] } });
    await lifecycle().mutate(human, {
      action: "restrict",
      recordId: related.recordId,
      expectedRevision: 1,
      mutationKey: randomUUID(),
      workspace: "tasks",
    });
    // The corrected record once copied the restricted record, so that record still narrows
    // it: an agent without the workspace scope cannot see it, and the owner always can.
    await expect(records().get(agent, { id: record.recordId })).rejects.toMatchObject({
      status: 404,
    });
    expect(await records().get(human, { id: record.recordId })).toMatchObject({
      revision: 2,
      scope: { workspace: null },
    });
  });

  it("keeps a generated inference inferred when the owner submits the same typed claim", async () => {
    const { human, agent } = await fixture();
    const content = input("Tuesday", { evidence: [] }).content;
    const saved = await save(agent, input("Tuesday", { evidence: [] }));
    const revise = (expectedRevision: number, next = content) =>
      lifecycle().mutate(human, {
        action: "revise",
        recordId: saved.recordId,
        expectedRevision,
        mutationKey: randomUUID(),
        content: next,
      });
    expect(await revise(1)).toMatchObject({
      record: {
        origin: "inferred",
        status: "active",
        ownerHeld: true,
        acceptance: null,
        content: { kind: "inference" },
      },
    });
    await lifecycle().mutate(human, {
      action: "confirm",
      recordId: saved.recordId,
      expectedRevision: 2,
      mutationKey: randomUUID(),
    });
    expect(await revise(3)).toMatchObject({
      record: {
        origin: "inferred",
        status: "active",
        acceptance: { kind: "owner" },
        content: { kind: "inference" },
      },
    });
    expect(
      await lifecycle().mutate(human, {
        action: "revise",
        recordId: saved.recordId,
        expectedRevision: 4,
        mutationKey: randomUUID(),
        content,
        evidence: [{ type: "statement", wording: "Tuesday" }],
      }),
    ).toMatchObject({ record: { origin: "inferred", content: { kind: "inference" } } });
    expect(await revise(5, input("Wednesday").content)).toMatchObject({
      record: { origin: "stated", status: "active", content: input("Wednesday").content },
    });
  });

  it("keeps a stated agent memory stated when the agent only retags it", async () => {
    const { agent } = await fixture();
    const chat = {
      type: "statement" as const,
      wording: "I prefer Tuesday.",
      sessionRef: "chat-session",
      messageRef: "chat-message",
    };
    const saved = await save(agent, input("Tuesday", { evidence: [chat] }));
    expect(saved.record).toMatchObject({ origin: "stated", content: input("Tuesday").content });
    const retagged = await lifecycle().mutate(agent, {
      action: "revise",
      recordId: saved.recordId,
      expectedRevision: 1,
      mutationKey: randomUUID(),
      content: input("Tuesday").content,
      tags: ["weekly-planning"],
    });
    expect(retagged).toMatchObject({
      record: {
        revision: 2,
        origin: "stated",
        content: input("Tuesday").content,
        sources: saved.record.sources,
        tags: ["weekly-planning"],
      },
    });
  });

  it("accepts the stored inference back on a retag and keeps its sources", async () => {
    const { agent } = await fixture();
    const saved = await save(
      agent,
      input("Tuesday", { evidence: [{ type: "observation", reference: "calendar:event-1" }] }),
    );
    expect(saved.record).toMatchObject({ origin: "inferred", content: { kind: "inference" } });
    const retagged = await lifecycle().mutate(agent, {
      action: "revise",
      recordId: saved.recordId,
      expectedRevision: 1,
      mutationKey: randomUUID(),
      content: saved.record.content,
      tags: ["calendar"],
    });
    expect(retagged).toMatchObject({
      record: {
        revision: 2,
        origin: "inferred",
        content: saved.record.content,
        sources: saved.record.sources,
        claimKey: saved.record.claimKey,
        tags: ["calendar"],
      },
    });
  });

  it("keeps the effective validity of unchanged routine content on a retag", async () => {
    const { human } = await fixture();
    const routine = {
      kind: "routine" as const,
      value: {
        subject: "Weekly review",
        recurrence: "Fridays",
        classification: "stated" as const,
        validFrom: "2026-11-01T00:00:00.000Z",
        validUntil: "2026-12-01T00:00:00.000Z",
      },
    };
    const saved = await save(
      human,
      input("unused", {
        content: routine,
        validity: { validFrom: "2026-11-01T00:00:00.000Z", validUntil: "2026-11-20T00:00:00.000Z" },
      }),
    );
    expect(saved.record.validUntil).toBe("2026-11-20T00:00:00.000Z");
    const retagged = await lifecycle().mutate(human, {
      action: "revise",
      recordId: saved.recordId,
      expectedRevision: 1,
      mutationKey: randomUUID(),
      content: routine,
      tags: ["review"],
    });
    expect(retagged).toMatchObject({ record: { validUntil: "2026-11-20T00:00:00.000Z" } });
  });

  it("reads supported memory past its validity as expired everywhere", async () => {
    const { human, agent } = await fixture();
    const request = input("Tuesday", {
      validity: { validFrom: "2026-11-01T00:00:00Z", validUntil: "2026-11-11T00:00:00Z" },
    });
    const saved = await save(human, request);
    expect(saved.record.status).toBe("expired");
    expect(await records().get(agent, { id: saved.recordId })).toMatchObject({
      status: "expired",
    });
    expect(await records().create(human, request)).toMatchObject({
      outcome: "readable",
      record: { status: "expired" },
    });
    // Explicit statuses stay as they are.
    expect(
      await lifecycle().mutate(human, {
        action: "archive",
        recordId: saved.recordId,
        expectedRevision: 1,
        mutationKey: randomUUID(),
      }),
    ).toMatchObject({ record: { status: "archived" } });
    const current = await save(human, input("Wednesday"));
    expect(current.record.status).toBe("active");
  });

  it("treats an uppercase spelling of the record itself as a supersession cycle", async () => {
    const { human } = await fixture();
    const saved = await save(human, input("Tuesday"));
    await expect(
      lifecycle().mutate(human, {
        action: "supersede",
        recordId: saved.recordId,
        expectedRevision: 1,
        replacementId: saved.recordId.toUpperCase(),
        mutationKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ status: 409 });
    const replacement = await save(human, input("Wednesday"));
    expect(
      await lifecycle().mutate(human, {
        action: "supersede",
        recordId: saved.recordId,
        expectedRevision: 1,
        replacementId: replacement.recordId.toUpperCase(),
        mutationKey: randomUUID(),
      }),
    ).toMatchObject({ record: { status: "superseded", supersededBy: replacement.recordId } });
  });

  it("audits the revision and status an update replaced, never values", async () => {
    const { human } = await fixture();
    const saved = await save(human, input("Tuesday"));
    const mutationKey = randomUUID();
    await lifecycle().mutate(human, {
      action: "archive",
      recordId: saved.recordId,
      expectedRevision: 1,
      mutationKey,
    });
    const audits = await database.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.entityId, saved.recordId));
    expect(audits.find(({ action }) => action === "knowledge.created")?.before).toBeNull();
    const archived = audits.find(({ action }) => action === "knowledge.archive");
    expect(archived).toMatchObject({
      before: { revision: 1, status: "active" },
      after: { revision: 2, status: "archived" },
    });
    expect(JSON.stringify(archived)).not.toContain("Tuesday");
  });

  it("projects legacy origin on read and preserves the raw revision when adding a sidecar", async () => {
    const { human, agent } = await fixture();
    const saved = await save(agent, input("Tuesday", { evidence: [] }));
    await database.db
      .delete(knowledgeRevisionMetadata)
      .where(eq(knowledgeRevisionMetadata.recordId, saved.recordId));
    const [legacy] = await database.db
      .select()
      .from(knowledgeRevisions)
      .where(eq(knowledgeRevisions.recordId, saved.recordId));
    expect(legacy?.snapshot).not.toHaveProperty("origin");
    expect(await records().get(human, { id: saved.recordId, purpose: "planning" })).toMatchObject({
      origin: "inferred",
      acceptance: null,
    });
    const confirmed = await lifecycle().mutate(human, {
      action: "confirm",
      recordId: saved.recordId,
      expectedRevision: 1,
      mutationKey: randomUUID(),
    });
    expect(confirmed).toMatchObject({
      record: {
        origin: "inferred",
        acceptance: { kind: "owner" },
        content: legacy?.snapshot.content,
      },
    });
    const versions = await database.db
      .select()
      .from(knowledgeRevisions)
      .where(eq(knowledgeRevisions.recordId, saved.recordId));
    expect(versions.find((row) => row.revision === 1)).toEqual(legacy);
    expect(
      await database.db
        .select()
        .from(knowledgeRevisionMetadata)
        .where(eq(knowledgeRevisionMetadata.recordId, saved.recordId)),
    ).toHaveLength(2);
  });
  it("bumps the knowledge epoch when a referenced external goal is deleted", async () => {
    const { human, agent } = await fixture(["knowledge:read", "knowledge:write", "goals:read"]);
    const [goal] = await database.db
      .insert(goals)
      .values({ userId: human.userId, title: "Canonical goal" })
      .returning();
    if (!goal) throw new Error("Goal fixture was not created.");
    const request = input("Tuesday", { content: { kind: "goal", value: { goalId: goal.id } } });
    const saved = await save(human, request);
    expect(await records().get(agent, { id: saved.recordId, purpose: "planning" })).toMatchObject({
      evidenceAvailable: true,
    });
    const before = await epoch(human.userId);
    await database.db.delete(goals).where(eq(goals.id, goal.id));
    expect(await epoch(human.userId)).toBe((before ?? 0) + 1);
    expect(await records().get(human, { id: saved.recordId, purpose: "planning" })).toMatchObject({
      content: request.content,
      evidenceAvailable: false,
    });
    await expect(
      records().get(agent, { id: saved.recordId, purpose: "planning" }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("blocks relationship reads and replays after a required endpoint loses its canonical goal", async () => {
    const { human, agent } = await fixture(["knowledge:read", "knowledge:write", "goals:read"]);
    const [goal] = await database.db
      .insert(goals)
      .values({ userId: human.userId, title: "Canonical endpoint" })
      .returning();
    if (!goal) throw new Error("Goal fixture was not created.");
    const endpoint = await save(
      human,
      input("Tuesday", {
        content: { kind: "goal", value: { goalId: goal.id } },
      }),
    );
    const other = await save(human, input("Friday"));
    const request = input("Wednesday", {
      evidence: [],
      content: {
        kind: "relationship",
        value: {
          subjectId: endpoint.recordId,
          objectId: other.recordId,
          relationship: "supports",
          direction: "directed",
        },
      },
    });
    const owned = await save(human, request);
    const agentRequest = { ...request, mutationKey: randomUUID() };
    const contributed = await save(agent, agentRequest);
    expect(await records().get(agent, { id: owned.recordId, purpose: "planning" })).toMatchObject({
      status: "active",
      evidenceAvailable: true,
    });
    expect(await records().create(agent, agentRequest)).toEqual(contributed);

    await database.db.delete(goals).where(eq(goals.id, goal.id));
    await expect(
      records().get(agent, { id: endpoint.recordId, purpose: "planning" }),
    ).rejects.toMatchObject({
      status: 404,
    });
    const outcomes = await Promise.allSettled([
      records().get(human, { id: owned.recordId, purpose: "planning" }),
      records().get(agent, { id: owned.recordId, purpose: "planning" }),
      records().create(agent, agentRequest),
    ]);
    // Replay of a record the agent can no longer read is content-free.
    expect(outcomes).toMatchObject([
      { status: "fulfilled", value: { status: "disputed", evidenceAvailable: false } },
      { status: "rejected", reason: { status: 404 } },
      { status: "fulfilled", value: { outcome: "forgotten", recordId: contributed.recordId } },
    ]);
  });

  it("normalizes claim identifiers while retaining distinct typed values", async () => {
    const { human, agent } = await fixture();
    const first = await save(
      human,
      input("Tuesday", {
        content: {
          kind: "fact",
          value: {
            subject: "Pe\u0301rson",
            predicate: "Preferred   Day",
            value: { type: "string", value: "Tuesday" },
          },
        },
      }),
    );
    const second = await save(
      human,
      input("tuesday", {
        content: {
          kind: "fact",
          value: {
            subject: "PÉRSON",
            predicate: "preferred day",
            value: { type: "string", value: "tuesday" },
          },
        },
        sensitivity: "sensitive",
      }),
    );
    expect(second.record.claimKey).toEqual(first.record.claimKey);
    expect(second.record.conflictRecordIds).toEqual([first.recordId]);
    // Sensitive memory is readable by agents, so its conflict is visible to them too.
    expect(await records().get(agent, { id: first.recordId, purpose: "planning" })).toMatchObject({
      conflictRecordIds: [second.recordId],
    });
  });
  it("keeps readable receipt replay when the owner makes the record sensitive", async () => {
    const { human, agent } = await fixture();
    const request = input("Tuesday", { evidence: [] });
    const saved = await save(agent, request);
    await lifecycle().mutate(human, {
      action: "set_sensitivity",
      recordId: saved.recordId,
      expectedRevision: 1,
      mutationKey: randomUUID(),
      sensitivity: "sensitive",
    });
    expect(await records().create(agent, request)).toMatchObject({
      outcome: "readable",
      record: { revision: 2, sensitivity: "sensitive" },
    });
    expect(await records().get(human, { id: saved.recordId, purpose: "planning" })).toMatchObject({
      revision: 2,
      sensitivity: "sensitive",
    });
  });
  it("keeps a confirmed replacement usable after its predecessor is superseded", async () => {
    const { human, agent } = await fixture();
    const before = await save(human, input("Tuesday"));
    const proposal = await lifecycle().mutate(agent, {
      action: "revise",
      recordId: before.recordId,
      expectedRevision: 1,
      mutationKey: randomUUID(),
      content: input("Wednesday").content,
    });
    await lifecycle().mutate(human, {
      action: "resolve_conflict",
      recordId: proposal.recordId,
      expectedRevision: 1,
      keep: "proposed",
      mutationKey: randomUUID(),
    });
    expect(await records().get(human, { id: before.recordId })).toMatchObject({
      status: "superseded",
      supersededBy: proposal.recordId,
    });
    expect(
      await records().get(agent, { id: proposal.recordId, purpose: "planning" }),
    ).toMatchObject({
      status: "active",
      origin: "inferred",
      evidenceAvailable: true,
    });
  });

  it("keeps a pending proposal resolvable until the person resolves its conflict", async () => {
    const { human, agent } = await fixture();
    const held = await save(human, input("Tuesday"));
    const proposal = await lifecycle().mutate(agent, {
      action: "revise",
      recordId: held.recordId,
      expectedRevision: 1,
      mutationKey: randomUUID(),
      content: input("Wednesday").content,
    });
    const pending = { recordId: proposal.recordId, expectedRevision: 1 };
    for (const action of [
      { action: "confirm" as const },
      { action: "dispute" as const },
      { action: "revise" as const, content: input("Thursday").content },
    ])
      await expect(
        lifecycle().mutate(human, { ...pending, ...action, mutationKey: randomUUID() }),
      ).rejects.toMatchObject({
        status: 409,
        message: expect.stringContaining("resolve_conflict"),
      });
    // Nothing was written: the proposal still conflicts with the person's record and resolves.
    expect(await records().get(human, { id: proposal.recordId })).toMatchObject({
      revision: 1,
      status: "proposed",
      conflictRecordIds: [held.recordId],
    });
    expect(
      await lifecycle().mutate(human, {
        ...pending,
        action: "resolve_conflict",
        keep: "proposed",
        mutationKey: randomUUID(),
      }),
    ).toMatchObject({ record: { status: "active" } });
    expect(await records().get(human, { id: held.recordId })).toMatchObject({
      status: "superseded",
    });
  });

  it("refuses to accept a second proposal once another replaced the original", async () => {
    const { human, agent } = await fixture();
    const held = await save(human, input("Tuesday"));
    const propose = (value: string) =>
      lifecycle().mutate(agent, {
        action: "revise",
        recordId: held.recordId,
        expectedRevision: 1,
        mutationKey: randomUUID(),
        content: input(value).content,
      });
    const first = await propose("Wednesday");
    const second = await propose("Thursday");
    await lifecycle().mutate(human, {
      action: "resolve_conflict",
      recordId: first.recordId,
      expectedRevision: 1,
      keep: "proposed",
      mutationKey: randomUUID(),
    });
    await expect(
      lifecycle().mutate(human, {
        action: "resolve_conflict",
        recordId: second.recordId,
        expectedRevision: 1,
        keep: "proposed",
        mutationKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await records().get(human, { id: second.recordId })).toMatchObject({
      revision: 1,
      status: "proposed",
    });
    // Keeping the person's side still retires the stale proposal.
    expect(
      await lifecycle().mutate(human, {
        action: "resolve_conflict",
        recordId: second.recordId,
        expectedRevision: 1,
        keep: "current",
        mutationKey: randomUUID(),
      }),
    ).toMatchObject({ record: { status: "superseded" } });
  });

  it("disputes upstream corrections and lets new evidence restore support", async () => {
    const { human, agent } = await fixture();
    const source = await save(human, input("Tuesday"));
    const evidence = (revision: number) => ({
      type: "domain_record" as const,
      domain: "knowledge" as const,
      id: source.recordId,
      revision,
    });
    const derived = await save(agent, input("Wednesday", { evidence: [evidence(1)] }));
    const descendant = await save(
      agent,
      input("Thursday", {
        evidence: [
          { type: "domain_record", domain: "knowledge", id: derived.recordId, revision: 1 },
        ],
      }),
    );
    await lifecycle().mutate(human, {
      action: "revise",
      recordId: source.recordId,
      expectedRevision: 1,
      mutationKey: randomUUID(),
      content: input("Friday").content,
    });
    for (const id of [derived.recordId, descendant.recordId]) {
      expect(await records().get(human, { id, purpose: "planning" })).toMatchObject({
        status: "disputed",
        evidenceAvailable: false,
      });
      expect(await records().get(agent, { id, purpose: "planning" })).toMatchObject({
        status: "disputed",
        evidenceAvailable: false,
      });
    }
    const revised = await lifecycle().mutate(agent, {
      action: "revise",
      recordId: derived.recordId,
      expectedRevision: 1,
      mutationKey: randomUUID(),
      content: input("Wednesday").content,
      evidence: [evidence(2)],
    });
    expect(revised).toMatchObject({
      record: {
        revision: 2,
        status: "active",
        evidenceAvailable: true,
        sources: [{ evidence: evidence(2) }],
      },
    });
    expect(
      await database.db
        .select()
        .from(knowledgeDerivations)
        .where(eq(knowledgeDerivations.recordId, derived.recordId)),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ revision: 1, sourceRevision: 1 }),
        expect.objectContaining({ revision: 2, sourceRevision: 2 }),
      ]),
    );
    await lifecycle().mutate(human, {
      action: "restrict",
      recordId: source.recordId,
      expectedRevision: 2,
      mutationKey: randomUUID(),
      workspace: "tasks",
    });
    await expect(records().get(agent, { id: derived.recordId })).rejects.toMatchObject({
      status: 404,
    });
    expect(await records().get(human, { id: derived.recordId })).toMatchObject({
      revision: 2,
    });
  });

  it("keeps a claim with remaining support eligible and disputes it after the last support is removed", async () => {
    const { human, agent } = await fixture();
    const first = await save(human, input("Tuesday"));
    const second = await save(human, input("Friday"));
    const request = input("Wednesday", {
      evidence: [first, second].map(({ recordId }) => ({
        type: "domain_record",
        domain: "knowledge",
        id: recordId,
        revision: 1,
      })),
    });
    const derived = await save(agent, request);
    await database.db.delete(knowledgeRecords).where(eq(knowledgeRecords.id, first.recordId));
    expect(await records().get(agent, { id: derived.recordId, purpose: "planning" })).toMatchObject(
      {
        status: "active",
        evidenceAvailable: true,
        sources: [{ availability: "unavailable" }, { evidence: { id: second.recordId } }],
      },
    );
    await database.db.delete(knowledgeRecords).where(eq(knowledgeRecords.id, second.recordId));
    expect(await records().create(agent, request)).toMatchObject({
      record: { status: "disputed", evidenceAvailable: false },
    });
  });

  it("enforces current restrictions on legacy generated entity and relationship references", async () => {
    const { human, agent } = await fixture();
    const source = await save(human, input("Tuesday"));
    const other = await save(human, input("Friday"));
    const requests = [
      input("Wednesday", {
        evidence: [],
        content: {
          kind: "entity_meaning",
          value: { recordId: source.recordId, meaning: "Work planning", purpose: "planning" },
        },
      }),
      input("Wednesday", {
        evidence: [],
        content: {
          kind: "relationship",
          value: {
            subjectId: source.recordId,
            objectId: other.recordId,
            relationship: "supports",
            direction: "directed",
          },
        },
      }),
    ];
    for (const request of requests) {
      const copy = await save(agent, request);
      await database.db
        .delete(knowledgeDerivations)
        .where(eq(knowledgeDerivations.recordId, copy.recordId));
      await database.db
        .delete(knowledgeRevisionMetadata)
        .where(eq(knowledgeRevisionMetadata.recordId, copy.recordId));
    }
    await lifecycle().mutate(human, {
      action: "restrict",
      recordId: source.recordId,
      expectedRevision: 1,
      mutationKey: randomUUID(),
      workspace: "tasks",
    });
    // Replay of a copy narrowed by its source reads as gone to an agent without the scope.
    for (const request of requests)
      expect(await records().create(agent, request)).toMatchObject({ outcome: "forgotten" });
  });

  it("checks live goals referenced in legacy generated envelopes", async () => {
    const { human, agent } = await fixture(["knowledge:read", "knowledge:write", "goals:read"]);
    const [goal] = await database.db
      .insert(goals)
      .values({ userId: human.userId, title: "Canonical goal" })
      .returning();
    if (!goal) throw new Error("Goal fixture was not created.");
    const request = input("Tuesday", {
      evidence: [],
      content: { kind: "goal", value: { goalId: goal.id } },
    });
    const copy = await save(agent, request);
    await database.db
      .delete(knowledgeRevisionMetadata)
      .where(eq(knowledgeRevisionMetadata.recordId, copy.recordId));
    await database.db.delete(goals).where(eq(goals.id, goal.id));
    expect(await records().get(human, { id: copy.recordId, purpose: "planning" })).toMatchObject({
      status: "disputed",
      evidenceAvailable: false,
    });
    expect(await records().create(agent, request)).toMatchObject({ outcome: "forgotten" });
  });

  it("does not attribute a correction to the old wording or invent legacy acceptance", async () => {
    const { human } = await fixture();
    const old = await save(human, input("Tuesday"));
    const revised = await lifecycle().mutate(human, {
      action: "revise",
      recordId: old.recordId,
      expectedRevision: 1,
      mutationKey: randomUUID(),
      content: input("Wednesday").content,
    });
    expect(revised).toMatchObject({
      record: { sources: [], acceptance: { kind: "owner", evidenceIds: [] } },
    });
    const history = await database.db
      .select()
      .from(knowledgeRevisions)
      .where(eq(knowledgeRevisions.recordId, old.recordId));
    expect(history.find((row) => row.revision === 1)?.snapshot.sources).toEqual(old.record.sources);
    const unproven = await save(human, input("Friday", { evidence: [] }));
    await database.db
      .delete(knowledgeRevisionMetadata)
      .where(eq(knowledgeRevisionMetadata.recordId, unproven.recordId));
    expect(
      await records().get(human, { id: unproven.recordId, purpose: "planning" }),
    ).toMatchObject({
      origin: "stated",
      acceptance: null,
    });
  });

  it("uses Unicode full case folding for identifiers only", async () => {
    const { human } = await fixture();
    const content = (subject: string, value: string) => ({
      kind: "fact" as const,
      value: { subject, predicate: "description", value: { type: "string" as const, value } },
    });
    const first = await save(human, input("Tuesday", { content: content("Straße", "Straße") }));
    const second = await save(human, input("Tuesday", { content: content("STRASSE", "STRASSE") }));
    expect(second.record.claimKey).toEqual(first.record.claimKey);
    expect(second.record.conflictRecordIds).toEqual([first.recordId]);
  });
});
