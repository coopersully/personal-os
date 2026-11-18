import { useEffect, useId, useState } from "react";
import { Calendar } from "@/components/ui/calendar";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

const localDate = (value: string) => new Date(`${value}T12:00:00`);
const dateKey = (value: Date) =>
  `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
export function DateRangeControls({
  period,
  from,
  through,
  onPeriod,
  onDates,
}: {
  period: "today" | "week" | "month" | "custom";
  from: string;
  through: string;
  onPeriod: (value: string) => void;
  onDates: (from: string, through: string) => void;
}) {
  const fieldId = useId();
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
    <div data-slot="date-range-controls" className="flex min-w-0 flex-col gap-2">
      <ToggleGroup
        type="single"
        size="sm"
        value={period}
        onValueChange={(value) => value && onPeriod(value)}
        aria-label="Period"
        spacing={0}
        className="grid w-full grid-cols-4"
      >
        {[
          ["today", "Today"],
          ["week", "Week"],
          ["month", "Month"],
          ["custom", "Custom"],
        ].map(([value, label]) => (
          <ToggleGroupItem
            key={value}
            value={value ?? ""}
            aria-label={value === "week" ? "This week" : value === "month" ? "This month" : label}
          >
            {label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
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
      {period === "custom" ? (
        <FieldGroup className="grid grid-cols-2 gap-2">
          <Field className="min-w-0 gap-1">
            <FieldLabel htmlFor={`${fieldId}-from`}>From</FieldLabel>
            <Input
              type="date"
              id={`${fieldId}-from`}
              value={from}
              max={through}
              onChange={(event) => event.target.value && onDates(event.target.value, through)}
            />
          </Field>
          <Field className="min-w-0 gap-1">
            <FieldLabel htmlFor={`${fieldId}-through`}>Through</FieldLabel>
            <Input
              type="date"
              id={`${fieldId}-through`}
              value={through}
              min={from}
              onChange={(event) => event.target.value && onDates(from, event.target.value)}
            />
          </Field>
        </FieldGroup>
      ) : null}
    </div>
  );
}
