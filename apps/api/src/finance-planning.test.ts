import { expect, it } from "vitest";
import { reliableMonthlyCapacity } from "./finance-planning.js";

it("uses the same cadence-aware net capacity for planning callers", () => {
  const input = {
    expectedNetPay: 4_000,
    grossAnnualIncome: 90_000,
    observedMonthlyIncome: null,
    recurring: [{ amount: 100, cadence: "weekly" }],
  };
  expect(reliableMonthlyCapacity(input)).toBeCloseTo(3_566.67, 2);
});
