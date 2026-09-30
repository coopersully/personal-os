import { describe, expect, it } from "vitest";
import { recognizeFinanceActivity } from "./recognition.js";

const userId = "user-1";

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
  reconciliationStatus: "not_applicable" as const,
  transactionDate: "2026-09-15",
  transferGroupId: null,
  userId,
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
          createdAt: "2026-09-15T12:00:00.000Z",
          eventId: "split-event",
          eventUserId: userId,
          id: "split-relationship",
          provenance: { actorType: "user" },
          provenanceValidated: true,
          relationship: "split",
          transactionIds: ["split-parent", "split-a", "split-b"],
          userId,
        },
        {
          createdAt: "2026-09-15T12:00:00.000Z",
          eventId: "duplicate-event",
          eventUserId: userId,
          id: "duplicate-relationship",
          provenance: { actorType: "user" },
          provenanceValidated: true,
          relationship: "duplicate",
          transactionIds: ["duplicate-a", "duplicate-b"],
          userId,
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
      userId,
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
      userId,
    });

    expect(result).toMatchObject({
      grossPostedExpenseCents: 10_000,
      observedIncomeCents: 0,
      postedSpendCents: 7_500,
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
      userId,
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
      userId,
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
          createdAt: "2026-09-15T12:00:00.000Z",
          eventId: "contribution",
          eventUserId: userId,
          id: "contribution-relationship",
          provenance: { actorType: "user" },
          provenanceValidated: true,
          relationship: "transfer",
          transactionIds: ["cash-leg", "investment-leg"],
          userId,
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
      userId,
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
      userId,
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
      userId,
    });

    expect(result).toMatchObject({
      grossPostedExpenseCents: 0,
      pendingExposureCents: 0,
      postedSpendCents: 0,
      reimbursementExpectedCents: 0,
    });
  });

  it("uses the latest trusted tenant relationship for the same transaction set", () => {
    const result = recognizeFinanceActivity({
      accounts,
      allocations: [],
      matches: [],
      relationships: [
        {
          createdAt: "2026-09-15T12:00:00.000Z",
          eventId: "stale-transfer",
          eventUserId: userId,
          id: "stale-transfer-relationship",
          provenance: { actorType: "agent", maintenanceRunId: "run-1" },
          provenanceValidated: true,
          relationship: "transfer",
          transactionIds: ["cash-leg", "investment-leg"],
          userId,
        },
        {
          createdAt: "2026-09-15T13:00:00.000Z",
          eventId: "manual-duplicate",
          eventUserId: userId,
          id: "manual-duplicate-relationship",
          provenance: { actorType: "user" },
          provenanceValidated: true,
          relationship: "duplicate",
          transactionIds: ["cash-leg", "investment-leg"],
          userId,
        },
      ],
      reimbursements: [],
      transactions: [
        transaction("cash-leg"),
        transaction("investment-leg", {
          accountId: "investment",
          direction: "income",
          providerDirection: "income",
        }),
      ],
      userId,
    });

    expect(result).toMatchObject({
      investmentContributionsCents: 0,
      observedIncomeCents: 0,
      postedSpendCents: 1_000,
    });
  });

  it("ignores cross-tenant and unvalidated relationship evidence", () => {
    const result = recognizeFinanceActivity({
      accounts,
      allocations: [],
      matches: [],
      relationships: [
        {
          createdAt: "2026-09-15T12:00:00.000Z",
          eventId: "foreign-transfer",
          eventUserId: "other-user",
          id: "foreign-transfer-relationship",
          provenance: { actorType: "user" },
          provenanceValidated: true,
          relationship: "transfer",
          transactionIds: ["expense"],
          userId: "other-user",
        },
        {
          createdAt: "2026-09-15T13:00:00.000Z",
          eventId: "unvalidated-transfer",
          eventUserId: userId,
          id: "unvalidated-transfer-relationship",
          provenance: { actorType: "agent" },
          provenanceValidated: false,
          relationship: "transfer",
          transactionIds: ["expense"],
          userId,
        },
      ],
      reimbursements: [],
      transactions: [transaction("expense")],
      userId,
    });

    expect(result.postedSpendCents).toBe(1_000);
  });

  it("honors reconciler-shaped matched transfer rows and preserves contributions", () => {
    const result = recognizeFinanceActivity({
      accounts,
      allocations: [],
      matches: [],
      relationships: [],
      reimbursements: [],
      transactions: [
        transaction("cash-leg", {
          category: "TRANSFER_OUT",
          direction: "transfer",
          providerDirection: "expense",
          reconciliationStatus: "matched",
          transferGroupId: "transfer-group",
        }),
        transaction("investment-leg", {
          accountId: "investment",
          category: "TRANSFER_IN",
          direction: "transfer",
          providerDirection: "income",
          reconciliationStatus: "matched",
          transferGroupId: "transfer-group",
        }),
      ],
      userId,
    });

    expect(result).toMatchObject({
      grossPostedExpenseCents: 0,
      investmentContributionsCents: 1_000,
      observedIncomeCents: 0,
      postedSpendCents: 0,
      refundCreditsCents: 0,
    });
  });

  it.each([
    "Income",
    "PAYROLL",
    "CUSTOM_INCOME",
    null,
  ])("recognizes %s credits as income without explicit refund evidence", (category) => {
    const result = recognizeFinanceActivity({
      accounts,
      allocations: [],
      matches: [],
      relationships: [],
      reimbursements: [],
      transactions: [
        transaction("income", {
          category,
          direction: "income",
          providerDirection: "income",
        }),
      ],
      userId,
    });

    expect(result).toMatchObject({ observedIncomeCents: 1_000, refundCreditsCents: 0 });
  });

  it("recognizes refund credits only from explicit current relationship evidence", () => {
    const result = recognizeFinanceActivity({
      accounts,
      allocations: [],
      matches: [],
      relationships: [
        {
          createdAt: "2026-09-15T12:00:00.000Z",
          eventId: "refund-event",
          eventUserId: userId,
          id: "refund-relationship",
          provenance: { actorType: "user" },
          provenanceValidated: true,
          relationship: "refund",
          transactionIds: ["refund"],
          userId,
        },
      ],
      reimbursements: [],
      transactions: [
        transaction("refund", {
          category: null,
          direction: "income",
          providerDirection: "income",
        }),
      ],
      userId,
    });

    expect(result).toMatchObject({ observedIncomeCents: 0, refundCreditsCents: 1_000 });
  });

  it("deduplicates repeated rows for one current transfer event", () => {
    const repeated = {
      createdAt: "2026-09-15T12:00:00.000Z",
      eventId: "transfer-event",
      eventUserId: userId,
      provenance: { actorType: "user" as const },
      provenanceValidated: true,
      relationship: "transfer" as const,
      transactionIds: ["cash-leg", "investment-leg"],
      userId,
    };
    const result = recognizeFinanceActivity({
      accounts,
      allocations: [],
      matches: [],
      relationships: [
        { ...repeated, id: "transfer-row-1" },
        {
          ...repeated,
          createdAt: "2026-09-15T13:00:00.000Z",
          id: "transfer-row-2",
        },
      ],
      reimbursements: [],
      transactions: [
        transaction("cash-leg"),
        transaction("investment-leg", {
          accountId: "investment",
          direction: "income",
          providerDirection: "income",
        }),
      ],
      userId,
    });

    expect(result.investmentContributionsCents).toBe(1_000);
  });

  it("aggregates reimbursement cents before applying ownership", () => {
    const [cashAccount] = accounts;
    if (!cashAccount) throw new Error("Cash account fixture is missing.");
    const result = recognizeFinanceActivity({
      accounts: [
        {
          ...cashAccount,
          id: "joint",
          ownershipShareBps: 5_000,
          ownershipType: "joint",
        },
      ],
      allocations: [
        {
          amount: 1,
          id: "shared-a",
          state: "active",
          transactionId: "purchase",
          treatment: "reimbursable",
        },
        {
          amount: 1,
          id: "shared-b",
          state: "active",
          transactionId: "purchase",
          treatment: "reimbursable",
        },
      ],
      matches: [],
      relationships: [],
      reimbursements: [
        {
          allocationId: "shared-a",
          expectedAmount: 1,
          id: "repayment-a",
          receivedAmount: 0,
          status: "expected",
        },
        {
          allocationId: "shared-b",
          expectedAmount: 1,
          id: "repayment-b",
          receivedAmount: 0,
          status: "expected",
        },
      ],
      transactions: [transaction("purchase", { accountId: "joint", amount: 2 })],
      userId,
    });

    expect(result).toMatchObject({
      grossPostedExpenseCents: 1,
      postedSpendCents: 1,
      reimbursementExpectedCents: 1,
    });
  });

  it("chooses a posted duplicate deterministically over a pending duplicate", () => {
    const result = recognizeFinanceActivity({
      accounts,
      allocations: [],
      matches: [],
      relationships: [
        {
          createdAt: "2026-09-15T12:00:00.000Z",
          eventId: "duplicate-event",
          eventUserId: userId,
          id: "duplicate-row",
          provenance: { actorType: "user" },
          provenanceValidated: true,
          relationship: "duplicate",
          transactionIds: ["pending-copy", "posted-copy"],
          userId,
        },
      ],
      reimbursements: [],
      transactions: [transaction("pending-copy", { pending: true }), transaction("posted-copy")],
      userId,
    });

    expect(result).toMatchObject({
      grossPostedExpenseCents: 1_000,
      pendingExposureCents: 0,
      postedSpendCents: 1_000,
    });
  });

  it("retains visible activity and qualifies an incomplete transfer relationship", () => {
    const result = recognizeFinanceActivity({
      accounts,
      allocations: [],
      matches: [],
      relationships: [
        {
          createdAt: "2026-09-15T12:00:00.000Z",
          eventId: "incomplete-transfer",
          eventUserId: userId,
          id: "incomplete-transfer-row",
          provenance: { actorType: "user" },
          provenanceValidated: true,
          relationship: "transfer",
          transactionIds: ["expense", "missing-counterpart"],
          userId,
        },
      ],
      reimbursements: [],
      transactions: [transaction("expense")],
      userId,
    });

    expect(result.postedSpendCents).toBe(1_000);
    expect(result.qualifications).toContainEqual({
      code: "transfer_evidence_incomplete",
      sourceIds: ["incomplete-transfer"],
    });
  });

  it("recognizes a linked reimbursement credit without counting it as income", () => {
    const result = recognizeFinanceActivity({
      accounts,
      allocations: [],
      matches: [],
      relationships: [
        {
          createdAt: "2026-09-15T12:00:00.000Z",
          eventId: "reimbursement-event",
          eventUserId: userId,
          id: "reimbursement-row",
          provenance: { actorType: "user" },
          provenanceValidated: true,
          relationship: "reimbursement",
          transactionIds: ["purchase", "repayment"],
          userId,
        },
      ],
      reimbursements: [],
      transactions: [
        transaction("purchase"),
        transaction("repayment", {
          amount: 600,
          category: "Income",
          direction: "income",
          providerDirection: "income",
        }),
      ],
      userId,
    });

    expect(result).toMatchObject({
      observedIncomeCents: 0,
      postedSpendCents: 400,
      reimbursementExpectedCents: 600,
      reimbursementOutstandingCents: 0,
      reimbursementReceivedCents: 600,
    });
  });

  it.each([
    { received: 600, credit: 2_000, share: 10_000, total: 1_000, spend: 0, income: 1_000 },
    { received: 1_000, credit: 2_000, share: 10_000, total: 1_000, spend: 0, income: 1_000 },
    { received: 600, credit: 800, share: 10_000, total: 800, spend: 200, income: 0 },
    { received: 600, credit: 2_000, share: 5_000, total: 500, spend: 0, income: 500 },
  ])("caps allocation and relationship receipts at owned expense capacity: $received/$credit/$share", ({
    received,
    credit,
    share,
    total,
    spend,
    income,
  }) => {
    const result = recognizeFinanceActivity({
      accounts: accounts.map((account) => ({ ...account, ownershipShareBps: share })),
      allocations: [
        {
          id: "shared",
          transactionId: "purchase",
          amount: 1_000,
          treatment: "reimbursable",
          state: "active",
        },
      ],
      reimbursements: [
        {
          id: "repayment",
          allocationId: "shared",
          expectedAmount: 1_000,
          receivedAmount: received,
          status: received === 1_000 ? "received" : "partially_received",
        },
      ],
      matches: [{ amount: received, creditTransactionId: "credit", reimbursementId: "repayment" }],
      relationships: [
        {
          id: "repayment-link",
          eventId: "repayment-event",
          eventUserId: userId,
          userId,
          createdAt: "2026-09-15T12:00:00.000Z",
          provenance: { actorType: "user" },
          provenanceValidated: true,
          relationship: "reimbursement",
          transactionIds: ["purchase", "credit"],
        },
      ],
      transactions: [
        transaction("purchase"),
        transaction("credit", { amount: credit, direction: "income", providerDirection: "income" }),
      ],
      userId,
    });
    expect(result).toMatchObject({
      reimbursementReceivedCents: total,
      postedSpendCents: spend,
      observedIncomeCents: income,
    });
  });
  it("keeps invalidated allocations and their reimbursements unresolved", () => {
    const result = recognizeFinanceActivity({
      accounts,
      allocations: [
        {
          amount: 1_000,
          id: "invalidated-allocation",
          state: "invalidated",
          transactionId: "purchase",
          treatment: "reimbursable",
        },
      ],
      matches: [
        {
          amount: 200,
          creditTransactionId: "invalidated-credit",
          reimbursementId: "invalidated-reimbursement",
        },
      ],
      relationships: [],
      reimbursements: [
        {
          allocationId: "invalidated-allocation",
          expectedAmount: 600,
          id: "invalidated-reimbursement",
          receivedAmount: 200,
          status: "partially_received",
        },
      ],
      transactions: [
        transaction("purchase"),
        transaction("invalidated-credit", {
          amount: 200,
          category: "Income",
          direction: "income",
          providerDirection: "income",
        }),
      ],
      userId,
    });

    expect(result).toMatchObject({
      postedSpendCents: 0,
      observedIncomeCents: 200,
      reimbursementExpectedCents: 0,
      reimbursementReceivedCents: 0,
    });
    expect(result.qualifications).toEqual(
      expect.arrayContaining([
        { code: "allocation_evidence_unresolved", sourceIds: ["purchase"] },
        {
          code: "reimbursement_allocation_unresolved",
          sourceIds: ["invalidated-reimbursement"],
        },
      ]),
    );
  });
});
