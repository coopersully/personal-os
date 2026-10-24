import type { FinanceSpendingDashboard, FinanceSpendingDrillDown } from "@personal-os/domain";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatCalendarDate } from "@/lib/date-format";
import { cn } from "@/lib/utils";
import { formatMoney } from "./format";
import { spendingBinStatus } from "./spending-trends";

export function FinanceSpendingRhythm({
  dashboard,
  onSelect,
  weekStartsOn = "sunday",
}: {
  dashboard: FinanceSpendingDashboard;
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
