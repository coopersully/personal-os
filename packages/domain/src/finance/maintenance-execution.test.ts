import {
  financeExecutionRefreshDelay,
  refreshFinanceMaintenanceExecutionInputSchema,
} from "./maintenance-execution.js";

it("bounds NEW-command retries and never steals time from a live lease", () => {
  expect([0, 1, 2, 3, 4, 5].map((n) => financeExecutionRefreshDelay(n, 1000, null))).toEqual([
    1000,
    2000,
    4000,
    8000,
    16000,
    null,
  ]);
  expect(financeExecutionRefreshDelay(0, 1000, 61000)).toBe(60000);
  expect(financeExecutionRefreshDelay(-1, 1000, null)).toBeNull();
});
it("rejects caller-supplied owner/new actor and preserves bigint binding revisions", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const input = {
    operationId: id,
    candidateId: id,
    candidateRevision: `sha256:${"a".repeat(64)}`,
    expectedCurrentActorId: id,
    expectedBindingRevision: "9007199254740993",
    expectedRunUpdatedAt: new Date().toISOString(),
  };
  expect(refreshFinanceMaintenanceExecutionInputSchema.parse(input).expectedBindingRevision).toBe(
    "9007199254740993",
  );
  expect(
    refreshFinanceMaintenanceExecutionInputSchema.safeParse({ ...input, currentActorId: id })
      .success,
  ).toBe(false);
  expect(
    refreshFinanceMaintenanceExecutionInputSchema.safeParse({ ...input, userId: id }).success,
  ).toBe(false);
});
