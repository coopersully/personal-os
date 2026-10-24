// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { FinanceSpendingDashboard, FinanceSpendingMonthlyBudget } from "@personal-os/domain";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { SpendingList } from "./spending-list";

function chooseSort(name: RegExp) {
  fireEvent.keyDown(screen.getByRole("button", { name: "Sort breakdown" }), { key: "ArrowDown" });
  fireEvent.click(screen.getByRole("menuitem", { name }));
}

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
  chooseSort(/Name/);
  const list = screen.getAllByRole("list")[0];
  if (!list) throw new Error("Missing spending list");
  expect(within(list).getAllByRole("button")[0]).toHaveTextContent("Food");
  await user.click(screen.getByLabelText("Categories in Travel"));
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
    screen.getByTitle(/Observed monthly \$110.00 of \$100.00 · 110.0% · Over budget \$10.00/),
  ).toBeVisible();
  expect(screen.getByText("No budget limit")).toBeVisible();
  expect(screen.getByText("110% ($110.00) of $100.00 used, $10.00 over")).toBeVisible();
  expect(screen.queryByText(/pending/i)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Spent" })).not.toBeInTheDocument();
  chooseSort(/Monthly budget used/);
  const list = screen.getByRole("list");
  expect(within(list).getAllByRole("button")[0]).toHaveTextContent("Travel");
});
it("defensively distinguishes zero targets, sorts positive usage first, and never prints infinite percentages", () => {
  const groups = [
    { id: "zero-positive", label: "Zero positive", netCents: 100, pendingCents: 0, categories: [] },
    { id: "ordinary", label: "Ordinary", netCents: 100, pendingCents: 0, categories: [] },
    { id: "zero-empty", label: "Zero empty", netCents: 0, pendingCents: 0, categories: [] },
    {
      id: "zero-negative",
      label: "Zero negative",
      netCents: -100,
      pendingCents: 0,
      categories: [],
    },
    { id: "null", label: "No limit", netCents: 0, pendingCents: 0, categories: [] },
  ] as unknown as FinanceSpendingDashboard["groups"];
  const monthlyBudget = {
    state: "qualified",
    coverage: "complete",
    groups: [
      { groupId: "zero-positive", budgetCents: 0, usedCents: 250, overspent: true },
      { groupId: "ordinary", budgetCents: 100, usedCents: 200, overspent: true },
      { groupId: "zero-empty", budgetCents: 0, usedCents: 0, overspent: false },
      { groupId: "zero-negative", budgetCents: 0, usedCents: -100, overspent: false },
      { groupId: "null", budgetCents: null, usedCents: 0, overspent: false },
    ],
  } as FinanceSpendingMonthlyBudget;
  render(<SpendingList groups={groups} monthlyBudget={monthlyBudget} onSelect={vi.fn()} />);
  expect(screen.getByText("Monthly $2.50 of $0.00 · Over budget $2.50")).toBeVisible();
  expect(screen.getByText("Monthly $0.00 of $0.00 · No utilization")).toBeVisible();
  expect(screen.getByText("Monthly -$1.00 of $0.00 · No utilization")).toBeVisible();
  expect(screen.getByText("No budget limit")).toBeVisible();
  expect(screen.queryByText(/Infinity|NaN/)).not.toBeInTheDocument();
  chooseSort(/Monthly budget used/);
  const buttons = within(screen.getByRole("list")).getAllByRole("button");
  expect(buttons[0]).toHaveTextContent("Zero positive");
  expect(buttons[1]).toHaveTextContent("Ordinary");
});
it("keeps a zero-selected-activity qualified row visible and selects its own empty contribution scope", () => {
  const scope = {
    from: "2026-10-18",
    through: "2026-10-18",
    timezone: "America/New_York",
    accountIds: null,
    categoryIds: null,
    basis: "personal_cost",
    includePending: true,
    subtractRefunds: true,
  };
  const group = {
    id: "utilities",
    label: "Utilities",
    kind: "category",
    categoryIds: ["utilities"],
    netCents: 0,
    positiveAreaCents: 0,
    grossCents: 0,
    reimbursementAdjustmentCents: 0,
    reimbursementOutstandingCents: 0,
    refundAdjustmentCents: 0,
    pendingCents: 0,
    categories: [],
    drillDown: { scope, contributionIds: [], transactionIds: [] },
  } as FinanceSpendingDashboard["groups"][number];
  const monthlyBudget = {
    state: "qualified",
    coverage: "partial",
    groups: [{ groupId: "utilities", budgetCents: 10000, usedCents: 1600, overspent: false }],
  } as FinanceSpendingMonthlyBudget;
  const select = vi.fn();
  render(<SpendingList groups={[group]} monthlyBudget={monthlyBudget} onSelect={select} />);
  expect(screen.getByText("$0.00")).toBeVisible();
  expect(screen.getByTitle("Observed monthly $16.00 of $100.00 · 16.0%")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Utilities" }));
  expect(select).toHaveBeenCalledWith(group);
  expect(select.mock.calls[0]?.[0].drillDown).toEqual({
    scope,
    contributionIds: [],
    transactionIds: [],
  });
});
it("reverses sorting and keeps unavailable budgets last with deterministic ties", () => {
  const groups = ["Zulu", "Alpha", "Beta", "Missing", "Uncapped"].map((label, index) => ({
    id: label,
    label,
    netCents: index * 100,
    pendingCents: 0,
    categories: [],
    kind: "category" as const,
    categoryIds: [label],
    positiveAreaCents: index * 100,
    grossCents: index * 100,
    reimbursementAdjustmentCents: 0,
    reimbursementOutstandingCents: 0,
    refundAdjustmentCents: 0,
    drillDown: {
      scope: {
        from: "2026-09-01",
        through: "2026-09-30",
        timezone: "UTC",
        accountIds: null,
        categoryIds: null,
        basis: "personal_cost" as const,
        includePending: true,
        subtractRefunds: true,
      },
      contributionIds: [],
      transactionIds: [],
    },
  }));
  const monthlyBudget = {
    state: "qualified",
    coverage: "unknown",
    groups: [
      { groupId: "Zulu", budgetCents: 1000, usedCents: 500, overspent: false },
      { groupId: "Alpha", budgetCents: 2000, usedCents: 1000, overspent: false },
      { groupId: "Beta", budgetCents: 1000, usedCents: 100, overspent: false },
      { groupId: "Uncapped", budgetCents: null, usedCents: 100, overspent: false },
    ],
  } as FinanceSpendingMonthlyBudget;
  render(<SpendingList groups={groups} monthlyBudget={monthlyBudget} onSelect={vi.fn()} />);
  const labels = () =>
    within(screen.getByRole("list"))
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label"));
  chooseSort(/Monthly budget used/);
  expect(labels()).toEqual(["Alpha", "Zulu", "Beta", "Missing", "Uncapped"]);
  chooseSort(/Monthly budget used/);
  expect(labels()).toEqual(["Beta", "Alpha", "Zulu", "Missing", "Uncapped"]);
  chooseSort(/Name/);
  chooseSort(/Name/);
  expect(labels()).toEqual(["Zulu", "Uncapped", "Missing", "Beta", "Alpha"]);
  chooseSort(/Spent/);
  chooseSort(/Spent/);
  expect(labels()).toEqual(["Zulu", "Alpha", "Beta", "Missing", "Uncapped"]);
  expect(screen.getByText("Budget unavailable")).toBeVisible();
});
