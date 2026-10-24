import type { FinanceSpendingDashboard, FinanceSpendingDrillDown } from "@personal-os/domain";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatCalendarDate } from "@/lib/date-format";
import { cn } from "@/lib/utils";
import { formatMoney } from "./format";
import { spendingBinStatus } from "./spending-trends";

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
function HourlyRhythm({
  dashboard,
  onSelect,
}: {
  dashboard: FinanceSpendingDashboard;
  onSelect: (drillDown: FinanceSpendingDrillDown) => void;
}) {
  const { hours, untimedCents, untimedCount } = spendingHourlyBins(dashboard);
  const [shownHour, setShownHour] = useState<number | null>(null);
  const maximum = Math.max(1, ...hours.map((bin) => Math.abs(bin.netCents)));
  const asOf = new Intl.DateTimeFormat("en-CA", {
    timeZone: dashboard.snapshot.scope.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(dashboard.snapshot.asOf));
  const parts = new Map(asOf.map((part) => [part.type, part.value]));
  const today = `${parts.get("year")}-${parts.get("month")}-${parts.get("day")}`;
  const selectedDay = dashboard.snapshot.scope.from;
  const hourLabel = (hour: number) => `${hour % 12 || 12} ${hour < 12 ? "AM" : "PM"}`;
  return (
    <section aria-label="Spending rhythm" className="min-w-0">
      <Card>
        <CardHeader>
          <CardTitle>Hourly spending</CardTitle>
          <CardDescription>
            {formatCalendarDate(selectedDay)} · {dashboard.snapshot.scope.timezone}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <TooltipProvider delayDuration={150}>
            <fieldset
              className="grid min-w-0 grid-cols-6 gap-2 sm:grid-cols-12"
              aria-label="Spending by hour"
            >
              {hours.map((bin) => {
                const future =
                  selectedDay > today ||
                  (selectedDay === today && bin.hour > Number(parts.get("hour")));
                const complete =
                  !future && dashboard.snapshot.coverage === "complete" && untimedCount === 0;
                const status = bin.count
                  ? `${formatMoney(bin.netCents / 100)} recorded`
                  : future
                    ? "Future hour"
                    : complete
                      ? "No spending"
                      : "Hourly amount unavailable";
                return (
                  <Tooltip
                    key={bin.hour}
                    open={shownHour === bin.hour}
                    onOpenChange={(open) => setShownHour(open ? bin.hour : null)}
                  >
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        onClick={() => setShownHour(bin.hour)}
                        aria-label={`${hourLabel(bin.hour)}: ${status}`}
                        className={cn(
                          "aspect-square h-auto min-h-0 min-w-0 rounded-md p-0 text-xs tabular-nums",
                          future ? "text-muted-foreground opacity-50" : "text-foreground",
                        )}
                        style={{
                          backgroundColor: bin.count
                            ? `color-mix(in srgb, var(--workspace-finances-accent) ${25 + (Math.abs(bin.netCents) / maximum) * 40}%, var(--card))`
                            : "var(--secondary)",
                        }}
                      >
                        {hourLabel(bin.hour)}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {status}
                      {!complete && !future && bin.count > 0 ? " · Incomplete hourly coverage" : ""}
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </fieldset>
          </TooltipProvider>
          {untimedCount > 0 && (
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground">
                Time not provided · {untimedCount} {untimedCount === 1 ? "item" : "items"}
              </span>
              <span className="font-medium tabular-nums">{formatMoney(untimedCents / 100)}</span>
            </div>
          )}
          {untimedCount > 0 && (
            <p className="text-xs text-muted-foreground">
              These transactions have a date but no purchase time.
            </p>
          )}
          {dashboard.snapshot.bins[0] && (
            <Button
              variant="ghost"
              size="sm"
              className="self-start"
              onClick={() => {
                const bin = dashboard.snapshot.bins[0];
                if (bin) onSelect(bin.drillDown);
              }}
            >
              View day’s transactions
            </Button>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

export function FinanceSpendingRhythm({
  dashboard,
  onSelect,
  weekStartsOn = "sunday",
  hourly = false,
}: {
  dashboard: FinanceSpendingDashboard;
  hourly?: boolean;
  weekStartsOn?: "sunday" | "monday";
  onSelect: (drillDown: FinanceSpendingDrillDown) => void;
}) {
  const bins = dashboard.snapshot.bins;
  const [focused, setFocused] = useState(0);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const maximum = Math.max(1, ...bins.map((bin) => Math.max(0, bin.netCents)));
  const months = [...new Set(bins.map((bin) => bin.date.slice(0, 7)))];
  const focusedIndex = Math.min(focused, Math.max(0, bins.length - 1));
  const selected = bins[focusedIndex];
  const weekdays =
    weekStartsOn === "monday"
      ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
      : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  if (hourly) return <HourlyRhythm dashboard={dashboard} onSelect={onSelect} />;
  return (
    <section aria-label="Spending rhythm" className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 px-1">
        <h2 className="text-sm font-medium">Daily spending</h2>
        <div
          role="img"
          aria-label={`Positive spending scale: $0 to ${formatMoney(maximum / 100)}`}
          className="flex items-center gap-1 text-xs text-muted-foreground"
        >
          <span className="mr-1">Less</span>
          {[0, 0.2, 0.45, 0.7, 1].map((level) => (
            <span
              key={level}
              aria-hidden="true"
              className="size-3 rounded-sm"
              style={{
                backgroundColor: `color-mix(in srgb, var(--workspace-finances-accent) ${level * 100}%, var(--secondary))`,
              }}
            />
          ))}
          <span className="ml-1">More</span>
        </div>
      </div>
      <TooltipProvider delayDuration={150}>
        <div
          className={cn(
            "grid min-w-0 gap-4",
            months.length === 1 ? "max-w-md" : "sm:grid-cols-2 xl:grid-cols-3",
          )}
        >
          {months.map((month) => {
            const days = bins.filter((bin) => bin.date.startsWith(month));
            const firstDay = days[0];
            if (!firstDay) return null;
            const offset =
              (new Date(`${firstDay.date}T12:00:00Z`).getUTCDay() +
                (weekStartsOn === "monday" ? 6 : 0)) %
              7;
            return (
              <Card key={month} size="sm">
                <CardHeader>
                  <CardTitle>
                    {new Intl.DateTimeFormat(undefined, {
                      month: "long",
                      year: "numeric",
                      timeZone: "UTC",
                    }).format(new Date(`${month}-01T12:00:00Z`))}
                  </CardTitle>
                  <CardDescription>
                    {formatMoney(days.reduce((sum, day) => sum + day.netCents, 0) / 100)}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <fieldset className="min-w-0" aria-label={month}>
                    <div className="grid grid-cols-7 gap-1">
                      {weekdays.map((day) => (
                        <span key={day} className="text-center text-xs text-muted-foreground">
                          {day}
                        </span>
                      ))}
                      {Array.from({ length: offset }, (_, index) => (
                        <span
                          key={
                            [
                              "Sunday",
                              "Monday",
                              "Tuesday",
                              "Wednesday",
                              "Thursday",
                              "Friday",
                              "Saturday",
                            ][index]
                          }
                          data-calendar-padding="true"
                          aria-hidden="true"
                        />
                      ))}
                      {days.map((bin) => {
                        const index = bins.indexOf(bin);
                        const level = bin.netCents / maximum;
                        const status = spendingBinStatus(bin);
                        const color =
                          bin.future || (bin.netCents === 0 && bin.coverage !== "complete")
                            ? undefined
                            : bin.netCents === 0
                              ? "var(--secondary)"
                              : `color-mix(in srgb, var(--workspace-finances-accent) ${Math.round(25 + Math.max(0, level) * 55)}%, var(--card))`;
                        return (
                          <Tooltip key={bin.date}>
                            <TooltipTrigger asChild>
                              <Button
                                ref={(element) => {
                                  refs.current[index] = element;
                                }}
                                variant="ghost"
                                className={cn(
                                  "relative aspect-square h-auto min-h-0 min-w-0 flex-col rounded-md p-0 tabular-nums hover:brightness-110 focus-visible:outline-2 focus-visible:outline-foreground",
                                  bin.future
                                    ? "text-muted-foreground opacity-50"
                                    : "text-foreground",
                                  bin.netCents < 0 &&
                                    !bin.future &&
                                    "bg-accent text-accent-foreground",
                                  bin.coverage !== "complete" &&
                                    !bin.future &&
                                    "outline-1 -outline-offset-1 outline-dashed outline-border",
                                )}
                                style={{
                                  backgroundColor:
                                    bin.netCents < 0 && !bin.future ? undefined : color,
                                }}
                                tabIndex={focusedIndex === index ? 0 : -1}
                                aria-label={`${bin.date}: ${formatMoney(bin.netCents / 100)}; ${spendingBinStatus(bin)}`}
                                onFocus={() => setFocused(index)}
                                onClick={() => onSelect(bin.drillDown)}
                                onKeyDown={(event) => {
                                  const movement: Record<string, number> = {
                                    ArrowLeft: -1,
                                    ArrowRight: 1,
                                    ArrowUp: -7,
                                    ArrowDown: 7,
                                  };
                                  const target =
                                    event.key === "Home"
                                      ? 0
                                      : event.key === "End"
                                        ? bins.length - 1
                                        : event.key in movement
                                          ? Math.max(
                                              0,
                                              Math.min(
                                                bins.length - 1,
                                                index + (movement[event.key] ?? 0),
                                              ),
                                            )
                                          : null;
                                  if (target !== null) {
                                    event.preventDefault();
                                    setFocused(target);
                                    refs.current[target]?.focus();
                                  }
                                }}
                              >
                                <span>{Number(bin.date.slice(8))}</span>
                                {bin.netCents < 0 && !bin.future && (
                                  <span
                                    aria-hidden="true"
                                    className="absolute bottom-0 text-[9px] leading-none"
                                  >
                                    −
                                  </span>
                                )}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent className="flex-col items-start gap-1">
                              <span>{formatCalendarDate(bin.date)}</span>
                              <span className="font-medium tabular-nums">
                                {formatMoney(bin.netCents / 100)}
                              </span>
                              <span>{status}</span>
                              {bin.negativeAdjustmentCents > 0 && (
                                <span>
                                  Refunds/adjustments −
                                  {formatMoney(bin.negativeAdjustmentCents / 100)}
                                </span>
                              )}
                            </TooltipContent>
                          </Tooltip>
                        );
                      })}
                    </div>
                  </fieldset>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </TooltipProvider>
      {selected && (
        <p aria-live="polite" className="sr-only">
          {selected.date}: {formatMoney(selected.netCents / 100)} · Positive spending{" "}
          {formatMoney(selected.positiveAreaCents / 100)} · Refunds/adjustments −
          {formatMoney(selected.negativeAdjustmentCents / 100)} · {spendingBinStatus(selected)}
        </p>
      )}
    </section>
  );
}
