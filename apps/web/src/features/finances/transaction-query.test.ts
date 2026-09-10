import { financeTransactionFilters } from "./transaction-query";

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
});
