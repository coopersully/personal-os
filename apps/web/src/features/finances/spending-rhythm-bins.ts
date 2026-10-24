import type { FinanceSpendingDailyBin, FinanceSpendingDashboard } from "@personal-os/domain";

/** Only source timestamps can establish an hour; date-only records stay unassigned. */
export function spendingHourlyBins(dashboard: FinanceSpendingDashboard) {
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, netCents: 0, count: 0 }));
  let untimedCents = 0,
    untimedCount = 0;
  const dates = new Map(dashboard.transactions.map((item) => [item.id, item.date]));
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: dashboard.snapshot.scope.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  });
  for (const contribution of dashboard.snapshot.contributions) {
    const timestamp = dates.get(contribution.transactionId);
    const instant =
      timestamp && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp) ? new Date(timestamp) : null;
    const parts =
      instant && Number.isFinite(instant.getTime())
        ? new Map(formatter.formatToParts(instant).map((part) => [part.type, part.value]))
        : null;
    const localDate = parts
      ? `${parts.get("year")}-${parts.get("month")}-${parts.get("day")}`
      : null;
    const bin =
      localDate === contribution.date && localDate === dashboard.snapshot.scope.from
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

const dayMs = 86_400_000;
const date = (value: string) => new Date(`${value}T12:00:00Z`);
const iso = (value: Date) => value.toISOString().slice(0, 10);
const shift = (value: string, days: number) => iso(new Date(date(value).getTime() + days * dayMs));
export function rhythmGrain(from: string, through: string) {
  const days = Math.round((date(through).getTime() - date(from).getTime()) / dayMs) + 1;
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
export function spendingRhythmBins(
  dashboard: FinanceSpendingDashboard,
  weekStartsOn: "sunday" | "monday" = "sunday",
) {
  const { scope, bins } = dashboard.snapshot;
  const grain = rhythmGrain(scope.from, scope.through);
  const grouped = new Map<
    string,
    { from: string; through: string; partial: boolean; days: FinanceSpendingDailyBin[] }
  >();
  for (const bin of bins) {
    if (bin.date < scope.from || bin.date > scope.through) continue;
    const current = date(bin.date);
    const start =
      grain === "Weekly"
        ? shift(bin.date, -((current.getUTCDay() + (weekStartsOn === "monday" ? 6 : 0)) % 7))
        : grain === "Monthly"
          ? `${bin.date.slice(0, 7)}-01`
          : grain === "Yearly"
            ? `${bin.date.slice(0, 4)}-01-01`
            : bin.date;
    const end =
      grain === "Weekly"
        ? shift(start, 6)
        : grain === "Monthly"
          ? iso(new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 0, 12)))
          : grain === "Yearly"
            ? `${bin.date.slice(0, 4)}-12-31`
            : bin.date;
    const from = start < scope.from ? scope.from : start;
    const through = end > scope.through ? scope.through : end;
    const group = grouped.get(from) ?? {
      from,
      through,
      partial: from !== start || through !== end,
      days: [],
    };
    group.days.push(bin);
    grouped.set(from, group);
  }
  return {
    grain,
    bins: [...grouped.values()]
      .sort((a, b) => a.from.localeCompare(b.from))
      .map(({ from, through, partial, days }) => {
        const expected = Math.round((date(through).getTime() - date(from).getTime()) / dayMs) + 1;
        const complete =
          days.length === expected && days.every((day) => day.coverage === "complete");
        return {
          date: from,
          through,
          partial,
          netCents: days.reduce((sum, day) => sum + day.netCents, 0),
          positiveAreaCents: days.reduce((sum, day) => sum + day.positiveAreaCents, 0),
          negativeAdjustmentCents: days.reduce((sum, day) => sum + day.negativeAdjustmentCents, 0),
          pendingCents: days.reduce((sum, day) => sum + day.pendingCents, 0),
          coverage: complete
            ? ("complete" as const)
            : days.every((day) => day.coverage === "unknown")
              ? ("unknown" as const)
              : ("partial" as const),
          provisional: days.some((day) => day.provisional),
          future: days.every((day) => day.future),
          drillDown: {
            scope: { ...scope, from, through },
            contributionIds: [...new Set(days.flatMap((day) => day.drillDown.contributionIds))],
            transactionIds: [...new Set(days.flatMap((day) => day.drillDown.transactionIds))],
          },
        };
      }),
  };
}
