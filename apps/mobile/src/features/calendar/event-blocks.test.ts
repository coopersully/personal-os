import type { Calendar, CalendarEvent, CalendarEventBlock } from "@personal-os/domain";
import { expect, it } from "vitest";
import {
  blockSummary,
  blockTargets,
  canBlockEvent,
  isUnlinkedCopy,
  overlapping,
  timeCanConflict,
} from "./event-blocks";

const zone = "America/New_York";
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
    blocks: [],
    blockSourceEventId: null,
    updatedAt: "2026-11-12T10:00:00.000Z",
    ...extra,
  } as unknown as CalendarEvent;
}
function calendar(id: string, name: string, extra: Partial<Calendar> = {}) {
  return { id, name, provider: "google", isWritable: true, isSelected: true, ...extra } as Calendar;
}
function block(calendarId: string, mode: "busy" | "details", extra = {}): CalendarEventBlock {
  return {
    calendarId,
    eventId: `block-${calendarId}-${mode}`,
    mode,
    provider: "google",
    updatedAt: "2026-11-12T11:00:00.000Z",
    ...extra,
  };
}
const standup = event("Standup", "2026-11-13T14:00:00.000Z", "2026-11-13T14:30:00.000Z");
const work = calendar("work", "Work");
const personal = calendar("personal", "Personal");
const home = calendar("home", "Home");
const holidays = calendar("holidays", "Holidays", { isWritable: false });

it("offers every other writable calendar as a place to block, with what is already there", () => {
  const blocked = {
    ...standup,
    blocks: [block("personal", "details"), block("gone", "busy")],
  };
  expect(blockTargets(blocked, [work, personal, home, holidays])).toEqual([
    { calendar: personal, blocks: [blocked.blocks[0]], mode: "details" },
    { calendar: home, blocks: [], mode: null },
  ]);
  // The same occurrence on two calendars cannot block either of them.
  expect(
    blockTargets({ ...standup, sourceCalendarIds: ["work", "home"] }, [work, personal, home]).map(
      (target) => target.calendar.id,
    ),
  ).toEqual(["personal"]);
  // Linked copies on one calendar read as Details as soon as one of them shows details.
  expect(
    blockTargets({ ...standup, blocks: [block("home", "details"), block("home", "busy")] }, [
      home,
    ])[0]?.mode,
  ).toBe("details");
});

it("blocks from a real event only, never from a block that follows another event", () => {
  expect(canBlockEvent(standup)).toBe(true);
  expect(canBlockEvent({ ...standup, blockSourceEventId: "other" })).toBe(false);
});

it("says where an event blocks time and how each block reads", () => {
  expect(blockSummary(standup, [work, personal])).toBeNull();
  expect(
    blockSummary({ ...standup, blocks: [block("personal", "busy"), block("home", "details")] }, [
      work,
      personal,
      home,
    ]),
  ).toBe("Personal (Busy) · Home (Details)");
  // A block on a calendar that is no longer connected is still counted.
  expect(blockSummary({ ...standup, blocks: [block("gone", "busy")] }, [work])).toBe(
    "A disconnected calendar (Busy)",
  );
});

it("finds the timed busy events that overlap a span, the way the Calendar review does", () => {
  const span = { startsAt: standup.startsAt, endsAt: standup.endsAt };
  const during = event("Dentist", "2026-11-13T14:15:00.000Z", "2026-11-13T15:00:00.000Z");
  const later = event("Lunch", "2026-11-13T17:00:00.000Z", "2026-11-13T18:00:00.000Z");
  const events = [
    later,
    during,
    standup,
    // Touching ends are not a conflict.
    event("After", "2026-11-13T14:30:00.000Z", "2026-11-13T15:00:00.000Z"),
    event("Before", "2026-11-13T13:00:00.000Z", "2026-11-13T14:00:00.000Z"),
    event("Free", standup.startsAt, standup.endsAt, { transparency: "free" }),
    event("Cancelled", standup.startsAt, standup.endsAt, { status: "cancelled" }),
    event("Holiday", "2026-11-13T00:00:00.000Z", "2026-11-14T00:00:00.000Z", { allDay: true }),
    event("Weekly", standup.startsAt, standup.endsAt, { recurrence: ["RRULE:FREQ=WEEKLY"] }),
    event("Busy", standup.startsAt, standup.endsAt, { blockSourceEventId: "Standup" }),
    event("Early", "2026-11-13T13:45:00.000Z", "2026-11-13T14:10:00.000Z"),
  ];
  expect(overlapping(span, events, standup).map(({ id }) => id)).toEqual(["Early", "Dentist"]);
  // The list may show this occurrence under its copy on another calendar; that is still itself.
  const canonical = {
    ...standup,
    id: "Canonical",
    calendarId: "team",
    sourceCalendarIds: ["team", "work"],
  };
  expect(overlapping(span, [canonical, during], standup).map(({ id }) => id)).toEqual(["Dentist"]);
  // Another meeting at the same time is not, whatever calendars it shares.
  expect(
    overlapping(span, [{ ...canonical, title: "Other" }], standup).map(({ id }) => id),
  ).toEqual(["Canonical"]);
  // A second meeting with the same title, time and calendar is a real conflict, never hidden.
  const twin = { ...standup, id: "Twin", sourceCalendarIds: ["work"] };
  expect(overlapping(span, [standup, twin], standup).map(({ id }) => id)).toEqual(["Twin"]);
  // With two look-alikes and no record of its own, neither is assumed to be the event.
  expect(
    overlapping(span, [canonical, { ...canonical, id: "Canonical-2" }], standup).map(
      ({ id }) => id,
    ),
  ).toEqual(["Canonical", "Canonical-2"]);
  // Without an event of its own, a proposed time is compared with everything.
  expect(overlapping(span, [standup, later]).map(({ id }) => id)).toEqual(["Standup"]);
});

it("compares only timed, busy, single events for conflicts", () => {
  expect(timeCanConflict(standup)).toBe(true);
  expect(timeCanConflict({ ...standup, transparency: "busy" })).toBe(true);
  expect(timeCanConflict({ ...standup, allDay: true })).toBe(false);
  expect(timeCanConflict({ ...standup, transparency: "free" })).toBe(false);
  expect(timeCanConflict({ ...standup, status: "cancelled" })).toBe(false);
  expect(timeCanConflict({ ...standup, recurrence: ["RRULE:FREQ=DAILY"] })).toBe(false);
  expect(timeCanConflict({ ...standup, blockSourceEventId: "other" })).toBe(false);
});

it("recognises an unlinked copy of a block left on the destination calendar", () => {
  const copy = event("copy", standup.startsAt, standup.endsAt, {
    calendarId: "personal",
    title: "Busy",
  });
  expect(isUnlinkedCopy(copy, standup, "personal", "busy", zone)).toBe(true);
  expect(isUnlinkedCopy({ ...copy, title: "Standup" }, standup, "personal", "details", zone)).toBe(
    true,
  );
  expect(isUnlinkedCopy(copy, standup, "personal", "details", zone)).toBe(false);
  expect(isUnlinkedCopy(copy, standup, "home", "busy", zone)).toBe(false);
  expect(
    isUnlinkedCopy({ ...copy, blockSourceEventId: "x" }, standup, "personal", "busy", zone),
  ).toBe(false);
  expect(
    isUnlinkedCopy(
      { ...copy, endsAt: "2026-11-13T15:00:00.000Z" },
      standup,
      "personal",
      "busy",
      zone,
    ),
  ).toBe(false);
  expect(isUnlinkedCopy({ ...copy, allDay: true }, standup, "personal", "busy", zone)).toBe(false);

  // An all-day block on a provider reads back as UTC dates, whatever the source stored.
  const offsite = event("Offsite", "2026-11-20T05:00:00.000Z", "2026-11-21T05:00:00.000Z", {
    allDay: true,
    provider: "local",
  });
  const dated = event("dated", "2026-11-20T00:00:00.000Z", "2026-11-21T00:00:00.000Z", {
    allDay: true,
    calendarId: "personal",
    title: "Busy",
  });
  expect(isUnlinkedCopy(dated, offsite, "personal", "busy", zone)).toBe(true);
  expect(
    isUnlinkedCopy(
      { ...dated, endsAt: "2026-11-22T00:00:00.000Z" },
      offsite,
      "personal",
      "busy",
      zone,
    ),
  ).toBe(false);
});
