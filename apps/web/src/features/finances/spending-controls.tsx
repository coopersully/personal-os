import { useEffect, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { SpendingPeriod } from "./spending-period";

export { FinanceChoice as SpendingChoice } from "./view-controls";

const localDate = (value: string) => new Date(`${value}T12:00:00`);
const dateKey = (value: Date) =>
  `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
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
  const [draft, setDraft] = useState<{ from: Date | undefined; to?: Date }>({
    from: localDate(from),
    to: localDate(through),
  });
  const [selectingEnd, setSelectingEnd] = useState(false);
  const [month, setMonth] = useState(() => localDate(from));
  useEffect(() => {
    setDraft({ from: localDate(from), to: localDate(through) });
    setMonth(localDate(from));
    setSelectingEnd(false);
  }, [from, through]);
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <ToggleGroup
        type="single"
        size="sm"
        value={period}
        onValueChange={(value) => value && onPeriod(value)}
        aria-label="Period"
        className="grid w-full grid-cols-2"
      >
        {[
          ["today", "Today"],
          ["week", "This week"],
          ["month", "This month"],
          ["custom", "Custom"],
        ].map(([value, label]) => (
          <ToggleGroupItem key={value} value={value ?? ""}>
            {label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {period !== "custom" ? (
        <div className="flex justify-between">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Previous period"
            onClick={() => onMove(-1)}
          >
            <ChevronLeftIcon />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Next period" onClick={() => onMove(1)}>
            <ChevronRightIcon />
          </Button>
        </div>
      ) : null}
      <Calendar
        mode="range"
        month={month}
        onMonthChange={setMonth}
        selected={draft}
        onSelect={(_range, selectedDay) => {
          if (!selectingEnd || !draft.from) {
            setDraft({ from: selectedDay });
            setSelectingEnd(true);
            return;
          }
          const start = draft.from < selectedDay ? draft.from : selectedDay;
          const end = draft.from < selectedDay ? selectedDay : draft.from;
          setDraft({ from: start, to: end });
          setSelectingEnd(false);
          onDates(dateKey(start), dateKey(end));
        }}
      />
      <div className="grid grid-cols-2 gap-2">
        <label
          className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground"
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
          className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground"
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
    </div>
  );
}
