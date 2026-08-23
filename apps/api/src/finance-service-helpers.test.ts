import { describe, expect, it } from "vitest";
import {
  budgetImpact,
  budgetPaceDates,
  categorization,
  categoryGroup,
  categorySlug,
  daysInCalendarMonth,
  decodeCandidateItemCursor,
  decodeTransactionCursor,
  encodeCandidateItemCursor,
  encodeTransactionCursor,
  financeCandidateRevision,
  formatCurrency,
  isCardPayment,
  isProviderTransfer,
  isRefundOrReversal,
  isRentMerchant,
  isSoFiVaultTransfer,
  legacyCategorySlug,
  nextMonth,
  normalizedMerchant,
  providerConfidence,
  providerNeedsReview,
  titleCaseMerchant,
} from "./finance-service.js";

describe("Finance service deterministic helpers", () => {
  it("creates collision-safe legacy category slugs", () => {
    expect(legacyCategorySlug("user", "  CVS / Pharmacy  ")).toMatch(/^cvs-pharmacy-[a-f0-9]{12}$/);
    expect(legacyCategorySlug("user", "!!!")).toMatch(/^legacy-category-[a-f0-9]{12}$/);
    expect(legacyCategorySlug("user", "CVS", 1)).not.toBe(legacyCategorySlug("user", "CVS"));
    expect(legacyCategorySlug("other-user", "CVS")).not.toBe(legacyCategorySlug("user", "CVS"));
  });

  it("normalizes category and merchant display helpers", () => {
    expect(categoryGroup("Income")).toBe("Financial");
    expect(categoryGroup("Housing")).toBe("Essential");
    expect(categoryGroup("Dining")).toBe("Spending");
    expect(categorySlug("Bills & Utilities")).toBe("bills-and-utilities");
    expect(titleCaseMerchant("ACME LLC USA")).toBe("Acme LLC USA");
    expect(normalizedMerchant("ACME*1234 #10")).toBe("acme");
    expect(formatCurrency(12345)).toBe("$123.45");
    expect(categorySlug("  Already---clean  ")).toBe("already-clean");
    expect(categoryGroup("Entertainment")).toBe("Spending");
  });

  it("round-trips candidate cursors and rejects malformed positions", () => {
    expect(decodeCandidateItemCursor(encodeCandidateItemCursor(0))).toBe(0);
    expect(decodeCandidateItemCursor(encodeCandidateItemCursor(42))).toBe(42);
    for (const cursor of [
      "",
      "not-base64",
      Buffer.from("{}").toString("base64url"),
      Buffer.from('{"ordinal":-1}').toString("base64url"),
      Buffer.from('{"ordinal":1.5}').toString("base64url"),
    ]) {
      expect(() => decodeCandidateItemCursor(cursor)).toThrow(
        "maintenance candidate cursor is invalid",
      );
    }
  });

  it("changes a candidate revision when any public draft identity changes", () => {
    const baseline: Array<{
      actionKind: string;
      disposition: string;
      expectedRevision: string | null;
      fingerprint: string;
    }> = [
      {
        actionKind: "categorization",
        disposition: "prepared",
        expectedRevision: null,
        fingerprint: "a",
      },
      { actionKind: "question", disposition: "question", expectedRevision: "v1", fingerprint: "b" },
    ];
    const [first, second] = baseline;
    if (!first || !second) throw new Error("Expected candidate revision fixture entries.");
    expect(financeCandidateRevision(baseline)).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(financeCandidateRevision([...baseline].reverse())).not.toBe(
      financeCandidateRevision(baseline),
    );
    expect(financeCandidateRevision([{ ...first, fingerprint: "changed" }, second])).not.toBe(
      financeCandidateRevision(baseline),
    );
    expect(financeCandidateRevision([{ ...first, expectedRevision: "v2" }, second])).not.toBe(
      financeCandidateRevision(baseline),
    );
  });

  it("handles paced calendar ranges and provider categorization signals", () => {
    expect(nextMonth("2026-12")).toBe("2027-01");
    expect(nextMonth("2026-01")).toBe("2026-02");
    expect(daysInCalendarMonth("2028-02")).toBe(29);
    expect(daysInCalendarMonth("2026-02")).toBe(28);
    expect(budgetPaceDates("week", "2026-08-19")).toHaveLength(7);
    expect(budgetPaceDates("month", "2026-02-11")).toHaveLength(28);
    expect(budgetPaceDates("year", "2026-08-19")).toHaveLength(365);
    expect(categorization("Trader Joe's")).toEqual({
      category: "Groceries",
      confidence: 9_000,
      needsReview: false,
    });
    expect(categorization("LEE TACHMAN RENT")).toEqual({
      category: "RENT_AND_UTILITIES",
      confidence: 10_000,
      needsReview: false,
    });
    expect(categorization("Unknown", "Custom")).toEqual({
      category: "Custom",
      confidence: 10_000,
      needsReview: false,
    });
    expect(categorization("Unknown")).toEqual({
      category: null,
      confidence: null,
      needsReview: true,
    });
    expect(isRentMerchant("LEE TACHMAN")).toBe(true);
    expect(isRentMerchant("Coffee")).toBe(false);
    expect(isSoFiVaultTransfer("SOFI transfer to vault")).toBe(true);
    expect(isSoFiVaultTransfer("SOFI purchase")).toBe(false);
    expect(isSoFiVaultTransfer("FROM VAULT")).toBe(true);
    expect(isProviderTransfer("TRANSFER_IN")).toBe(true);
    expect(isProviderTransfer("TRANSFER_OUT")).toBe(true);
    expect(isProviderTransfer(null)).toBe(false);
    expect(isCardPayment("CARD PAYMENT")).toBe(true);
    expect(isCardPayment("Groceries")).toBe(false);
    expect(providerConfidence("VERY_HIGH")).toBe(0.985);
    expect(providerConfidence("HIGH")).toBe(0.9);
    expect(providerConfidence("MEDIUM")).toBe(0.75);
    expect(providerConfidence("LOW")).toBe(0.5);
    expect(providerConfidence("UNKNOWN")).toBeNull();
    expect(providerNeedsReview("VERY_HIGH")).toBe(false);
    expect(providerNeedsReview("HIGH")).toBe(false);
    expect(providerNeedsReview("MEDIUM")).toBe(true);
    expect(providerNeedsReview("LOW")).toBe(true);
    expect(providerNeedsReview("UNKNOWN")).toBe(true);
    expect(providerNeedsReview(undefined as never)).toBe(true);
  });

  it("round-trips and rejects transaction cursors", () => {
    const row = {
      amount: 1234,
      id: "transaction",
      merchant: "Cafe",
      transactionDate: "2026-08-19",
    } as never;
    for (const [sortBy, direction] of [
      ["amount", "asc"],
      ["merchant", "desc"],
      ["date", "asc"],
    ] as const) {
      expect(decodeTransactionCursor(encodeTransactionCursor(row, sortBy, direction))).toEqual(
        expect.objectContaining({ direction, id: "transaction", sortBy }),
      );
    }
    for (const cursor of [
      "",
      Buffer.from("{}").toString("base64url"),
      Buffer.from('{"sortBy":"date","direction":"ascending","id":"x","value":1}').toString(
        "base64url",
      ),
    ]) {
      expect(() => decodeTransactionCursor(cursor)).toThrow("transaction cursor is invalid");
    }
  });

  it("classifies pending, expense, transfer, and refund budget effects", () => {
    const row = (direction: "expense" | "income", category: string | null, pending = false) =>
      ({ amount: 2500, category, direction, pending }) as never;
    expect(isRefundOrReversal(row("income", "Dining"))).toBe(true);
    expect(isRefundOrReversal(row("income", "INCOME"))).toBe(false);
    expect(isRefundOrReversal(row("income", "OTHER"))).toBe(false);
    expect(isRefundOrReversal(row("income", "Transfers"))).toBe(false);
    expect(isRefundOrReversal(row("expense", "Dining"))).toBe(false);
    expect(budgetImpact(row("expense", "Dining", true))).toBe(0);
    expect(budgetImpact(row("expense", "Dining", true), true)).toBe(2500);
    expect(budgetImpact(row("income", "Dining"))).toBe(-2500);
    expect(budgetImpact(row("income", "INCOME"))).toBe(0);
    expect(budgetImpact(row("income", "Transfers"))).toBe(0);
    expect(budgetImpact(row("expense", "Dining"))).toBe(2500);
  });
});
