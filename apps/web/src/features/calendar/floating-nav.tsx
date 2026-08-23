import type { Calendar, CalendarEvent, LocalDate, User } from "@personal-os/domain";
import {
  localDateAt,
  localDateRange,
  localDateTimeToUtc,
  parseLocalDate,
} from "@personal-os/domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarIcon, PlusIcon, SearchIcon, ShieldCheckIcon, XIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Calendar as DatePicker } from "@/components/ui/calendar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "../../api.js";
import { invalidateMaterial } from "../../lib/material-queries.js";

type FloatingMode = "closed" | "create" | "date" | "search";

type CalendarFloatingNavProps = {
  anchor: LocalDate;
  calendars: Calendar[];
  onNavigate: (date: LocalDate) => void;
  timeZone: string;
  user: User;
};

export function CalendarFloatingNav({
  anchor,
  calendars,
  onNavigate,
  timeZone,
  user,
}: CalendarFloatingNavProps) {
  const [mode, setMode] = useState<FloatingMode>("closed");
  const close = () => setMode("closed");

  return (
    <div className="calendar-floating-nav" data-mode={mode}>
      {mode === "closed" ? (
        <nav aria-label="Calendar actions" className="calendar-floating-nav__pill">
          <Button
            aria-label="Choose date"
            onClick={() => setMode("date")}
            size="icon"
            variant="ghost"
          >
            <CalendarIcon aria-hidden="true" />
          </Button>
          <Button
            aria-label="Search calendar"
            onClick={() => setMode("search")}
            size="icon"
            variant="ghost"
          >
            <SearchIcon aria-hidden="true" />
          </Button>
          <Button asChild size="icon" variant="ghost">
            <Link aria-label="Schedule health" to="/calendar/review">
              <ShieldCheckIcon aria-hidden="true" />
            </Link>
          </Button>
          <Button
            aria-label="Create event"
            onClick={() => setMode("create")}
            size="icon"
            variant="ghost"
          >
            <PlusIcon aria-hidden="true" />
          </Button>
        </nav>
      ) : mode === "date" ? (
        <DateJumpCard anchor={anchor} close={close} onNavigate={onNavigate} timeZone={timeZone} />
      ) : mode === "search" ? (
        <CalendarSearchCard
          anchor={anchor}
          close={close}
          onNavigate={onNavigate}
          timeZone={timeZone}
        />
      ) : (
        <InlineEventComposer calendars={calendars} close={close} timeZone={timeZone} user={user} />
      )}
    </div>
  );
}

function DateJumpCard({
  anchor,
  close,
  onNavigate,
  timeZone,
}: {
  anchor: LocalDate;
  close: () => void;
  onNavigate: (date: LocalDate) => void;
  timeZone: string;
}) {
  const selected = calendarDate(anchor);
  return (
    <Card aria-label="Jump to date" className="calendar-floating-nav__card" size="sm">
      <CardHeader>
        <CardTitle>Jump to date</CardTitle>
        <CloseButton close={close} />
      </CardHeader>
      <CardContent>
        <section aria-label="Calendar date picker">
          <DatePicker
            captionLayout="dropdown"
            endMonth={new Date(Date.UTC(anchor.year + 25, 11, 1, 12))}
            mode="single"
            month={selected}
            onMonthChange={(date) => onNavigate(localDateAt(date, timeZone))}
            onSelect={(date) => {
              if (!date) return;
              onNavigate(localDateAt(date, timeZone));
              close();
            }}
            selected={selected}
            startMonth={new Date(Date.UTC(anchor.year - 25, 0, 1, 12))}
            timeZone={timeZone}
          />
        </section>
      </CardContent>
    </Card>
  );
}

function CalendarSearchCard({
  anchor,
  close,
  onNavigate,
  timeZone,
}: {
  anchor: LocalDate;
  close: () => void;
  onNavigate: (date: LocalDate) => void;
  timeZone: string;
}) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const input = useRef<HTMLInputElement>(null);
  const searchRange = useMemo(
    () =>
      localDateRange(
        { day: 1, month: 1, year: anchor.year - 1 },
        { day: 1, month: 1, year: anchor.year + 2 },
        timeZone,
      ),
    [anchor.year, timeZone],
  );
  const events = useQuery({
    queryFn: () => api.listEvents(searchRange),
    queryKey: ["events", "calendar-search", searchRange.from, searchRange.to],
    staleTime: 60_000,
  });
  const results = useMemo(
    () => calendarSearchResults(deferredQuery, events.data ?? [], timeZone),
    [deferredQuery, events.data, timeZone],
  );

  useEffect(() => input.current?.focus(), []);

  const selectDate = (date: LocalDate) => {
    onNavigate(date);
    close();
  };

  return (
    <Card aria-label="Search calendar" className="calendar-floating-nav__search" size="sm">
      <CardContent>
        <InputGroup>
          <InputGroupAddon>
            <SearchIcon aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Search events and dates"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search events or try “last Christmas”"
            ref={input}
            value={query}
          />
          <InputGroupAddon align="inline-end">
            <Button aria-label="Close search" onClick={close} size="icon-xs" variant="ghost">
              <XIcon aria-hidden="true" />
            </Button>
          </InputGroupAddon>
        </InputGroup>
        {query.trim() ? (
          <div
            aria-label="Calendar search results"
            className="calendar-search-results"
            role="listbox"
          >
            {results.length === 0 ? (
              <p>{events.isPending ? "Searching…" : "No matching events or dates."}</p>
            ) : (
              results.map((result) => (
                <button
                  key={result.key}
                  onClick={() => selectDate(result.date)}
                  role="option"
                  type="button"
                >
                  <span>{result.label}</span>
                  <small>{result.detail}</small>
                </button>
              ))
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

type SearchResult = { date: LocalDate; detail: string; key: string; label: string };

export function calendarSearchResults(
  query: string,
  events: CalendarEvent[],
  timeZone: string,
  now = new Date(),
): SearchResult[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return [];
  const dateResult = parseCalendarDateQuery(normalized, timeZone, now);
  const matchingEvents = events
    .filter((event) =>
      [event.title, event.location, event.notes]
        .filter(Boolean)
        .some((value) => value?.toLocaleLowerCase().includes(normalized)),
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
  query = query.trim().toLocaleLowerCase();
  const today = localDateAt(now, timeZone);
  const relativeDays: Record<string, number> = { today: 0, tomorrow: 1, yesterday: -1 };
  if (query in relativeDays) {
    const date = addDays(today, relativeDays[query] as number);
    return dateSearchResult(query, date);
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

function InlineEventComposer({
  calendars,
  close,
  timeZone,
}: {
  calendars: Calendar[];
  close: () => void;
  timeZone: string;
  user: User;
}) {
  const queryClient = useQueryClient();
  const writable = calendars.filter((calendar) => calendar.isWritable);
  const start = roundToQuarterHour(new Date(Date.now() + 30 * 60_000));
  const mutation = useMutation({
    mutationFn: (input: Parameters<typeof api.createEvent>[0]) => api.createEvent(input),
    onSuccess: async () => {
      await invalidateMaterial(queryClient);
      close();
    },
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    mutation.mutate({
      allDay: form.get("allDay") === "on",
      calendarId: String(form.get("calendarId")),
      endsAt: dateTimeLocalToIso(String(form.get("endsAt")), timeZone),
      location: nullable(form.get("location")),
      notes: nullable(form.get("notes")),
      startsAt: dateTimeLocalToIso(String(form.get("startsAt")), timeZone),
      timezone: timeZone,
      title: String(form.get("title")).trim(),
    });
  };

  return (
    <Card aria-label="Create event" className="calendar-floating-nav__composer">
      <CardHeader>
        <CardTitle>Create event</CardTitle>
        <CloseButton close={close} />
      </CardHeader>
      <CardContent>
        <form onSubmit={submit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="floating-event-title">Description</FieldLabel>
              <Input autoFocus id="floating-event-title" name="title" required />
            </Field>
            <div className="calendar-event-composer__time">
              <Field>
                <FieldLabel htmlFor="floating-event-start">Starts</FieldLabel>
                <Input
                  defaultValue={toDateTimeLocal(start, timeZone)}
                  id="floating-event-start"
                  name="startsAt"
                  required
                  type="datetime-local"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="floating-event-end">Ends</FieldLabel>
                <Input
                  defaultValue={toDateTimeLocal(new Date(start.getTime() + 60 * 60_000), timeZone)}
                  id="floating-event-end"
                  name="endsAt"
                  required
                  type="datetime-local"
                />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="floating-event-calendar">Calendar</FieldLabel>
              <NativeSelect
                className="w-full"
                defaultValue={writable[0]?.id}
                id="floating-event-calendar"
                name="calendarId"
                required
              >
                {writable.map((calendar) => (
                  <NativeSelectOption key={calendar.id} value={calendar.id}>
                    {calendar.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field orientation="horizontal">
              <FieldLabel htmlFor="floating-event-all-day">All day</FieldLabel>
              <Switch id="floating-event-all-day" name="allDay" />
            </Field>
            <Field>
              <FieldLabel htmlFor="floating-event-location">Location</FieldLabel>
              <Input id="floating-event-location" name="location" />
            </Field>
            <Field>
              <FieldLabel htmlFor="floating-event-notes">Notes</FieldLabel>
              <Textarea id="floating-event-notes" name="notes" rows={3} />
            </Field>
            {mutation.isError ? (
              <p className="calendar-floating-nav__error" role="alert">
                {errorMessage(mutation.error)}
              </p>
            ) : null}
            <Button disabled={mutation.isPending || writable.length === 0} type="submit">
              <PlusIcon data-icon="inline-start" />
              {mutation.isPending ? "Creating…" : "Create event"}
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}

function CloseButton({ close }: { close: () => void }) {
  return (
    <Button
      aria-label="Close"
      className="calendar-floating-nav__close"
      onClick={close}
      size="icon-sm"
      variant="ghost"
    >
      <XIcon aria-hidden="true" />
    </Button>
  );
}

function calendarDate(date: LocalDate) {
  return new Date(Date.UTC(date.year, date.month - 1, date.day, 12));
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

function addDays(date: LocalDate, amount: number): LocalDate {
  const value = calendarDate(date);
  value.setUTCDate(value.getUTCDate() + amount);
  return { day: value.getUTCDate(), month: value.getUTCMonth() + 1, year: value.getUTCFullYear() };
}

function compareLocalDates(left: LocalDate, right: LocalDate) {
  return calendarDate(left).getTime() - calendarDate(right).getTime();
}

function roundToQuarterHour(date: Date) {
  const result = new Date(date);
  result.setMinutes(Math.ceil(result.getMinutes() / 15) * 15, 0, 0);
  return result;
}

function toDateTimeLocal(date: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      day: "2-digit",
      hour: "2-digit",
      hour12: false,
      minute: "2-digit",
      month: "2-digit",
      timeZone,
      year: "numeric",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${String(Number(parts.hour) % 24).padStart(2, "0")}:${parts.minute}`;
}

function dateTimeLocalToIso(value: string, timeZone: string) {
  const [dateValue, timeValue] = value.split("T");
  const date = parseLocalDate(dateValue as string);
  const [hour, minute] = (timeValue as string).split(":").map(Number);
  return localDateTimeToUtc(
    date,
    (hour as number) * 60 + (minute as number),
    timeZone,
  ).toISOString();
}

function nullable(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text || null;
}
