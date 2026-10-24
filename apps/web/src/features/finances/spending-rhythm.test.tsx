// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { FinanceSpendingDashboard } from "@personal-os/domain";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { FinanceSpendingRhythm, spendingHourlyBins } from "./spending-rhythm";
import { rhythmGrain, spendingRhythmBins } from "./spending-rhythm-bins";

afterEach(() => cleanup());

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

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
  expect(screen.queryByText("Daily spending list")).not.toBeInTheDocument();
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
  expect(positive.getAttribute("style")).toContain("--workspace-finances-accent");
  expect(zero).toHaveClass("outline-dashed");
  expect(refund).toHaveClass("bg-accent");
  expect(refund).toHaveAccessibleName(/Net refund.*Partial coverage|Partial coverage/);
  expect(zero).not.toHaveTextContent("Zero");
});
it("aligns weekly blocks to the saved week start and preserves exact contributions", () => {
  const value = observedDashboard();
  value.snapshot.scope.through = "2026-06-01";
  const monday = spendingRhythmBins(value, "monday");
  expect(monday.grain).toBe("Weekly");
  expect(monday.bins[0]?.date).toBe("2026-03-01");
  expect(monday.bins[0]?.through).toBe("2026-03-01");
  expect(monday.bins[0]?.partial).toBe(true);
  expect(monday.bins[1]?.date).toBe("2026-03-02");
  const sunday = spendingRhythmBins(value);
  expect(sunday.bins[0]?.through).toBe("2026-03-07");
  expect(sunday.bins[0]?.netCents).toBe(50);
  expect(sunday.bins[0]?.coverage).not.toBe("complete");
  expect(sunday.bins[0]?.drillDown.scope).toMatchObject({
    from: "2026-03-01",
    through: "2026-03-07",
  });
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
  expect(screen.getByText(/2026-03-01:.*Missing coverage/)).toBeInTheDocument();
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

it("keeps date-only spending out of hourly totals rather than assigning midnight", () => {
  const value = observedDashboard();
  value.snapshot.scope.through = value.snapshot.scope.from;
  value.snapshot.contributions = [
    { id: "c", transactionId: "t", date: value.snapshot.scope.from, netCents: 1250 },
  ] as FinanceSpendingDashboard["snapshot"]["contributions"];
  value.transactions = [
    {
      id: "t",
      accountId: "a",
      merchant: "Cafe",
      date: value.snapshot.scope.from,
      pending: false,
      updatedAt: "2026-03-01T09:00:00Z",
    },
  ];
  const result = spendingHourlyBins(value);
  expect(result.hours).toHaveLength(24);
  expect(result.hours.every((hour) => hour.count === 0)).toBe(true);
  expect(result.untimedCents).toBe(1250);
  render(<FinanceSpendingRhythm dashboard={value} onSelect={vi.fn()} />);
  expect(screen.getByText("Hourly spending")).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: /Time not provided: \$12.50; 1 item/ }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: /12 AM:.*Hourly amount unavailable/ }),
  ).toBeInTheDocument();
});
it("groups only timestamped evidence into its local purchase hour, preserving unassigned adjustments", () => {
  const value = observedDashboard();
  value.snapshot.scope = {
    ...value.snapshot.scope,
    from: "2026-02-28",
    through: "2026-02-28",
    timezone: "America/New_York",
  };
  value.snapshot.contributions = [
    { id: "timed", transactionId: "t", date: "2026-02-28", netCents: 2000 },
    { id: "unknown", transactionId: "u", date: "2026-02-28", netCents: -500 },
  ] as FinanceSpendingDashboard["snapshot"]["contributions"];
  value.transactions = [
    { id: "t", accountId: "a", merchant: "Cafe", date: "2026-03-01T03:15:00Z", pending: false },
    { id: "u", accountId: "a", merchant: "Refund", date: "2026-02-28", pending: false },
  ];
  const result = spendingHourlyBins(value);
  expect(result.hours[22]).toMatchObject({ count: 1, netCents: 2000 });
  expect(result.untimedCents).toBe(-500);
  expect(result.hours.reduce((sum, hour) => sum + hour.netCents, result.untimedCents)).toBe(1500);
});

it.each([
  [1, "Hourly"],
  [2, "Daily"],
  [62, "Daily"],
  [63, "Weekly"],
  [366, "Weekly"],
  [367, "Monthly"],
  [1096, "Monthly"],
  [1097, "Yearly"],
] as const)("chooses grain automatically for %i selected days", (days, grain) => {
  const from = "2024-01-01";
  const through = new Date(Date.parse(`${from}T12:00:00Z`) + (days - 1) * 86_400_000)
    .toISOString()
    .slice(0, 10);
  expect(rhythmGrain(from, through)).toBe(grain);
});
it("groups leap-month and year boundaries without losing refunds, pending amounts or exact IDs", () => {
  const value = observedDashboard();
  const base = value.snapshot.bins[0];
  if (!base) throw new Error("Missing fixture bin");
  value.snapshot.scope = { ...value.snapshot.scope, from: "2024-02-15", through: "2026-03-01" };
  value.snapshot.bins = [
    {
      ...base,
      date: "2024-02-28",
      netCents: 150,
      positiveAreaCents: 150,
      coverage: "complete",
      drillDown: { ...base.drillDown, contributionIds: ["a"], transactionIds: ["t"] },
    },
    {
      ...base,
      date: "2024-02-29",
      netCents: -50,
      negativeAdjustmentCents: 50,
      pendingCents: 20,
      coverage: "complete",
      drillDown: { ...base.drillDown, contributionIds: ["b"], transactionIds: ["t"] },
    },
    { ...base, date: "2025-01-01", netCents: 200 },
  ];
  const monthly = spendingRhythmBins(value);
  expect(monthly.grain).toBe("Monthly");
  expect(monthly.bins[0]).toMatchObject({
    date: "2024-02-15",
    through: "2024-02-29",
    netCents: 100,
    negativeAdjustmentCents: 50,
    pendingCents: 20,
    partial: true,
    coverage: "partial",
  });
  expect(monthly.bins[0]?.drillDown.contributionIds).toEqual(["a", "b"]);
  expect(monthly.bins[0]?.drillDown.transactionIds).toEqual(["t"]);
  value.snapshot.scope.through = "2028-03-01";
  const yearly = spendingRhythmBins(value);
  expect(yearly.grain).toBe("Yearly");
  expect(yearly.bins[0]?.through).toBe("2024-12-31");
  expect(yearly.bins.reduce((sum, bin) => sum + bin.netCents, 0)).toBe(300);
});
it("renders only an open heading and blocks, with no duplicate context or containing Card", () => {
  const { container } = render(
    <FinanceSpendingRhythm dashboard={observedDashboard()} onSelect={vi.fn()} />,
  );
  expect(screen.getByRole("heading", { name: "Daily spending" })).toBeInTheDocument();
  expect(container.querySelector('[data-slot="card"]')).toBeNull();
  expect(screen.queryByText("UTC")).not.toBeInTheDocument();
  expect(screen.queryByText("Daily spending list")).not.toBeInTheDocument();
});
