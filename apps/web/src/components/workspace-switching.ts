import type { CalendarEvent, FinanceOverview, LocalDate, User } from "@personal-os/domain";
import { addLocalDays, localDateAt, localDateRange, parseLocalDate } from "@personal-os/domain";
import {
  type CalendarView,
  calendarPeriodDays,
  calendarViewFromSearch,
} from "../features/calendar/page.js";
import { formatMoney } from "../features/finances/format.js";

export const workspaceIntentStaleTime = 30_000;
export const workspaceSwitcherRowHeight = 44;
export const workspaceSwitcherGroupGap = 9;

export function workspaceIndicatorOffset(index: number): number {
  return index * workspaceSwitcherRowHeight + (index > 0 ? workspaceSwitcherGroupGap : 0);
}

export function getWorkspaceCalendarEntry(
  user: User,
  search = window.location.search,
): {
  range: { from: string; to: string };
  view: CalendarView;
} {
  const searchParams = new URLSearchParams(search);
  const defaultView: CalendarView =
    typeof window.matchMedia === "function" && window.matchMedia("(max-width: 560px)").matches
      ? "day"
      : "week";
  const view = calendarViewFromSearch(searchParams.get("view"), defaultView);
  const requestedAnchor = searchParams.get("date");
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(requestedAnchor ?? "")
    ? parseLocalDate(requestedAnchor as string)
    : localDateAt(new Date(), user.planningTimezone);
  const days = calendarPeriodDays(view, anchor, searchParams.get("weekends") !== "0");
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
  return `${formatMoney(overview.spendingThisMonth)} spent this month`;
}
