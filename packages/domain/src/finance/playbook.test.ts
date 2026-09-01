import { describe, expect, it } from "vitest";
import { assessFinancePlaybook, financePlaybookSchema, ILO_FINANCE_PLAYBOOK } from "./playbook.js";

describe("Finance playbook", () => {
  it("is an approved, ordered, source-lineaged server policy", () => {
    expect(
      financePlaybookSchema.parse(ILO_FINANCE_PLAYBOOK).steps.map((step) => step.rank),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(
      ILO_FINANCE_PLAYBOOK.researchSources.some((source) => source.stability === "time_sensitive"),
    ).toBe(true);
    expect(ILO_FINANCE_PLAYBOOK.webResearchPolicy.neverClaimResearchWithoutEvidence).toBe(true);
  });

  it("keeps incomplete facts from looking on track", () => {
    const assessment = assessFinancePlaybook({
      now: "2026-08-30T12:00:00.000Z",
      profile: null,
    });
    expect(assessment.readiness).toBe("not_ready");
    expect(assessment.blockers).toContain(
      "Complete the financial profile before relying on personalized priorities.",
    );
  });

  it("calls out uncertain debt pricing and prioritizes verified costly debt", () => {
    const assessment = assessFinancePlaybook({
      now: "2026-08-30T12:00:00.000Z",
      profile: {
        debts: [
          { balance: 2_000, interestRate: null },
          { balance: 1_000, interestRate: 19 },
        ],
        expectedMonthlyTakeHome: 5_000,
        incomeStability: "stable",
        insurance: [{ status: "active" }],
        jurisdiction: "US-NY",
        liquidReserves: 10_000,
        reserveTargetMonths: 3,
      },
    });
    expect(assessment.uncertainty).toHaveLength(1);
    expect(assessment.nextActions[0]).toContain("high-cost debt");
    expect(assessment.readiness).toBe("on_track");
  });

  it.each([
    0, 10_000,
  ])("does not mark reserves ready without an assessable target (%d)", (liquidReserves) => {
    const assessment = assessFinancePlaybook({
      now: "2026-08-30T12:00:00.000Z",
      profile: {
        debts: [],
        expectedMonthlyTakeHome: 5_000,
        insurance: [{ status: "active" }],
        jurisdiction: "US-NY",
        liquidReserves,
        incomeStability: "stable",
        reserveTargetMonths: null,
      },
    });
    expect(assessment.readiness).toBe("incomplete");
    expect(assessment.blockers).toContain(
      "Establish a reserve target from essential outflows and income stability before assessing readiness.",
    );
  });
});
