import { describe, expect, it } from "vitest";
import {
  expandRecurringOccurrences,
  type RecurringScheduleEvidence,
} from "./recurring-occurrences.js";

const schedule = (changes: Partial<RecurringScheduleEvidence> = {}): RecurringScheduleEvidence => ({
  scheduleVersionId: "version-1",
  sourceId: "bill-1",
  sourceRevision: 1,
  confirmed: true,
  timezone: "America/New_York",
  currencyCode: "USD",
  amountCents: 1001,
  anchorLocalDate: "2028-01-31",
  cadence: "monthly",
  sourceReferences: ["user-confirmation:1"],
  ...changes,
});
const range = { fromLocalDate: "2028-01-01", toLocalDate: "2028-04-30" };
describe("expandRecurringOccurrences", () => {
  it("clamps leap months retaining the original day and exact evidence", () => {
    const input = schedule();
    const result = expandRecurringOccurrences(input, range);
    expect(result.occurrences.map((o) => o.localDate)).toEqual([
      "2028-01-31",
      "2028-02-29",
      "2028-03-31",
      "2028-04-30",
    ]);
    expect(result.occurrences[0]).toMatchObject({
      amountCents: 1001,
      sourceId: "bill-1",
      sourceRevision: 1,
      scheduleVersionId: "version-1",
      certainty: "expected",
      timezone: "America/New_York",
      sourceReferences: ["user-confirmation:1"],
    });
    expect(result.occurrences[0]?.sourceReferences).not.toBe(input.sourceReferences);
  });
  it.each([
    ["weekly", ["2028-03-05", "2028-03-12", "2028-03-19"]],
    ["biweekly", ["2028-03-05", "2028-03-19"]],
  ] as const)("uses date-only %s steps across DST", (cadence, expected) => {
    expect(
      expandRecurringOccurrences(schedule({ cadence, anchorLocalDate: "2028-03-05" }), {
        fromLocalDate: "2028-03-05",
        toLocalDate: "2028-03-19",
      }).occurrences.map((o) => o.localDate),
    ).toEqual(expected);
  });
  it("uses original quarterly and yearly anchors", () => {
    expect(
      expandRecurringOccurrences(schedule({ cadence: "quarterly" }), {
        fromLocalDate: "2028-02-01",
        toLocalDate: "2028-10-31",
      }).occurrences.map((o) => o.localDate),
    ).toEqual(["2028-04-30", "2028-07-31", "2028-10-31"]);
    expect(
      expandRecurringOccurrences(schedule({ cadence: "yearly", anchorLocalDate: "2028-02-29" }), {
        fromLocalDate: "2029-01-01",
        toLocalDate: "2029-12-31",
      }).occurrences.map((o) => o.localDate),
    ).toEqual(["2029-02-28"]);
  });
  it("keeps independently clamped semimonthly slots and stable identities", () => {
    const input = schedule({ cadence: "semimonthly", semimonthlyDays: [31, 30] });
    const wide = expandRecurringOccurrences(input, range);
    const narrow = expandRecurringOccurrences(
      { ...input, semimonthlyDays: [30, 31] },
      { fromLocalDate: "2028-02-29", toLocalDate: "2028-02-29" },
    );
    expect(narrow.occurrences.map((o) => o.slot)).toEqual([0, 1]);
    expect(narrow.occurrences).toEqual(
      wide.occurrences.filter((o) => o.localDate === "2028-02-29"),
    );
    expect(new Set(narrow.occurrences.map((o) => o.id)).size).toBe(2);
    const revised = expandRecurringOccurrences(
      { ...input, scheduleVersionId: "version-2", sourceRevision: 2 },
      range,
    );
    expect(revised.occurrences[0]?.id).not.toBe(wide.occurrences[0]?.id);
  });
  it.each([
    [{ confirmed: false }, "unconfirmed_schedule"],
    [{ cadence: "unknown" }, "unknown_cadence"],
    [{ cadence: "irregular" }, "irregular_cadence"],
    [{ anchorLocalDate: null }, "missing_anchor"],
    [{ cadence: "semimonthly" }, "missing_semimonthly_days"],
  ] satisfies [
    Partial<RecurringScheduleEvidence>,
    string,
  ][])("reports unsupported schedule %j without fabrication", (changes, reason) => {
    expect(expandRecurringOccurrences(schedule(changes), range)).toEqual({
      status: "unavailable",
      reason,
      occurrences: [],
    });
  });
  it("does not expand before an explicit anchor and supports historical/calendar bounds", () => {
    expect(
      expandRecurringOccurrences(schedule({ anchorLocalDate: "2029-01-01" }), range).occurrences,
    ).toEqual([]);
    expect(
      expandRecurringOccurrences(schedule({ anchorLocalDate: "1900-01-31" }), {
        fromLocalDate: "1900-02-01",
        toLocalDate: "1900-03-31",
      }).occurrences.map((o) => o.localDate),
    ).toEqual(["1900-02-28", "1900-03-31"]);
    expect(
      expandRecurringOccurrences(schedule({ anchorLocalDate: "9999-12-31" }), {
        fromLocalDate: "9999-12-01",
        toLocalDate: "9999-12-31",
      }).occurrences.map((o) => o.localDate),
    ).toEqual(["9999-12-31"]);
    expect(
      expandRecurringOccurrences(
        schedule({ anchorLocalDate: "2028-01-01", amountCents: 0, currencyCode: "EUR" }),
        { fromLocalDate: "2028-01-01", toLocalDate: "2028-12-31" },
      ).occurrences[0]?.amountCents,
    ).toBe(0);
  });
  it.each([
    { fromLocalDate: "2028-01-01", toLocalDate: "2029-01-01" },
    { fromLocalDate: "2028-02-02", toLocalDate: "2028-02-01" },
    { fromLocalDate: "2027-02-29", toLocalDate: "2028-01-01" },
    { fromLocalDate: "0000-01-01", toLocalDate: "0000-01-01" },
  ])("rejects invalid query ranges %j", (query) => {
    expect(() => expandRecurringOccurrences(schedule(), query)).toThrow(RangeError);
  });
  it.each([
    { timezone: "Mars/Olympus" },
    { timezone: "" },
    { currencyCode: "JPY" },
    { currencyCode: "KWD" },
    { currencyCode: "ZZZ" },
    { currencyCode: "usd" },
    { amountCents: 1.5 },
    { amountCents: NaN },
    { amountCents: -1 },
    { amountCents: 10_000_000_001 },
    { sourceRevision: 0 },
    { scheduleVersionId: " " },
    { sourceId: "" },
    { anchorLocalDate: "2028-02-30" },
    { sourceReferences: [""] },
    { cadence: "semimonthly", semimonthlyDays: [15, 15] },
    { cadence: "semimonthly", semimonthlyDays: [0, 31] },
    { cadence: "semimonthly", semimonthlyDays: [1, 32] },
    { cadence: "semimonthly", semimonthlyDays: [1.5, 15] },
  ] satisfies Partial<RecurringScheduleEvidence>[])("rejects invalid evidence %j", (changes) => {
    expect(() => expandRecurringOccurrences(schedule(changes), range)).toThrow(RangeError);
  });
});
