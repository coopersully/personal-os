import {
  financeBudgetPolicyEvaluationInputSchema,
  financeBudgetPolicyEvaluationSchema,
  financeBudgetPolicyPlanSnapshotSchema,
  financeBudgetPolicyRevisionTupleSchema,
  financeBudgetPolicyTermsSchema,
} from "./budget-policy.js";

const terms = () => ({
  currency: "USD",
  period: { from: "2026-09-01", through: "2026-09-30", timezone: "America/New_York" },
  rollover: "none",
  accounting: "gross_positive_allocation_deltas",
  usageScope: "user_month_all_policy_versions",
  perChangeCapCents: 1000,
  monthlyCapCents: 4000,
  expiresAt: "2026-10-01T04:00:00Z",
  baseline: { id: "00000000-0000-4000-8000-000000000001", revision: "1" },
  directions: [{ allocationKey: "food", direction: "both" }],
  protections: [{ allocationKey: "buffer", minimumCents: 1000 }],
});

describe("explicit hypothetical budget policy terms", () => {
  it("requires every term, without injecting authority or defaults", () => {
    const input = terms();
    expect(financeBudgetPolicyTermsSchema.parse(input)).toEqual(input);
    for (const key of Object.keys(input)) {
      const partial = { ...input } as Record<string, unknown>;
      delete partial[key];
      expect(financeBudgetPolicyTermsSchema.safeParse(partial).success, key).toBe(false);
    }
    expect(financeBudgetPolicyTermsSchema.safeParse({ ...input, active: true }).success).toBe(
      false,
    );
  });

  it.each([
    -1,
    0.5,
    Number.MAX_SAFE_INTEGER,
    2_147_483_648,
  ])("rejects invalid cents %s", (value) => {
    expect(
      financeBudgetPolicyTermsSchema.safeParse({ ...terms(), perChangeCapCents: value }).success,
    ).toBe(false);
  });

  it("accepts explicit zero caps and rejects ambiguous periods or terms", () => {
    expect(
      financeBudgetPolicyTermsSchema.safeParse({
        ...terms(),
        perChangeCapCents: 0,
        monthlyCapCents: 0,
      }).success,
    ).toBe(true);
    for (const period of [
      { from: "2026-09-02", through: "2026-09-30", timezone: "UTC" },
      { from: "2026-09-01", through: "2026-10-01", timezone: "UTC" },
      { from: "2026-09-01", through: "2026-09-30", timezone: "invalid" },
    ])
      expect(financeBudgetPolicyTermsSchema.safeParse({ ...terms(), period }).success).toBe(false);
    expect(
      financeBudgetPolicyTermsSchema.safeParse({ ...terms(), rollover: "carry_forward" }).success,
    ).toBe(false);
    expect(
      financeBudgetPolicyTermsSchema.safeParse({ ...terms(), accounting: "net_change" }).success,
    ).toBe(false);
  });

  it("rejects duplicate direction and protection identities", () => {
    const input = terms();
    expect(
      financeBudgetPolicyTermsSchema.safeParse({
        ...input,
        directions: [...input.directions, ...input.directions],
      }).success,
    ).toBe(false);
    expect(
      financeBudgetPolicyTermsSchema.safeParse({
        ...input,
        protections: [...input.protections, ...input.protections],
      }).success,
    ).toBe(false);
  });
});

const id = "00000000-0000-4000-8000-000000000001";
const ref = { id, revision: "1" };
const revisions = () => ({
  userId: id,
  planId: id,
  policy: ref,
  policyLifecycleRevision: 0,
  profile: null,
  baseline: ref,
  activeBudget: null,
  latestBudget: null,
  positionRevision: null,
  usageRevision: null,
});
const snapshot = () => ({
  userId: id,
  planId: id,
  revision: ref,
  month: "2026-09",
  resources: [{ key: "income", kind: "income", sourceId: null, amountCents: 1000 }],
  allocations: [{ key: "food", kind: "spending", targetId: null, amountCents: 1000 }],
});
const evaluation = () => ({
  evaluatedAt: "2026-09-20T12:00:00Z",
  terms: terms(),
  policyState: "draft",
  expected: revisions(),
  observed: revisions(),
  baseline: null,
  current: null,
  candidate: snapshot(),
  position: { state: "unavailable", reason: "producer_not_registered" },
  usage: { state: "unavailable", reason: "missing_evidence" },
});

describe("unregistered policy evaluation boundaries", () => {
  it("requires exact identity components, retains unknown evidence, and freezes revision references", () => {
    const input = evaluation();
    const parsed = financeBudgetPolicyEvaluationInputSchema.parse(input);
    expect(parsed).toEqual(input);
    for (const key of Object.keys(input)) {
      const partial = { ...input } as Record<string, unknown>;
      delete partial[key];
      expect(financeBudgetPolicyEvaluationInputSchema.safeParse(partial).success, key).toBe(false);
    }
    for (const key of Object.keys(revisions())) {
      const partial = { ...revisions() } as Record<string, unknown>;
      delete partial[key];
      expect(financeBudgetPolicyRevisionTupleSchema.safeParse(partial).success, key).toBe(false);
    }
    expect(Object.isFrozen(parsed.expected)).toBe(true);
    expect(Object.isFrozen(parsed.expected.policy)).toBe(true);
    expect(Object.isFrozen(parsed.terms.directions)).toBe(true);
    expect(
      financeBudgetPolicyEvaluationInputSchema.safeParse({ ...input, policyState: "active" })
        .success,
    ).toBe(false);
  });

  it("rejects duplicate plan identities and aggregate overflow", () => {
    const input = snapshot();
    for (const field of ["resources", "allocations"] as const) {
      expect(
        financeBudgetPolicyPlanSnapshotSchema.safeParse({
          ...input,
          [field]: [...input[field], ...input[field]],
        }).success,
      ).toBe(false);
      expect(
        financeBudgetPolicyPlanSnapshotSchema.safeParse({
          ...input,
          [field]: [
            { ...input[field][0], amountCents: 2_147_483_647 },
            { ...input[field][0], key: "second", amountCents: 1 },
          ],
        }).success,
      ).toBe(false);
    }
    expect(financeBudgetPolicyPlanSnapshotSchema.safeParse(input).success).toBe(true);
  });

  it("never describes a hypothetical result as executable or saved", () => {
    const result = {
      kind: "denied",
      executionAvailable: false,
      executionUnavailableReasons: ["authority_not_wired", "position_commit_fence_not_wired"],
      evaluatedAt: evaluation().evaluatedAt,
      input: evaluation(),
      revisions: revisions(),
      reasons: ["missing_evidence"],
      grossMovedCents: null,
      projectedMonthlyUsageCents: null,
      deltas: [],
    };
    expect(financeBudgetPolicyEvaluationSchema.safeParse(result).success).toBe(true);
    for (const patch of [
      { evaluatedAt: "2026-09-21T12:00:00Z" },
      { revisions: { ...revisions(), policyLifecycleRevision: 1 } },
      { executionAvailable: true },
      { kind: "active" },
      { saved: true },
      { executionUnavailableReasons: [] },
      { reasons: [] },
      { kind: "hypothetical_preview", reasons: [] },
    ])
      expect(financeBudgetPolicyEvaluationSchema.safeParse({ ...result, ...patch }).success).toBe(
        false,
      );
    expect(
      financeBudgetPolicyEvaluationSchema.safeParse({
        ...result,
        kind: "hypothetical_preview",
        reasons: [],
        grossMovedCents: 0,
        projectedMonthlyUsageCents: 0,
      }).success,
    ).toBe(true);
  });

  it("rejects invalid dates without throwing outside schema validation", () => {
    expect(
      financeBudgetPolicyTermsSchema.safeParse({
        ...terms(),
        period: { from: "not-a-date", through: "2026-09-30", timezone: "UTC" },
      }).success,
    ).toBe(false);
  });
});
