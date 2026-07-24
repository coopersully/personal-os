// @vitest-environment jsdom
import { formatRelativeTime } from "../../lib/time-format.js";

describe("Mail feature helpers", () => {
  it("formats relative minutes, hours, and days", () => {
    const now = new Date("2026-07-13T12:00:00.000Z").getTime();
    expect(formatRelativeTime("2026-07-13T12:05:00.000Z", now)).toContain("in 5 minutes");
    expect(formatRelativeTime("2026-07-13T14:00:00.000Z", now)).toContain("in 2 hours");
    expect(formatRelativeTime("2026-07-15T12:00:00.000Z", now)).toContain("in 2 days");
  });
});
