import { describe, expect, it } from "vitest";
import { selectPlausibleReimbursementCredits } from "./finance-reimbursement-candidates.js";

describe("Finance reimbursement credit candidates", () => {
  it("filters non-reimbursements and retains only evidence-backed unmatched credits", () => {
    const credit = (
      id: string,
      overrides: Partial<{
        amount: number;
        category: string | null;
        date: string;
        merchant: string;
        pending: boolean;
      }> = {},
    ) => ({
      amount: 100,
      category: null,
      date: "2026-08-15",
      id,
      merchant: "Venmo",
      pending: false,
      ...overrides,
    });

    expect(
      selectPlausibleReimbursementCredits({
        credits: [
          credit("fully-matched", { amount: 4 }),
          credit("pending", { pending: true }),
          credit("transfer-in", { category: "TRANSFER_IN" }),
          credit("transfer-out", { category: "TRANSFER_OUT" }),
          credit("income", { category: "INCOME" }),
          credit("salary", { merchant: "Payroll deposit" }),
          credit("unrelated", { merchant: "Grocery store" }),
          credit("payer-match", { merchant: "Venmo Alex" }),
          credit("amount-match", { amount: 20, merchant: "PayPal" }),
          credit("too-far", { amount: 1_000, date: "2025-01-01", merchant: "Zelle" }),
        ],
        matches: [
          { amount: 2, creditTransactionId: "fully-matched" },
          { amount: 3, creditTransactionId: "fully-matched" },
        ],
        reimbursements: [
          {
            createdAt: new Date("2026-08-01T00:00:00.000Z"),
            dueDate: "2026-08-15",
            expectedAmount: 100,
            payer: "Alex",
            receivedAmount: 0,
            status: "expected",
          },
          {
            createdAt: new Date("2026-08-01T00:00:00.000Z"),
            dueDate: null,
            expectedAmount: 50,
            payer: null,
            receivedAmount: 0,
            status: "expected",
          },
          {
            createdAt: new Date("2026-08-01T00:00:00.000Z"),
            dueDate: null,
            expectedAmount: 50,
            payer: null,
            receivedAmount: 0,
            status: "cancelled",
          },
          {
            createdAt: new Date("2026-08-01T00:00:00.000Z"),
            dueDate: null,
            expectedAmount: 50,
            payer: null,
            receivedAmount: 50,
            status: "received",
          },
          {
            createdAt: new Date("2026-08-01T00:00:00.000Z"),
            dueDate: null,
            expectedAmount: 50,
            payer: null,
            receivedAmount: 50,
            status: "expected",
          },
        ],
      }),
    ).toEqual([
      { matchedAmount: 0, remainingAmount: 100, transactionId: "payer-match" },
      { matchedAmount: 0, remainingAmount: 20, transactionId: "amount-match" },
    ]);
  });
});
