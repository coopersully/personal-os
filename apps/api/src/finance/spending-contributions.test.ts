import type { FinanceSpendingScope } from "@personal-os/domain";
import { describe, expect, it } from "vitest";
import { recognizeFinanceActivity } from "./recognition.js";
import { projectFinanceSpending, type SpendingEvidenceInput } from "./spending-contributions.js";

const scope: FinanceSpendingScope = {
  from: "2026-03-07",
  through: "2026-03-09",
  timezone: "America/New_York",
  accountIds: null,
  categoryIds: null,
  basis: "personal_cost",
  includePending: true,
  subtractRefunds: true,
};
const account: SpendingEvidenceInput["accounts"][number] = {
  id: "cash",
  userId: "owner",
  currencyCode: "USD",
  includeInPlanning: true,
  kind: "cash",
  ownershipType: "individual",
  ownershipShareBps: 10000,
};
const tx = (
  id: string,
  overrides: Partial<SpendingEvidenceInput["transactions"][number]> = {},
): SpendingEvidenceInput["transactions"][number] => ({
  id,
  userId: "owner",
  accountId: "cash",
  amount: 1000,
  category: "DINING",
  categoryId: "dining",
  currencyCode: "USD",
  direction: "expense",
  providerDirection: "expense",
  pending: false,
  pendingTransactionId: null,
  providerTransactionId: id,
  reconciliationStatus: "not_applicable",
  transactionDate: "2026-03-08",
  transferGroupId: null,
  ...overrides,
});
const input = (overrides: Partial<SpendingEvidenceInput> = {}): SpendingEvidenceInput => ({
  accounts: [account],
  transactions: [tx("expense")],
  allocations: [],
  reimbursements: [],
  matches: [],
  relationships: [],
  userId: "owner",
  coverage: "complete",
  asOf: "2026-03-09T12:00:00Z",
  ...overrides,
});
const link = (
  relationship: SpendingEvidenceInput["relationships"][number]["relationship"],
  transactionIds: string[],
): SpendingEvidenceInput["relationships"][number] => ({
  relationship,
  transactionIds,
  createdAt: "2026-03-09T00:00:00Z",
  id: relationship,
  eventId: relationship,
  eventUserId: "owner",
  userId: "owner",
  provenance: { actorType: "user" },
  provenanceValidated: true,
});

describe("recognized Spending contributions", () => {
  it("resolves pending replacements before bins or date selection", () => {
    const evidence = input({
      transactions: [
        tx("pending", { pending: true, transactionDate: "2026-03-07" }),
        tx("posted", {
          amount: 1100,
          pendingTransactionId: "pending",
          transactionDate: "2026-03-09",
        }),
      ],
    });
    expect(projectFinanceSpending(evidence, scope).bins.map((bin) => bin.netCents)).toEqual([
      0, 0, 1100,
    ]);
    expect(projectFinanceSpending(evidence, { ...scope, through: "2026-03-08" }).netCents).toBe(0);
  });

  it("preserves canonical allocation/category links and exact ownership residuals", () => {
    const evidence = input({
      accounts: [{ ...account, ownershipShareBps: 5000, ownershipType: "joint" }],
      transactions: [tx("expense", { amount: 3 })],
      allocations: [
        {
          id: "b",
          transactionId: "expense",
          amount: 1,
          state: "active",
          treatment: "personal",
          categoryId: "b",
        },
        {
          id: "a",
          transactionId: "expense",
          amount: 2,
          state: "active",
          treatment: "personal",
          categoryId: "a",
        },
      ],
    });
    const result = projectFinanceSpending(evidence, scope);
    expect(
      result.contributions.map((item) => [item.allocationId, item.categoryId, item.netCents]),
    ).toEqual([
      ["a", "a", 1],
      ["b", "b", 1],
    ]);
    expect(result.netCents).toBe(2);
    expect(projectFinanceSpending(evidence, { ...scope, categoryIds: ["b"] }).netCents).toBe(1);
    expect(result.bins[1]?.drillDown.transactionIds).toEqual(["expense"]);
  });

  it.each([
    ["expected", 0, 400],
    ["partial", 200, 400],
    ["cancelled", 200, 800],
    ["received", 600, 400],
  ])("projects %s reimbursements without changing cash recognition", (status, receivedAmount, expected) => {
    const evidence = input({
      allocations: [
        {
          id: "allocation",
          transactionId: "expense",
          amount: 1000,
          state: "active",
          treatment: "reimbursable",
          categoryId: "dining",
        },
      ],
      reimbursements: [
        {
          id: "claim",
          allocationId: "allocation",
          expectedAmount: 600,
          receivedAmount: Number(receivedAmount),
          status: String(status),
        },
      ],
      transactions: [
        tx("expense"),
        tx("credit", {
          amount: Number(receivedAmount),
          direction: "income",
          providerDirection: "income",
        }),
      ],
      matches: [
        { reimbursementId: "claim", creditTransactionId: "credit", amount: Number(receivedAmount) },
      ],
    });
    expect(projectFinanceSpending(evidence, scope).netCents).toBe(expected);
    expect(projectFinanceSpending(evidence, { ...scope, basis: "full_outflow" }).netCents).toBe(
      1000,
    );
    expect(recognizeFinanceActivity(evidence).postedSpendCents).toBe(1000 - Number(receivedAmount));
  });

  it("does not deduct matched reimbursement credits again when also linked as refunds", () => {
    const evidence = input({
      allocations: [
        {
          id: "allocation",
          transactionId: "expense",
          amount: 1000,
          state: "active",
          treatment: "reimbursable",
          categoryId: "dining",
        },
      ],
      reimbursements: [
        {
          id: "claim",
          allocationId: "allocation",
          expectedAmount: 600,
          receivedAmount: 600,
          status: "received",
        },
      ],
      transactions: [
        tx("expense"),
        tx("credit", { amount: 600, direction: "income", providerDirection: "income" }),
      ],
      matches: [{ reimbursementId: "claim", creditTransactionId: "credit", amount: 600 }],
      relationships: [link("refund", ["expense", "credit"])],
    });
    expect(projectFinanceSpending(evidence, scope).netCents).toBe(400);
  });

  it("separates positive category area from negative net and negative-net days", () => {
    const result = projectFinanceSpending(
      input({
        transactions: [
          tx("expense", { amount: 100 }),
          tx("refund", {
            amount: 400,
            categoryId: "other",
            direction: "income",
            providerDirection: "income",
          }),
        ],
        relationships: [link("refund", ["expense", "refund"])],
      }),
      scope,
    );
    expect([result.netCents, result.positiveAreaCents, result.negativeAdjustmentCents]).toEqual([
      -300, 100, 400,
    ]);
    expect(result.bins[1]).toMatchObject({
      netCents: -300,
      positiveAreaCents: 0,
      negativeAdjustmentCents: 300,
    });
  });

  it("excludes split parents, duplicates, transfers and unclassified credits", () => {
    const result = projectFinanceSpending(
      input({
        transactions: [
          tx("parent", { amount: 300 }),
          tx("a", { amount: 100 }),
          tx("b", { amount: 200 }),
          tx("duplicate", { amount: 100 }),
          tx("transfer", { direction: "transfer" }),
          tx("income", { direction: "income", providerDirection: "income" }),
        ],
        relationships: [link("split", ["parent", "a", "b"]), link("duplicate", ["a", "duplicate"])],
      }),
      scope,
    );
    expect(result.netCents).toBe(300);
    expect(result.contributions.map((item) => item.transactionId)).toEqual(["a", "b"]);
  });

  it("excludes unknown ownership, other owners and unsupported currencies", () => {
    const evidence = input({
      accounts: [
        account,
        { ...account, id: "unknown", ownershipType: "unknown" },
        { ...account, id: "foreign", userId: "other" },
      ],
      transactions: [
        tx("expense"),
        tx("eur", { currencyCode: "EUR" }),
        tx("other", { userId: "other" }),
        tx("foreign", { accountId: "foreign" }),
        tx("unknown", { accountId: "unknown" }),
      ],
    });
    const result = projectFinanceSpending(evidence, scope);
    expect(result.netCents).toBe(1000);
    expect(result.qualifications.map((item) => item.code)).toEqual(
      expect.arrayContaining(["unsupported_currency", "ownership_unknown"]),
    );
    expect(projectFinanceSpending(evidence, { ...scope, accountIds: [] }).netCents).toBe(0);
  });

  it("uses local calendar days across DST without shifting date-only records", () => {
    const result = projectFinanceSpending(
      input({
        transactions: [
          tx("date", { transactionDate: "2026-03-08" }),
          tx("instant", { transactionDate: "2026-03-08T04:59:00Z" }),
          tx("after", { transactionDate: "2026-03-09T04:00:00Z" }),
        ],
      }),
      scope,
    );
    expect(result.bins.map((bin) => [bin.date, bin.netCents])).toEqual([
      ["2026-03-07", 1000],
      ["2026-03-08", 1000],
      ["2026-03-09", 1000],
    ]);
  });

  it("retains unknown coverage for empty or populated snapshots and withholds budget fill", () => {
    for (const transactions of [[], [tx("expense")]]) {
      const result = projectFinanceSpending(input({ transactions, coverage: "unknown" }), scope);
      expect(result.coverage).toBe("unknown");
      expect(result.bins.every((bin) => bin.coverage === "unknown")).toBe(true);
      expect(result.budgetComparison.status).toBe("unavailable");
    }
  });

  it("withholds mismatched and invalidated allocations", () => {
    for (const state of ["active", "invalidated"] as const) {
      const result = projectFinanceSpending(
        input({
          allocations: [
            {
              id: "a",
              amount: 500,
              transactionId: "expense",
              treatment: "personal",
              state,
              categoryId: null,
            },
          ],
        }),
        scope,
      );
      expect(result.netCents).toBe(0);
      expect(result.qualifications.length).toBeGreaterThan(0);
    }
  });
  it("honors pending, refund and uncategorized filters in the same drill-down scope", () => {
    const evidence = input({
      transactions: [
        tx("pending", { pending: true, categoryId: null }),
        tx("refund", { direction: "income", providerDirection: "income" }),
      ],
      relationships: [link("refund", ["refund"])],
    });
    expect(projectFinanceSpending(evidence, { ...scope, includePending: false }).netCents).toBe(
      -1000,
    );
    expect(projectFinanceSpending(evidence, { ...scope, subtractRefunds: false }).netCents).toBe(
      1000,
    );
    const filtered = projectFinanceSpending(evidence, { ...scope, categoryIds: [null] });
    expect(filtered.netCents).toBe(1000);
    expect(filtered.bins[1]?.drillDown.scope.categoryIds).toEqual([null]);
  });

  it("assigns ownership residuals without negative reimbursement adjustments", () => {
    const evidence = input({
      accounts: [{ ...account, ownershipShareBps: 5000 }],
      transactions: [tx("expense", { amount: 2 })],
      allocations: [
        {
          id: "a",
          amount: 1,
          transactionId: "expense",
          categoryId: "a",
          treatment: "reimbursable",
          state: "active",
        },
        {
          id: "b",
          amount: 1,
          transactionId: "expense",
          categoryId: "b",
          treatment: "personal",
          state: "active",
        },
      ],
      reimbursements: [
        { id: "r", allocationId: "a", expectedAmount: 1, receivedAmount: 0, status: "expected" },
      ],
    });
    const forward = projectFinanceSpending(evidence, scope);
    const reverse = projectFinanceSpending(
      { ...evidence, allocations: [...evidence.allocations].reverse() },
      scope,
    );
    expect(reverse).toEqual(forward);
    expect(forward.netCents).toBe(1);
    expect(forward.contributions.every((item) => item.reimbursementAdjustmentCents >= 0)).toBe(
      true,
    );
  });

  it("does not accept cross-owner relationship evidence", () => {
    const evidence = input({
      transactions: [
        tx("income", { direction: "income", providerDirection: "income" }),
        tx("foreign", { userId: "other" }),
      ],
      relationships: [link("refund", ["foreign", "income"])],
    });
    expect(projectFinanceSpending(evidence, scope).contributions).toEqual([]);
  });

  it("qualifies missing shares and never claims future zero coverage", () => {
    const result = projectFinanceSpending(
      input({ accounts: [{ ...account, ownershipShareBps: null }] }),
      { ...scope, through: "2026-03-10" },
    );
    expect(result.coverage).toBe("partial");
    expect(result.qualifications).toContainEqual({
      code: "ownership_share_unknown",
      sourceIds: ["cash"],
    });
    expect(result.bins.at(-1)).toMatchObject({ future: true, coverage: "unknown" });
  });

  it("rejects fractional or unsafe aggregate cents before recognition", () => {
    expect(() =>
      projectFinanceSpending(
        input({ transactions: [tx("overflow", { amount: Number.MAX_SAFE_INTEGER })] }),
        scope,
      ),
    ).toThrow("exact recognition capacity");
    expect(() =>
      projectFinanceSpending(input({ transactions: [tx("fraction", { amount: 1.5 })] }), scope),
    ).toThrow();
  });
  it("recognizes relationship-only reimbursements and matched transfer evidence", () => {
    const evidence = input({
      accounts: [account, { ...account, id: "investment", kind: "investment" }],
      transactions: [
        tx("expense"),
        tx("recovery", { amount: 200, direction: "income", providerDirection: "income" }),
        tx("out", {
          amount: 300,
          direction: "transfer",
          transferGroupId: "t",
          reconciliationStatus: "matched",
        }),
        tx("in", {
          amount: 300,
          accountId: "investment",
          direction: "transfer",
          providerDirection: "income",
          transferGroupId: "t",
          reconciliationStatus: "matched",
        }),
      ],
      relationships: [link("reimbursement", ["expense", "recovery"]), link("refund", ["recovery"])],
    });
    const result = projectFinanceSpending(evidence, scope);
    expect(result.netCents).toBe(800);
    expect(result.contributions.find((item) => item.transactionId === "recovery")?.netCents).toBe(
      0,
    );
  });

  it("uses account currency and transaction direction fallback, and honors excluded accounts", () => {
    const evidence = input({
      accounts: [account, { ...account, id: "excluded", includeInPlanning: false }],
      transactions: [
        tx("expense", { currencyCode: null, providerDirection: null }),
        tx("excluded", { accountId: "excluded" }),
      ],
    });
    expect(projectFinanceSpending(evidence, scope).netCents).toBe(1000);
    expect(projectFinanceSpending(evidence, { ...scope, accountIds: ["excluded"] }).netCents).toBe(
      0,
    );
  });

  it("handles zero ownership and a reimbursable allocation without a claim", () => {
    const evidence = input({
      accounts: [{ ...account, ownershipShareBps: 0 }],
      allocations: [
        {
          id: "a",
          transactionId: "expense",
          amount: 1000,
          state: "active",
          treatment: "reimbursable",
          categoryId: null,
        },
      ],
    });
    expect(projectFinanceSpending(evidence, scope).netCents).toBe(0);
    expect(projectFinanceSpending({ ...evidence, accounts: [account] }, scope).netCents).toBe(1000);
  });
});
