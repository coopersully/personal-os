import { describe, expect, it } from "vitest";
import { qualifyReimbursementPersonalCost } from "./finance-reimbursement-cost.js";
function fixture(): Parameters<typeof qualifyReimbursementPersonalCost>[0] {
  const tx = {
    userId: "owner",
    accountId: "account",
    currencyCode: "EUR",
    pending: false,
    providerDirection: null,
    transferGroupId: null,
    reconciliationStatus: "not_applicable",
  };
  return {
    ownerUserId: "owner",
    expenseTransactionId: "expense",
    accounts: [
      { id: "account", userId: "owner", ownershipType: "individual", ownershipShareBps: 10_000 },
    ],
    transactions: [
      { ...tx, id: "expense", direction: "expense", amount: 20_000 },
      { ...tx, id: "credit", direction: "income", amount: 5_000 },
    ],
    allocations: [
      {
        id: "reimb",
        userId: "owner",
        transactionId: "expense",
        amount: 12_000,
        state: "active",
        treatment: "reimbursable",
      },
      {
        id: "personal",
        userId: "owner",
        transactionId: "expense",
        amount: 8_000,
        state: "active",
        treatment: "personal",
      },
    ],
    reimbursements: [
      {
        id: "case",
        userId: "owner",
        allocationId: "reimb",
        expectedAmount: 10_000,
        receivedAmount: 5_000,
        status: "partially_received",
      },
    ],
    matches: [
      {
        id: "match",
        userId: "owner",
        reimbursementId: "case",
        creditTransactionId: "credit",
        amount: 5_000,
      },
    ],
    relationships: [],
  };
}
describe("qualifyReimbursementPersonalCost", () => {
  it("uses gross less actual received through canonical allocation arithmetic, never expected recovery", () => {
    expect(qualifyReimbursementPersonalCost(fixture())).toEqual({
      state: "qualified",
      amountCents: 15_000,
      receivedCents: 5_000,
      currency: "EUR",
      scope: "whole_expense",
    });
    const input = fixture();
    if (input.reimbursements[0]) input.reimbursements[0].expectedAmount = 12_000;
    expect(qualifyReimbursementPersonalCost(input)).toMatchObject({ amountCents: 15_000 });
  });
  it("does not treat expected but unreceived reimbursement as recovered cash", () => {
    const input = fixture();
    input.matches = [];
    if (input.reimbursements[0]) input.reimbursements[0].receivedAmount = 0;
    expect(qualifyReimbursementPersonalCost(input)).toMatchObject({
      state: "qualified",
      amountCents: 20_000,
      receivedCents: 0,
    });
  });
  it("retains actual receipts after cancellation without subtracting the cancelled remainder", () => {
    const input = fixture();
    if (input.reimbursements[0]) input.reimbursements[0].status = "cancelled";
    expect(qualifyReimbursementPersonalCost(input)).toMatchObject({
      state: "qualified",
      amountCents: 15_000,
    });
  });
  it("qualifies all allocations/cases of one expense without inventing a case-level personal share", () => {
    const input = fixture();
    input.allocations = [
      {
        id: "first",
        userId: "owner",
        transactionId: "expense",
        amount: 10_000,
        state: "active",
        treatment: "reimbursable",
      },
      {
        id: "second",
        userId: "owner",
        transactionId: "expense",
        amount: 10_000,
        state: "active",
        treatment: "reimbursable",
      },
    ];
    input.reimbursements = [
      {
        id: "case",
        userId: "owner",
        allocationId: "first",
        expectedAmount: 5_000,
        receivedAmount: 2_000,
        status: "partially_received",
      },
      {
        id: "case2",
        userId: "owner",
        allocationId: "second",
        expectedAmount: 8_000,
        receivedAmount: 3_000,
        status: "partially_received",
      },
    ];
    input.matches = [
      {
        id: "m1",
        userId: "owner",
        reimbursementId: "case",
        creditTransactionId: "credit",
        amount: 2_000,
      },
      {
        id: "m2",
        userId: "owner",
        reimbursementId: "case2",
        creditTransactionId: "credit",
        amount: 3_000,
      },
    ];
    expect(qualifyReimbursementPersonalCost(input)).toMatchObject({
      state: "qualified",
      amountCents: 15_000,
      scope: "whole_expense",
    });
  });
  it.each([
    "joint",
    "unknown",
  ])("refuses %s ownership rather than assuming full cost", (ownershipType) => {
    const input = fixture();
    if (input.accounts[0]) input.accounts[0].ownershipType = ownershipType;
    expect(qualifyReimbursementPersonalCost(input)).toMatchObject({
      state: "unavailable",
      reason: "unknown_ownership",
    });
  });
  it.each([null, 5000])("refuses missing/partial ownership share %s", (ownershipShareBps) => {
    const input = fixture();
    if (input.accounts[0]) input.accounts[0].ownershipShareBps = ownershipShareBps;
    expect(qualifyReimbursementPersonalCost(input)).toMatchObject({
      state: "unavailable",
      reason: "unknown_ownership",
    });
  });
  it.each([null, "JPY", "KWD", "XAU", "ZZZ"])("refuses unsupported currency %s", (currencyCode) => {
    const input = fixture();
    if (input.transactions[0]) input.transactions[0].currencyCode = currencyCode;
    expect(qualifyReimbursementPersonalCost(input)).toMatchObject({
      state: "unavailable",
      reason: "unsupported_currency",
    });
  });
  it.each([0, 1])("refuses pending expense/receipt %s", (index) => {
    const input = fixture();
    const tx = input.transactions[index];
    if (tx) tx.pending = true;
    expect(qualifyReimbursementPersonalCost(input)).toMatchObject({
      state: "unavailable",
      reason: "pending_activity",
    });
  });
  it.each([
    "allocation_missing",
    "incomplete",
    "invalidated",
    "needs_input",
    "received_mismatch",
    "credit_capacity",
    "allocation_capacity",
    "missing_receipt",
    "currency_mismatch",
    "relationship",
    "receipt_relationship",
    "foreign",
    "direction",
    "ambiguous_transfer",
  ])("keeps unsupported facts unavailable: %s", (change) => {
    const input = fixture();
    const allocation = input.allocations[0],
      row = input.reimbursements[0],
      match = input.matches[0],
      expense = input.transactions[0],
      credit = input.transactions[1];
    if (change === "allocation_missing") input.allocations = [];
    if (change === "incomplete" && allocation) allocation.amount = 11_000;
    if (change === "invalidated" && allocation) allocation.state = "invalidated";
    if (change === "needs_input" && row) row.status = "needs_input";
    if (change === "received_mismatch" && row) row.receivedAmount = 4_000;
    if (change === "credit_capacity" && credit) credit.amount = 4_999;
    if (change === "allocation_capacity" && row) row.expectedAmount = 12_001;
    if (change === "missing_receipt")
      input.transactions = input.transactions.filter((tx) => tx.id !== "credit");
    if (change === "currency_mismatch" && credit) credit.currencyCode = "USD";
    if (change === "relationship")
      input.relationships = [{ userId: "owner", transactionIds: ["expense"] }];
    if (change === "receipt_relationship")
      input.relationships = [{ userId: "owner", transactionIds: ["credit"] }];
    if (change === "foreign" && match) match.userId = "other";
    if (change === "direction" && expense) expense.direction = "transfer";
    if (change === "ambiguous_transfer" && credit) credit.reconciliationStatus = "candidate";
    expect(qualifyReimbursementPersonalCost(input).state).toBe("unavailable");
  });
  it("checks global credit capacity including matches for another expense", () => {
    const input = fixture();
    input.reimbursements = [
      ...input.reimbursements,
      {
        id: "other",
        userId: "owner",
        allocationId: "elsewhere",
        expectedAmount: 1,
        receivedAmount: 1,
        status: "received",
      },
    ];
    input.matches = [
      ...input.matches,
      {
        id: "other",
        userId: "owner",
        reimbursementId: "other",
        creditTransactionId: "credit",
        amount: 1,
      },
    ];
    expect(qualifyReimbursementPersonalCost(input)).toMatchObject({
      state: "unavailable",
      reason: "corrupt_match",
    });
  });
  it.each([
    NaN,
    Infinity,
    -1,
    0.5,
    Number.MAX_SAFE_INTEGER,
  ])("rejects invalid gross cents %s", (amount) => {
    const input = fixture();
    if (input.transactions[0]) input.transactions[0].amount = amount;
    expect(qualifyReimbursementPersonalCost(input)).toMatchObject({
      state: "unavailable",
      reason: "invalid_money",
    });
  });
});
