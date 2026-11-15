// @vitest-environment jsdom
import { ApiClientError } from "@personal-os/api-client";
import type { Calendar, CalendarEvent } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PropsWithChildren, ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import CalendarRoute from "../../app/(workspaces)/calendar";
import CalendarEventRoute from "../../app/calendar-event";
import CalendarEventEditRoute from "../../app/calendar-event-edit";
import { eventWriteFailure } from "./data";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
vi.mock("@tanstack/react-query", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/apps/web/package.json`)("@tanstack/react-query");
});
const h = vi.hoisted(() => ({
  timezone: "America/New_York" as string | undefined,
  epoch: 1,
  params: {} as { id?: string; day?: string },
  push: vi.fn(),
  back: vi.fn(),
  guard: { active: false },
  error: vi.fn(),
  success: vi.fn(),
  loading: vi.fn(() => "toast-1"),
  dismiss: vi.fn(),
  api: {
    listEvents: vi.fn(),
    listCalendars: vi.fn(),
    getEvent: vi.fn(),
    getWorkspaceSettings: vi.fn(),
    getDomainProfile: vi.fn(),
    createEvent: vi.fn(),
    updateEvent: vi.fn(),
    trashEvent: vi.fn(),
    restoreEvent: vi.fn(),
  },
}));
vi.mock("react-native", async () => ({
  ...(await import("../../../test/native")),
  Linking: { openURL: vi.fn() },
  AppState: { addEventListener: () => ({ remove: () => {} }) },
}));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock("expo-router", () => ({
  router: { push: h.push, back: h.back, navigate: vi.fn() },
  useLocalSearchParams: () => h.params,
  usePreventRemove: (active: boolean) => {
    h.guard.active = active;
    return () => {};
  },
  Stack: {
    Screen: ({
      options,
    }: {
      options: { title?: string; headerLeft?: () => ReactNode; headerRight?: () => ReactNode };
    }) => (
      <nav aria-label={options.title}>
        {options.headerLeft?.()}
        {options.headerRight?.()}
      </nav>
    ),
  },
}));
vi.mock("../auth/context", () => ({
  useOptionalAuth: () => null,
  useAuth: () => ({
    state: { user: { id: "owner-a", planningTimezone: h.timezone } },
    session: { api: () => h.api, epoch: () => h.epoch },
  }),
}));
vi.mock("sonner-native", () => ({
  toast: { error: h.error, success: h.success, loading: h.loading, dismiss: h.dismiss },
}));
vi.mock("../../components/icons", () => ({
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
}));
vi.mock("../../components/screen", () => ({
  Screen: ({ children }: PropsWithChildren) => <main>{children}</main>,
}));

const zone = "America/New_York";
const standup = {
  id: "Standup",
  title: "Standup",
  startsAt: "2026-11-13T14:00:00.000Z",
  endsAt: "2026-11-13T14:30:00.000Z",
  allDay: false,
  provider: "google",
  calendarId: "work",
  timezone: zone,
  status: "confirmed",
  recurrence: [],
  location: "Room 4",
  conferenceUrl: null,
  url: null,
  notes: null,
  blocks: [],
  blockSourceEventId: null,
  updatedAt: "2026-11-12T10:00:00.000Z",
} as unknown as CalendarEvent;
function calendar(id: string, name: string, extra: Partial<Calendar> = {}) {
  return {
    id,
    name,
    provider: "google",
    color: "#005be6",
    isPrimary: false,
    isSelected: true,
    isWritable: true,
    lastSyncedAt: "2026-11-13T14:41:00.000Z",
    ...extra,
  } as Calendar;
}
const work = calendar("work", "Work");
const personal = calendar("personal", "Personal", { provider: "local" });
const holidays = calendar("holidays", "Holidays", { isWritable: false });
const offline = () => new TypeError("Network request failed");
const refused = (status: number, message: string) =>
  new ApiClientError({ code: "refused", message, status });

let client: QueryClient;
function mount(node: ReactNode) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}
const button = (name: string | RegExp) => screen.getByRole("button", { name });
const press = (name: string | RegExp) => fireEvent.click(button(name));
const field = (name: string) => screen.getByRole("textbox", { name }) as HTMLInputElement;
const type = (name: string, value: string) => fireEvent.change(field(name), { target: { value } });
const undoAction = () =>
  (h.success.mock.calls[0] as unknown as [string, { action: { onClick: () => void } }])[1].action;
/** No toast text may also be rendered on the page. */
function expectNoInlineResult() {
  for (const call of [...h.error.mock.calls, ...h.success.mock.calls, ...h.loading.mock.calls])
    expect(screen.queryByText(call[0] as string)).toBeNull();
}
async function openNewEvent(day = "2026-11-13") {
  h.params = { day };
  mount(<CalendarEventEditRoute />);
  await screen.findByRole("textbox", { name: "Event title" });
}
async function openStandup() {
  h.params = { id: "Standup" };
  mount(<CalendarEventEditRoute />);
  await screen.findByRole("textbox", { name: "Event title" });
}
async function openDetails() {
  h.params = { id: "Standup" };
  mount(<CalendarEventRoute />);
  await screen.findByRole("button", { name: "Event actions" });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-13T15:00:00.000Z")); // 10 AM in New York
  vi.clearAllMocks();
  h.timezone = zone;
  h.epoch = 1;
  h.params = {};
  h.guard.active = false;
  h.api.listEvents.mockReset().mockResolvedValue([standup]);
  h.api.listCalendars.mockReset().mockResolvedValue([work, personal, holidays]);
  h.api.getEvent.mockReset().mockResolvedValue(standup);
  h.api.getWorkspaceSettings.mockReset().mockResolvedValue({
    workspace: "calendar",
    preferences: { weekStartsOn: "sunday", defaultEventDurationMinutes: 30 },
  });
  h.api.getDomainProfile
    .mockReset()
    .mockResolvedValue({ status: "active", preferences: { defaultCalendarId: "personal" } });
  h.api.createEvent
    .mockReset()
    .mockImplementation(async (input) => ({ ...standup, ...input, id: "created-1" }));
  h.api.updateEvent
    .mockReset()
    .mockImplementation(async (_id, input) => ({ ...standup, ...input }));
  h.api.trashEvent.mockReset().mockResolvedValue({
    eventId: "Standup",
    updatedAt: "2026-11-13T15:00:01.000Z",
    blockUpdatedAtById: {},
  });
  h.api.restoreEvent.mockReset().mockResolvedValue(standup);
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true),
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("offers Add event on the agenda for the chosen day, only when a calendar can take events", async () => {
  mount(<CalendarRoute />);
  await screen.findByRole("button", { name: /^Standup/ });
  press("Next day");
  press("Add event");
  expect(h.push).toHaveBeenCalledWith({
    pathname: "/calendar-event-edit",
    params: { day: "2026-11-14" },
  });
  cleanup();

  h.api.listCalendars.mockResolvedValue([holidays]);
  mount(<CalendarRoute />);
  await screen.findByText(/^Nothing scheduled|^Every calendar|Standup/);
  await waitFor(() => expect(screen.queryByRole("button", { name: "Add event" })).toBeNull());
});

it("creates a timed event on the default calendar once the API confirms it", async () => {
  await openNewEvent();
  expect(screen.getByRole("navigation", { name: "new event" })).toBeVisible();
  expect(button("Close")).toBeEnabled();
  expect(button("Create event")).toBeDisabled();
  expect(button("Calendar, Personal")).toBeEnabled();
  expect(field("Starts").value).toBe("2026-11-13");
  expect(field("Start time").value).toBe("11:00");
  expect(field("End time").value).toBe("11:30");
  expect(screen.getByText("Times are in Eastern Standard Time.")).toBeVisible();
  // Loading defaults is not an edit.
  expect(h.guard.active).toBe(false);

  type("Event title", "Dentist appointment");
  expect(button("Cancel")).toBeEnabled();
  expect(h.guard.active).toBe(true);
  type("Start time", "14:00");
  expect(field("End time").value).toBe("14:30");
  type("Location", "200 Main Street");
  const refresh = vi.spyOn(client, "invalidateQueries");
  press("Create event");

  await waitFor(() => expect(h.back).toHaveBeenCalledOnce());
  expect(h.api.createEvent).toHaveBeenCalledExactlyOnceWith({
    calendarId: "personal",
    title: "Dentist appointment",
    location: "200 Main Street",
    notes: null,
    allDay: false,
    startsAt: "2026-11-13T19:00:00.000Z",
    endsAt: "2026-11-13T19:30:00.000Z",
    timezone: zone,
  });
  expect(h.loading).toHaveBeenCalledExactlyOnceWith("Creating event…");
  expect(h.success).toHaveBeenCalledExactlyOnceWith("Event created", { id: "toast-1" });
  expect(h.error).not.toHaveBeenCalled();
  expect(refresh).toHaveBeenCalledWith(
    expect.objectContaining({ queryKey: ["calendar", "owner-a", 1] }),
  );
  expectNoInlineResult();
});

it("creates an all-day event on a chosen calendar as whole calendar days", async () => {
  await openNewEvent("2026-11-20");
  expect(field("Start time").value).toBe("09:00");
  type("Event title", "Conference");
  fireEvent.click(screen.getByRole("switch", { name: "All day" }));
  expect(screen.queryByRole("textbox", { name: "Start time" })).toBeNull();
  expect(screen.queryByText(/Times are in/)).toBeNull();
  type("Ends", "2026-11-21");
  press("Calendar, Personal");
  expect(screen.queryByRole("radio", { name: "Holidays" })).toBeNull();
  fireEvent.click(screen.getByRole("radio", { name: "Work" }));
  press("Create event");

  await waitFor(() => expect(h.back).toHaveBeenCalledOnce());
  expect(h.api.createEvent).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      calendarId: "work",
      allDay: true,
      startsAt: "2026-11-20T05:00:00.000Z",
      endsAt: "2026-11-22T05:00:00.000Z",
      timezone: zone,
    }),
  );
});

it("makes a short event one day when All day is turned on, and keeps a longer span", async () => {
  await openNewEvent();
  type("Start time", "23:30"); // ends 12:00 AM the next day
  expect(field("Ends").value).toBe("2026-11-14");
  fireEvent.click(screen.getByRole("switch", { name: "All day" }));
  expect(field("Ends").value).toBe("2026-11-13");
  fireEvent.click(screen.getByRole("switch", { name: "All day" }));
  type("Ends", "2026-11-16");
  fireEvent.click(screen.getByRole("switch", { name: "All day" }));
  expect(field("Ends").value).toBe("2026-11-16");
});

it("starts on today for a day that is not a real date, on a calendar the agenda shows", async () => {
  h.api.getDomainProfile.mockResolvedValue({ status: "draft", preferences: {} });
  h.api.listCalendars.mockResolvedValue([
    calendar("hidden", "Hidden", { isSelected: false, isPrimary: true }),
    work,
    calendar("main", "Main", { isPrimary: true }),
  ]);
  await openNewEvent("2026-02-31");
  expect(field("Starts").value).toBe("2026-11-13");
  expect(button("Calendar, Main")).toBeEnabled();
  cleanup();

  // With nothing shown, the primary writable calendar is still offered.
  h.api.listCalendars.mockResolvedValue([
    calendar("other", "Other", { isSelected: false }),
    calendar("hidden", "Hidden", { isSelected: false, isPrimary: true }),
  ]);
  await openNewEvent();
  expect(button("Calendar, Hidden")).toBeEnabled();
});

it("reports an end before the start through Sonner without sending anything", async () => {
  await openNewEvent();
  type("Event title", "Dentist appointment");
  type("End time", "10:30");
  press("Create event");

  expect(h.error).toHaveBeenCalledExactlyOnceWith("The event must end after it starts.");
  expect(h.api.createEvent).not.toHaveBeenCalled();
  expect(h.loading).not.toHaveBeenCalled();
  expect(h.back).not.toHaveBeenCalled();
  expect(field("Event title").value).toBe("Dentist appointment");
  expectNoInlineResult();
});

it("keeps the draft open for correction when the API refuses a create", async () => {
  h.api.createEvent.mockRejectedValue(refused(403, "This calendar is read-only."));
  await openNewEvent();
  type("Event title", "Dentist appointment");
  press("Create event");

  await waitFor(() =>
    expect(h.error).toHaveBeenCalledExactlyOnceWith("This calendar is read-only.", {
      id: "toast-1",
    }),
  );
  expect(h.success).not.toHaveBeenCalled();
  expect(h.back).not.toHaveBeenCalled();
  expect(field("Event title")).toBeEnabled();
  expect(button("Create event")).toBeEnabled();
  expect(screen.queryByText("Recovery")).toBeNull();
  expectNoInlineResult();
});

it("never shows an unconfirmed create as saved, and re-reads the calendar before any retry", async () => {
  h.api.createEvent.mockRejectedValueOnce(offline());
  await openNewEvent();
  type("Event title", "Dentist appointment");
  const refresh = vi.spyOn(client, "invalidateQueries");
  press("Create event");

  await waitFor(() =>
    expect(h.error).toHaveBeenCalledExactlyOnceWith(
      "Couldn’t confirm the event was created. Check your calendar before trying again.",
      { id: "toast-1" },
    ),
  );
  expect(h.success).not.toHaveBeenCalled();
  expect(h.back).not.toHaveBeenCalled();
  expect(refresh).toHaveBeenCalledWith(
    expect.objectContaining({ queryKey: ["calendar", "owner-a", 1] }),
  );
  // The draft is frozen: what may already be on the calendar cannot be changed and sent again.
  expect(field("Event title")).toBeDisabled();
  expect(button("Create event")).toBeDisabled();
  expectNoInlineResult();

  press("Check calendar and create again");
  expect(globalThis.confirm).toHaveBeenCalledWith(
    expect.stringContaining("checks your calendar first"),
  );
  await waitFor(() => expect(h.back).toHaveBeenCalledOnce());
  // The calendar was read first, on the event's own calendar, and did not have the event.
  expect(h.api.listEvents).toHaveBeenCalledExactlyOnceWith({
    from: "2026-11-12T16:00:00.000Z",
    to: "2026-11-14T16:30:00.000Z",
    calendarIds: ["personal"],
  });
  expect(h.api.createEvent).toHaveBeenCalledTimes(2);
  expect(h.api.createEvent.mock.calls[1]).toEqual(h.api.createEvent.mock.calls[0]);
  expect(h.success).toHaveBeenCalledExactlyOnceWith("Event created", { id: "toast-1" });
});

it("sends no second create when the calendar already has the event or cannot be read", async () => {
  h.api.createEvent.mockRejectedValue(offline());
  await openNewEvent();
  type("Event title", "Dentist appointment");
  press("Create event");
  await screen.findByRole("button", { name: "Check calendar and create again" });
  h.error.mockClear();

  // The calendar cannot be read: nothing is sent and the choice stays.
  h.api.listEvents.mockRejectedValueOnce(offline());
  press("Check calendar and create again");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledExactlyOnceWith(
      "Couldn’t check your calendar, so nothing was sent. Try again in a moment.",
      { id: "toast-1" },
    ),
  );
  expect(h.api.createEvent).toHaveBeenCalledOnce();
  expect(button("Check calendar and create again")).toBeEnabled();
  expect(h.back).not.toHaveBeenCalled();

  // The first attempt did land: the read finds it, so it is reported created and not sent again.
  h.api.listEvents.mockResolvedValueOnce([
    standup,
    {
      ...standup,
      id: "landed-1",
      title: "Dentist appointment",
      calendarId: "personal",
      provider: "local",
      startsAt: "2026-11-13T16:00:00.000Z",
      endsAt: "2026-11-13T16:30:00.000Z",
    },
  ]);
  press("Check calendar and create again");
  await waitFor(() => expect(h.back).toHaveBeenCalledOnce());
  expect(h.api.createEvent).toHaveBeenCalledOnce();
  expect(h.success).toHaveBeenCalledExactlyOnceWith("Event created", { id: "toast-1" });
  expectNoInlineResult();
});

it("offers no second create on a hidden calendar, whose events cannot be read back", async () => {
  h.api.listCalendars.mockResolvedValue([calendar("hidden", "Hidden", { isSelected: false })]);
  h.api.createEvent.mockRejectedValue(offline());
  await openNewEvent();
  expect(button("Calendar, Hidden")).toBeEnabled();
  type("Event title", "Dentist appointment");
  press("Create event");
  await screen.findByRole("button", { name: "Review calendar before creating again" });
  expect(screen.queryByRole("button", { name: "Check calendar and create again" })).toBeNull();
  expect(button("Create event")).toBeDisabled();
  expect(h.api.createEvent).toHaveBeenCalledOnce();
  expect(h.api.listEvents).not.toHaveBeenCalled();
});

it("recognises a provider all-day event as the one first sent", async () => {
  h.api.createEvent.mockRejectedValue(offline());
  await openNewEvent("2026-11-20");
  type("Event title", "Conference");
  fireEvent.click(screen.getByRole("switch", { name: "All day" }));
  type("Ends", "2026-11-21");
  press("Calendar, Personal");
  fireEvent.click(screen.getByRole("radio", { name: "Work" }));
  press("Create event");
  await screen.findByRole("button", { name: "Check calendar and create again" });
  // Google returns all-day events as UTC-dated days, not the local midnights that were sent.
  h.api.listEvents.mockResolvedValueOnce([
    {
      ...standup,
      id: "landed-2",
      title: "Conference",
      allDay: true,
      startsAt: "2026-11-20T00:00:00.000Z",
      endsAt: "2026-11-22T00:00:00.000Z",
    },
  ]);
  press("Check calendar and create again");
  await waitFor(() => expect(h.back).toHaveBeenCalledOnce());
  expect(h.api.listEvents).toHaveBeenCalledExactlyOnceWith({
    from: "2026-11-19T05:00:00.000Z",
    to: "2026-11-23T05:00:00.000Z",
    calendarIds: ["work"],
  });
  expect(h.api.createEvent).toHaveBeenCalledOnce();
  expect(h.success).toHaveBeenCalledExactlyOnceWith("Event created", { id: "toast-1" });
});

it("offers no second create when the provider already has the event", async () => {
  h.api.createEvent.mockRejectedValue(
    new ApiClientError({
      code: "service_unavailable",
      message: "Calendar providers were changed, but nohmi could not commit.",
      status: 503,
      details: { partialEffect: "provider_event_created" },
    }),
  );
  await openNewEvent();
  type("Event title", "Dentist appointment");
  press("Create event");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledExactlyOnceWith(
      "Your calendar provider has this event, but nohmi couldn’t record it yet. It will appear after the next sync.",
      { id: "toast-1" },
    ),
  );
  expect(screen.queryByRole("button", { name: "Check calendar and create again" })).toBeNull();
  expect(button("Create event")).toBeDisabled();
  expect(field("Event title")).toBeDisabled();
  expectNoInlineResult();
  press("Close and review calendar");
  expect(h.back).toHaveBeenCalledOnce();
  expect(h.api.createEvent).toHaveBeenCalledOnce();
});

it("classifies failures by whether the calendar may have changed", () => {
  const partial = (details: unknown) =>
    new ApiClientError({ code: "forbidden", message: "Refused", status: 403, details });
  expect(eventWriteFailure(refused(403, "Refused"))).toBe("rejected");
  expect(eventWriteFailure(refused(404, "Gone"))).toBe("gone");
  expect(eventWriteFailure(refused(409, "Changed"))).toBe("conflict");
  expect(eventWriteFailure(refused(503, "Down"))).toBe("uncertain");
  expect(eventWriteFailure(offline())).toBe("uncertain");
  expect(eventWriteFailure(partial({ completedEffects: [] }))).toBe("rejected");
  expect(eventWriteFailure(partial({ completedEffects: [{ action: "update" }] }))).toBe(
    "uncertain",
  );
  expect(eventWriteFailure(partial({ indeterminateEffects: [{ action: "delete" }] }))).toBe(
    "uncertain",
  );
  expect(eventWriteFailure(partial({ partialEffect: "provider_event_updated" }))).toBe("uncertain");
});

it("lets the person leave an unconfirmed create to review the calendar instead", async () => {
  h.api.createEvent.mockRejectedValue(refused(503, "A Calendar provider mutation failed."));
  await openNewEvent();
  type("Event title", "Dentist appointment");
  press("Create event");
  await screen.findByRole("button", { name: "Review calendar before creating again" });
  // Declining the second attempt sends nothing.
  vi.mocked(globalThis.confirm).mockReturnValueOnce(false);
  press("Check calendar and create again");
  expect(h.api.createEvent).toHaveBeenCalledOnce();

  // A retry the API refuses outright reopens the draft.
  h.api.createEvent.mockRejectedValueOnce(refused(400, "Event end must be after its start."));
  press("Check calendar and create again");
  await waitFor(() => expect(field("Event title")).toBeEnabled());
  expect(screen.queryByText("Recovery")).toBeNull();

  h.api.createEvent.mockRejectedValueOnce(offline());
  press("Create event");
  fireEvent.click(
    await screen.findByRole("button", { name: "Review calendar before creating again" }),
  );
  expect(h.back).toHaveBeenCalledOnce();
  expect(h.success).not.toHaveBeenCalled();
});

it("edits an event, sending only the change and the revision it was read at", async () => {
  await openStandup();
  expect(screen.getByRole("navigation", { name: "edit event" })).toBeVisible();
  expect(field("Event title").value).toBe("Standup");
  expect(field("Starts").value).toBe("2026-11-13");
  expect(field("Start time").value).toBe("09:00");
  expect(field("End time").value).toBe("09:30");
  // An event stays on its calendar.
  expect(button("Calendar, Work")).toBeDisabled();
  expect(button("Save changes")).toBeDisabled();

  type("Location", "Room 9");
  press("Save changes");
  await waitFor(() => expect(h.back).toHaveBeenCalledOnce());
  expect(h.api.updateEvent).toHaveBeenCalledExactlyOnceWith("Standup", {
    title: "Standup",
    location: "Room 9",
    expectedUpdatedAt: "2026-11-12T10:00:00.000Z",
    expectedBlockUpdatedAtById: {},
  });
  expect(h.loading).toHaveBeenCalledExactlyOnceWith("Saving event…");
  expect(h.success).toHaveBeenCalledExactlyOnceWith("Event saved", { id: "toast-1" });
  expect(client.getQueryData(["calendar", "owner-a", 1, "event", "Standup"])).toMatchObject({
    location: "Room 9",
  });
  expectNoInlineResult();
});

it("moves an event's time in the account timezone and says a repeating event changes as a whole", async () => {
  h.api.getEvent.mockResolvedValue({ ...standup, recurrence: ["RRULE:FREQ=WEEKLY"] });
  await openStandup();
  expect(
    screen.getByText("Times are in Eastern Standard Time. Changes apply to every occurrence."),
  ).toBeVisible();
  type("Starts", "2026-11-16");
  type("Start time", "15:00");
  press("Save changes");
  await waitFor(() => expect(h.back).toHaveBeenCalledOnce());
  expect(h.api.updateEvent).toHaveBeenCalledExactlyOnceWith(
    "Standup",
    expect.objectContaining({
      allDay: false,
      startsAt: "2026-11-16T20:00:00.000Z",
      endsAt: "2026-11-16T20:30:00.000Z",
      timezone: zone,
    }),
  );
});

it("stops on a conflict and reloads the current event only when the person asks", async () => {
  const changed = { ...standup, title: "Standup (moved)", updatedAt: "2026-11-13T14:59:00.000Z" };
  h.api.updateEvent.mockRejectedValue(
    refused(409, "The calendar event changed since it was loaded."),
  );
  await openStandup();
  type("Location", "Room 9");
  h.api.getEvent.mockResolvedValue(changed);
  press("Save changes");

  await waitFor(() =>
    expect(h.error).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("This changed elsewhere"),
      { id: "toast-1" },
    ),
  );
  expect(h.back).not.toHaveBeenCalled();
  expect(button("Save changes")).toBeDisabled();
  // The draft stays as typed until the person chooses to discard it.
  expect(field("Location").value).toBe("Room 9");
  expect(field("Event title").value).toBe("Standup");
  expectNoInlineResult();

  press("Reload event (discard changes)");
  await waitFor(() => expect(field("Event title").value).toBe("Standup (moved)"));
  expect(field("Location").value).toBe("Room 4");
  type("Location", "Room 9");
  h.api.updateEvent.mockResolvedValue(changed);
  press("Save changes");
  await waitFor(() => expect(h.back).toHaveBeenCalledOnce());
  expect(h.api.updateEvent).toHaveBeenLastCalledWith(
    "Standup",
    expect.objectContaining({ expectedUpdatedAt: "2026-11-13T14:59:00.000Z" }),
  );
});

it("keeps the draft and its original revision when an edit cannot be confirmed", async () => {
  h.api.updateEvent.mockRejectedValueOnce(offline());
  await openStandup();
  type("Event title", "Standup (late)");
  // The save did land: the re-read returns a newer revision than the form opened with.
  h.api.getEvent.mockResolvedValue({ ...standup, updatedAt: "2026-11-13T15:00:01.000Z" });
  press("Save changes");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledExactlyOnceWith(
      "Couldn’t confirm the event was saved. Check your calendar.",
      { id: "toast-1" },
    ),
  );
  expect(h.success).not.toHaveBeenCalled();
  expect(h.back).not.toHaveBeenCalled();
  expect(field("Event title").value).toBe("Standup (late)");

  // Retrying is safe: it still carries the revision the person reviewed, so the API can refuse.
  press("Save changes");
  await waitFor(() => expect(h.api.updateEvent).toHaveBeenCalledTimes(2));
  expect(h.api.updateEvent).toHaveBeenLastCalledWith(
    "Standup",
    expect.objectContaining({ expectedUpdatedAt: "2026-11-12T10:00:00.000Z" }),
  );
});

it("offers no form for events the person cannot change", async () => {
  h.api.getEvent.mockResolvedValue({ ...standup, calendarId: "holidays" });
  h.params = { id: "Standup" };
  mount(<CalendarEventEditRoute />);
  expect(await screen.findByText("This event is on a calendar you can only read.")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
  cleanup();

  h.api.getEvent.mockResolvedValue({ ...standup, blockSourceEventId: "source-1" });
  mount(<CalendarEventEditRoute />);
  expect(
    await screen.findByText("This busy block follows another event. Change that event instead."),
  ).toBeVisible();
  cleanup();

  h.api.getEvent.mockRejectedValue(refused(404, "Not found"));
  mount(<CalendarEventEditRoute />);
  expect(await screen.findByText("This event is no longer available.")).toBeVisible();
  cleanup();

  h.api.getEvent.mockRejectedValueOnce(offline()).mockResolvedValue(standup);
  mount(<CalendarEventEditRoute />);
  fireEvent.click(await screen.findByRole("button", { name: "Retry loading" }));
  expect(await screen.findByRole("textbox", { name: "Event title" })).toBeVisible();
});

it("explains why a new event cannot be started", async () => {
  h.api.listCalendars.mockResolvedValue([holidays]);
  mount(<CalendarEventEditRoute />);
  expect(screen.getByRole("progressbar")).toBeVisible();
  expect(
    await screen.findByText(
      "None of your calendars can take new events. Connect or create one in Settings.",
    ),
  ).toBeVisible();
  expect(screen.queryByRole("button", { name: "Create event" })).toBeNull();
  press("Close");
  expect(h.back).toHaveBeenCalledOnce();
  cleanup();

  h.api.listCalendars
    .mockRejectedValueOnce(offline())
    .mockResolvedValue([work, calendar("work-2", "Work")]);
  h.api.getDomainProfile.mockResolvedValue({ status: "draft", preferences: {} });
  mount(<CalendarEventEditRoute />);
  fireEvent.click(await screen.findByRole("button", { name: "Retry loading" }));
  // Without approved guidance the first writable calendar is used; twins are told apart.
  fireEvent.click(await screen.findByRole("button", { name: "Calendar, Work · Google" }));
  expect(screen.getAllByRole("radio", { name: "Work · Google" })).toHaveLength(2);
  cleanup();

  h.timezone = undefined;
  mount(<CalendarEventEditRoute />);
  expect(screen.getByText("Set your account timezone in Settings first.")).toBeVisible();
});

it("offers Edit and Delete only for an event on a calendar the person can write to", async () => {
  await openDetails();
  press("Event actions");
  expect(button("Delete")).toBeEnabled();
  press("Edit");
  expect(h.push).toHaveBeenCalledWith({
    pathname: "/calendar-event-edit",
    params: { id: "Standup" },
  });
  cleanup();

  h.api.getEvent.mockResolvedValue({ ...standup, calendarId: "holidays" });
  h.params = { id: "Standup" };
  mount(<CalendarEventRoute />);
  expect(await screen.findByText(/Read only/)).toBeVisible();
  expect(screen.queryByRole("button", { name: "Event actions" })).toBeNull();
  cleanup();

  // A busy block mirrors another event, which is the one to change.
  h.api.getEvent.mockResolvedValue({ ...standup, blockSourceEventId: "source-1" });
  mount(<CalendarEventRoute />);
  expect(await screen.findByText("Room 4")).toBeVisible();
  await waitFor(() => expect(h.api.getEvent).toHaveBeenCalledTimes(3));
  expect(screen.queryByRole("button", { name: "Event actions" })).toBeNull();
});

it("deletes after confirmation and restores the event from the toast's Undo", async () => {
  await openDetails();
  vi.mocked(globalThis.confirm).mockReturnValueOnce(false);
  press("Event actions");
  press("Delete");
  expect(globalThis.confirm).toHaveBeenCalledWith(
    expect.stringContaining("“Standup” will be removed from Work."),
  );
  expect(h.api.trashEvent).not.toHaveBeenCalled();

  press("Event actions");
  press("Delete");
  await waitFor(() => expect(h.back).toHaveBeenCalledOnce());
  expect(h.api.trashEvent).toHaveBeenCalledExactlyOnceWith("Standup", {
    expectedUpdatedAt: "2026-11-12T10:00:00.000Z",
    expectedBlockUpdatedAtById: {},
  });
  expect(h.loading).toHaveBeenCalledExactlyOnceWith("Deleting event…");
  expect(h.success).toHaveBeenCalledExactlyOnceWith("Event deleted", {
    id: "toast-1",
    duration: 10_000,
    action: { label: "Undo", onClick: expect.any(Function) },
  });
  // The closing page does not re-read a record that is gone.
  expect(h.api.getEvent).toHaveBeenCalledOnce();
  expectNoInlineResult();

  const undo = undoAction();
  h.loading.mockReturnValueOnce("toast-2");
  await act(async () => {
    undo.onClick();
    undo.onClick();
  });
  await waitFor(() =>
    expect(h.success).toHaveBeenLastCalledWith("Event restored", { id: "toast-2" }),
  );
  expect(h.api.restoreEvent).toHaveBeenCalledExactlyOnceWith("Standup", {
    expectedUpdatedAt: "2026-11-13T15:00:01.000Z",
    expectedBlockUpdatedAtById: {},
  });
  expect(h.loading).toHaveBeenLastCalledWith("Restoring event…");
});

it("warns that deleting a repeating event removes every occurrence", async () => {
  h.api.getEvent.mockResolvedValue({ ...standup, recurrence: ["RRULE:FREQ=WEEKLY"] });
  await openDetails();
  press("Event actions");
  press("Delete");
  expect(globalThis.confirm).toHaveBeenCalledWith(
    expect.stringContaining("Every occurrence of this repeating event is deleted."),
  );
  // Restoring would bring back a single event, not the series, so no Undo is offered.
  expect(globalThis.confirm).toHaveBeenCalledWith(
    expect.stringContaining("This can’t be undone from nohmi."),
  );
  await waitFor(() => expect(h.back).toHaveBeenCalledOnce());
  expect(h.success).toHaveBeenCalledExactlyOnceWith("Event deleted", { id: "toast-1" });
});

it("does not close another page when a delete settles after the person left", async () => {
  let finish: (value: unknown) => void = () => {};
  h.api.trashEvent.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await openDetails();
  press("Event actions");
  press("Delete");
  await waitFor(() => expect(h.api.trashEvent).toHaveBeenCalledOnce());
  cleanup();
  await act(async () =>
    finish({ eventId: "Standup", updatedAt: "2026-11-13T15:00:01.000Z", blockUpdatedAtById: {} }),
  );
  await waitFor(() => expect(h.success).toHaveBeenCalledOnce());
  expect(h.back).not.toHaveBeenCalled();

  // Undo still works from the toast after the page is gone, within the same session.
  h.loading.mockReturnValueOnce("toast-2");
  await act(async () => undoAction().onClick());
  await waitFor(() =>
    expect(h.success).toHaveBeenLastCalledWith("Event restored", { id: "toast-2" }),
  );
  expect(h.api.restoreEvent).toHaveBeenCalledOnce();
});

it("offers no second restore after a conflict or a missing record", async () => {
  h.api.restoreEvent.mockRejectedValue(refused(404, "The deleted calendar event was not found."));
  await openDetails();
  press("Event actions");
  press("Delete");
  await waitFor(() => expect(h.success).toHaveBeenCalledOnce());
  await act(async () => undoAction().onClick());
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledExactlyOnceWith("The deleted calendar event was not found.", {
      id: "toast-1",
    }),
  );
});

it("sends no restore once the account session has changed", async () => {
  await openDetails();
  press("Event actions");
  press("Delete");
  await waitFor(() => expect(h.success).toHaveBeenCalledOnce());
  h.epoch = 2;
  await act(async () => undoAction().onClick());
  expect(h.api.restoreEvent).not.toHaveBeenCalled();
  expect(h.loading).toHaveBeenCalledOnce();
});

it("treats a refusal after part of a write reached a provider as unconfirmed", async () => {
  h.api.updateEvent.mockRejectedValue(
    new ApiClientError({
      code: "forbidden",
      message: "This calendar is read-only.",
      status: 403,
      details: { completedEffects: [{ action: "update", role: "source" }] },
    }),
  );
  await openStandup();
  type("Location", "Room 9");
  const refresh = vi.spyOn(client, "invalidateQueries");
  press("Save changes");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledExactlyOnceWith(
      "Couldn’t confirm the event was saved. Check your calendar.",
      { id: "toast-1" },
    ),
  );
  expect(refresh).toHaveBeenCalledWith(
    expect.objectContaining({ queryKey: ["calendar", "owner-a", 1] }),
  );
  expect(h.back).not.toHaveBeenCalled();
});

it("stays on the event and offers no Undo when a delete or restore is not confirmed", async () => {
  h.api.trashEvent.mockRejectedValueOnce(offline());
  await openDetails();
  press("Event actions");
  press("Delete");
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledExactlyOnceWith(
      "Couldn’t confirm the event was deleted. Check your calendar.",
      { id: "toast-1" },
    ),
  );
  expect(h.success).not.toHaveBeenCalled();
  expect(h.back).not.toHaveBeenCalled();
  // The record is re-read so the page shows what the calendar actually holds.
  await waitFor(() => expect(h.api.getEvent).toHaveBeenCalledTimes(2));
  expectNoInlineResult();

  h.api.restoreEvent.mockRejectedValue(refused(403, "This calendar is read-only."));
  press("Event actions");
  press("Delete");
  await waitFor(() => expect(h.success).toHaveBeenCalledOnce());
  const undo = undoAction();
  await act(async () => undo.onClick());
  await waitFor(() =>
    expect(h.error).toHaveBeenLastCalledWith("This calendar is read-only.", {
      id: "toast-1",
      action: { label: "Try again", onClick: expect.any(Function) },
    }),
  );
  expect(h.success).toHaveBeenCalledOnce();

  // A refused restore changed nothing, so it can be asked for again, once per toast.
  const again = (
    h.error.mock.calls.at(-1) as unknown as [string, { action: { onClick: () => void } }]
  )[1].action;
  h.api.restoreEvent.mockRejectedValueOnce(offline());
  await act(async () => {
    again.onClick();
    again.onClick();
  });
  await waitFor(() => expect(h.api.restoreEvent).toHaveBeenCalledTimes(2));
  // An unconfirmed restore may have re-created the event, so it offers no further attempt.
  await waitFor(() =>
    expect(h.error).toHaveBeenLastCalledWith(
      "Couldn’t confirm the event was restored. Check your calendar.",
      { id: "toast-1" },
    ),
  );
});

it("reports nothing for a write that finishes after the account session changed", async () => {
  let finish: (event: CalendarEvent) => void = () => {};
  h.api.createEvent.mockReturnValueOnce(
    new Promise<CalendarEvent>((resolve) => {
      finish = resolve;
    }),
  );
  await openNewEvent();
  type("Event title", "Dentist appointment");
  press("Create event");
  await waitFor(() => expect(h.api.createEvent).toHaveBeenCalledOnce());
  // A second press while the first is in flight sends nothing more.
  expect(button("Create event")).toBeDisabled();
  h.epoch = 2;
  await act(async () => finish(standup));
  await waitFor(() => expect(h.dismiss).toHaveBeenCalledExactlyOnceWith("toast-1"));
  expect(h.success).not.toHaveBeenCalled();
  expect(h.error).not.toHaveBeenCalled();
  expect(h.back).not.toHaveBeenCalled();
});

it("reports nothing for a failure that arrives after the account session changed", async () => {
  h.api.createEvent.mockImplementationOnce(async () => {
    h.epoch = 3;
    throw offline();
  });
  await openNewEvent();
  type("Event title", "Dentist appointment");
  press("Create event");
  await waitFor(() => expect(h.dismiss).toHaveBeenCalledExactlyOnceWith("toast-1"));
  expect(h.error).not.toHaveBeenCalled();
  expect(h.api.createEvent).toHaveBeenCalledOnce();
});
