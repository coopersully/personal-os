import { describe, expect, it } from "vitest";
import { compareFinanceScenarios } from "./finance-scenario-service.js";

describe("Finance scenarios", () => {
  it("compares deterministic cash, reserve, debt, and goal effects", () => {
    const result = compareFinanceScenarios({
      alternatives: [
        {
          assumptions: ["Housing change begins this month."],
          budgetAllocations: [{ categoryId: "11111111-1111-4111-8111-111111111111", limit: 1_400 }],
          label: "Lower housing",
          monthlyDebtPayment: 300,
          monthlyHousingCost: 1_200,
          monthlyIncome: 5_000,
          monthlyReserveContribution: 500,
          startingCash: 2_000,
        },
      ],
      asOf: "2026-08-15",
      baseline: {
        assumptions: ["Income remains stable."],
        budgetAllocations: [{ categoryId: "11111111-1111-4111-8111-111111111111", limit: 1_800 }],
        label: "Current plan",
        monthlyDebtPayment: 200,
        monthlyHousingCost: 1_800,
        monthlyIncome: 5_000,
        monthlyReserveContribution: 200,
        startingCash: 2_000,
      },
      horizonMonths: 3,
    });

    expect(result.baseline).toMatchObject({
      debtPayoffMonths: null,
      label: "Current plan",
      monthlyCashFlow: 1_000,
      projectedLowestBalance: 2_000,
      reserveRunwayMonths: 1,
    });
    expect(result.alternatives[0]).toMatchObject({
      label: "Lower housing",
      monthlyCashFlow: 1_600,
      projectedLowestBalance: 2_000,
    });
    expect(result.alternatives[0]?.reserveRunwayMonths).toBeCloseTo(1.33, 2);
    expect(result.alternatives[0]?.goalDateEffects).toContain(
      "Reserve contribution is 300/month higher than Current plan.",
    );
    expect(result.assumptions).toEqual([
      "Income remains stable.",
      "Housing change begins this month.",
    ]);
    expect(result.missingInputs).toContain("Debt balance is needed to estimate payoff timing.");
    expect(result.sensitivityWarnings).toContain(
      "Scenarios use fixed income and expenses; returns and irregular costs are not modeled.",
    );
  });

  it("uses a stable fingerprint regardless of alternative input order", () => {
    const baseline = {
      assumptions: [],
      budgetAllocations: [],
      label: "Baseline",
      monthlyDebtPayment: 0,
      monthlyHousingCost: 1_000,
      monthlyIncome: 3_000,
      monthlyReserveContribution: 500,
      startingCash: 1_000,
    };
    const alternative = { ...baseline, label: "Alternative", monthlyHousingCost: 900 };
    const input = { alternatives: [alternative], asOf: "2026-08-15", baseline, horizonMonths: 12 };

    expect(compareFinanceScenarios(input).fingerprint).toBe(
      compareFinanceScenarios(input).fingerprint,
    );
  });
});
