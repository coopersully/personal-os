import type { FinanceSpendingDashboard, FinanceSpendingDrillDown } from "@personal-os/domain";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
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
      <p>Daily net spending · Source {dashboard.source.freshness}</p>
      <p className="text-sm text-muted-foreground">
        Positive spending scale: $0 to {formatMoney(maximum / 100)}. Stronger shading means more
        spending. Refunds, future dates, and missing coverage are labeled separately.
      </p>
      <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
        {months.map((month) => {
          const days = bins.filter((bin) => bin.date.startsWith(month));
          const firstDay = days[0];
          if (!firstDay) return null;
          const offset =
            (new Date(`${firstDay.date}T12:00:00Z`).getUTCDay() +
              (weekStartsOn === "monday" ? 6 : 0)) %
            7;
          return (
            <fieldset key={month} className="min-w-0">
              <legend className="mb-2 font-medium">
                {new Intl.DateTimeFormat(undefined, {
                  month: "long",
                  year: "numeric",
                  timeZone: "UTC",
                }).format(new Date(`${month}-01T12:00:00Z`))}
              </legend>
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
                  const tone = bin.future
                    ? "bg-background text-muted-foreground"
                    : bin.netCents < 0
                      ? "bg-accent text-accent-foreground"
                      : bin.netCents === 0
                        ? bin.coverage === "complete"
                          ? "bg-secondary text-secondary-foreground"
                          : "bg-muted text-muted-foreground"
                        : level < 0.34
                          ? "bg-primary/20 text-foreground"
                          : level < 0.67
                            ? "bg-primary/50 text-foreground"
                            : "bg-primary text-primary-foreground";
                  return (
                    <Button
                      key={bin.date}
                      ref={(element) => {
                        refs.current[index] = element;
                      }}
                      variant="ghost"
                      className={`h-auto min-h-11 min-w-0 flex-col px-0 ${tone}`}
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
                                    Math.min(bins.length - 1, index + (movement[event.key] ?? 0)),
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
                      <span className="text-[10px]">
                        {[
                          bin.future
                            ? "Future"
                            : bin.netCents < 0
                              ? "Refund"
                              : bin.netCents === 0 && bin.coverage === "complete"
                                ? "Zero"
                                : "",
                          bin.coverage === "partial"
                            ? "Partial"
                            : bin.coverage === "unknown"
                              ? "Missing"
                              : "",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </Button>
                  );
                })}
              </div>
            </fieldset>
          );
        })}
      </div>
      {selected && (
        <p aria-live="polite">
          {selected.date}: {formatMoney(selected.netCents / 100)} · Positive spending{" "}
          {formatMoney(selected.positiveAreaCents / 100)} · Refunds/adjustments −
          {formatMoney(selected.negativeAdjustmentCents / 100)} · {spendingBinStatus(selected)}
        </p>
      )}
      <details>
        <summary>Daily spending list</summary>
        <ul className="flex flex-col gap-2">
          {bins.map((bin) => (
            <li key={bin.date}>
              <Button variant="link" onClick={() => onSelect(bin.drillDown)}>
                {bin.date}: {formatMoney(bin.netCents / 100)}
              </Button>
              <span className="text-sm text-muted-foreground">{spendingBinStatus(bin)}</span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
