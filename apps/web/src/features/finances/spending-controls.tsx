import { formatDateOnly } from "@personal-os/domain";
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { SpendingPeriod } from "./spending-period";

export function SpendingChoice({
  label,
  value,
  options,
  onChange,
  disabled = false,
  showLabel = true,
  displayValue,
}: {
  label: string;
  value: string;
  options: ReadonlyArray<readonly [string, string]>;
  onChange: (value: string) => void;
  disabled?: boolean;
  showLabel?: boolean;
  displayValue?: string;
}) {
  if (label === "View")
    return (
      <ToggleGroup
        type="single"
        aria-label={label}
        value={value}
        onValueChange={(next) => next && onChange(next)}
        disabled={disabled}
        size="sm"
        spacing={0}
      >
        {options.map(([id, name]) => (
          <ToggleGroupItem key={id} value={id}>
            {name}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          aria-label={`${label}: ${displayValue ?? options.find(([id]) => id === value)?.[1] ?? "Selected categories"}`}
        >
          {showLabel ? <span className="text-muted-foreground">{label}</span> : null}
          {displayValue ?? options.find(([id]) => id === value)?.[1] ?? "Selected categories"}
          <ChevronDownIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={value} onValueChange={onChange} aria-label={label}>
          {options.map(([id, name]) => (
            <DropdownMenuRadioItem key={id} value={id}>
              {name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
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
