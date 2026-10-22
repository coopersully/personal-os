import { describe, expect, it } from "vitest";
import type { FinanceIncomeStream, FinanceRecurringObligation } from "../finance.js";
import { cashflowScheduleRange, projectFinanceCashflowSchedule } from "./cashflow-timeline.js";

const id = "11111111-1111-4111-8111-111111111111";
const accountId = "22222222-2222-4222-8222-222222222222";
const income: FinanceIncomeStream = {
  id,
  accountId,
  cadence: "semimonthly",
  confidence: 0.9,
  displayName: "Payroll",
  expectedAmount: 1000,
  lastObservedDate: "2026-01-15",
  nextExpectedDate: "2026-01-31",
  payer: "Employer",
  source: "user",
  status: "active",
};
const obligation: FinanceRecurringObligation = {
  ...income,
  id: accountId,
  displayName: "Membership",
  merchant: "Fictional service",
  kind: "subscription",
  cadence: "monthly",
  expectedAmount: 0,
  nextExpectedDate: null,
  status: "needs_review",
  source: "inferred",
};
const query = {
  from: "2026-01-01",
  to: "2026-02-28",
  timezone: "America/New_York",
  asOf: "2026-01-20T01:00:00Z",
};
const input = {
  ...query,
  income: [income],
  obligations: [obligation],
  accounts: [{ id: accountId, name: "Checking", currencyCode: "EUR" as string | null }],
};

describe("next expected Finance schedule", () => {
  it("preserves a single next expected source date, without inventing semimonthly anchors or actual history", () => {
    const view = projectFinanceCashflowSchedule(input);
    expect(view.dated).toHaveLength(1);
    expect(view.undated).toHaveLength(1);
    expect(view.dated[0]).toMatchObject({
      date: "2026-01-31",
      dateCertainty: "expected",
      currencyCode: "EUR",
      source: { kind: "income", id },
      sourceStatus: "active",
    });
    expect(view.undated[0]).toMatchObject({
      date: null,
      dateCertainty: "unknown",
      expectedAmount: 0,
      sourceStatus: "needs_review",
    });
    expect(view.coverage).toMatchObject({
      basis: "next_expected_only",
      recurrenceExpansion: "unavailable",
      matching: "unavailable",
    });
    expect(view.projection).toEqual({ state: "unavailable", reason: "balance_basis_unavailable" });
  });
  it.each([
    "2028-02-29",
    "2026-02-28",
    "2026-01-31",
    "2026-03-08",
  ])("keeps date-only %s unchanged across timezone and cadence boundaries", (date) => {
    const result = projectFinanceCashflowSchedule({
      ...input,
      from: date,
      to: date,
      timezone: "Pacific/Honolulu",
      income: [{ ...income, nextExpectedDate: date }],
    });
    expect(result.dated.map((i) => i.date)).toEqual([date]);
  });
  it("uses planning timezone for today and thirty local dates across DST", () => {
    expect(cashflowScheduleRange("2026-03-08T03:00:00Z", "America/New_York")).toEqual({
      from: "2026-03-07",
      to: "2026-04-05",
    });
    expect(projectFinanceCashflowSchedule({ ...input, asOf: "2026-01-20T01:00:00Z" }).today).toBe(
      "2026-01-19",
    );
  });
  it("excludes inactive records and labels past expected dates without asserting they remain unpaid", () => {
    const v = projectFinanceCashflowSchedule({
      ...input,
      income: [
        { ...income, nextExpectedDate: "2026-01-01" },
        { ...income, id: accountId, status: "paused" },
      ],
      obligations: [{ ...obligation, status: "cancelled" }],
    });
    expect(v.dated).toHaveLength(1);
    expect(v.dated[0]?.timing).toBe("past_expected");
    expect(v.undated).toEqual([]);
  });
  it("distinguishes omitted and empty account filters, and keeps unassigned items only in the all-record view", () => {
    expect(projectFinanceCashflowSchedule({ ...input, accountIds: [] }).dated).toEqual([]);
    expect(
      projectFinanceCashflowSchedule({
        ...input,
        accountIds: [accountId],
        obligations: [{ ...obligation, accountId: null }],
      }).undated,
    ).toEqual([]);
    expect(
      projectFinanceCashflowSchedule({
        ...input,
        obligations: [{ ...obligation, accountId: null }],
      }).undated,
    ).toHaveLength(1);
  });
  it("never supplies fallback currency for unresolved accounts and never includes outside-range dates as new occurrences", () => {
    const v = projectFinanceCashflowSchedule({ ...input, accounts: [], to: "2026-01-30" });
    expect(v.dated).toEqual([]);
    expect(v.coverage.outsideRangeCount).toBe(1);
    expect(v.undated[0]?.currencyCode).toBeNull();
    expect(v.generatedAt).toBe(query.asOf);
  });
  it.each([
    { from: "2026-02-30" },
    { to: "2025-01-01" },
    { timezone: "Unknown/Zone" },
    { to: "2030-01-01" },
    { accountIds: [accountId, accountId] },
  ])("rejects invalid range/timezone/filter %j", (change) => {
    expect(() => projectFinanceCashflowSchedule({ ...input, ...change })).toThrow();
  });
  it("rejects duplicate source identities rather than showing the same marker twice", () => {
    expect(() => projectFinanceCashflowSchedule({ ...input, income: [income, income] })).toThrow(
      /duplicate/i,
    );
  });
});
