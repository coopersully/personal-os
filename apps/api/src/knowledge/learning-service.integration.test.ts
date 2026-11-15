import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  accessTokens,
  createDatabaseClient,
  type DatabaseClient,
  knowledgeOwnerEpochs,
  knowledgeRecords,
  knowledgeSelectionInteractions,
  migrateDatabase,
  sessions,
  users,
} from "@personal-os/database";
import {
  type KnowledgeMutationInput,
  type KnowledgeSelectionInput,
  knowledgePreferenceClaimKey,
  knowledgePreferenceContent,
  knowledgeReceiptSchema,
} from "@personal-os/domain";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { and, eq } from "drizzle-orm";
import { hashToken } from "../security.js";
import type { Principal } from "../types.js";
import { createKnowledgeLearningService } from "./learning-service.js";
import { createKnowledgeLifecycleService } from "./lifecycle-service.js";
import { createKnowledgeRecordService } from "./record-service.js";

describe("knowledge preference learning", () => {
  let container: StartedPostgreSqlContainer;
  let database: DatabaseClient;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17.5-alpine").start();
    database = createDatabaseClient(container.getConnectionUri());
    await migrateDatabase(database.db, resolve(process.cwd(), "packages/database/migrations"));
  }, 120_000);
  afterAll(async () => {
    await database?.close();
    await container?.stop();
  });

  async function fixture(at = "2026-01-01T01:00:00Z", timezone = "UTC") {
    const userId = randomUUID();
    await database.db.insert(users).values({
      id: userId,
      email: `${userId}@example.test`,
      displayName: "Owner",
      passwordHash: "unused",
      planningTimezone: timezone,
    });
    async function session(): Promise<Principal> {
      const sessionId = randomUUID();
      await database.db.insert(sessions).values({
        id: sessionId,
        userId,
        tokenHash: hashToken(randomUUID()),
        expiresAt: new Date("2027-01-01T00:00:00Z"),
      });
      return { userId, actorId: userId, actorType: "user", sessionId, scopes: new Set() };
    }
    const human = await session();
    const now = () => new Date(at);
    const config = { db: database.db, now };
    const learning = createKnowledgeLearningService(config);
    const records = createKnowledgeRecordService(config);
    const lifecycle = createKnowledgeLifecycleService(config);
    const epoch = async () => {
      const [row] = await database.db
        .select()
        .from(knowledgeOwnerEpochs)
        .where(eq(knowledgeOwnerEpochs.userId, userId));
      return row?.epoch ?? 0;
    };
    async function select(value: "concise" | "detailed" = "concise") {
      const { sourceEventId } = await learning.issueSelectionInteraction(human);
      const input = { key: "presentation.detail", value, sourceEventId } as const;
      return { input, result: await learning.recordSelection(human, input) };
    }
    const read = (id: string) => records.get(human, { id, purpose: "planning" });
    async function threeDays() {
      await select();
      at = "2026-01-02T01:00:00Z";
      await select();
      at = "2026-01-03T01:00:00Z";
      return knowledgeReceiptSchema.parse((await select()).result).record;
    }
    return {
      human,
      session,
      learning,
      records,
      lifecycle,
      epoch,
      select,
      threeDays,
      read,
      moveTo(date: string) {
        at = date;
      },
    };
  }

  it("three_distinct_dates_accept_but_replays_do_not", async () => {
    const f = await fixture();
    const first = await f.select();
    const proposal = knowledgeReceiptSchema.parse(first.result).record;
    expect(proposal).toMatchObject({ status: "proposed", origin: "inferred", acceptance: null });
    await f.select();
    f.moveTo("2026-01-02T01:00:00Z");
    await f.select();
    expect(await f.read(proposal.id)).toMatchObject({ status: "proposed", acceptance: null });
    f.moveTo("2026-01-03T01:00:00Z");
    const third = await f.select();
    const accepted = knowledgeReceiptSchema.parse(third.result).record;
    expect(accepted).toMatchObject({
      id: proposal.id,
      status: "active",
      origin: "inferred",
      reviewAt: "2026-04-03T01:00:00.000Z",
      acceptance: { kind: "evidence_rule", ruleVersion: "presentation-v1" },
      stale: false,
    });
    expect(accepted.acceptance?.evidenceIds).toHaveLength(3);
    expect(accepted.sources.map(({ classification }) => classification)).toEqual(
      Array(3).fill("first_party_selection"),
    );
    f.moveTo("2026-01-04T01:00:00Z");
    const epoch = await f.epoch();
    expect(await f.learning.recordSelection(f.human, third.input)).toEqual(third.result);
    expect(await f.epoch()).toBe(epoch);
    expect((await f.read(accepted.id)).acceptance?.evidenceIds).toHaveLength(3);
  });

  it("correction_stops_relearning", async () => {
    const f = await fixture();
    const accepted = await f.threeDays();
    const corrected = knowledgeReceiptSchema.parse(
      await f.lifecycle.mutate(f.human, {
        action: "revise",
        recordId: accepted.id,
        expectedRevision: accepted.revision,
        mutationKey: randomUUID(),
        content: knowledgePreferenceContent({ key: "presentation.detail", value: "detailed" }),
      }),
    ).record;
    for (const day of [4, 5, 6]) {
      f.moveTo(`2026-01-0${day}T01:00:00Z`);
      expect((await f.select()).result).toEqual({ outcome: "recorded" });
    }
    expect(await f.read(accepted.id)).toMatchObject({
      revision: corrected.revision,
      status: "active",
      acceptance: { kind: "owner" },
      content: corrected.content,
    });
    const reset = {
      claimKey: knowledgePreferenceClaimKey("presentation.detail"),
      expectedEpoch: await f.epoch(),
      mutationKey: randomUUID(),
    };
    await expect(
      f.learning.resetSuppression(f.human, { ...reset, expectedEpoch: 0 }),
    ).rejects.toMatchObject({ status: 409 });
    const resetResult = await f.learning.resetSuppression(f.human, reset);
    expect(await f.learning.resetSuppression(f.human, reset)).toEqual(resetResult);
    f.moveTo("2026-01-07T01:00:00Z");
    expect((await f.select()).result).toEqual({ outcome: "recorded" });
    expect(await f.read(accepted.id)).toMatchObject({
      revision: corrected.revision,
      status: "active",
    });
  });

  it.each([
    "rule",
    "owner",
  ] as const)("requires fresh evidence after reset of a rejected %s acceptance", async (kind) => {
    const f = await fixture();
    let accepted = await f.threeDays();
    if (kind === "owner") {
      accepted = knowledgeReceiptSchema.parse(
        await f.lifecycle.mutate(f.human, {
          action: "confirm",
          recordId: accepted.id,
          expectedRevision: accepted.revision,
          mutationKey: randomUUID(),
        }),
      ).record;
    }
    await f.lifecycle.mutate(f.human, {
      action: "dispute",
      recordId: accepted.id,
      expectedRevision: accepted.revision,
      mutationKey: randomUUID(),
    });
    f.moveTo("2026-01-04T01:00:00Z");
    expect((await f.select()).result).toEqual({ outcome: "recorded" });
    await f.learning.resetSuppression(f.human, {
      claimKey: knowledgePreferenceClaimKey("presentation.detail"),
      expectedEpoch: await f.epoch(),
      mutationKey: randomUUID(),
    });
    f.moveTo("2026-01-05T01:00:00Z");
    await f.select();
    f.moveTo("2026-01-06T01:00:00Z");
    await f.select();
    expect((await f.read(accepted.id)).status).not.toBe("active");
    f.moveTo("2026-01-07T01:00:00Z");
    await f.select();
    expect(await f.read(accepted.id)).toMatchObject({
      status: "active",
      acceptance: {
        kind: "evidence_rule",
        acceptedAt: "2026-01-07T01:00:00.000Z",
      },
    });
  });

  it("honors a directly saved owner preference and retires the learned claim", async () => {
    const f = await fixture();
    const accepted = await f.threeDays();
    const input: KnowledgeMutationInput = {
      content: knowledgePreferenceContent({ key: "presentation.detail", value: "detailed" }),
      mutationKey: randomUUID(),
      scope: { workspace: null },
      sensitivity: "standard",
      purposes: ["planning"],
      evidence: [{ type: "statement", wording: "I prefer more detail." }],
      relatedRecordIds: [],
    };
    const owner = knowledgeReceiptSchema.parse(await f.records.create(f.human, input)).record;
    expect(owner).toMatchObject({
      status: "active",
      acceptance: { kind: "owner" },
      conflictRecordIds: [],
    });
    expect(await f.read(accepted.id)).toMatchObject({
      status: "superseded",
      supersededBy: owner.id,
    });
    f.moveTo("2026-01-04T01:00:00Z");
    expect((await f.select()).result).toEqual({ outcome: "recorded" });
  });

  it("disputes automatic acceptance immediately on a contrary selection even when disabled", async () => {
    const f = await fixture();
    const accepted = await f.threeDays();
    await f.learning.updateSettings(f.human, {
      automaticPreferenceAcceptance: false,
      expectedRevision: (await f.learning.getSettings(f.human)).revision,
      mutationKey: randomUUID(),
    });
    expect((await f.read(accepted.id)).status).toBe("active");
    f.moveTo("2026-01-04T01:00:00Z");
    expect(knowledgeReceiptSchema.parse((await f.select("detailed")).result).record).toMatchObject({
      id: accepted.id,
      status: "disputed",
      origin: "inferred",
    });
    for (const day of [5, 6, 7]) {
      f.moveTo(`2026-01-0${day}T01:00:00Z`);
      await f.select();
    }
    expect((await f.read(accepted.id)).status).toBe("disputed");
  });

  it("rechecks the window transactionally when the owner enables learning", async () => {
    const f = await fixture();
    const defaultSettings = await f.learning.getSettings(f.human);
    expect(defaultSettings.automaticPreferenceAcceptance).toBe(true);
    const disable = {
      automaticPreferenceAcceptance: false,
      expectedRevision: defaultSettings.revision,
      mutationKey: randomUUID(),
    };
    const disabled = await f.learning.updateSettings(f.human, disable);
    expect(await f.learning.updateSettings(f.human, disable)).toEqual(disabled);
    await expect(
      f.learning.updateSettings(f.human, { ...disable, mutationKey: randomUUID() }),
    ).rejects.toMatchObject({ status: 409 });
    const proposal = await f.threeDays();
    expect(proposal.status).toBe("proposed");
    await f.learning.updateSettings(f.human, {
      automaticPreferenceAcceptance: true,
      expectedRevision: disabled.revision,
      mutationKey: randomUUID(),
    });
    expect(await f.read(proposal.id)).toMatchObject({
      status: "active",
      acceptance: { kind: "evidence_rule" },
    });
  });

  it("uses immutable local dates across a time zone change and excludes old evidence", async () => {
    const f = await fixture("2026-01-01T01:00:00Z", "America/New_York");
    const first = await f.select();
    const proposal = knowledgeReceiptSchema.parse(first.result).record;
    f.moveTo("2026-01-30T01:00:00Z");
    await f.select();
    await database.db
      .update(users)
      .set({ planningTimezone: "UTC" })
      .where(eq(users.id, f.human.userId));
    f.moveTo("2026-02-01T01:00:00Z");
    await f.learning.recordSelection(f.human, first.input);
    await f.select();
    expect((await f.read(proposal.id)).status).toBe("proposed");
    const [original] = await database.db
      .select()
      .from(knowledgeSelectionInteractions)
      .where(eq(knowledgeSelectionInteractions.id, first.input.sourceEventId));
    expect(original).toMatchObject({ localDate: "2025-12-31", timeZone: "America/New_York" });
    f.moveTo("2026-02-02T01:00:00Z");
    await f.select();
    expect((await f.read(proposal.id)).status).toBe("active");
  });

  it("disputes an accepted claim when its source deletion leaves fewer than three dates", async () => {
    const f = await fixture();
    const first = await f.select();
    const sameDate = await f.select();
    f.moveTo("2026-01-02T01:00:00Z");
    await f.select();
    f.moveTo("2026-01-03T01:00:00Z");
    const accepted = knowledgeReceiptSchema.parse((await f.select()).result).record;
    const epoch = await f.epoch();
    const remove = (id: string) =>
      database.db
        .delete(knowledgeSelectionInteractions)
        .where(
          and(
            eq(knowledgeSelectionInteractions.userId, f.human.userId),
            eq(knowledgeSelectionInteractions.id, id),
          ),
        );
    const alternatives = [first.input.sourceEventId, sameDate.input.sourceEventId];
    const cited = alternatives.find((id) => accepted.acceptance?.evidenceIds.includes(id));
    expect(cited).toBeDefined();
    await remove(cited ?? "");
    expect(await f.read(accepted.id)).toMatchObject({
      status: "active",
      sources: expect.arrayContaining([
        { ...accepted.sources.find(({ id }) => id === cited), availability: "unavailable" },
      ]),
    });
    await remove(alternatives.find((id) => id !== cited) ?? "");
    expect(await f.epoch()).toBeGreaterThan(epoch);
    expect(await f.read(accepted.id)).toMatchObject({
      status: "disputed",
      evidenceAvailable: false,
    });
    await expect(f.learning.recordSelection(f.human, first.input)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("labels accepted inference stale exactly at day 90 without changing its origin", async () => {
    const f = await fixture();
    const accepted = await f.threeDays();
    f.moveTo("2026-04-03T00:59:59Z");
    expect(await f.read(accepted.id)).toMatchObject({ stale: false, status: "active" });
    f.moveTo("2026-04-03T01:00:00Z");
    expect(await f.read(accepted.id)).toMatchObject({
      stale: true,
      status: "active",
      origin: "inferred",
    });
    const confirmed = await f.lifecycle.mutate(f.human, {
      action: "confirm",
      recordId: accepted.id,
      expectedRevision: accepted.revision,
      mutationKey: randomUUID(),
    });
    expect(confirmed).toMatchObject({
      record: { stale: false, reviewAt: null, origin: "inferred", acceptance: { kind: "owner" } },
    });
  });

  it("preserves inferred provenance when the owner edits validity without replacing evidence", async () => {
    const f = await fixture();
    const accepted = await f.threeDays();
    const edited = knowledgeReceiptSchema.parse(
      await f.lifecycle.mutate(f.human, {
        action: "revise",
        recordId: accepted.id,
        expectedRevision: accepted.revision,
        mutationKey: randomUUID(),
        content: accepted.content,
        validity: { validFrom: accepted.validFrom, validUntil: "2026-02-01T01:00:00Z" },
      }),
    ).record;
    expect(edited).toMatchObject({
      status: "active",
      origin: "inferred",
      content: accepted.content,
      sources: accepted.sources,
      acceptance: { kind: "owner", evidenceIds: accepted.sources.map(({ id }) => id) },
      validUntil: "2026-02-01T01:00:00Z",
      reviewAt: null,
    });
    expect(await f.read(accepted.id)).toEqual(edited);
  });

  it("refreshes overdue format inference with three fresh supporting dates", async () => {
    const f = await fixture();
    const selectFormat = async () => {
      const { sourceEventId } = await f.learning.issueSelectionInteraction(f.human);
      return f.learning.recordSelection(f.human, {
        key: "presentation.format",
        value: "bullets",
        sourceEventId,
      });
    };
    await selectFormat();
    f.moveTo("2026-01-02T01:00:00Z");
    await selectFormat();
    f.moveTo("2026-01-03T01:00:00Z");
    const accepted = knowledgeReceiptSchema.parse(await selectFormat()).record;
    f.moveTo("2026-04-03T01:00:00Z");
    await selectFormat();
    f.moveTo("2026-04-04T01:00:00Z");
    await selectFormat();
    expect(await f.read(accepted.id)).toMatchObject({ stale: true, revision: accepted.revision });
    f.moveTo("2026-04-05T01:00:00Z");
    expect(knowledgeReceiptSchema.parse(await selectFormat()).record).toMatchObject({
      id: accepted.id,
      revision: accepted.revision + 1,
      stale: false,
      status: "active",
      origin: "inferred",
      reviewAt: "2026-07-04T01:00:00.000Z",
      acceptance: { kind: "evidence_rule", acceptedAt: "2026-04-05T01:00:00.000Z" },
    });
  });

  it("does not broaden a restricted preference after the owner resets learning", async () => {
    const f = await fixture();
    const accepted = await f.threeDays();
    const restricted = knowledgeReceiptSchema.parse(
      await f.lifecycle.mutate(f.human, {
        action: "restrict",
        recordId: accepted.id,
        expectedRevision: accepted.revision,
        mutationKey: randomUUID(),
        restrictions: { purposes: ["planning"], sensitivity: "sensitive" },
      }),
    ).record;
    await f.learning.resetSuppression(f.human, {
      claimKey: knowledgePreferenceClaimKey("presentation.detail"),
      expectedEpoch: await f.epoch(),
      mutationKey: randomUUID(),
    });
    for (const day of [4, 5, 6]) {
      f.moveTo(`2026-04-0${day}T01:00:00Z`);
      expect((await f.select()).result).toEqual({ outcome: "recorded" });
    }
    expect(await f.read(accepted.id)).toMatchObject({
      revision: restricted.revision,
      sensitivity: "sensitive",
      purposes: ["planning"],
    });
    expect(
      await database.db
        .select()
        .from(knowledgeRecords)
        .where(eq(knowledgeRecords.userId, f.human.userId)),
    ).toHaveLength(1);
  });

  it("disputes contradictory evidence without broadening a restricted claim", async () => {
    const f = await fixture();
    const accepted = await f.threeDays();
    await f.lifecycle.mutate(f.human, {
      action: "restrict",
      recordId: accepted.id,
      expectedRevision: accepted.revision,
      mutationKey: randomUUID(),
      restrictions: { purposes: ["planning"], sensitivity: "sensitive" },
    });
    f.moveTo("2026-01-04T01:00:00Z");
    await f.select("detailed");
    expect(await f.read(accepted.id)).toMatchObject({
      status: "disputed",
      sensitivity: "sensitive",
      purposes: ["planning"],
    });
  });

  async function agentFor(userId: string): Promise<Principal> {
    const actorId = randomUUID();
    const scopes = ["knowledge:read", "knowledge:write"] as const;
    await database.db.insert(accessTokens).values({
      id: actorId,
      userId,
      name: "Knowledge caller",
      tokenHash: hashToken(randomUUID()),
      scopes: [...scopes],
    });
    return {
      actorType: "agent",
      actorId,
      userId,
      scopes: new Set(scopes),
    };
  }

  it("accepts after a contrary proposal's validity ends without reporting a conflict", async () => {
    const f = await fixture();
    const agent = await agentFor(f.human.userId);
    const contrary = await f.records.create(agent, {
      mutationKey: randomUUID(),
      content: knowledgePreferenceContent({ key: "presentation.detail", value: "detailed" }),
      scope: { workspace: null },
      sensitivity: "standard",
      purposes: ["planning"],
      evidence: [],
      relatedRecordIds: [],
      validity: { validFrom: null, validUntil: "2026-01-03T01:00:00Z" },
    });
    const accepted = await f.threeDays();
    expect(accepted).toMatchObject({
      status: "active",
      acceptance: { kind: "evidence_rule" },
      validFrom: "2026-01-03T01:00:00.000Z",
      conflictRecordIds: [],
    });
    expect(await f.read(contrary.recordId)).toMatchObject({ conflictRecordIds: [] });
  });

  it("does not auto-accept through a contrary proposal or allow callers to forge a selection source", async () => {
    const f = await fixture();
    const agent = await agentFor(f.human.userId);
    const contrary = {
      mutationKey: randomUUID(),
      content: knowledgePreferenceContent({ key: "presentation.detail", value: "detailed" }),
      scope: { workspace: null },
      sensitivity: "standard",
      purposes: ["planning"],
      evidence: [],
      relatedRecordIds: [],
    } satisfies KnowledgeMutationInput;
    const result = await f.records.create(agent, contrary);
    const proposal = await f.threeDays();
    expect(proposal).toMatchObject({
      status: "proposed",
      acceptance: null,
      conflictRecordIds: [result.recordId],
    });
    await expect(
      f.records.create(agent, {
        ...contrary,
        mutationKey: randomUUID(),
        evidence: [{ type: "first_party_selection", id: randomUUID() }],
      } as unknown as KnowledgeMutationInput),
    ).rejects.toThrow();
  });

  it("replays a recorded-only event independently of unrelated mutation receipts", async () => {
    const f = await fixture();
    await f.threeDays();
    f.moveTo("2026-01-04T01:00:00Z");
    const recorded = await f.select();
    expect(recorded.result).toEqual({ outcome: "recorded" });
    await f.records.create(f.human, {
      mutationKey: recorded.input.sourceEventId,
      content: knowledgePreferenceContent({ key: "presentation.format", value: "bullets" }),
      scope: { workspace: null },
      sensitivity: "standard",
      purposes: ["planning"],
      evidence: [],
      relatedRecordIds: [],
    });
    expect(await f.learning.recordSelection(f.human, recorded.input)).toEqual(recorded.result);
  });

  it("returns a controlled conflict when a generic receipt already uses a pending interaction ID", async () => {
    const f = await fixture();
    const { sourceEventId } = await f.learning.issueSelectionInteraction(f.human);
    await f.records.create(f.human, {
      mutationKey: sourceEventId,
      content: knowledgePreferenceContent({ key: "presentation.format", value: "bullets" }),
      scope: { workspace: null },
      sensitivity: "standard",
      purposes: ["planning"],
      evidence: [],
      relatedRecordIds: [],
    });
    const epoch = await f.epoch();
    await expect(
      f.learning.recordSelection(f.human, {
        sourceEventId,
        key: "presentation.detail",
        value: "concise",
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await f.epoch()).toBe(epoch);
    const [interaction] = await database.db
      .select()
      .from(knowledgeSelectionInteractions)
      .where(eq(knowledgeSelectionInteractions.id, sourceEventId));
    expect(interaction).toMatchObject({ occurredAt: null });
  });

  it("binds interaction admission to a live human session, strict input and one committed choice", async () => {
    const f = await fixture();
    const anotherSession = await f.session();
    const foreignOwner = await fixture();
    const agent: Principal = { ...f.human, actorType: "agent", actorId: randomUUID() };
    const interaction = await f.learning.issueSelectionInteraction(f.human);
    expect(interaction.expiresAt).toBe("2026-01-01T01:15:00.000Z");
    const valid: KnowledgeSelectionInput = {
      sourceEventId: interaction.sourceEventId,
      key: "presentation.detail",
      value: "concise",
    };
    await expect(f.learning.issueSelectionInteraction(agent)).rejects.toMatchObject({
      status: 403,
    });
    await expect(f.learning.getSettings(agent)).rejects.toMatchObject({ status: 403 });
    await expect(f.learning.recordSelection(agent, valid)).rejects.toMatchObject({ status: 403 });
    await expect(f.learning.recordSelection(anotherSession, valid)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      foreignOwner.learning.recordSelection(foreignOwner.human, valid),
    ).rejects.toMatchObject({ status: 404 });
    for (const invalid of [
      { ...valid, key: "notifications.sending" },
      { ...valid, value: "bullets" },
      { ...valid, occurredAt: "2027-01-01T00:00:00Z" },
      { ...valid, sensitivity: "sensitive" },
    ]) {
      await expect(
        f.learning.recordSelection(f.human, invalid as KnowledgeSelectionInput),
      ).rejects.toThrow();
    }
    await expect(
      f.learning.recordSelection(f.human, { ...valid, sourceEventId: randomUUID() }),
    ).rejects.toMatchObject({ status: 404 });
    const [first, replay] = await Promise.all([
      f.learning.recordSelection(f.human, valid),
      f.learning.recordSelection(f.human, valid),
    ]);
    expect(first).toEqual(replay);
    expect(
      await database.db
        .select()
        .from(knowledgeRecords)
        .where(eq(knowledgeRecords.userId, f.human.userId)),
    ).toHaveLength(1);
    await expect(
      f.learning.recordSelection(f.human, { ...valid, value: "detailed" }),
    ).rejects.toMatchObject({ status: 409 });
    const unused = await f.learning.issueSelectionInteraction(f.human);
    f.moveTo("2026-01-01T01:15:00Z");
    await expect(
      f.learning.recordSelection(f.human, { ...valid, sourceEventId: unused.sourceEventId }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await f.learning.recordSelection(f.human, valid)).toEqual(first);
    await database.db.delete(sessions).where(eq(sessions.id, f.human.sessionId ?? ""));
    await expect(f.learning.recordSelection(f.human, valid)).rejects.toMatchObject({ status: 403 });
  });
});
