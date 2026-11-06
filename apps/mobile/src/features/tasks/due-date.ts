import { localDateAt, localDateTimeToUtc } from "@personal-os/domain";
export function isPastDue(value: string | null, now = Date.now()) {
  return !!value && Date.parse(value) < now;
}
export type DueShortcut = "hour" | "tomorrow" | "week";
/** Calendar-day shortcuts use the account timezone, including across DST. */
export function relativeDueDate(shortcut: DueShortcut, timezone: string, now = new Date()) {
  if (shortcut === "hour") return new Date(now.getTime() + 60 * 60_000).toISOString();
  const local = localDateAt(now, timezone);
  const shifted = new Date(
    Date.UTC(local.year, local.month - 1, local.day + (shortcut === "tomorrow" ? 1 : 7)),
  );
  return localDateTimeToUtc(
    { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() },
    9 * 60,
    timezone,
  ).toISOString();
}
