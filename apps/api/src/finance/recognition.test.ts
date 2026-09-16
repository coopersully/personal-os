import { describe, expect, it } from "vitest";
import { recognizeFinanceActivity } from "./recognition.js";

const accounts = [
  {
    currencyCode: "USD",
    id: "cash",
    includeInPlanning: true,
    kind: "cash" as const,
    ownershipShareBps: 10_000,
    ownershipType: "individual" as const,
  },
  {
    currencyCode: "USD",
    id: "investment",
    includeInPlanning: true,
    kind: "investment" as const,
    ownershipShareBps: 10_000,
    ownershipType: "individual" as const,
  },
];

const transaction = (
  id: string,
  changes: Partial<Parameters<typeof recognizeFinanceActivity>[0]["transactions"][number]> = {},
) => ({
  accountId: "cash",
  amount: 1_000,
  category: "DINING",
  currencyCode: "USD",
  direction: "expense" as const,
  id,
  pending: false,
  pendingTransactionId: null,
  providerDirection: "expense" as const,
  providerTransactionId: id,
  transactionDate: "2026-09-15",
  ...changes,
});

describe("Finance economic recognition", () => {
  it("recognizes posted replacements, split children, duplicates, fees, and pending exposure once", () => {
    const result = recognizeFinanceActivity({
      accounts,
      allocations: [],
      matches: [],
      relationships: [
        {
          eventId: "split-event",
          relationship: "split",
          transactionIds: ["split-parent", "split-a", "split-b"],
        },
        {
          eventId: "duplicate-event",
          relationship: "duplicate",
          transactionIds: ["duplicate-a", "duplicate-b"],
        },
      ],
      reimbursements: [],
      transactions: [
        transaction("pending-old", { amount: 2_000, pending: true }),
        transaction("posted-new", {
          amount: 2_100,
          pendingTransactionId: "pending-old",
        }),
        transaction("split-parent", { amount: 3_000 }),
        transaction("split-a", { amount: 1_000 }),
        transaction("split-b", { amount: 2_000 }),
        transaction("duplicate-a", { amount: 700 }),
        transaction("duplicate-b", { amount: 700 }),
        transaction("fee", { amount: 300, category: "BANK_FEE" }),
        transaction("pending", { amount: 900, pending: true }),
      ],
    });

    expect(result).toMatchObject({
      grossPostedExpenseCents: 6_100,
      pendingExposureCents: 900,
      postedSpendCents: 6_100,
    });
    expect(result.qualifications).toEqual([]);
  });

  it("keeps gross spend, expected reimbursement, received cash, and personal spend distinct", () => {
    const result = recognizeFinanceActivity({
      accounts,
      allocations: [
        {
          amount: 4_000,
          id: "personal",
          state: "active",
          transactionId: "purchase",
          treatment: "personal",
        },
        {
          amount: 6_000,
          id: "shared",
          state: "active",
          transactionId: "purchase",
          treatment: "reimbursable",
        },
      ],
      matches: [{ amount: 2_500, creditTransactionId: "credit", reimbursementId: "repayment" }],
      relationships: [],
      reimbursements: [
        {
          allocationId: "shared",
          expectedAmount: 6_000,
          id: "repayment",
          receivedAmount: 2_500,
          status: "partially_received",
        },
      ],
      transactions: [
        transaction("purchase", { amount: 10_000 }),
        transaction("credit", {
          amount: 2_500,
          category: "INCOME",
          direction: "income",
          providerDirection: "income",
        }),
      ],
    });

    expect(result).toMatchObject({
      grossPostedExpenseCents: 10_000,
      observedIncomeCents: 0,
      postedSpendCents: 4_000,
      reimbursementExpectedCents: 6_000,
      reimbursementOutstandingCents: 3_500,
      reimbursementReceivedCents: 2_500,
    });
  });

  it("keeps expected repayment out of pending cash exposure", () => {
    const result = recognizeFinanceActivity({
      accounts,
      allocations: [
        {
          amount: 6_000,
          id: "pending-shared",
          state: "active",
          transactionId: "pending-purchase",
          treatment: "reimbursable",
        },
        {
          amount: 4_000,
          id: "pending-personal",
          state: "active",
          transactionId: "pending-purchase",
          treatment: "personal",
        },
      ],
      matches: [],
      relationships: [],
      reimbursements: [
        {
          allocationId: "pending-shared",
          expectedAmount: 6_000,
          id: "pending-repayment",
          receivedAmount: 0,
          status: "expected",
        },
      ],
      transactions: [transaction("pending-purchase", { amount: 10_000, pending: true })],
    });

    expect(result.pendingExposureCents).toBe(10_000);
    expect(result.postedSpendCents).toBe(0);
  });

  it("restores cancelled reimbursement remainder and qualifies an invalid allocation sum", () => {
    const result = recognizeFinanceActivity({
      accounts,
      allocations: [
        {
          amount: 8_000,
          id: "shared",
          state: "active",
          transactionId: "purchase",
          treatment: "reimbursable",
        },
      ],
      matches: [{ amount: 2_000, creditTransactionId: "credit", reimbursementId: "cancelled" }],
      relationships: [],
      reimbursements: [
        {
          allocationId: "shared",
          expectedAmount: 8_000,
          id: "cancelled",
          receivedAmount: 2_000,
          status: "cancelled",
        },
      ],
      transactions: [
        transaction("purchase", { amount: 10_000 }),
        transaction("credit", {
          amount: 2_000,
          category: "OTHER",
          direction: "income",
          providerDirection: "income",
        }),
      ],
    });

    expect(result).toMatchObject({
      postedSpendCents: 8_000,
      reimbursementExpectedCents: 2_000,
      reimbursementOutstandingCents: 0,
      reimbursementReceivedCents: 2_000,
    });
    expect(result.qualifications).toContainEqual({
      code: "allocation_sum_mismatch",
      sourceIds: ["purchase"],
    });
  });

  it("treats an own-account investment contribution as an asset transfer", () => {
    const result = recognizeFinanceActivity({
      accounts,
      allocations: [],
      matches: [],
      relationships: [
        {
          eventId: "contribution",
          relationship: "transfer",
          transactionIds: ["cash-leg", "investment-leg"],
        },
      ],
      reimbursements: [],
      transactions: [
        transaction("cash-leg", {
          amount: 5_000,
          category: "TRANSFER_OUT",
        }),
        transaction("investment-leg", {
          accountId: "investment",
          amount: 5_000,
          category: "TRANSFER_IN",
          direction: "income",
          providerDirection: "income",
        }),
      ],
    });

    expect(result).toMatchObject({
      investmentContributionsCents: 5_000,
      observedIncomeCents: 0,
      postedSpendCents: 0,
    });
  });

  it("weights owned activity and qualifies unknown ownership and unsupported currency", () => {
    const result = recognizeFinanceActivity({
      accounts: [
        {
          currencyCode: "USD",
          id: "joint",
          includeInPlanning: true,
          kind: "cash",
          ownershipShareBps: 5_000,
          ownershipType: "joint",
        },
        {
          currencyCode: "USD",
          id: "unknown",
          includeInPlanning: true,
          kind: "cash",
          ownershipShareBps: null,
          ownershipType: "unknown",
        },
      ],
      allocations: [],
      matches: [],
      relationships: [],
      reimbursements: [],
      transactions: [
        transaction("joint-spend", { accountId: "joint", amount: 1_001 }),
        transaction("unknown-spend", { accountId: "unknown", amount: 700 }),
        transaction("foreign-spend", {
          accountId: "joint",
          amount: 900,
          currencyCode: "EUR",
        }),
      ],
    });

    expect(result.postedSpendCents).toBe(1_201);
    expect(result.qualifications).toEqual([
      { code: "ownership_unknown", sourceIds: ["unknown"] },
      { code: "unsupported_currency", sourceIds: ["foreign-spend"] },
    ]);
  });

  it("does not recognize excluded-account activity", () => {
    const [cashAccount] = accounts;
    if (!cashAccount) throw new Error("Cash account fixture is missing.");
    const result = recognizeFinanceActivity({
      accounts: [{ ...cashAccount, includeInPlanning: false }],
      allocations: [
        {
          amount: 1_000,
          id: "excluded-allocation",
          state: "active",
          transactionId: "excluded",
          treatment: "reimbursable",
        },
      ],
      matches: [],
      relationships: [],
      reimbursements: [
        {
          allocationId: "excluded-allocation",
          expectedAmount: 1_000,
          id: "excluded-reimbursement",
          receivedAmount: 0,
          status: "expected",
        },
      ],
      transactions: [transaction("excluded")],
    });

    expect(result).toMatchObject({
      grossPostedExpenseCents: 0,
      pendingExposureCents: 0,
      postedSpendCents: 0,
      reimbursementExpectedCents: 0,
    });
  });
});
