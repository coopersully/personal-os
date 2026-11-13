// @vitest-environment jsdom
import { ApiClientError } from "@personal-os/api-client";
import type { Calendar, CalendarEvent } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { PropsWithChildren, ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import CalendarRoute from "../../app/(workspaces)/calendar";
import CalendarEventRoute from "../../app/calendar-event";

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
  params: {} as { id?: string },
  foreground: undefined as undefined | ((state: string) => void),
  refreshFailed: vi.fn(),
  push: vi.fn(),
  navigate: vi.fn(),
  openURL: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  loading: vi.fn(),
  dismiss: vi.fn(),
  api: {
    listEvents: vi.fn(),
    listCalendars: vi.fn(),
    getEvent: vi.fn(),
    getWorkspaceSettings: vi.fn(),
    setCalendarSelected: vi.fn(),
  },
}));
vi.mock("react-native", async () => ({
  ...(await import("../../../test/native")),
  Linking: { openURL: h.openURL },
  AppState: {
    addEventListener: (_event: string, callback: (state: string) => void) => {
      h.foreground = callback;
      return { remove: () => {} };
    },
  },
}));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock("expo-router", () => ({
  router: { push: h.push, navigate: h.navigate },
  useLocalSearchParams: () => h.params,
  Stack: { Screen: () => null },
}));
vi.mock("../auth/context", () => ({
  useOptionalAuth: () => null,
  useAuth: () => ({
    state: { user: { id: "owner-a", planningTimezone: h.timezone } },
    session: { api: () => h.api, epoch: () => 1 },
  }),
}));
vi.mock("sonner-native", () => ({
  toast: { error: h.error, success: h.success, loading: h.loading, dismiss: h.dismiss },
}));
vi.mock("../../components/icons", () => ({
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
}));
vi.mock("../../components/screen", () => ({
  Screen: ({ children, onRefresh }: PropsWithChildren<{ onRefresh?: () => Promise<unknown> }>) => (
    <main>
      {onRefresh && (
        <button type="button" onClick={() => void onRefresh().catch(h.refreshFailed)}>
          Pull to refresh
        </button>
      )}
      {children}
    </main>
  ),
}));

const zone = "America/New_York";
function event(id: string, startsAt: string, endsAt: string, extra: Partial<CalendarEvent> = {}) {
  return {
    id,
    title: id,
    startsAt,
    endsAt,
    allDay: false,
    provider: "google",
    calendarId: "work",
    timezone: zone,
    status: "confirmed",
    recurrence: [],
    location: null,
    conferenceUrl: null,
    url: null,
    notes: null,
    ...extra,
  } as CalendarEvent;
}
const standup = event("Standup", "2026-11-13T14:00:00.000Z", "2026-11-13T14:30:00.000Z", {
  location: "Room 4",
  conferenceUrl: "https://meet.example.test/standup",
});
const review = event("Review", "2026-11-13T14:15:00.000Z", "2026-11-13T15:15:00.000Z", {
  status: "tentative",
});
const lunch = event("Lunch", "2026-11-13T17:00:00.000Z", "2026-11-13T18:00:00.000Z", {
  calendarId: "personal",
  provider: "local",
  status: "cancelled",
});
const overnight = event("Night train", "2026-11-14T04:00:00.000Z", "2026-11-14T06:00:00.000Z");
const holiday = event("Founders day", "2026-11-13T00:00:00.000Z", "2026-11-14T00:00:00.000Z", {
  allDay: true,
});
const source = {
  accountLabel: "work@example.test",
  health: { state: "ready", message: null, nextSyncAt: null, recovery: null },
  remoteCalendarId: "primary",
  syncError: null,
  syncStatus: "idle",
};
function calendar(id: string, name: string, extra: Partial<Calendar> = {}) {
  return {
    id,
    name,
    provider: "google",
    color: "#005be6",
    isSelected: true,
    isWritable: true,
    lastSyncedAt: "2026-11-13T14:41:00.000Z",
    source,
    ...extra,
  } as Calendar;
}
const work = calendar("work", "Work");
const personal = calendar("personal", "Personal", {
  provider: "local",
  color: null,
  source: undefined,
});
const holidays = calendar("holidays", "Holidays", { isSelected: false, isWritable: false });

let client: QueryClient;
function mount(node: ReactNode) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}
const heading = () => screen.getAllByRole("heading")[0]?.textContent;
const press = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const ranges = () =>
  h.api.listEvents.mock.calls.map(
    ([range]) => `${range.from.slice(5, 10)}→${range.to.slice(5, 10)}`,
  );

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-13T15:00:00.000Z"));
  vi.clearAllMocks();
  h.timezone = zone;
  h.params = {};
  h.api.listEvents.mockReset().mockResolvedValue([standup, review, lunch, overnight, holiday]);
  h.api.listCalendars.mockReset().mockResolvedValue([work, personal, holidays]);
  h.api.getEvent.mockReset().mockResolvedValue(standup);
  h.api.getWorkspaceSettings
    .mockReset()
    .mockResolvedValue({ workspace: "calendar", preferences: { weekStartsOn: "sunday" } });
  h.api.setCalendarSelected.mockReset();
  h.openURL.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("shows today as all-day events above a timeline that marks overlapping events", async () => {
  mount(<CalendarRoute />);
  expect(screen.getByRole("progressbar")).toBeVisible();
  expect(await screen.findByText("All day")).toBeVisible();
  expect(heading()).toBe("Fri, Nov 13");
  expect(ranges()).toEqual(["11-08→11-15"]);
  expect(screen.getByRole("button", { name: /Founders day/ })).toHaveTextContent("All day · Work");
  expect(
    screen.getByRole("button", {
      name: "Standup, 9:00 AM – 9:30 AM, Work, overlaps another event",
    }),
  ).toBeVisible();
  expect(
    screen.getByRole("button", {
      name: "Review, 9:15 AM – 10:15 AM, Work, overlaps another event",
    }),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Lunch, 12:00 PM – 1:00 PM, Personal" }),
  ).toHaveTextContent("12:00 PM – 1:00 PM");
  expect(screen.getByRole("button", { name: "Night train, From 11:00 PM, Work" })).toBeVisible();
  expect(screen.getByText("11 PM")).toBeVisible();
  expect(screen.getByText("2 of 3 calendars shown")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Go to today" })).toBeNull();
  press(/^Standup/);
  expect(h.push).toHaveBeenCalledWith({ pathname: "/calendar-event", params: { id: "Standup" } });
});

it("moves between days with the arrows, the week strip and Today", async () => {
  mount(<CalendarRoute />);
  await screen.findByText("All day");
  const today = screen.getByRole("button", {
    name: "Friday, November 13, today, has events",
  });
  expect(today).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Wednesday, November 11" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  press("Next day");
  expect(heading()).toBe("Sat, Nov 14");
  expect(screen.getByRole("button", { name: "Night train, Until 1:00 AM, Work" })).toBeVisible();
  expect(screen.queryByText("All day")).toBeNull();
  expect(ranges()).toEqual(["11-08→11-15"]);

  press("Next day");
  expect(heading()).toBe("Sun, Nov 15");
  await waitFor(() => expect(ranges()).toEqual(["11-08→11-15", "11-15→11-22"]));
  expect(await screen.findByText("Nothing scheduled.")).toBeVisible();

  press("Previous day");
  press("Wednesday, November 11");
  expect(heading()).toBe("Wed, Nov 11");
  expect(await screen.findByText("Nothing scheduled.")).toBeVisible();

  press("Go to today");
  expect(heading()).toBe("Fri, Nov 13");
  expect(screen.queryByRole("button", { name: "Go to today" })).toBeNull();
});

it("starts the week strip on the account's chosen weekday", async () => {
  h.api.getWorkspaceSettings.mockResolvedValue({
    workspace: "calendar",
    preferences: { weekStartsOn: "monday" },
  });
  mount(<CalendarRoute />);
  await screen.findByText("All day");
  expect(h.api.getWorkspaceSettings).toHaveBeenCalledWith("calendar");
  expect(ranges()).toEqual(["11-09→11-16"]);
  const strip = screen
    .getAllByRole("button")
    .map((button) => button.getAttribute("aria-label") ?? "")
    .filter((label) => /^\w+day, November/.test(label));
  expect(strip[0]).toBe("Monday, November 9");
  expect(strip[6]).toBe("Sunday, November 15");
  cleanup();

  h.api.listEvents.mockClear();
  h.api.getWorkspaceSettings.mockRejectedValue(new Error("offline"));
  mount(<CalendarRoute />);
  await screen.findByText("All day");
  expect(ranges()).toEqual(["11-08→11-15"]);
});

it("keeps the last events on screen while another week or view loads", async () => {
  mount(<CalendarRoute />);
  await screen.findByText("All day");
  h.api.listEvents.mockReturnValue(new Promise(() => {}));

  press("Agenda");
  expect(screen.getByRole("button", { name: /^Standup/ })).toBeVisible();
  expect(screen.queryByRole("progressbar")).toBeNull();

  press("Day");
  press("Next day");
  press("Next day");
  expect(heading()).toBe("Sun, Nov 15");
  await waitFor(() => expect(ranges().at(-1)).toBe("11-15→11-22"));
  expect(screen.getByRole("progressbar")).toBeVisible();
  expect(screen.queryByText("Nothing scheduled.")).toBeNull();
  expect(screen.queryByRole("button", { name: /has events/ })).toBeNull();
});

it("follows the account's day when the app returns to the foreground", async () => {
  mount(<CalendarRoute />);
  await screen.findByText("All day");
  vi.setSystemTime(new Date("2026-11-14T15:00:00.000Z"));
  act(() => h.foreground?.("background"));
  expect(heading()).toBe("Fri, Nov 13");
  act(() => h.foreground?.("active"));
  expect(heading()).toBe("Sat, Nov 14");
});

it("lists a bounded agenda from the chosen day, grouped by day", async () => {
  mount(<CalendarRoute />);
  await screen.findByText("All day");
  press("Agenda");
  expect(await screen.findByText("Today · Fri, Nov 13")).toBeVisible();
  expect(ranges()).toEqual(["11-08→11-15", "11-13→11-27"]);
  expect(screen.getByText("Saturday, November 14")).toBeVisible();
  expect(screen.queryByRole("button", { name: /Wednesday, November 11/ })).toBeNull();
  const rows = screen.getAllByRole("button").map((row) => row.textContent);
  expect(rows).toContain("Founders dayAll day · Work");
  expect(rows).toContain("Standup9:00 AM – 9:30 AM · Room 4 · Video call · Work");
  expect(rows).toContain("Review9:15 AM – 10:15 AM · Tentative · Work");
  expect(rows).toContain("Lunch12:00 PM – 1:00 PM · Cancelled · Personal");
  expect(rows).toContain("Night trainUntil 1:00 AM · Work");

  h.api.listEvents.mockResolvedValue([]);
  press("Next day");
  expect(await screen.findByText("Nothing scheduled in these 14 days.")).toBeVisible();
  expect(ranges().at(-1)).toBe("11-14→11-28");
});

it("saves which calendars are shown and re-reads events", async () => {
  h.api.setCalendarSelected.mockResolvedValue({ ...holidays, isSelected: true });
  mount(<CalendarRoute />);
  await screen.findByText("2 of 3 calendars shown");
  press("Choose calendars");
  const sheet = within(screen.getByRole("dialog"));
  expect(sheet.getByRole("checkbox", { name: "Show Work, work@example.test" })).toBeChecked();
  expect(
    sheet.getByRole("checkbox", { name: "Show Holidays, work@example.test, Read only" }),
  ).not.toBeChecked();
  expect(sheet.getByText("work@example.test · Read only")).toBeVisible();
  expect(sheet.getByText("Stored in nohmi")).toBeVisible();
  expect(sheet.getAllByText("Updated Fri, Nov 13, 9:41 AM")).toHaveLength(2);

  fireEvent.click(
    sheet.getByRole("checkbox", { name: "Show Holidays, work@example.test, Read only" }),
  );
  await waitFor(() =>
    expect(
      sheet.getByRole("checkbox", { name: "Show Holidays, work@example.test, Read only" }),
    ).toBeChecked(),
  );
  expect(h.api.setCalendarSelected).toHaveBeenCalledWith("holidays", true);
  await waitFor(() => expect(h.api.listEvents).toHaveBeenCalledTimes(2));
  expect(screen.queryByText(/calendars shown/)).toBeNull();
  expect(h.success).not.toHaveBeenCalled();
  expect(h.error).not.toHaveBeenCalled();

  fireEvent.click(sheet.getByRole("button", { name: "Done" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("reports a failed calendar choice through Sonner and keeps the saved choice", async () => {
  h.api.setCalendarSelected.mockRejectedValue(new Error("offline"));
  mount(<CalendarRoute />);
  await screen.findByText("2 of 3 calendars shown");
  press("Choose calendars");
  fireEvent.click(screen.getByRole("checkbox", { name: "Show Work, work@example.test" }));
  await waitFor(() => expect(h.error).toHaveBeenCalledTimes(1));
  expect(h.error.mock.calls[0]?.[0]).toMatch(/Couldn’t confirm the result/);
  expect(screen.getByRole("checkbox", { name: "Show Work, work@example.test" })).toBeChecked();
  expect(screen.queryByText(/Couldn’t confirm/)).toBeNull();
  expect(h.api.listEvents).toHaveBeenCalledTimes(1);
});

it("explains hidden, missing and unavailable calendars instead of an empty day", async () => {
  h.api.listCalendars.mockResolvedValue([{ ...work, isSelected: false }]);
  const hidden = mount(<CalendarRoute />);
  expect(await screen.findByText(/Every calendar is hidden/)).toBeVisible();
  hidden.unmount();

  h.api.listCalendars.mockResolvedValue([]);
  const none = mount(<CalendarRoute />);
  expect(await screen.findByText(/No calendars yet/)).toBeVisible();
  press("Choose calendars");
  expect(within(screen.getByRole("dialog")).getByText(/No calendars yet/)).toBeVisible();
  none.unmount();

  h.api.listCalendars
    .mockRejectedValueOnce(new Error("offline"))
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue([work]);
  const failed = mount(<CalendarRoute />);
  await screen.findByRole("heading", { name: "All day" });
  press("Choose calendars");
  const sheet = within(screen.getByRole("dialog"));
  fireEvent.click(await sheet.findByRole("button", { name: "Retry loading" }));
  expect(
    await sheet.findByRole("checkbox", { name: "Show Work, work@example.test" }),
  ).toBeChecked();
  failed.unmount();

  h.api.listCalendars.mockReturnValue(new Promise(() => {}));
  mount(<CalendarRoute />);
  await screen.findByRole("heading", { name: "All day" });
  press("Choose calendars");
  expect(within(screen.getByRole("dialog")).getByRole("progressbar")).toBeVisible();
});

it("flags shown calendars whose events may be out of date", async () => {
  const stale = { ...work, lastSyncedAt: null };
  const broken = calendar("team", "Team", {
    source: { ...source, syncStatus: "error", syncError: "Quota exceeded." } as never,
  });
  h.api.listCalendars.mockResolvedValue([stale, personal]);
  h.api.listEvents.mockResolvedValue([holiday]);
  const one = mount(<CalendarRoute />);
  expect(await screen.findByText("No timed events.")).toBeVisible();
  press("Work may be out of date");
  expect(within(screen.getByRole("dialog")).getByText("Not updated yet")).toBeVisible();
  one.unmount();

  h.api.listCalendars.mockResolvedValue([stale, broken]);
  mount(<CalendarRoute />);
  expect(await screen.findByText("2 calendars may be out of date")).toBeVisible();
});

it("offers a retry after a failed read and one notice for a failed pull-to-refresh", async () => {
  h.api.listEvents.mockRejectedValueOnce(new Error("offline"));
  mount(<CalendarRoute />);
  press(await screen.findByText("Retry loading").then(() => "Retry loading"));
  expect(await screen.findByText("All day")).toBeVisible();

  press("Pull to refresh");
  await waitFor(() => expect(h.api.listEvents).toHaveBeenCalledTimes(3));
  expect(h.refreshFailed).not.toHaveBeenCalled();
  h.api.listEvents.mockRejectedValueOnce(new Error("offline"));
  press("Pull to refresh");
  await waitFor(() => expect(h.refreshFailed).toHaveBeenCalledTimes(1));
  expect(screen.getByText("All day")).toBeVisible();
});

it("asks for a timezone before reading any events", () => {
  h.timezone = undefined;
  mount(<CalendarRoute />);
  press(/Set your timezone/);
  expect(h.navigate).toHaveBeenCalledWith("/settings");
  expect(h.api.listEvents).not.toHaveBeenCalled();
});

it("shows read-only event details with time zone, source, freshness, place and call", async () => {
  h.params = { id: "Standup" };
  h.api.getEvent.mockResolvedValue({
    ...standup,
    timezone: "Europe/London",
    status: "tentative",
    recurrence: ["RRULE:FREQ=DAILY"],
    url: "https://example.test/agenda",
    notes: "Bring the roadmap.",
    reminders: [{ minutes: 10 }, { minutes: 90 }, { minutes: 0 }],
    attendees: [
      { email: "ada@example.test", name: "Ada", response: "accepted", isOrganizer: true },
      { email: "sam@example.test", name: null, response: "declined", isOrganizer: false },
    ],
  });
  mount(<CalendarEventRoute />);
  expect(screen.getByRole("progressbar")).toBeVisible();
  expect(await screen.findByRole("heading", { name: "Standup" })).toBeVisible();
  expect(h.api.getEvent).toHaveBeenCalledWith("Standup");
  expect(screen.getByText("Friday, November 13 · 9:00 AM – 9:30 AM")).toBeVisible();
  expect(
    screen.getByText(
      "Times shown in Eastern Standard Time · Event set in Greenwich Mean Time · Tentative · Repeats",
    ),
  ).toBeVisible();
  expect(screen.getByText("Room 4")).toBeVisible();
  expect(await screen.findByText("Work")).toBeVisible();
  expect(screen.getByText("work@example.test")).toBeVisible();
  expect(screen.getByText("Updated Fri, Nov 13, 9:41 AM")).toBeVisible();
  expect(screen.getByText("10 minutes before · 1 hour 30 minutes before · At start")).toBeVisible();
  expect(screen.getByText("Organizer · Accepted")).toBeVisible();
  expect(screen.getByText("sam@example.test")).toBeVisible();
  expect(screen.getByText("Bring the roadmap.")).toBeVisible();
  expect(screen.queryByRole("button", { name: /edit|delete|save/i })).toBeNull();

  press(/Join video call/);
  expect(h.openURL).toHaveBeenCalledWith("https://meet.example.test/standup");
  h.openURL.mockRejectedValueOnce(new Error("no handler"));
  press(/Open link/);
  await waitFor(() => expect(h.error).toHaveBeenCalledWith("Couldn’t open this link."));
});

it("is honest about all-day, cancelled, unsynced and pending-call events", async () => {
  h.params = { id: "Founders day" };
  h.api.listCalendars.mockResolvedValue([{ ...work, lastSyncedAt: null, isWritable: false }]);
  h.api.getEvent.mockResolvedValue({
    ...holiday,
    status: "cancelled",
    conferenceStatus: "pending",
  });
  const first = mount(<CalendarEventRoute />);
  expect(await screen.findByText("Friday, November 13 · All day")).toBeVisible();
  expect(screen.getByText("Cancelled")).toBeVisible();
  expect(screen.queryByText(/Times shown/)).toBeNull();
  expect(screen.getByText("The video link is still being created.")).toBeVisible();
  expect(await screen.findByText("work@example.test · Read only")).toBeVisible();
  expect(screen.getByText("Not updated yet")).toBeVisible();
  first.unmount();

  h.api.listCalendars.mockResolvedValue([]);
  h.api.getEvent.mockResolvedValue({ ...lunch, conferenceStatus: "failure" });
  mount(<CalendarEventRoute />);
  expect(await screen.findByText("The video link couldn’t be created.")).toBeVisible();
  expect(screen.getByText("Calendar unavailable")).toBeVisible();
  expect(screen.getByText("This calendar is no longer connected.")).toBeVisible();
});

it("opens from the list's copy, and recovers from a missing or failed event", async () => {
  h.params = { id: "Review" };
  h.api.getEvent.mockReturnValue(new Promise(() => {}));
  const cached = mount(<CalendarEventRoute />);
  act(() => client.setQueryData(["calendar", "owner-a", 1, "events", "a", "b"], [review]));
  cached.unmount();
  const seeded = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  seeded.setQueryData(["calendar", "owner-a", 1, "events", "a", "b"], [standup, review]);
  const view = render(
    <QueryClientProvider client={seeded}>
      <CalendarEventRoute />
    </QueryClientProvider>,
  );
  expect(screen.getByRole("heading", { name: "Review" })).toBeVisible();
  view.unmount();

  h.api.getEvent.mockReset().mockRejectedValueOnce(new Error("gone")).mockResolvedValue(review);
  mount(<CalendarEventRoute />);
  press(await screen.findByText("Retry loading").then(() => "Retry loading"));
  expect(await screen.findByRole("heading", { name: "Review" })).toBeVisible();
  cleanup();

  h.params = {};
  mount(<CalendarEventRoute />);
  expect(screen.getByText("This event is no longer available.")).toBeVisible();
  expect(h.api.getEvent).toHaveBeenCalledTimes(2);
  cleanup();

  h.params = { id: "Review" };
  h.api.getEvent
    .mockReset()
    .mockRejectedValue(
      new ApiClientError({ code: "not_found", message: "Event not found", status: 404 }),
    );
  const deleted = new QueryClient({ defaultOptions: { queries: { retry: 2, retryDelay: 0 } } });
  render(
    <QueryClientProvider client={deleted}>
      <CalendarEventRoute />
    </QueryClientProvider>,
  );
  expect(await screen.findByText("This event is no longer available.")).toBeVisible();
  expect(screen.queryByText("Retry loading")).toBeNull();
  expect(h.api.getEvent).toHaveBeenCalledTimes(1);
});
