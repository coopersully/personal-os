// @vitest-environment jsdom
import type { FinanceSpendingDashboard, FinanceSpendingScope } from "@personal-os/domain";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  FinanceSpendingTrends,
  spendingComparisonScopes,
  spendingTrendBins,
} from "./spending-trends";

const scope: FinanceSpendingScope = {
  from: "2026-03-01",
  through: "2026-03-31",
  timezone: "America/New_York",
  accountIds: ["a"],
  categoryIds: [null],
  basis: "personal_cost",
  includePending: true,
  subtractRefunds: true,
};
function dashboard(): FinanceSpendingDashboard {
  const drillDown = {
    scope: { ...scope, through: scope.from },
    contributionIds: ["c"],
    transactionIds: ["t"],
  };
  return {
    schemaVersion: 1,
    snapshot: {
      schemaVersion: 1,
      scope,
      asOf: "2026-03-15T12:00:00Z",
      coverage: "complete",
      contributions: [],
      bins: [
        {
          date: scope.from,
          netCents: 101,
          positiveAreaCents: 101,
          negativeAdjustmentCents: 0,
          pendingCents: 0,
          coverage: "complete",
          provisional: false,
          future: false,
          drillDown,
        },
      ],
      netCents: 101,
      positiveAreaCents: 101,
      negativeAdjustmentCents: 0,
      qualifications: [],
      budgetComparison: { status: "unavailable", reason: "historical_budget_not_resolved" },
    },
    effectiveGrouping: "categories",
    groupingFallback: null,
    groups: [],
    positiveAreaCents: 101,
    negativeAdjustmentCents: 0,
    excludedUncategorizedCents: 0,
    accounts: [],
    categories: [],
    transactions: [],
    source: { freshness: "current", lastSyncedAt: null, reasons: [] },
    currency: { supported: "USD", unsupported: [] },
  };
}
describe("spending comparison dates", () => {
  it("compares local elapsed days and preserves every filter", () => {
    const result = spendingComparisonScopes(scope, "month", "2026-03-16T02:00:00Z");
    expect(result.current.through).toBe("2026-03-15");
    expect(result.previous).toEqual({ ...scope, from: "2026-02-01", through: "2026-02-15" });
  });
  it("caps shorter complete months and handles leap years", () => {
    const result = spendingComparisonScopes(
      { ...scope, from: "2024-03-01", through: "2024-03-31" },
      "month",
      "2026-04-01T12:00:00Z",
    );
    expect(result.previous.through).toBe("2024-02-29");
    expect(result.label).toBe("Previous month");
    expect(
      spendingComparisonScopes(
        { ...scope, from: "2026-02-01", through: "2026-02-28" },
        "month",
        "2026-04-01T12:00:00Z",
      ).previous.through,
    ).toBe("2026-01-31");
  });
  it("uses immediately preceding equal custom range across DST", () => {
    expect(
      spendingComparisonScopes(
        { ...scope, from: "2026-03-07", through: "2026-03-09" },
        "custom",
        "2026-04-01T12:00:00Z",
      ).previous,
    ).toEqual({ ...scope, from: "2026-03-04", through: "2026-03-06" });
  });
});
describe("comparison boundaries", () => {
  it("caps an elapsed March at February end and labels the mismatch", () => {
    const result = spendingComparisonScopes(scope, "month", "2026-03-31T02:00:00Z");
    expect(result.current.through).toBe("2026-03-30");
    expect(result.previous.through).toBe("2026-02-28");
    expect(result.label).toContain("capped at month end");
  });
  it("keeps custom dates intact even when the range includes today", () => {
    const result = spendingComparisonScopes(scope, "custom", "2026-03-15T12:00:00Z");
    expect(result.current).toEqual(scope);
    expect(result.previous.from).toBe("2026-01-29");
    expect(result.previous.through).toBe("2026-02-28");
  });
  it("compares elapsed named week days in the scope timezone", () => {
    const result = spendingComparisonScopes(
      { ...scope, from: "2026-03-09", through: "2026-03-15" },
      "week",
      "2026-03-12T02:00:00Z",
    );
    expect(result.current.through).toBe("2026-03-11");
    expect(result.previous.from).toBe("2026-03-02");
    expect(result.previous.through).toBe("2026-03-04");
  });
});
describe("spending trends", () => {
  it("keeps exact cents and selection identities in coarse grains", () => {
    const value = dashboard();
    value.snapshot.scope.through = "2026-05-01";
    value.snapshot.bins.push({
      ...value.snapshot.bins[0],
      date: "2026-03-02",
      netCents: -25,
      positiveAreaCents: 0,
      negativeAdjustmentCents: 25,
    });
    const result = spendingTrendBins(value);
    expect(result.grain).toBe("Weekly");
    expect(result.bins[0].netCents).toBe(76);
    expect(result.bins[0].drillDown).toEqual({
      scope: { ...value.snapshot.scope, through: "2026-03-02" },
      contributionIds: ["c"],
      transactionIds: ["t"],
    });
  });
  it("labels partial coverage and pending amounts without confirming a missing zero", () => {
    const value = dashboard();
    value.snapshot.bins[0] = {
      ...value.snapshot.bins[0],
      netCents: 0,
      coverage: "unknown",
      provisional: true,
      pendingCents: 100,
    };
    render(<FinanceSpendingTrends dashboard={value} onSelect={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: /Missing coverage.*Provisional.*Pending/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Confirmed zero/)).not.toBeInTheDocument();
  });
  it("renders accessible bars and table and withholds zero percentages", async () => {
    const value = dashboard();
    const previous = dashboard();
    previous.snapshot.netCents = 0;
    const onSelect = vi.fn();
    render(<FinanceSpendingTrends dashboard={value} comparison={previous} onSelect={onSelect} />);
    expect(screen.getByText(/Percentage unavailable/)).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Spending trends data" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /2026-03-01: \$1.01/ }));
    expect(onSelect).toHaveBeenCalledWith(value.snapshot.bins[0].drillDown);
  });
});
