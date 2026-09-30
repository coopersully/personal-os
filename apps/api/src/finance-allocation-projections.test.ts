import { describe, expect, it } from "vitest";
import {
  activeAllocationsByTransaction,
  excludedReimbursementCentsByAllocation,
  matchedReimbursementCentsByCredit,
  personalAllocationCents,
} from "./finance-allocation-projections.js";

describe("Finance allocation projections", () => {
  it("aggregates lifecycle evidence without falling back to misleading gross spending", () => {
    const excluded = excludedReimbursementCentsByAllocation([
      { allocationId: "shared", expectedAmount: 80, receivedAmount: 20, status: "expected" },
      { allocationId: "shared", expectedAmount: 80, receivedAmount: 10, status: "cancelled" },
    ]);
    expect(excluded.get("shared")).toBe(90);

    const matched = matchedReimbursementCentsByCredit([
      { amount: 20, creditTransactionId: "credit" },
      { amount: 30, creditTransactionId: "credit" },
    ]);
    expect(matched.get("credit")).toBe(50);

    const allocations = activeAllocationsByTransaction([
      {
        amount: 40,
        id: "personal",
        state: "active",
        transactionId: "purchase",
        treatment: "personal",
      },
      {
        amount: 100,
        id: "shared",
        state: "active",
        transactionId: "purchase",
        treatment: "reimbursable",
      },
      {
        amount: 50,
        id: "invalidated",
        state: "invalidated",
        transactionId: "changed-purchase",
        treatment: "personal",
      },
    ]);
    expect(personalAllocationCents("purchase", 140, allocations, excluded)).toBe(50);
    expect(personalAllocationCents("changed-purchase", 50, allocations, excluded)).toBe(0);
    expect(personalAllocationCents("unallocated", 25, allocations, excluded)).toBe(25);
  });
});
