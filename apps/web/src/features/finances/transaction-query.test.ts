import { financeSpendingReferenceFilter, financeTransactionFilters } from "./transaction-query";

it("keeps filters bounded and does not convert an invalid URL into a failing API request", () => {
  expect(
    financeTransactionFilters(
      new URLSearchParams("search=coffee&from=bad&pending=posted&review=bad&accountId=bad"),
    ),
  ).toEqual({ search: "coffee", pending: false, review: "all" });
  expect(
    financeTransactionFilters(
      new URLSearchParams("from=2026-09-01&to=2026-09-30&review=needs_review"),
    ),
  ).toEqual({ from: "2026-09-01", to: "2026-09-30", review: "needs_review" });
  expect(financeTransactionFilters(new URLSearchParams("pending=pending"))).toEqual({
    pending: true,
    review: "all",
  });
});

it("keeps posting and review-state filters independent from review flow links", () => {
  expect(
    financeTransactionFilters(new URLSearchParams("pending=pending&reviewState=resolved")),
  ).toEqual({ pending: true, review: "resolved" });
  expect(financeTransactionFilters(new URLSearchParams("pending=pending&review=open"))).toEqual({
    pending: true,
    review: "all",
  });
});

const spendingReference = {
  query: {
    scope: {
      from: "2026-09-01",
      through: "2026-09-30",
      timezone: "America/New_York",
      accountIds: ["account"],
      categoryIds: [null],
      basis: "personal_cost",
      includePending: false,
      subtractRefunds: true,
    },
    grouping: "categories",
    includeUncategorized: true,
  },
  referenceRevision: "a".repeat(64),
  groupId: "category:uncategorized",
  from: "2026-09-02",
  through: "2026-09-03",
};

it("preserves the complete exact Spending scope independently of ordinary ledger filters", () => {
  const params = new URLSearchParams({
    spending: JSON.stringify(spendingReference),
    search: "coffee",
  });
  expect(financeSpendingReferenceFilter(params)).toEqual({
    status: "valid",
    filter: spendingReference,
  });
  expect(financeSpendingReferenceFilter(new URLSearchParams())).toEqual({ status: "absent" });
});

it.each([
  "",
  "{",
  "null",
  "x".repeat(16_001),
  JSON.stringify({ ...spendingReference, referenceRevision: "stale" }),
  JSON.stringify({ ...spendingReference, from: "2026-08-31" }),
  JSON.stringify({ ...spendingReference, through: "2026-10-01" }),
  JSON.stringify({ ...spendingReference, from: "2026-09-04" }),
  JSON.stringify({ ...spendingReference, transactionIds: ["not-authority"] }),
])("rejects malformed exact Spending references without broadening the view", (spending) => {
  expect(financeSpendingReferenceFilter(new URLSearchParams({ spending }))).toEqual({
    status: "invalid",
  });
});

it("rejects ambiguous duplicate Spending parameters", () => {
  const params = new URLSearchParams({ spending: JSON.stringify(spendingReference) });
  params.append("spending", JSON.stringify(spendingReference));
  expect(financeSpendingReferenceFilter(params)).toEqual({ status: "invalid" });
});

it.each([
  null,
  [],
])("preserves all versus no account selection in exact scope: %j", (accountIds) => {
  const filter = {
    ...spendingReference,
    query: { ...spendingReference.query, scope: { ...spendingReference.query.scope, accountIds } },
  };
  expect(
    financeSpendingReferenceFilter(new URLSearchParams({ spending: JSON.stringify(filter) })),
  ).toEqual({ status: "valid", filter });
});
