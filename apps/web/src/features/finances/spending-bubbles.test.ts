// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { FinanceSpendingDashboard, FinanceSpendingMonthlyBudget } from "@personal-os/domain";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type CSSProperties, createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  SpendingBubbles,
  settleSpendingBubbles,
  spendingBudgetFillHeight,
} from "./spending-bubbles";
import { spendingGroupVisual } from "./spending-visual";

const fillAnimation = vi.hoisted(() => ({
  reduced: false,
  props: [] as Array<{ initial: unknown; animate: unknown; transition: unknown }>,
}));
vi.mock("motion/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("motion/react")>();
  return {
    ...actual,
    useReducedMotion: () => fillAnimation.reduced,
    motion: {
      button: actual.motion.button,
      span: (props: Record<string, unknown>) => {
        fillAnimation.props.push({
          initial: props.initial,
          animate: props.animate,
          transition: props.transition,
        });
        return createElement("span", {
          "aria-hidden": true,
          "data-budget-fill": String(props["data-budget-fill"]),
          className: props.className as string,
          style: {
            ...(props.style as CSSProperties),
            clipPath: (props.animate as { clipPath: string }).clipPath,
          },
        });
      },
    },
  };
});
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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  fillAnimation.reduced = false;
  fillAnimation.props = [];
});
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
  expect(screen.getByRole("button", { name: /Groceries:/ })).toHaveClass("border-0");
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

it("uses assigned category tint and semantic icons with readable foregrounds at narrow widths", () => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(240);
  const groups = [
    {
      id: "food",
      kind: "category",
      label: "Groceries",
      netCents: 4000,
      positiveAreaCents: 4000,
      categories: [],
      visual: { color: "#123456", icon: "category" },
    },
    {
      id: "bucket-legacy",
      kind: "bucket",
      label: "Living costs",
      netCents: 100,
      positiveAreaCents: 100,
      categories: [],
    },
    {
      id: "uncategorized",
      kind: "category",
      label: "Uncategorized",
      netCents: 100,
      positiveAreaCents: 100,
      categories: [],
    },
    {
      id: "tiny",
      kind: "category",
      label: "Very small purchase",
      netCents: 1,
      positiveAreaCents: 1,
      categories: [],
    },
  ] as unknown as FinanceSpendingDashboard["groups"];
  render(createElement(SpendingBubbles, { groups, onSelect: vi.fn() }));
  const large = screen.getByRole("button", { name: /Groceries: \$40.00/ });
  expect(large.getAttribute("style")).toContain("rgba(18, 52, 86");
  expect(large).toHaveClass("text-foreground");
  expect(large).not.toHaveClass("text-primary");
  expect(large.querySelector('[data-spending-icon="groceries"] svg')).not.toBeNull();
  expect(large).toHaveTextContent("Groceries");
  const material = large.querySelector(".spending-bubble-material");
  expect(material).not.toBeNull();
  expect(material?.querySelector("[data-spending-icon]")).toBeNull();
  expect(material).toHaveTextContent("");
  expect(large.querySelector("[data-spending-icon]")?.parentElement).toBe(large);
  const small = screen.getByRole("button", { name: /Living costs: \$1.00/ });
  expect(small.querySelector('[data-spending-icon="bucket"] svg')).not.toBeNull();
  expect(small).not.toHaveTextContent("Living costs");
  expect(small.style.backgroundColor).not.toBe(large.style.backgroundColor);
  expect(
    screen
      .getByRole("button", { name: /Uncategorized:/ })
      .querySelector('[data-spending-icon="uncategorized"] svg'),
  ).not.toBeNull();
  const tiny = screen.getByRole("button", { name: /Very small purchase: \$0.01/ });
  expect(tiny.querySelector("[data-spending-icon]")).toBeNull();
  expect(tiny.getAttribute("title")).toContain("Very small purchase: $0.01");
});
it("keeps ID-based fallback identity stable without inventing stored artwork", () => {
  const bucket = { id: "stable-bucket", kind: "bucket" as const };
  expect(spendingGroupVisual(bucket)).toEqual(spendingGroupVisual({ ...bucket }));
  expect(spendingGroupVisual(bucket).icon).toBe("bucket");
  expect(spendingGroupVisual({ ...bucket, visual: { color: null, icon: "bucket" } }).color).toBe(
    spendingGroupVisual(bucket).color,
  );
  expect(spendingGroupVisual({ id: "uncategorized", kind: "category" }).icon).toBe("uncategorized");
  expect(
    spendingGroupVisual({ ...bucket, visual: { color: "invalid", icon: "bucket" } }).color,
  ).toBe(spendingGroupVisual(bucket).color);
});

it("animates changing area-correct fill within300ms and disables animation for reduced motion", () => {
  const groups = [
    {
      id: "food",
      kind: "category",
      label: "Food",
      netCents: 100,
      positiveAreaCents: 100,
      categories: [],
    },
  ] as unknown as FinanceSpendingDashboard["groups"];
  const budget: Extract<FinanceSpendingMonthlyBudget, { state: "qualified" }> = {
    state: "qualified",
    month: "2026-09",
    period: { from: "2026-09-01", through: "2026-09-30", timezone: "America/New_York" },
    currency: "USD",
    accountIds: ["account"],
    qualificationId: "qualification",
    confirmedAt: "2026-10-18T00:00:00Z",
    qualificationKind: "retrospective",
    coverage: "partial",
    includesPending: true,
    basis: "personal_cost",
    subtractsRefunds: true,
    groups: [{ groupId: "food", budgetCents: 10000, usedCents: 2500, overspent: false }],
  };
  const props = { groups, onSelect: vi.fn(), monthlyBudget: budget };
  const { rerender } = render(createElement(SpendingBubbles, props));
  expect(fillAnimation.props.at(-1)).toEqual({
    initial: false,
    animate: { clipPath: `inset(${(1 - spendingBudgetFillHeight(0.25)) * 100}% 0 0 0)` },
    transition: { duration: 0.3, ease: "easeOut" },
  });
  rerender(
    createElement(SpendingBubbles, {
      ...props,
      monthlyBudget: {
        ...budget,
        groups: [{ groupId: "food", budgetCents: 10000, usedCents: 5000, overspent: false }],
      },
    }),
  );
  expect(fillAnimation.props.at(-1)).toEqual({
    initial: false,
    animate: { clipPath: `inset(${(1 - spendingBudgetFillHeight(0.5)) * 100}% 0 0 0)` },
    transition: { duration: 0.3, ease: "easeOut" },
  });
  fillAnimation.reduced = true;
  rerender(
    createElement(SpendingBubbles, {
      ...props,
      monthlyBudget: {
        ...budget,
        groups: [{ groupId: "food", budgetCents: 10000, usedCents: 15000, overspent: true }],
      },
    }),
  );
  expect(fillAnimation.props.at(-1)).toEqual({
    initial: false,
    animate: { clipPath: "inset(0% 0 0 0)" },
    transition: { duration: 0, ease: "easeOut" },
  });
});
it("defensively renders a zero target separately from null without infinite utilization", () => {
  const groups = [
    {
      id: "food",
      kind: "category",
      label: "Food",
      netCents: 100,
      positiveAreaCents: 100,
      categories: [],
    },
  ] as unknown as FinanceSpendingDashboard["groups"];
  const monthlyBudget = {
    state: "qualified",
    month: "2026-10",
    period: { from: "2026-10-01", through: "2026-10-31", timezone: "America/New_York" },
    currency: "USD",
    accountIds: [],
    qualificationId: "qualification",
    confirmedAt: "2026-10-18T00:00:00Z",
    qualificationKind: "retrospective",
    includesPending: false,
    basis: "personal_cost",
    subtractsRefunds: true,
    coverage: "complete",
    groups: [],
  } as Extract<FinanceSpendingMonthlyBudget, { state: "qualified" }>;
  const props = {
    groups,
    onSelect: vi.fn(),
    monthlyBudget: {
      ...monthlyBudget,
      groups: [{ groupId: "food", budgetCents: 0, usedCents: 250, overspent: true }],
    },
  };
  const { rerender } = render(createElement(SpendingBubbles, props));
  const selected = () => screen.getByRole("button", { name: /Food:/ });
  expect(selected()).toHaveAccessibleName(
    /Monthly budget used \$2.50 of \$0.00; Over budget \$2.50/,
  );
  expect(selected()).toHaveClass("border-0");
  expect(selected()).toHaveTextContent("Over budget");
  expect(fillAnimation.props.at(-1)).toMatchObject({ animate: { clipPath: "inset(0% 0 0 0)" } });
  for (const usedCents of [0, -100]) {
    rerender(
      createElement(SpendingBubbles, {
        ...props,
        monthlyBudget: {
          ...monthlyBudget,
          groups: [{ groupId: "food", budgetCents: 0, usedCents, overspent: false }],
        },
      }),
    );
    expect(selected()).toHaveAccessibleName(/No utilization/);
    expect(selected()).not.toHaveAccessibleName(/Over budget|Infinity|NaN/);
    expect(selected()).toHaveClass("border-0");
    expect(fillAnimation.props.at(-1)).toMatchObject({
      animate: { clipPath: "inset(100% 0 0 0)" },
    });
  }
  rerender(
    createElement(SpendingBubbles, {
      ...props,
      monthlyBudget: {
        ...monthlyBudget,
        groups: [{ groupId: "food", budgetCents: null, usedCents: 250, overspent: false }],
      },
    }),
  );
  expect(selected()).toHaveAccessibleName(/No monthly budget limit/);
  expect(selected().querySelector("[data-budget-fill]")).toBeNull();
  rerender(createElement(SpendingBubbles, { ...props, monthlyBudget }));
  expect(selected()).toHaveAccessibleName(/Monthly budget comparison unavailable/);
  expect(selected().querySelector("[data-budget-fill]")).toBeNull();
});

it("keeps tiny and long-named groups readable and selectable without inflating their area", async () => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(240);
  const groups = [
    {
      id: "large",
      label: "Home",
      kind: "category",
      netCents: 100000,
      positiveAreaCents: 100000,
      categories: [],
    },
    {
      id: "tiny",
      label: "A very long category name for a single small transaction",
      kind: "category",
      netCents: 1,
      positiveAreaCents: 1,
      categories: [],
    },
  ] as unknown as FinanceSpendingDashboard["groups"];
  const select = vi.fn();
  render(createElement(SpendingBubbles, { groups, onSelect: select }));
  const tiny = screen.getByRole("button", { name: /A very long category name.*: \$0.01/ });
  tiny.focus();
  await userEvent.keyboard("{Enter}");
  expect(select).toHaveBeenCalledWith(groups[1]);
  const smallCircle = screen.getByRole("button", { name: /A very long category name.*: \$0.01/ });
  const largeCircle = screen.getByRole("button", { name: /Home: \$1,000.00/ });
  expect(
    Number.parseFloat(smallCircle.style.width) ** 2 /
      Number.parseFloat(largeCircle.style.width) ** 2,
  ).toBeCloseTo(1 / 100000, 8);
  expect(smallCircle).toHaveAttribute("tabindex", "0");
  expect(screen.queryByText(/Circle size:/)).not.toBeInTheDocument();
  expect(screen.queryByRole("list")).not.toBeInTheDocument();
});
it("keeps arrangement available with reduced motion and offers only reset", () => {
  const groups = [
    {
      id: "food",
      label: "Food",
      kind: "category",
      netCents: 100,
      positiveAreaCents: 100,
      categories: [],
    },
  ] as unknown as FinanceSpendingDashboard["groups"];
  const props = { groups, onSelect: vi.fn() };
  const { rerender } = render(createElement(SpendingBubbles, props));
  expect(screen.getByRole("button", { name: /Food:/ }).style.touchAction).toBe("none");
  expect(screen.queryByRole("button", { name: "Layout" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Reset bubble layout" }));
  fillAnimation.reduced = true;
  rerender(createElement(SpendingBubbles, props));
  expect(screen.getByRole("button", { name: /Food:/ }).style.touchAction).toBe("none");
  expect(screen.getByText("Breakdown")).toBeVisible();
});

it("centers settled bounds and keeps a dragged body fixed while resolving collisions", () => {
  const nodes = [
    { x: 0.2, y: 0.3, radius: 0.15 },
    { x: 0.2, y: 0.3, radius: 0.08 },
  ];
  const centered = settleSpendingBubbles(nodes);
  expect(
    (Math.min(...centered.map((node) => node.x - node.radius)) +
      Math.max(...centered.map((node) => node.x + node.radius))) /
      2,
  ).toBeCloseTo(0.5);
  expect(
    (Math.min(...centered.map((node) => node.y - node.radius)) +
      Math.max(...centered.map((node) => node.y + node.radius))) /
      2,
  ).toBeCloseTo(0.5);
  const pinned = settleSpendingBubbles(nodes, 0);
  expect(pinned[0]).toEqual(nodes[0]);
  const [a, b] = pinned;
  if (!a || !b) throw new Error("Missing collision bodies");
  expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(0.23);
});

it("recovers crowded coincident layouts without overlaps or escaping bounds", () => {
  for (const count of [6, 16, 32]) {
    const radius = 0.28 / Math.sqrt(count);
    const input = Array.from({ length: count }, () => ({ x: 0.5, y: 0.5, radius }));
    const result = settleSpendingBubbles(input);
    for (const [index, a] of result.entries()) {
      expect(a.x).toBeGreaterThanOrEqual(a.radius - 1e-6);
      expect(a.x).toBeLessThanOrEqual(1 - a.radius + 1e-6);
      expect(a.y).toBeGreaterThanOrEqual(a.radius - 1e-6);
      expect(a.y).toBeLessThanOrEqual(1 - a.radius + 1e-6);
      for (const b of result.slice(index + 1))
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(a.radius + b.radius - 1e-5);
    }
    const recovered = settleSpendingBubbles(result);
    for (const [index, a] of recovered.entries())
      for (const b of recovered.slice(index + 1))
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(a.radius + b.radius - 1e-5);
  }
});
