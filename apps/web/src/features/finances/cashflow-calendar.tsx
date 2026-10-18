import {
  type FinanceCashflowScheduleItem,
  type FinanceCashflowScheduleView,
  formatDateOnly,
  localDateToIso,
  parseLocalDate,
} from "@personal-os/domain";
import { Fragment, type ReactNode, useId, useState } from "react";
import { Calendar } from "@/components/ui/calendar";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import { ItemGroup } from "@/components/ui/item";

type Props = {
  schedule: FinanceCashflowScheduleView;
  renderItem: (item: FinanceCashflowScheduleItem) => ReactNode;
};

function calendarDate(value: string) {
  const { year, month, day } = parseLocalDate(value);
  return new Date(year, month - 1, day);
}

function dateOnly(date: Date) {
  return localDateToIso({
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  });
}

export function FinanceCashflowCalendar(props: Props) {
  // A changed range starts a fresh, valid selection and month together.
  return <CashflowCalendarRange key={`${props.schedule.from}:${props.schedule.to}`} {...props} />;
}

function CashflowCalendarRange({ schedule, renderItem }: Props) {
  const [selected, setSelected] = useState(() => calendarDate(schedule.from));
  const [month, setMonth] = useState(() => calendarDate(schedule.from));
  const headingId = useId();
  const selectedDate = dateOnly(selected);
  const items = schedule.dated.filter((item) => item.date === selectedDate);
  const counts = new Map<string, number>();
  for (const item of schedule.dated) {
    if (item.date) counts.set(item.date, (counts.get(item.date) ?? 0) + 1);
  }
  return (
    <div className="flex min-w-0 flex-col gap-6 sm:flex-row">
      <div className="w-full min-w-0 sm:max-w-sm">
        <Calendar
          aria-label="Next expected items calendar"
          mode="single"
          required
          selected={selected}
          month={month}
          onMonthChange={setMonth}
          onSelect={(date) => {
            setSelected(date);
            setMonth(date);
          }}
          startMonth={calendarDate(schedule.from)}
          endMonth={calendarDate(schedule.to)}
          disabled={{ before: calendarDate(schedule.from), after: calendarDate(schedule.to) }}
          showOutsideDays={false}
          animate={false}
          labels={{
            labelDayButton: (date, modifiers) => {
              const iso = dateOnly(date);
              const count = counts.get(iso) ?? 0;
              return `${formatDateOnly(iso, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}, ${count} next expected ${count === 1 ? "item" : "items"}${modifiers.selected ? ", selected" : ""}`;
            },
          }}
          formatters={{
            formatDay: (date) => {
              const count = counts.get(dateOnly(date));
              return count ? `${date.getDate()} · ${count}` : String(date.getDate());
            },
          }}
        />
      </div>
      <section aria-labelledby={headingId} className="flex min-w-0 flex-1 flex-col gap-3">
        <h3 id={headingId} className="text-sm font-medium">
          {formatDateOnly(selectedDate, {
            weekday: "long",
            month: "long",
            day: "numeric",
            year: "numeric",
          })}
        </h3>
        {items.length ? (
          <ItemGroup aria-label="Selected day's next expected items">
            {items.map((item) => (
              <Fragment key={item.key}>{renderItem(item)}</Fragment>
            ))}
          </ItemGroup>
        ) : (
          <Empty>
            <EmptyDescription>No next expected items recorded for this day.</EmptyDescription>
          </Empty>
        )}
      </section>
    </div>
  );
}
