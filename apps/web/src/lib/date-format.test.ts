import { describe, expect, it } from "vitest";
import {
  formatMaterialDateTime,
  formatOrdinalDate,
  formatRelativeMaterialDateTime,
  ordinalSuffix,
} from "./date-format.js";

describe("ordinalSuffix", () => {
  it("uses English ordinal suffixes, including teen exceptions", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31].map(ordinalSuffix)).toEqual([
      "st",
      "nd",
      "rd",
      "th",
      "th",
      "th",
      "th",
      "st",
      "nd",
      "rd",
      "st",
    ]);
  });

  it("formats a time-zone aware long date", () => {
    expect(formatOrdinalDate(new Date("2026-07-13T12:00:00.000Z"), "UTC")).toBe(
      "Monday, July 13th",
    );
    expect(formatMaterialDateTime("2026-07-13T12:05:00.000Z", "UTC")).toBe("Jul 13, 12:05 PM");
    expect(formatMaterialDateTime("2026-07-13T12:05:00.000Z", "UTC", { includeYear: true })).toBe(
      "Jul 13, 2026, 12:05 PM",
    );
  });

  it("uses nearby relative dates in the requested time zone", () => {
    const now = new Date("2026-08-31T16:00:00.000Z");

    expect(formatRelativeMaterialDateTime("2026-08-30T17:00:00.000Z", "UTC", { now })).toBe(
      "Yesterday, 5:00 PM",
    );
    expect(formatRelativeMaterialDateTime("2026-08-31T18:00:00.000Z", "UTC", { now })).toBe(
      "Today, 6:00 PM",
    );
    expect(formatRelativeMaterialDateTime("2026-09-01T13:00:00.000Z", "UTC", { now })).toBe(
      "Tomorrow, 1:00 PM",
    );
    expect(formatRelativeMaterialDateTime("2026-09-03T13:00:00.000Z", "UTC", { now })).toBe(
      "in 3 days, 1:00 PM",
    );
    expect(formatRelativeMaterialDateTime("2026-09-14T13:00:00.000Z", "UTC", { now })).toBe(
      "in 14 days, 1:00 PM",
    );
    expect(formatRelativeMaterialDateTime("2026-08-24T13:00:00.000Z", "UTC", { now })).toBe(
      "7 days ago, 1:00 PM",
    );
  });
});
