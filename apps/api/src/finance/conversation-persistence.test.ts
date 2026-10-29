import { randomUUID } from "node:crypto";
import {
  accessTokens,
  automationHostSchedules,
  type Database,
  executionPolicySettings,
  financeAccounts,
  financeContextualQuestions,
  financeConversationBatches,
  financeConversationBatchMessages,
  financeConversationCapabilities,
  financeConversationMessages,
  financeConversationReadCursors,
  financeConversations,
  financeReviewCases,
  financeTransactions,
  users,
  workspaceMaintenanceRuns,
} from "@personal-os/database";
import { FINANCE_CONVERSATION_PROTOCOL_VERSION } from "@personal-os/domain";
import { AppError } from "../errors.js";
import { createFinanceConversationService } from "./conversation-persistence.js";
import { conversationNonceDigest, encodeConversationBatchCursor } from "./conversation-service.js";

const owner = randomUUID(),
  actor = randomUUID(),
  connection = randomUUID(),
  scheduleId = randomUUID();
const now = new Date("2026-10-18T12:00:00Z");
const human = {
  userId: owner,
  actorId: owner,
  actorType: "user" as const,
  scopes: new Set(["finances:read", "finances:write"] as const),
};
const agent = {
  ...human,
  actorId: actor,
  actorType: "agent" as const,
  authorizationConnectionId: connection,
  scopes: new Set([
    "finances:read",
    "finances:write",
    "finances:execute",
    "finances:maintain",
  ] as const),
};
const unboundAgent = {
  ...human,
  actorId: actor,
  actorType: "agent" as const,
  scopes: agent.scopes,
};
const input = {
  text: "Saved owner context",
  caseId: null,
  recordRefs: [],
  idempotencyKey: "owner-message",
};
function message(sequence = 1n, patch: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    userId: owner,
    sequence,
    authorKind: "user",
    text: input.text,
    caseId: null as string | null,
    recordRefs: [],
    sourceMessageIds: [] as string[],
    runId: null as string | null,
    createdAt: now,
    idempotencyKey: input.idempotencyKey,
    ...patch,
  };
}
/** Table-aware storage seam. All authority and readiness helpers remain real. */
function fixture(active = false) {
  const token = {
    id: actor,
    userId: owner,
    authorizationConnectionId: connection,
    scopes: [...agent.scopes],
    revokedAt: null,
    expiresAt: null,
  };
  const schedule = {
    id: scheduleId,
    userId: owner,
    connectionId: connection,
    authorizationConnectionId: connection,
    updatedAt: now,
    schedule: {
      id: scheduleId,
      tenantAuthorizationConnectionId: connection,
      label: "Conversation host",
      hostSurface: "codex_desktop",
      hostAutomationId: "fixture" as string | null,
      effectiveScopes: [...agent.scopes],
      state: "active",
      trigger: {
        type: "recurring",
        recurrence: { type: "interval", everyMinutes: 60, timeZone: "UTC" },
      },
      lastObservedAt: now.toISOString(),
      nextExpectedAt: now.toISOString() as string | null,
      version: 1,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
  };
  const rows = new Map<unknown, unknown[]>([
    [users, [{ id: owner }]],
    [automationHostSchedules, active ? [schedule] : []],
    [accessTokens, [token]],
    [executionPolicySettings, [{ reviewBypassEnabled: true }]],
    [
      financeConversationCapabilities,
      [
        {
          id: randomUUID(),
          generation: 1n,
          legacyTimestampCount: "1",
          protocolVersion: FINANCE_CONVERSATION_PROTOCOL_VERSION,
          verifiedAt: now,
          expiresAt: new Date(now.getTime() + 60000),
        },
      ],
    ],
    [financeConversationMessages, []],
    [financeConversations, [{ nextSequence: 5n }]],
  ]);
  const queues = new Map<unknown, unknown[][]>();
  const failures = new Map<unknown, Error>();
  const inserted = new Map<unknown, unknown[]>();
  const omitInsert = new Set<unknown>();
  const omitUpdate = new Set<unknown>();
  const updates = new Map<unknown, Record<string, unknown>>();
  const query = (table: unknown) => {
    const result = () => queues.get(table)?.shift() ?? rows.get(table) ?? [];
    const chain = Object.assign(
      failures.has(table) ? Promise.reject(failures.get(table)) : Promise.resolve(result()),
      {
        where: () => chain,
        for: () => chain,
        limit: () => chain,
        orderBy: () => chain,
        innerJoin: () => chain,
      },
    );
    return chain;
  };
  const db = {
    select: () => ({ from: query }),
    execute: vi.fn(async () => ({ rows: [] })),
    update: (table: unknown) => ({
      set: (value: Record<string, unknown>) => {
        updates.set(table, value);
        const chain = Object.assign(Promise.resolve(), {
          where: () => chain,
          returning: async () => (omitUpdate.has(table) ? [] : [{ id: randomUUID() }]),
        });
        return chain;
      },
    }),
    transaction: async (run: (tx: unknown) => Promise<unknown>) => run(db),
    insert: (table: unknown) => ({
      values: (value: Record<string, unknown>) => {
        inserted.set(table, [...(inserted.get(table) ?? []), value]);
        const chain = {
          onConflictDoUpdate: () => chain,
          returning: async () =>
            omitInsert.has(table) ? [] : [{ id: randomUUID(), nextSequence: 6n, ...value }],
        };
        return chain;
      },
    }),
  } as unknown as Database;
  return {
    service: createFinanceConversationService({ db, now: () => now }),
    rows,
    queues,
    failures,
    inserted,
    omitInsert,
    omitUpdate,
    updates,
    token,
    schedule,
  };
}

describe("Finance conversation persisted boundaries", () => {
  it.each([
    0,
    -1,
    101,
    1.5,
    Number.NaN,
  ])("rejects invalid history and batch page size %s", async (limit) => {
    const f = fixture();
    await expect(f.service.history(owner, "0", limit)).rejects.toMatchObject({
      code: "invalid_request",
    });
    await expect(f.service.pageBatch(agent, randomUUID(), "0", limit)).rejects.toMatchObject({
      code: "invalid_request",
    });
  });
  it("serializes bigint sequences and original deleted case refs across paginated history", async () => {
    const f = fixture();
    const caseId = randomUUID();
    f.rows.set(financeConversationMessages, [
      message(9007199254740993n, { recordRefs: [{ kind: "review_case", id: caseId }] }),
      message(9007199254740994n),
    ]);
    const page = await f.service.history(owner, "0", 1);
    expect(page.nextCursor).toBe("9007199254740993");
    expect(page.messages[0]).toMatchObject({
      caseId,
      sequence: "9007199254740993",
      createdAt: now.toISOString(),
    });
    f.rows.set(financeConversationMessages, []);
    expect(await f.service.history(owner)).toEqual({ messages: [], nextCursor: null });
  });
  it("returns source context in order and fails closed when the owner-scoped target is absent", async () => {
    const f = fixture();
    const target = message(12n),
      before = message(11n),
      first = message(10n),
      after = message(13n);
    f.queues.set(financeConversationMessages, [[target], [before, first], [after]]);
    expect(
      (await f.service.messageContext(owner, target.id)).messages.map((row) => row.sequence),
    ).toEqual(["10", "11", "12", "13"]);
    await expect(f.service.messageContext(owner, randomUUID())).rejects.toMatchObject({
      code: "not_found",
    });
  });
  it.each([
    agent,
    { ...human, actorId: actor },
  ])("rejects nonowner send and rendered-read authority", async (principal) => {
    const f = fixture();
    await expect(f.service.send(principal, input)).rejects.toMatchObject({ code: "forbidden" });
    await expect(f.service.markRendered(principal, "1")).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(f.inserted.size).toBe(0);
  });
  it("keeps rendered reads bounded to saved sequences, including a missing conversation", async () => {
    const f = fixture();
    await expect(f.service.markRendered(human, "6")).rejects.toMatchObject({ code: "conflict" });
    f.rows.set(financeConversations, []);
    await expect(f.service.markRendered(human, "1")).rejects.toMatchObject({ code: "conflict" });
    expect(await f.service.markRendered(human, "0")).toEqual({ readThroughSequence: "0" });
    f.rows.set(financeConversations, [{ nextSequence: 5n }]);
    expect(await f.service.markRendered(human, "3")).toEqual({ readThroughSequence: "3" });
    f.omitInsert.add(financeConversationReadCursors);
    expect(await f.service.markRendered(human, "2")).toEqual({ readThroughSequence: "0" });
  });
  it.each(["text", "case", "refs"])("rejects changed user replay %s", async (field) => {
    const f = fixture();
    f.rows.set(financeConversationMessages, [
      message(
        1n,
        field === "text"
          ? { text: "changed" }
          : field === "case"
            ? { caseId: randomUUID() }
            : { recordRefs: [{ kind: "account", id: randomUUID() }] },
      ),
    ]);
    await expect(f.service.send(human, input)).rejects.toMatchObject({ code: "conflict" });
  });
  it("replays immutable owner content even when sending is locked", async () => {
    const f = fixture();
    const saved = message();
    f.rows.set(financeConversationMessages, [saved]);
    expect(await f.service.send(human, input)).toMatchObject({ id: saved.id, sequence: "1" });
    expect(f.inserted.size).toBe(0);
    f.rows.set(financeConversationMessages, []);
    await expect(f.service.send(human, input)).rejects.toMatchObject({ code: "conflict" });
  });
  it.each([
    "active",
    "paused",
    "setup_pending",
    "revoked",
  ])("projects registration %s without treating enrollment as proof", async (state) => {
    const f = fixture(true);
    f.schedule.schedule.state = state;
    if (state !== "active") f.schedule.schedule.nextExpectedAt = null;
    if (state === "setup_pending") f.schedule.schedule.hostAutomationId = null;
    f.rows.set(financeConversationCapabilities, [
      {
        generation: 2n,
        protocolVersion: FINANCE_CONVERSATION_PROTOCOL_VERSION,
        verifiedAt: null,
        expiresAt: new Date(now.getTime() + 60000),
      },
    ]);
    const readiness = await f.service.getHostReadiness(owner, scheduleId);
    expect(readiness.canSend).toBe(false);
    expect(readiness.registrationState).toBe(state === "setup_pending" ? "missing" : state);
  });
  it.each([
    "verified",
    "expired",
    "missing",
    "upgrade",
    "disconnected",
    "policy",
    "scope",
  ])("projects actual message capability / authority %s", async (variant) => {
    const f = fixture(true);
    if (variant === "expired")
      f.rows.set(financeConversationCapabilities, [
        {
          generation: 2n,
          verifiedAt: null,
          protocolVersion: FINANCE_CONVERSATION_PROTOCOL_VERSION,
          expiresAt: new Date(0),
        },
      ]);
    if (variant === "missing") f.rows.set(financeConversationCapabilities, []);
    if (variant === "upgrade")
      f.queues.set(financeConversationCapabilities, [[], [{ id: randomUUID() }]]);
    if (variant === "disconnected") f.rows.set(accessTokens, []);
    if (variant === "policy") f.rows.set(executionPolicySettings, [{ reviewBypassEnabled: false }]);
    if (variant === "scope") f.token.scopes = ["finances:read"];
    const readiness = await f.service.getReadiness(owner);
    expect(readiness.canSend).toBe(variant === "verified");
  });
  it("has readable missing enrollment and rejects a missing specific host", async () => {
    const f = fixture();
    expect(await f.service.getReadiness(owner)).toMatchObject({
      historyReadable: true,
      canSend: false,
    });
    await expect(f.service.getHostReadiness(owner, scheduleId)).rejects.toMatchObject({
      code: "not_found",
    });
  });
  it.each([
    "transaction",
    "account",
    "review_case",
    "contextual_question",
  ] as const)("validates owner context reference %s before writing", async (kind) => {
    const f = fixture(true),
      id = randomUUID();
    const table =
      kind === "transaction"
        ? financeTransactions
        : kind === "account"
          ? financeAccounts
          : kind === "review_case"
            ? financeReviewCases
            : financeContextualQuestions;
    await expect(
      f.service.send(human, { ...input, recordRefs: [{ kind, id }] }),
    ).rejects.toMatchObject({ code: "not_found" });
    expect(f.inserted.size).toBe(0);
    expect(f.updates.size).toBe(0);
    f.rows.set(table, [{ id }]);
    expect(await f.service.send(human, { ...input, recordRefs: [{ kind, id }] })).toMatchObject({
      recordRefs: [{ kind, id }],
    });
  });
  it("adds immutable case provenance and rejects missing sequence or message writes", async () => {
    const f = fixture(true),
      id = randomUUID();
    await expect(f.service.send(human, { ...input, caseId: id })).rejects.toMatchObject({
      code: "not_found",
    });
    expect(f.inserted.size).toBe(0);
    expect(f.updates.size).toBe(0);
    f.rows.set(financeReviewCases, [{ id }]);
    expect(await f.service.send(human, { ...input, caseId: id })).toMatchObject({
      caseId: id,
      recordRefs: [{ kind: "review_case", id }],
    });
    f.omitInsert.add(financeConversations);
    await expect(f.service.send(human, input)).rejects.toMatchObject({ code: "internal_error" });
    f.omitInsert.delete(financeConversations);
    f.omitInsert.add(financeConversationMessages);
    await expect(f.service.send(human, input)).rejects.toMatchObject({ code: "internal_error" });
  });
  it("rejects bounded delivery / reply misuse and inaccessible run or challenge", async () => {
    const f = fixture();
    await expect(
      f.service.acknowledgeBatch(agent, randomUUID(), Array(101).fill(actor)),
    ).rejects.toMatchObject({ code: "invalid_request" });
    for (const ids of [[], Array(101).fill(actor)])
      await expect(
        f.service.reply(agent, { runId: randomUUID(), ...input, sourceMessageIds: ids }),
      ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(f.service.pageBatch(agent, randomUUID())).rejects.toMatchObject({
      code: "not_found",
    });
    f.rows.set(workspaceMaintenanceRuns, [{ id: randomUUID() }]);
    await expect(f.service.pageBatch(agent, randomUUID())).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(f.service.issueChallenge(human, scheduleId)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(
      f.service.advanceChallenge(agent, randomUUID(), { kind: "fetch" }),
    ).rejects.toMatchObject({ code: "not_found" });
  });
  function batchFixture() {
    const f = fixture(true),
      runId = randomUUID();
    f.rows.set(workspaceMaintenanceRuns, [
      {
        id: runId,
        userId: owner,
        automationScheduleId: scheduleId,
        authorizationConnectionId: connection,
      },
    ]);
    const saved = {
      runId,
      automationScheduleId: scheduleId,
      authorizationConnectionId: connection,
      cutoffSequence: 5n,
      capturedAt: now,
      cursorKey: "private-test-cursor-key",
    };
    f.rows.set(financeConversationBatches, [saved]);
    return { ...f, runId, saved };
  }
  it("delivers only the requested batch page, signs retry cursors and does not conflate delivery with acknowledgment", async () => {
    const f = batchFixture(),
      first = message(1n),
      second = message(2n);
    f.rows.set(financeConversationBatchMessages, [{ message: first }, { message: second }]);
    const result = await f.service.pageBatch(agent, f.runId, "0", 1);
    expect(result.messages.map((row) => row.id)).toEqual([first.id]);
    expect(result.nextCursor).toEqual(expect.any(String));
    expect(f.updates.get(financeConversationBatchMessages)).toHaveProperty("deliveredAt");
    expect(f.updates.get(financeConversationBatchMessages)).not.toHaveProperty("acknowledgedAt");
    f.rows.set(financeConversationBatchMessages, []);
    expect(await f.service.pageBatch(agent, f.runId, result.nextCursor ?? "0")).toMatchObject({
      messages: [],
      nextCursor: null,
    });
    const cursor = encodeConversationBatchCursor(owner, result.batch, "6", f.saved.cursorKey);
    await expect(f.service.pageBatch(agent, f.runId, cursor)).rejects.toMatchObject({
      code: "invalid_request",
    });
  });
  it("requires the captured batch and its private cursor record", async () => {
    const f = batchFixture();
    f.rows.set(financeConversationBatches, []);
    await expect(f.service.pageBatch(agent, f.runId)).rejects.toMatchObject({ code: "conflict" });
    f.queues.set(financeConversationBatches, [[f.saved], []]);
    await expect(f.service.pageBatch(agent, f.runId)).rejects.toMatchObject({ code: "conflict" });
  });
  it("acknowledges only exact delivered IDs, including an empty page", async () => {
    const f = batchFixture(),
      id = randomUUID();
    expect(await f.service.acknowledgeBatch(agent, f.runId, [])).toEqual({
      acknowledgedMessageIds: [],
    });
    await expect(f.service.acknowledgeBatch(agent, f.runId, [id])).rejects.toMatchObject({
      code: "conflict",
    });
    f.rows.set(financeConversationBatchMessages, [{ id }]);
    expect(await f.service.acknowledgeBatch(agent, f.runId, [id])).toEqual({
      acknowledgedMessageIds: [id],
    });
    expect(f.updates.get(financeConversationBatchMessages)).toHaveProperty("acknowledgedAt");
  });
  it("persists a reply only to actually delivered sources and retains case provenance", async () => {
    const f = batchFixture(),
      caseId = randomUUID(),
      source = message(1n, { caseId });
    const reply = {
      runId: f.runId,
      text: "Reply",
      idempotencyKey: "reply",
      sourceMessageIds: [source.id],
      caseId,
    };
    await expect(f.service.reply(agent, reply)).rejects.toMatchObject({ code: "conflict" });
    f.rows.set(financeConversationBatchMessages, [{ message: source }]);
    await expect(f.service.reply(agent, { ...reply, caseId: randomUUID() })).rejects.toMatchObject({
      code: "conflict",
    });
    expect(await f.service.reply(agent, reply)).toMatchObject({
      authorKind: "agent",
      sourceMessageIds: [source.id],
      caseId,
      recordRefs: [{ kind: "review_case", id: caseId }],
    });
    f.omitInsert.add(financeConversationMessages);
    await expect(f.service.reply(agent, { ...reply, caseId: null })).rejects.toMatchObject({
      code: "internal_error",
    });
  });
  it.each([
    "run",
    "text",
    "case",
    "sources",
    "exact",
  ])("compares immutable reply replay %s", async (variant) => {
    const f = batchFixture(),
      source = message(1n),
      text = "Reply";
    f.rows.set(financeConversationBatchMessages, [{ message: source }]);
    const saved = message(2n, {
      authorKind: "agent",
      text,
      runId: f.runId,
      sourceMessageIds: [source.id],
      idempotencyKey: "reply",
    });
    if (variant === "run") saved.runId = randomUUID();
    if (variant === "text") saved.text = "Different";
    if (variant === "case") saved.caseId = randomUUID();
    if (variant === "sources") saved.sourceMessageIds = [randomUUID()];
    f.rows.set(financeConversationMessages, [saved]);
    const replying = f.service.reply(agent, {
      runId: f.runId,
      text,
      idempotencyKey: "reply",
      sourceMessageIds: [source.id],
    });
    if (variant === "exact") expect(await replying).toMatchObject({ id: saved.id });
    else await expect(replying).rejects.toMatchObject({ code: "conflict" });
    expect(f.inserted.size).toBe(0);
  });
  it.each([
    "grant",
    "inactive",
    "agent",
    "wrong-owner",
  ])("does not issue a challenge without enrollment authority: %s", async (variant) => {
    const f = fixture(true);
    if (variant === "grant") f.rows.set(accessTokens, []);
    if (variant === "inactive") f.schedule.schedule.state = "paused";
    await expect(
      f.service.issueChallenge(
        variant === "agent"
          ? agent
          : variant === "wrong-owner"
            ? { ...human, actorId: actor }
            : human,
        scheduleId,
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
  it.each([
    null,
    "3",
    "9223372036854775807",
  ])("issues only the canonical next generation, previous=%s", async (previous) => {
    const f = fixture(true);
    f.rows.set(financeConversationCapabilities, [{ value: previous }]);
    if (previous === "9223372036854775807") {
      await expect(f.service.issueChallenge(human, scheduleId)).rejects.toMatchObject({
        code: "conflict",
      });
      expect(f.inserted.size).toBe(0);
      return;
    }
    const issued = await f.service.issueChallenge(human, scheduleId);
    expect(issued.expiresAt).toBe(new Date(now.getTime() + 600000).toISOString());
    expect(issued.nonce).toMatch(/^[a-f0-9]{64}$/);
    expect(f.inserted.get(financeConversationCapabilities)?.[0]).toMatchObject({
      generation: previous === null ? 1n : 4n,
      createdAt: now,
      nonceDigest: conversationNonceDigest(issued.nonce),
    });
    f.omitInsert.add(financeConversationCapabilities);
    await expect(f.service.issueChallenge(human, scheduleId)).rejects.toMatchObject({
      code: "internal_error",
    });
  });
  function challengeFixture(generation: bigint | null = 1n) {
    const f = fixture(true),
      id = randomUUID();
    const proof = {
      id,
      userId: owner,
      automationScheduleId: scheduleId,
      authorizationConnectionId: connection,
      protocolVersion: FINANCE_CONVERSATION_PROTOCOL_VERSION,
      generation,
      legacyTimestampCount: "1",
      nonceDigest: conversationNonceDigest("nonce"),
      challengeText: "nonce",
      expiresAt: new Date(now.getTime() + 600000),
      fetchedAt: null as Date | null,
      acknowledgedAt: null as Date | null,
      respondedAt: null as Date | null,
      verifiedAt: null as Date | null,
      response: null as string | null,
    };
    f.rows.set(financeConversationCapabilities, [proof]);
    return { ...f, proof };
  }
  it.each([
    1n,
    null,
  ])("persists exact challenge fetch/ack/response with generation %s", async (generation) => {
    const f = challengeFixture(generation);
    expect(await f.service.advanceChallenge(agent, f.proof.id, { kind: "fetch" })).toMatchObject({
      nonce: "nonce",
      verified: false,
    });
    f.proof.fetchedAt = now;
    expect(
      await f.service.advanceChallenge(agent, f.proof.id, {
        kind: "acknowledge",
        challengeId: f.proof.id,
        nonce: "nonce",
      }),
    ).toMatchObject({ verified: false });
    f.proof.acknowledgedAt = now;
    expect(
      await f.service.advanceChallenge(agent, f.proof.id, {
        kind: "respond",
        challengeId: f.proof.id,
        response: "Harmless protocol response",
      }),
    ).toMatchObject({ verified: true });
    expect(f.updates.get(financeConversationCapabilities)).toMatchObject({
      verifiedAt: now,
      response: "Harmless protocol response",
    });
    f.omitUpdate.add(financeConversationCapabilities);
    await expect(
      f.service.advanceChallenge(agent, f.proof.id, { kind: "fetch" }),
    ).rejects.toMatchObject({ code: "conflict" });
  });
  it.each([
    "human",
    "missing-token",
    "scope",
    "new-generation",
    "missing-latest",
    "wrong-connection",
    "inactive",
  ])("fails closed on challenge authority change %s", async (variant) => {
    const f = challengeFixture();
    if (variant === "missing-token") f.rows.set(accessTokens, []);
    if (variant === "scope") f.token.scopes = ["finances:read"];
    if (variant === "new-generation")
      f.queues.set(financeConversationCapabilities, [
        [f.proof],
        [{ ...f.proof, id: randomUUID(), generation: 2n }],
      ]);
    if (variant === "missing-latest")
      f.queues.set(financeConversationCapabilities, [[f.proof], []]);
    if (variant === "inactive") f.schedule.schedule.state = "paused";
    const who =
      variant === "human"
        ? human
        : variant === "wrong-connection"
          ? { ...agent, authorizationConnectionId: randomUUID() }
          : agent;
    await expect(
      f.service.advanceChallenge(who, f.proof.id, { kind: "fetch" }),
    ).rejects.toMatchObject({
      code: variant === "new-generation" || variant === "missing-latest" ? "conflict" : "forbidden",
    });
    expect(f.updates.size).toBe(0);
  });
  it.each([
    new Error("policy storage unavailable"),
    new AppError("internal_error", "policy storage unavailable"),
  ])("propagates policy storage failures rather than reporting a disconnected host", async (error) => {
    const f = fixture(true);
    f.failures.set(executionPolicySettings, error);
    await expect(f.service.getReadiness(owner)).rejects.toBe(error);
  });
  it.each([
    "human",
    "missing-connection",
  ])("denies all batch operations to unusable host principal %s", async (kind) => {
    const principals = kind === "human" ? human : unboundAgent;
    for (const operation of ["page", "acknowledge", "reply"] as const) {
      const f = batchFixture();
      const result =
        operation === "page"
          ? f.service.pageBatch(principals, f.runId)
          : operation === "acknowledge"
            ? f.service.acknowledgeBatch(principals, f.runId, [])
            : f.service.reply(principals, {
                runId: f.runId,
                text: "Reply",
                idempotencyKey: "reply",
                sourceMessageIds: [randomUUID()],
              });
      await expect(result).rejects.toMatchObject({ code: "forbidden" });
      expect(f.inserted.size).toBe(0);
    }
  });
  it("rejects absent challenges and an agent with no authenticated connection binding", async () => {
    const f = challengeFixture();
    f.rows.set(financeConversationCapabilities, []);
    await expect(
      f.service.advanceChallenge(agent, f.proof.id, { kind: "fetch" }),
    ).rejects.toMatchObject({ code: "not_found" });
    f.rows.set(financeConversationCapabilities, [f.proof]);
    await expect(
      f.service.advanceChallenge(unboundAgent, f.proof.id, {
        kind: "fetch",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(f.updates.size).toBe(0);
  });
});
