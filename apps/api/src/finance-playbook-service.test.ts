import { describe, expect, it, vi } from "vitest";
import { createFinancePlaybookService } from "./finance-playbook-service.js";

describe("Finance playbook service", () => {
  it("does not require the wealth summary for a profile-based assessment", async () => {
    const getFinancialProfile = vi.fn(async () => ({ data: null }));
    const getWealthSummary = vi.fn(async () => {
      throw new Error("wealth unavailable");
    });
    const service = createFinancePlaybookService({
      finances: { getFinancialProfile, getWealthSummary } as never,
      now: () => new Date("2026-08-30T12:00:00.000Z"),
    });

    await expect(service.get("11111111-1111-4111-8111-111111111111")).resolves.toMatchObject({
      assessment: { readiness: "not_ready" },
    });
    expect(getFinancialProfile).toHaveBeenCalledOnce();
    expect(getWealthSummary).not.toHaveBeenCalled();
  });

  it("passes emergency reserve preferences into the assessment", async () => {
    const getFinancialProfile = vi.fn(async () => ({
      data: {
        debts: [],
        expectedMonthlyTakeHome: 5000,
        incomeStability: "stable",
        insurance: [{ status: "active" }],
        jurisdiction: "US",
        liquidReserves: 20000,
        preferences: { emergencyReserveMonths: 4 },
      },
    }));
    const service = createFinancePlaybookService({
      finances: { getFinancialProfile } as never,
      now: () => new Date("2026-08-30T12:00:00.000Z"),
    });

    await expect(service.get("11111111-1111-4111-8111-111111111111")).resolves.toMatchObject({
      assessment: { readiness: "on_track" },
      playbook: expect.objectContaining({ id: "nohmi-finance", owner: "nohmi-finance" }),
    });
  });

  it("scores the rubric from the current plan and stated income", async () => {
    const service = createFinancePlaybookService({
      finances: {
        getFinanceBudgetStatus: vi.fn(async () => ({
          planContext: {
            current: null,
            previous: { effectiveFrom: "2026-10", spendingTotal: 4_000, status: "active" },
            upcoming: { effectiveFrom: "2026-11", spendingTotal: 9_500, status: "proposed" },
          },
        })),
        getFinancialProfile: vi.fn(async () => ({
          data: {
            debts: [],
            expectedMonthlyTakeHome: 5_000,
            incomeStability: "stable",
            insurance: [{ kind: "health", status: "active" }],
            jurisdiction: "US",
            liquidReserves: 27_000,
            preferences: { emergencyReserveMonths: 6 },
          },
        })),
        getProfile: vi.fn(async () => ({ grossAnnualIncome: 90_000, monthlyHousingCost: 2_000 })),
      } as never,
      now: () => new Date("2026-11-13T12:00:00.000Z"),
    });

    const { assessment } = await service.get("11111111-1111-4111-8111-111111111111");
    expect(
      Object.fromEntries(assessment.rubric.map((item) => [item.id, item.status])),
    ).toMatchObject({
      housing_share: "healthy",
      plan_current: "gap",
      reserve_months: "healthy",
      spending_within_income: "healthy",
    });
  });

  it("keeps the profile assessment when plan and income reads fail", async () => {
    const service = createFinancePlaybookService({
      finances: {
        getFinanceBudgetStatus: vi.fn(async () => {
          throw new Error("budget unavailable");
        }),
        getFinancialProfile: vi.fn(async () => ({ data: null })),
        getProfile: vi.fn(async () => {
          throw new Error("profile unavailable");
        }),
      } as never,
      now: () => new Date("2026-11-13T12:00:00.000Z"),
    });

    const { assessment } = await service.get("11111111-1111-4111-8111-111111111111");
    expect(assessment.readiness).toBe("not_ready");
    expect(assessment.rubric.find((item) => item.id === "plan_current")?.status).toBe(
      "not_assessed",
    );
  });

  it.each([
    ["proposed", "watch", "the unapproved 2026-11 proposal"],
    ["incomplete", "not_assessed", null],
  ] as const)("uses a %s upcoming plan only as a disclosed fallback", async (status, expected, basis) => {
    const service = createFinancePlaybookService({
      finances: {
        getFinanceBudgetStatus: vi.fn(async () => ({
          planContext: {
            current: null,
            previous: null,
            upcoming: { effectiveFrom: "2026-11", spendingTotal: 4_800, status },
          },
        })),
        getFinancialProfile: vi.fn(async () => ({
          data: {
            debts: [],
            expectedMonthlyTakeHome: 5_000,
            incomeStability: "stable",
            insurance: [],
            jurisdiction: "US",
            liquidReserves: 1_000,
            preferences: { emergencyReserveMonths: null },
          },
        })),
        getProfile: vi.fn(async () => null),
      } as never,
      now: () => new Date("2026-11-13T12:00:00.000Z"),
    });
    const { assessment } = await service.get("11111111-1111-4111-8111-111111111111");
    const spending = assessment.rubric.find((item) => item.id === "spending_within_income");
    expect(spending?.status).toBe(expected);
    if (basis) expect(spending?.detail).toContain(basis);
  });
});
