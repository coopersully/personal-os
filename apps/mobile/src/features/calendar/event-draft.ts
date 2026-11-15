import type {
  Calendar,
  CalendarEvent,
  CreateEventInput,
  LocalDate,
  UpdateEventInput,
} from "@personal-os/domain";
import {
  addLocalDays,
  localDateAt,
  localDateTimeToUtc,
  localDateToIso,
  parseLocalDate,
} from "@personal-os/domain";
import { allDaySpan } from "./logic";

/**
 * What the event form edits: wall-clock dates ("2026-11-13") and times ("09:30") in the account
 * timezone. An all-day draft ends on its last day, not on the exclusive day after it.
 */
export type EventDraft = {
  title: string;
  calendarId: string;
  allDay: boolean;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  location: string;
  notes: string;
};

const minuteOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const instantOf = (date: string, time: string, timeZone: string) =>
  localDateTimeToUtc(parseLocalDate(date), minuteOf(time), timeZone);
const dayNumber = (date: string) => {
  const { year, month, day } = parseLocalDate(date);
  return Date.UTC(year, month - 1, day) / 86_400_000;
};

function wallClock(instant: Date, timeZone: string) {
  return {
    date: localDateToIso(localDateAt(instant, timeZone)),
    time: new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(instant),
  };
}

/** A new event starts at the next whole hour today, or at 9 AM on another chosen day. */
export function newEventDraft(
  day: string | undefined,
  now: Date,
  timeZone: string,
  durationMinutes: number,
): EventDraft {
  const current = wallClock(now, timeZone);
  const date = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : current.date;
  const nextHour = (Math.floor(minuteOf(current.time) / 60) + 1) * 60;
  const start =
    date !== current.date
      ? instantOf(date, "09:00", timeZone)
      : localDateTimeToUtc(
          addLocalDays(parseLocalDate(date), nextHour >= 1440 ? 1 : 0),
          nextHour % 1440,
          timeZone,
        );
  const from = wallClock(start, timeZone);
  const to = wallClock(new Date(start.getTime() + durationMinutes * 60_000), timeZone);
  return {
    title: "",
    calendarId: "",
    allDay: false,
    startDate: from.date,
    startTime: from.time,
    endDate: to.date,
    endTime: to.time,
    location: "",
    notes: "",
  };
}

export function draftFromEvent(event: CalendarEvent, timeZone: string): EventDraft {
  const shared = {
    title: event.title,
    calendarId: event.calendarId,
    allDay: event.allDay,
    location: event.location ?? "",
    notes: event.notes ?? "",
  };
  if (event.allDay) {
    const { first, last } = allDaySpan(event, timeZone);
    return {
      ...shared,
      startDate: localDateToIso(first),
      startTime: "09:00",
      endDate: localDateToIso(last),
      endTime: "10:00",
    };
  }
  const from = wallClock(new Date(event.startsAt), timeZone);
  const to = wallClock(new Date(event.endsAt), timeZone);
  return {
    ...shared,
    startDate: from.date,
    startTime: from.time,
    endDate: to.date,
    endTime: to.time,
  };
}

/** Moving the start keeps the event's length, so the end never falls behind it by accident. */
export function withStart(
  draft: EventDraft,
  change: { startDate?: string; startTime?: string },
  timeZone: string,
): EventDraft {
  const next = { ...draft, ...change };
  if (draft.allDay) {
    const days = dayNumber(draft.endDate) - dayNumber(draft.startDate);
    if (days < 0) return next;
    return {
      ...next,
      endDate: localDateToIso(addLocalDays(parseLocalDate(next.startDate), days)),
    };
  }
  const length =
    instantOf(draft.endDate, draft.endTime, timeZone).getTime() -
    instantOf(draft.startDate, draft.startTime, timeZone).getTime();
  if (length <= 0) return next;
  const end = wallClock(
    new Date(instantOf(next.startDate, next.startTime, timeZone).getTime() + length),
    timeZone,
  );
  return { ...next, endDate: end.date, endTime: end.time };
}

/** What stops this draft from being saved, in the words the person sees; null when it can be. */
export function draftProblem(draft: EventDraft, timeZone: string): string | null {
  if (!draft.title.trim()) return "Add a title before saving.";
  if (!draft.calendarId) return "Choose a calendar before saving.";
  const ordered = draft.allDay
    ? dayNumber(draft.endDate) >= dayNumber(draft.startDate)
    : instantOf(draft.endDate, draft.endTime, timeZone) >
      instantOf(draft.startDate, draft.startTime, timeZone);
  return ordered ? null : "The event must end after it starts.";
}

/**
 * The instants the API stores for a draft. Timed events are instants of the account's wall
 * clock. All-day events are sent the way each calendar reads them back: nohmi and Google take
 * the date in the event's timezone, while iCloud takes the UTC date.
 */
export function eventTimes(draft: EventDraft, provider: Calendar["provider"], timeZone: string) {
  if (!draft.allDay)
    return {
      allDay: false,
      startsAt: instantOf(draft.startDate, draft.startTime, timeZone).toISOString(),
      endsAt: instantOf(draft.endDate, draft.endTime, timeZone).toISOString(),
      timezone: timeZone,
    };
  const midnight = (day: LocalDate) =>
    provider === "icloud"
      ? new Date(Date.UTC(day.year, day.month - 1, day.day))
      : startOfLocalDay(day, timeZone);
  return {
    allDay: true,
    startsAt: midnight(parseLocalDate(draft.startDate)).toISOString(),
    // An all-day event ends at the start of the day after its last day.
    endsAt: midnight(addLocalDays(parseLocalDate(draft.endDate), 1)).toISOString(),
    timezone: timeZone,
  };
}

/**
 * The first instant of a local day. Where clocks skip midnight (Cairo, Beirut), the wall-clock
 * conversion lands on the evening before, so step forward until the day has begun.
 */
function startOfLocalDay(day: LocalDate, timeZone: string) {
  const date = localDateToIso(day);
  let instant = localDateTimeToUtc(day, 0, timeZone);
  for (let step = 0; step < 4 && localDateToIso(localDateAt(instant, timeZone)) < date; step += 1)
    instant = new Date(instant.getTime() + 30 * 60_000);
  return instant;
}

const optional = (value: string) => value.trim() || null;

export function createInput(
  draft: EventDraft,
  calendar: Pick<Calendar, "id" | "provider">,
  timeZone: string,
): CreateEventInput {
  return {
    calendarId: calendar.id,
    title: draft.title.trim(),
    location: optional(draft.location),
    notes: optional(draft.notes),
    ...eventTimes(draft, calendar.provider, timeZone),
  };
}

/**
 * Only what the person changed is sent, so untouched provider fields are never rewritten. The
 * revisions make the API refuse the save if the event or its busy blocks changed meanwhile.
 */
export function updateInput(
  draft: EventDraft,
  event: CalendarEvent,
  timeZone: string,
): UpdateEventInput {
  const before = draftFromEvent(event, timeZone);
  const timing = (["allDay", "startDate", "endDate"] as const).some(
    (key) => draft[key] !== before[key],
  );
  const clock =
    !draft.allDay && (draft.startTime !== before.startTime || draft.endTime !== before.endTime);
  return {
    title: draft.title.trim(),
    ...(optional(draft.location) !== optional(before.location) && {
      location: optional(draft.location),
    }),
    ...(optional(draft.notes) !== optional(before.notes) && { notes: optional(draft.notes) }),
    ...((timing || clock) && eventTimes(draft, event.provider, timeZone)),
    ...eventRevision(event),
  };
}

export function eventRevision(event: CalendarEvent) {
  return {
    expectedUpdatedAt: event.updatedAt,
    expectedBlockUpdatedAtById: Object.fromEntries(
      event.blocks.map((block) => [block.eventId, block.updatedAt]),
    ),
  };
}

/** A person may change an event on a calendar they can write to, unless it mirrors another event. */
export function canChangeEvent(event: CalendarEvent, calendar: Calendar | undefined) {
  return !!calendar?.isWritable && !event.blockSourceEventId;
}

/**
 * Restoring re-creates a provider event from its title, time, location and notes only, so
 * guests, a repeat rule or a meeting link would not come back. A provider all-day event that
 * nohmi has changed since its last sync also keeps a timezone that restoring would read its
 * date in, moving it a day. Undo is offered only when restoring returns the same event.
 */
export function canRestoreFaithfully(event: CalendarEvent) {
  if (event.provider === "local") return true;
  return (
    !event.attendees?.length &&
    !event.recurrence.length &&
    !event.conferenceUrl &&
    !(event.allDay && event.timezone !== "UTC")
  );
}
