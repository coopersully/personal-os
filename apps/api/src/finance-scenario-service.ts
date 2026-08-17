import { createHash } from "node:crypto";
import {
  type FinanceScenarioInput,
  type FinanceScenarioProjection,
  type FinanceScenarioResult,
  financeScenarioInputSchema,
  financeScenarioResultSchema,
} from "@personal-os/domain";

type ScenarioPlan = FinanceScenarioInput["baseline"];

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .toSorted()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalizePlan(plan: ScenarioPlan): ScenarioPlan {
  return {
    ...plan,
    assumptions: [...plan.assumptions].toSorted(),
    budgetAllocations: [...plan.budgetAllocations].toSorted((left, right) =>
      left.categoryId.localeCompare(right.categoryId),
    ),
  };
}

function normalizeScenarioInput(input: FinanceScenarioInput): FinanceScenarioInput {
  const parsed = financeScenarioInputSchema.parse(input);
  return {
    ...parsed,
    alternatives: parsed.alternatives.map(normalizePlan),
    baseline: normalizePlan(parsed.baseline),
  };
}

function projectedLowestBalance(
  startingCash: number,
  monthlyCashFlow: number,
  horizonMonths: number,
) {
  return monthlyCashFlow < 0 ? startingCash + monthlyCashFlow * horizonMonths : startingCash;
}

function projectScenario(plan: ScenarioPlan, horizonMonths: number): FinanceScenarioProjection {
  const allocations = plan.budgetAllocations.reduce((sum, allocation) => sum + allocation.limit, 0);
  const monthlyCashFlow =
    plan.monthlyIncome -
    plan.monthlyHousingCost -
    plan.monthlyDebtPayment -
    plan.monthlyReserveContribution -
    allocations;
  const essentialMonthlyOutflow = plan.monthlyHousingCost + plan.monthlyDebtPayment;
  return {
    debtPayoffMonths: null,
    goalDateEffects: [],
    label: plan.label,
    monthlyCashFlow,
    projectedLowestBalance: projectedLowestBalance(
      plan.startingCash,
      monthlyCashFlow,
      horizonMonths,
    ),
    reserveRunwayMonths:
      essentialMonthlyOutflow > 0 ? plan.startingCash / essentialMonthlyOutflow : null,
  };
}

function scenarioFingerprint(input: FinanceScenarioInput) {
  return `sha256:${createHash("sha256").update(stableJson(input)).digest("hex")}`;
}

/**
 * Produce a deterministic planning preview. It intentionally holds income,
 * expenses, and returns fixed so a fingerprint always represents the same
 * projection rather than a simulated market outcome.
 */
export function compareFinanceScenarios(input: FinanceScenarioInput): FinanceScenarioResult {
  const normalized = normalizeScenarioInput(input);
  const baseline = projectScenario(normalized.baseline, normalized.horizonMonths);
  const alternatives = normalized.alternatives.map((plan) => {
    const projection = projectScenario(plan, normalized.horizonMonths);
    const reserveDifference =
      plan.monthlyReserveContribution - normalized.baseline.monthlyReserveContribution;
    return {
      ...projection,
      goalDateEffects:
        reserveDifference === 0
          ? []
          : [
              `Reserve contribution is ${Math.abs(reserveDifference)}/month ${reserveDifference > 0 ? "higher" : "lower"} than ${normalized.baseline.label}.`,
            ],
    };
  });
  const allPlans = [baseline, ...alternatives];
  return financeScenarioResultSchema.parse({
    alternatives,
    asOf: normalized.asOf,
    assumptions: [
      ...new Set([
        ...normalized.baseline.assumptions,
        ...normalized.alternatives.flatMap((plan) => plan.assumptions),
      ]),
    ],
    baseline,
    fingerprint: scenarioFingerprint(normalized),
    goalConflicts: allPlans
      .filter((plan) => plan.monthlyCashFlow < 0)
      .map((plan) => `${plan.label} spends more than its stated monthly income.`),
    missingInputs: ["Debt balance is needed to estimate payoff timing."],
    sensitivityWarnings: [
      "Scenarios use fixed income and expenses; returns and irregular costs are not modeled.",
      ...(allPlans.some((plan) => plan.monthlyCashFlow < 0)
        ? ["A negative monthly cash flow reduces the projected balance every month."]
        : []),
    ],
  });
}
