// @vitest-environment jsdom
import type { CalendarEvent } from "@personal-os/domain";
import { calendarSearchResults, parseCalendarDateQuery } from "./floating-nav.js";

const event = {
  allDay: false,
  blockMode: null,
  blockSourceEventId: null,
  blocks: [],
  calendarId: "calendar-1",
  conferenceUrl: null,
  createdAt: "2026-08-23T12:00:00.000Z",
  endsAt: "2026-09-04T15:00:00.000Z",
  id: "event-1",
  location: "Studio",
  notes: "Review launch plan",
  provider: "local",
  recurrence: [],
  remoteEventId: null,
  startsAt: "2026-09-04T14:00:00.000Z",
  status: "confirmed",
  timezone: "UTC",
  title: "Design review",
  updatedAt: "2026-08-23T12:00:00.000Z",
  url: null,
} satisfies CalendarEvent;

describe("calendar floating navigation search", () => {
  it("resolves quick natural-language dates", () => {
    const now = new Date("2026-08-23T12:00:00.000Z");
    expect(parseCalendarDateQuery("last christmas", "UTC", now)?.date).toEqual({
      day: 25,
      month: 12,
      year: 2025,
    });
    expect(parseCalendarDateQuery("tomorrow", "UTC", now)?.date).toEqual({
      day: 24,
      month: 8,
      year: 2026,
    });
    expect(parseCalendarDateQuery(" yesterday ", "UTC", now)?.date).toEqual({
      day: 22,
      month: 8,
      year: 2026,
    });
    expect(parseCalendarDateQuery("today", "UTC", now)?.date).toEqual({
      day: 23,
      month: 8,
      year: 2026,
    });
    expect(parseCalendarDateQuery("next christmas", "UTC", now)?.date.year).toBe(2026);
    expect(
      parseCalendarDateQuery("last christmas", "UTC", new Date("2026-12-26T12:00:00.000Z"))?.date
        .year,
    ).toBe(2026);
    expect(
      parseCalendarDateQuery("next christmas", "UTC", new Date("2026-12-26T12:00:00.000Z"))?.date
        .year,
    ).toBe(2027);
    expect(parseCalendarDateQuery("2027-01-03", "UTC", now)?.date).toEqual({
      day: 3,
      month: 1,
      year: 2027,
    });
    expect(parseCalendarDateQuery("July 4", "UTC", now)?.date).toEqual({
      day: 4,
      month: 7,
      year: 2026,
    });
    expect(parseCalendarDateQuery("2/29/2028", "UTC", now)?.date).toEqual({
      day: 29,
      month: 2,
      year: 2028,
    });
    expect(parseCalendarDateQuery("13/1", "UTC", now)).toBeUndefined();
    expect(parseCalendarDateQuery("2026-02-31", "UTC", now)).toBeUndefined();
    expect(parseCalendarDateQuery("not a date", "UTC", now)).toBeUndefined();
  });

  it("searches event titles, notes, and locations", () => {
    expect(calendarSearchResults("launch", [event], "UTC")).toEqual([
      expect.objectContaining({ key: "event:event-1", label: "Design review" }),
    ]);
    expect(calendarSearchResults("studio", [event], "UTC")).toEqual([
      expect.objectContaining({ key: "event:event-1" }),
    ]);
    expect(calendarSearchResults("", [event], "UTC")).toEqual([]);
    expect(calendarSearchResults("design", [{ ...event, allDay: true }], "UTC")).toEqual([
      expect.objectContaining({ detail: "Sep 4, 2026", key: "event:event-1" }),
    ]);
    expect(
      calendarSearchResults("December 25", [{ ...event, location: null, notes: null }], "UTC").map(
        (result) => result.key,
      ),
    ).toEqual(["date:2026-12-25"]);
  });
});
