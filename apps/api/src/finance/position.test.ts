import { financePositionEvidenceSchema } from "@personal-os/domain";
import { describe, expect, it } from "vitest";
import { buildFinancePosition, type PositionInput } from "./position.js";

const userId = "00000000-0000-4000-8000-000000000001";
const cashId = "00000000-0000-4000-8000-000000000002";
const debtId = "00000000-0000-4000-8000-000000000003";
const purchaseId = "00000000-0000-4000-8000-000000000004";
const base: PositionInput = {
  userId,
  asOf: "2026-09-18T12:00:00.000Z",
  scope: { accountIds: [cashId, debtId], from: "2026-09-01", through: "2026-09-18" },
  activitySource: { id: userId, revision: "activity-1" },
  accounts: [
    {
      id: cashId,
      balance: 10_000,
      currencyCode: "USD",
      includeInPlanning: true,
      kind: "cash",
      ownershipShareBps: 10_000,
      ownershipType: "individual",
      reasons: [],
      source: { id: cashId, revision: "cash-1" },
    },
    {
      id: debtId,
      balance: -2_000,
      currencyCode: "USD",
      includeInPlanning: true,
      kind: "debt",
      ownershipShareBps: 10_000,
      ownershipType: "individual",
      reasons: [],
      source: { id: debtId, revision: "debt-1" },
    },
  ],
  allocations: [],
  matches: [],
  relationships: [],
  reimbursements: [],
  transactions: [
    {
      id: purchaseId,
      accountId: cashId,
      userId,
      amount: 1_000,
      category: null,
      currencyCode: "USD",
      direction: "expense",
      pending: false,
      pendingTransactionId: null,
      providerDirection: "expense",
      providerTransactionId: null,
      reconciliationStatus: "not_applicable",
      transactionDate: "2026-09-12",
      transferGroupId: null,
    },
  ],
};
const reservation = (id: string) => ({
  cents: 1_000,
  currency: "USD" as const,
  quality: "verified" as const,
  reasons: [],
  sources: [{ id, revision: "reservation-1" }],
});

describe("qualified Finance position producer", () => {
  it("validates the landed contract and separates liabilities from assets", () => {
    const { position } = buildFinancePosition(base);
    expect(financePositionEvidenceSchema.safeParse(position).success).toBe(true);
    expect(position.cash).toMatchObject({ cents: 10_000, quality: "verified" });
    expect(position.debt.cents).toBe(2_000);
    expect(position.netWorth.cents).toBe(8_000);
    expect(position.postedSpend.cents).toBe(1_000);
    expect(position.committed).toMatchObject({ cents: null, reasons: ["missing_commitments"] });
    expect(position.spendable).toMatchObject({
      cents: null,
      quality: "unavailable",
      reasons: ["missing_commitments", "missing_protection_policy"],
    });
  });
  it("reproduces a revision despite account order or later observation time", () => {
    const first = buildFinancePosition(base).position;
    const second = buildFinancePosition({
      ...base,
      asOf: "2026-09-18T13:00:00.000Z",
      accounts: [...base.accounts].reverse(),
      scope: { ...base.scope, accountIds: [...base.scope.accountIds].reverse() },
    }).position;
    expect(second.revision).toBe(first.revision);
  });
  it("changes the evidence revision when a dependent source revision changes", () => {
    expect(
      buildFinancePosition({ ...base, activitySource: { id: userId, revision: "corrected" } })
        .position.revision,
    ).not.toBe(buildFinancePosition(base).position.revision);
  });
  it("qualifies the affected stale source while another asset remains verified", () => {
    const accounts = base.accounts.map((account) =>
      account.id === cashId ? { ...account, reasons: ["stale_evidence" as const] } : account,
    );
    const { position } = buildFinancePosition({ ...base, accounts });
    expect(position.cash).toMatchObject({
      cents: 10_000,
      quality: "qualified",
      reasons: ["stale_evidence"],
    });
    expect(position.debt.quality).toBe("verified");
    expect(position.netWorth.quality).toBe("qualified");
  });
  it("does not certify a missing or unsupported balance", () => {
    for (const change of [{ balance: null }, { currencyCode: "EUR" }]) {
      const accounts = base.accounts.map((account) =>
        account.id === cashId ? { ...account, ...change } : account,
      );
      const { position } = buildFinancePosition({ ...base, accounts });
      expect(position.cash.cents).toBeNull();
      expect(position.netWorth.cents).toBeNull();
      expect(position.debt.cents).toBe(2_000);
    }
  });
  it("keeps reported balances qualified when ownership is unknown", () => {
    const accounts = base.accounts.map((account) =>
      account.id === cashId
        ? { ...account, ownershipShareBps: null, ownershipType: "unknown" as const }
        : account,
    );
    const { position } = buildFinancePosition({
      ...base,
      accounts,
      committed: reservation(purchaseId),
      protected: reservation(userId),
    });
    expect(position.cash).toMatchObject({
      cents: 10_000,
      quality: "qualified",
      reasons: ["incomplete_evidence"],
    });
    expect(position.spendable.cents).toBeNull();
  });
  it("excludes removed planning accounts and out-of-period postings", () => {
    const accounts = base.accounts.map((account) => ({
      ...account,
      includeInPlanning: account.id !== debtId,
    }));
    const transactions = base.transactions.map((transaction) => ({
      ...transaction,
      transactionDate: "2026-08-31",
    }));
    const { position } = buildFinancePosition({ ...base, accounts, transactions });
    expect(position.netWorth.cents).toBe(10_000);
    expect(position.postedSpend.cents).toBe(0);
  });
  it("requires source evidence instead of declaring an empty position verified", () => {
    const { position } = buildFinancePosition({ ...base, accounts: [], transactions: [] });
    expect(position.cash.cents).toBeNull();
    expect(position.postedSpend).toMatchObject({
      cents: null,
      quality: "unavailable",
      reasons: ["source_unavailable"],
    });
  });
  it("uses only the landed reason codes for invalidated allocation evidence", () => {
    const { position } = buildFinancePosition({
      ...base,
      allocations: [
        {
          id: userId,
          transactionId: purchaseId,
          amount: 1_000,
          state: "invalidated",
          treatment: "personal",
        },
      ],
    });
    expect(position.postedSpend).toMatchObject({
      cents: 0,
      quality: "qualified",
      reasons: ["unresolved_allocation"],
    });
  });
  it("subtracts disjoint evidenced reservations once and blocks overlapping reservations", () => {
    const { position } = buildFinancePosition({
      ...base,
      committed: reservation(purchaseId),
      protected: reservation(userId),
    });
    expect(position.spendable).toMatchObject({ cents: 8_000, quality: "verified" });
    const overlap = buildFinancePosition({
      ...base,
      committed: reservation(purchaseId),
      protected: reservation(purchaseId),
    }).position;
    expect(overlap.spendable).toMatchObject({
      cents: null,
      quality: "unavailable",
      reasons: ["incomplete_evidence"],
    });
  });
  it("keeps pending exposure separate and qualified", () => {
    const { position } = buildFinancePosition({
      ...base,
      transactions: base.transactions.map((transaction) => ({ ...transaction, pending: true })),
    });
    expect(position.postedSpend.cents).toBe(0);
    expect(position.pendingExposure).toMatchObject({
      cents: 1_000,
      quality: "qualified",
      reasons: ["pending_transactions"],
    });
  });
  it("rejects malformed scopes, boundary references, and unsafe integer amounts", () => {
    expect(() =>
      buildFinancePosition({ ...base, scope: { ...base.scope, from: "2026-09-19" } }),
    ).toThrow();
    expect(() =>
      buildFinancePosition({ ...base, activitySource: { id: "not-a-uuid", revision: "x" } }),
    ).toThrow();
    expect(() =>
      buildFinancePosition({
        ...base,
        accounts: base.accounts.map((account) => ({
          ...account,
          balance: Number.MAX_SAFE_INTEGER + 1,
        })),
      }),
    ).toThrow();
  });
  it("retains off-period transfer evidence without recognizing its spend twice", () => {
    const expense = base.transactions[0];
    if (!expense) throw new Error("Fixture missing.");
    const result = buildFinancePosition({
      ...base,
      relationships: [
        {
          id: cashId,
          eventId: debtId,
          eventUserId: userId,
          createdAt: base.asOf,
          provenance: { actorType: "user" },
          provenanceValidated: true,
          relationship: "transfer",
          transactionIds: [purchaseId, debtId],
          userId,
        },
      ],
      transactions: [
        expense,
        {
          ...expense,
          id: debtId,
          accountId: cashId,
          direction: "income",
          providerDirection: "income",
          transactionDate: "2026-08-31",
        },
      ],
    });
    expect(result.position.postedSpend).toMatchObject({ cents: 0, quality: "verified" });
  });
  it("does not qualify this period with invalidated allocations from an earlier period", () => {
    const transactions = base.transactions.map((transaction) => ({
      ...transaction,
      transactionDate: "2026-08-31",
    }));
    const result = buildFinancePosition({
      ...base,
      transactions,
      allocations: [
        {
          id: userId,
          transactionId: purchaseId,
          amount: 1_000,
          treatment: "personal",
          state: "invalidated",
        },
      ],
    });
    expect(result.position.postedSpend).toMatchObject({ cents: 0, quality: "verified" });
  });
  it("does not turn a pending repayment relationship into received cash", () => {
    const expense = base.transactions[0];
    if (!expense) throw new Error("Fixture missing.");
    const result = buildFinancePosition({
      ...base,
      relationships: [
        {
          id: cashId,
          eventId: debtId,
          eventUserId: userId,
          createdAt: base.asOf,
          provenance: { actorType: "user" },
          provenanceValidated: true,
          relationship: "reimbursement",
          transactionIds: [purchaseId, debtId],
          userId,
        },
      ],
      transactions: [
        expense,
        { ...expense, id: debtId, direction: "income", providerDirection: "income", pending: true },
      ],
    });
    expect(result.position.postedSpend.cents).toBe(1_000);
    expect(result.activity.reimbursementReceivedCents).toBe(0);
  });
  it("retains ownership-source revisions in posted-spend evidence even when cents do not change", () => {
    const first = buildFinancePosition(base).position;
    const second = buildFinancePosition({
      ...base,
      accounts: base.accounts.map((account) => ({
        ...account,
        source: { ...account.source, revision: "ownership-confirmed-again" },
      })),
    }).position;
    expect(second.postedSpend.cents).toBe(first.postedSpend.cents);
    expect(second.postedSpend.sources).not.toEqual(first.postedSpend.sources);
  });
});
