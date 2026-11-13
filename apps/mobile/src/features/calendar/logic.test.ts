import type { Calendar, CalendarEvent } from "@personal-os/domain";
import { describe, expect, it } from "vitest";
import {
  agendaSections,
  attendeeLabel,
  calendarFreshness,
  calendarRange,
  calendarSourceLabel,
  dayEvents,
  eventOccursOnDay,
  eventTimeLabel,
  eventWhenLabel,
  formatDay,
  formatHour,
  layoutDayEvents,
  reminderLabel,
  timelineHours,
  timeZoneName,
  weekDays,
} from "./logic";

const zone = "America/New_York";
const friday = { day: 13, month: 11, year: 2026 };
const saturday = { day: 14, month: 11, year: 2026 };
function event(id: string, startsAt: string, endsAt: string, extra: Partial<CalendarEvent> = {}) {
  return {
    id,
    title: id,
    startsAt,
    endsAt,
    allDay: false,
    provider: "google",
    calendarId: "work",
    timezone: zone,
    status: "confirmed",
    recurrence: [],
    ...extra,
  } as CalendarEvent;
}
const standup = event("standup", "2026-11-13T14:00:00.000Z", "2026-11-13T14:30:00.000Z");
const review = event("review", "2026-11-13T14:15:00.000Z", "2026-11-13T15:15:00.000Z");
const lunch = event("lunch", "2026-11-13T17:00:00.000Z", "2026-11-13T18:00:00.000Z");
const overnight = event("overnight", "2026-11-14T04:00:00.000Z", "2026-11-14T06:00:00.000Z");
const holiday = event("holiday", "2026-11-13T00:00:00.000Z", "2026-11-14T00:00:00.000Z", {
  allDay: true,
});
const trip = event("trip", "2026-11-13T00:00:00.000Z", "2026-11-16T00:00:00.000Z", {
  allDay: true,
});
const localDayOff = event("day off", "2026-11-13T05:00:00.000Z", "2026-11-14T05:00:00.000Z", {
  allDay: true,
  provider: "local",
});
function calendar(extra: Partial<Calendar> = {}) {
  return {
    id: "work",
    name: "Work",
    provider: "google",
    color: null,
    isSelected: true,
    isWritable: true,
    lastSyncedAt: "2026-11-13T14:41:00.000Z",
    source: {
      accountLabel: "work@example.test",
      health: { state: "ready", message: null, nextSyncAt: null, recovery: null },
      remoteCalendarId: "primary",
      syncError: null,
      syncStatus: "idle",
    },
    ...extra,
  } as Calendar;
}

describe("calendar day model", () => {
  it("bounds a week and a local-day range in the account timezone", () => {
    expect(weekDays(friday).map((day) => day.day)).toEqual([8, 9, 10, 11, 12, 13, 14]);
    expect(weekDays(friday, "monday").map((day) => day.day)).toEqual([9, 10, 11, 12, 13, 14, 15]);
    // A Sunday belongs to the Monday-first week that began six days earlier.
    expect(weekDays({ day: 15, month: 11, year: 2026 }, "monday")[0]?.day).toBe(9);
    expect(weekDays({ day: 9, month: 11, year: 2026 }, "monday")[0]?.day).toBe(9);
    expect(calendarRange(friday, 1, zone)).toEqual({
      from: "2026-11-13T05:00:00.000Z",
      to: "2026-11-14T05:00:00.000Z",
    });
  });

  it("keeps provider all-day events on their calendar date, not their UTC instants", () => {
    expect(eventOccursOnDay(holiday, friday, zone)).toBe(true);
    expect(eventOccursOnDay(holiday, { ...friday, day: 12 }, zone)).toBe(false);
    expect(eventOccursOnDay(holiday, saturday, zone)).toBe(false);
    expect(eventOccursOnDay(trip, { ...friday, day: 15 }, zone)).toBe(true);
    expect(eventOccursOnDay(trip, { ...friday, day: 16 }, zone)).toBe(false);
    expect(eventOccursOnDay(localDayOff, friday, zone)).toBe(true);
    expect(eventOccursOnDay(localDayOff, saturday, zone)).toBe(false);
  });

  it("separates all-day events from the timeline and orders them", () => {
    const day = dayEvents([lunch, trip, standup, holiday, localDayOff, overnight], friday, zone);
    expect(day.allDay.map((item) => item.id)).toEqual(["holiday", "trip", "day off"]);
    expect(day.timed.map((item) => item.event.id)).toEqual(["standup", "lunch", "overnight"]);
    expect(dayEvents([standup], saturday, zone)).toEqual({ allDay: [], timed: [] });
  });

  it("places overlapping events in side-by-side columns and releases the cluster afterwards", () => {
    expect(
      layoutDayEvents([lunch, review, standup], friday, zone).map((layout) => ({
        ...layout,
        event: layout.event.id,
      })),
    ).toEqual([
      { event: "standup", startMinute: 540, endMinute: 570, column: 0, columns: 2 },
      { event: "review", startMinute: 555, endMinute: 615, column: 1, columns: 2 },
      { event: "lunch", startMinute: 720, endMinute: 780, column: 0, columns: 1 },
    ]);
    const after = event("after", "2026-11-13T14:30:00.000Z", "2026-11-13T14:45:00.000Z");
    const twin = event("a-twin", standup.startsAt, standup.endsAt);
    expect(
      layoutDayEvents([standup, review, after, twin], friday, zone).map((layout) => [
        layout.event.id,
        layout.column,
        layout.columns,
      ]),
    ).toEqual([
      ["a-twin", 0, 3],
      ["standup", 1, 3],
      ["review", 2, 3],
      ["after", 0, 3],
    ]);
  });

  it("clips events that cross midnight and gives short or repeated-hour events real height", () => {
    expect(layoutDayEvents([overnight], friday, zone)[0]).toMatchObject({
      startMinute: 1380,
      endMinute: 1440,
    });
    expect(layoutDayEvents([overnight], saturday, zone)[0]).toMatchObject({
      startMinute: 0,
      endMinute: 60,
    });
    const instant = event("ping", "2026-11-13T15:00:00.000Z", "2026-11-13T15:01:00.000Z");
    expect(layoutDayEvents([instant], friday, zone)[0]).toMatchObject({
      startMinute: 600,
      endMinute: 615,
    });
    // Clocks fall back on November 1: 1:30 EDT to 1:15 EST is 45 elapsed minutes.
    const repeated = event("repeat", "2026-11-01T05:30:00.000Z", "2026-11-01T06:15:00.000Z");
    expect(layoutDayEvents([repeated], { day: 1, month: 11, year: 2026 }, zone)[0]).toMatchObject({
      startMinute: 90,
      endMinute: 135,
    });
  });

  it("draws the working day and widens it for early or late events", () => {
    expect(timelineHours([])).toEqual({ startHour: 8, endHour: 18 });
    const early = event("early", "2026-11-13T11:30:00.000Z", "2026-11-13T12:00:00.000Z");
    expect(timelineHours(layoutDayEvents([early, overnight], friday, zone))).toEqual({
      startHour: 6,
      endHour: 24,
    });
    expect([0, 9, 12, 15, 24].map(formatHour)).toEqual(["12 AM", "9 AM", "12 PM", "3 PM", "12 AM"]);
  });

  it("groups an agenda by day and leaves empty days out", () => {
    const sections = agendaSections(
      [overnight, lunch, holiday, standup],
      { ...friday, day: 12 },
      4,
      zone,
    );
    expect(
      sections.map((section) => [
        section.day.day,
        section.allDay.map((item) => item.id),
        section.timed.map((item) => item.id),
      ]),
    ).toEqual([
      [13, ["holiday"], ["standup", "lunch", "overnight"]],
      [14, [], ["overnight"]],
    ]);
  });
});

describe("calendar labels", () => {
  it("formats days and times in the account timezone", () => {
    expect(formatDay(friday)).toBe("Friday, November 13");
    expect(formatDay(friday, "short")).toBe("Fri, Nov 13");
    expect(formatDay(friday, "weekday")).toBe("Fri");
    expect(eventTimeLabel(holiday, friday, zone)).toBe("All day");
    expect(eventTimeLabel(standup, friday, zone)).toBe("9:00 AM – 9:30 AM");
    expect(eventTimeLabel(standup, friday, "Europe/London")).toBe("2:00 PM – 2:30 PM");
    expect(eventTimeLabel(overnight, friday, zone)).toBe("From 11:00 PM");
    // Ending exactly at midnight is the end of that day, not a continuation into the next.
    const late = event("late", "2026-11-14T03:00:00.000Z", "2026-11-14T05:00:00.000Z");
    expect(eventTimeLabel(late, friday, zone)).toBe("10:00 PM – 12:00 AM");
    expect(dayEvents([late], saturday, zone).timed).toEqual([]);
    const instant = event("instant", "2026-11-13T05:00:00.000Z", "2026-11-13T05:00:00.000Z");
    expect(eventTimeLabel(instant, friday, zone)).toBe("12:00 AM – 12:00 AM");
    expect(eventTimeLabel(overnight, saturday, zone)).toBe("Until 1:00 AM");
    const retreat = event("retreat", "2026-11-12T15:00:00.000Z", "2026-11-14T15:00:00.000Z");
    expect(eventTimeLabel(retreat, friday, zone)).toBe("Continues all day");
  });

  it("describes the whole event for its detail view", () => {
    expect(eventWhenLabel(standup, zone)).toBe("Friday, November 13 · 9:00 AM – 9:30 AM");
    expect(eventWhenLabel(overnight, zone)).toBe("Fri, Nov 13, 11:00 PM – Sat, Nov 14, 1:00 AM");
    expect(eventWhenLabel(holiday, zone)).toBe("Friday, November 13 · All day");
    expect(eventWhenLabel(trip, zone)).toBe("Fri, Nov 13 – Sun, Nov 15 · All day");
    expect(eventWhenLabel(localDayOff, zone)).toBe("Friday, November 13 · All day");
  });

  it("names the source and reports only the freshness it knows", () => {
    expect(calendarSourceLabel(calendar())).toBe("work@example.test");
    expect(calendarSourceLabel(calendar({ provider: "icloud", source: undefined }))).toBe("iCloud");
    expect(calendarFreshness(calendar(), zone)).toEqual({
      label: "Updated Fri, Nov 13, 9:41 AM",
      attention: false,
    });
    expect(calendarFreshness(calendar({ provider: "local", source: undefined }), zone)).toEqual({
      label: "Stored in nohmi",
      attention: false,
    });
    expect(calendarFreshness(calendar({ lastSyncedAt: null }), zone)).toEqual({
      label: "Not updated yet",
      attention: true,
    });
    const source = calendar().source as NonNullable<Calendar["source"]>;
    const withHealth = (state: string, message: string | null) =>
      calendar({ source: { ...source, health: { ...source.health, state, message } } as never });
    expect(calendarFreshness(withHealth("reconnect", null), zone)).toEqual({
      label: "Reconnect this account to update",
      attention: true,
    });
    expect(calendarFreshness(withHealth("reconnect", "Sign in again."), zone).label).toBe(
      "Sign in again.",
    );
    expect(calendarFreshness(withHealth("service_attention", "Provider outage."), zone)).toEqual({
      label: "Provider outage.",
      attention: true,
    });
    expect(calendarFreshness(withHealth("service_attention", null), zone).label).toBe(
      "Couldn’t update from the provider",
    );
    expect(
      calendarFreshness(
        calendar({ source: { ...source, syncStatus: "error", syncError: "Quota exceeded." } }),
        zone,
      ).label,
    ).toBe("Quota exceeded.");
  });

  it("words reminders as durations and time zones by name", () => {
    expect(reminderLabel(0)).toBe("At start");
    expect(reminderLabel(1)).toBe("1 minute before");
    expect(reminderLabel(90)).toBe("1 hour 30 minutes before");
    expect(reminderLabel(1440)).toBe("1 day before");
    expect(reminderLabel(20_160)).toBe("2 weeks before");
    expect(timeZoneName(zone, "2026-11-13T14:00:00.000Z")).toBe("Eastern Standard Time");
    expect(timeZoneName(zone, "2026-07-13T14:00:00.000Z")).toBe("Eastern Daylight Time");
    expect(timeZoneName("Mars/Olympus_Mons", "2026-11-13T14:00:00.000Z")).toBe("Mars/Olympus Mons");
  });

  it("labels guests by name, role and response", () => {
    expect(
      attendeeLabel({
        email: "a@example.test",
        name: "Ada",
        response: "accepted",
        isOrganizer: true,
      }),
    ).toEqual({ title: "Ada", subtitle: "Organizer · Accepted" });
    expect(
      attendeeLabel({
        email: "b@example.test",
        name: null,
        response: "needs_action",
        isOrganizer: false,
      }),
    ).toEqual({ title: "b@example.test", subtitle: "No response" });
  });
});
