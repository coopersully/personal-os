import { calendarEventOccursOnDate, normalizeProviderAllDayRange } from "./calendar-day.js";

describe("calendar dates", () => {
  it("keeps a date-only holiday on its source date in any viewing timezone", () => {
    const range = normalizeProviderAllDayRange("2026-10-12", "2026-10-13", "America/New_York");
    expect(range.startsAt.toISOString()).toBe("2026-10-12T04:00:00.000Z");
    const event = {
      allDay: true,
      startsAt: range.startsAt.toISOString(),
      endsAt: range.endsAt.toISOString(),
      timezone: "America/New_York",
    };
    for (const zone of ["America/New_York", "Pacific/Honolulu", "Asia/Tokyo"]) {
      for (const day of [11, 12, 13])
        expect(calendarEventOccursOnDate(event, { year: 2026, month: 10, day }, zone)).toBe(
          day === 12,
        );
    }
  });
  it("preserves exclusive multi-day ends across daylight saving changes", () => {
    const range = normalizeProviderAllDayRange("2026-10-31", "2026-11-03", "America/New_York");
    expect(range.endsAt.getTime() - range.startsAt.getTime()).toBe(73 * 3600000);
    const event = {
      allDay: true,
      startsAt: range.startsAt.toISOString(),
      endsAt: range.endsAt.toISOString(),
      timezone: "America/New_York",
    };
    expect(calendarEventOccursOnDate(event, { year: 2026, month: 11, day: 2 }, "UTC")).toBe(true);
    expect(calendarEventOccursOnDate(event, { year: 2026, month: 11, day: 3 }, "UTC")).toBe(false);
  });
  it("keeps locally created all-day ranges with a non-midnight end on their occupied dates", () => {
    const event = {
      allDay: true,
      startsAt: "2026-10-12T04:00:00Z",
      endsAt: "2026-10-13T03:59:00Z",
      timezone: "America/New_York",
    };
    for (const zone of ["America/New_York", "Asia/Tokyo"]) {
      for (const day of [11, 12, 13]) {
        expect(calendarEventOccursOnDate(event, { year: 2026, month: 10, day }, zone)).toBe(
          day === 12,
        );
      }
    }
  });
  it("uses instant overlap and exclusive midnight ends for timed appointments", () => {
    const event = {
      allDay: false,
      startsAt: "2026-10-12T03:00:00Z",
      endsAt: "2026-10-12T04:00:00Z",
      timezone: "UTC",
    };
    expect(
      calendarEventOccursOnDate(event, { year: 2026, month: 10, day: 11 }, "America/New_York"),
    ).toBe(true);
    expect(
      calendarEventOccursOnDate(event, { year: 2026, month: 10, day: 12 }, "America/New_York"),
    ).toBe(false);
  });
  it.each([
    ["2026-02-30", "2026-03-01"],
    ["2026-10-12", "2026-10-12"],
    ["bad", "2026-10-13"],
  ])("rejects invalid date ranges %s %s", (start, end) => {
    expect(() => normalizeProviderAllDayRange(start, end, "UTC")).toThrow();
  });
});
