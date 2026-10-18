import type { FinanceSpendingQuery } from "@personal-os/domain";
import { describe, expect, it } from "vitest";
import type { SpendingEvidenceInput } from "./spending-contributions.js";
import {
  buildFinanceSpendingDashboard,
  selectFinanceSpendingReferences,
} from "./spending-service.js";

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing Spending fixture");
  return value;
}
const query: FinanceSpendingQuery = {
  scope: {
    from: "2026-03-07",
    through: "2026-03-09",
    timezone: "America/New_York",
    accountIds: null,
    categoryIds: null,
    basis: "personal_cost",
    includePending: true,
    subtractRefunds: true,
  },
  grouping: "auto",
  includeUncategorized: true,
};
const evidence: SpendingEvidenceInput = {
  userId: "owner",
  asOf: "2026-03-10T12:00:00.000Z",
  coverage: "unknown",
  accounts: [
    {
      id: "cash",
      userId: "owner",
      currencyCode: "USD",
      includeInPlanning: true,
      kind: "cash",
      ownershipType: "individual",
      ownershipShareBps: 10000,
    },
  ],
  transactions: [
    {
      id: "purchase",
      userId: "owner",
      accountId: "cash",
      amount: 1200,
      category: "Food",
      categoryId: "food",
      currencyCode: "USD",
      direction: "expense",
      providerDirection: "expense",
      pending: false,
      pendingTransactionId: null,
      providerTransactionId: "posted",
      reconciliationStatus: "not_applicable",
      transactionDate: "2026-03-08",
      transferGroupId: null,
    },
  ],
  allocations: [],
  relationships: [],
  matches: [],
  reimbursements: [],
};
const metadata = {
  accounts: [{ id: "cash", label: "Cash" }],
  categories: [{ id: "food", label: "Food" }],
  buckets: [{ id: "needs", label: "Needs", categoryIds: ["food"] }],
  transactions: [
    { id: "purchase", accountId: "cash", merchant: "Store", date: "2026-03-08", pending: false },
  ],
  source: {
    freshness: "unknown" as const,
    lastSyncedAt: null,
    reasons: ["historical_coverage_not_certified"],
  },
};

describe("Spending dashboard canonical consumer", () => {
  it("reconciles bucket/category/selected detail and bins with identical sources", () => {
    const result = buildFinanceSpendingDashboard(evidence, query, metadata);
    expect(result.snapshot.netCents).toBe(1200);
    expect(result.groups[0]?.netCents).toBe(1200);
    expect(result.groups[0]?.categories[0]?.drillDown).toEqual(result.groups[0]?.drillDown);
    expect(result.groups[0]?.drillDown.contributionIds).toEqual(
      result.snapshot.contributions.map((row) => row.id),
    );
    expect(result.snapshot.bins.map((row) => row.date)).toEqual([
      "2026-03-07",
      "2026-03-08",
      "2026-03-09",
    ]);
    expect(result.snapshot.coverage).toBe("unknown");
    expect(result.snapshot.budgetComparison.status).toBe("unavailable");
  });
  it("preserves explicit no account/category selection without broadening to all", () => {
    for (const key of ["accountIds", "categoryIds"] as const) {
      const result = buildFinanceSpendingDashboard(
        evidence,
        { ...query, scope: { ...query.scope, [key]: [] } },
        metadata,
      );
      expect(result.snapshot.netCents).toBe(0);
      expect(result.transactions).toEqual([]);
      expect(result.groups).toEqual([]);
    }
  });
  it("preserves assigned category color and supplies explicit semantic visual fallbacks", () => {
    const result = buildFinanceSpendingDashboard(evidence, query, {
      ...metadata,
      categories: [{ id: "food", label: "Food", color: "#12aB34" }],
    });
    expect(result.groups[0]?.visual).toEqual({ color: null, icon: "bucket" });
    expect(result.groups[0]?.categories[0]?.visual).toEqual({ color: "#12aB34", icon: "category" });
    const invalid = buildFinanceSpendingDashboard(
      evidence,
      { ...query, grouping: "categories" },
      {
        ...metadata,
        categories: [{ id: "food", label: "Food", color: "url(https://invalid)" }],
      },
    );
    expect(invalid.groups[0]?.visual).toEqual({ color: null, icon: "category" });
    expect(invalid.snapshot).toEqual(result.snapshot);
    expect(invalid.groups[0]?.drillDown).toEqual(result.groups[0]?.categories[0]?.drillDown);
  });
  it("rejects requested foreign account/category IDs before projection", () => {
    for (const key of ["accountIds", "categoryIds"] as const)
      expect(() =>
        buildFinanceSpendingDashboard(
          evidence,
          { ...query, scope: { ...query.scope, [key]: ["foreign"] } },
          metadata,
        ),
      ).toThrow("selection was not found");
  });
  it("falls back from missing buckets without losing requested preference", () => {
    const result = buildFinanceSpendingDashboard(
      evidence,
      { ...query, grouping: "buckets" },
      { ...metadata, buckets: [] },
    );
    expect(result.effectiveGrouping).toBe("categories");
    expect(result.groupingFallback).toBe("buckets_unavailable");
  });
  it("discloses excluded uncategorized exact amount and still reconciles detail", () => {
    const input = {
      ...evidence,
      transactions: [
        ...evidence.transactions,
        { ...required(evidence.transactions[0]), id: "other", categoryId: null, amount: 333 },
      ],
    };
    const result = buildFinanceSpendingDashboard(
      input,
      { ...query, includeUncategorized: false },
      metadata,
    );
    expect(result.excludedUncategorizedCents).toBe(333);
    expect(result.snapshot.netCents).toBe(1200);
    expect(result.snapshot.contributions).toHaveLength(1);
  });
  it("groups unassigned categories once and exposes currency limitation without USD sum", () => {
    const input = {
      ...evidence,
      transactions: [
        ...evidence.transactions,
        { ...required(evidence.transactions[0]), id: "euro", currencyCode: "EUR", amount: 999 },
      ],
    };
    const result = buildFinanceSpendingDashboard(input, query, {
      ...metadata,
      buckets: [{ id: "other", label: "Other", categoryIds: [] }],
    });
    expect(result.snapshot.netCents).toBe(1200);
    expect(result.groups[0]?.label).toBe("Other spending");
    expect(result.currency.unsupported).toEqual([{ code: "EUR", transactionIds: ["euro"] }]);
  });
  it("does not expose foreign evidence through transactions or currency disclosure", () => {
    const result = buildFinanceSpendingDashboard(
      {
        ...evidence,
        transactions: [
          ...evidence.transactions,
          {
            ...required(evidence.transactions[0]),
            id: "foreign",
            userId: "someone",
            currencyCode: "EUR",
          },
        ],
      },
      query,
      {
        ...metadata,
        transactions: [
          ...metadata.transactions,
          { ...required(metadata.transactions[0]), id: "foreign" },
        ],
      },
    );
    expect(result.transactions.map((row) => row.id)).toEqual(["purchase"]);
    expect(result.currency.unsupported).toEqual([]);
  });
});

describe("Exact Spending transaction reference selection", () => {
  it("returns exact allocations/group scope and rejects stale or foreign selection", () => {
    const dashboard = buildFinanceSpendingDashboard(evidence, query, metadata);
    const filter = {
      query,
      referenceRevision: dashboard.referenceRevision ?? "",
      groupId: "needs",
      from: query.scope.from,
      through: query.scope.through,
    };
    const page = selectFinanceSpendingReferences(dashboard, filter);
    expect(page.transactionIds).toEqual(["purchase"]);
    expect(page.netCents).toBe(1200);
    expect(page.totalTransactions).toBe(1);
    expect(page.contributions.map((row) => row.id)).toEqual(
      dashboard.groups[0]?.drillDown.contributionIds,
    );
    expect(() =>
      selectFinanceSpendingReferences(dashboard, { ...filter, referenceRevision: "0".repeat(64) }),
    ).toThrow("Spending changed");
    expect(() =>
      selectFinanceSpendingReferences(dashboard, { ...filter, groupId: "foreign" }),
    ).toThrow("group was not found");
    expect(() =>
      selectFinanceSpendingReferences(dashboard, { ...filter, from: "2026-03-01" }),
    ).toThrow();
  });
  it("binds cursor to exact filter and snapshot; selected totals span all pages", () => {
    const input = {
      ...evidence,
      transactions: [
        ...evidence.transactions,
        { ...required(evidence.transactions[0]), id: "second", amount: 333 },
      ],
    };
    const dashboard = buildFinanceSpendingDashboard(input, query, metadata);
    const filter = {
      query,
      referenceRevision: dashboard.referenceRevision ?? "",
      groupId: null,
      from: query.scope.from,
      through: query.scope.through,
    };
    const first = selectFinanceSpendingReferences(dashboard, filter, undefined, 1);
    expect(first.totalTransactions).toBe(2);
    expect(first.netCents).toBe(1533);
    expect(first.contributions).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    const second = selectFinanceSpendingReferences(
      dashboard,
      filter,
      first.nextCursor ?? undefined,
      1,
    );
    expect(second.transactionIds).toEqual(["second"]);
    expect(second.netCents).toBe(1533);
    expect(second.nextCursor).toBeNull();
    expect(() =>
      selectFinanceSpendingReferences(
        dashboard,
        { ...filter, through: "2026-03-08" },
        first.nextCursor ?? undefined,
        1,
      ),
    ).toThrow("pagination is stale");
  });
});
