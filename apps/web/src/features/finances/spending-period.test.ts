import { describe, expect, it } from "vitest";
import { moveSpendingPeriod, spendingPeriod, spendingToday } from "./spending-period";

describe("Spending calendar periods", () => {
  it("uses saved time zone around a UTC date boundary", () => {
    expect(spendingToday("America/New_York", new Date("2026-03-09T01:00:00Z"))).toBe("2026-03-08");
  });
  it("keeps local calendar weeks across DST with configured week start", () => {
    expect(spendingPeriod("week", "2026-03-08", "monday")).toEqual({
      from: "2026-03-02",
      through: "2026-03-08",
    });
    expect(spendingPeriod("week", "2026-11-01", "sunday")).toEqual({
      from: "2026-11-01",
      through: "2026-11-07",
    });
  });
  it("moves month ends without skipping February", () => {
    expect(moveSpendingPeriod("month", "2028-01-31", 1)).toBe("2028-02-01");
    expect(spendingPeriod("month", "2028-02-01", "monday")).toEqual({
      from: "2028-02-01",
      through: "2028-02-29",
    });
  });
  it("retains exact custom date-only boundaries", () => {
    expect(spendingPeriod("custom", "2026-03-08", "sunday", "2026-11-01")).toEqual({
      from: "2026-03-08",
      through: "2026-11-01",
    });
  });
});
