import type { CalendarEvent } from "./calendar.js";
import {
  addLocalDays,
  type LocalDate,
  localDateAt,
  localDateRange,
  localDateTimeToUtc,
  localDateToIso,
  parseLocalDate,
} from "./time.js";

/** Provider DATE values are calendar dates, never UTC instants. */
export function normalizeProviderAllDayRange(
  startDate: string,
  endDateExclusive: string,
  timezone: string,
): { startsAt: Date; endsAt: Date } {
  for (const value of [startDate, endDateExclusive]) {
    const instant = new Date(`${value}T00:00:00Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(instant.getTime()) ||
      instant.toISOString().slice(0, 10) !== value
    )
      throw new Error("Invalid all-day calendar date.");
  }
  if (endDateExclusive <= startDate) throw new Error("All-day end date must follow its start.");
  return {
    startsAt: localDateTimeToUtc(parseLocalDate(startDate), 0, timezone),
    endsAt: localDateTimeToUtc(parseLocalDate(endDateExclusive), 0, timezone),
  };
}

export function calendarEventOccursOnDate(
  event: Pick<CalendarEvent, "allDay" | "startsAt" | "endsAt" | "timezone">,
  day: LocalDate,
  planningTimezone: string,
): boolean {
  if (event.allDay) {
    const date = localDateToIso(day);
    const start = localDateToIso(localDateAt(new Date(event.startsAt), event.timezone));
    // Provider DATE ends are midnight-exclusive; local events also support a
    // non-midnight end. The final occupied instant handles both representations.
    const last = localDateToIso(
      localDateAt(new Date(Date.parse(event.endsAt) - 1), event.timezone),
    );
    return start <= date && date <= last;
  }
  const range = localDateRange(day, addLocalDays(day, 1), planningTimezone);
  return (
    new Date(event.startsAt).getTime() < Date.parse(range.to) &&
    new Date(event.endsAt).getTime() > Date.parse(range.from)
  );
}
