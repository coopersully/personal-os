// @vitest-environment jsdom
import type { FinanceSpendingDashboard } from "@personal-os/domain";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { FinanceSpendingRhythm } from "./spending-rhythm";

it("distinguishes missing, zero, negative and future days and navigates dates by keyboard", async () => {
  const scope = {
    from: "2026-03-01",
    through: "2026-03-04",
    timezone: "UTC",
    accountIds: null,
    categoryIds: null,
    basis: "personal_cost" as const,
    includePending: false,
    subtractRefunds: true,
  };
  const bins = [0, 0, -50, 0].map((netCents, index) => ({
    date: `2026-03-0${index + 1}`,
    netCents,
    positiveAreaCents: 0,
    negativeAdjustmentCents: Math.abs(netCents),
    pendingCents: 0,
    coverage: index === 1 ? ("unknown" as const) : ("complete" as const),
    provisional: false,
    future: index === 3,
    drillDown: {
      scope: { ...scope, from: `2026-03-0${index + 1}`, through: `2026-03-0${index + 1}` },
      contributionIds: [`c${index}`],
      transactionIds: [`t${index}`],
    },
  }));
  const dashboard = {
    snapshot: { scope, bins },
    source: { freshness: "current" },
  } as FinanceSpendingDashboard;
  const onSelect = vi.fn();
  render(<FinanceSpendingRhythm dashboard={dashboard} onSelect={onSelect} />);
  const zero = screen.getByRole("button", { name: /2026-03-01.*Confirmed zero/ });
  zero.focus();
  await userEvent.keyboard("{ArrowRight}");
  expect(screen.getByRole("button", { name: /2026-03-02.*Missing coverage/ })).toHaveFocus();
  await userEvent.keyboard("{ArrowRight}{Enter}");
  expect(onSelect).toHaveBeenCalledWith(bins[2].drillDown);
  expect(screen.getByRole("button", { name: /2026-03-03.*Net refund/ })).toHaveFocus();
  await userEvent.keyboard("{End}");
  expect(screen.getByRole("button", { name: /2026-03-04.*Future/ })).toHaveFocus();
  await userEvent.keyboard("{Home}");
  expect(zero).toHaveFocus();
  await userEvent.click(screen.getByText("Daily spending list"));
  expect(screen.getByRole("button", { name: "2026-03-03: -$0.50" })).toBeInTheDocument();
});
