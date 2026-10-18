import { expect, it } from "vitest";
import { settleSpendingBubbles } from "./spending-bubbles";

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
