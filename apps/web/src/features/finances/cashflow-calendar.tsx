import { formatDateOnly, localDateToIso, parseLocalDate } from "@personal-os/domain";
import { Fragment, type ReactNode, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import { ItemGroup } from "@/components/ui/item";

type CalendarItem = { key: string; date: string | null };
type Props<T extends CalendarItem> = {
  schedule: { from: string; to: string; today: string; dated: T[] };
  renderItem: (item: T) => ReactNode;
  itemLabel?: string;
  pageSize?: number;
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

export function FinanceCashflowCalendar<T extends CalendarItem>(props: Props<T>) {
  // A changed range starts a fresh, valid selection and month together.
  return <CashflowCalendarRange key={`${props.schedule.from}:${props.schedule.to}`} {...props} />;
}

function CashflowCalendarRange<T extends CalendarItem>({
  schedule,
  renderItem,
  itemLabel = "next expected item",
  pageSize,
}: Props<T>) {
  const [selected, setSelected] = useState(() => calendarDate(schedule.from));
  const [page, setPage] = useState(0);
  const [month, setMonth] = useState(() => calendarDate(schedule.from));
  const headingId = useId();
  const selectedDate = dateOnly(selected);
  const items = schedule.dated.filter((item) => item.date === selectedDate);
  const visiblePage = pageSize
    ? Math.min(page, Math.max(0, Math.ceil(items.length / pageSize) - 1))
    : 0;
  const visibleItems = pageSize
    ? items.slice(visiblePage * pageSize, (visiblePage + 1) * pageSize)
    : items;
  const counts = new Map<string, number>();
  for (const item of schedule.dated) {
    if (item.date) counts.set(item.date, (counts.get(item.date) ?? 0) + 1);
  }
  return (
    <div className="flex min-w-0 flex-col gap-6 sm:flex-row">
      <div className="w-full min-w-0 sm:max-w-sm">
        <Calendar
          aria-label={`${itemLabel[0]?.toUpperCase()}${itemLabel.slice(1)}s calendar`}
          today={calendarDate(schedule.today)}
          mode="single"
          required
          selected={selected}
          month={month}
          onMonthChange={setMonth}
          onSelect={(date) => {
            setPage(0);
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
              return `${formatDateOnly(iso, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}, ${count} ${itemLabel}${count === 1 ? "" : "s"}${modifiers.selected ? ", selected" : ""}`;
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
          <ItemGroup aria-label={`Selected day's ${itemLabel}s`}>
            {visibleItems.map((item) => (
              <Fragment key={item.key}>{renderItem(item)}</Fragment>
            ))}
          </ItemGroup>
        ) : (
          <Empty>
            <EmptyDescription>No {itemLabel}s recorded for this day.</EmptyDescription>
          </Empty>
        )}
        {pageSize && items.length > pageSize ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              disabled={visiblePage === 0}
              onClick={() => setPage(visiblePage - 1)}
            >
              Previous occurrences
            </Button>
            <span className="text-sm">
              Page {visiblePage + 1} of {Math.ceil(items.length / pageSize)}
            </span>
            <Button
              variant="outline"
              disabled={(visiblePage + 1) * pageSize >= items.length}
              onClick={() => setPage(visiblePage + 1)}
            >
              Next occurrences
            </Button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
