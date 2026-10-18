/** Confirmed schedule evidence; a next-expected date alone is not a schedule anchor. */
export interface RecurringScheduleEvidence {
  scheduleVersionId: string;
  sourceId: string;
  sourceRevision: number;
  confirmed: boolean;
  timezone: string;
  currencyCode: string;
  amountCents: number;
  anchorLocalDate: string | null;
  cadence:
    | "weekly"
    | "biweekly"
    | "semimonthly"
    | "monthly"
    | "quarterly"
    | "yearly"
    | "irregular"
    | "unknown";
  semimonthlyDays?: readonly [number, number];
  sourceReferences: readonly string[];
}

export interface RecurringOccurrence {
  id: string;
  scheduleVersionId: string;
  sourceId: string;
  sourceRevision: number;
  timezone: string;
  localDate: string;
  slot: number;
  amountCents: number;
  currencyCode: string;
  certainty: "expected";
  sourceReferences: readonly string[];
}

type UnavailableReason =
  | "unconfirmed_schedule"
  | "unknown_cadence"
  | "irregular_cadence"
  | "missing_anchor"
  | "missing_semimonthly_days";
export type RecurringOccurrenceExpansion =
  | { status: "unavailable"; reason: UnavailableReason; occurrences: [] }
  | { status: "available"; occurrences: RecurringOccurrence[] };

const DAY_MS = 86_400_000;
function localDate(value: string): Date {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value) || value.startsWith("0000"))
    throw new RangeError("Expected a local ISO date in years 0001 through 9999.");
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value)
    throw new RangeError("Invalid local ISO date.");
  return parsed;
}
function nonempty(value: string) {
  return typeof value === "string" && value.trim().length > 0;
}

/** Date-only expansion: timezone identifies the schedule, never an inferred execution instant. */
export function expandRecurringOccurrences(
  schedule: RecurringScheduleEvidence,
  range: { fromLocalDate: string; toLocalDate: string },
): RecurringOccurrenceExpansion {
  const from = localDate(range.fromLocalDate);
  const to = localDate(range.toLocalDate);
  const days = (to.getTime() - from.getTime()) / DAY_MS + 1;
  if (days < 1 || days > 366)
    throw new RangeError("Query range must contain 1 through 366 local dates.");
  if (
    !nonempty(schedule.scheduleVersionId) ||
    !nonempty(schedule.sourceId) ||
    !Number.isSafeInteger(schedule.sourceRevision) ||
    schedule.sourceRevision < 1
  )
    throw new RangeError("Explicit schedule version and source revision are required.");
  if (!nonempty(schedule.timezone)) throw new RangeError("Explicit timezone required.");
  new Intl.DateTimeFormat("en", { timeZone: schedule.timezone });
  if (
    !Number.isSafeInteger(schedule.amountCents) ||
    schedule.amountCents < 0 ||
    schedule.amountCents > 10_000_000_000
  )
    throw new RangeError("Expected bounded nonnegative integer cents.");
  if (
    !/^[A-Z]{3}$/.test(schedule.currencyCode) ||
    !Intl.supportedValuesOf("currency").includes(schedule.currencyCode) ||
    new Intl.NumberFormat("en", {
      style: "currency",
      currency: schedule.currencyCode,
    }).resolvedOptions().maximumFractionDigits !== 2
  )
    throw new RangeError("Explicit recognized two-minor-digit currency required.");
  if (!schedule.sourceReferences.every(nonempty))
    throw new RangeError("Source references must be nonempty.");
  const unavailable = (reason: UnavailableReason): RecurringOccurrenceExpansion => ({
    status: "unavailable",
    reason,
    occurrences: [],
  });
  if (!schedule.confirmed) return unavailable("unconfirmed_schedule");
  if (schedule.cadence === "unknown") return unavailable("unknown_cadence");
  if (schedule.cadence === "irregular") return unavailable("irregular_cadence");
  if (schedule.anchorLocalDate === null) return unavailable("missing_anchor");
  const anchor = localDate(schedule.anchorLocalDate);
  if (schedule.cadence === "semimonthly") {
    if (!schedule.semimonthlyDays) return unavailable("missing_semimonthly_days");
    if (
      schedule.semimonthlyDays.length !== 2 ||
      schedule.semimonthlyDays.some((day) => !Number.isInteger(day) || day < 1 || day > 31) ||
      schedule.semimonthlyDays[0] === schedule.semimonthlyDays[1]
    )
      throw new RangeError("Semimonthly requires two distinct explicit days from 1 through 31.");
  }
  // Sort explicit days so slot identity is independent of their input order.
  const semimonthlyDays = [...(schedule.semimonthlyDays ?? [])].sort((a, b) => a - b);
  const occurrences: RecurringOccurrence[] = [];
  for (let dayOffset = 0; dayOffset < days; dayOffset++) {
    const current = new Date(from.getTime() + dayOffset * DAY_MS);
    if (current < anchor) continue;
    const monthOffset =
      (current.getUTCFullYear() - anchor.getUTCFullYear()) * 12 +
      current.getUTCMonth() -
      anchor.getUTCMonth();
    const monthEnd = new Date(current.getTime());
    monthEnd.setUTCFullYear(current.getUTCFullYear(), current.getUTCMonth() + 1, 0);
    const clamp = (day: number) => Math.min(day, monthEnd.getUTCDate());
    const slots: number[] = [];
    if (schedule.cadence === "weekly" || schedule.cadence === "biweekly") {
      if (
        ((current.getTime() - anchor.getTime()) / DAY_MS) %
          (schedule.cadence === "weekly" ? 7 : 14) ===
        0
      )
        slots.push(0);
    } else if (schedule.cadence === "semimonthly") {
      semimonthlyDays.forEach((day, slot) => {
        if (current.getUTCDate() === clamp(day)) slots.push(slot);
      });
    } else {
      const step = schedule.cadence === "monthly" ? 1 : schedule.cadence === "quarterly" ? 3 : 12;
      if (monthOffset % step === 0 && current.getUTCDate() === clamp(anchor.getUTCDate()))
        slots.push(0);
    }
    for (const slot of slots) {
      if (occurrences.length >= 5000) throw new RangeError("Occurrence limit exceeded.");
      const date = current.toISOString().slice(0, 10);
      occurrences.push({
        id: JSON.stringify([schedule.scheduleVersionId, date, slot]),
        scheduleVersionId: schedule.scheduleVersionId,
        sourceId: schedule.sourceId,
        sourceRevision: schedule.sourceRevision,
        timezone: schedule.timezone,
        localDate: date,
        slot,
        amountCents: schedule.amountCents,
        currencyCode: schedule.currencyCode,
        certainty: "expected",
        sourceReferences: [...schedule.sourceReferences],
      });
    }
  }
  return { status: "available", occurrences };
}
