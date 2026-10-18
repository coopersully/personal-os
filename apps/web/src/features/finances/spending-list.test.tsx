// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { FinanceSpendingDashboard, FinanceSpendingMonthlyBudget } from "@personal-os/domain";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { SpendingList } from "./spending-list";

it("sorts exact amounts, exposes negative groups, and expands bucket categories", async () => {
  const groups = [
    {
      id: "a",
      label: "Travel",
      netCents: 12345,
      pendingCents: 345,
      categories: [{ id: "child", label: "Rail", netCents: 12345, pendingCents: 345 }],
    },
    { id: "b", label: "Food", netCents: -100, pendingCents: 0, categories: [] },
  ] as unknown as FinanceSpendingDashboard["groups"];
  const select = vi.fn();
  render(<SpendingList groups={groups} onSelect={select} />);
  expect(screen.getAllByText("$123.45").length).toBeGreaterThan(0);
  expect(screen.getByText("-$1.00")).toBeInTheDocument();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /Name/ }));
  const list = screen.getAllByRole("list")[0];
  if (!list) throw new Error("Missing spending list");
  expect(within(list).getAllByRole("button")[0]).toHaveTextContent("Food");
  await user.click(screen.getByText("Categories in Travel"));
  await user.click(screen.getByRole("button", { name: "Rail" }));
  expect(select).toHaveBeenCalledWith(groups[0]?.categories[0]);
  expect(screen.getAllByText(/Budget unavailable/).length).toBeGreaterThan(0);
});

afterEach(() => cleanup());
it("sorts qualified monthly utilization separately from selected-period spending", () => {
  const groups = [
    { id: "a", label: "Travel", netCents: 100, pendingCents: 0, categories: [] },
    { id: "b", label: "Food", netCents: 900, pendingCents: 0, categories: [] },
    { id: "c", label: "No limit", netCents: 0, pendingCents: 0, categories: [] },
  ] as unknown as FinanceSpendingDashboard["groups"];
  const monthlyBudget = {
    state: "qualified",
    coverage: "partial",
    groups: [
      { groupId: "a", budgetCents: 10000, usedCents: 11000, overspent: true },
      { groupId: "b", budgetCents: 20000, usedCents: 5000, overspent: false },
      { groupId: "c", budgetCents: null, usedCents: 0, overspent: false },
    ],
  } as FinanceSpendingMonthlyBudget;
  render(<SpendingList groups={groups} monthlyBudget={monthlyBudget} onSelect={vi.fn()} />);
  expect(
    screen.getByText(/Observed monthly \$110.00 of \$100.00 · 110.0% · Over budget \$10.00/),
  ).toBeVisible();
  expect(screen.getByText("No budget limit")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: /Monthly budget used/ }));
  const list = screen.getByRole("list");
  expect(within(list).getAllByRole("button")[0]).toHaveTextContent("Travel");
});
