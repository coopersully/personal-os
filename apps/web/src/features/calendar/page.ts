/** Calendar-owned route state and query keys. The shell supplies the route outlet. */
export type CalendarView = "day" | "week" | "month";

export const calendarQueryKeys = {
  calendars: ["calendars"] as const,
  events: (view: CalendarView, from: string, to: string) => ["events", view, from, to] as const,
};

export function calendarViewFromSearch(value: string | null, fallback: CalendarView): CalendarView {
  return value === "day" || value === "week" || value === "month" ? value : fallback;
}
