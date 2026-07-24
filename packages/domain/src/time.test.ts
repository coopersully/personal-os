import { describe, expect, it } from "vitest";
import {
  formatDateWithOrdinal,
  localDateToIso,
  parseLocalDate,
  sameLocalDate,
  startOfLocalWeek,
} from "./time.js";

describe("formatDateWithOrdinal", () => {
  it.each([
    ["2026-06-01", "June 1st"],
    ["2026-06-02", "June 2nd"],
    ["2026-06-03", "June 3rd"],
    ["2026-06-04", "June 4th"],
    ["2026-06-11", "June 11th"],
    ["2026-06-12", "June 12th"],
    ["2026-06-13", "June 13th"],
    ["2026-06-21", "June 21st"],
    ["2026-06-22", "June 22nd"],
    ["2026-06-23", "June 23rd"],
  ])("formats %s as %s", (value, expected) => {
    expect(formatDateWithOrdinal(value)).toBe(expected);
  });
});

describe("local calendar date helpers", () => {
  it("preserves calendar date keys without applying a viewer timezone", () => {
    const date = { day: 6, month: 7, year: 2026 };
    expect(localDateToIso(date)).toBe("2026-07-06");
    expect(parseLocalDate("2026-07-06")).toEqual(date);
  });

  it("compares and starts local weeks using calendar semantics", () => {
    expect(sameLocalDate({ day: 6, month: 7, year: 2026 }, { day: 6, month: 7, year: 2026 })).toBe(
      true,
    );
    expect(startOfLocalWeek({ day: 8, month: 7, year: 2026 })).toEqual({
      day: 5,
      month: 7,
      year: 2026,
    });
  });
});
