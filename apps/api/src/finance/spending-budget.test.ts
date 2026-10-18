import type {
  FinanceBudgetBaselineQualificationRead,
  FinanceSpendingQuery,
} from "@personal-os/domain";
import { describe, expect, it } from "vitest";
import { projectFinanceSpendingMonthlyBudget } from "./spending-budget.js";
import type { SpendingEvidenceInput } from "./spending-contributions.js";
import { buildFinanceSpendingDashboard } from "./spending-service.js";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const account = (n: number): SpendingEvidenceInput["accounts"][number] => ({
  id: id(n),
  userId: "owner",
  currencyCode: "USD",
  includeInPlanning: true,
  kind: "cash",
  ownershipType: "individual",
  ownershipShareBps: 10000,
});
const transaction = (
  n: number,
  amount: number,
  date: string,
  accountId = id(1),
  categoryId = id(3),
): SpendingEvidenceInput["transactions"][number] => ({
  id: id(n),
  userId: "owner",
  accountId,
  categoryId,
  amount,
  category: "FOOD",
  currencyCode: "USD",
  direction: "expense",
  providerDirection: null,
  pending: false,
  pendingTransactionId: null,
  providerTransactionId: null,
  reconciliationStatus: "not_applicable",
  transactionDate: date,
  transferGroupId: null,
});
const evidence: SpendingEvidenceInput = {
  userId: "owner",
  asOf: "2026-03-25T12:00:00.000Z",
  coverage: "unknown",
  accounts: [account(1), account(2)],
  transactions: [transaction(10, 100, "2026-03-08"), transaction(11, 1500, "2026-03-20", id(2))],
  allocations: [],
  reimbursements: [],
  matches: [],
  relationships: [],
};
const query: FinanceSpendingQuery = {
  scope: {
    from: "2026-03-08",
    through: "2026-03-08",
    timezone: "America/New_York",
    accountIds: [id(1)],
    categoryIds: [id(3)],
    basis: "personal_cost",
    includePending: true,
    subtractRefunds: true,
  },
  grouping: "categories",
  includeUncategorized: true,
};
const baseline: FinanceBudgetBaselineQualificationRead = {
  state: "qualified",
  qualification: {
    id: id(5),
    revision: 1,
    month: "2026-03",
    period: { from: "2026-03-01", through: "2026-03-31", timezone: "America/Los_Angeles" },
    accountIds: [id(1), id(2)],
    currency: "USD",
    allocations: [
      {
        key: "food",
        categoryId: id(3),
        legacyCategory: null,
        label: "Historical food",
        amountCents: 1000,
      },
    ],
    budgetVersionId: id(6),
    budgetVersion: 1,
    planId: id(7),
    sourceBaselineId: null,
    confirmedAt: "2026-03-24T12:00:00.000Z",
    confirmedByActorId: "human",
    qualificationKind: "retrospective",
    originalApproval: {
      approvedAt: "2026-03-01T12:00:00.000Z",
      actorType: "user",
      actorId: "human",
    },
  },
};
const metadata = {
  accounts: [
    { id: id(1), label: "Cash1" },
    { id: id(2), label: "Cash2" },
  ],
  categories: [{ id: id(3), label: "Renamed food" }],
  buckets: [],
  transactions: [],
  source: { freshness: "unknown" as const, lastSyncedAt: null, reasons: [] },
};
const groups = () => buildFinanceSpendingDashboard(evidence, query, metadata).groups;
function qualified(value: FinanceBudgetBaselineQualificationRead) {
  if (value.state !== "qualified") throw new Error("Missing qualification fixture");
  return value.qualification;
}
describe("Whole-month budget usage independent from bubble selection", () => {
  it("uses exact explicit all-budget-account month and immutable target while bubble shows one day/account", () => {
    const dashboard = buildFinanceSpendingDashboard(evidence, query, metadata, baseline);
    expect(dashboard.snapshot.netCents).toBe(100);
    expect(dashboard.monthlyBudget).toMatchObject({
      state: "qualified",
      period: { timezone: "America/Los_Angeles" },
      qualificationKind: "retrospective",
      coverage: "unknown",
      groups: [{ budgetCents: 1000, usedCents: 1600, overspent: true }],
    });
  });
  it("does not reduce bucket numerator by selected category or omit unbudgeted categories", () => {
    const input = {
      ...evidence,
      transactions: [...evidence.transactions, transaction(12, 400, "2026-03-21", id(2), id(4))],
    };
    const dashboard = buildFinanceSpendingDashboard(
      input,
      { ...query, grouping: "buckets" },
      {
        ...metadata,
        buckets: [{ id: id(8), label: "Needs", categoryIds: [id(3), id(4)] }],
        categories: [...metadata.categories, { id: id(4), label: "Other" }],
      },
      baseline,
    );
    expect(dashboard.monthlyBudget).toMatchObject({
      state: "qualified",
      groups: expect.arrayContaining([
        expect.objectContaining({ groupId: id(8), budgetCents: 1000, usedCents: 2000 }),
      ]),
    });
  });
  it("preserves pending preference in monthly numerator", () => {
    const input = {
      ...evidence,
      transactions: [
        ...evidence.transactions,
        { ...transaction(12, 500, "2026-03-20", id(2)), pending: true },
      ],
    };
    const result = projectFinanceSpendingMonthlyBudget(
      input,
      { ...query, scope: { ...query.scope, includePending: false } },
      groups(),
      baseline,
    );
    expect(result).toMatchObject({
      state: "qualified",
      includesPending: false,
      groups: [{ usedCents: 1600 }],
    });
  });
  it("withholds multi-month, unqualified, currency and missing owner scope without inference", () => {
    expect(
      projectFinanceSpendingMonthlyBudget(
        evidence,
        { ...query, scope: { ...query.scope, through: "2026-04-01" } },
        groups(),
        baseline,
      ),
    ).toMatchObject({ state: "unavailable", reason: "multi_month_selection" });
    expect(
      projectFinanceSpendingMonthlyBudget(evidence, query, groups(), {
        state: "unavailable",
        reason: "baseline_missing",
        qualificationRequired: true,
        candidates: [],
      }),
    ).toMatchObject({ state: "unavailable", reason: "baseline_missing" });
    const changes: Array<[Partial<ReturnType<typeof qualified>>, string]> = [
      [{ currency: "EUR" }, "unsupported_currency"],
      [{ accountIds: [id(99)] }, "scope_unavailable"],
      [
        {
          allocations: [
            {
              key: "legacy",
              categoryId: null,
              legacyCategory: "FOOD",
              label: "Food",
              amountCents: 1000,
            },
          ],
        },
        "category_identity_unresolved",
      ],
    ];
    for (const [patch, reason] of changes) {
      expect(
        projectFinanceSpendingMonthlyBudget(evidence, query, groups(), {
          state: "qualified",
          qualification: { ...qualified(baseline), ...patch },
        }),
      ).toMatchObject({ state: "unavailable", reason });
    }
  });
  it("retains qualified zero-activity categories and buckets with truthful whole-month usage", () => {
    const selected = {
      ...query,
      scope: { ...query.scope, from: "2026-03-09", through: "2026-03-09", categoryIds: null },
    };
    const before = buildFinanceSpendingDashboard(evidence, selected, metadata);
    const dashboard = buildFinanceSpendingDashboard(evidence, selected, metadata, baseline);
    expect(dashboard.snapshot).toEqual(before.snapshot);
    expect(dashboard.snapshot.netCents).toBe(0);
    expect(dashboard.transactions).toEqual([]);
    expect(dashboard.groups).toHaveLength(1);
    expect(dashboard.groups[0]).toMatchObject({
      id: id(3),
      netCents: 0,
      positiveAreaCents: 0,
      drillDown: { contributionIds: [], transactionIds: [] },
    });
    expect(dashboard.monthlyBudget).toMatchObject({
      state: "qualified",
      groups: [{ groupId: id(3), budgetCents: 1000, usedCents: 1600, overspent: true }],
    });
    const bucket = buildFinanceSpendingDashboard(
      evidence,
      { ...selected, grouping: "buckets" },
      {
        ...metadata,
        buckets: [{ id: id(8), label: "Needs", categoryIds: [id(3)] }],
      },
      baseline,
    );
    expect(bucket.groups[0]).toMatchObject({
      netCents: 0,
      categories: [{ id: id(3), netCents: 0 }],
    });
    expect(bucket.monthlyBudget).toMatchObject({
      state: "qualified",
      groups: [
        expect.objectContaining({ groupId: id(8), usedCents: 1600 }),
        expect.objectContaining({ groupId: id(3), usedCents: 1600 }),
      ],
    });
    expect(
      buildFinanceSpendingDashboard(
        evidence,
        { ...selected, scope: { ...selected.scope, categoryIds: [] } },
        metadata,
        baseline,
      ).groups,
    ).toEqual([]);
    expect(
      buildFinanceSpendingDashboard(
        evidence,
        { ...selected, scope: { ...selected.scope, through: "2026-04-01" } },
        metadata,
        baseline,
      ).groups,
    ).toEqual([]);
  });
  it("withholds unsupported transaction currency despite explicit baseline currency", () => {
    const input = {
      ...evidence,
      transactions: [
        ...evidence.transactions,
        { ...transaction(12, 500, "2026-03-20", id(2)), currencyCode: "EUR" },
      ],
    };
    expect(projectFinanceSpendingMonthlyBudget(input, query, groups(), baseline)).toMatchObject({
      state: "unavailable",
      reason: "unsupported_currency",
    });
  });
  it("rejects partial or wrong-month designated period rather than extending it", () => {
    for (const period of [
      { ...qualified(baseline).period, through: "2026-03-20" },
      { from: "2026-02-01", through: "2026-02-28", timezone: "UTC" },
    ])
      expect(
        projectFinanceSpendingMonthlyBudget(evidence, query, groups(), {
          state: "qualified",
          qualification: { ...qualified(baseline), period },
        }),
      ).toMatchObject({ state: "unavailable", reason: "baseline_incomplete" });
  });
});
