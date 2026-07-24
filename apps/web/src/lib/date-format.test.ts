import { describe, expect, it } from "vitest";
import { formatOrdinalDate, ordinalSuffix } from "./date-format.js";

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
  });
});
