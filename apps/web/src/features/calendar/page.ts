import type { LocalDate } from "@personal-os/domain";
import { addLocalDays, startOfLocalWeek } from "@personal-os/domain";

/** Calendar-owned route state and query keys. The shell supplies the route outlet. */
export type CalendarView = "day" | "week" | "month";

export const calendarQueryKeys = {
  calendars: ["calendars"] as const,
  events: (view: CalendarView, from: string, to: string) => ["events", view, from, to] as const,
  status: ["calendar-status"] as const,
};

export function calendarViewFromSearch(value: string | null, fallback: CalendarView): CalendarView {
  return value === "day" || value === "week" || value === "month" ? value : fallback;
}

export function calendarPeriodDays(
  view: CalendarView,
  anchor: LocalDate,
  includeWeekends: boolean,
): LocalDate[] {
  if (view === "day") return [anchor];
  const weekStart = startOfLocalWeek(anchor);
  if (view === "week") {
    return Array.from({ length: includeWeekends ? 7 : 5 }, (_, index) =>
      addLocalDays(weekStart, includeWeekends ? index : index + 1),
    );
  }
  const monthStart = { day: 1, month: anchor.month, year: anchor.year };
  const gridStart = startOfLocalWeek(monthStart);
  return Array.from({ length: 42 }, (_, index) => addLocalDays(gridStart, index));
}
