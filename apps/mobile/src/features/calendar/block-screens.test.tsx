// @vitest-environment jsdom
import { ApiClientError } from "@personal-os/api-client";
import type { Calendar, CalendarEvent, CalendarEventBlock } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PropsWithChildren, ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import CalendarEventRoute from "../../app/calendar-event";
import CalendarEventBlocksRoute from "../../app/calendar-event-blocks";
import CalendarEventEditRoute from "../../app/calendar-event-edit";

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
    createEventBlock: vi.fn(),
    updateEventBlock: vi.fn(),
    deleteEventBlock: vi.fn(),
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
const personal = calendar("personal", "Personal");
const holidays = calendar("holidays", "Holidays", { isWritable: false });
function block(mode: "busy" | "details", extra: Partial<CalendarEventBlock> = {}) {
  return {
    calendarId: "personal",
    eventId: "block-1",
    mode,
    provider: "google",
    updatedAt: "2026-11-12T11:00:00.000Z",
    ...extra,
  } as CalendarEventBlock;
}
const blocked = (mode: "busy" | "details" = "busy") => ({ ...standup, blocks: [block(mode)] });
function other(id: string, startsAt: string, endsAt: string, extra: Partial<CalendarEvent> = {}) {
  return { ...standup, id, title: id, startsAt, endsAt, location: null, ...extra } as CalendarEvent;
}
const offline = () => new TypeError("Network request failed");
const refused = (status: number, message: string, details?: Record<string, unknown>) =>
  new ApiClientError({ code: "refused", message, status, details });

/** What the API holds for Standup; block writes change it the way the server would. */
let record: CalendarEvent;
function serve(event: CalendarEvent) {
  record = event;
  h.api.getEvent.mockImplementation(async () => record);
}
let client: QueryClient;
function mount(node: ReactNode) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}
const button = (name: string | RegExp) => screen.getByRole("button", { name });
const press = (name: string | RegExp) => fireEvent.click(button(name));
const toggle = (name: string) => screen.getByRole("switch", { name }) as HTMLInputElement;
const field = (name: string) => screen.getByRole("textbox", { name }) as HTMLInputElement;
const type = (name: string, value: string) => fireEvent.change(field(name), { target: { value } });
/** No toast text may also be rendered on the page. */
function expectNoInlineResult() {
  const calls = [...h.error.mock.calls, ...h.success.mock.calls, ...h.loading.mock.calls];
  expect(calls.length).toBeGreaterThan(0);
  for (const call of calls) expect(screen.queryByText(call[0] as string)).toBeNull();
}
async function openBlocks() {
  h.params = { id: "Standup" };
  mount(<CalendarEventBlocksRoute />);
  await screen.findByRole("switch", { name: "Block on Personal" });
}
async function openDetails() {
  h.params = { id: "Standup" };
  mount(<CalendarEventRoute />);
  await screen.findByRole("heading", { name: "Standup" });
}
/** One attempt to block on Personal, settled before the test goes on. */
async function blockOnPersonal(toasts: number) {
  fireEvent.click(toggle("Block on Personal"));
  await waitFor(() => expect(h.error.mock.calls.length + h.success.mock.calls.length).toBe(toasts));
  await waitFor(() => expect(toggle("Block on Personal")).toBeEnabled());
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-13T15:00:00.000Z")); // 10 AM in New York
  vi.clearAllMocks();
  h.timezone = zone;
  h.epoch = 1;
  h.params = {};
  h.api.listEvents.mockReset().mockResolvedValue([standup]);
  h.api.listCalendars.mockReset().mockResolvedValue([work, personal, holidays]);
  h.api.getEvent.mockReset();
  serve(standup);
  h.api.getWorkspaceSettings.mockReset().mockResolvedValue({
    workspace: "calendar",
    preferences: { weekStartsOn: "sunday", defaultEventDurationMinutes: 30 },
  });
  h.api.getDomainProfile.mockReset().mockResolvedValue({
    status: "active",
    preferences: { defaultCalendarId: "personal", busyBlockPrivacy: "busy" },
  });
  h.api.createEventBlock.mockReset().mockImplementation(async (_id, input) => {
    record = { ...standup, blocks: [block(input.mode, { calendarId: input.calendarId })] };
    return record;
  });
  h.api.updateEventBlock.mockReset().mockImplementation(async (_id, _block, input) => {
    record = blocked(input.mode);
    return record;
  });
  h.api.deleteEventBlock.mockReset().mockImplementation(async () => {
    record = standup;
    return record;
  });
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

it("opens Block time from an event and says where its time is already blocked", async () => {
  serve(blocked("details"));
  await openDetails();
  expect(
    await screen.findByRole("button", {
      name: "Blocks time on other calendars Personal (Details)",
    }),
  ).toBeVisible();
  press("Event actions");
  press("Block time");
  expect(h.push).toHaveBeenCalledWith({
    pathname: "/calendar-event-blocks",
    params: { id: "Standup" },
  });
  cleanup();

  // A read-only event can still block time elsewhere; a block that follows another cannot.
  h.push.mockClear();
  serve({ ...standup, calendarId: "holidays" });
  await openDetails();
  // Block time is the only action, so it stands in the header by itself.
  fireEvent.click(await screen.findByRole("button", { name: "Block time" }));
  expect(screen.queryByRole("button", { name: /^Blocks time/ })).toBeNull();
  expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  expect(h.push).toHaveBeenCalledOnce();
  cleanup();

  serve({ ...standup, blockSourceEventId: "source" });
  await openDetails();
  await screen.findByText("Work");
  expect(screen.queryByRole("button", { name: "Event actions" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Block time" })).toBeNull();
});

it("blocks the event's time on another calendar with the saved privacy once the API confirms it", async () => {
  await openBlocks();
  expect(screen.getByRole("navigation", { name: "block time" })).toBeVisible();
  expect(toggle("Block on Personal").checked).toBe(false);
  // The event's own calendar and a read-only calendar are not offered.
  expect(screen.queryByRole("switch", { name: "Block on Work" })).toBeNull();
  expect(screen.queryByRole("switch", { name: "Block on Holidays" })).toBeNull();
  expect(button("New blocks show, Busy")).toBeEnabled();
  expect(screen.queryByRole("button", { name: /^Personal shows/ })).toBeNull();

  let confirmBlock: (event: CalendarEvent) => void = () => {};
  h.api.createEventBlock.mockReturnValue(
    new Promise<CalendarEvent>((resolve) => {
      confirmBlock = resolve;
    }),
  );
  fireEvent.click(toggle("Block on Personal"));
  await waitFor(() => expect(toggle("Block on Personal")).toBeDisabled());
  // Nothing reads as blocked until the API says so.
  expect(toggle("Block on Personal").checked).toBe(false);
  expect(h.success).not.toHaveBeenCalled();
  record = blocked("busy");
  confirmBlock(record);

  await waitFor(() => expect(toggle("Block on Personal").checked).toBe(true));
  expect(h.api.createEventBlock).toHaveBeenCalledExactlyOnceWith("Standup", {
    calendarId: "personal",
    mode: "busy",
    expectedUpdatedAt: standup.updatedAt,
  });
  expect(h.loading).toHaveBeenCalledExactlyOnceWith("Blocking time…");
  expect(h.success).toHaveBeenCalledExactlyOnceWith("Time blocked on Personal", { id: "toast-1" });
  expect(h.error).not.toHaveBeenCalled();
  expect(button("Personal shows, Busy")).toBeEnabled();
  expectNoInlineResult();
});

it("starts from Details when that is the saved busy-block privacy, and takes another choice", async () => {
  h.api.getDomainProfile.mockResolvedValue({
    status: "active",
    preferences: { busyBlockPrivacy: "details" },
  });
  await openBlocks();
  expect(button("New blocks show, Details")).toBeEnabled();
  await blockOnPersonal(1);
  expect(h.api.createEventBlock).toHaveBeenLastCalledWith(
    "Standup",
    expect.objectContaining({ mode: "details" }),
  );
  cleanup();

  // Guidance that is not active has no saved privacy, so a block shows Busy.
  h.api.getDomainProfile.mockResolvedValue({
    status: "draft",
    preferences: { busyBlockPrivacy: "details" },
  });
  await openBlocks();
  expect(button("New blocks show, Busy")).toBeEnabled();
  press("New blocks show, Busy");
  fireEvent.click(screen.getByRole("radio", { name: "Details" }));
  await blockOnPersonal(2);
  expect(h.api.createEventBlock).toHaveBeenLastCalledWith(
    "Standup",
    expect.objectContaining({ mode: "details" }),
  );
});

it("removes a block with the revisions the person saw", async () => {
  serve(blocked());
  await openBlocks();
  expect(toggle("Block on Personal").checked).toBe(true);
  fireEvent.click(toggle("Block on Personal"));

  await waitFor(() => expect(toggle("Block on Personal").checked).toBe(false));
  expect(h.api.deleteEventBlock).toHaveBeenCalledExactlyOnceWith("Standup", "block-1", {
    expectedBlockUpdatedAt: "2026-11-12T11:00:00.000Z",
    expectedUpdatedAt: standup.updatedAt,
  });
  expect(h.loading).toHaveBeenCalledExactlyOnceWith("Removing block…");
  expect(h.success).toHaveBeenCalledExactlyOnceWith("Block removed from Personal", {
    id: "toast-1",
  });
  expect(h.api.createEventBlock).not.toHaveBeenCalled();
  expectNoInlineResult();
});

it("changes what a block shows on its calendar", async () => {
  serve(blocked("busy"));
  await openBlocks();
  press("Personal shows, Busy");
  fireEvent.click(screen.getByRole("radio", { name: "Details" }));

  await screen.findByRole("button", { name: "Personal shows, Details" });
  expect(h.api.updateEventBlock).toHaveBeenCalledExactlyOnceWith("Standup", "block-1", {
    mode: "details",
    expectedBlockUpdatedAt: "2026-11-12T11:00:00.000Z",
    expectedUpdatedAt: standup.updatedAt,
  });
  expect(h.loading).toHaveBeenCalledExactlyOnceWith("Changing block…");
  expect(h.success).toHaveBeenCalledExactlyOnceWith("Personal now shows Details", {
    id: "toast-1",
  });
  expect(toggle("Block on Personal").checked).toBe(true);
  expectNoInlineResult();
});

it("reports a refused block through Sonner and leaves the time unblocked", async () => {
  h.api.createEventBlock.mockRejectedValueOnce(
    refused(400, "An event cannot block a calendar that already contains this occurrence."),
  );
  await openBlocks();
  await blockOnPersonal(1);
  expect(h.error).toHaveBeenCalledExactlyOnceWith(
    "An event cannot block a calendar that already contains this occurrence.",
    { id: "toast-1" },
  );
  expect(toggle("Block on Personal").checked).toBe(false);
  expectNoInlineResult();

  // A refusal changed nothing, so the next attempt is sent without a check first.
  h.api.getEvent.mockClear();
  h.api.listEvents.mockClear();
  await blockOnPersonal(2);
  expect(h.api.createEventBlock).toHaveBeenCalledTimes(2);
  expect(h.api.listEvents).not.toHaveBeenCalledWith(
    expect.objectContaining({ calendarIds: ["personal"] }),
  );
});

it("reports a block that lost a race with another change, and shows the latest", async () => {
  h.api.createEventBlock.mockRejectedValueOnce(
    refused(409, "The calendar event changed since it was loaded."),
  );
  await openBlocks();
  h.api.getEvent.mockClear();
  await blockOnPersonal(1);
  expect(h.error).toHaveBeenCalledExactlyOnceWith(
    "This event or its blocks changed elsewhere, so nothing was sent. The latest is shown now.",
    { id: "toast-1" },
  );
  await waitFor(() => expect(h.api.getEvent).toHaveBeenCalled());
  expectNoInlineResult();
});

it("reads the event before repeating an unconfirmed block and sends nothing when it is there", async () => {
  h.api.createEventBlock.mockRejectedValueOnce(offline());
  await openBlocks();
  await blockOnPersonal(1);
  expect(h.error).toHaveBeenCalledExactlyOnceWith(
    "Couldn’t confirm the time was blocked on Personal. nohmi will check Personal before blocking again.",
    { id: "toast-1" },
  );
  expect(toggle("Block on Personal").checked).toBe(false);
  expectNoInlineResult();

  // The first attempt did work: the record now carries the block.
  serve(blocked());
  // The page's own re-read may land first; either way nothing more is created.
  if (!toggle("Block on Personal").checked) fireEvent.click(toggle("Block on Personal"));
  await waitFor(() => expect(toggle("Block on Personal").checked).toBe(true));
  expect(h.api.createEventBlock).toHaveBeenCalledOnce();
});

it("repeats an unconfirmed block only after the calendar shows no copy of it", async () => {
  h.api.createEventBlock.mockRejectedValueOnce(offline());
  await openBlocks();
  await blockOnPersonal(1);
  h.api.listEvents.mockClear();
  await blockOnPersonal(2);

  expect(h.api.listEvents).toHaveBeenCalledWith({
    from: "2026-11-12T14:00:00.000Z",
    to: "2026-11-14T14:30:00.000Z",
    calendarIds: ["personal"],
  });
  expect(h.api.createEventBlock).toHaveBeenCalledTimes(2);
  expect(h.success).toHaveBeenCalledExactlyOnceWith("Time blocked on Personal", { id: "toast-1" });
  // Confirmed, so after the block is removed the next attempt is sent without a check.
  await waitFor(() => expect(toggle("Block on Personal").checked).toBe(true));
  fireEvent.click(toggle("Block on Personal"));
  await waitFor(() => expect(toggle("Block on Personal").checked).toBe(false));
  await waitFor(() => expect(toggle("Block on Personal")).toBeEnabled());
  h.api.listEvents.mockClear();
  await blockOnPersonal(4);
  expect(h.api.listEvents).not.toHaveBeenCalledWith(
    expect.objectContaining({ calendarIds: ["personal"] }),
  );
});

it("sends nothing when an unlinked copy of a Details block is already on the calendar", async () => {
  h.api.getDomainProfile.mockResolvedValue({
    status: "active",
    preferences: { busyBlockPrivacy: "details" },
  });
  h.api.createEventBlock.mockRejectedValueOnce(refused(503, "The provider did not answer."));
  await openBlocks();
  await blockOnPersonal(1);
  h.api.listEvents.mockResolvedValue([{ ...standup, id: "copy", calendarId: "personal" }]);
  await blockOnPersonal(2);

  expect(h.api.createEventBlock).toHaveBeenCalledOnce();
  expect(h.error).toHaveBeenLastCalledWith(
    "Personal already has this time from the earlier attempt, but it isn’t linked to the event. Remove it in your calendar app before blocking again.",
    { id: "toast-1" },
  );
  expectNoInlineResult();
});

it("lets the API link a single unlinked Busy copy, but not two", async () => {
  const copy = { ...standup, id: "copy", title: "Busy", calendarId: "personal" };
  h.api.createEventBlock.mockRejectedValueOnce(offline());
  await openBlocks();
  await blockOnPersonal(1);
  h.api.listEvents.mockResolvedValue([copy, { ...copy, id: "copy-2" }]);
  await blockOnPersonal(2);
  expect(h.api.createEventBlock).toHaveBeenCalledOnce();
  expect(h.error).toHaveBeenLastCalledWith(expect.stringMatching(/^Personal already has/), {
    id: "toast-1",
  });

  h.api.listEvents.mockResolvedValue([copy]);
  await blockOnPersonal(3);
  expect(h.api.createEventBlock).toHaveBeenCalledTimes(2);
});

it("sends nothing when the calendar cannot be read before a repeat block", async () => {
  h.api.createEventBlock.mockRejectedValueOnce(offline());
  await openBlocks();
  await blockOnPersonal(1);
  h.api.listEvents.mockRejectedValue(offline());
  await blockOnPersonal(2);
  expect(h.error).toHaveBeenLastCalledWith(
    "Couldn’t check your calendar, so nothing was sent. Try again in a moment.",
    { id: "toast-1" },
  );
  h.api.listEvents.mockResolvedValue([]);
  h.api.getEvent.mockRejectedValue(offline());
  await blockOnPersonal(3);
  expect(h.error).toHaveBeenLastCalledWith(
    "Couldn’t check your calendar, so nothing was sent. Try again in a moment.",
    { id: "toast-1" },
  );
  expect(h.api.createEventBlock).toHaveBeenCalledOnce();
  expectNoInlineResult();
});

it("offers no repeat block on a hidden calendar, which nohmi cannot check", async () => {
  h.api.listCalendars.mockResolvedValue([
    work,
    calendar("personal", "Personal", { isSelected: false }),
  ]);
  h.api.createEventBlock.mockRejectedValueOnce(offline());
  await openBlocks();
  await blockOnPersonal(1);
  h.api.listEvents.mockClear();
  await blockOnPersonal(2);

  expect(h.api.createEventBlock).toHaveBeenCalledOnce();
  expect(h.api.listEvents).not.toHaveBeenCalledWith(
    expect.objectContaining({ calendarIds: ["personal"] }),
  );
  expect(h.error).toHaveBeenLastCalledWith(
    "nohmi can’t check Personal while it is hidden, so nothing was sent. Show it in Calendar, or check it in your calendar app.",
    { id: "toast-1" },
  );
});

it("waits for a sync when the provider took the block but nohmi could not link it", async () => {
  h.api.createEventBlock.mockRejectedValueOnce(
    refused(409, "The calendar event changed since it was loaded.", {
      partialEffect: "provider_event_created",
    }),
  );
  await openBlocks();
  await blockOnPersonal(1);
  expect(h.error).toHaveBeenCalledExactlyOnceWith(
    "Personal has this time, but nohmi couldn’t link it to the event. Try again after Personal next syncs.",
    { id: "toast-1" },
  );
  expectNoInlineResult();

  // The copy has not synced yet: creating again would write it twice.
  await blockOnPersonal(2);
  expect(h.api.createEventBlock).toHaveBeenCalledOnce();
  expect(h.error).toHaveBeenLastCalledWith(
    "Personal hasn’t synced the earlier attempt yet, so nothing was sent. Try again after it syncs.",
    { id: "toast-1" },
  );

  h.api.listEvents.mockResolvedValue([
    { ...standup, id: "copy", title: "Busy", calendarId: "personal" },
  ]);
  await blockOnPersonal(3);
  expect(h.api.createEventBlock).toHaveBeenCalledTimes(2);
});

it("changes every linked copy on a calendar and reports a partial change as unconfirmed", async () => {
  const mirrored = {
    ...standup,
    blocks: [block("busy"), block("busy", { eventId: "block-2", sourceEventId: "Mirror" })],
  };
  serve(mirrored);
  h.api.deleteEventBlock
    .mockResolvedValueOnce({ ...standup, blocks: [mirrored.blocks[1]] })
    .mockRejectedValueOnce(refused(404, "The linked calendar block was not found."));
  await openBlocks();
  fireEvent.click(toggle("Block on Personal"));

  await waitFor(() => expect(h.error).toHaveBeenCalledOnce());
  expect(h.api.deleteEventBlock).toHaveBeenNthCalledWith(1, "Standup", "block-1", {
    expectedBlockUpdatedAt: "2026-11-12T11:00:00.000Z",
    expectedUpdatedAt: standup.updatedAt,
  });
  // The other copy belongs to the same occurrence on another calendar, whose revision is unknown.
  expect(h.api.deleteEventBlock).toHaveBeenNthCalledWith(2, "Mirror", "block-2", {
    expectedBlockUpdatedAt: "2026-11-12T11:00:00.000Z",
  });
  expect(h.error).toHaveBeenCalledExactlyOnceWith(
    "Couldn’t confirm the block was removed from Personal. Check the block before trying again.",
    { id: "toast-1" },
  );
  cleanup();

  // A refusal before anything changed is reported as the refusal it is.
  h.error.mockClear();
  serve(blocked());
  h.api.updateEventBlock.mockRejectedValueOnce(refused(403, "This calendar is read only."));
  await openBlocks();
  press("Personal shows, Busy");
  fireEvent.click(screen.getByRole("radio", { name: "Details" }));
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledExactlyOnceWith("This calendar is read only.", {
      id: "toast-1",
    }),
  );
  expect(button("Personal shows, Busy")).toBeVisible();
});

it("explains when an event's time cannot be blocked anywhere", async () => {
  h.params = { id: "Standup" };
  serve({ ...standup, blockSourceEventId: "source" });
  mount(<CalendarEventBlocksRoute />);
  expect(
    await screen.findByText("This busy block follows another event. Block time from that event."),
  ).toBeVisible();
  cleanup();

  serve(standup);
  h.api.listCalendars.mockResolvedValue([work, holidays]);
  mount(<CalendarEventBlocksRoute />);
  expect(
    await screen.findByText("You have no other calendar that can take a block."),
  ).toBeVisible();
  cleanup();

  h.api.getEvent.mockRejectedValue(refused(404, "The calendar event was not found."));
  mount(<CalendarEventBlocksRoute />);
  expect(await screen.findByText("This event is no longer available.")).toBeVisible();
  cleanup();

  h.api.getEvent.mockClear().mockRejectedValue(offline());
  mount(<CalendarEventBlocksRoute />);
  fireEvent.click(await screen.findByRole("button", { name: "Retry loading" }));
  expect(h.api.getEvent).toHaveBeenCalledTimes(2);
  cleanup();

  serve(standup);
  h.api.listCalendars.mockRejectedValue(offline());
  mount(<CalendarEventBlocksRoute />);
  h.api.listCalendars.mockResolvedValue([work, personal]);
  fireEvent.click(await screen.findByRole("button", { name: "Retry loading" }));
  expect(await screen.findByRole("switch", { name: "Block on Personal" })).toBeVisible();
  press("Close");
  expect(h.back).toHaveBeenCalledOnce();
});

it("tells two calendars with one name apart by their source", async () => {
  h.api.listCalendars.mockResolvedValue([
    work,
    calendar("p1", "Personal"),
    calendar("p2", "Personal", { provider: "local" }),
  ]);
  h.params = { id: "Standup" };
  mount(<CalendarEventBlocksRoute />);
  expect(await screen.findAllByRole("switch", { name: /^Block on Personal · / })).toHaveLength(2);
});

it("shows the events that conflict with an event and opens them", async () => {
  const dentist = other("Dentist", "2026-11-13T14:15:00.000Z", "2026-11-13T15:00:00.000Z", {
    calendarId: "personal",
  });
  h.api.listEvents.mockResolvedValue([
    standup,
    dentist,
    other("Lunch", "2026-11-13T17:00:00.000Z", "2026-11-13T18:00:00.000Z"),
  ]);
  await openDetails();
  expect(await screen.findByRole("heading", { name: "Conflicts" })).toBeVisible();
  expect(h.api.listEvents).toHaveBeenCalledWith({ from: standup.startsAt, to: standup.endsAt });
  expect(screen.getByText("Compared with timed events on the calendars you show.")).toBeVisible();
  expect(screen.queryByRole("button", { name: /^Lunch/ })).toBeNull();
  press(/^Dentist Friday, November 13 · 9:15 AM – 10:00 AM · Personal/);
  expect(h.push).toHaveBeenCalledWith({ pathname: "/calendar-event", params: { id: "Dentist" } });
});

it("shows no conflicts for a free time, and does not compare events the review leaves out", async () => {
  await openDetails();
  await waitFor(() => expect(h.api.listEvents).toHaveBeenCalled());
  expect(screen.queryByRole("heading", { name: "Conflicts" })).toBeNull();
  cleanup();

  h.api.listEvents.mockClear();
  serve({ ...standup, allDay: true });
  await openDetails();
  expect(h.api.listEvents).not.toHaveBeenCalled();
  expect(screen.queryByRole("heading", { name: "Conflicts" })).toBeNull();
});

it("offers a retry when conflicts could not be checked", async () => {
  h.api.listEvents.mockRejectedValueOnce(offline());
  await openDetails();
  const retry = await screen.findByRole("button", { name: /^Couldn’t check for conflicts/ });
  h.api.listEvents.mockResolvedValue([
    standup,
    other("Dentist", "2026-11-13T14:15:00.000Z", "2026-11-13T15:00:00.000Z"),
  ]);
  fireEvent.click(retry);
  expect(await screen.findByRole("button", { name: /^Dentist/ })).toBeVisible();
});

it("previews whether a proposed time is free before the event is created", async () => {
  h.params = { day: "2026-11-13" };
  h.api.listEvents.mockImplementation(async ({ from, to }: { from: string; to: string }) =>
    [standup, other("Review", "2026-11-13T19:15:00.000Z", "2026-11-13T19:45:00.000Z")].filter(
      (event) => event.startsAt < to && event.endsAt > from,
    ),
  );
  mount(<CalendarEventEditRoute />);
  await screen.findByRole("textbox", { name: "Event title" });
  // 11:00 – 11:30 AM is clear.
  expect(await screen.findByText("This time is free on the calendars you show.")).toBeVisible();
  expect(h.api.listEvents).toHaveBeenCalledWith({
    from: "2026-11-13T16:00:00.000Z",
    to: "2026-11-13T16:30:00.000Z",
  });

  type("Start time", "14:00");
  expect(
    await screen.findByText(
      "Overlaps Review (Friday, November 13 · 2:15 PM – 2:45 PM) on the calendars you show.",
    ),
  ).toBeVisible();
  expect(screen.queryByText("This time is free on the calendars you show.")).toBeNull();
  // Looking is not a write: nothing was sent and nothing was announced.
  expect(h.api.createEvent).not.toHaveBeenCalled();
  expect(h.loading).not.toHaveBeenCalled();
  expect(h.success).not.toHaveBeenCalled();

  type("End time", "13:00");
  expect(screen.queryByText(/on the calendars you show/)).toBeNull();
  fireEvent.click(screen.getByRole("switch", { name: "All day" }));
  expect(screen.getByText("All-day events aren’t compared with other events.")).toBeVisible();
});

it("counts several overlaps, leaves out the event being edited, and retries a failed check", async () => {
  h.params = { id: "Standup" };
  h.api.listEvents.mockResolvedValue([
    standup,
    other("Dentist", "2026-11-13T14:15:00.000Z", "2026-11-13T15:00:00.000Z"),
    other("Call", "2026-11-13T14:00:00.000Z", "2026-11-13T14:10:00.000Z"),
    other("Sync", "2026-11-13T14:20:00.000Z", "2026-11-13T14:25:00.000Z"),
  ]);
  mount(<CalendarEventEditRoute />);
  await screen.findByRole("textbox", { name: "Event title" });
  expect(
    await screen.findByText(
      "Overlaps Call (Friday, November 13 · 9:00 AM – 9:10 AM) and 2 more on the calendars you show.",
    ),
  ).toBeVisible();
  cleanup();

  h.api.listEvents.mockRejectedValueOnce(offline()).mockResolvedValue([standup]);
  mount(<CalendarEventEditRoute />);
  fireEvent.click(await screen.findByRole("button", { name: "Check this time again" }));
  expect(await screen.findByText("This time is free on the calendars you show.")).toBeVisible();
});
