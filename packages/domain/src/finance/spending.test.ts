import { describe, expect, it } from "vitest";
import {
  financeSpendingContributionSchema,
  financeSpendingMonthlyBudgetSchema,
  financeSpendingQuerySchema,
  financeSpendingScopeSchema,
} from "./spending.js";

describe("Spending contracts", () => {
  const scope = {
    from: "2026-03-07",
    through: "2026-03-09",
    timezone: "America/New_York",
    accountIds: null,
    categoryIds: null,
    basis: "personal_cost",
    includePending: true,
    subtractRefunds: true,
  };
  it("validates local dates, timezone and ordered periods", () => {
    expect(financeSpendingScopeSchema.safeParse(scope).success).toBe(true);
    for (const invalid of [
      { from: "2026-02-30" },
      { from: "2026-03-10" },
      { timezone: "invented" },
    ])
      expect(financeSpendingScopeSchema.safeParse({ ...scope, ...invalid }).success).toBe(false);
  });
  it("distinguishes all accounts from none", () => {
    expect(financeSpendingScopeSchema.parse(scope).accountIds).toBeNull();
    expect(financeSpendingScopeSchema.parse({ ...scope, accountIds: [] }).accountIds).toEqual([]);
  });
  it("requires integer, reconciled cents", () => {
    const contribution = {
      id: "source",
      transactionId: "transaction",
      allocationId: null,
      categoryId: null,
      accountId: "account",
      date: "2026-03-08",
      pending: false,
      currencyCode: "USD",
      grossCents: 100,
      reimbursementAdjustmentCents: 20,
      reimbursementOutstandingCents: 10,
      reimbursementIds: [],
      refundAdjustmentCents: 0,
      netCents: 80,
    };
    expect(financeSpendingContributionSchema.safeParse(contribution).success).toBe(true);
    expect(
      financeSpendingContributionSchema.safeParse({ ...contribution, netCents: 90 }).success,
    ).toBe(false);
    expect(
      financeSpendingContributionSchema.safeParse({ ...contribution, netCents: 80.5 }).success,
    ).toBe(false);
  });
});

it("preserves all versus explicit no accounts and query defaults", () => {
  const scope = {
    from: "2026-10-01",
    through: "2026-10-31",
    timezone: "America/New_York",
    accountIds: null,
    categoryIds: null,
    basis: "personal_cost",
    includePending: true,
    subtractRefunds: true,
  };
  expect(financeSpendingQuerySchema.parse({ scope })).toMatchObject({
    grouping: "auto",
    includeUncategorized: true,
    scope: { accountIds: null },
  });
  expect(
    financeSpendingQuerySchema.parse({ scope: { ...scope, accountIds: [], categoryIds: [] } })
      .scope,
  ).toMatchObject({ accountIds: [], categoryIds: [] });
});

it("distinguishes explicit zero monthly targets from absent targets in the consumer contract", () => {
  const monthly = {
    state: "qualified",
    month: "2026-03",
    period: { from: "2026-03-01", through: "2026-03-31", timezone: "UTC" },
    currency: "USD",
    accountIds: ["account"],
    qualificationId: "qualification",
    confirmedAt: "2026-03-01T00:00:00.000Z",
    qualificationKind: "current",
    coverage: "unknown",
    includesPending: true,
    basis: "personal_cost",
    subtractsRefunds: true,
    groups: [
      { groupId: "explicit-zero", budgetCents: 0, usedCents: 100, overspent: true },
      { groupId: "absent", budgetCents: null, usedCents: 100, overspent: false },
    ],
  };
  expect(financeSpendingMonthlyBudgetSchema.parse(monthly).groups).toEqual(monthly.groups);
  expect(
    financeSpendingMonthlyBudgetSchema.safeParse({
      ...monthly,
      groups: [{ ...monthly.groups[0], budgetCents: -1 }],
    }).success,
  ).toBe(false);
});
