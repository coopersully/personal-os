import { formatDateOnly } from "@personal-os/domain";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SpendingPeriod } from "./spending-period";
import { FinanceChoice as SpendingChoice } from "./view-controls";

export { FinanceChoice as SpendingChoice } from "./view-controls";
export function SpendingPeriodControls({
  period,
  from,
  through,
  onPeriod,
  onDates,
  onMove,
}: {
  period: SpendingPeriod;
  from: string;
  through: string;
  onPeriod: (value: string) => void;
  onDates: (from: string, through: string) => void;
  onMove: (direction: number) => void;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      {period !== "custom" ? (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Previous period"
          onClick={() => onMove(-1)}
        >
          <ChevronLeftIcon />
        </Button>
      ) : null}
      <SpendingChoice
        label="Period"
        {...(period === "month"
          ? { displayValue: formatDateOnly(from, { month: "long", year: "numeric" }) }
          : {})}
        showLabel={false}
        value={period}
        options={[
          ["today", "Today"],
          ["week", "This week"],
          ["month", "This month"],
          ["custom", "Custom"],
        ]}
        onChange={onPeriod}
      />
      {period !== "custom" ? (
        <Button variant="ghost" size="icon-sm" aria-label="Next period" onClick={() => onMove(1)}>
          <ChevronRightIcon />
        </Button>
      ) : (
        <div className="flex min-w-0 flex-wrap gap-2">
          <label
            className="flex items-center gap-2 text-xs text-muted-foreground"
            htmlFor="spending-from"
          >
            From
            <Input
              type="date"
              id="spending-from"
              value={from}
              max={through}
              onChange={(event) => event.target.value && onDates(event.target.value, through)}
            />
          </label>
          <label
            className="flex items-center gap-2 text-xs text-muted-foreground"
            htmlFor="spending-through"
          >
            Through
            <Input
              type="date"
              id="spending-through"
              value={through}
              min={from}
              onChange={(event) => event.target.value && onDates(from, event.target.value)}
            />
          </label>
        </div>
      )}
    </div>
  );
}
