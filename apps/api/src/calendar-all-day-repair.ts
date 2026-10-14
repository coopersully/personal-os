import { normalizeProviderAllDayRange } from "@personal-os/domain";

/** Read repair for legacy Google mirrors; normal provider synchronization persists the same range. */
export function repairCalendarAllDayRange(row: {
  allDay: boolean;
  provider: string;
  timezone: string;
  startsAt: Date;
  endsAt: Date;
  raw?: Record<string, unknown> | null;
}): { startsAt: Date; endsAt: Date } {
  const original = { startsAt: row.startsAt, endsAt: row.endsAt };
  if (!row.allDay || row.provider !== "google" || !row.raw) return original;
  const start = row.raw.start;
  const end = row.raw.end;
  if (
    !start ||
    typeof start !== "object" ||
    !("date" in start) ||
    typeof start.date !== "string" ||
    !end ||
    typeof end !== "object" ||
    !("date" in end) ||
    typeof end.date !== "string"
  )
    return original;
  try {
    return normalizeProviderAllDayRange(start.date, end.date, row.timezone);
  } catch {
    return original;
  }
}
