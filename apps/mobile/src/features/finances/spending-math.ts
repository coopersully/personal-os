import type {
  FinanceSpendingDailyBin,
  FinanceSpendingDashboard,
  FinanceSpendingDrillDown,
  FinanceSpendingScope,
} from "@personal-os/domain";
import { formatMoney } from "./presentation";

/**
 * Period, comparison and bin arithmetic for Spending. These mirror the web rules so the same
 * selection produces the same ranges and groups on every device; amounts stay server-calculated.
 */
export type SpendingPeriod = "today" | "week" | "month" | "custom";
export type WeekStart = "sunday" | "monday";

const dayMs = 86_400_000;
const date = (value: string) => new Date(`${value}T12:00:00Z`);
const iso = (value: Date) => value.toISOString().slice(0, 10);
export const shiftDate = (value: string, days: number) =>
  iso(new Date(date(value).getTime() + days * dayMs));
export const daysBetween = (from: string, through: string) =>
  Math.round((date(through).getTime() - date(from).getTime()) / dayMs) + 1;

export function isCalendarDay(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && iso(date(value)) === value;
}

/** The local calendar day in the account timezone, never the device's. */
export function spendingToday(timezone: string, now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function spendingRange(
  period: SpendingPeriod,
  today: string,
  weekStartsOn: WeekStart,
  custom?: { from: string; through: string },
) {
  if (period === "custom") return custom ?? { from: today, through: today };
  if (period === "today") return { from: today, through: today };
  if (period === "week") {
    const day = date(today).getUTCDay();
    const from = shiftDate(today, -((day - (weekStartsOn === "monday" ? 1 : 0) + 7) % 7));
    return { from, through: shiftDate(from, 6) };
  }
  const from = `${today.slice(0, 7)}-01`;
  const start = date(from);
  const next = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1, 12));
  return { from, through: shiftDate(iso(next), -1) };
}

/** A custom range the API accepts: real days, in order, within its 3660-day limit. */
export function customRangeProblem(from: string, through: string) {
  if (!isCalendarDay(from) || !isCalendarDay(through)) return "Choose a start and an end date.";
  if (from > through) return "The start date must be on or before the end date.";
  if (daysBetween(from, through) > 3660) return "Choose a range of ten years or less.";
  return null;
}

/** The selection up to today, and the equal span before it that Trends compares against. */
export function spendingComparisonScopes(
  scope: FinanceSpendingScope,
  period: SpendingPeriod,
  today: string,
) {
  const current = {
    ...scope,
    through:
      period !== "custom" && scope.from <= today && today < scope.through ? today : scope.through,
  };
  const count = daysBetween(current.from, current.through);
  let previousFrom = shiftDate(current.from, -count);
  let previousThrough = shiftDate(current.from, -1);
  let label = "Previous equal-length period";
  if (period === "today") label = "Previous day";
  if (period === "week") {
    previousFrom = shiftDate(scope.from, -7);
    previousThrough = shiftDate(previousFrom, count - 1);
    label = count < 7 ? "Previous week · equal elapsed days" : "Previous week";
  }
  if (period === "month") {
    const start = date(scope.from);
    previousFrom = iso(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 1, 12)));
    const previousEnd = shiftDate(scope.from, -1);
    previousThrough =
      current.through === scope.through
        ? previousEnd
        : shiftDate(previousFrom, Math.min(count, daysBetween(previousFrom, previousEnd)) - 1);
    label =
      current.through < scope.through ? "Previous month · equal elapsed days" : "Previous month";
    if (current.through < scope.through && daysBetween(previousFrom, previousThrough) < count)
      label += " · capped at month end";
  }
  return { current, previous: { ...scope, from: previousFrom, through: previousThrough }, label };
}

export type SpendingBin = {
  date: string;
  through: string;
  netCents: number;
  negativeAdjustmentCents: number;
  pendingCents: number;
  coverage: FinanceSpendingDailyBin["coverage"];
  provisional: boolean;
  future: boolean;
  partial: boolean;
  drillDown: FinanceSpendingDrillDown;
};

/** Written state of a bin, so coverage and pending are never carried by colour alone. */
export function spendingBinStatus(bin: SpendingBin) {
  return [
    bin.future
      ? "Future"
      : bin.coverage !== "complete"
        ? `${bin.coverage === "unknown" ? "Missing" : "Partial"} coverage`
        : bin.netCents === 0
          ? "No spending"
          : bin.netCents < 0
            ? "Net refund"
            : "Spending",
    bin.provisional ? "Provisional" : "",
    bin.pendingCents !== 0 ? `Pending ${formatMoney(bin.pendingCents / 100, "USD")}` : "",
    bin.partial ? "Partial period" : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function combine(
  scope: FinanceSpendingScope,
  from: string,
  through: string,
  partial: boolean,
  days: readonly FinanceSpendingDailyBin[],
): SpendingBin {
  const sum = (read: (day: FinanceSpendingDailyBin) => number) =>
    days.reduce((total, day) => total + read(day), 0);
  return {
    date: from,
    through,
    partial,
    netCents: sum((day) => day.netCents),
    negativeAdjustmentCents: sum((day) => day.negativeAdjustmentCents),
    pendingCents: sum((day) => day.pendingCents),
    coverage:
      days.length === daysBetween(from, through) && days.every((day) => day.coverage === "complete")
        ? "complete"
        : days.every((day) => day.coverage === "unknown")
          ? "unknown"
          : "partial",
    provisional: days.some((day) => day.provisional),
    future: days.every((day) => day.future),
    drillDown: {
      scope: { ...scope, from, through },
      contributionIds: [...new Set(days.flatMap((day) => day.drillDown.contributionIds))],
      transactionIds: [...new Set(days.flatMap((day) => day.drillDown.transactionIds))],
    },
  };
}

function grouped(
  dashboard: FinanceSpendingDashboard,
  bounds: (day: string) => { start: string; end: string },
) {
  const { scope, bins } = dashboard.snapshot;
  const groups = new Map<
    string,
    { from: string; through: string; partial: boolean; days: FinanceSpendingDailyBin[] }
  >();
  for (const bin of bins) {
    if (bin.date < scope.from || bin.date > scope.through) continue;
    const { start, end } = bounds(bin.date);
    const from = start < scope.from ? scope.from : start;
    const through = end > scope.through ? scope.through : end;
    const group = groups.get(from) ?? {
      from,
      through,
      partial: from !== start || through !== end,
      days: [],
    };
    group.days.push(bin);
    groups.set(from, group);
  }
  return [...groups.values()]
    .sort((a, b) => a.from.localeCompare(b.from))
    .map((group) => combine(scope, group.from, group.through, group.partial, group.days));
}

const monthBounds = (day: string) => {
  const value = date(day);
  return {
    start: `${day.slice(0, 7)}-01`,
    end: iso(new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0, 12))),
  };
};

/** Trends: days up to a month, weeks counted from the range start up to half a year, then months. */
export function spendingTrendBins(dashboard: FinanceSpendingDashboard) {
  const { from, through } = dashboard.snapshot.scope;
  const length = daysBetween(from, through);
  const grain = length <= 31 ? "Daily" : length <= 180 ? "Weekly" : "Monthly";
  return {
    grain,
    bins: grouped(dashboard, (day) => {
      if (grain === "Daily") return { start: day, end: day };
      if (grain === "Monthly") return monthBounds(day);
      const start = shiftDate(from, Math.floor((daysBetween(from, day) - 1) / 7) * 7);
      return { start, end: shiftDate(start, 6) };
    }),
  } as const;
}

export function rhythmGrain(from: string, through: string) {
  const days = daysBetween(from, through);
  return days === 1
    ? "Hourly"
    : days <= 62
      ? "Daily"
      : days <= 366
        ? "Weekly"
        : days <= 1096
          ? "Monthly"
          : "Yearly";
}

/** Rhythm: calendar days, calendar weeks, months or years, by the length of the range. */
export function spendingRhythmBins(dashboard: FinanceSpendingDashboard, weekStartsOn: WeekStart) {
  const { from, through } = dashboard.snapshot.scope;
  const grain = rhythmGrain(from, through);
  return {
    grain,
    bins: grouped(dashboard, (day) => {
      if (grain === "Weekly") {
        const start = shiftDate(
          day,
          -((date(day).getUTCDay() + (weekStartsOn === "monday" ? 6 : 0)) % 7),
        );
        return { start, end: shiftDate(start, 6) };
      }
      if (grain === "Monthly") return monthBounds(day);
      if (grain === "Yearly")
        return { start: `${day.slice(0, 4)}-01-01`, end: `${day.slice(0, 4)}-12-31` };
      return { start: day, end: day };
    }),
  } as const;
}

/** Only a source timestamp can establish an hour; date-only records stay unassigned. */
export function spendingHourlyBins(dashboard: FinanceSpendingDashboard) {
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, netCents: 0, count: 0 }));
  let untimedCents = 0;
  let untimedCount = 0;
  const { scope, contributions } = dashboard.snapshot;
  const dates = new Map(dashboard.transactions.map((item) => [item.id, item.date]));
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: scope.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  });
  for (const contribution of contributions) {
    const timestamp = dates.get(contribution.transactionId);
    const instant =
      timestamp && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp) ? new Date(timestamp) : null;
    const parts =
      instant && Number.isFinite(instant.getTime())
        ? new Map(formatter.formatToParts(instant).map((part) => [part.type, part.value]))
        : null;
    const local = parts ? `${parts.get("year")}-${parts.get("month")}-${parts.get("day")}` : null;
    const bin =
      local === contribution.date && local >= scope.from && local <= scope.through
        ? hours[Number(parts?.get("hour"))]
        : undefined;
    if (bin) {
      bin.netCents += contribution.netCents;
      bin.count++;
    } else {
      untimedCents += contribution.netCents;
      untimedCount++;
    }
  }
  return { hours, untimedCents, untimedCount };
}

/** A weekday offset for laying days out under their column, from the chosen week start. */
export function weekdayOffset(day: string, weekStartsOn: WeekStart) {
  return (date(day).getUTCDay() - (weekStartsOn === "monday" ? 1 : 0) + 7) % 7;
}

export function binLabel(bin: { date: string; through: string }) {
  // A range that leaves the current year names it, so two Januaries are never confused.
  const year = bin.date.slice(0, 4) !== bin.through.slice(0, 4);
  const format = (value: string) =>
    date(value).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      ...(year ? { year: "numeric" } : {}),
      timeZone: "UTC",
    });
  return bin.date === bin.through
    ? format(bin.date)
    : `${format(bin.date)} – ${format(bin.through)}`;
}
