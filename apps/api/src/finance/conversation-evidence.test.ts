import { randomUUID } from "node:crypto";
import {
  accessTokens,
  automationHostSchedules,
  type Database,
  executionPolicySettings,
  financeConversationBatches,
  financeConversationCapabilities,
  financeConversationEvidence,
  users,
  workspaceMaintenanceRuns,
} from "@personal-os/database";
import {
  commitFinanceConversationEvidence,
  type FinanceConversationEvidenceInput,
} from "./conversation-evidence.js";
import { guardFinanceExecutionTransaction } from "./execution-owner-guard.js";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
const owner = randomUUID(),
  actor = randomUUID(),
  runId = randomUUID(),
  connection = randomUUID(),
  schedule = randomUUID();
const now = new Date("2026-10-18T12:00:00Z");
const principal = {
  userId: owner,
  actorId: actor,
  actorType: "agent" as const,
  authorizationConnectionId: connection,
  scopes: new Set(["finances:maintain", "finances:write", "finances:execute"] as const),
};
const input: FinanceConversationEvidenceInput = {
  runId,
  caseId: null,
  actionKey: "canonical-action",
  sourceOperationId: null,
  sourceMessageIds: [],
  explanation: "Applied the exact prepared action.",
};

/** Only the database result seam is simulated; actual owner/host/proof/policy guards run. */
async function fixture() {
  const rows = new Map<unknown, unknown[]>([
    [users, [{ id: owner }]],
    [
      workspaceMaintenanceRuns,
      [
        {
          id: runId,
          userId: owner,
          automationScheduleId: schedule,
          authorizationConnectionId: connection,
        },
      ],
    ],
    [
      automationHostSchedules,
      [
        {
          id: schedule,
          userId: owner,
          authorizationConnectionId: connection,
          schedule: { state: "active" },
        },
      ],
    ],
    [
      accessTokens,
      [
        {
          id: actor,
          userId: owner,
          authorizationConnectionId: connection,
          scopes: [...principal.scopes],
          revokedAt: null,
          expiresAt: null,
        },
      ],
    ],
    [
      financeConversationCapabilities,
      [{ generation: 1n, legacyTimestampCount: "1", verifiedAt: now }],
    ],
    [executionPolicySettings, [{ reviewBypassEnabled: true }]],
    [
      financeConversationBatches,
      [{ runId, authorizationConnectionId: connection, automationScheduleId: schedule }],
    ],
    [financeConversationEvidence, []],
  ]);
  let inserted: Record<string, unknown> | undefined;
  let insertMissing = false;
  const query = (table: unknown) => {
    const chain = Object.assign(Promise.resolve(rows.get(table) ?? []), {
      where: () => chain,
      for: () => chain,
      limit: () => chain,
      orderBy: () => chain,
    });
    return chain;
  };
  const tx = {
    select: () => ({ from: query }),
    execute: vi.fn(async () => ({ rows: [] })),
    insert: () => ({
      values: (value: Record<string, unknown>) => {
        inserted = value;
        return { returning: async () => (insertMissing ? [] : [{ id: randomUUID(), ...value }]) };
      },
    }),
  } as unknown as Tx;
  await guardFinanceExecutionTransaction(tx, owner, {
    actorIds: [actor],
    connectionIds: [connection],
  });
  const effect = vi.fn(async () => [{ kind: "audit_event", id: randomUUID() }]);
  const commit = (
    value = input,
    options: Parameters<typeof commitFinanceConversationEvidence>[5] = { candidateItems: [] },
    who = principal,
  ) => commitFinanceConversationEvidence(tx, who, value, effect, now, options);
  return {
    rows,
    tx,
    effect,
    commit,
    inserted: () => inserted,
    missingInsert: () => {
      insertMissing = true;
    },
  };
}

describe("immutable Finance causal evidence", () => {
  it.each([
    { actionKey: " " },
    { actionKey: "x".repeat(201) },
    { explanation: " " },
    { explanation: "x".repeat(4001) },
    { sourceMessageIds: Array.from({ length: 101 }, () => randomUUID()) },
    { sourceMessageIds: [actor, actor] },
  ])("rejects unbounded or ambiguous evidence before any effect: %j", async (patch) => {
    const f = await fixture();
    await expect(f.commit({ ...input, ...patch })).rejects.toMatchObject({
      code: "invalid_request",
    });
    expect(f.effect).not.toHaveBeenCalled();
  });
  it.each([
    "missing",
    "human",
    "connection",
    "schedule",
  ])("rejects unusable run authority: %s", async (variant) => {
    const f = await fixture();
    if (variant === "missing") f.rows.set(workspaceMaintenanceRuns, []);
    if (variant === "connection")
      f.rows.set(workspaceMaintenanceRuns, [
        { id: runId, userId: owner, automationScheduleId: schedule },
      ]);
    if (variant === "schedule")
      f.rows.set(workspaceMaintenanceRuns, [
        { id: runId, userId: owner, authorizationConnectionId: connection },
      ]);
    const who = variant === "human" ? { ...principal, actorType: "user" as const } : principal;
    await expect(
      commitFinanceConversationEvidence(f.tx, who, input, f.effect, now, { candidateItems: [] }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(f.effect).not.toHaveBeenCalled();
  });
  it.each(["proof", "policy", "revoked"])("retains the actual %s guard", async (variant) => {
    const f = await fixture();
    if (variant === "proof")
      f.rows.set(financeConversationCapabilities, [{ generation: 2n, verifiedAt: null }]);
    if (variant === "policy") f.rows.set(executionPolicySettings, [{ reviewBypassEnabled: false }]);
    if (variant === "revoked") f.rows.set(accessTokens, []);
    await expect(f.commit()).rejects.toMatchObject({ code: "forbidden" });
    expect(f.effect).not.toHaveBeenCalled();
  });
  it.each([
    "agent",
    "owner",
    "actor",
  ])("does not accept forged human approval: %s", async (variant) => {
    const f = await fixture();
    const human = {
      ...principal,
      actorType: variant === "agent" ? ("agent" as const) : ("user" as const),
      userId: variant === "owner" ? randomUUID() : owner,
      actorId: variant === "actor" ? actor : owner,
    };
    await expect(
      f.commit(input, {
        candidateItems: [],
        humanApproval: { principal: human, reviewId: randomUUID() },
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(f.effect).not.toHaveBeenCalled();
  });
  it.each([
    "missing",
    "connection",
    "schedule",
  ])("refuses a noncanonical batch: %s", async (variant) => {
    const f = await fixture();
    f.rows.set(
      financeConversationBatches,
      variant === "missing"
        ? []
        : [
            {
              authorizationConnectionId: variant === "connection" ? randomUUID() : connection,
              automationScheduleId: variant === "schedule" ? randomUUID() : schedule,
            },
          ],
    );
    await expect(f.commit()).rejects.toMatchObject({ code: "conflict" });
    expect(f.effect).not.toHaveBeenCalled();
  });
  it("commits actual callback refs and immutable case provenance after exact owner approval without bypass", async () => {
    const f = await fixture();
    f.rows.set(executionPolicySettings, [{ reviewBypassEnabled: false }]);
    const caseId = randomUUID(),
      operation = randomUUID();
    const result = await f.commit(
      { ...input, caseId, sourceOperationId: operation },
      {
        candidateItems: [],
        humanApproval: {
          principal: { ...principal, actorType: "user", actorId: owner },
          reviewId: randomUUID(),
        },
      },
    );
    expect(result.replayed).toBe(false);
    expect(f.effect).toHaveBeenCalledTimes(1);
    expect(f.inserted()).toMatchObject({
      userId: owner,
      caseOwnerId: owner,
      sourceContext: { caseId },
      sourceOperationId: operation,
      createdAt: now,
    });
    expect(result.evidence.effectRefs).toEqual(await f.effect.mock.results[0]?.value);
  });
  it("replays exactly, including deleted live case links, without applying again", async () => {
    const f = await fixture();
    const caseId = randomUUID();
    const existing = { ...input, sourceContext: { caseId }, caseId: null, effectRefs: [] };
    f.rows.set(financeConversationEvidence, [existing]);
    expect(await f.commit({ ...input, caseId })).toEqual({ evidence: existing, replayed: true });
    expect(f.effect).not.toHaveBeenCalled();
  });
  it.each([
    "runId",
    "caseId",
    "actionKey",
    "sourceOperationId",
    "explanation",
    "sourceMessageIds",
  ])("rejects changed immutable replay field %s", async (field) => {
    const f = await fixture();
    const existing = {
      ...input,
      sourceContext: { caseId: field === "caseId" ? randomUUID() : null },
      [field]:
        field === "sourceMessageIds"
          ? [actor]
          : ["runId", "caseId", "sourceOperationId"].includes(field)
            ? randomUUID()
            : "changed",
    };
    f.rows.set(financeConversationEvidence, [existing]);
    await expect(f.commit()).rejects.toMatchObject({ code: "conflict" });
    expect(f.effect).not.toHaveBeenCalled();
  });
  it("propagates effect failure and rejects missing persisted evidence", async () => {
    const f = await fixture();
    f.effect.mockRejectedValueOnce(new Error("effect failed"));
    await expect(f.commit()).rejects.toThrow("effect failed");
    expect(f.inserted()).toBeUndefined();
    f.missingInsert();
    await expect(f.commit()).rejects.toMatchObject({ code: "internal_error" });
  });
  it("validates claimed source membership before applying any financial effect", async () => {
    const f = await fixture();
    f.rows.set(financeConversationBatches, [
      {
        runId,
        authorizationConnectionId: connection,
        automationScheduleId: schedule,
        cutoffSequence: 2n,
      },
    ]);
    await expect(f.commit({ ...input, sourceMessageIds: [randomUUID()] })).rejects.toMatchObject({
      code: "conflict",
    });
    expect(f.effect).not.toHaveBeenCalled();
  });
});
