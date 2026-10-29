import { DateRangeControls } from "@/components/date-range-controls";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { CommitmentPeriod } from "./commitment-scope";

const formatDate = (date: string) =>
  new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));

export function CommitmentControls({
  kind,
  onKind,
  period,
  range,
  onPeriod,
  onDates,
}: {
  kind: string;
  onKind: (value: string) => void;
  period: CommitmentPeriod;
  range: { from: string; through: string };
  onPeriod: (value: string) => void;
  onDates: (from: string, through: string) => void;
}) {
  const kinds = [
    ["all", "tasks and reminders"],
    ["tasks", "tasks"],
    ["reminders", "reminders"],
  ] as const;
  const rangeLabel =
    period === "custom"
      ? `${formatDate(range.from)} – ${formatDate(range.through)}`
      : period === "today"
        ? "today"
        : `this ${period}`;
  return (
    <h2 id="today-queue-title" aria-label="up next" className="section-title-sentence">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" aria-label="Commitment type">
            {kinds.find(([value]) => value === kind)?.[1]}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup value={kind} onValueChange={onKind} aria-label="Commitment type">
            {kinds.map(([value, label]) => (
              <DropdownMenuRadioItem key={value} value={value}>
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <span>for</span>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" aria-label={`Commitment date range: ${rangeLabel}`}>
            <span className="truncate">{rangeLabel}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          aria-label="Commitment date range"
          className="w-72 max-w-[calc(100vw-2rem)] p-3"
        >
          <DateRangeControls period={period} {...range} onPeriod={onPeriod} onDates={onDates} />
        </PopoverContent>
      </Popover>
    </h2>
  );
}
