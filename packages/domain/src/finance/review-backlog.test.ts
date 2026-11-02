import {
  classifyFinanceReviewBacklog,
  financeReviewBacklogPeriod,
  financeReviewBacklogQuerySchema,
} from "./review-backlog.js";

const base = {
  merchant: "Example merchant",
  providerCategory: null,
  providerCategoryDetailed: null,
  direction: "expense",
  reconciliationStatus: "not_applicable",
  reason: "needs_review",
};

describe("Finance review backlog evidence routing", () => {
  it.each([
    ["Savings round-up", "roundups"],
    ["Credit card payment", "card_payments"],
    ["Payment to a person", "ambiguous_payments"],
    ["Ordinary merchant", "other_categorization"],
  ] as const)("routes %s as a clue to %s", (merchant, expected) => {
    expect(classifyFinanceReviewBacklog({ ...base, merchant })).toBe(expected);
  });
  it("uses transfer evidence without inferring transfers from a payment brand", () => {
    expect(classifyFinanceReviewBacklog({ ...base, direction: "transfer" })).toBe(
      "internal_movements",
    );
    expect(classifyFinanceReviewBacklog({ ...base, reason: "possible_transfer" })).toBe(
      "internal_movements",
    );
    expect(classifyFinanceReviewBacklog({ ...base, reconciliationStatus: "matched" })).toBe(
      "internal_movements",
    );
    expect(classifyFinanceReviewBacklog({ ...base, merchant: "PayPal" })).toBe(
      "ambiguous_payments",
    );
    expect(
      classifyFinanceReviewBacklog({
        ...base,
        providerCategoryDetailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT",
      }),
    ).toBe("card_payments");
  });
  it.each([
    ["2026-10-01", "current_month"],
    ["2026-10-31", "current_month"],
    ["2026-09-30", "historical"],
    ["2026-11-01", "future"],
    ["2026-02-30", "unknown"],
    [null, "unknown"],
    ["bad", "unknown"],
  ])("separates period %s without silently treating future/invalid dates as history", (date, expected) => {
    expect(financeReviewBacklogPeriod(date, "2026-10")).toBe(expected);
  });
  it("bounds and validates query inputs", () => {
    expect(financeReviewBacklogQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(financeReviewBacklogQuerySchema.parse({ limit: "100" }).limit).toBe(100);
    for (const input of [
      { limit: 0 },
      { limit: 101 },
      { limit: 1.5 },
      { group: "unknown" },
      { group: ["roundups"] },
      { cursor: "x".repeat(2049) },
      { extra: true },
    ]) {
      expect(financeReviewBacklogQuerySchema.safeParse(input).success).toBe(false);
    }
  });
});
