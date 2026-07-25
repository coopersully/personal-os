// @vitest-environment jsdom

import type { FinanceBudgetPace } from "@personal-os/domain";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BudgetPaceGraph } from "./budget-pace-graph";

function pace(
  period: FinanceBudgetPace["period"],
  cells: FinanceBudgetPace["cells"],
): FinanceBudgetPace {
  return { asOf: cells.at(-1)?.date ?? "2026-07-21", cells, period };
}

describe("BudgetPaceGraph", () => {
  it("renders a useful loading state before pace data arrives", () => {
    render(<BudgetPaceGraph data={undefined} onPeriodChange={vi.fn()} period="week" />);

    expect(screen.getByText("Loading pace")).toBeInTheDocument();
    expect(screen.getByText(/Set monthly limits/)).toBeInTheDocument();
  });

  it("labels every weekly pace state and summarizes the latest activity", () => {
    render(
      <BudgetPaceGraph
        data={pace("week", [
          { date: "2026-07-18", planned: 100, spent: 50, status: "ahead" },
          { date: "2026-07-19", planned: 100, spent: 100, status: "neutral" },
          { date: "2026-07-20", planned: 0, spent: 0, status: "blank" },
          { date: "2026-07-21", planned: 100, spent: 150, status: "behind" },
        ])}
        onPeriodChange={vi.fn()}
        period="week"
      />,
    );

    expect(screen.getAllByText("Over pace")).toHaveLength(2);
    expect(screen.getByText("$150.00 spent against $100.00 paced")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ahead of pace/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /On pace/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /No activity/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Over pace/ })).toBeInTheDocument();
  });

  it("aligns monthly cells to weekdays and changes the selected period", async () => {
    const onPeriodChange = vi.fn();
    const { container } = render(
      <BudgetPaceGraph
        data={pace("month", [
          { date: "2026-07-01", planned: 10, spent: 1, status: "ahead" },
          { date: "2026-07-02", planned: 20, spent: 2, status: "ahead" },
        ])}
        onPeriodChange={onPeriodChange}
        period="month"
      />,
    );

    expect(container.querySelectorAll('fieldset > [aria-hidden="true"].bg-muted')).toHaveLength(3);
    await userEvent.click(screen.getByRole("radio", { name: "Year" }));
    expect(onPeriodChange).toHaveBeenCalledWith("year");
  });

  it("renders the compact year calendar with weekday initials", () => {
    render(
      <BudgetPaceGraph
        data={pace("year", [{ date: "2026-01-01", planned: 100, spent: 100, status: "neutral" }])}
        onPeriodChange={vi.fn()}
        period="year"
      />,
    );

    expect(screen.getByText("On pace")).toBeInTheDocument();
    expect(screen.getAllByText("S")).toHaveLength(2);
  });
});
