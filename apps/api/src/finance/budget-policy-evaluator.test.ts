import { financeBudgetPolicyEvaluationSchema } from "@personal-os/domain";
import { evaluateFinanceBudgetPolicy } from "./budget-policy-evaluator.js";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ref = (n: number) => ({ id: id(n), revision: "1" });
function fixture() {
  const period = { from: "2026-09-01", through: "2026-09-30", timezone: "America/New_York" };
  const revisions = {
    userId: id(1),
    planId: id(2),
    policy: ref(3),
    policyLifecycleRevision: 1,
    profile: ref(5),
    baseline: ref(4),
    activeBudget: ref(6),
    latestBudget: ref(6),
    positionRevision: "position-1",
    usageRevision: "usage-1",
  };
  const plan = (n: number) => ({
    userId: id(1),
    planId: id(2),
    revision: ref(n),
    month: "2026-09",
    resources: [{ key: "pay", kind: "income", sourceId: null, amountCents: 1000 }],
    allocations: [
      { key: "food", kind: "spending", targetId: id(8), amountCents: 600 },
      { key: "bills", kind: "spending", targetId: id(9), amountCents: 300 },
      { key: "buffer", kind: "buffer", targetId: null, amountCents: 100 },
    ],
  });
  const candidate = plan(7);
  candidate.allocations = candidate.allocations.map((a) => ({
    ...a,
    amountCents: a.key === "food" ? 500 : a.key === "bills" ? 400 : a.amountCents,
  }));
  const fact = () => ({
    cents: 1000,
    currency: "USD",
    quality: "verified",
    reasons: [] as string[],
    sources: [ref(10)],
  });
  return {
    evaluatedAt: "2026-09-20T12:00:00Z",
    policyState: "draft",
    terms: {
      currency: "USD",
      period,
      rollover: "none",
      accounting: "gross_positive_allocation_deltas",
      usageScope: "user_month_all_policy_versions",
      perChangeCapCents: 100,
      monthlyCapCents: 300,
      expiresAt: "2026-10-01T04:00:00Z",
      baseline: ref(4),
      directions: [
        { allocationKey: "food", direction: "decrease" },
        { allocationKey: "bills", direction: "increase" },
        { allocationKey: "buffer", direction: "both" },
      ],
      protections: [{ allocationKey: "buffer", minimumCents: 100 }],
    },
    expected: structuredClone(revisions),
    observed: structuredClone(revisions),
    baseline: plan(4),
    current: plan(6),
    candidate,
    position: {
      state: "available",
      userId: id(1),
      evidence: {
        revision: "position-1",
        asOf: "2026-09-20T11:00:00Z",
        scope: { from: period.from, through: period.through, accountIds: [id(10)] },
        cash: fact(),
        postedSpend: fact(),
        pendingExposure: fact(),
        committed: fact(),
        protected: fact(),
        spendable: fact(),
        debt: fact(),
        investments: fact(),
        netWorth: fact(),
      },
    },
    usage: {
      state: "available",
      userId: id(1),
      period: structuredClone(period),
      revision: "usage-1",
      accounting: "gross_positive_allocation_deltas",
      scope: "user_month_all_policy_versions",
      consumedCents: 200,
    },
  };
}
type Input = ReturnType<typeof fixture>;
const changeAmount = (input: Input, key: string, cents: number) => ({
  ...input,
  candidate: {
    ...input.candidate,
    allocations: input.candidate.allocations.map((a) =>
      a.key === key ? { ...a, amountCents: cents } : a,
    ),
  },
});
const cases: Array<[string, (input: Input) => unknown, string]> = [
  [
    "missing position",
    (i) => ({ ...i, position: { state: "unavailable", reason: "producer_not_registered" } }),
    "position_unavailable",
  ],
  [
    "missing usage",
    (i) => ({ ...i, usage: { state: "unavailable", reason: "missing_evidence" } }),
    "usage_unavailable",
  ],
  ["missing baseline", (i) => ({ ...i, baseline: null }), "missing_evidence"],
  ["missing current", (i) => ({ ...i, current: null }), "missing_evidence"],
  [
    "unknown profile",
    (i) => ({
      ...i,
      expected: { ...i.expected, profile: null },
      observed: { ...i.observed, profile: null },
    }),
    "missing_evidence",
  ],
  ["policy disable", (i) => ({ ...i, policyState: "disabled" }), "policy_disabled"],
  ["policy unknown", (i) => ({ ...i, policyState: "unknown" }), "policy_unknown"],
  ["expiry", (i) => ({ ...i, terms: { ...i.terms, expiresAt: i.evaluatedAt } }), "policy_expired"],
  ["expired state", (i) => ({ ...i, policyState: "expired" }), "policy_expired"],
  ["outside local month", (i) => ({ ...i, evaluatedAt: "2026-09-01T03:59:59Z" }), "outside_period"],
  [
    "foreign proposal",
    (i) => ({ ...i, candidate: { ...i.candidate, userId: id(99) } }),
    "scope_mismatch",
  ],
  [
    "other plan",
    (i) => ({ ...i, candidate: { ...i.candidate, planId: id(99) } }),
    "scope_mismatch",
  ],
  [
    "other month",
    (i) => ({ ...i, candidate: { ...i.candidate, month: "2026-08" } }),
    "scope_mismatch",
  ],
  [
    "baseline changed",
    (i) => ({ ...i, baseline: { ...i.baseline, revision: ref(99) } }),
    "stale_revision",
  ],
  [
    "policy baseline changed",
    (i) => ({ ...i, terms: { ...i.terms, baseline: ref(99) } }),
    "stale_revision",
  ],
  [
    "current changed",
    (i) => ({ ...i, current: { ...i.current, revision: ref(99) } }),
    "stale_revision",
  ],
  [
    "superseding proposal",
    (i) => ({
      ...i,
      expected: { ...i.expected, latestBudget: ref(99) },
      observed: { ...i.observed, latestBudget: ref(99) },
    }),
    "stale_revision",
  ],
  [
    "position changed",
    (i) => ({
      ...i,
      position: { ...i.position, evidence: { ...i.position.evidence, revision: "position-2" } },
    }),
    "stale_revision",
  ],
  [
    "position tenant",
    (i) => ({ ...i, position: { ...i.position, userId: id(99) } }),
    "scope_mismatch",
  ],
  [
    "position interval",
    (i) => ({
      ...i,
      position: {
        ...i.position,
        evidence: {
          ...i.position.evidence,
          scope: { ...i.position.evidence.scope, from: "2026-08-01" },
        },
      },
    }),
    "scope_mismatch",
  ],
  [
    "position future cutoff",
    (i) => ({
      ...i,
      position: {
        ...i.position,
        evidence: { ...i.position.evidence, asOf: "2026-09-21T00:00:00Z" },
      },
    }),
    "stale_revision",
  ],
  [
    "qualified spendable",
    (i) => ({
      ...i,
      position: {
        ...i.position,
        evidence: {
          ...i.position.evidence,
          spendable: {
            ...i.position.evidence.spendable,
            quality: "qualified",
            reasons: ["missing_commitments"],
          },
        },
      },
    }),
    "position_unqualified",
  ],
  [
    "null spendable",
    (i) => ({
      ...i,
      position: {
        ...i.position,
        evidence: {
          ...i.position.evidence,
          spendable: { ...i.position.evidence.spendable, cents: null },
        },
      },
    }),
    "position_unqualified",
  ],
  [
    "usage changed",
    (i) => ({ ...i, usage: { ...i.usage, revision: "usage-2" } }),
    "stale_revision",
  ],
  ["usage tenant", (i) => ({ ...i, usage: { ...i.usage, userId: id(99) } }), "scope_mismatch"],
  [
    "usage timezone",
    (i) => ({ ...i, usage: { ...i.usage, period: { ...i.usage.period, timezone: "UTC" } } }),
    "scope_mismatch",
  ],
  [
    "per-change limit",
    (i) => ({ ...i, terms: { ...i.terms, perChangeCapCents: 99 } }),
    "per_change_cap",
  ],
  ["aggregate limit", (i) => ({ ...i, usage: { ...i.usage, consumedCents: 201 } }), "monthly_cap"],
  [
    "direction denied",
    (i) => ({ ...i, terms: { ...i.terms, directions: [] } }),
    "direction_not_permitted",
  ],
  [
    "opposite direction",
    (i) => ({
      ...i,
      terms: {
        ...i.terms,
        directions: i.terms.directions.map((d) => ({ ...d, direction: "increase" })),
      },
    }),
    "direction_not_permitted",
  ],
  [
    "protection release",
    (i) => changeAmount(changeAmount(i, "buffer", 50), "bills", 450),
    "protected_release",
  ],
  [
    "protection floor",
    (i) => ({
      ...i,
      terms: { ...i.terms, protections: [{ allocationKey: "buffer", minimumCents: 101 }] },
    }),
    "protection_floor",
  ],
  [
    "missing protected identity",
    (i) => ({
      ...i,
      terms: { ...i.terms, protections: [{ allocationKey: "missing", minimumCents: 0 }] },
    }),
    "allocation_identity_changed",
  ],
  ["unbalanced proposal", (i) => changeAmount(i, "bills", 401), "unbalanced_plan"],
  [
    "allocation relation changed",
    (i) => ({
      ...i,
      candidate: {
        ...i.candidate,
        allocations: i.candidate.allocations.map((a) => ({ ...a, targetId: id(99) })),
      },
    }),
    "allocation_identity_changed",
  ],
  [
    "removed allocation",
    (i) => ({ ...i, candidate: { ...i.candidate, allocations: i.candidate.allocations.slice(1) } }),
    "allocation_identity_changed",
  ],
];

describe("hypothetical Finance budget policy evaluator", () => {
  it("previews exact gross reallocation at both caps without effects or authority", () => {
    const input = fixture();
    const before = structuredClone(input);
    const result = evaluateFinanceBudgetPolicy(input);
    expect(result).toMatchObject({
      kind: "hypothetical_preview",
      executionAvailable: false,
      reasons: [],
      grossMovedCents: 100,
      projectedMonthlyUsageCents: 300,
      revisions: input.observed,
      input: before,
    });
    expect(result.deltas.map((d) => [d.allocationKey, d.deltaCents])).toEqual([
      ["bills", 100],
      ["buffer", 0],
      ["food", -100],
    ]);
    expect(input).toEqual(before);
    expect(Object.isFrozen(input)).toBe(false);
    expect(result).toEqual(evaluateFinanceBudgetPolicy(input));
    expect(financeBudgetPolicyEvaluationSchema.safeParse(result).success).toBe(true);
  });

  it.each(cases)("denies %s", (_label, change, reason) => {
    const result = evaluateFinanceBudgetPolicy(change(fixture()));
    expect(result.kind).toBe("denied");
    expect(result.executionAvailable).toBe(false);
    expect(result.reasons).toContain(reason);
  });

  it.each([
    "policy",
    "profile",
    "activeBudget",
    "latestBudget",
    "baseline",
  ] as const)("rejects stale %s identity", (field) => {
    const input = fixture();
    input.expected[field] = ref(99);
    expect(evaluateFinanceBudgetPolicy(input).reasons).toContain("stale_revision");
  });

  it.each([
    "income",
    "borrowing",
    "reserve_draw",
    "other",
  ])("rejects changed resources including %s", (kind) => {
    const input = fixture();
    input.candidate.resources = [{ key: "new", kind, sourceId: null, amountCents: 1000 }];
    expect(evaluateFinanceBudgetPolicy(input).reasons).toContain("resource_changed");
  });

  it.each([
    "userId",
    "planId",
    "policyLifecycleRevision",
    "positionRevision",
    "usageRevision",
  ] as const)("rejects a changed expected %s binding", (field) => {
    const input = fixture();
    const expected = {
      ...input.expected,
      [field]: field === "policyLifecycleRevision" ? 2 : field.endsWith("Id") ? id(99) : "changed",
    };
    expect(evaluateFinanceBudgetPolicy({ ...input, expected }).reasons).toContain("stale_revision");
  });

  it("rejects a balanced income increase without changing the baseline", () => {
    const input = fixture();
    input.candidate.resources = input.candidate.resources.map((r) => ({ ...r, amountCents: 1100 }));
    const changed = changeAmount(input, "bills", 500);
    const result = evaluateFinanceBudgetPolicy(changed);
    expect(result.reasons).toContain("resource_changed");
    expect(result.input.baseline).toEqual(input.baseline);
  });

  it("treats unsourced or stale-labelled position facts as unqualified", () => {
    const input = fixture();
    input.position.evidence.cash.sources = [];
    expect(evaluateFinanceBudgetPolicy(input).reasons).toContain("position_unqualified");
    input.position.evidence.cash.sources = [ref(10)];
    input.position.evidence.cash.reasons = ["stale_evidence"];
    expect(evaluateFinanceBudgetPolicy(input).reasons).toContain("position_unqualified");
  });

  it("counts reverse reallocations gross and never resets supplied usage across policy revisions", () => {
    const input = fixture();
    input.expected.policy.revision = "2";
    input.observed.policy.revision = "2";
    input.terms.directions = input.terms.directions.map((d) => ({ ...d, direction: "both" }));
    const old = input.current.allocations;
    input.current.allocations = input.candidate.allocations;
    input.candidate.allocations = old;
    input.usage.consumedCents = 300;
    const result = evaluateFinanceBudgetPolicy(input);
    expect(result).toMatchObject({
      kind: "denied",
      grossMovedCents: 100,
      projectedMonthlyUsageCents: 400,
    });
    expect(result.reasons).toContain("monthly_cap");
    expect(input.usage.consumedCents).toBe(300);
  });

  it("keeps unavailable usage unknown and handles bounded output overflow without fabrication", () => {
    const input = fixture();
    const unknown = evaluateFinanceBudgetPolicy({
      ...input,
      usage: { state: "unavailable", reason: "stale_evidence" },
    });
    expect(unknown.projectedMonthlyUsageCents).toBeNull();
    input.usage.consumedCents = 2_147_483_647;
    const overflow = evaluateFinanceBudgetPolicy(input);
    expect(overflow).toMatchObject({
      kind: "denied",
      grossMovedCents: null,
      projectedMonthlyUsageCents: null,
      deltas: [],
    });
    expect(overflow.reasons).toContain("amount_overflow");
  });

  it("uses the explicit timezone at the month boundary and accepts explicit zero-change caps", () => {
    const input = fixture();
    input.evaluatedAt = "2026-09-01T04:00:00Z";
    input.position.evidence.asOf = input.evaluatedAt;
    input.candidate.allocations = structuredClone(input.current.allocations);
    input.terms.perChangeCapCents = 0;
    input.terms.monthlyCapCents = 0;
    input.usage.consumedCents = 0;
    expect(evaluateFinanceBudgetPolicy(input)).toMatchObject({
      kind: "hypothetical_preview",
      grossMovedCents: 0,
      projectedMonthlyUsageCents: 0,
    });
  });

  it("rejects malformed cents and duplicate identities at the public contract boundary", () => {
    expect(() => evaluateFinanceBudgetPolicy({ ...fixture(), executionAvailable: true })).toThrow();
    expect(() => evaluateFinanceBudgetPolicy(changeAmount(fixture(), "food", 0.5))).toThrow();
    const input = fixture();
    input.candidate.allocations.push({
      key: "food",
      kind: "spending",
      targetId: id(8),
      amountCents: 0,
    });
    expect(() => evaluateFinanceBudgetPolicy(input)).toThrow();
  });
});
