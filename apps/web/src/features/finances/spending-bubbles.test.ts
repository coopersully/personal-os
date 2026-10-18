// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { FinanceSpendingDashboard, FinanceSpendingMonthlyBudget } from "@personal-os/domain";
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  SpendingBubbles,
  settleSpendingBubbles,
  spendingBudgetFillHeight,
} from "./spending-bubbles";

it("settles colliding proportional circles inside the canvas deterministically", () => {
  const input = [
    { x: 0.5, y: 0.5, radius: 0.2 },
    { x: 0.5, y: 0.5, radius: 0.1 },
  ];
  const result = settleSpendingBubbles(input);
  expect(result).toEqual(settleSpendingBubbles(input));
  const [a, b] = result;
  if (!a || !b) throw new Error("Missing nodes");
  expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(a.radius + b.radius);
  expect(
    result.every(
      (node) =>
        node.x >= node.radius &&
        node.y >= node.radius &&
        node.x <= 1 - node.radius &&
        node.y <= 1 - node.radius,
    ),
  ).toBe(true);
  expect(a.radius / b.radius).toBe(2);
  expect(input[0]?.x).toBe(0.5);
});

afterEach(() => cleanup());
it("inverts bottom circular segment area and clamps nonpositive or saturated usage", () => {
  expect(spendingBudgetFillHeight(0.5)).toBeCloseTo(0.5, 8);
  const height = spendingBudgetFillHeight(0.25);
  expect(height).toBeGreaterThan(0.25);
  const y = 1 - 2 * height;
  expect((Math.acos(y) - y * Math.sqrt(1 - y * y)) / Math.PI).toBeCloseTo(0.25, 8);
  expect(spendingBudgetFillHeight(-0.1)).toBe(0);
  expect(spendingBudgetFillHeight(0)).toBe(0);
  expect(spendingBudgetFillHeight(1)).toBe(1);
  expect(spendingBudgetFillHeight(1.4)).toBe(1);
});
it("keeps selected-period circle sizing independent of qualified monthly fill and labels overspending", () => {
  const group = {
    id: "food",
    label: "Groceries",
    netCents: 100,
    positiveAreaCents: 100,
    categories: [],
  };
  const other = {
    id: "other",
    label: "Other",
    netCents: 900,
    positiveAreaCents: 900,
    categories: [],
  };
  const groups = [group, other] as unknown as FinanceSpendingDashboard["groups"];
  const monthlyBudget: Extract<FinanceSpendingMonthlyBudget, { state: "qualified" }> = {
    state: "qualified",
    month: "2026-09",
    period: { from: "2026-09-01", through: "2026-09-30", timezone: "America/New_York" },
    currency: "USD",
    accountIds: ["account"],
    qualificationId: "qualification",
    confirmedAt: "2026-10-18T00:00:00Z",
    qualificationKind: "retrospective",
    includesPending: true,
    basis: "personal_cost",
    subtractsRefunds: true,
    coverage: "partial",
    groups: [{ groupId: "food", budgetCents: 10000, usedCents: 2500, overspent: false }],
  };
  const props = { groups, onSelect: vi.fn(), monthlyBudget };
  const { rerender } = render(createElement(SpendingBubbles, props));
  const bubble = screen.getByRole("button", { name: /Groceries:/ });
  const firstWidth = bubble.style.width;
  const clip = bubble.querySelector("[data-budget-fill]")?.getAttribute("style");
  rerender(
    createElement(SpendingBubbles, {
      ...props,
      groups: groups.map((item) =>
        item.id === "food" ? { ...item, positiveAreaCents: 900, netCents: 900 } : item,
      ),
    }),
  );
  expect(screen.getByRole("button", { name: /Groceries:/ }).style.width).not.toBe(firstWidth);
  expect(
    screen
      .getByRole("button", { name: /Groceries:/ })
      .querySelector("[data-budget-fill]")
      ?.getAttribute("style"),
  ).toBe(clip);
  rerender(
    createElement(SpendingBubbles, {
      ...props,
      monthlyBudget: {
        ...monthlyBudget,
        groups: [{ groupId: "food", budgetCents: 10000, usedCents: 11000, overspent: true }],
      },
    }),
  );
  expect(screen.getByRole("button", { name: /Groceries:/ })).toHaveAccessibleName(
    /Over budget \$10.00/,
  );
  expect(screen.getByRole("button", { name: /Groceries:/ })).toHaveClass("border-2");
  expect(
    screen
      .getByRole("button", { name: /Groceries:/ })
      .querySelector("[data-budget-fill]")
      ?.getAttribute("style"),
  ).toContain("inset(0%");
  rerender(
    createElement(SpendingBubbles, {
      ...props,
      monthlyBudget: {
        ...monthlyBudget,
        groups: [{ groupId: "food", budgetCents: 10000, usedCents: -100, overspent: false }],
      },
    }),
  );
  expect(screen.getByRole("button", { name: /Groceries:/ })).toHaveAccessibleName(/-\$1.00/);
  expect(
    screen
      .getByRole("button", { name: /Groceries:/ })
      .querySelector("[data-budget-fill]")
      ?.getAttribute("style"),
  ).toContain("inset(100%");
});
