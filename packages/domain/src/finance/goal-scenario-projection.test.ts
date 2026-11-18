import { describe, expect, it } from "vitest";
import { type GoalScenarioInput, projectGoalScenarios } from "./goal-scenario-projection.js";

function fixture(): GoalScenarioInput {
  return {
    target: { amountCents: 1000, currency: "USD" },
    sourceGoalRevision: "goal:v2",
    asOfLocalDate: "2027-01-31",
    progress: {
      amountCents: 0,
      currency: "USD",
      confirmed: true,
      provenance: "user confirmation",
      asOfLocalDate: "2027-01-31",
      sourceRevision: "progress:v1",
    },
    baseline: { name: "Baseline", monthlyContributionCents: 400 },
  };
}

describe("projectGoalScenarios", () => {
  it("preserves exact monthly contributions, anchor and evidence without mutating inputs", () => {
    const input = fixture();
    const before = structuredClone(input);
    const result = projectGoalScenarios(input);
    expect(result.scenarios[0]).toEqual({
      name: "Baseline",
      monthlyContributionCents: 400,
      reason: "projected",
      completionLocalDate: "2027-03-31",
      curve: [
        { localDate: "2027-01-31", cumulativeContributionCents: 400, projectedAmountCents: 400 },
        { localDate: "2027-02-28", cumulativeContributionCents: 800, projectedAmountCents: 800 },
        { localDate: "2027-03-31", cumulativeContributionCents: 1200, projectedAmountCents: 1200 },
      ],
    });
    expect(result.sourceGoalRevision).toBe("goal:v2");
    expect(result.progress).toEqual(input.progress);
    result.progress.provenance = "changed output";
    expect(input).toEqual(before);
    expect(result.firstContributionBasis).toBe("monthly_assumption_starting_as_of");
  });

  it.each([
    "confirmed",
    "amountCents",
    "provenance",
    "asOfLocalDate",
    "sourceRevision",
  ] as const)("requires confirmed progress evidence: %s", (key) => {
    const input = fixture();
    if (key === "confirmed") input.progress.confirmed = false;
    else input.progress[key] = null;
    const result = projectGoalScenarios(input);
    expect(result.remainingCents).toBeNull();
    expect(result.scenarios[0]?.reason).toBe("progress_unknown");
    expect(result.scenarios[0]?.curve).toEqual([]);
  });

  it("reports achieved, zero, negative and tiny contributions honestly", () => {
    const input = fixture();
    input.alternatives = [
      { name: "Zero", monthlyContributionCents: 0 },
      { name: "Negative", monthlyContributionCents: -1 },
      { name: "Tiny", monthlyContributionCents: 1 },
    ];
    input.target.amountCents = 2000;
    const result = projectGoalScenarios(input);
    expect(result.scenarios.map((s) => s.reason)).toEqual([
      "projected",
      "nonpositive_contribution",
      "nonpositive_contribution",
      "beyond_horizon",
    ]);
    expect(result.scenarios[3]?.curve).toHaveLength(1200);
    expect(result.scenarios[3]?.completionLocalDate).toBeNull();
    input.progress.amountCents = 3000;
    expect(
      projectGoalScenarios(input).scenarios.every(
        (s) => s.reason === "achieved" && s.curve.length === 0,
      ),
    ).toBe(true);
  });

  it("uses actual scheduled dates for target requirements, including leap month clamping", () => {
    const input = fixture();
    input.asOfLocalDate = "2028-01-30";
    input.progress.asOfLocalDate = "2028-01-30";
    input.firstContributionLocalDate = "2028-01-31";
    input.targetLocalDate = "2028-02-29";
    expect(projectGoalScenarios(input).targetDateRequirement).toMatchObject({
      scheduledContributionCount: 2,
      requiredMonthlyContributionCents: 500,
    });
    input.targetLocalDate = "2028-01-30";
    expect(projectGoalScenarios(input).targetDateRequirement).toMatchObject({
      reason: "no_scheduled_contributions",
      requiredMonthlyContributionCents: null,
    });
    input.targetLocalDate = "2028-01-29";
    expect(projectGoalScenarios(input).targetDateRequirement?.reason).toBe("past_target_date");
    input.targetLocalDate = "2200-01-01";
    expect(projectGoalScenarios(input).targetDateRequirement).toMatchObject({
      reason: "beyond_horizon",
      requiredMonthlyContributionCents: null,
    });
  });

  it("includes the 1200th scheduled contribution but never invents a 1201st", () => {
    const input = fixture();
    input.target.amountCents = 1200;
    input.baseline.monthlyContributionCents = 1;
    const result = projectGoalScenarios(input);
    expect(result.scenarios[0]?.curve).toHaveLength(1200);
    expect(result.scenarios[0]?.completionLocalDate).toBe("2126-12-31");
    input.target.amountCents = 1201;
    expect(projectGoalScenarios(input).scenarios[0]?.reason).toBe("beyond_horizon");
    input.progress.confirmed = false;
    input.targetLocalDate = "2027-04-30";
    expect(projectGoalScenarios(input).targetDateRequirement).toMatchObject({
      reason: "progress_unknown",
      requiredMonthlyContributionCents: null,
    });
  });

  it("rejects invalid amounts, mixed/unsupported currency, dates, and scenario bounds", () => {
    for (const amountCents of [NaN, Infinity, 0.1, -1, 10_000_000_001]) {
      const input = fixture();
      input.target.amountCents = amountCents;
      expect(() => projectGoalScenarios(input)).toThrow(RangeError);
    }
    for (const currency of ["EUR", "JPY", "KWD", "ZZZ", "usd"]) {
      const input = fixture();
      input.target.currency = currency;
      expect(() => projectGoalScenarios(input)).toThrow(RangeError);
    }
    for (const firstContributionLocalDate of ["2027-02-29", "2027-01-30", "tomorrow"]) {
      expect(() => projectGoalScenarios({ ...fixture(), firstContributionLocalDate })).toThrow(
        RangeError,
      );
    }
    expect(() => projectGoalScenarios({ ...fixture(), sourceGoalRevision: " " })).toThrow(
      RangeError,
    );
    const input = fixture();
    input.alternatives = Array.from({ length: 4 }, (_, i) => ({
      name: `${i}`,
      monthlyContributionCents: 1,
    }));
    expect(() => projectGoalScenarios(input)).toThrow(RangeError);
    input.alternatives = [{ ...input.baseline }];
    expect(() => projectGoalScenarios(input)).toThrow(RangeError);
    input.alternatives = [];
    input.progress.asOfLocalDate = "2028-01-01";
    expect(() => projectGoalScenarios(input)).toThrow(RangeError);
  });

  it("bounds maximum money and calendar overflow without invented completion", () => {
    const input = fixture();
    input.target.amountCents = 10_000_000_000;
    input.baseline.monthlyContributionCents = 9_999_999_999;
    expect(
      projectGoalScenarios(input).scenarios[0]?.curve.at(-1)?.cumulativeContributionCents,
    ).toBe(19_999_999_998);
    input.asOfLocalDate = "9999-12-31";
    input.progress.asOfLocalDate = "9999-12-31";
    input.baseline.monthlyContributionCents = 1;
    expect(projectGoalScenarios(input).scenarios[0]).toMatchObject({
      reason: "beyond_horizon",
      completionLocalDate: null,
    });
    expect(projectGoalScenarios(input).scenarios[0]?.curve).toHaveLength(1);
  });
});
