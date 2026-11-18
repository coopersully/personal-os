import { describe, expect, it } from "vitest";
import { financeAccountBalance, financeAccountType } from "./account-type";

describe("account product type", () => {
  it.each([
    ["credit", "credit card", "debt", "credit_card"],
    ["credit", null, "debt", "debt"],
    ["credit", "unknown product", "cash", "debt"],
    ["credit", "line of credit", "debt", "credit_line"],
    ["depository", "checking", "cash", "bank"],
    ["depository", "savings", "cash", "bank"],
    ["depository", "prepaid", "cash", "debit_card"],
    ["investment", "401k", "investment", "investment"],
    ["brokerage", null, "investment", "investment"],
    ["loan", "mortgage", "debt", "loan"],
    [null, "debit_card", "cash", "debit_card"],
    [null, null, "debt", "debt"],
    [null, null, "cash", "cash"],
    [null, null, "other", "other"],
  ] as const)("classifies %s / %s using source evidence", (providerType, providerSubtype, kind, expected) => {
    expect(financeAccountType({ providerType, providerSubtype, kind })).toBe(expected);
  });
  it("does not turn checking into a debit card or infer a card from a planning override", () => {
    expect(
      financeAccountType({ providerType: "depository", providerSubtype: "checking", kind: "debt" }),
    ).toBe("bank");
    expect(
      financeAccountType({ providerType: "credit", providerSubtype: "credit card", kind: "cash" }),
    ).toBe("credit_card");
  });
  it("preserves missing balances, missing currency, and known currencies", () => {
    expect(financeAccountBalance({ balance: null, currencyCode: "USD" })).toBe(
      "Balance unavailable",
    );
    expect(financeAccountBalance({ balance: 42, currencyCode: null })).toBe("42.00");
    expect(financeAccountBalance({ balance: 42, currencyCode: "USD" })).toBe("$42.00");
  });
});
