import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SpendingPeriod } from "./spending-period";
export function SpendingChoice({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  options: ReadonlyArray<readonly [string, string]>;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="flex min-w-0 flex-wrap items-center gap-1" disabled={disabled}>
      <legend className="text-xs text-muted-foreground">{label}</legend>
      {options.map(([id, name]) => (
        <Button
          key={id}
          type="button"
          size="sm"
          variant={value === id ? "secondary" : "ghost"}
          aria-pressed={value === id}
          onClick={() => onChange(id)}
        >
          {name}
        </Button>
      ))}
    </fieldset>
  );
}
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
    <div className="flex flex-wrap items-end gap-2">
      <SpendingChoice
        label="Period"
        value={period}
        options={[
          ["today", "Today"],
          ["week", "This week"],
          ["month", "This month"],
          ["custom", "Custom"],
        ]}
        onChange={onPeriod}
      />
      {period === "custom" ? (
        <>
          <label className="text-xs" htmlFor="spending-from">
            From
            <Input
              type="date"
              id="spending-from"
              value={from}
              max={through}
              onChange={(event) => event.target.value && onDates(event.target.value, through)}
            />
          </label>
          <label className="text-xs" htmlFor="spending-through">
            Through
            <Input
              type="date"
              id="spending-through"
              value={through}
              min={from}
              onChange={(event) => event.target.value && onDates(from, event.target.value)}
            />
          </label>
        </>
      ) : (
        <>
          <Button variant="ghost" aria-label="Previous period" onClick={() => onMove(-1)}>
            Previous
          </Button>
          <Button variant="ghost" aria-label="Next period" onClick={() => onMove(1)}>
            Next
          </Button>
        </>
      )}
    </div>
  );
}
