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

  it.each([
    [["2026-07-01", "2026-07-08", "2026-07-15"], "weekly", true],
    [["2026-06-05", "2026-06-19", "2026-07-03", "2026-07-17"], "biweekly", true],
    [["2026-01-01", "2026-02-01", "2026-03-01"], "monthly", true],
    [["2026-01-01", "2026-04-01", "2026-07-01"], "quarterly", true],
    [["2024-01-01", "2025-01-01", "2026-01-01"], "yearly", true],
    [["2026-01-01", "2026-01-03", "2026-02-20"], "irregular", false],
    [["2026-01-01", "2026-01-21", "2026-03-02"], "monthly", false],
  ])("classifies %j as %s", (dates, cadence, regular) => {
    expect(cadenceFromDates(dates)).toMatchObject({ cadence, regular });
  });

  it("requires three distinct dates before inferring a cadence", () => {
    expect(cadenceFromDates(["2026-07-01", "2026-07-01", "2026-07-08"])).toBeNull();
  });

  it("omits undated and out-of-range events when no forecast horizon is available", () => {
    expect(
      forecastCashflow({
        asOf: "2026-07-19T12:00:00.000Z",
        cash: 100,
        horizon: null,
        income: [
          { amount: 25, date: null, kind: "income" },
          { amount: 50, date: "2026-07-18", kind: "income" },
          { amount: 75, date: "2026-07-20", kind: "income" },
          { amount: 25, date: "2026-07-20", kind: "income" },
        ],
        obligations: [{ amount: 40, date: "2026-07-21", kind: "obligation" }],
      }),
    ).toEqual({
      lowestBalance: 100,
      lowestDate: null,
      projectedBalance: null,
      upcomingIncome: 100,
      upcomingObligations: 40,
    });
  });

  it("ignores activity beyond a bounded forecast horizon", () => {
    expect(
      forecastCashflow({
        asOf: "2026-07-19T12:00:00.000Z",
        cash: 100,
        horizon: "2026-07-20",
        income: [{ amount: 500, date: "2026-07-21", kind: "income" }],
        obligations: [],
      }),
    ).toMatchObject({ projectedBalance: 100, upcomingIncome: 0 });
  });

  it("closes alerts with missing, inactive, or unrelated schedules", () => {
    expect(
      obsoleteMissingAlertIds({
        alerts: [
          {
            id: "missing-income",
            incomeStreamId: null,
            recurringObligationId: null,
            type: "income_missing",
          },
          {
            id: "missing-bill",
            incomeStreamId: null,
            recurringObligationId: null,
            type: "recurring_missing",
          },
          {
            id: "inactive-income",
            incomeStreamId: "inactive",
            recurringObligationId: null,
            type: "income_missing",
          },
          {
            id: "other",
            incomeStreamId: null,
            recurringObligationId: null,
            type: "other",
          },
        ],
        incomeStreams: [{ id: "inactive", nextExpectedDate: null, status: "paused" }],
        obligations: [],
        today: "2026-07-19",
      }),
    ).toEqual(["missing-income", "missing-bill", "inactive-income", "other"]);
  });
});
