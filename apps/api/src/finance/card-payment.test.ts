import { describe, expect, it } from "vitest";
import { observesCardPurchases, settledCardPaymentIds } from "./card-payment.js";

const label = "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT";
const row = (
  id: string,
  accountId: string,
  direction: string,
  amount: number,
  transactionDate: string,
  extra: { category?: string | null; providerCategoryDetailed?: string | null } = {},
) => ({
  accountId,
  amount,
  category: "LOAN_PAYMENTS",
  categorySource: "provider",
  direction,
  id,
  providerCategoryDetailed: label,
  transactionDate,
  ...extra,
});
const cards = new Set(["card"]);

describe("settled card payments", () => {
  it("settles a funding leg only against a receipt of the same amount within the window", () => {
    const settled = settledCardPaymentIds(
      [
        row("paid", "checking", "expense", 302_060, "2026-10-30"),
        row("receipt", "card", "income", 302_060, "2026-11-02T04:00:00Z"),
        row("too-late", "checking", "expense", 5_000, "2026-11-01"),
        row("late-receipt", "card", "income", 5_000, "2026-11-07"),
        row("wrong-amount", "checking", "expense", 9_999, "2026-11-02"),
        row("other-card", "checking", "expense", 40_000, "2026-11-02"),
      ],
      cards,
    );
    expect([...settled].sort()).toEqual(["late-receipt", "paid", "receipt"]);
  });

  it("lets one receipt settle one payment, nearest date first", () => {
    const settled = settledCardPaymentIds(
      [
        row("far", "checking", "expense", 10_000, "2026-11-01"),
        row("near", "checking", "transfer", 10_000, "2026-11-04"),
        row("receipt", "card", "transfer", 10_000, "2026-11-05", {
          category: "Transfers",
          providerCategoryDetailed: null,
        }),
      ],
      cards,
    );
    // The earlier payment claims the only receipt; the unlabelled receipt is not itself a payment row.
    expect([...settled]).toEqual(["far"]);
  });

  it("ignores card purchases, refunds, income on the funding side and people with no card", () => {
    const rows = [
      row("purchase", "card", "expense", 10_000, "2026-11-02"),
      row("refund", "card", "income", 10_000, "2026-11-02", {
        category: "Shopping",
        providerCategoryDetailed: "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES",
      }),
      row("paid", "checking", "expense", 10_000, "2026-11-02"),
      row("credit", "checking", "income", 10_000, "2026-11-02"),
    ];
    expect(settledCardPaymentIds(rows, cards).size).toBe(0);
    expect(
      settledCardPaymentIds([row("receipt", "card", "income", 1, "2026-11-02")], new Set()).size,
    ).toBe(0);
  });

  it("observes purchases only on a connected, planning-included credit card", () => {
    const card = {
      includeInPlanning: true,
      kind: "debt",
      providerType: "credit",
      status: "connected",
    };
    expect(observesCardPurchases(card)).toBe(true);
    for (const other of [
      { ...card, includeInPlanning: false },
      { ...card, kind: "cash" },
      { ...card, providerType: "loan" },
      { ...card, providerType: null, status: "manual" },
      { ...card, status: "needs_reauth" },
    ])
      expect(observesCardPurchases(other)).toBe(false);
  });
});
