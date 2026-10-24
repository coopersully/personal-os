import type { FinanceSpendingDashboard, FinanceSpendingDrillDown } from "@personal-os/domain";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { formatCalendarDate } from "@/lib/date-format";
import { cn } from "@/lib/utils";
import { formatMoney } from "./format";
import { spendingHourlyBins, spendingRhythmBins } from "./spending-rhythm-bins";
import { spendingBinStatus } from "./spending-trends";

export { spendingHourlyBins } from "./spending-rhythm-bins";

export function FinanceSpendingRhythm({
  dashboard,
  onSelect,
  weekStartsOn = "sunday",
}: {
  dashboard: FinanceSpendingDashboard;
  weekStartsOn?: "sunday" | "monday";
  onSelect: (drillDown: FinanceSpendingDrillDown) => void;
}) {
  const [focused, setFocused] = useState(0);
  const [shown, setShown] = useState<string | null>(null);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const result = spendingRhythmBins(dashboard, weekStartsOn);
  const { hours, untimedCents, untimedCount } = spendingHourlyBins(dashboard);
  const hourly = result.grain === "Hourly";
  const parts = new Map(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: dashboard.snapshot.scope.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(dashboard.snapshot.asOf))
      .map((part) => [part.type, part.value]),
  );
  const today = `${parts.get("year")}-${parts.get("month")}-${parts.get("day")}`;
  const selectedDay = dashboard.snapshot.scope.from;
  const blocks = hourly
    ? hours.map((hour) => {
        const future =
          selectedDay > today || (selectedDay === today && hour.hour > Number(parts.get("hour")));
        const complete =
          !future && dashboard.snapshot.coverage === "complete" && untimedCount === 0;
        const label = `${hour.hour % 12 || 12} ${hour.hour < 12 ? "AM" : "PM"}`;
        return {
          key: String(hour.hour),
          label,
          netCents: hour.netCents,
          refundCents: Math.max(0, -hour.netCents),
          future,
          incomplete: !complete,
          status: hour.count
            ? `${formatMoney(hour.netCents / 100)} recorded${!complete ? " · Incomplete hourly coverage" : ""}`
            : future
              ? "Future hour"
              : complete
                ? "No spending"
                : "Hourly amount unavailable",
          // Hour inspection never claims a date-only transaction link selects an hour.
          drillDown: null as FinanceSpendingDrillDown | null,
        };
      })
    : result.bins.map((bin) => ({
        key: bin.date,
        label: bin.date === bin.through ? bin.date : `${bin.date} – ${bin.through}`,
        netCents: bin.netCents,
        refundCents: bin.negativeAdjustmentCents,
        future: bin.future,
        incomplete: bin.coverage !== "complete",
        status: `${spendingBinStatus(bin)}${bin.partial ? " · Partial period" : ""}`,
        drillDown: bin.drillDown,
      }));
  if (hourly && untimedCount > 0)
    blocks.push({
      key: "untimed",
      label: "Time not provided",
      netCents: untimedCents,
      refundCents: 0,
      future: false,
      incomplete: true,
      status: `${untimedCount} ${untimedCount === 1 ? "item" : "items"} · Purchase times not provided`,
      drillDown: dashboard.snapshot.bins[0]?.drillDown ?? null,
    });
  const maximum = Math.max(1, ...blocks.map((block) => Math.abs(block.netCents)));
  const focusedIndex = Math.min(focused, Math.max(0, blocks.length - 1));
  const selected = blocks[focusedIndex];
  return (
    <section aria-label="Spending rhythm" className="flex min-w-0 flex-col gap-3">
      <h2 className="text-sm font-medium">{result.grain} spending</h2>
      <TooltipProvider delayDuration={150}>
        <fieldset
          aria-label={`${result.grain} spending blocks`}
          className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,3rem),1fr))] gap-2"
        >
          {blocks.map((block, index) => (
            <Tooltip
              key={block.key}
              open={shown === block.key}
              onOpenChange={(open) =>
                setShown((current) => (open ? block.key : current === block.key ? null : current))
              }
            >
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  ref={(element) => {
                    refs.current[index] = element;
                  }}
                  tabIndex={index === focusedIndex ? 0 : -1}
                  aria-label={`${block.label}: ${formatMoney(block.netCents / 100)}; ${block.status}`}
                  className={cn(
                    "relative aspect-square h-auto min-h-0 w-full rounded-sm p-0 text-xs tabular-nums",
                    block.future && "opacity-35",
                    block.incomplete &&
                      !block.future &&
                      "outline-1 -outline-offset-1 outline-dashed outline-border",
                    block.netCents < 0 && "bg-accent text-accent-foreground",
                  )}
                  style={{
                    backgroundColor:
                      block.netCents < 0
                        ? undefined
                        : block.netCents === 0 || block.future
                          ? "var(--secondary)"
                          : `color-mix(in srgb, var(--workspace-finances-accent) ${25 + (Math.abs(block.netCents) / maximum) * 55}%, var(--background))`,
                  }}
                  onFocus={() => setFocused(index)}
                  onClick={() => {
                    if (block.drillDown) onSelect(block.drillDown);
                    else setShown(block.key);
                  }}
                  onKeyDown={(event) => {
                    const grid = event.currentTarget.closest("fieldset");
                    const columns = grid
                      ? getComputedStyle(grid).gridTemplateColumns.split(" ").length
                      : 7;
                    const movement: Record<string, number> = {
                      ArrowLeft: -1,
                      ArrowRight: 1,
                      ArrowUp: -columns,
                      ArrowDown: columns,
                    };
                    const target =
                      event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? blocks.length - 1
                          : event.key in movement
                            ? Math.max(
                                0,
                                Math.min(blocks.length - 1, index + (movement[event.key] ?? 0)),
                              )
                            : null;
                    if (target !== null) {
                      event.preventDefault();
                      setFocused(target);
                      refs.current[target]?.focus();
                    }
                  }}
                >
                  {block.key === "untimed" ? (
                    <span aria-hidden="true">?</span>
                  ) : block.netCents < 0 ? (
                    <span aria-hidden="true">−</span>
                  ) : null}
                </Button>
              </TooltipTrigger>
              <TooltipContent className="flex-col items-start gap-1">
                <span>
                  {hourly
                    ? block.label
                    : block.key === block.label
                      ? formatCalendarDate(block.key)
                      : block.label.split(" – ").map(formatCalendarDate).join(" – ")}
                </span>
                <span className="font-medium tabular-nums">
                  {formatMoney(block.netCents / 100)}
                </span>
                <span>{block.status}</span>
                {block.refundCents > 0 && (
                  <span>Refunds/adjustments −{formatMoney(block.refundCents / 100)}</span>
                )}
              </TooltipContent>
            </Tooltip>
          ))}
        </fieldset>
      </TooltipProvider>
      {selected && (
        <p aria-live="polite" className="sr-only">
          {selected.label}: {formatMoney(selected.netCents / 100)} · {selected.status}
        </p>
      )}
    </section>
  );
}
