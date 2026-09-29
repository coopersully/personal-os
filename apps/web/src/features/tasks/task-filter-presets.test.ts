import { describe, expect, it } from "vitest";
import { identifyPreset, presetBounds } from "./task-filter-presets";

describe("task date presets", () => {
  it.each([
    ["2026-03-08T12:00:00Z", "2026-03-08T05:00:00.000Z", "2026-03-09T03:59:59.999Z"],
    ["2026-11-01T12:00:00Z", "2026-11-01T04:00:00.000Z", "2026-11-02T04:59:59.999Z"],
  ])("uses local calendar boundaries across daylight saving on %s", (now, after, before) => {
    expect(presetBounds("today", "America/New_York", new Date(now))).toEqual({ after, before });
  });
  it("handles midnight and year rollover in the planning timezone", () => {
    expect(
      presetBounds("tomorrow", "America/Los_Angeles", new Date("2027-01-01T02:00:00Z")),
    ).toEqual({
      after: "2027-01-01T08:00:00.000Z",
      before: "2027-01-02T07:59:59.999Z",
    });
  });
  it("keeps preset recognition lossless and distinguishes custom bounds", () => {
    const now = new Date("2026-09-03T12:00:00Z");
    for (const value of ["any", "today", "tomorrow", "next-seven"] as const) {
      const bounds = presetBounds(value, "UTC", now);
      expect(identifyPreset(bounds, "UTC", now)).toBe(value);
    }
    expect(presetBounds("next-seven", "UTC", now)).toEqual({
      after: "2026-09-03T00:00:00.000Z",
      before: "2026-09-09T23:59:59.999Z",
    });
    expect(identifyPreset({ after: "2026-09-03T01:00:00Z", before: "" }, "UTC", now)).toBe(
      "custom",
    );
  });
});
