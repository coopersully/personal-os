import { describe, expect, it } from "vitest";
import {
  cadenceFromDates,
  forecastCashflow,
  obsoleteMissingAlertIds,
  selectEffectiveRecord,
} from "./finance-cashflow.js";

describe("finance cash-flow rules", () => {
  it("selects only the latest profile effective on the requested day", () => {
    expect(
      selectEffectiveRecord(
        [
          { effectiveDate: "2026-07-01", employer: "Current employer" },
          { effectiveDate: "2026-08-01", employer: "Future employer" },
        ],
        "2026-07-19",
      ),
    ).toEqual({ effectiveDate: "2026-07-01", employer: "Current employer" });
  });

  it("uses the lowest dated balance instead of the balance after the next paycheck", () => {
    expect(
      forecastCashflow({
        asOf: "2026-07-19T12:00:00.000Z",
        cash: 100,
        horizon: "2026-07-26",
        income: [{ amount: 1_000, date: "2026-07-26", kind: "income" }],
        obligations: [{ amount: 500, date: "2026-07-20", kind: "obligation" }],
      }),
    ).toMatchObject({
      lowestBalance: -400,
      lowestDate: "2026-07-20",
      projectedBalance: 600,
      upcomingIncome: 1_000,
      upcomingObligations: 500,
    });
  });

  it("reserves same-day obligations before income arrives", () => {
    expect(
      forecastCashflow({
        asOf: "2026-07-19T12:00:00.000Z",
        cash: 100,
        horizon: "2026-07-20",
        income: [{ amount: 500, date: "2026-07-20", kind: "income" }],
        obligations: [{ amount: 300, date: "2026-07-20", kind: "obligation" }],
      }),
    ).toMatchObject({ lowestBalance: -200, lowestDate: "2026-07-20", projectedBalance: 300 });
  });

  it("closes missing alerts when the refreshed schedule is no longer overdue", () => {
    expect(
      obsoleteMissingAlertIds({
        alerts: [
          {
            id: "income-alert",
            incomeStreamId: "income-stream",
            recurringObligationId: null,
            type: "income_missing",
          },
          {
            id: "bill-alert",
            incomeStreamId: null,
            recurringObligationId: "bill",
            type: "recurring_missing",
          },
        ],
        incomeStreams: [{ id: "income-stream", nextExpectedDate: "2026-08-02", status: "active" }],
        obligations: [{ id: "bill", nextExpectedDate: "2026-07-15", status: "active" }],
        today: "2026-07-19",
      }),
    ).toEqual(["income-alert"]);
  });

  it("preserves the conservative cadence thresholds", () => {
    expect(
      cadenceFromDates(["2026-06-05", "2026-06-19", "2026-07-03", "2026-07-17"]),
    ).toMatchObject({
      cadence: "biweekly",
      regular: true,
    });
  });
});
