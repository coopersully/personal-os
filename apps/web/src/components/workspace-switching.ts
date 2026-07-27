import type { CalendarEvent, FinanceOverview, LocalDate, User } from "@personal-os/domain";
import { addLocalDays, localDateAt, localDateRange } from "@personal-os/domain";
import { type CalendarView, calendarPeriodDays } from "../features/calendar/page.js";

export const workspaceIntentStaleTime = 30_000;

export function getWorkspaceCalendarEntry(user: User): {
  range: { from: string; to: string };
  view: CalendarView;
} {
  const view: CalendarView =
    typeof window.matchMedia === "function" && window.matchMedia("(max-width: 560px)").matches
      ? "day"
      : "week";
  const anchor = localDateAt(new Date(), user.planningTimezone);
  const days = calendarPeriodDays(view, anchor, true);
  return {
    range: localDateRange(
      days[0] as LocalDate,
      addLocalDays(days[days.length - 1] as LocalDate, 1),
      user.planningTimezone,
    ),
    view,
  };
}

function eventOverlapsDay(event: CalendarEvent, day: LocalDate, timeZone: string) {
  const range = localDateRange(day, addLocalDays(day, 1), timeZone);
  return (
    new Date(event.startsAt).getTime() < new Date(range.to).getTime() &&
    new Date(event.endsAt).getTime() > new Date(range.from).getTime()
  );
}

function formatPreviewMoney(value: number) {
  return new Intl.NumberFormat(undefined, {
    currency: "USD",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(value);
}

export function workspaceTodaySummary(
  weather: { location: { shortLabel: string }; temperatureF: number } | undefined,
  fallbackLocation: string | undefined,
) {
  if (weather) return `${Math.round(weather.temperatureF)}° · ${weather.location.shortLabel}`;
  if (fallbackLocation) return `Weather · ${fallbackLocation}`;
  return "Weather · Set location";
}

export function workspaceCalendarSummary(events: CalendarEvent[] | undefined, user: User): string {
  if (!events) return "Loading calendar…";
  const today = localDateAt(new Date(), user.planningTimezone);
  const todayEvents = events.filter((event) =>
    eventOverlapsDay(event, today, user.planningTimezone),
  );
  if (todayEvents.length === 0) return "No events today";
  const remaining = todayEvents.filter((event) => new Date(event.endsAt) > new Date()).length;
  return `${todayEvents.length} ${todayEvents.length === 1 ? "event" : "events"} today · ${remaining} left`;
}

export function workspaceCountSummary(
  count: number | undefined,
  singular: string,
  empty: string,
  plural = `${singular}s`,
) {
  if (count === undefined) return "Loading…";
  if (count === 0) return empty;
  return `${count} ${count === 1 ? singular : plural}`;
}

export function workspaceFinanceSummary(overview: FinanceOverview | undefined) {
  if (!overview) return "Loading finances…";
  if (overview.reviewCount > 0) return `${overview.reviewCount} to review`;
  return `${formatPreviewMoney(overview.spendingThisMonth)} spent this month`;
}
