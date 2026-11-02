import type { FinanceBudgetVersion } from "./budget.js";
import { getFinanceBudgetApprovalReadiness } from "./budget-approval.js";

const id = "11111111-1111-4111-8111-111111111111";
const budget: FinanceBudgetVersion = {
  id,
  planId: id,
  profileVersionId: id,
  version: 7,
  status: "proposed",
  createdAt: "2026-10-24T12:00:00.000Z",
  approvedAt: null,
  effectiveFrom: "2026-10",
  rationale: "Save while maintaining a buffer.",
  assumptions: [],
  expectedResources: 100,
  allocatedTotal: 100,
  balanceDelta: 0,
  resources: [{ key: "Income", kind: "income", amount: 100 }],
  allocations: [
    { key: "Savings", kind: "savings", amount: 80 },
    { key: "Buffer", kind: "buffer", amount: 20 },
  ],
};
const inspect = (
  value: FinanceBudgetVersion | null = budget,
  currentProfileVersionId: string | null = id,
  latestBudgetVersionId: string | null = id,
) =>
  getFinanceBudgetApprovalReadiness({
    budget: value,
    currentProfileVersionId,
    latestBudgetVersionId,
  });

it("reads balanced savings and buffer data without mutating it or requiring a profile where none exists", () => {
  const before = structuredClone(budget);
  expect(inspect()).toMatchObject({ ready: true, code: "ready", recovery: "approve" });
  expect(budget).toEqual(before);
  expect(inspect({ ...budget, profileVersionId: null }, null).ready).toBe(true);
});
it.each([
  [null, "no_budget", "create_proposal"],
  [{ ...budget, status: "incomplete" }, "not_proposed", "revise_proposal"],
  [{ ...budget, status: "active" }, "not_proposed", "none"],
  [{ ...budget, status: "retired" }, "not_proposed", "revise_proposal"],
  [{ ...budget, resources: [] }, "invalid_budget", "revise_proposal"],
  [
    { ...budget, resources: [{ key: "Income", kind: "income", amount: 100.001 }] },
    "invalid_budget",
    "revise_proposal",
  ],
  [{ ...budget, allocatedTotal: 99 }, "invalid_budget", "revise_proposal"],
  [
    { ...budget, allocations: [{ key: "Buffer", kind: "buffer", amount: 90 }] },
    "invalid_budget",
    "revise_proposal",
  ],
] as const)("explains an unapprovable proposal", (value, code, recovery) => {
  expect(inspect(value as FinanceBudgetVersion | null)).toMatchObject({
    ready: false,
    code,
    recovery,
  });
});
it("distinguishes stale profile and superseded plan recovery", () => {
  expect(inspect(budget, "new-profile")).toMatchObject({
    code: "profile_changed",
    recovery: "revise_proposal",
    ready: false,
  });
  expect(inspect(budget, id, "new-budget")).toMatchObject({
    code: "superseded",
    recovery: "refresh_plan",
    ready: false,
  });
});
