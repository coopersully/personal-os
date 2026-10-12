import {
  addLocalDays as addDays,
  type CalendarEvent,
  type LocalDate,
  localDateAt,
  parseLocalDate,
} from "@personal-os/domain";

type SearchResult = { date: LocalDate; detail: string; key: string; label: string };

export function calendarSearchResults(
  query: string,
  events: CalendarEvent[],
  timeZone: string,
  now = new Date(),
): SearchResult[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  const dateResult = parseCalendarDateQuery(normalized, timeZone, now);
  const matchingEvents = events
    .filter((event) =>
      [event.title, event.location, event.notes]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(normalized)),
    )
    .slice(0, 7)
    .map((event) => ({
      date: localDateAt(new Date(event.startsAt), timeZone),
      detail: new Intl.DateTimeFormat("en", {
        day: "numeric",
        hour: event.allDay ? undefined : "numeric",
        minute: event.allDay ? undefined : "2-digit",
        month: "short",
        timeZone,
        year: "numeric",
      }).format(new Date(event.startsAt)),
      key: `event:${event.id}`,
      label: event.title,
    }));
  return dateResult ? [dateResult, ...matchingEvents] : matchingEvents;
}

export function parseCalendarDateQuery(
  query: string,
  timeZone: string,
  now = new Date(),
): SearchResult | undefined {
  query = query.trim().toLowerCase();
  const today = localDateAt(now, timeZone);
  const relativeDays: Record<string, number> = { today: 0, tomorrow: 1, yesterday: -1 };
  if (Object.hasOwn(relativeDays, query)) {
    const date = addDays(today, relativeDays[query] as number);
    return dateSearchResult(query, date);
  }
  const weekday =
    /^(?:(next|last|this) )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/.exec(
      query,
    );
  if (weekday) {
    const names = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    const currentDay = calendarDate(today).getUTCDay();
    const target = names.indexOf(weekday[2] as string);
    const forward = (target - currentDay + 7) % 7;
    const offset =
      weekday[1] === "last"
        ? forward === 0
          ? -7
          : forward - 7
        : weekday[1] === "next" && forward === 0
          ? 7
          : forward;
    return dateSearchResult(query, addDays(today, offset));
  }
  const christmas = /^(last|next) christmas$/.exec(query);
  if (christmas) {
    const candidate = { day: 25, month: 12, year: today.year };
    const direction = christmas[1];
    const date =
      direction === "last"
        ? {
            ...candidate,
            year: compareLocalDates(candidate, today) < 0 ? today.year : today.year - 1,
          }
        : {
            ...candidate,
            year: compareLocalDates(candidate, today) > 0 ? today.year : today.year + 1,
          };
    return dateSearchResult(`${direction} Christmas`, date);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(query)) {
    const date = parseLocalDate(query);
    if (
      date.month >= 1 &&
      date.month <= 12 &&
      date.day >= 1 &&
      date.day <= daysInCalendarMonth(date.month, date.year)
    ) {
      return dateSearchResult(query, date);
    }
    return undefined;
  }
  const namedDate =
    /^(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:,?\s+(\d{4}))?$/.exec(
      query,
    );
  const numericDate = /^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{4}))?$/.exec(query);
  const month = namedDate
    ? calendarMonthNumber(namedDate[1] as string)
    : Number(numericDate?.[1] ?? 0);
  const day = Number(namedDate?.[2] ?? numericDate?.[2] ?? 0);
  const year = Number(namedDate?.[3] ?? numericDate?.[3] ?? today.year);
  if (month >= 1 && month <= 12 && day >= 1 && day <= daysInCalendarMonth(month, year)) {
    return dateSearchResult(query, { day, month, year });
  }
  return undefined;
}

function calendarMonthNumber(value: string) {
  return (
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(
      value.slice(0, 3),
    ) + 1
  );
}

function daysInCalendarMonth(month: number, year: number) {
  return new Date(Date.UTC(year, month, 0, 12)).getUTCDate();
}

function calendarDate(date: LocalDate) {
  return new Date(Date.UTC(date.year, date.month - 1, date.day, 12));
}
function compareLocalDates(left: LocalDate, right: LocalDate) {
  return calendarDate(left).getTime() - calendarDate(right).getTime();
}
function dateSearchResult(label: string, date: LocalDate): SearchResult {
  return {
    date,
    detail: new Intl.DateTimeFormat("en", { dateStyle: "full", timeZone: "UTC" }).format(
      calendarDate(date),
    ),
    key: `date:${date.year}-${date.month}-${date.day}`,
    label,
  };
}
