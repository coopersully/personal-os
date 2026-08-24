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
import { AnimatePresence, useIsPresent, usePresenceData } from "motion/react";
import * as m from "motion/react-m";
import {
  type CSSProperties,
  type FormEvent,
  forwardRef,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import {
  CalendarIcon,
  CheckIcon,
  ChevronDownIcon,
  ExternalLinkIcon,
  MapPinIcon,
  PlusIcon,
  SearchIcon,
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "../../api.js";
import { invalidateMaterial } from "../../lib/material-queries.js";

type FloatingMode = "closed" | "create" | "date" | "search";
type FloatingSurfaceState = FloatingMode | "details";
type ConferenceChoice = "google_meet" | "link" | "none";

type CalendarFloatingNavProps = {
  anchor: LocalDate;
  calendars: Calendar[];
  draft?: { endsAt: string; startsAt: string };
  eventDetails?: ReactNode;
  events?: CalendarEvent[];
  onDraftDismiss?: () => void;
  onNavigate: (date: LocalDate) => void;
  timeZone: string;
  user: User;
};

export function CalendarFloatingNav({
  anchor,
  calendars,
  draft,
  eventDetails,
  events = [],
  onDraftDismiss,
  onNavigate,
  timeZone,
  user,
}: CalendarFloatingNavProps) {
  const [mode, setMode] = useState<FloatingMode>("closed");
  const [surfaceInstance, setSurfaceInstance] = useState(0);
  const dateTrigger = useRef<HTMLButtonElement>(null);
  const createTrigger = useRef<HTMLButtonElement>(null);
  const searchTrigger = useRef<HTMLButtonElement>(null);
  const restoreFocusMode = useRef<Exclude<FloatingMode, "closed"> | null>(null);
  const open = (nextMode: Exclude<FloatingMode, "closed">) => {
    setSurfaceInstance((instance) => instance + 1);
    setMode(nextMode);
  };
  const close = () => {
    if (mode !== "closed") restoreFocusMode.current = mode;
    setMode("closed");
    if (draft) onDraftDismiss?.();
  };
  useEffect(() => {
    if (draft) {
      setSurfaceInstance((instance) => instance + 1);
      setMode("create");
    }
  }, [draft]);
  useEffect(() => {
    if (mode !== "closed" || !restoreFocusMode.current) return;
    const trigger = {
      create: createTrigger,
      date: dateTrigger,
      search: searchTrigger,
    }[restoreFocusMode.current];
    restoreFocusMode.current = null;
    window.requestAnimationFrame(() => trigger.current?.focus());
  }, [mode]);
  const surfaceState: FloatingSurfaceState = eventDetails ? "details" : mode;
  const content = eventDetails ? (
    eventDetails
  ) : mode === "closed" ? (
    <nav aria-label="Calendar actions" className="calendar-floating-nav__pill">
      <Button
        aria-label="Choose date"
        onClick={() => open("date")}
        ref={dateTrigger}
        size="icon"
        variant="ghost"
      >
        <CalendarIcon aria-hidden="true" />
      </Button>
      <Button
        aria-label="Create event"
        onClick={() => open("create")}
        ref={createTrigger}
        size="icon"
        variant="ghost"
      >
        <PlusIcon aria-hidden="true" />
      </Button>
      <Button
        aria-label="Search calendar"
        onClick={() => open("search")}
        ref={searchTrigger}
        size="icon"
        variant="ghost"
      >
        <SearchIcon aria-hidden="true" />
      </Button>
    </nav>
  ) : mode === "date" ? (
    <DateJumpCard anchor={anchor} close={close} onNavigate={onNavigate} timeZone={timeZone} />
  ) : mode === "search" ? (
    <CalendarSearchCard
      close={close}
      onNavigate={onNavigate}
      timeZone={timeZone}
      visibleEvents={events}
    />
  ) : (
    <InlineEventComposer
      calendars={calendars}
      close={close}
      {...(draft ? { draft } : {})}
      key={draft ? `${draft.startsAt}-${draft.endsAt}` : "new-event"}
      timeZone={timeZone}
      user={user}
    />
  );

  return (
    <div className="calendar-floating-nav" data-mode={surfaceState}>
      <m.div
        animate={{ borderRadius: surfaceState === "closed" ? 999 : 12 }}
        className="calendar-floating-nav__surface"
        data-slot="calendar-floating-surface"
        data-state={surfaceState}
        initial={false}
        layout
        layoutDependency={surfaceState}
        onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
          if (event.key !== "Escape" || surfaceState === "closed" || surfaceState === "details") {
            return;
          }
          event.preventDefault();
          close();
        }}
        style={{ overflow: "hidden", position: "relative" }}
        transition={{
          borderRadius: { duration: 0.18, ease: [0.22, 1, 0.36, 1] },
          layout: { bounce: 0.12, duration: 0.38, type: "spring" },
        }}
      >
        <AnimatePresence custom={surfaceState} initial={false} mode="popLayout">
          <FloatingNavTransitionContent
            key={surfaceState === "closed" ? surfaceState : `${surfaceState}:${surfaceInstance}`}
          >
            {content}
          </FloatingNavTransitionContent>
        </AnimatePresence>
      </m.div>
    </div>
  );
}

const FloatingNavTransitionContent = forwardRef<HTMLDivElement, { children: ReactNode }>(
  function FloatingNavTransitionContent({ children }, ref) {
    const isPresent = useIsPresent();
    const nextState = usePresenceData() as FloatingSurfaceState | undefined;
    const isCollapsing = nextState === "closed";
    return (
      <m.div
        animate={{
          opacity: 1,
          transition: {
            delay: isCollapsing && isPresent ? 0.16 : 0,
            duration: 0.14,
            ease: [0.22, 1, 0.36, 1],
          },
        }}
        aria-hidden={isPresent ? undefined : true}
        className="calendar-floating-nav__transition-content"
        exit={{
          opacity: 0,
          transition: {
            duration: isCollapsing ? 0.24 : 0.12,
            ease: [0.4, 0, 1, 1],
          },
        }}
        initial={{ opacity: 0 }}
        inert={isPresent ? undefined : true}
        ref={ref}
      >
        {children}
      </m.div>
    );
  },
);

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
            autoFocus
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
  close,
  onNavigate,
  timeZone,
  visibleEvents,
}: {
  close: () => void;
  onNavigate: (date: LocalDate) => void;
  timeZone: string;
  visibleEvents: CalendarEvent[];
}) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const input = useRef<HTMLInputElement>(null);
  const searchYear = localDateAt(new Date(), timeZone).year;
  const searchRange = useMemo(
    () =>
      localDateRange(
        { day: 1, month: 1, year: searchYear - 1 },
        { day: 1, month: 1, year: searchYear + 2 },
        timeZone,
      ),
    [searchYear, timeZone],
  );
  const events = useQuery({
    queryFn: () => api.listEvents(searchRange),
    queryKey: ["events", "calendar-search", searchRange.from, searchRange.to],
    staleTime: 60_000,
  });
  const searchableEvents = useMemo(
    () =>
      Array.from(
        new Map(
          [...visibleEvents, ...(events.data ?? [])].map((event) => [event.id, event] as const),
        ).values(),
      ),
    [events.data, visibleEvents],
  );
  const results = useMemo(
    () => calendarSearchResults(deferredQuery, searchableEvents, timeZone),
    [deferredQuery, searchableEvents, timeZone],
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
          <ul aria-label="Calendar search results" className="calendar-search-results">
            {results.length === 0 ? (
              <li>{events.isPending ? "Searching…" : "No matching events or dates."}</li>
            ) : (
              results.map((result) => (
                <li key={result.key}>
                  <button onClick={() => selectDate(result.date)} type="button">
                    <span>{result.label}</span>
                    <small>{result.detail}</small>
                  </button>
                </li>
              ))
            )}
          </ul>
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

function EventLocationPicker({ onDismiss }: { onDismiss: () => void }) {
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
        >
          <InputGroupAddon>
            <MapPinIcon aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              aria-label="Remove location"
              onClick={onDismiss}
              size="icon-xs"
              type="button"
            >
              <XIcon aria-hidden="true" />
            </InputGroupButton>
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
    <Field data-layout="schedule-control">
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
        {!allDay ? <EventTimeInput label={label} onChange={onTimeChange} value={time} /> : null}
      </div>
    </Field>
  );
}

type Meridiem = "AM" | "PM";

function EventTimeInput({
  label,
  onChange,
  value,
}: {
  label: "Ends" | "Starts";
  onChange: (value: string) => void;
  value: string;
}) {
  const hourInput = useRef<HTMLInputElement>(null);
  const minuteInput = useRef<HTMLInputElement>(null);
  const parts = timeInputParts(value);
  const [hour, setHour] = useState(parts.hour);
  const [minute, setMinute] = useState(parts.minute);
  const [meridiem, setMeridiem] = useState<Meridiem>(parts.meridiem);
  useEffect(() => {
    const next = timeInputParts(value);
    setHour(next.hour);
    setMinute(next.minute);
    setMeridiem(next.meridiem);
  }, [value]);

  const commit = (nextHour: string, nextMinute: string, nextMeridiem: Meridiem) => {
    const parsedHour = Number(nextHour);
    const parsedMinute = Number(nextMinute);
    if (parsedHour < 1 || parsedHour > 12 || parsedMinute < 0 || parsedMinute > 59) return;
    const hour24 = (parsedHour % 12) + (nextMeridiem === "PM" ? 12 : 0);
    onChange(`${String(hour24).padStart(2, "0")}:${String(parsedMinute).padStart(2, "0")}`);
  };

  const valid = isValidTimePart(hour, 1, 12) && isValidTimePart(minute, 0, 59);
  return (
    <InputGroup className="calendar-event-composer__time-input">
      <InputGroupInput
        aria-invalid={!valid}
        aria-label={`${label} hour`}
        autoComplete="off"
        className="calendar-event-composer__time-segment is-hour"
        inputMode="numeric"
        onBlur={() => {
          if (!isValidTimePart(hour, 1, 12)) setHour(parts.hour);
          else setHour(String(Number(hour)));
        }}
        onChange={(event) => {
          const digits = event.target.value.replace(/\D/g, "").slice(0, 4);
          if (digits.length >= 3) {
            const nextHour = String(Number(digits.slice(0, -2)));
            const nextMinute = digits.slice(-2);
            if (isValidTimePart(nextHour, 1, 12) && isValidTimePart(nextMinute, 0, 59)) {
              setHour(nextHour);
              setMinute(nextMinute);
              commit(nextHour, nextMinute, meridiem);
              minuteInput.current?.focus();
              minuteInput.current?.select();
              return;
            }
          }
          setHour(digits);
          commit(digits, minute, meridiem);
          if (digits !== "1" && isValidTimePart(digits, 1, 12)) {
            minuteInput.current?.focus();
            minuteInput.current?.select();
          }
        }}
        onClick={(event) => event.currentTarget.select()}
        onFocus={(event) => event.currentTarget.select()}
        ref={hourInput}
        value={hour}
      />
      <InputGroupInput
        aria-invalid={!valid}
        aria-label={`${label} minute`}
        autoComplete="off"
        className="calendar-event-composer__time-segment is-minute"
        inputMode="numeric"
        onBlur={() => {
          if (!isValidTimePart(minute, 0, 59)) setMinute(parts.minute);
          else {
            const normalizedMinute = String(Number(minute)).padStart(2, "0");
            setMinute(normalizedMinute);
            commit(hour, normalizedMinute, meridiem);
          }
        }}
        onChange={(event) => {
          const digits = event.target.value.replace(/\D/g, "").slice(0, 2);
          setMinute(digits);
          if (digits.length === 2) commit(hour, digits, meridiem);
        }}
        onClick={(event) => event.currentTarget.select()}
        onFocus={(event) => event.currentTarget.select()}
        ref={minuteInput}
        value={minute}
      />
      <InputGroupAddon className="calendar-event-composer__time-colon" align="inline-end">
        <span aria-hidden="true">:</span>
      </InputGroupAddon>
      <InputGroupAddon className="calendar-event-composer__time-meridiem" align="inline-end">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <InputGroupButton aria-label={`${label} AM or PM, ${meridiem}`} type="button">
              {meridiem}
              <ChevronDownIcon data-icon="inline-end" />
            </InputGroupButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuRadioGroup
                onValueChange={(nextValue) => {
                  const nextMeridiem = nextValue as Meridiem;
                  setMeridiem(nextMeridiem);
                  commit(hour, minute, nextMeridiem);
                }}
                value={meridiem}
              >
                <DropdownMenuRadioItem value="AM">AM</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="PM">PM</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </InputGroupAddon>
    </InputGroup>
  );
}

function timeInputParts(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return {
    hour: String((hour as number) % 12 || 12),
    meridiem: (hour as number) >= 12 ? ("PM" as const) : ("AM" as const),
    minute: String(minute).padStart(2, "0"),
  };
}

function isValidTimePart(value: string, minimum: number, maximum: number) {
  if (!/^\d{1,2}$/.test(value)) return false;
  const number = Number(value);
  return number >= minimum && number <= maximum;
}

function InlineEventComposer({
  calendars,
  close,
  draft,
  timeZone,
}: {
  calendars: Calendar[];
  close: () => void;
  draft?: { endsAt: string; startsAt: string };
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
  const start = draft
    ? new Date(draft.startsAt)
    : roundToQuarterHour(new Date(Date.now() + 30 * 60_000));
  const end = draft ? new Date(draft.endsAt) : new Date(start.getTime() + 60 * 60_000);
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
  const endWasEdited = useRef(Boolean(draft));
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const selectedCalendar = writable.find((calendar) => calendar.id === calendarId) ?? writable[0];
  useEffect(() => {
    if (!calendarId && writable[0]) setCalendarId(writable[0].id);
  }, [calendarId, writable]);
  useEffect(() => {
    if (conferenceChoice === "google_meet" && selectedCalendar?.provider !== "google") {
      setConferenceChoice("none");
    }
  }, [conferenceChoice, selectedCalendar?.provider]);
  const repairEndAfterStart = useCallback(
    (nextStartDate: LocalDate, nextStartTime: string) => {
      if (allDay) {
        if (!endWasEdited.current || compareLocalDates(endDate, nextStartDate) < 0) {
          if (compareLocalDates(endDate, nextStartDate) !== 0) setEndDate(nextStartDate);
        }
        return;
      }
      const nextStart = localDateTimeToUtc(nextStartDate, timeToMinute(nextStartTime), timeZone);
      const currentEnd = localDateTimeToUtc(endDate, timeToMinute(endTime), timeZone);
      if (endWasEdited.current && currentEnd > nextStart) return;
      const nextEnd = toDateTimeLocal(new Date(nextStart.getTime() + 60 * 60_000), timeZone);
      const nextEndDate = parseLocalDate(nextEnd.slice(0, 10));
      const nextEndTime = nextEnd.slice(11);
      if (compareLocalDates(endDate, nextEndDate) !== 0) setEndDate(nextEndDate);
      if (endTime !== nextEndTime) setEndTime(nextEndTime);
    },
    [allDay, endDate, endTime, timeZone],
  );
  const setValidatedEnd = (nextEndDate: LocalDate, nextEndTime: string) => {
    endWasEdited.current = true;
    if (allDay) {
      setEndDate(compareLocalDates(nextEndDate, startDate) < 0 ? startDate : nextEndDate);
      return;
    }
    const startsAt = localDateTimeToUtc(startDate, timeToMinute(startTime), timeZone);
    const endsAt = localDateTimeToUtc(nextEndDate, timeToMinute(nextEndTime), timeZone);
    if (endsAt <= startsAt) {
      const defaultEnd = toDateTimeLocal(new Date(startsAt.getTime() + 60 * 60_000), timeZone);
      setEndDate(parseLocalDate(defaultEnd.slice(0, 10)));
      setEndTime(defaultEnd.slice(11));
      return;
    }
    setEndDate(nextEndDate);
    setEndTime(nextEndTime);
  };
  useEffect(() => {
    repairEndAfterStart(startDate, startTime);
  }, [repairEndAfterStart, startDate, startTime]);
  const mutation = useMutation({
    mutationFn: (input: Parameters<typeof api.createEvent>[0]) => api.createEvent(input),
    onError: (error) =>
      toast.error("Event couldn’t be created", { description: errorMessage(error) }),
    onSuccess: async (created) => {
      await invalidateMaterial(queryClient);
      if (created.conferenceStatus === "pending") {
        toast.info("Event created", {
          description: "The meeting link is still being prepared.",
        });
      } else if (created.conferenceStatus === "failure") {
        toast.warning("Event created without a meeting link", {
          description: "The calendar provider couldn’t create the requested meeting.",
        });
      }
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
    if (new Date(endsAt) <= new Date(startsAt)) {
      setScheduleError("Event must end after it starts.");
      return;
    }
    setScheduleError(null);
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
                        type="button"
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
                  onDateChange={(nextDate) => {
                    setStartDate(nextDate);
                    setScheduleError(null);
                  }}
                  onTimeChange={(nextTime) => {
                    setStartTime(nextTime);
                    setScheduleError(null);
                  }}
                  referenceYear={localDateAt(new Date(), timeZone).year}
                  time={startTime}
                  timeZone={timeZone}
                />
                <span
                  aria-hidden="true"
                  className="calendar-event-composer__duration-line"
                  data-layout="duration-fill"
                />
                <EventDateTimeControl
                  allDay={allDay}
                  date={endDate}
                  label="Ends"
                  onDateChange={(nextDate) => {
                    setValidatedEnd(nextDate, endTime);
                    setScheduleError(null);
                  }}
                  onTimeChange={(nextTime) => {
                    setValidatedEnd(endDate, nextTime);
                    setScheduleError(null);
                  }}
                  referenceYear={localDateAt(new Date(), timeZone).year}
                  time={endTime}
                  timeZone={timeZone}
                />
              </div>
            </div>
            {showLocation ? <EventLocationPicker onDismiss={() => setShowLocation(false)} /> : null}
            {showConferencing ? (
              <Field>
                <FieldLabel className="sr-only">Conferencing</FieldLabel>
                <InputGroup>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <InputGroupButton className="flex-1 justify-start" type="button">
                        <VideoAddIcon data-icon="inline-start" />
                        {conferenceChoice === "google_meet"
                          ? "Google Meet will be created"
                          : conferenceChoice === "link"
                            ? "Meeting link"
                            : "Choose conferencing"}
                        <ChevronDownIcon className="ml-auto" data-icon="inline-end" />
                      </InputGroupButton>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuGroup>
                        <DropdownMenuRadioGroup
                          onValueChange={(value) => setConferenceChoice(value as ConferenceChoice)}
                          value={conferenceChoice}
                        >
                          <DropdownMenuRadioItem value="none">
                            No conferencing
                          </DropdownMenuRadioItem>
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
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton
                      aria-label="Remove conferencing"
                      onClick={() => {
                        setConferenceChoice("none");
                        setShowConferencing(false);
                      }}
                      size="icon-xs"
                      type="button"
                    >
                      <XIcon aria-hidden="true" />
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>
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
                  <InputGroupAddon align="inline-end">
                    <ExternalLinkIcon aria-hidden="true" />
                    <InputGroupButton
                      aria-label="Remove related link"
                      onClick={() => setShowLink(false)}
                      size="icon-xs"
                      type="button"
                    >
                      <XIcon aria-hidden="true" />
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>
              </Field>
            ) : null}
            {scheduleError ? (
              <p className="calendar-floating-nav__error" role="alert">
                {scheduleError}
              </p>
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
