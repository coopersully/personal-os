import { financePositionFactNames } from "@personal-os/domain";
import { createFinanceMaintenanceService } from "./finance-maintenance-service.js";

function fixture() {
  const id = "11111111-1111-4111-8111-111111111111";
  const revision = `sha256:${"a".repeat(64)}`;
  const fence = {
    currentActorId: id,
    bindingRevision: "3",
    candidateId: id,
    candidateRevision: revision,
  };
  const run = {
    id,
    userId: id,
    domain: "finances",
    scope: { type: "all_outstanding" },
    rulebookVersion: revision,
    status: "running",
    checkpoint: { phase: "challenge", candidateId: id, revision },
  };
  const fact = { quality: "verified", reasons: [], cents: 100, currency: "USD", sources: [] };
  const position = {
    revision,
    scope: { accountIds: [], from: "2026-10-01", through: "2026-10-31" },
    ...Object.fromEntries(financePositionFactNames.map((name) => [name, fact])),
  };
  const checkpoint = {
    revision,
    scope: position.scope,
    facts: Object.fromEntries(
      financePositionFactNames.map((name) => [name, { quality: "verified", reasons: [] }]),
    ),
  };
  const budget = {
    positionRevision: revision,
    state: "not_applicable",
    reasonCode: null,
    evaluations: [],
  };
  const records: Array<{ step: string; status: string; result: unknown }> = [
    {
      step: "budget_and_health_projection",
      status: "completed",
      result: { position: checkpoint, budget },
    },
    {
      step: "challenge_resolve",
      status: "completed",
      result: { candidateId: id, candidateRevision: revision, questions: 1 },
    },
  ];
  const forbidden = vi.fn(async () => {
    throw new Error(
      "Economic/source/question work must not execute during committed control completion",
    );
  });
  const health = vi.fn(async () => ({ refreshed: true }));
  const period = vi.fn(async () => ({ id, status: "completed" }));
  const control = vi.fn(async () => ({
    state: "continue",
    reason: "committed_derived_completion",
  }));
  const release = vi.fn(async () => ({ ...run, status: "failed_recoverable" }));
  const options = {
    actions: {
      getMaintenanceExecutionFence: vi.fn(async () => fence),
      resumeFinanceMaintenanceControl: control,
      settleFinanceMaintenanceCandidate: forbidden,
    },
    finances: {
      beginMaintenanceCandidatePreparation: forbidden,
      appendMaintenanceCandidatePage: forbidden,
      finalizeMaintenanceCandidatePreparation: forbidden,
      getMaintenanceCandidateQuestionContexts: forbidden,
      projectMaintenanceCandidateQuestionsForUser: forbidden,
      reconcileExactTransfersForUser: forbidden,
      syncDueAccountsForUser: forbidden,
      applyApprovedRules: forbidden,
      applyApprovedOneOffs: forbidden,
      refreshCashflowForUser: health,
      summarizeMaintenanceEffectsForRun: vi.fn(async () => ({
        categorizations: 0,
        transfers: 0,
        duplicateActions: 0,
      })),
    },
    maintenance: {
      claim: vi.fn(async () => ({ claimId: id, run })),
      listStepRecords: vi.fn(async () => records),
      completeStep: vi.fn(async (input: { step: string; result: unknown }) => {
        records.push({
          step: input.step,
          status: "completed",
          result: input.result,
        });
      }),
      settle: vi.fn(async (input: { status: string; result: unknown }) => ({
        ...run,
        status: input.status,
        settledResult: input.result,
      })),
      releaseForRetry: release,
      renewClaim: vi.fn(async () => run),
    },
    challenge: { prepare: forbidden, resolve: forbidden },
    periodReviews: { createForRun: period },
    position: { readPosition: vi.fn(async () => position) },
    budget: { evaluateMaintenance: vi.fn(async () => budget) },
    now: () => new Date("2026-10-18T00:00:00Z"),
    status: {
      getFinanceStatus: vi.fn(async () => ({
        asOf: "2026-10-18T00:00:00Z",
        state: "maintained",
        freshness: { state: "current", blockers: [] },
        details: {
          rulebookVersion: revision,
          budget: { month: "2026-10" },
          health: { confidence: "reliable" },
          review: { total: 0 },
        },
      })),
    },
  };
  const service = createFinanceMaintenanceService(
    options as unknown as Parameters<typeof createFinanceMaintenanceService>[0],
  );
  return { id, run, fence, service, forbidden, health, period, control, release, options };
}
it("finishes only derived checkpoints under the captured claim/fence, including a stale challenge checkpoint", async () => {
  const f = fixture();
  await expect(f.service.dispatchRun(f.id)).resolves.toMatchObject({ status: "completed" });
  expect(f.forbidden).not.toHaveBeenCalled();
  expect(f.health).toHaveBeenCalledWith(
    f.id,
    { type: "all_outstanding" },
    expect.objectContaining({
      financeExecution: f.fence,
      maintenanceClaim: { runId: f.id, claimId: f.id },
      principal: expect.objectContaining({ actorId: f.fence.currentActorId, scopes: new Set() }),
    }),
    expect.any(Function),
  );
  expect(f.period).toHaveBeenCalledWith(f.id, f.id, expect.any(Object), {
    claimId: f.id,
    financeExecution: f.fence,
  });
  expect(f.options.maintenance.completeStep.mock.calls.map((call) => call[0].step)).toEqual([
    "health_refresh",
    "verify",
    "period_review",
  ]);
});
it("never replays economic work for an ambiguous receipt checkpoint", async () => {
  const f = fixture();
  f.control.mockResolvedValue({
    state: "reconciliation_required",
    reason: "economic_reconciliation_required",
  });
  await f.service.dispatchRun(f.id);
  expect(f.release).toHaveBeenCalledWith(
    expect.objectContaining({ claimId: f.id, code: "economic_reconciliation_required" }),
  );
  expect(f.forbidden).not.toHaveBeenCalled();
  expect(f.health).not.toHaveBeenCalled();
  expect(f.period).not.toHaveBeenCalled();
});
