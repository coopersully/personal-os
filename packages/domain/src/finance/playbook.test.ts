import { describe, expect, it } from "vitest";
import {
  assessFinancePlaybook,
  financePlaybookSchema,
  PERSONAL_OS_FINANCE_PLAYBOOK,
} from "./playbook.js";

describe("Finance playbook", () => {
  it("is an approved, ordered, source-lineaged server policy", () => {
    expect(PERSONAL_OS_FINANCE_PLAYBOOK).toMatchObject({
      id: "nohmi-finance",
      owner: "nohmi-finance",
    });
    expect(
      financePlaybookSchema.parse(PERSONAL_OS_FINANCE_PLAYBOOK).steps.map((step) => step.rank),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(
      PERSONAL_OS_FINANCE_PLAYBOOK.researchSources.some(
        (source) => source.stability === "time_sensitive",
      ),
    ).toBe(true);
    expect(PERSONAL_OS_FINANCE_PLAYBOOK.webResearchPolicy.neverClaimResearchWithoutEvidence).toBe(
      true,
    );
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

describe("Finance playbook rubric", () => {
  const profile = {
    debts: [],
    expectedMonthlyTakeHome: 6_000,
    incomeStability: "stable" as const,
    insurance: [{ kind: "health", status: "active" }],
    jurisdiction: "US-NY",
    liquidReserves: 18_000,
    reserveTargetMonths: 6,
  };

  it("defines every check it scores and names its sources", () => {
    const sourceIds = new Set(PERSONAL_OS_FINANCE_PLAYBOOK.researchSources.map(({ id }) => id));
    for (const check of PERSONAL_OS_FINANCE_PLAYBOOK.rubric)
      for (const sourceId of check.sourceIds) expect(sourceIds.has(sourceId)).toBe(true);
    for (const limit of PERSONAL_OS_FINANCE_PLAYBOOK.referenceLimits)
      expect(sourceIds.has(limit.sourceId)).toBe(true);
    const scored = assessFinancePlaybook({ now: "2026-11-13T12:00:00.000Z", profile });
    expect(scored.rubric.map(({ id }) => id).sort()).toEqual(
      PERSONAL_OS_FINANCE_PLAYBOOK.rubric.map(({ id }) => id).sort(),
    );
  });

  it("leaves checks unassessed rather than guessing when evidence is missing", () => {
    const { rubric } = assessFinancePlaybook({ now: "2026-11-13T12:00:00.000Z", profile });
    const status = Object.fromEntries(rubric.map((item) => [item.id, item.status]));
    expect(status).toMatchObject({
      spending_within_income: "not_assessed",
      plan_current: "not_assessed",
      reserve_months: "not_assessed",
      housing_share: "not_assessed",
      costly_debt: "healthy",
      protection: "healthy",
      retirement_saving: "not_assessed",
      employer_match: "not_assessed",
    });
  });

  it("scores spending, reserves, housing and plan state from evidence with its arithmetic", () => {
    const { rubric } = assessFinancePlaybook({
      now: "2026-11-13T12:00:00.000Z",
      profile,
      evidence: {
        currentMonthPlanApproved: false,
        grossAnnualIncome: 120_000,
        monthlyHousingCost: 3_000,
        plannedMonthlySpending: 5_700,
      },
    });
    const byId = Object.fromEntries(rubric.map((item) => [item.id, item]));
    expect(byId.spending_within_income).toMatchObject({ status: "watch" });
    expect(byId.spending_within_income?.detail).toContain("95%");
    expect(byId.plan_current).toMatchObject({ status: "gap" });
    expect(byId.reserve_months).toMatchObject({ status: "watch" });
    expect(byId.reserve_months?.detail).toContain("3.2 months");
    expect(byId.housing_share).toMatchObject({ status: "watch" });
  });

  it("uses a three-month default only when no reserve target is recorded, and says so", () => {
    const { rubric } = assessFinancePlaybook({
      now: "2026-11-13T12:00:00.000Z",
      profile: { ...profile, reserveTargetMonths: null },
      evidence: { plannedMonthlySpending: 5_000 },
    });
    const reserve = rubric.find((item) => item.id === "reserve_months");
    expect(reserve).toMatchObject({ status: "healthy" });
    expect(reserve?.detail).toContain("default 3-month target");
  });

  it("flags costly or unverified debt and lapsed coverage", () => {
    const { rubric } = assessFinancePlaybook({
      now: "2026-11-13T12:00:00.000Z",
      profile: {
        ...profile,
        debts: [{ balance: 4_000, interestRate: 24 }],
        insurance: [{ kind: "health", status: "lapsed" }],
      },
    });
    const status = Object.fromEntries(rubric.map((item) => [item.id, item.status]));
    expect(status).toMatchObject({ costly_debt: "gap", protection: "gap" });
    const unverified = assessFinancePlaybook({
      now: "2026-11-13T12:00:00.000Z",
      profile: { ...profile, debts: [{ balance: 4_000, interestRate: null }], insurance: [] },
    });
    expect(
      Object.fromEntries(unverified.rubric.map((item) => [item.id, item.status])),
    ).toMatchObject({ costly_debt: "not_assessed", protection: "not_assessed" });
  });

  it("never scores an empty reserve healthy against a zero target", () => {
    const { rubric } = assessFinancePlaybook({
      now: "2026-11-13T12:00:00.000Z",
      profile: { ...profile, liquidReserves: 0, reserveTargetMonths: 0 },
      evidence: {
        plannedMonthlySpending: 5_000,
        plannedSpendingBasis: "the approved 2026-10 plan",
      },
    });
    const reserve = rubric.find((item) => item.id === "reserve_months");
    expect(reserve).toMatchObject({ status: "gap" });
    expect(reserve?.detail).toContain("default 3-month target");
    expect(reserve?.detail).toContain("the approved 2026-10 plan");
  });

  it("reports a known costly debt as a gap even beside an unverified rate", () => {
    const { rubric } = assessFinancePlaybook({
      now: "2026-11-13T12:00:00.000Z",
      profile: {
        ...profile,
        debts: [
          { balance: 4_000, interestRate: 24 },
          { balance: 900, interestRate: null },
        ],
      },
    });
    expect(rubric.find((item) => item.id === "costly_debt")).toMatchObject({ status: "gap" });
  });

  it("covers the gap and watch bands for spending, housing, debt wording and protection", () => {
    const { rubric } = assessFinancePlaybook({
      now: "2026-11-13T12:00:00.000Z",
      profile: {
        ...profile,
        debts: [{ balance: 4_000, interestRate: 3 }],
        insurance: [{ kind: "property", status: "active" }],
        liquidReserves: 30_000,
      },
      evidence: {
        currentMonthPlanApproved: true,
        grossAnnualIncome: 60_000,
        monthlyHousingCost: 2_500,
        plannedMonthlySpending: 6_600,
      },
    });
    const byId = Object.fromEntries(rubric.map((item) => [item.id, item]));
    expect(byId.spending_within_income).toMatchObject({ status: "gap" });
    expect(byId.housing_share).toMatchObject({ status: "gap" });
    expect(byId.plan_current).toMatchObject({ status: "healthy" });
    expect(byId.protection).toMatchObject({ status: "watch" });
    expect(byId.costly_debt).toMatchObject({ status: "healthy" });
    expect(byId.costly_debt?.detail).toContain("No recorded debt is at or above");
    expect(byId.reserve_months).toMatchObject({ status: "watch" });
  });
});
