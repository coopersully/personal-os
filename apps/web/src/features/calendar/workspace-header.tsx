import {
  addLocalDays,
  type LocalDate,
  localDateAt,
  localDateToIso,
  parseLocalDate,
  type User,
} from "@personal-os/domain";
import { type ReactNode, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import {
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ColumnsIcon,
  GridIcon,
  type Icon,
  LocationFixedIcon,
} from "@/components/icons";
import { Button as ShadcnButton } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWorkspacePreferences } from "../workspace-search/preferences.js";
import { type CalendarView, calendarPeriodDays, calendarViewFromSearch } from "./page.js";

const calendarViews: Array<{ icon: Icon; label: string; value: CalendarView }> = [
  { icon: CalendarIcon, label: "Day", value: "day" },
  { icon: ColumnsIcon, label: "Week", value: "week" },
  { icon: GridIcon, label: "Month", value: "month" },
];

export function CalendarAppBarIdentity({
  user,
  workspaceSwitcher,
}: {
  user: User;
  workspaceSwitcher: ReactNode;
}) {
  const [searchParams] = useSearchParams();
  const compactMedia =
    typeof window.matchMedia === "function" ? window.matchMedia("(max-width: 560px)") : undefined;
  const preferences = useWorkspacePreferences("calendar");
  const storedView = preferences.data?.preferences.calendarView;
  const defaultView: CalendarView =
    storedView && storedView !== "auto" ? storedView : compactMedia?.matches ? "day" : "week";
  const view = calendarViewFromSearch(searchParams.get("view"), defaultView);
  const includeWeekends = searchParams.has("weekends")
    ? searchParams.get("weekends") !== "0"
    : (preferences.data?.preferences.showWeekends ?? true);
  const requestedAnchor = searchParams.get("date");
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(requestedAnchor ?? "")
    ? parseLocalDate(requestedAnchor as string)
    : localDateAt(new Date(), user.planningTimezone);
  const days = useMemo(
    () => calendarPeriodDays(view, anchor, includeWeekends),
    [anchor, includeWeekends, view],
  );
  const start = days[0] as LocalDate;
  const end = days[days.length - 1] as LocalDate;
  const title =
    view === "day"
      ? formatLocalDate(start, { day: "numeric", month: "long", weekday: "long", year: "numeric" })
      : view === "week"
        ? calendarOrientationWeekTitle(start, end)
        : formatLocalDate(anchor, { month: "long", year: "numeric" });
  const compactTitle =
    view === "day"
      ? formatLocalDate(start, { day: "numeric", month: "short" })
      : view === "week"
        ? `${formatLocalDate(start, { month: "short" })} ${start.day}–${start.month === end.month ? "" : `${formatLocalDate(end, { month: "short" })} `}${end.day}`
        : formatLocalDate(anchor, { month: "short", year: "numeric" });

  return (
    <div className="calendar-app-bar__identity-cluster">
      {workspaceSwitcher ? (
        <div className="calendar-workspace-switcher">{workspaceSwitcher}</div>
      ) : null}
      <div className="calendar-app-bar__orientation">
        <h2 aria-label={title}>
          <span className="calendar-app-bar__title-full">{title}</span>
          <span aria-hidden="true" className="calendar-app-bar__title-compact">
            {compactTitle}
          </span>
        </h2>
      </div>
    </div>
  );
}

function calendarOrientationWeekTitle(start: LocalDate, end: LocalDate) {
  if (start.year === end.year && start.month === end.month) {
    return `${formatLocalDate(start, { month: "long" })} ${start.day}–${end.day}, ${start.year}`;
  }
  if (start.year === end.year) {
    return `${formatLocalDate(start, { day: "numeric", month: "short" })}–${formatLocalDate(end, { day: "numeric", month: "short" })}, ${start.year}`;
  }
  return `${formatLocalDate(start, { day: "numeric", month: "short", year: "numeric" })}–${formatLocalDate(end, { day: "numeric", month: "short", year: "numeric" })}`;
}

export function CalendarAppBarControls({
  onToday,
  user,
  accounts,
}: {
  onToday: () => void;
  user: User;
  accounts: ReactNode;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const compactMedia =
    typeof window.matchMedia === "function" ? window.matchMedia("(max-width: 560px)") : undefined;
  const preferences = useWorkspacePreferences("calendar");
  const storedView = preferences.data?.preferences.calendarView;
  const defaultView: CalendarView =
    storedView && storedView !== "auto" ? storedView : compactMedia?.matches ? "day" : "week";
  const requestedView = searchParams.get("view");
  const view = calendarViewFromSearch(requestedView, defaultView);
  const requestedAnchor = searchParams.get("date");
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(requestedAnchor ?? "")
    ? parseLocalDate(requestedAnchor as string)
    : localDateAt(new Date(), user.planningTimezone);
  const updateCalendarState = (updates: Record<string, null | string>) =>
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(updates)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      return next;
    });
  const movePeriod = (direction: -1 | 1) => {
    const date =
      view === "day"
        ? addLocalDays(anchor, direction)
        : view === "week"
          ? addLocalDays(anchor, direction * 7)
          : addCalendarMonths(anchor, direction);
    updateCalendarState({ date: localDateToIso(date), follow: "0" });
  };
  const selectView = (value: string) => {
    if (value === "day" || value === "week" || value === "month") {
      updateCalendarState({ view: value });
    }
  };
  const goToToday = () => {
    updateCalendarState({
      date: localDateToIso(localDateAt(new Date(), user.planningTimezone)),
      follow: "1",
    });
    onToday();
  };
  const ViewIcon = calendarViews.find((option) => option.value === view)?.icon ?? CalendarIcon;
  return (
    <fieldset className="calendar-app-bar__controls">
      <legend className="sr-only">Calendar controls</legend>
      <div className="calendar-app-bar__control-set">
        <div className="calendar-app-bar__compact-view">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <ShadcnButton aria-label={`Calendar view: ${view}`} size="icon" variant="ghost">
                <ViewIcon aria-hidden="true" />
              </ShadcnButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup value={view} onValueChange={selectView}>
                {calendarViews.map((option) => (
                  <DropdownMenuRadioItem key={option.value} value={option.value}>
                    <option.icon aria-hidden="true" />
                    {option.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {accounts}
        <div className="calendar-app-bar__period-navigation">
          <ShadcnButton
            aria-label="Today"
            aria-pressed={
              (searchParams.has("follow")
                ? searchParams.get("follow") !== "0"
                : (preferences.data?.preferences.autoFollowToday ?? true)) &&
              (!requestedAnchor ||
                requestedAnchor === localDateToIso(localDateAt(new Date(), user.planningTimezone)))
            }
            title="Follow today"
            className="calendar-app-bar__today"
            onClick={goToToday}
            size="icon"
            variant="ghost"
          >
            <LocationFixedIcon aria-hidden="true" data-icon="inline-start" />
          </ShadcnButton>
          <ShadcnButton
            aria-label={`Previous ${view}`}
            onClick={() => movePeriod(-1)}
            size="icon"
            variant="ghost"
          >
            <ChevronLeftIcon aria-hidden="true" />
          </ShadcnButton>
          <ShadcnButton
            aria-label={`Next ${view}`}
            onClick={() => movePeriod(1)}
            size="icon"
            variant="ghost"
          >
            <ChevronRightIcon aria-hidden="true" />
          </ShadcnButton>
        </div>
      </div>
    </fieldset>
  );
}

function addCalendarMonths(date: LocalDate, amount: number): LocalDate {
  const monthIndex = date.month - 1 + amount;
  const year = date.year + Math.floor(monthIndex / 12);
  const month = (((monthIndex % 12) + 12) % 12) + 1;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { day: Math.min(date.day, daysInMonth), month, year };
}

function formatLocalDate(date: LocalDate, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en", { ...options, timeZone: "UTC" }).format(
    new Date(Date.UTC(date.year, date.month - 1, date.day, 12)),
  );
}
