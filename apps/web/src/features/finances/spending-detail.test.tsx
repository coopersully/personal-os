// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { FinanceSpendingDashboard, FinanceSpendingDrillDown } from "@personal-os/domain";
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { SpendingDetail } from "./spending-detail";

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
