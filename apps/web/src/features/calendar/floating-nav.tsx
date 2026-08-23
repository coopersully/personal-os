import type {
  Calendar,
  CalendarEvent,
  LocalDate,
  User,
  WeatherLocationOption,
} from "@personal-os/domain";
import {
  localDateAt,
  localDateRange,
  localDateTimeToUtc,
  parseLocalDate,
} from "@personal-os/domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type CSSProperties,
  type FormEvent,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";
import {
  CalendarIcon,
  CheckIcon,
  ChevronDownIcon,
  ExternalLinkIcon,
  MapPinIcon,
  PlusIcon,
  SearchIcon,
  ShieldCheckIcon,
  VideoAddIcon,
  XIcon,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Calendar as DatePicker } from "@/components/ui/calendar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "../../api.js";
import { invalidateMaterial } from "../../lib/material-queries.js";

type FloatingMode = "closed" | "create" | "date" | "search";
type ConferenceChoice = "google_meet" | "link" | "none";

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

function EventLocationPicker() {
  const [inputValue, setInputValue] = useState("");
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<WeatherLocationOption | null>(null);
  const deferredQuery = useDeferredValue(inputValue.trim());
  const locations = useQuery({
    enabled: deferredQuery.length >= 2,
    queryFn: () => api.searchWeatherLocations(deferredQuery),
    queryKey: ["event-location-search", deferredQuery],
    retry: false,
    staleTime: 5 * 60_000,
  });
  return (
    <Field>
      <FieldLabel className="sr-only" htmlFor="floating-event-location">
        Location
      </FieldLabel>
      <Combobox
        autoHighlight
        filter={null}
        inputValue={inputValue}
        itemToStringLabel={(location: WeatherLocationOption) => location.label}
        items={locations.data ?? []}
        onInputValueChange={(nextValue, { reason }) => {
          if (reason === "item-press") return;
          setInputValue(nextValue);
          setSelected(null);
          setOpen(nextValue.trim().length >= 2);
        }}
        onOpenChange={setOpen}
        onValueChange={(nextValue, { reason }) => {
          setSelected(nextValue);
          if (reason === "item-press") {
            setInputValue(nextValue?.label ?? "");
            setOpen(false);
          }
          if (nextValue === null && (reason === "clear-press" || reason === "input-clear")) {
            setInputValue("");
            setOpen(false);
          }
        }}
        open={open}
        value={selected}
      >
        <ComboboxInput
          aria-label="Location"
          autoComplete="off"
          id="floating-event-location"
          name="location"
          onFocus={() => setOpen(true)}
          placeholder="Search or add a location"
          showClear
        >
          <InputGroupAddon>
            <MapPinIcon aria-hidden="true" />
          </InputGroupAddon>
        </ComboboxInput>
        <ComboboxContent aria-busy={locations.isFetching || undefined}>
          {deferredQuery.length < 2 ? (
            <p className="px-2 py-2 text-sm text-muted-foreground">
              Type at least two characters for suggestions.
            </p>
          ) : null}
          {locations.isFetching ? (
            <p className="px-2 py-2 text-sm text-muted-foreground">Searching locations…</p>
          ) : null}
          {locations.isError ? (
            <p className="px-2 py-2 text-sm text-destructive" role="alert">
              Location suggestions are unavailable. You can still enter a location.
            </p>
          ) : null}
          <ComboboxEmpty>
            {deferredQuery.length >= 2 && !locations.isFetching && !locations.isError
              ? "No matching locations. Your entry will still be saved."
              : null}
          </ComboboxEmpty>
          <ComboboxList>
            {(location: WeatherLocationOption) => (
              <ComboboxItem key={location.label} value={location}>
                {location.label}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </Field>
  );
}

function EventDateTimeControl({
  allDay,
  date,
  label,
  onDateChange,
  onTimeChange,
  referenceYear,
  time,
  timeZone,
}: {
  allDay: boolean;
  date: LocalDate;
  label: "Ends" | "Starts";
  onDateChange: (date: LocalDate) => void;
  onTimeChange: (time: string) => void;
  referenceYear: number;
  time: string;
  timeZone: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = calendarDate(date);
  const dateLabel = new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
    year: date.year === referenceYear ? undefined : "numeric",
  }).format(selected);
  return (
    <Field>
      <FieldLabel className="sr-only">{label} date and time</FieldLabel>
      <div className="calendar-event-composer__date-time-control">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              aria-label={`${label} date, ${dateLabel}`}
              className="calendar-event-composer__date-trigger"
              type="button"
              variant="outline"
            >
              <span>{label}</span>
              <strong>{dateLabel}</strong>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto">
            <DatePicker
              captionLayout="dropdown"
              defaultMonth={selected}
              endMonth={new Date(Date.UTC(referenceYear + 25, 11, 1, 12))}
              mode="single"
              onSelect={(nextDate) => {
                if (!nextDate) return;
                onDateChange(localDateAt(nextDate, timeZone));
                setOpen(false);
              }}
              selected={selected}
              startMonth={new Date(Date.UTC(referenceYear - 25, 0, 1, 12))}
              timeZone={timeZone}
            />
          </PopoverContent>
        </Popover>
        {!allDay ? <EventTimePicker label={label} onChange={onTimeChange} value={time} /> : null}
      </div>
    </Field>
  );
}

const quarterHourTimes = Array.from({ length: 96 }, (_, index) => {
  const minutes = index * 15;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
});

function EventTimePicker({
  label,
  onChange,
  value,
}: {
  label: "Ends" | "Starts";
  onChange: (value: string) => void;
  value: string;
}) {
  const [open, setOpen] = useState(false);
  const selectedOption = useRef<HTMLButtonElement>(null);
  const displayValue = formatTime(value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          aria-label={`${label} time, ${displayValue}`}
          className="calendar-event-composer__time-trigger"
          type="button"
          variant="outline"
        >
          {displayValue}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="calendar-event-composer__time-popover"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          selectedOption.current?.focus({ preventScroll: true });
          selectedOption.current?.scrollIntoView({ behavior: "auto", block: "center" });
        }}
      >
        <ScrollArea className="calendar-event-composer__time-options">
          <div aria-label={`${label} time`} role="listbox">
            {quarterHourTimes.map((option) => (
              <Button
                aria-selected={option === value}
                key={option}
                onClick={() => {
                  onChange(option);
                  setOpen(false);
                }}
                role="option"
                ref={option === value ? selectedOption : undefined}
                size="sm"
                type="button"
                variant={option === value ? "secondary" : "ghost"}
              >
                {formatTime(option)}
              </Button>
            ))}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

function formatTime(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2000, 0, 1, hour, minute)));
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
  const writable = useMemo(
    () =>
      calendars
        .filter((calendar) => calendar.isWritable)
        .toSorted(
          (left, right) =>
            Number(right.isPrimary) - Number(left.isPrimary) || left.name.localeCompare(right.name),
        ),
    [calendars],
  );
  const start = roundToQuarterHour(new Date(Date.now() + 30 * 60_000));
  const end = new Date(start.getTime() + 60 * 60_000);
  const initialStart = toDateTimeLocal(start, timeZone);
  const initialEnd = toDateTimeLocal(end, timeZone);
  const [allDay, setAllDay] = useState(false);
  const [calendarId, setCalendarId] = useState(writable[0]?.id ?? "");
  const [calendarPickerOpen, setCalendarPickerOpen] = useState(false);
  const [conferenceChoice, setConferenceChoice] = useState<ConferenceChoice>("none");
  const [showConferencing, setShowConferencing] = useState(false);
  const [showLink, setShowLink] = useState(false);
  const [showLocation, setShowLocation] = useState(false);
  const [startDate, setStartDate] = useState(() => parseLocalDate(initialStart.slice(0, 10)));
  const [endDate, setEndDate] = useState(() => parseLocalDate(initialEnd.slice(0, 10)));
  const [startTime, setStartTime] = useState(initialStart.slice(11));
  const [endTime, setEndTime] = useState(initialEnd.slice(11));
  const selectedCalendar = writable.find((calendar) => calendar.id === calendarId) ?? writable[0];
  useEffect(() => {
    if (!calendarId && writable[0]) setCalendarId(writable[0].id);
  }, [calendarId, writable]);
  useEffect(() => {
    if (conferenceChoice === "google_meet" && selectedCalendar?.provider !== "google") {
      setConferenceChoice("none");
    }
  }, [conferenceChoice, selectedCalendar?.provider]);
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
    const startsAt = allDay
      ? localDateTimeToUtc(startDate, 0, timeZone).toISOString()
      : localDateTimeToUtc(startDate, timeToMinute(startTime), timeZone).toISOString();
    const endsAt = allDay
      ? localDateTimeToUtc(addDays(endDate, 1), 0, timeZone).toISOString()
      : localDateTimeToUtc(endDate, timeToMinute(endTime), timeZone).toISOString();
    mutation.mutate({
      allDay,
      calendarId,
      conferenceProvider: conferenceChoice === "google_meet" ? "google_meet" : null,
      conferenceUrl: conferenceChoice === "link" ? nullable(form.get("conferenceUrl")) : null,
      endsAt,
      location: nullable(form.get("location")),
      notes: nullable(form.get("notes")),
      url: showLink ? nullable(form.get("url")) : null,
      startsAt,
      timezone: timeZone,
      title: String(form.get("title")).trim(),
    });
  };

  return (
    <Card
      aria-label="Create event"
      className="calendar-floating-nav__composer is-calendar-colored"
      style={{ "--calendar-color": selectedCalendar?.color ?? "#777ce3" } as CSSProperties}
    >
      <CardHeader>
        <CardTitle>Create event</CardTitle>
        <CloseButton close={close} />
      </CardHeader>
      <CardContent>
        <form onSubmit={submit}>
          <FieldGroup className="gap-3">
            <Field>
              <FieldLabel className="sr-only" htmlFor="floating-event-title">
                Title
              </FieldLabel>
              <InputGroup>
                <InputGroupInput
                  autoFocus
                  id="floating-event-title"
                  name="title"
                  placeholder="Event title"
                  required
                />
                <InputGroupAddon align="inline-end">
                  <Popover open={calendarPickerOpen} onOpenChange={setCalendarPickerOpen}>
                    <PopoverTrigger asChild>
                      <InputGroupButton
                        aria-label={`Calendar: ${selectedCalendar?.name ?? "Choose calendar"}`}
                        className="calendar-event-composer__calendar-trigger"
                      >
                        <i
                          aria-hidden="true"
                          style={{ background: selectedCalendar?.color ?? "#777ce3" }}
                        />
                        <span>{selectedCalendar?.name ?? "Calendar"}</span>
                      </InputGroupButton>
                    </PopoverTrigger>
                    <PopoverContent
                      align="end"
                      className="calendar-event-composer__calendar-picker"
                    >
                      <p className="text-xs font-medium text-muted-foreground">
                        Create on calendar
                      </p>
                      <div className="flex flex-col gap-1">
                        {writable.map((calendar) => (
                          <Button
                            aria-pressed={calendar.id === selectedCalendar?.id}
                            className="calendar-event-composer__calendar-option"
                            key={calendar.id}
                            onClick={() => {
                              setCalendarId(calendar.id);
                              setCalendarPickerOpen(false);
                            }}
                            type="button"
                            variant="ghost"
                          >
                            <i
                              aria-hidden="true"
                              style={{ background: calendar.color ?? "#777ce3" }}
                            />
                            <span>{calendar.name}</span>
                            {calendar.id === selectedCalendar?.id ? (
                              <CheckIcon aria-hidden="true" data-icon="inline-end" />
                            ) : null}
                          </Button>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                </InputGroupAddon>
              </InputGroup>
            </Field>
            <div className="calendar-event-composer__schedule">
              <div className="calendar-event-composer__schedule-heading">
                <span className="text-sm font-medium">When</span>
                <label htmlFor="floating-event-all-day">
                  <span>All day</span>
                  <Switch
                    checked={allDay}
                    id="floating-event-all-day"
                    onCheckedChange={setAllDay}
                  />
                </label>
              </div>
              <div className="calendar-event-composer__time">
                <EventDateTimeControl
                  allDay={allDay}
                  date={startDate}
                  label="Starts"
                  onDateChange={setStartDate}
                  onTimeChange={setStartTime}
                  referenceYear={localDateAt(new Date(), timeZone).year}
                  time={startTime}
                  timeZone={timeZone}
                />
                <span aria-hidden="true" className="calendar-event-composer__duration-line" />
                <EventDateTimeControl
                  allDay={allDay}
                  date={endDate}
                  label="Ends"
                  onDateChange={setEndDate}
                  onTimeChange={setEndTime}
                  referenceYear={localDateAt(new Date(), timeZone).year}
                  time={endTime}
                  timeZone={timeZone}
                />
              </div>
            </div>
            {showLocation ? <EventLocationPicker /> : null}
            {showConferencing ? (
              <Field>
                <FieldLabel className="sr-only">Conferencing</FieldLabel>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button className="w-full justify-start" type="button" variant="outline">
                      <VideoAddIcon data-icon="inline-start" />
                      {conferenceChoice === "google_meet"
                        ? "Google Meet will be created"
                        : conferenceChoice === "link"
                          ? "Meeting link"
                          : "Add conferencing"}
                      <ChevronDownIcon className="ml-auto" data-icon="inline-end" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuGroup>
                      <DropdownMenuRadioGroup
                        onValueChange={(value) => setConferenceChoice(value as ConferenceChoice)}
                        value={conferenceChoice}
                      >
                        <DropdownMenuRadioItem value="none">No conferencing</DropdownMenuRadioItem>
                        {selectedCalendar?.provider === "google" ? (
                          <DropdownMenuRadioItem value="google_meet">
                            Generate Google Meet
                          </DropdownMenuRadioItem>
                        ) : null}
                        <DropdownMenuRadioItem value="link">
                          Paste meeting link
                        </DropdownMenuRadioItem>
                      </DropdownMenuRadioGroup>
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
                {conferenceChoice === "link" ? (
                  <InputGroup>
                    <InputGroupInput
                      aria-label="Meeting link"
                      id="floating-event-conference-url"
                      name="conferenceUrl"
                      placeholder="Zoom, Teams, Webex, or another meeting URL"
                      required
                      type="url"
                    />
                    <InputGroupAddon>
                      <ExternalLinkIcon aria-hidden="true" />
                    </InputGroupAddon>
                  </InputGroup>
                ) : null}
              </Field>
            ) : null}
            {showLink ? (
              <Field>
                <FieldLabel className="sr-only" htmlFor="floating-event-url">
                  Link
                </FieldLabel>
                <InputGroup>
                  <InputGroupInput
                    aria-label="Link"
                    id="floating-event-url"
                    name="url"
                    placeholder="Add a related URL"
                    type="url"
                  />
                  <InputGroupAddon>
                    <ExternalLinkIcon aria-hidden="true" />
                  </InputGroupAddon>
                </InputGroup>
              </Field>
            ) : null}
            {!showLocation || !showConferencing || !showLink ? (
              <div className="calendar-event-composer__optional-actions">
                {!showLocation ? (
                  <AddOptionalFieldButton onClick={() => setShowLocation(true)}>
                    Add location
                  </AddOptionalFieldButton>
                ) : null}
                {!showConferencing ? (
                  <AddOptionalFieldButton onClick={() => setShowConferencing(true)}>
                    Add conferencing
                  </AddOptionalFieldButton>
                ) : null}
                {!showLink ? (
                  <AddOptionalFieldButton onClick={() => setShowLink(true)}>
                    Add link
                  </AddOptionalFieldButton>
                ) : null}
              </div>
            ) : null}
            <Field>
              <FieldLabel className="sr-only" htmlFor="floating-event-notes">
                Description
              </FieldLabel>
              <Textarea
                id="floating-event-notes"
                name="notes"
                placeholder="Description, notes, or related links (optional)"
                rows={2}
              />
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

function AddOptionalFieldButton({ children, onClick }: { children: string; onClick: () => void }) {
  return (
    <Button
      className="calendar-event-composer__add-field"
      onClick={onClick}
      size="sm"
      type="button"
      variant="ghost"
    >
      <PlusIcon data-icon="inline-start" />
      {children}
    </Button>
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

function timeToMinute(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return (hour as number) * 60 + (minute as number);
}

function nullable(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text || null;
}
