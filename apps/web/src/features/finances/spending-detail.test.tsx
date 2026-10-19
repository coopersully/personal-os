// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  type FinanceSpendingDashboard,
  type FinanceSpendingDrillDown,
  type FinanceSpendingMonthlyBudget,
  financeSpendingReferenceFilterSchema,
} from "@personal-os/domain";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { SpendingDetail, spendingTransactionsDestination } from "./spending-detail";

afterEach(() => cleanup());

it("generalized day drilldown selects exact contribution IDs rather than all allocations of a transaction", () => {
  const drillDown = {
    scope: {
      from: "2026-10-01",
      through: "2026-10-31",
      timezone: "America/New_York",
      accountIds: null,
      categoryIds: null,
      basis: "personal_cost",
      includePending: true,
      subtractRefunds: true,
    },
    contributionIds: ["selected-allocation"],
    transactionIds: ["mixed-purchase"],
  } as FinanceSpendingDrillDown;
  const data = {
    groups: [],
    snapshot: {
      scope: drillDown.scope,
      contributions: [
        {
          id: "selected-allocation",
          transactionId: "mixed-purchase",
          allocationId: "allocation-one",
          date: "2026-10-08",
          pending: true,
          grossCents: 1000,
          reimbursementAdjustmentCents: 200,
          reimbursementOutstandingCents: 150,
          refundAdjustmentCents: 100,
          netCents: 700,
        },
        {
          id: "excluded-allocation",
          transactionId: "mixed-purchase",
          allocationId: "allocation-two",
          date: "2026-10-08",
          pending: false,
          grossCents: 9000,
          reimbursementAdjustmentCents: 0,
          reimbursementOutstandingCents: 0,
          refundAdjustmentCents: 0,
          netCents: 9000,
        },
      ],
    },
    transactions: [{ id: "mixed-purchase", merchant: "Mixed purchase" }],
  } as unknown as FinanceSpendingDashboard;
  render(
    <SpendingDetail
      data={data}
      group={null}
      drillDown={drillDown}
      onClose={vi.fn()}
      onSelect={vi.fn()}
    />,
  );
  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveTextContent("$10.00");
  expect(dialog).toHaveTextContent("$7.00");
  expect(dialog).toHaveTextContent("$1.50");
  expect(dialog).not.toHaveTextContent("$90.00");
  expect(screen.getAllByText("Mixed purchase")).toHaveLength(1);
  expect(dialog).toHaveTextContent("Split allocation");
});

function referenceFixture() {
  const scope = {
    from: "2026-10-01",
    through: "2026-10-31",
    timezone: "America/New_York",
    accountIds: [] as string[] | null,
    categoryIds: ["food", null],
    basis: "full_outflow" as const,
    includePending: false,
    subtractRefunds: false,
  };
  const selected = {
    id: "selected",
    transactionId: "purchase",
    date: "2026-10-08",
    netCents: 700,
    grossCents: 1000,
    reimbursementAdjustmentCents: 200,
    reimbursementOutstandingCents: 150,
    refundAdjustmentCents: 100,
    pending: false,
  };
  const other = { ...selected, id: "other", transactionId: "another-purchase", date: "2026-10-09" };
  const drillDown = {
    scope,
    contributionIds: [selected.id],
    transactionIds: [selected.transactionId],
  };
  const group = {
    id: "category-food",
    kind: "category",
    label: "Groceries",
    drillDown,
    categories: [],
    grossCents: 1000,
    reimbursementAdjustmentCents: 200,
    reimbursementOutstandingCents: 150,
    refundAdjustmentCents: 100,
    netCents: 700,
    pendingCents: 0,
  };
  const data = {
    referenceRevision: "a".repeat(64),
    effectiveGrouping: "categories",
    groups: [group],
    snapshot: { scope, contributions: [selected, other] },
    transactions: [{ id: "purchase", merchant: "Market" }],
  } as unknown as FinanceSpendingDashboard;
  const selectedGroup = data.groups[0];
  if (!selectedGroup) throw new Error("No group");
  return { data, group: selectedGroup, drillDown };
}
it("encodes a validated exact group destination with original scope and no raw membership lists", () => {
  const { data, group, drillDown } = referenceFixture();
  const destination = spendingTransactionsDestination(data, group, drillDown);
  expect(destination).not.toBeNull();
  const encoded = new URL(destination ?? "", "https://nohmi.example").searchParams.get("spending");
  const filter = financeSpendingReferenceFilterSchema.parse(JSON.parse(encoded ?? "{}"));
  expect(filter).toEqual({
    query: { scope: data.snapshot.scope, grouping: "categories", includeUncategorized: true },
    referenceRevision: "a".repeat(64),
    groupId: "category-food",
    from: "2026-10-01",
    through: "2026-10-31",
  });
  expect(encoded).not.toContain("contributionIds");
  expect(encoded).not.toContain("transactionIds");
  render(
    <MemoryRouter>
      <SpendingDetail data={data} group={group} onClose={vi.fn()} onSelect={vi.fn()} />
    </MemoryRouter>,
  );
  expect(screen.getByRole("link", { name: "Open matching transactions" })).toHaveAttribute(
    "href",
    destination,
  );
});
it("keeps day/bin scope inside the original query and uses null group identity", () => {
  const { data, drillDown } = referenceFixture();
  data.snapshot.scope.accountIds = null;
  const day = {
    ...drillDown,
    scope: { ...data.snapshot.scope, from: "2026-10-08", through: "2026-10-08" },
  };
  const destination = spendingTransactionsDestination(data, null, day);
  const filter = financeSpendingReferenceFilterSchema.parse(
    JSON.parse(
      new URL(destination ?? "", "https://nohmi.example").searchParams.get("spending") ?? "{}",
    ),
  );
  expect(filter.groupId).toBeNull();
  expect(filter.query.scope.accountIds).toBeNull();
  expect(filter.query.scope.from).toBe("2026-10-01");
  expect(filter.query.scope.through).toBe("2026-10-31");
  expect(filter.from).toBe("2026-10-08");
  expect(filter.through).toBe("2026-10-08");
  expect(filter.query.scope.categoryIds).toEqual(["food", null]);
  expect(filter.query.scope).toMatchObject({
    basis: "full_outflow",
    includePending: false,
    subtractRefunds: false,
    timezone: "America/New_York",
  });
});
it("fails closed for missing revisions, oversized filters, or ambiguous selected membership", () => {
  const { data, group, drillDown } = referenceFixture();
  const { referenceRevision: _, ...older } = data;
  expect(spendingTransactionsDestination(older, group, drillDown)).toBeNull();
  expect(
    spendingTransactionsDestination(data, group, { ...drillDown, contributionIds: ["other"] }),
  ).toBeNull();
  expect(spendingTransactionsDestination(data, null, drillDown)).toBeNull();
  const oversized = {
    ...data,
    snapshot: {
      ...data.snapshot,
      scope: {
        ...data.snapshot.scope,
        accountIds: Array.from(
          { length: 1000 },
          (_, index) => `account-with-a-long-reference-${index}`,
        ),
      },
    },
  };
  expect(
    spendingTransactionsDestination(oversized, group, {
      ...drillDown,
      scope: oversized.snapshot.scope,
    }),
  ).toBeNull();
  render(<SpendingDetail data={older} group={group} onClose={vi.fn()} onSelect={vi.fn()} />);
  expect(
    screen.queryByRole("link", { name: "Open matching transactions" }),
  ).not.toBeInTheDocument();
  expect(screen.getByText(/Matching transactions are unavailable/)).toBeVisible();
});

it("distinguishes explicit zero monthly targets from null and absent comparisons in exact detail", () => {
  const { data, group } = referenceFixture();
  const budget: Extract<FinanceSpendingMonthlyBudget, { state: "qualified" }> = {
    state: "qualified",
    month: "2026-10",
    period: { from: "2026-10-01", through: "2026-10-31", timezone: "America/New_York" },
    currency: "USD",
    accountIds: [],
    qualificationId: "qualification",
    confirmedAt: "2026-10-18T00:00:00Z",
    qualificationKind: "retrospective",
    coverage: "partial",
    includesPending: false,
    basis: "full_outflow",
    subtractsRefunds: false,
    groups: [{ groupId: group.id, budgetCents: 0, usedCents: 250, overspent: true }],
  };
  const node = (monthlyBudget: FinanceSpendingMonthlyBudget) => (
    <MemoryRouter>
      <SpendingDetail
        data={{ ...data, monthlyBudget }}
        group={group}
        onClose={vi.fn()}
        onSelect={vi.fn()}
      />
    </MemoryRouter>
  );
  const { rerender } = render(node(budget));
  expect(screen.getByText("Monthly usage: $2.50 of $0.00 · Over budget $2.50")).toBeVisible();
  expect(screen.queryByText(/Infinity|NaN/)).not.toBeInTheDocument();
  for (const usedCents of [0, -100]) {
    rerender(
      node({
        ...budget,
        groups: [{ groupId: group.id, budgetCents: 0, usedCents, overspent: false }],
      }),
    );
    expect(
      screen.getByText(`Monthly usage: ${usedCents === 0 ? "$0.00" : "-$1.00"} of $0.00`),
    ).toBeVisible();
    expect(screen.getByRole("dialog")).not.toHaveTextContent("Over budget");
  }
  rerender(
    node({
      ...budget,
      groups: [{ groupId: group.id, budgetCents: null, usedCents: 250, overspent: false }],
    }),
  );
  expect(screen.getByText("Monthly usage: $2.50 · No budget limit")).toBeVisible();
  rerender(node({ ...budget, groups: [] }));
  expect(screen.queryByText(/Monthly usage:/)).not.toBeInTheDocument();
  expect(screen.getByRole("dialog")).not.toHaveTextContent("Infinity");
});
