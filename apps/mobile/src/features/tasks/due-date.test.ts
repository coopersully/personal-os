import { describe, expect, it } from "vitest";
import { isPastDue, relativeDueDate } from "./due-date";

describe("due date presentation and shortcuts", () => {
  it("marks only actual past timestamps overdue", () => {
    const now = Date.parse("2026-11-06T15:00:00Z");
    expect(isPastDue("2026-11-06T14:59:59Z", now)).toBe(true);
    expect(isPastDue("2026-11-06T15:00:00Z", now)).toBe(false);
    expect(isPastDue(null, now)).toBe(false);
    expect(isPastDue("invalid", now)).toBe(false);
  });
  it("extends from now rather than adding days to the overdue deadline", () => {
    const now = new Date("2026-11-06T15:00:00Z");
    expect(relativeDueDate("hour", "America/New_York", now)).toBe("2026-11-06T16:00:00.000Z");
    expect(relativeDueDate("tomorrow", "America/New_York", now)).toBe("2026-11-07T14:00:00.000Z");
  });
  it("preserves 9 AM in the account timezone across DST and calendar rollover", () => {
    expect(relativeDueDate("week", "America/New_York", new Date("2026-10-31T15:00:00Z"))).toBe(
      "2026-11-07T14:00:00.000Z",
    );
    expect(relativeDueDate("tomorrow", "Pacific/Auckland", new Date("2026-12-31T15:00:00Z"))).toBe(
      "2027-01-01T20:00:00.000Z",
    );
  });
});
