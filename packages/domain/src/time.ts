export type InstantRange = { from: string; to: string };

export type LocalDate = { day: number; month: number; year: number };

export type DateOnlyFormatOptions = Omit<Intl.DateTimeFormatOptions, "timeZone">;

/** Formats an ISO calendar date without allowing the viewer's timezone to move it a day. */
export function formatDateOnly(value: string, options: DateOnlyFormatOptions): string {
  return new Intl.DateTimeFormat(undefined, { ...options, timeZone: "UTC" }).format(
    new Date(`${value}T12:00:00Z`),
  );
}

/** Formats an ISO calendar date with an ordinal day, such as "June 6th". */
export function formatDateWithOrdinal(value: string): string {
  const date = new Date(`${value}T12:00:00Z`);
  const day = date.getUTCDate();
  const suffix =
    day % 10 === 1 && day % 100 !== 11
      ? "st"
      : day % 10 === 2 && day % 100 !== 12
        ? "nd"
        : day % 10 === 3 && day % 100 !== 13
          ? "rd"
          : "th";
  return `${formatDateOnly(value, { month: "long" })} ${day}${suffix}`;
}

/** Formats an ISO month (YYYY-MM) for UI copy, such as "June 2026". */
export function formatMonth(value: string): string {
  return formatDateOnly(`${value}-01`, { month: "long", year: "numeric" });
}

/** Moves an ISO month forward or backward while preserving its calendar semantics. */
export function addMonths(value: string, amount: number): string {
  const [yearPart, monthPart] = value.split("-");
  const year = Number(yearPart);
  const month = Number(monthPart);
  const shifted = new Date(Date.UTC(year, month - 1 + amount, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function localDateAt(instant: Date, timeZone: string): LocalDate {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(instant);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { day: Number(value.day), month: Number(value.month), year: Number(value.year) };
}

export function localDayRange(now: Date, timeZone: string): InstantRange {
  const date = localDateAt(now, timeZone);
  return localDateRange(date, addLocalDays(date, 1), timeZone);
}

export function localWeekRange(now: Date, timeZone: string): InstantRange {
  const date = localDateAt(now, timeZone);
  const weekday = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
  const start = addLocalDays(date, -weekday);
  return localDateRange(start, addLocalDays(start, 7), timeZone);
}

export function addLocalDays(date: LocalDate, days: number): LocalDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    day: shifted.getUTCDate(),
    month: shifted.getUTCMonth() + 1,
    year: shifted.getUTCFullYear(),
  };
}

/** Returns the Sunday that begins the local calendar week containing `date`. */
export function startOfLocalWeek(date: LocalDate): LocalDate {
  const weekday = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
  return addLocalDays(date, -weekday);
}

/** Formats a local calendar date for URL and form state without a timezone shift. */
export function localDateToIso(date: LocalDate): string {
  return `${date.year.toString().padStart(4, "0")}-${date.month
    .toString()
    .padStart(2, "0")}-${date.day.toString().padStart(2, "0")}`;
}

/** Parses the ISO calendar-date format emitted by `localDateToIso`. */
export function parseLocalDate(value: string): LocalDate {
  const [year, month, day] = value.split("-").map(Number);
  return { day: day as number, month: month as number, year: year as number };
}

export function sameLocalDate(left: LocalDate, right: LocalDate): boolean {
  return left.day === right.day && left.month === right.month && left.year === right.year;
}

export function localDateRange(from: LocalDate, to: LocalDate, timeZone: string): InstantRange {
  return {
    from: localDateTimeToUtc(from, 0, timeZone).toISOString(),
    to: localDateTimeToUtc(to, 0, timeZone).toISOString(),
  };
}

/** Converts a local wall-clock minute (0–1439) to an instant in the selected IANA timezone. */
export function localDateTimeToUtc(date: LocalDate, minuteOfDay: number, timeZone: string): Date {
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  let instant = new Date(Date.UTC(date.year, date.month - 1, date.day, hour, minute));
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const parts = new Intl.DateTimeFormat("en-US", {
      day: "2-digit",
      hour: "2-digit",
      hour12: false,
      minute: "2-digit",
      month: "2-digit",
      second: "2-digit",
      timeZone,
      year: "numeric",
    }).formatToParts(instant);
    const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const asUtc = Date.UTC(
      Number(value.year),
      Number(value.month) - 1,
      Number(value.day),
      Number(value.hour) % 24,
      Number(value.minute),
      Number(value.second),
    );
    const wanted = Date.UTC(date.year, date.month - 1, date.day, hour, minute);
    instant = new Date(instant.getTime() + wanted - asUtc);
  }
  return instant;
}
