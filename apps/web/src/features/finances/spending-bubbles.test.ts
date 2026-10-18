// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { FinanceSpendingDashboard } from "@personal-os/domain";
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { SpendingBubbles, settleSpendingBubbles } from "./spending-bubbles";
import { spendingGroupVisual } from "./spending-visual";

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
  expect(large.querySelector('[data-spending-icon="category"] svg')).not.toBeNull();
  expect(large).toHaveTextContent("Groceries");
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
  expect(tiny).toHaveAttribute("title", "Very small purchase: $0.01");
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
