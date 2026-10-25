export function formatOrdinalDate(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "long",
    timeZone,
    weekday: "long",
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const day = Number(values.get("day"));

  return `${values.get("weekday")}, ${values.get("month")} ${day}${ordinalSuffix(day)}`;
}

export function formatMaterialDateTime(
  value: string,
  timeZone: string,
  { includeYear = false }: { includeYear?: boolean } = {},
): string {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone,
    ...(includeYear ? { year: "numeric" } : {}),
  }).format(new Date(value));
}

export function formatRelativeMaterialDateTime(
  value: string,
  timeZone: string,
  { now = new Date() }: { now?: Date } = {},
): string {
  const date = new Date(value);
  const dayDifference = localDayNumber(date, timeZone) - localDayNumber(now, timeZone);
  const relativeDay = (() => {
    if (dayDifference === -1) return "Yesterday";
    if (dayDifference === 0) return "Today";
    if (dayDifference === 1) return "Tomorrow";
    return dayDifference < 0 ? `${Math.abs(dayDifference)} days ago` : `in ${dayDifference} days`;
  })();

  const time = new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(date);
  return `${relativeDay}, ${time}`;
}

function localDayNumber(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "numeric",
    timeZone,
    year: "numeric",
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return (
    Date.UTC(
      Number(values.get("year")),
      Number(values.get("month")) - 1,
      Number(values.get("day")),
    ) / 86_400_000
  );
}

export function ordinalSuffix(value: number): "st" | "nd" | "rd" | "th" {
  const remainder = Math.abs(value) % 100;
  if (remainder >= 11 && remainder <= 13) return "th";

  switch (remainder % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

/** A calendar date is not an instant: format in UTC to preserve its written day. */
export function formatCalendarDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/** Relative labels compare calendar days in the user's zone, never elapsed hours. */
export function formatRelativeCalendarDate(
  value: string,
  timeZone: string,
  { now = new Date() }: { now?: Date } = {},
): string {
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return value;
  const difference = date.getTime() / 86_400_000 - localDayNumber(now, timeZone);
  if (difference === 0) return "Today";
  if (difference === -1) return "Yesterday";
  if (difference === 1) return "Tomorrow";
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
    ...(date.getUTCFullYear() !==
    new Date(localDayNumber(now, timeZone) * 86_400_000).getUTCFullYear()
      ? { year: "numeric" as const }
      : {}),
  }).format(date);
}

/** Display labels for a date-only value or an instant, compared by calendar day in its zone. */
export function dateDisplayLabels(value: string, timeZone: string, now = new Date()) {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/u.test(value);
  const date = new Date(dateOnly ? `${value}T00:00:00Z` : value);
  if (!Number.isFinite(date.getTime()) || (dateOnly && date.toISOString().slice(0, 10) !== value))
    return null;
  const day = dateOnly ? date.getTime() / 86_400_000 : localDayNumber(date, timeZone);
  const difference = day - localDayNumber(now, timeZone);
  return {
    absolute: new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: dateOnly ? "UTC" : timeZone,
    }).format(date),
    relative:
      difference === 0
        ? "Today"
        : difference === -1
          ? "Yesterday"
          : difference === 1
            ? "Tomorrow"
            : difference < 0
              ? `${Math.abs(difference)} days ago`
              : `in ${difference} days`,
    nearby: Math.abs(difference) <= 1,
  };
}
