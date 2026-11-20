// @vitest-environment jsdom
import { ApiClientError } from "@personal-os/api-client";
import type { RitualState } from "@personal-os/domain";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";
import { createAppQueryClient } from "../../lib/query-client.js";
import { BrowserRitual } from "./browser-ritual.js";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  response: vi.fn(),
  action: vi.fn(),
  brief: vi.fn(),
  weather: vi.fn(),
}));
vi.mock("../../api.js", () => ({
  api: {
    getMe: async () => ({ displayName: "Alex Morgan" }),
    getCurrentRitual: mocks.read,
    getDailyBrief: mocks.brief,
    getWeather: mocks.weather,
    saveRitualResponse: mocks.response,
    recordRitualAction: mocks.action,
  },
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), dismiss: vi.fn(), loading: vi.fn(), success: vi.fn() },
  Toaster: () => null,
}));
function state(): RitualState {
  const now = Date.now();
  const definition = {
    id: "morning",
    kind: "morning" as const,
    title: "Good morning",
    enabled: true,
    time: "06:00",
    targetTime: "09:00",
    timeZone: "UTC",
    revision: 1,
    enabledAt: new Date(now - 86400000).toISOString(),
    steps: [{ id: "water", label: "Drink water", kind: "checkbox" as const }],
  };
  return {
    definitions: [definition],
    current: {
      id: "today",
      ritualId: definition.id,
      definitionRevision: 1,
      scheduledLocalDate: new Date(now).toISOString().slice(0, 10),
      timeZone: "UTC",
      dueAt: new Date(now - 1000).toISOString(),
      expiresAt: new Date(now + 3600000).toISOString(),
      definition,
      status: "pending",
      revision: 1,
      snoozedUntil: null,
      settledAt: null,
      responses: [],
      actions: [],
    },
    serverNow: new Date(now).toISOString(),
    snoozeCount: 0,
    streakCount: 3,
    syncStatus: "saved",
  };
}
function brief() {
  const now = Date.now();
  return {
    timeZone: "UTC",
    allDay: [],
    now: [],
    laterToday: [
      {
        id: "standup",
        title: "Standup",
        allDay: false,
        startsAt: new Date(now + 3600000).toISOString(),
      },
    ],
    tasks: [
      {
        id: "taxes",
        title: "File taxes",
        lifecycle: "open",
        deletedAt: null,
        dueAt: new Date(now - 60000).toISOString(),
        scheduledAt: null,
      },
    ],
    today: [{ id: "mom", title: "Call mom", completedAt: null, dueAt: null }],
    overdue: [],
  };
}
/** jsdom's PointerEvent drops coordinates, so drags are dispatched as mouse-shaped pointer events. */
function pointer(
  element: Element,
  type: string,
  init: { pointerId: number; button?: number; clientX?: number; clientY?: number },
) {
  const event = new MouseEvent(type, { bubbles: true, ...init });
  Object.defineProperty(event, "pointerId", { value: init.pointerId });
  fireEvent(element, event);
}
async function openRitual() {
  fireEvent.click(await screen.findByRole("button", { name: "Open morning ritual" }));
  return screen.findByRole("dialog", { name: "Morning ritual" });
}
beforeEach(() => {
  localStorage.clear();
  mocks.brief.mockResolvedValue(brief());
  mocks.weather.mockResolvedValue({
    condition: "Clear",
    temperatureF: 71.6,
    location: { shortLabel: "NYC" },
  });
});
function setup() {
  const client = createAppQueryClient({ queries: { retry: false } });
  const view = render(
    <QueryClientProvider client={client}>
      <label>
        Existing draft
        <input defaultValue="Keep this draft" />
      </label>
      <BrowserRitual userId="owner" />
    </QueryClientProvider>,
  );
  return { ...view, client };
}
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});
it("rests as a card that leaves the page usable and opens only when asked", async () => {
  mocks.read.mockResolvedValue(state());
  setup();
  const card = await screen.findByRole("button", { name: "Open morning ritual" });
  expect(screen.getByText("Your morning ritual is ready")).toBeInTheDocument();
  expect(await screen.findByText("2 tasks due · 0 of 1 steps done")).toBeInTheDocument();
  expect(screen.getByText(/Next: Standup · /)).toBeInTheDocument();
  expect(screen.getByText(/(until|past|Right at) 9:00 AM/)).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  const draft = screen.getByLabelText("Existing draft");
  fireEvent.change(draft, { target: { value: "Still editable" } });
  expect(draft).toHaveValue("Still editable");

  fireEvent.click(card);
  const dialog = await screen.findByRole("dialog", { name: "Morning ritual" });
  expect(screen.queryByRole("button", { name: "Open morning ritual" })).not.toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: "Drink water" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "3-day morning streak" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Schedule" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Start breathing exercise" })).toBeInTheDocument();
  expect(screen.getByText("Standup")).toBeInTheDocument();
  expect(screen.getByText("File taxes")).toBeInTheDocument();
  expect(screen.getByText("Overdue")).toBeInTheDocument();
  expect(screen.getByText("Call mom")).toBeInTheDocument();
  expect(await screen.findByText("NYC · 72° · Clear")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Snooze" })).not.toBeInTheDocument();
  const shortcut = vi.fn();
  window.addEventListener("keydown", shortcut);
  fireEvent.keyDown(dialog, { key: "k", ctrlKey: true });
  expect(shortcut).not.toHaveBeenCalled();
  window.removeEventListener("keydown", shortcut);

  fireEvent.keyDown(dialog, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  await openRitual();
  fireEvent.click(screen.getByRole("button", { name: "Minimize" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(screen.getByRole("button", { name: "Open morning ritual" })).toBeInTheDocument();
  expect(mocks.action).not.toHaveBeenCalled();
});
it("never invents today's facts when they cannot be loaded", async () => {
  mocks.read.mockResolvedValue(state());
  mocks.brief.mockRejectedValue(new Error("offline"));
  mocks.weather.mockRejectedValue(new Error("offline"));
  setup();
  await screen.findByRole("button", { name: "Open morning ritual" });
  expect(screen.getByText("0 of 1 steps done")).toBeInTheDocument();
  expect(screen.queryByText(/tasks? due/)).not.toBeInTheDocument();
  await openRitual();
  expect(await screen.findAllByRole("button", { name: "Try again" })).toHaveLength(2);
  expect(screen.queryByText(/Nothing due today/)).not.toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: "Drink water" })).toBeInTheDocument();
  mocks.brief.mockResolvedValue({ ...brief(), laterToday: [], tasks: [], today: [] });
  fireEvent.click(screen.getAllByRole("button", { name: "Try again" })[0]!);
  expect(await screen.findByText("Nothing due today")).toBeInTheDocument();
  expect(screen.getByText("Nothing else scheduled today")).toBeInTheDocument();
});
it("moves between anchors by keyboard and drag, remembers the place, and does not open after a drag", async () => {
  mocks.read.mockResolvedValue(state());
  const { unmount, client } = setup();
  const card = await screen.findByRole("button", { name: "Open morning ritual" });
  const shell = card.parentElement!;
  expect(shell).toHaveAttribute("data-anchor", "4");
  fireEvent.keyDown(card, { key: "ArrowUp" });
  expect(shell).toHaveAttribute("data-anchor", "3");
  fireEvent.keyDown(card, { key: "ArrowLeft" });
  expect(shell).toHaveAttribute("data-anchor", "7");
  fireEvent.keyDown(card, { key: "Tab" });
  expect(shell).toHaveAttribute("data-anchor", "7");

  shell.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 }) as DOMRect;
  pointer(shell, "pointerdown", { pointerId: 1, button: 0, clientX: 500, clientY: 500 });
  pointer(shell, "pointermove", { pointerId: 1, clientX: 502, clientY: 501 });
  expect(shell).toHaveAttribute("data-dragging", "false");
  pointer(shell, "pointermove", { pointerId: 1, clientX: 100, clientY: 100 });
  expect(shell).toHaveAttribute("data-dragging", "true");
  pointer(shell, "pointerup", { pointerId: 1 });
  expect(shell).toHaveAttribute("data-anchor", "0");
  expect(shell).toHaveAttribute("data-dragging", "false");
  fireEvent.click(card);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  // A secondary button never starts a drag, and an ordinary click still opens.
  pointer(shell, "pointerdown", { pointerId: 2, button: 2, clientX: 0, clientY: 0 });
  pointer(shell, "pointermove", { pointerId: 2, clientX: 300, clientY: 300 });
  expect(shell).toHaveAttribute("data-dragging", "false");
  pointer(shell, "pointerdown", { pointerId: 3, button: 0, clientX: 0, clientY: 0 });
  pointer(shell, "pointerup", { pointerId: 3 });
  fireEvent.click(card);
  expect(await screen.findByRole("dialog", { name: "Morning ritual" })).toBeInTheDocument();

  unmount();
  client.clear();
  setup();
  const again = await screen.findByRole("button", { name: "Open morning ritual" });
  expect(again.parentElement).toHaveAttribute("data-anchor", "0");
});
it("saves real answers, completes the same occurrence, and leaves the underlying page intact", async () => {
  const initial = state();
  mocks.read.mockResolvedValue(initial);
  const answered = {
    ...initial,
    current: {
      ...initial.current!,
      revision: 2,
      responses: [
        {
          id: "answer",
          requestId: "answer",
          stepId: "water",
          value: true,
          submitted: true,
          observedAt: initial.serverNow,
          recordedAt: initial.serverNow,
        },
      ],
    },
  };
  mocks.response.mockResolvedValue(answered);
  mocks.action.mockResolvedValue({
    outcome: "applied",
    state: { ...answered, current: { ...answered.current!, status: "completed", revision: 3 } },
  });
  const { client } = setup();
  await openRitual();
  fireEvent.click(screen.getByRole("checkbox", { name: "Drink water" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Done" })).toBeEnabled());
  expect(mocks.response).toHaveBeenCalledWith(
    "today",
    "water",
    expect.objectContaining({ expectedRevision: 1, value: true, submitted: true }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(screen.queryByRole("button", { name: "Open morning ritual" })).not.toBeInTheDocument();
  expect(mocks.action).toHaveBeenCalledWith(
    "today",
    expect.objectContaining({ kind: "complete", expectedRevision: 2 }),
  );
  expect(screen.getByLabelText("Existing draft")).toHaveValue("Keep this draft");
  expect(client.getQueryData(["ritual-current", "owner"])).toEqual(
    expect.objectContaining({
      state: expect.objectContaining({ current: expect.objectContaining({ status: "completed" }) }),
    }),
  );
});
it("does not present before due, after expiry, or while snoozed elsewhere", async () => {
  const initial = state();
  mocks.read.mockResolvedValue({
    ...initial,
    current: { ...initial.current!, snoozedUntil: new Date(Date.now() + 600000).toISOString() },
  });
  const { client } = setup();
  await waitFor(() => expect(mocks.read).toHaveBeenCalledOnce());
  expect(screen.queryByRole("button", { name: "Open morning ritual" })).not.toBeInTheDocument();
  expect(mocks.brief).not.toHaveBeenCalled();
  mocks.read.mockResolvedValue({
    ...initial,
    current: { ...initial.current!, status: "completed" },
  });
  await act(async () => {
    await client.refetchQueries({ queryKey: ["ritual-current", "owner"] });
  });
  expect(screen.queryByRole("button", { name: "Open morning ritual" })).not.toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("skips after one ordinary confirmation that states the streak impact", async () => {
  const initial = state();
  mocks.read.mockResolvedValue(initial);
  mocks.action.mockResolvedValue({
    outcome: "applied",
    state: { ...initial, current: { ...initial.current!, status: "skipped", revision: 2 } },
  });
  setup();
  await openRitual();
  fireEvent.click(screen.getByRole("button", { name: "Skip for Today" }));
  const confirmation = await screen.findByRole("dialog", { name: "Skip today’s ritual?" });
  expect(confirmation).toHaveTextContent("Skipping ends your 3-day streak.");
  expect(screen.queryByRole("button", { name: /Hold to skip/ })).not.toBeInTheDocument();
  expect(mocks.action).not.toHaveBeenCalled();
  fireEvent.click(within(confirmation).getByRole("button", { name: "Skip for Today" }));
  await waitFor(() =>
    expect(mocks.action).toHaveBeenCalledWith("today", expect.objectContaining({ kind: "skip" })),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(screen.queryByRole("button", { name: "Open morning ritual" })).not.toBeInTheDocument();
});
it("words a skip without a streak plainly", async () => {
  mocks.read.mockResolvedValue({ ...state(), streakCount: 0 });
  setup();
  await openRitual();
  fireEvent.click(screen.getByRole("button", { name: "Skip for Today" }));
  const confirmation = await screen.findByRole("dialog", { name: "Skip today’s ritual?" });
  expect(confirmation).toHaveTextContent("Today is recorded as skipped.");
  expect(confirmation).not.toHaveTextContent("streak");
});
it.each([401, 403])("clears private material on read denial %s", async (status) => {
  const initial = state();
  mocks.read.mockResolvedValue(initial);
  const { client } = setup();
  await openRitual();
  await screen.findByRole("checkbox", { name: "Drink water" });
  mocks.read.mockRejectedValue(
    new ApiClientError({ status, code: "unauthorized", message: "Sign in again." }),
  );
  await act(async () => {
    await client.refetchQueries({ queryKey: ["ritual-current", "owner"] });
  });
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(screen.queryByText("Good morning")).not.toBeInTheDocument();
  expect(screen.queryByText("Your morning ritual is ready")).not.toBeInTheDocument();
});
it("reports read errors through Sonner without blocking the page or repeating polling errors", async () => {
  mocks.read.mockRejectedValue(new Error("offline"));
  const { client } = setup();
  await waitFor(() => expect(toast.error).toHaveBeenCalledOnce());
  await act(async () => {
    await client.refetchQueries({ queryKey: ["ritual-current", "owner"] });
  });
  expect(toast.error).toHaveBeenCalledOnce();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByText(/Couldn’t refresh your ritual/)).not.toBeInTheDocument();
  expect(screen.getByLabelText("Existing draft")).toHaveValue("Keep this draft");
});
it("closes when another client completes the occurrence", async () => {
  const initial = state();
  mocks.read.mockResolvedValue(initial);
  setup();
  await openRitual();
  mocks.read.mockResolvedValue({
    ...initial,
    current: { ...initial.current!, status: "completed" },
  });
  fireEvent.focus(window);
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(screen.queryByRole("button", { name: "Open morning ritual" })).not.toBeInTheDocument();
});
it("retries a failed read from its Sonner action and resumes the ritual", async () => {
  mocks.read.mockRejectedValue(new Error("offline"));
  setup();
  await waitFor(() => expect(toast.error).toHaveBeenCalledOnce());
  const feedback = vi.mocked(toast.error).mock.calls[0]?.[1];
  mocks.read.mockResolvedValue(state());
  await act(async () => {
    if (
      feedback?.action &&
      typeof feedback.action === "object" &&
      "onClick" in feedback.action &&
      typeof feedback.action.onClick === "function"
    )
      feedback.action.onClick({} as never);
  });
  await screen.findByRole("button", { name: "Open morning ritual" });
});
it("does not let an old poll reopen a completed ritual", async () => {
  const initial = state();
  initial.current!.definition.steps[0]!.optional = true;
  mocks.read.mockResolvedValue(initial);
  mocks.action.mockResolvedValue({
    outcome: "applied",
    state: { ...initial, current: { ...initial.current!, status: "completed", revision: 2 } },
  });
  const { client } = setup();
  await openRitual();
  let resolve: (value: RitualState) => void = () => {};
  mocks.read.mockImplementationOnce(
    () =>
      new Promise<RitualState>((done) => {
        resolve = done;
      }),
  );
  const pending = client.refetchQueries({ queryKey: ["ritual-current", "owner"] });
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  await act(async () => {
    resolve(initial);
    await pending;
  });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Open morning ritual" })).not.toBeInTheDocument();
});
it("does not restore private state after an account change while a write is pending", async () => {
  const initial = state();
  initial.current!.definition.steps[0]!.optional = true;
  mocks.read.mockResolvedValueOnce(initial).mockResolvedValue({ ...initial, current: null });
  let resolve: (value: { outcome: string; state: RitualState }) => void = () => {};
  mocks.action.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const { client, rerender } = setup();
  await openRitual();
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  await waitFor(() => expect(mocks.action).toHaveBeenCalledOnce());
  rerender(
    <QueryClientProvider client={client}>
      <BrowserRitual key="other" userId="other" />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(2));
  await act(async () => {
    resolve({ outcome: "applied", state: initial });
  });
  expect(screen.queryByText("Good morning")).not.toBeInTheDocument();
  expect(screen.queryByText("Your morning ritual is ready")).not.toBeInTheDocument();
  expect(client.getQueryData(["ritual-current", "owner"])).toBeUndefined();
});
it("clears private answers when a mutation receives an authoritative access denial", async () => {
  const initial = state();
  mocks.read.mockResolvedValue(initial);
  mocks.response.mockRejectedValue(
    new ApiClientError({ status: 401, code: "unauthorized", message: "Sign in again." }),
  );
  setup();
  await openRitual();
  fireEvent.click(screen.getByRole("checkbox", { name: "Drink water" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(screen.queryByText("Good morning")).not.toBeInTheDocument();
});
it("presents the evening ritual by its product name without a target line when none is set", async () => {
  const initial = state();
  const { targetTime: _target, ...definition } = initial.current!.definition;
  mocks.read.mockResolvedValue({
    ...initial,
    current: { ...initial.current!, definition: { ...definition, kind: "night" } },
  });
  mocks.brief.mockResolvedValue({
    ...brief(),
    laterToday: [],
    allDay: [{ id: "trip", title: "Trip", allDay: true, startsAt: new Date().toISOString() }],
    tasks: [],
  });
  setup();
  fireEvent.click(await screen.findByRole("button", { name: "Open evening ritual" }));
  expect(await screen.findByRole("dialog", { name: "Evening ritual" })).toBeInTheDocument();
  expect(screen.queryByText(/(until|past|Right at) 9:00 AM/)).not.toBeInTheDocument();
  expect(screen.getByText("All day")).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Breathe" })).not.toBeInTheDocument();
  expect(screen.getByText("Today")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Minimize" }));
  expect(await screen.findByText("1 task due · 0 of 1 steps done")).toBeInTheDocument();
  expect(screen.queryByText(/Next:/)).not.toBeInTheDocument();
});
