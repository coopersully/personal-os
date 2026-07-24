import { describe, expect, it } from "vitest";
import { formatRelativeTime } from "./time-format.js";

describe("formatRelativeTime", () => {
  it("formats minutes, hours, and days from a supplied clock", () => {
    const now = new Date("2026-07-13T12:00:00.000Z").getTime();
    expect(formatRelativeTime("2026-07-13T12:05:00.000Z", now)).toContain("in 5 minutes");
    expect(formatRelativeTime("2026-07-13T14:00:00.000Z", now)).toContain("in 2 hours");
    expect(formatRelativeTime("2026-07-15T12:00:00.000Z", now)).toContain("in 2 days");
  });
});
