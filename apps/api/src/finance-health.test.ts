import { assessFinanceHealth, type FinanceHealthInput } from "./finance-health.js";

const now = new Date("2026-08-15T12:00:00.000Z");

function input(overrides: Partial<FinanceHealthInput> = {}): FinanceHealthInput {
  return {
    accounts: [
      {
        balance: 9_000,
        kind: "cash",
        lastSuccessAt: "2026-08-15T11:00:00.000Z",
        provider: "plaid",
        synchronizationState: "current",
      },
    ],
    activeGoalCount: 1,
    approvedBudget: 1_000,
    forecastSpending: 1_040,
    investmentAllocationKnown: true,
    monthlyIncome: 4_000,
    postedTransactions: [],
    totalDebt: 0,
    unknownDebtAprCount: 0,
    ...overrides,
  };
}

describe("Finance health assessment", () => {
  it("rates a month unknown without an approved budget", () => {
    expect(assessFinanceHealth(input({ approvedBudget: null }), now).month.rating).toBe("unknown");
  });

  it("reports insufficient confidence when every Plaid account is blocked", () => {
    const health = assessFinanceHealth(
      input({
        accounts: [
          {
            balance: null,
            kind: "cash",
            lastSuccessAt: null,
            provider: "plaid",
            synchronizationState: "blocked",
          },
        ],
      }),
      now,
    );

    expect(health.confidence).toBe("insufficient");
    expect(health.month.rating).toBe("unknown");
  });

  function provisionalHealth() {
    return assessFinanceHealth(
      input({
        accounts: [
          ...input().accounts,
          {
            balance: 500,
            kind: "cash",
            lastSuccessAt: "2026-08-13T11:00:00.000Z",
            provider: "plaid",
            synchronizationState: "stale",
          },
        ],
      }),
      now,
    );
  }

  it("keeps current-month evidence unknown when confidence is provisional", () => {
    const health = provisionalHealth();

    expect(health.confidence).toBe("provisional");
    expect(health.month).toMatchObject({
      forecastSpending: null,
      postedSpending: null,
      rating: "unknown",
    });
    expect(health.missingInputs).toContain("current_account_evidence");
  });

  it.each([
    "borrow",
    "invest",
    "plan",
    "save",
    "spend",
  ] as const)("keeps the %s dimension unknown when confidence is provisional", (dimension) => {
    const health = provisionalHealth();

    expect(health.confidence).toBe("provisional");
    expect(health.dimensions[dimension]).toMatchObject({
      missingInputs: expect.arrayContaining(["current_account_evidence"]),
      rating: "unknown",
    });
  });

  it("treats manual current state as authoritative without a provider sync timestamp", () => {
    expect(
      assessFinanceHealth(
        input({
          accounts: [
            {
              balance: 500,
              kind: "cash",
              lastSuccessAt: null,
              provider: "manual",
              synchronizationState: "current",
            },
          ],
        }),
        now,
      ).confidence,
    ).toBe("reliable");
  });

  it("does not invent cash reserves for a current account without a balance", () => {
    const health = assessFinanceHealth(
      input({
        accounts: [
          {
            balance: null,
            kind: "cash",
            lastSuccessAt: null,
            provider: "manual",
            synchronizationState: "current",
          },
        ],
      }),
      now,
    );

    expect(health.dimensions.save.rating).toBe("unknown");
  });

  it.each([
    [1.04, "on_track"],
    [1.1, "watch"],
    [1.16, "off_track"],
  ] as const)("rates forecast ratio %s as %s", (ratio, rating) => {
    expect(assessFinanceHealth(input({ forecastSpending: 1_000 * ratio }), now).month.rating).toBe(
      rating,
    );
  });

  it("excludes pending and transfer activity from posted spending", () => {
    const health = assessFinanceHealth(
      input({
        forecastSpending: null,
        postedTransactions: [
          { amount: 800, direction: "expense", pending: false },
          { amount: 500, direction: "expense", pending: true },
          { amount: 900, direction: "transfer", pending: false },
        ],
      }),
      now,
    );

    expect(health.month).toMatchObject({ postedSpending: 800, rating: "on_track" });
  });

  it("keeps unknown debt APR and investment allocation as missing evidence", () => {
    const health = assessFinanceHealth(
      input({ investmentAllocationKnown: false, totalDebt: 12_000, unknownDebtAprCount: 1 }),
      now,
    );

    expect(health.dimensions.borrow).toMatchObject({
      missingInputs: expect.arrayContaining(["debt_apr"]),
      rating: "unknown",
    });
    expect(health.dimensions.invest).toMatchObject({
      missingInputs: expect.arrayContaining(["investment_allocation"]),
      rating: "unknown",
    });
  });

  it("does not rate borrowing healthy when total debt is unknown", () => {
    expect(assessFinanceHealth(input({ totalDebt: null }), now).dimensions.borrow.rating).toBe(
      "unknown",
    );
  });

  it("discloses unavailable account-role evidence in every affected dimension", () => {
    const health = assessFinanceHealth(input(), now);

    expect(health.missingInputs).toContain("account_roles");
    for (const key of ["borrow", "invest", "plan", "save", "spend"] as const) {
      expect(health.dimensions[key].missingInputs).toContain("account_roles");
    }
    expect(health.dimensions.goals.missingInputs).not.toContain("account_roles");
  });

  it("uses approved profile thresholds and reserve targets", () => {
    const health = assessFinanceHealth(
      input({
        forecastSpending: 1_080,
        profile: {
          budgetOffTrackForecastRatio: 1.3,
          budgetWatchForecastRatio: 1.1,
          emergencyReserveTargetMonths: 2,
        },
        totalDebt: 100,
      }),
      now,
    );

    expect(health.month.rating).toBe("on_track");
    expect(health.dimensions.borrow.rating).toBe("watch");
    expect(health.dimensions.save.rating).toBe("healthy");
  });
});
