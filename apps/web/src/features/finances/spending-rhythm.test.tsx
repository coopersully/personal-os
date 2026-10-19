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
  const dashboard = completeDashboard({
    snapshot: { scope, bins },
    source: { freshness: "current" },
  });
  const onSelect = vi.fn();
  render(<FinanceSpendingRhythm dashboard={dashboard} onSelect={onSelect} />);
  const zero = screen.getByRole("button", { name: /2026-03-01.*Confirmed zero/ });
  zero.focus();
  await userEvent.keyboard("{ArrowRight}");
  expect(screen.getByRole("button", { name: /2026-03-02.*Missing coverage/ })).toHaveFocus();
  await userEvent.keyboard("{ArrowRight}{Enter}");
  expect(onSelect).toHaveBeenCalledWith({
    scope: { ...scope, from: "2026-03-03", through: "2026-03-03" },
    contributionIds: ["c2"],
    transactionIds: ["t2"],
  });
  expect(screen.getByRole("button", { name: /2026-03-03.*Net refund/ })).toHaveFocus();
  await userEvent.keyboard("{End}");
  expect(screen.getByRole("button", { name: /2026-03-04.*Future/ })).toHaveFocus();
  await userEvent.keyboard("{Home}");
  expect(zero).toHaveFocus();
  await userEvent.click(screen.getByText("Daily spending list"));
  expect(screen.getByRole("button", { name: "2026-03-03: -$0.50" })).toBeInTheDocument();
});

function observedDashboard(): FinanceSpendingDashboard {
  const scope = {
    from: "2026-03-01",
    through: "2026-03-03",
    timezone: "UTC",
    accountIds: null,
    categoryIds: null,
    basis: "personal_cost" as const,
    includePending: false,
    subtractRefunds: true,
  };
  return completeDashboard({
    snapshot: {
      scope,
      bins: [100, 0, -50].map((netCents, index) => ({
        date: `2026-03-0${index + 1}`,
        netCents,
        positiveAreaCents: Math.max(0, netCents),
        negativeAdjustmentCents: Math.max(0, -netCents),
        pendingCents: 0,
        coverage: index === 2 ? ("partial" as const) : ("unknown" as const),
        provisional: false,
        future: false,
        drillDown: { scope, contributionIds: [], transactionIds: [] },
      })),
    },
    source: { freshness: "unknown" },
  });
}
it("preserves observed positive and refund tones independently of uncertain coverage", () => {
  render(<FinanceSpendingRhythm dashboard={observedDashboard()} onSelect={vi.fn()} />);
  const positive = screen.getByRole("button", { name: /2026-03-01.*Missing coverage/ });
  const zero = screen.getByRole("button", { name: /2026-03-02.*Missing coverage/ });
  const refund = screen.getByRole("button", { name: /2026-03-03.*Partial coverage/ });
  expect(positive).toHaveClass("bg-primary");
  expect(zero).toHaveClass("bg-muted");
  expect(refund).toHaveClass("bg-accent");
  expect(refund).toHaveTextContent("Refund · Partial");
  expect(zero).not.toHaveTextContent("Zero");
});
it("rotates calendar labels and leading offsets for Monday", () => {
  const { container, rerender } = render(
    <FinanceSpendingRhythm
      dashboard={observedDashboard()}
      onSelect={vi.fn()}
      weekStartsOn="monday"
    />,
  );
  expect(container.querySelector("fieldset .grid")?.firstElementChild).toHaveTextContent("Mon");
  expect(container.querySelectorAll("[data-calendar-padding]")).toHaveLength(6);
  rerender(<FinanceSpendingRhythm dashboard={observedDashboard()} onSelect={vi.fn()} />);
  expect(container.querySelector("fieldset .grid")?.firstElementChild).toHaveTextContent("Sun");
  expect(container.querySelectorAll("[data-calendar-padding]")).toHaveLength(0);
});
it("retains a calendar tabstop and focused detail when the range becomes shorter or empty", async () => {
  const dashboard = observedDashboard();
  const { rerender } = render(<FinanceSpendingRhythm dashboard={dashboard} onSelect={vi.fn()} />);
  screen.getByRole("button", { name: /2026-03-01.*Missing coverage/ }).focus();
  await userEvent.keyboard("{End}");
  rerender(
    <FinanceSpendingRhythm
      dashboard={{
        ...dashboard,
        snapshot: { ...dashboard.snapshot, bins: dashboard.snapshot.bins.slice(0, 1) },
      }}
      onSelect={vi.fn()}
    />,
  );
  expect(screen.getByRole("button", { name: /2026-03-01.*Missing coverage/ })).toHaveAttribute(
    "tabindex",
    "0",
  );
  expect(screen.getByText(/2026-03-01:.*Positive spending/)).toBeInTheDocument();
  rerender(
    <FinanceSpendingRhythm
      dashboard={{ ...dashboard, snapshot: { ...dashboard.snapshot, bins: [] } }}
      onSelect={vi.fn()}
    />,
  );
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

function completeDashboard(value: {
  snapshot: Pick<FinanceSpendingDashboard["snapshot"], "scope" | "bins">;
  source: Pick<FinanceSpendingDashboard["source"], "freshness">;
}): FinanceSpendingDashboard {
  return {
    schemaVersion: 1,
    snapshot: {
      schemaVersion: 1,
      asOf: "2026-03-04T12:00:00Z",
      coverage: "unknown",
      contributions: [],
      netCents: 0,
      positiveAreaCents: 0,
      negativeAdjustmentCents: 0,
      qualifications: [],
      budgetComparison: { status: "unavailable", reason: "historical_budget_not_resolved" },
      ...value.snapshot,
    },
    source: { lastSyncedAt: null, reasons: [], ...value.source },
    effectiveGrouping: "categories",
    groupingFallback: null,
    groups: [],
    positiveAreaCents: 0,
    negativeAdjustmentCents: 0,
    excludedUncategorizedCents: 0,
    accounts: [],
    categories: [],
    transactions: [],
    currency: { supported: "USD", unsupported: [] },
  };
}
