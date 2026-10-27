import { financePositionFactNames } from "@personal-os/domain";
import { financeRunAttentionWork } from "./work-resolver.js";

const run = {
  id: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  scope: { type: "all_outstanding" as const },
  lastSafeError: { code: "forbidden", message: "Initial wording" },
  settledResult: null,
};

it("keeps one owner action identity across runs while retaining exact run correlation", () => {
  const first = financeRunAttentionWork(run);
  const next = financeRunAttentionWork({
    ...run,
    id: "33333333-3333-4333-8333-333333333333",
    lastSafeError: { code: "forbidden", message: "Reworded" },
  });
  expect(next.id).toBe(first.id);
  expect(next.actionRevision).toBe(first.actionRevision);
  expect(next.revision).not.toBe(first.revision);
});
it.each([
  ["finance_position_evidence_missing", "finance_position_evidence_changed"],
  ["finance_budget_evaluation_missing", "finance_budget_evaluation_unavailable"],
  ["unknown_internal_a", "unknown_internal_b"],
])("does not turn internal/evidence churn into new required work: %s -> %s", (before, after) => {
  expect(financeRunAttentionWork({ ...run, settledResult: { code: before } }).actionRevision).toBe(
    financeRunAttentionWork({ ...run, settledResult: { code: after } }).actionRevision,
  );
});
it("admits a materially different recovery action without resetting its stable history identity", () => {
  const before = financeRunAttentionWork(run);
  const after = financeRunAttentionWork({
    ...run,
    lastSafeError: { code: "not_found", message: "Missing target" },
  });
  expect(after.id).toBe(before.id);
  expect(after.actionRevision).not.toBe(before.actionRevision);
});
it("isolates owners and exact target scopes", () => {
  const first = financeRunAttentionWork(run);
  expect(
    financeRunAttentionWork({ ...run, userId: "44444444-4444-4444-8444-444444444444" }).id,
  ).not.toBe(first.id);
  const target = {
    ...run,
    scope: { type: "target" as const, entityType: "transaction", id: run.id },
  };
  expect(financeRunAttentionWork(target).id).not.toBe(first.id);
  expect(
    financeRunAttentionWork({ ...target, scope: { ...target.scope, id: run.userId } }).id,
  ).not.toBe(financeRunAttentionWork(target).id);
});

it("canonicalizes typed position subjects while ignoring evidence revisions and account ordering", () => {
  const checkpoint = {
    revision: "v1",
    scope: {
      from: "2026-03-01",
      through: "2026-03-31",
      accountIds: [run.id, run.userId],
    },
    facts: Object.fromEntries(
      financePositionFactNames.map((name) => [
        name,
        { quality: "unavailable", reasons: ["source_unavailable"] },
      ]),
    ),
  };
  const first = financeRunAttentionWork({
    ...run,
    settledResult: { code: "finance_position_evidence_missing", position: checkpoint },
  });
  const reordered = financeRunAttentionWork({
    ...run,
    settledResult: {
      code: "finance_position_evidence_changed",
      position: {
        ...checkpoint,
        revision: "v2",
        scope: { ...checkpoint.scope, accountIds: [run.userId, run.id] },
      },
    },
  });
  expect(reordered.actionRevision).toBe(first.actionRevision);
  const different = financeRunAttentionWork({
    ...run,
    settledResult: {
      code: "finance_position_evidence_changed",
      position: { ...checkpoint, scope: { ...checkpoint.scope, through: "2026-04-30" } },
    },
  });
  expect(different.actionRevision).not.toBe(first.actionRevision);
});
it("does not invent subject evidence from untyped error text or extra payload fields", () => {
  const first = financeRunAttentionWork({
    ...run,
    settledResult: { code: "not_found", targetId: run.id, message: "Missing A" },
  });
  const next = financeRunAttentionWork({
    ...run,
    settledResult: { code: "not_found", targetId: run.userId, message: "Missing B" },
  });
  expect(first.actionRevision).toBe(next.actionRevision);
});
it("separates policy consequences from incidental budget revision/reason churn", () => {
  const evaluation = {
    proposal: { id: run.id, revision: "p1" },
    policy: { id: run.userId, revision: "policy1" },
    plan: { id: run.id, revision: "plan1" },
    outcome: "denied",
    reasons: ["stale_revision"],
    executionAvailable: false,
    executionUnavailableReasons: ["authority_not_wired", "position_commit_fence_not_wired"],
  };
  const budget = {
    positionRevision: "v1",
    state: "evaluated",
    reasonCode: null,
    evaluations: [evaluation],
  };
  const work = (value: unknown) =>
    financeRunAttentionWork({
      ...run,
      settledResult: { code: "finance_budget_evaluation_changed", budget: value },
    });
  const first = work(budget);
  expect(
    work({
      ...budget,
      positionRevision: "v2",
      evaluations: [
        {
          ...evaluation,
          proposal: { ...evaluation.proposal, revision: "p2" },
          reasons: ["resource_changed"],
        },
      ],
    }).actionRevision,
  ).toBe(first.actionRevision);
  expect(
    work({ ...budget, evaluations: [{ ...evaluation, reasons: ["protected_release"] }] })
      .actionRevision,
  ).not.toBe(first.actionRevision);
});
