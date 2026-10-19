import { createHash, randomUUID } from "node:crypto";
import {
  accessTokens,
  automationHostSchedules,
  type Database,
  executionPolicySettings,
  financeAgentActionReviews,
  financeConversationCapabilities,
  financeLedgerChallenges,
  financeMaintenanceCandidateItems,
  financeMaintenanceCandidates,
  financeMaintenanceExecutionBindings,
  financeMutationRecords,
  users,
  workspaceMaintenanceRuns,
  workspaceMaintenanceSteps,
} from "@personal-os/database";
import {
  FINANCE_CONVERSATION_PROTOCOL_VERSION,
  type FinanceMaintenanceControlInput,
} from "@personal-os/domain";
import { AppError } from "../errors.js";
import { createFinanceMaintenanceControlRecovery } from "./maintenance-control-recovery.js";

/** Storage responses only: the production outer owner/token/claim/proof/policy guards execute. */
function fixture() {
  const owner = randomUUID(),
    runId = randomUUID(),
    candidateId = randomUUID(),
    actor = randomUUID(),
    connection = randomUUID(),
    scheduleId = randomUUID(),
    claimId = randomUUID();
  const at = new Date("2026-10-18T12:00:00Z"),
    revision = `sha256:${"a".repeat(64)}`;
  const run = {
    id: runId,
    userId: owner,
    connectionId: connection,
    authorizationConnectionId: connection,
    automationScheduleId: scheduleId,
    status: "running",
    leaseClaimId: claimId,
    leaseExpiresAt: new Date(at.getTime() + 60000) as Date | null,
  };
  const candidate = { id: candidateId, revision, state: "challenged" };
  const binding = {
    original: actor,
    current: actor,
    originalActorId: actor,
    currentActorId: actor,
    bindingRevision: 1n,
    protocolVersion: FINANCE_CONVERSATION_PROTOCOL_VERSION,
  };
  const token = {
    id: actor,
    userId: owner,
    authorizationConnectionId: connection,
    scopes: ["finances:maintain", "finances:write", "finances:execute"],
    revokedAt: null,
    expiresAt: null,
  };
  const challenge = {
    submittingAgentId: actor as string | null,
    actorId: actor,
    state: "resolved",
  };
  const rows = new Map<unknown, unknown[]>([
    [users, [{ id: owner }]],
    [workspaceMaintenanceRuns, [run]],
    [financeMaintenanceCandidates, [candidate]],
    [financeMaintenanceExecutionBindings, [binding]],
    [financeLedgerChallenges, [challenge]],
    [accessTokens, [token]],
    [
      automationHostSchedules,
      [{ id: scheduleId, authorizationConnectionId: connection, schedule: { state: "active" } }],
    ],
    [executionPolicySettings, [{ reviewBypassEnabled: true }]],
    [financeConversationCapabilities, [{ generation: 1n, verifiedAt: at }]],
  ]);
  const queues = new Map<unknown, unknown[][]>(),
    failures = new Map<unknown, Error>();
  const writes: Record<string, unknown>[] = [];
  let casMissing = false;
  const query = (table: unknown) => {
    const result = queues.get(table)?.shift() ?? rows.get(table) ?? [];
    const chain = Object.assign(
      failures.has(table) ? Promise.reject(failures.get(table)) : Promise.resolve(result),
      {
        where: () => chain,
        for: () => chain,
        orderBy: () => chain,
        limit: () => chain,
      },
    );
    return chain;
  };
  const db = {
    select: () => ({ from: query }),
    transaction: async (fn: (tx: unknown) => unknown) => fn({ ...db }),
    execute: async () => ({ rows: [{ at }] }),
    update: () => ({
      set: (value: Record<string, unknown>) => {
        writes.push(value);
        return { where: () => ({ returning: async () => (casMissing ? [] : [{ id: runId }]) }) };
      },
    }),
  } as unknown as Database;
  const input: FinanceMaintenanceControlInput = {
    kind: "submitted_with_binding",
    runId,
    candidateId,
    candidateRevision: revision,
    expectedBindingRevision: "1",
  };
  return {
    rows,
    queues,
    failures,
    writes,
    run,
    candidate,
    binding,
    token,
    challenge,
    input,
    claimId,
    at,
    casLost: () => {
      casMissing = true;
    },
    resume: (value: FinanceMaintenanceControlInput = input, claim = claimId) =>
      createFinanceMaintenanceControlRecovery({ db }).resumeFinanceMaintenanceControl(value, claim),
  };
}

describe("server-only candidate control recovery", () => {
  it("requires an actual owner-scoped run", async () => {
    const f = fixture();
    f.rows.set(workspaceMaintenanceRuns, []);
    await expect(f.resume()).rejects.toMatchObject({ code: "not_found" });
    expect(f.writes).toEqual([]);
  });
  it.each([
    "missing",
    "status",
    "claim",
    "lease",
    "expired",
  ])("never steals an unusable claim: %s", async (variant) => {
    const f = fixture();
    if (variant === "missing") f.queues.set(workspaceMaintenanceRuns, [[f.run], [f.run], []]);
    if (variant === "status") f.run.status = "queued";
    if (variant === "claim") f.run.leaseClaimId = randomUUID();
    if (variant === "lease") f.run.leaseExpiresAt = null;
    if (variant === "expired") f.run.leaseExpiresAt = f.at;
    await expect(f.resume()).rejects.toMatchObject({ code: "conflict" });
    expect(f.writes).toEqual([]);
  });
  it.each(["missing", "revision"])("requires the exact candidate %s", async (variant) => {
    const f = fixture();
    if (variant === "missing") f.rows.set(financeMaintenanceCandidates, []);
    else f.candidate.revision = `sha256:${"b".repeat(64)}`;
    await expect(f.resume()).rejects.toMatchObject({ code: "conflict" });
    expect(f.writes).toEqual([]);
  });
  it("supports the explicit pre-submit control variant without fabricating a binding", async () => {
    const f = fixture(),
      prepared: FinanceMaintenanceControlInput = {
        kind: "prepared_without_binding",
        runId: f.input.runId,
        candidateId: f.input.candidateId,
        candidateRevision: f.input.candidateRevision,
      };
    await expect(f.resume(prepared)).rejects.toMatchObject({ code: "conflict" });
    f.rows.set(financeMaintenanceExecutionBindings, []);
    expect(await f.resume(prepared)).toEqual({ state: "continue" });
    expect(f.writes).toEqual([]);
  });
  it.each(["missing", "revision", "protocol"])("fails closed on binding %s", async (variant) => {
    const f = fixture();
    if (variant === "missing") f.rows.set(financeMaintenanceExecutionBindings, []);
    if (variant === "revision") f.binding.bindingRevision = 2n;
    if (variant === "protocol") f.binding.protocolVersion = "obsolete";
    if (variant === "protocol")
      expect(await f.resume()).toEqual({
        state: "reconciliation_required",
        reason: "protocol_version_changed",
      });
    else await expect(f.resume()).rejects.toMatchObject({ code: "conflict" });
    expect(f.writes).toEqual([]);
  });
  it.each([
    "committing",
    "committed",
    "partial-items",
    "ambiguous-receipt",
  ])("never repeats ambiguous economic work: %s", async (variant) => {
    const f = fixture();
    if (variant === "partial-items")
      f.rows.set(financeMaintenanceCandidateItems, [{ id: randomUUID() }]);
    else if (variant === "ambiguous-receipt")
      f.rows.set(financeMutationRecords, [{ response: null }]);
    else f.candidate.state = variant;
    expect(await f.resume()).toEqual({
      state: "reconciliation_required",
      reason: "economic_reconciliation_required",
    });
    expect(f.writes).toEqual([]);
  });
  it("allows only derived completion after a fully correlated committed receipt, even without a live token", async () => {
    const f = fixture(),
      id = randomUUID();
    f.candidate.state = "committed";
    f.rows.set(accessTokens, []);
    const receipt = {
      id,
      runId: f.run.id,
      candidateId: f.candidate.id,
      candidateRevision: f.candidate.revision,
      automationScheduleId: f.run.automationScheduleId,
      authorizationConnectionId: f.run.authorizationConnectionId,
      committedAt: f.at.toISOString(),
      requestId: `finance-candidate-effect:${id}`,
      originRequestId: "original",
      actor: { type: "agent", id: f.token.id },
      authorityBasis: "original_live_grant",
      humanApproval: null,
      sourceMessageIds: [],
      explanation: "Canonical no-change candidate",
      auditEventIds: [],
      recordRefs: [],
      outcome: "committed",
      actionFamilies: [],
      status: "no_changes",
      significance: "routine",
    };
    f.rows.set(financeMutationRecords, [
      { id, actorId: f.token.id, actorType: "agent", response: { financeEffectReceipt: receipt } },
    ]);
    expect(await f.resume()).toEqual({ state: "continue", reason: "committed_derived_completion" });
    for (const key of [
      "id",
      "runId",
      "candidateId",
      "candidateRevision",
      "automationScheduleId",
      "authorizationConnectionId",
      "requestId",
    ] as const) {
      f.rows.set(financeMutationRecords, [
        {
          id,
          actorId: f.token.id,
          actorType: "agent",
          response: {
            financeEffectReceipt: {
              ...receipt,
              [key]: key === "candidateRevision" ? `sha256:${"b".repeat(64)}` : randomUUID(),
            },
          },
        },
      ]);
      expect(await f.resume()).toEqual({
        state: "reconciliation_required",
        reason: "economic_reconciliation_required",
      });
    }
    for (const mismatchedActor of [
      { id: randomUUID(), type: "agent" },
      { id: f.token.id, type: "user" },
    ]) {
      f.rows.set(financeMutationRecords, [
        {
          id,
          actorId: f.token.id,
          actorType: "agent",
          response: { financeEffectReceipt: { ...receipt, actor: mismatchedActor } },
        },
      ]);
      expect(await f.resume()).toEqual({
        state: "reconciliation_required",
        reason: "economic_reconciliation_required",
      });
      expect(f.writes).toEqual([]);
    }
    expect(f.writes).toEqual([]);
  });
  it("retains actual live execution authority and propagates unexpected authority storage failures", async () => {
    const f = fixture();
    expect(await f.resume()).toEqual({ state: "continue" });
    expect(f.writes).toEqual([]);
    for (const error of [
      new Error("storage failed"),
      new AppError("internal_error", "storage failed"),
    ]) {
      f.failures.set(executionPolicySettings, error);
      await expect(f.resume()).rejects.toBe(error);
    }
  });
  it.each([
    "state",
    "challenge",
    "actor",
  ])("reports missing control evidence after grant loss: %s", async (variant) => {
    const f = fixture();
    f.rows.set(accessTokens, []);
    if (variant === "state") f.candidate.state = "preparing";
    if (variant === "challenge") f.rows.set(financeLedgerChallenges, []);
    if (variant === "actor") f.challenge.submittingAgentId = null;
    expect(await f.resume()).toEqual({
      state: "reconciliation_required",
      reason: "control_evidence_missing",
    });
    expect(f.writes).toEqual([]);
  });
  it.each([
    undefined,
    {},
    { candidateId: "other" },
  ])("resolves only control metadata before release when the saved resolve step is missing/stale", async (saved) => {
    const f = fixture();
    f.rows.set(accessTokens, []);
    f.rows.set(workspaceMaintenanceSteps, saved ? [{ safeResult: saved }] : []);
    expect(await f.resume()).toEqual({
      state: "continue",
      reason: "control_only_challenge_resolve",
    });
    expect(f.writes).toEqual([]);
  });
  it("releases only the exact claim after canonical challenge resolution and rejects a lost release CAS", async () => {
    const f = fixture();
    f.rows.set(accessTokens, []);
    f.rows.set(workspaceMaintenanceSteps, [
      { safeResult: { candidateId: f.candidate.id, candidateRevision: f.candidate.revision } },
    ]);
    expect(await f.resume()).toEqual({ state: "released" });
    expect(f.writes[0]).toMatchObject({
      status: "awaiting_agent_challenge",
      leaseClaimId: null,
      leaseExpiresAt: null,
      checkpoint: {
        phase: "challenge",
        candidateId: f.candidate.id,
        revision: f.candidate.revision,
      },
    });
    f.casLost();
    await expect(f.resume()).rejects.toMatchObject({ code: "conflict" });
  });
  function approvalFixture() {
    const f = fixture();
    f.candidate.state = "awaiting_approval";
    f.rows.set(accessTokens, []);
    const fingerprints = ["first", "second"];
    f.queues.set(financeMaintenanceCandidateItems, [
      [],
      fingerprints.map((fingerprint) => ({ fingerprint })),
    ]);
    const payload = {
      candidateId: f.candidate.id,
      runId: f.run.id,
      expectedRevision: f.candidate.revision,
      itemFingerprints: fingerprints,
    };
    const review = {
      id: randomUUID(),
      payload,
      fingerprint: `sha256:${createHash("sha256")
        .update(
          JSON.stringify({
            candidateId: f.candidate.id,
            expectedRevision: f.candidate.revision,
            items: fingerprints,
          }),
        )
        .digest("hex")}`,
    };
    f.rows.set(financeAgentActionReviews, [review]);
    return { ...f, review };
  }
  it("retains exact pending approve-each provenance while releasing only scheduling control", async () => {
    const f = approvalFixture();
    expect(await f.resume()).toEqual({ state: "released" });
    expect(f.writes[0]).toMatchObject({
      status: "awaiting_approval",
      checkpoint: { phase: "approval" },
      leaseClaimId: null,
      leaseExpiresAt: null,
    });
  });
  it.each([
    "missing",
    "payload",
    "candidate",
    "run",
    "revision",
    "items",
    "fingerprint",
  ])("does not adopt ambiguous approval evidence: %s", async (variant) => {
    const f = approvalFixture();
    if (variant === "missing") f.rows.set(financeAgentActionReviews, []);
    if (variant === "payload")
      f.rows.set(financeAgentActionReviews, [{ ...f.review, payload: undefined }]);
    if (variant === "candidate") f.review.payload.candidateId = randomUUID();
    if (variant === "run") f.review.payload.runId = randomUUID();
    if (variant === "revision") f.review.payload.expectedRevision = `sha256:${"b".repeat(64)}`;
    if (variant === "items") f.review.payload.itemFingerprints = [];
    if (variant === "fingerprint") f.review.fingerprint = "different";
    expect(await f.resume()).toEqual({
      state: "reconciliation_required",
      reason: "control_evidence_missing",
    });
    expect(f.writes).toEqual([]);
  });
});
