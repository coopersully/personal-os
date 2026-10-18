import { describe, expect, it } from "vitest";
import {
  financeSpendingContributionSchema,
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
