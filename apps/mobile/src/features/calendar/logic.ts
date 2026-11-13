import type { Calendar, CalendarEvent, LocalDate } from "@personal-os/domain";
import {
  addLocalDays,
  localDateAt,
  localDateRange,
  localDateToIso,
  parseLocalDate,
  sameLocalDate,
  startOfLocalWeek,
} from "@personal-os/domain";

/** Days loaded by the agenda from its anchor; the day view loads its own week. */
export const agendaDayCount = 14;
export const fallbackEventColor = "#777ce3";

export type DayEventLayout = {
  column: number;
  columns: number;
  endMinute: number;
  event: CalendarEvent;
  startMinute: number;
};
export type DayEvents = { allDay: CalendarEvent[]; timed: DayEventLayout[] };
export type AgendaSection = { day: LocalDate; allDay: CalendarEvent[]; timed: CalendarEvent[] };

// One owner timezone formats every timestamp on a screen; reuse its ICU formatters.
let formatters:
  | { timeZone: string; clock: Intl.DateTimeFormat; parts: Intl.DateTimeFormat }
  | undefined;
function formattersFor(timeZone: string) {
  if (formatters?.timeZone !== timeZone) {
    formatters = {
      timeZone,
      clock: new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone }),
      parts: new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        hourCycle: "h23",
        minute: "numeric",
        timeZone,
      }),
    };
  }
  return formatters;
}
function localMinuteAt(instant: Date, timeZone: string) {
  const values = Object.fromEntries(
    formattersFor(timeZone)
      .parts.formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
  return Number(values.hour) * 60 + Number(values.minute);
}

/** The seven local days of the Sunday-first week containing `day`. */
export function weekDays(day: LocalDate): LocalDate[] {
  const start = startOfLocalWeek(day);
  return Array.from({ length: 7 }, (_, index) => addLocalDays(start, index));
}

/** Bounded instant range for `count` local days starting at `from`. */
export function calendarRange(from: LocalDate, count: number, timeZone: string) {
  return localDateRange(from, addLocalDays(from, count), timeZone);
}

/** Provider all-day events are date-only; local ones are instants in the account timezone. */
function allDaySpan(event: CalendarEvent, timeZone: string): { first: LocalDate; last: LocalDate } {
  if (event.provider !== "local") {
    return {
      first: parseLocalDate(event.startsAt.slice(0, 10)),
      last: addLocalDays(parseLocalDate(event.endsAt.slice(0, 10)), -1),
    };
  }
  return {
    first: localDateAt(new Date(event.startsAt), timeZone),
    last: localDateAt(new Date(new Date(event.endsAt).getTime() - 1), timeZone),
  };
}

export function eventOccursOnDay(event: CalendarEvent, day: LocalDate, timeZone: string) {
  if (event.allDay && event.provider !== "local") {
    const date = localDateToIso(day);
    return date >= event.startsAt.slice(0, 10) && date < event.endsAt.slice(0, 10);
  }
  const range = calendarRange(day, 1, timeZone);
  return (
    new Date(event.startsAt).getTime() < new Date(range.to).getTime() &&
    new Date(event.endsAt).getTime() > new Date(range.from).getTime()
  );
}

const byStart = (left: CalendarEvent, right: CalendarEvent) =>
  new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime() ||
  left.title.localeCompare(right.title) ||
  left.id.localeCompare(right.id);

/** Places a day's timed events in side-by-side columns wherever they overlap. */
export function layoutDayEvents(
  events: CalendarEvent[],
  day: LocalDate,
  timeZone: string,
): DayEventLayout[] {
  const intervals = events
    .filter((event) => !event.allDay)
    .map((event) => {
      const startsAt = new Date(event.startsAt);
      const endsAt = new Date(event.endsAt);
      const startsToday = sameLocalDate(localDateAt(startsAt, timeZone), day);
      const endsToday = sameLocalDate(localDateAt(endsAt, timeZone), day);
      const startMinute = startsToday ? localMinuteAt(startsAt, timeZone) : 0;
      const endMinute = endsToday ? localMinuteAt(endsAt, timeZone) : 1440;
      // A repeated daylight-saving hour can end at an earlier wall-clock minute; use elapsed time.
      const minimum =
        startsToday && endsToday && endMinute <= startMinute
          ? Math.max(15, (endsAt.getTime() - startsAt.getTime()) / 60_000)
          : 15;
      return {
        endMinute: Math.min(1440, Math.max(endMinute, startMinute + minimum)),
        event,
        startMinute,
      };
    })
    .sort(
      (left, right) =>
        left.startMinute - right.startMinute ||
        left.endMinute - right.endMinute ||
        left.event.id.localeCompare(right.event.id),
    );
  const result: DayEventLayout[] = [];
  let cluster: DayEventLayout[] = [];
  let clusterEnd = -1;
  let laneEnds: number[] = [];
  const flush = () => {
    for (const layout of cluster) result.push({ ...layout, columns: laneEnds.length });
    cluster = [];
    laneEnds = [];
  };
  for (const interval of intervals) {
    if (interval.startMinute >= clusterEnd) {
      flush();
      clusterEnd = -1;
    }
    let column = laneEnds.findIndex((end) => end <= interval.startMinute);
    if (column < 0) column = laneEnds.length;
    laneEnds[column] = interval.endMinute;
    cluster.push({ ...interval, column, columns: 0 });
    clusterEnd = Math.max(clusterEnd, interval.endMinute);
  }
  flush();
  return result;
}

export function dayEvents(events: CalendarEvent[], day: LocalDate, timeZone: string): DayEvents {
  const today = events.filter((event) => eventOccursOnDay(event, day, timeZone));
  return {
    allDay: today.filter((event) => event.allDay).sort(byStart),
    timed: layoutDayEvents(today, day, timeZone),
  };
}

/** Agenda days in order, omitting days with nothing on them. */
export function agendaSections(
  events: CalendarEvent[],
  from: LocalDate,
  count: number,
  timeZone: string,
): AgendaSection[] {
  return Array.from({ length: count }, (_, index) => addLocalDays(from, index))
    .map((day) => {
      const today = events.filter((event) => eventOccursOnDay(event, day, timeZone));
      return {
        day,
        allDay: today.filter((event) => event.allDay).sort(byStart),
        timed: today.filter((event) => !event.allDay).sort(byStart),
      };
    })
    .filter((section) => section.allDay.length + section.timed.length > 0);
}

/** Hours the day timeline draws: the working day, widened to contain every event. */
export function timelineHours(layouts: DayEventLayout[]) {
  return {
    startHour: Math.min(8, ...layouts.map((layout) => Math.floor(layout.startMinute / 60))),
    endHour: Math.max(18, ...layouts.map((layout) => Math.ceil(layout.endMinute / 60))),
  };
}

export function formatHour(hour: number) {
  if (hour % 24 === 0) return "12 AM";
  if (hour === 12) return "12 PM";
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
}

export function formatClock(value: string, timeZone: string) {
  // Newer ICU separates the day period with a narrow no-break space; keep labels plain.
  return formattersFor(timeZone)
    .clock.format(new Date(value))
    .replace(/\u202f/g, " ");
}

export function formatDay(day: LocalDate, style: "long" | "short" | "weekday" = "long") {
  return new Intl.DateTimeFormat(
    "en-US",
    style === "weekday"
      ? { timeZone: "UTC", weekday: "short" }
      : {
          day: "numeric",
          month: style === "long" ? "long" : "short",
          timeZone: "UTC",
          weekday: style === "long" ? "long" : "short",
        },
  ).format(new Date(Date.UTC(day.year, day.month - 1, day.day)));
}

/** A row's time on one day, honest about events that continue from or into other days. */
export function eventTimeLabel(event: CalendarEvent, day: LocalDate, timeZone: string) {
  if (event.allDay) return "All day";
  const startsToday = sameLocalDate(localDateAt(new Date(event.startsAt), timeZone), day);
  const endsToday = sameLocalDate(localDateAt(new Date(event.endsAt), timeZone), day);
  const start = formatClock(event.startsAt, timeZone);
  const end = formatClock(event.endsAt, timeZone);
  if (startsToday && endsToday) return `${start} – ${end}`;
  if (startsToday) return `From ${start}`;
  if (endsToday) return `Until ${end}`;
  return "Continues all day";
}

/** The complete date and time of an event for its detail view. */
export function eventWhenLabel(event: CalendarEvent, timeZone: string) {
  if (event.allDay) {
    const { first, last } = allDaySpan(event, timeZone);
    return sameLocalDate(first, last)
      ? `${formatDay(first)} · All day`
      : `${formatDay(first, "short")} – ${formatDay(last, "short")} · All day`;
  }
  const first = localDateAt(new Date(event.startsAt), timeZone);
  const last = localDateAt(new Date(event.endsAt), timeZone);
  const start = formatClock(event.startsAt, timeZone);
  const end = formatClock(event.endsAt, timeZone);
  return sameLocalDate(first, last)
    ? `${formatDay(first)} · ${start} – ${end}`
    : `${formatDay(first, "short")}, ${start} – ${formatDay(last, "short")}, ${end}`;
}

const providerLabels = { google: "Google", icloud: "iCloud", local: "nohmi" } as const;
export function calendarSourceLabel(calendar: Pick<Calendar, "provider" | "source">) {
  return calendar.source?.accountLabel ?? providerLabels[calendar.provider];
}

/** What is known about how current a calendar's events are; never implies a sync that didn't run. */
export function calendarFreshness(
  calendar: Calendar,
  timeZone: string,
): { label: string; attention: boolean } {
  if (calendar.provider === "local") return { label: "Stored in nohmi", attention: false };
  const health = calendar.source?.health;
  if (health?.state === "reconnect")
    return { label: health.message ?? "Reconnect this account to update", attention: true };
  if (calendar.source?.syncStatus === "error" || health?.state === "service_attention")
    return {
      label: calendar.source?.syncError ?? health?.message ?? "Couldn’t update from the provider",
      attention: true,
    };
  if (!calendar.lastSyncedAt) return { label: "Not updated yet", attention: true };
  const day = localDateAt(new Date(calendar.lastSyncedAt), timeZone);
  return {
    label: `Updated ${formatDay(day, "short")}, ${formatClock(calendar.lastSyncedAt, timeZone)}`,
    attention: false,
  };
}

const responseLabels = {
  accepted: "Accepted",
  declined: "Declined",
  needs_action: "No response",
  tentative: "Maybe",
} as const;
export function attendeeLabel(attendee: NonNullable<CalendarEvent["attendees"]>[number]): {
  title: string;
  subtitle: string;
} {
  return {
    title: attendee.name ?? attendee.email,
    subtitle: [attendee.isOrganizer ? "Organizer" : null, responseLabels[attendee.response]]
      .filter(Boolean)
      .join(" · "),
  };
}
