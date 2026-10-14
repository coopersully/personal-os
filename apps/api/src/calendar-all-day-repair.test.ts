import { repairCalendarAllDayRange } from "./calendar-all-day-repair.js";

describe("legacy calendar date repair", () => {
  const record = {
    allDay: true,
    provider: "google",
    timezone: "America/New_York",
    startsAt: new Date("2026-10-12T00:00:00Z"),
    endsAt: new Date("2026-10-13T00:00:00Z"),
    raw: { start: { date: "2026-10-12" }, end: { date: "2026-10-13" } },
  };
  it("repairs from authoritative source dates without mutating the stored source", () => {
    const result = repairCalendarAllDayRange(record);
    expect(result).toEqual({
      startsAt: new Date("2026-10-12T04:00:00Z"),
      endsAt: new Date("2026-10-13T04:00:00Z"),
    });
    expect(record.startsAt.toISOString()).toBe("2026-10-12T00:00:00.000Z");
    expect(repairCalendarAllDayRange({ ...record, ...result })).toEqual(result);
  });
  it.each([
    { allDay: false },
    { provider: "local" },
    { raw: null },
    { raw: { start: { date: "bad" }, end: { date: "2026-10-13" } } },
  ])("never guesses without usable provider evidence: %j", (patch) => {
    const value = { ...record, ...patch };
    expect(repairCalendarAllDayRange(value)).toEqual({
      startsAt: value.startsAt,
      endsAt: value.endsAt,
    });
  });
});
