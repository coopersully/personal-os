import type { Calendar, CalendarEvent } from "@personal-os/domain";
import { expect, it } from "vitest";
import {
  canChangeEvent,
  canRestoreFaithfully,
  createInput,
  draftFromEvent,
  draftProblem,
  type EventDraft,
  eventRevision,
  eventTimes,
  newEventDraft,
  updateInput,
  withStart,
} from "./event-draft";
import { allDaySpan } from "./logic";

const zone = "America/New_York";
const tokyo = "Asia/Tokyo";
const draft = (change: Partial<EventDraft> = {}): EventDraft => ({
  title: "Dentist",
  calendarId: "work",
  allDay: false,
  startDate: "2026-11-13",
  startTime: "09:00",
  endDate: "2026-11-13",
  endTime: "10:00",
  location: "",
  notes: "",
  ...change,
});
const event = (change: Partial<CalendarEvent> = {}) =>
  ({
    id: "event-1",
    title: "Dentist",
    calendarId: "work",
    provider: "google",
    allDay: false,
    startsAt: "2026-11-13T14:00:00.000Z",
    endsAt: "2026-11-13T15:00:00.000Z",
    timezone: zone,
    location: null,
    notes: null,
    recurrence: [],
    blocks: [],
    blockSourceEventId: null,
    updatedAt: "2026-11-12T10:00:00.000Z",
    ...change,
  }) as CalendarEvent;

it("starts a new event at the next whole hour today and at 9 AM on another day", () => {
  const now = new Date("2026-11-13T15:20:00.000Z"); // 10:20 AM in New York
  expect(newEventDraft(undefined, now, zone, 45)).toMatchObject({
    title: "",
    calendarId: "",
    allDay: false,
    startDate: "2026-11-13",
    startTime: "11:00",
    endDate: "2026-11-13",
    endTime: "11:45",
  });
  expect(newEventDraft("2026-11-13", now, zone, 60)).toMatchObject({ startTime: "11:00" });
  expect(newEventDraft("2026-11-20", now, zone, 60)).toMatchObject({
    startDate: "2026-11-20",
    startTime: "09:00",
    endTime: "10:00",
  });
  // A day that is not a calendar date falls back to today.
  expect(newEventDraft("tomorrow", now, zone, 60)).toMatchObject({ startDate: "2026-11-13" });
});

it("rolls a late-evening start into the next day", () => {
  const late = new Date("2026-11-14T04:30:00.000Z"); // 11:30 PM on the 13th in New York
  expect(newEventDraft(undefined, late, zone, 90)).toMatchObject({
    startDate: "2026-11-14",
    startTime: "00:00",
    endDate: "2026-11-14",
    endTime: "01:30",
  });
});

it("reads a timed event in the account timezone, wherever it was set", () => {
  expect(draftFromEvent(event({ location: "Room 4", notes: "Bring forms" }), tokyo)).toEqual(
    draft({
      startDate: "2026-11-13",
      startTime: "23:00",
      endDate: "2026-11-14",
      endTime: "00:00",
      location: "Room 4",
      notes: "Bring forms",
    }),
  );
});

it("reads all-day events by their calendar dates, ending on the last day", () => {
  const provider = event({
    allDay: true,
    startsAt: "2026-11-13T00:00:00.000Z",
    endsAt: "2026-11-15T00:00:00.000Z",
  });
  expect(draftFromEvent(provider, zone)).toMatchObject({
    allDay: true,
    startDate: "2026-11-13",
    endDate: "2026-11-14",
  });
  const local = event({
    provider: "local",
    allDay: true,
    startsAt: "2026-11-13T05:00:00.000Z",
    endsAt: "2026-11-14T05:00:00.000Z",
  });
  expect(draftFromEvent(local, zone)).toMatchObject({
    startDate: "2026-11-13",
    endDate: "2026-11-13",
  });
});

it("keeps an event's length when its start moves", () => {
  expect(withStart(draft(), { startTime: "23:30" }, zone)).toMatchObject({
    startTime: "23:30",
    endDate: "2026-11-14",
    endTime: "00:30",
  });
  expect(withStart(draft(), { startDate: "2026-12-01" }, zone)).toMatchObject({
    endDate: "2026-12-01",
    endTime: "10:00",
  });
  const days = draft({ allDay: true, endDate: "2026-11-15" });
  expect(withStart(days, { startDate: "2026-11-20" }, zone)).toMatchObject({
    startDate: "2026-11-20",
    endDate: "2026-11-22",
  });
  // An end already before the start is left for the person to correct.
  expect(withStart(draft({ endTime: "08:00" }), { startTime: "12:00" }, zone)).toMatchObject({
    startTime: "12:00",
    endTime: "08:00",
  });
  expect(
    withStart(draft({ allDay: true, endDate: "2026-11-01" }), { startDate: "2026-11-20" }, zone),
  ).toMatchObject({ endDate: "2026-11-01" });
});

it("names what stops a draft from being saved", () => {
  expect(draftProblem(draft(), zone)).toBeNull();
  expect(draftProblem(draft({ title: "  " }), zone)).toBe("Add a title before saving.");
  expect(draftProblem(draft({ calendarId: "" }), zone)).toBe("Choose a calendar before saving.");
  expect(draftProblem(draft({ endTime: "09:00" }), zone)).toBe(
    "The event must end after it starts.",
  );
  expect(draftProblem(draft({ allDay: true, endTime: "08:00" }), zone)).toBeNull();
  expect(draftProblem(draft({ allDay: true, endDate: "2026-11-12" }), zone)).toBe(
    "The event must end after it starts.",
  );
});

it("sends timed events as instants of the account's wall clock, across a clock change", () => {
  expect(eventTimes(draft(), "google", zone)).toEqual({
    allDay: false,
    startsAt: "2026-11-13T14:00:00.000Z",
    endsAt: "2026-11-13T15:00:00.000Z",
    timezone: zone,
  });
  // Clocks go back on November 1: 12:30 AM is still daylight time, 3 AM is standard time.
  expect(
    eventTimes(
      draft({
        startDate: "2026-11-01",
        startTime: "00:30",
        endDate: "2026-11-01",
        endTime: "03:00",
      }),
      "local",
      zone,
    ),
  ).toMatchObject({ startsAt: "2026-11-01T04:30:00.000Z", endsAt: "2026-11-01T08:00:00.000Z" });
});

it("sends all-day events as the dates each calendar will read back", () => {
  const days = draft({ allDay: true, endDate: "2026-11-14" });
  // nohmi and Google read the date in the event's timezone, east or west of UTC.
  expect(eventTimes(days, "local", zone)).toEqual({
    allDay: true,
    startsAt: "2026-11-13T05:00:00.000Z",
    endsAt: "2026-11-15T05:00:00.000Z",
    timezone: zone,
  });
  expect(eventTimes(days, "google", tokyo)).toMatchObject({
    startsAt: "2026-11-12T15:00:00.000Z",
    endsAt: "2026-11-14T15:00:00.000Z",
    timezone: tokyo,
  });
  // iCloud reads the UTC date, so local midnight in Tokyo would land a day early.
  expect(eventTimes(days, "icloud", tokyo)).toMatchObject({
    startsAt: "2026-11-13T00:00:00.000Z",
    endsAt: "2026-11-15T00:00:00.000Z",
    timezone: tokyo,
  });
});

it("builds a create request with trimmed text and empty optional fields as null", () => {
  expect(
    createInput(
      draft({ title: "  Dentist ", location: " ", notes: " Bring forms " }),
      { id: "work", provider: "google" },
      zone,
    ),
  ).toEqual({
    calendarId: "work",
    title: "Dentist",
    location: null,
    notes: "Bring forms",
    allDay: false,
    startsAt: "2026-11-13T14:00:00.000Z",
    endsAt: "2026-11-13T15:00:00.000Z",
    timezone: zone,
  });
});

it("sends only what changed on an update, with the revisions it was read at", () => {
  const blocked = event({
    blocks: [
      {
        calendarId: "personal",
        eventId: "block-1",
        mode: "busy",
        provider: "local",
        updatedAt: "2026-11-12T11:00:00.000Z",
      },
    ],
  });
  const revision = {
    expectedUpdatedAt: "2026-11-12T10:00:00.000Z",
    expectedBlockUpdatedAtById: { "block-1": "2026-11-12T11:00:00.000Z" },
  };
  expect(eventRevision(blocked)).toEqual(revision);
  const opened = draftFromEvent(blocked, zone);
  expect(updateInput({ ...opened, title: "Dentist (moved)" }, blocked, zone)).toEqual({
    title: "Dentist (moved)",
    ...revision,
  });
  expect(updateInput({ ...opened, location: "Suite 2", notes: " " }, blocked, zone)).toEqual({
    title: "Dentist",
    location: "Suite 2",
    ...revision,
  });
  expect(updateInput({ ...opened, endTime: "10:30" }, blocked, zone)).toEqual({
    title: "Dentist",
    allDay: false,
    startsAt: "2026-11-13T14:00:00.000Z",
    endsAt: "2026-11-13T15:30:00.000Z",
    timezone: zone,
    ...revision,
  });
  expect(updateInput({ ...opened, allDay: true }, blocked, zone)).toMatchObject({
    allDay: true,
    startsAt: "2026-11-13T05:00:00.000Z",
    endsAt: "2026-11-14T05:00:00.000Z",
  });
  // Clearing a field that had a value sends null.
  const located = event({ location: "Room 4" });
  expect(
    updateInput({ ...draftFromEvent(located, zone), location: "" }, located, zone),
  ).toMatchObject({ location: null });
  // The untouched clock of an all-day event is not a change.
  const days = event({
    allDay: true,
    startsAt: "2026-11-13T00:00:00.000Z",
    endsAt: "2026-11-14T00:00:00.000Z",
  });
  expect(updateInput({ ...draftFromEvent(days, zone), startTime: "07:00" }, days, zone)).toEqual({
    title: "Dentist",
    expectedUpdatedAt: "2026-11-12T10:00:00.000Z",
    expectedBlockUpdatedAtById: {},
  });
});

it("allows changes only on a writable calendar and never on a mirrored busy block", () => {
  const writable = { isWritable: true } as Calendar;
  expect(canChangeEvent(event(), writable)).toBe(true);
  expect(canChangeEvent(event(), { isWritable: false } as Calendar)).toBe(false);
  expect(canChangeEvent(event(), undefined)).toBe(false);
  expect(canChangeEvent(event({ blockSourceEventId: "source-1" }), writable)).toBe(false);
});

it("keeps all-day dates where clocks skip midnight", () => {
  // Cairo's clocks jump from midnight to 1 AM on April 24, 2026.
  const cairo = "Africa/Cairo";
  for (const [startDate, endDate] of [
    ["2026-04-24", "2026-04-24"],
    ["2026-04-23", "2026-04-23"],
    ["2026-04-22", "2026-04-25"],
  ] as const) {
    const times = eventTimes(draft({ allDay: true, startDate, endDate }), "local", cairo);
    expect(new Date(times.endsAt).getTime()).toBeGreaterThan(new Date(times.startsAt).getTime());
    // nohmi reads its own all-day events back as these instants in the account timezone.
    const span = allDaySpan(event({ provider: "local", ...times }), cairo);
    expect([span.first.day, span.last.day]).toEqual([
      Number(startDate.slice(8)),
      Number(endDate.slice(8)),
    ]);
    // Google reads the calendar date of each instant in the event's timezone.
    const googleDate = (instant: string) =>
      new Intl.DateTimeFormat("en-CA", { timeZone: cairo }).format(new Date(instant));
    const google = eventTimes(draft({ allDay: true, startDate, endDate }), "google", cairo);
    expect(googleDate(google.startsAt)).toBe(startDate);
    expect(googleDate(google.endsAt) > endDate).toBe(true);
  }
});

it("offers to restore only events that would come back as they were", () => {
  expect(canRestoreFaithfully(event())).toBe(true);
  expect(canRestoreFaithfully(event({ recurrence: ["RRULE:FREQ=WEEKLY"] }))).toBe(false);
  expect(canRestoreFaithfully(event({ conferenceUrl: "https://meet.example.test/a" }))).toBe(false);
  expect(
    canRestoreFaithfully(
      event({
        attendees: [
          { email: "a@example.test", name: null, response: "accepted", isOrganizer: false },
        ],
      }),
    ),
  ).toBe(false);
  // A synced provider all-day event keeps UTC; one nohmi changed since keeps the account zone.
  expect(canRestoreFaithfully(event({ allDay: true, timezone: "UTC" }))).toBe(true);
  expect(canRestoreFaithfully(event({ allDay: true }))).toBe(false);
  // nohmi's own events are restored from the stored record.
  expect(
    canRestoreFaithfully(
      event({ provider: "local", allDay: true, recurrence: ["RRULE:FREQ=WEEKLY"] }),
    ),
  ).toBe(true);
});
