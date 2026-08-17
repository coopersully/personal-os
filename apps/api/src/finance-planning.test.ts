import { expect, it } from "vitest";
import { reliableMonthlyCapacity } from "./finance-planning.js";

it("uses the same cadence-aware net capacity for planning callers", () => {
  const input = {
    expectedNetPay: 4_000,
    expectedNetPayFrequency: "monthly",
    grossAnnualIncome: 90_000,
    observedMonthlyIncome: null,
    recurring: [{ amount: 100, cadence: "weekly" }],
  };
  expect(reliableMonthlyCapacity(input)).toBeCloseTo(3_566.67, 2);
});

it("normalizes biweekly expected take-home pay before planning capacity", () => {
  expect(
    reliableMonthlyCapacity({
      expectedNetPay: 2_000,
      expectedNetPayFrequency: "biweekly",
      grossAnnualIncome: null,
      observedMonthlyIncome: null,
      recurring: [],
    }),
  ).toBeCloseTo(4_333.33, 2);
});

it("does not treat partial month-to-date income as reliable monthly capacity", () => {
  expect(
    reliableMonthlyCapacity({
      expectedNetPay: 3_000,
      expectedNetPayFrequency: "monthly",
      grossAnnualIncome: null,
      observedMonthlyIncome: 400,
      observedIncomeWindow: { complete: false, days: 4 },
      recurring: [],
    }),
  ).toBe(3_000);
});

it("reserves an irregular recurring obligation instead of treating it as zero", () => {
  expect(
    reliableMonthlyCapacity({
      expectedNetPay: 3_000,
      expectedNetPayFrequency: "monthly",
      grossAnnualIncome: null,
      observedMonthlyIncome: null,
      recurring: [{ amount: 450, cadence: "irregular" }],
    }),
  ).toBe(2_550);
});

it("keeps status and budget writers aligned when ledger income is partial", () => {
  const profile = {
    expectedNetPay: 2_000,
    expectedNetPayFrequency: "biweekly",
    grossAnnualIncome: null,
    recurring: [{ amount: 100, cadence: "weekly" }],
  };
  const writerCapacity = reliableMonthlyCapacity({ ...profile, observedMonthlyIncome: null });
  const statusCapacity = reliableMonthlyCapacity({
    ...profile,
    observedMonthlyIncome: 500,
    observedIncomeWindow: { complete: false, days: 5 },
  });
  expect(statusCapacity).toBeCloseTo(writerCapacity ?? Number.NaN, 8);
});
