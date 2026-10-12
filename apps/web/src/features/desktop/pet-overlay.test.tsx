// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "../../api.js";
import { type PetData, PetOverlay } from "./pet-overlay.js";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock("../../api.js", () => ({
  api: {
    getMe: vi.fn().mockResolvedValue({ theme: "dark" }),
    listCalendars: vi.fn().mockResolvedValue([]),
  },
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), dismiss: vi.fn() }, Toaster: () => null }));
const fixture: PetData = {
  workspaces: ["tasks"],
  snapshot: {
    serverUrl: "https://example.test",
    accountId: "account-a",
    generatedAt: "2026-10-07T12:00:00Z",
    stale: false,
    timeZone: "UTC",
    tasks: [{ id: "task-a", title: "Review the draft" }],
    reminders: [],
    events: [],
  },
};
afterEach(() => vi.useRealTimers());
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listCalendars).mockResolvedValue([]);
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
  vi.mocked(invoke).mockImplementation(async (command) =>
    command === "pet_snapshot" ? fixture : undefined,
  );
});
function mount(client?: QueryClient) {
  return render(
    <QueryClientProvider
      client={
        client ??
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      <PetOverlay />
    </QueryClientProvider>,
  );
}
it("renders app cards, preserves account context for completion and closes with Escape", async () => {
  mount();
  fireEvent.click(await screen.findByRole("checkbox", { name: "Complete Review the draft" }));
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith("pet_action", {
      value: {
        action: "complete",
        kind: "task",
        id: "task-a",
        serverUrl: "https://example.test",
        accountId: "account-a",
      },
    }),
  );
  await waitFor(() => expect(screen.queryByRole("checkbox")).not.toBeInTheDocument());
  expect(document.documentElement).toHaveClass("dark");
  fireEvent.keyDown(window, { key: "Escape" });
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith("pet_action", { value: { action: "close" } }),
  );
});
it("reports completion failures through Sonner and keeps the item available", async () => {
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "pet_snapshot") return fixture;
    if ((args as { value: { action: string } }).value.action === "complete")
      throw new Error("offline");
  });
  mount();
  fireEvent.click(await screen.findByRole("checkbox", { name: "Complete Review the draft" }));
  await waitFor(() => expect(toast.error).toHaveBeenCalled());
  expect(screen.getByRole("checkbox", { name: "Complete Review the draft" })).toBeInTheDocument();
  expect(screen.queryByText("offline")).not.toBeInTheDocument();
});
it("reports snapshot failures through Sonner without claiming the user is signed out", async () => {
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === "pet_snapshot") throw new Error("offline");
  });
  mount();
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      "Couldn’t load quick access. It will retry automatically.",
      expect.anything(),
    ),
  );
  expect(screen.queryByText("Sign in to see your day")).not.toBeInTheDocument();
});
it("reports overlay presentation failures through Sonner", async () => {
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "pet_snapshot") return fixture;
    if ((args as { value: { action: string } }).value.action === "ready")
      throw new Error("unavailable");
  });
  mount();
  await waitFor(() => expect(toast.error).toHaveBeenCalled());
});
it("offers pointer dragging and keyboard movement without invoking navigation", async () => {
  mount();
  const handle = await screen.findByRole("button", { name: "Move pet card" });
  fireEvent(handle, new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith("pet_action", { value: { action: "drag" } }),
  );
  fireEvent.keyDown(handle, { key: "ArrowRight" });
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith("pet_action", { value: { action: "move", dx: 20, dy: 0 } }),
  );
  expect(invoke).not.toHaveBeenCalledWith("pet_action", {
    value: { action: "open", path: "/today" },
  });
});
it("reports failed card dragging through Sonner", async () => {
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "pet_snapshot") return fixture;
    if ((args as { value: { action: string } }).value.action === "drag")
      throw new Error("Could not move the pet card.");
  });
  mount();
  fireEvent(
    await screen.findByRole("button", { name: "Move pet card" }),
    new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
  );
  await waitFor(() => expect(toast.error).toHaveBeenCalled());
});
it("drags the card surface, excludes controls, and exposes pin and a keyboard resize handle", async () => {
  mount();
  const body = await screen.findByRole("dialog", { name: "Pet quick access" });
  fireEvent(body, new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith("pet_action", { value: { action: "drag" } }),
  );
  vi.mocked(invoke).mockClear();
  fireEvent(
    screen.getByRole("checkbox", { name: "Complete Review the draft" }),
    new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
  );
  expect(invoke).not.toHaveBeenCalledWith("pet_action", { value: { action: "drag" } });
  fireEvent.click(screen.getByRole("button", { name: "Pin quick access" }));
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith("pet_action", { value: { action: "pin", pinned: true } }),
  );
  expect(screen.getByRole("button", { name: "Resize pet card" })).toHaveClass("pet-resize--se");
  expect(screen.getByRole("button", { name: "Next section" })).toBeInTheDocument();
});

it("shows today's shared timeline before tasks, including an ongoing overnight event", async () => {
  const today = new Date();
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const later = new Date(today.getTime() + 60 * 60 * 1000);
  const populated = {
    ...fixture,
    workspaces: ["calendar", "tasks"],
    snapshot: {
      ...fixture.snapshot!,
      events: [
        {
          id: "overnight",
          title: "Overnight coverage",
          startsAt: yesterday.toISOString(),
          endsAt: later.toISOString(),
          allDay: false,
        },
      ],
    },
  };
  vi.mocked(invoke).mockImplementation(async (command) =>
    command === "pet_snapshot" ? populated : undefined,
  );
  mount();
  const event = await screen.findByText("Overnight coverage");
  const task = screen.getByText("Review the draft");
  expect(event.closest(".today-timeline")).not.toBeNull();
  expect(event.compareDocumentPosition(task) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
it("reports pin and resize failures through Sonner", async () => {
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "pet_snapshot") return fixture;
    if (["pin", "resize"].includes((args as { value: { action: string } }).value.action))
      throw new Error("unavailable");
  });
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Pin quick access" }));
  await waitFor(() => expect(toast.error).toHaveBeenCalled());
  expect(screen.getByRole("button", { name: "Pin quick access" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  vi.mocked(toast.error).mockClear();
  const edge = document.querySelector(".pet-resize--se");
  if (!edge) throw new Error("Missing resize corner");
  fireEvent(edge, new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
  await waitFor(() => expect(toast.error).toHaveBeenCalled());
});

it("uses compact icon actions without refresh, close, or descriptive header copy", async () => {
  mount();
  await screen.findByRole("checkbox", { name: "Complete Review the draft" });
  expect(screen.queryByRole("button", { name: "Refresh quick access" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Close quick access" })).not.toBeInTheDocument();
  expect(screen.queryByText("Your day at a glance")).not.toBeInTheDocument();
  const open = screen.getByRole("button", { name: "Open nohmi" });
  expect(open.textContent).toBe("");
  expect(open.querySelector("img")).toHaveAttribute("src", "/icon.svg");
  expect(open.closest('[data-slot="card"]')).toBeNull();
  expect(screen.queryByText("Quick actions")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Add task" })).not.toBeInTheDocument();
  fireEvent.click(open);
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith("pet_action", {
      value: { action: "open", path: "/today" },
    }),
  );
});

it("refreshes once a minute while open and stops after unmount", async () => {
  vi.useFakeTimers();
  const view = mount();
  try {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    vi.mocked(invoke).mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(59_999);
    });
    expect(invoke).not.toHaveBeenCalledWith("pet_action", { value: { action: "refresh" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(invoke).toHaveBeenCalledWith("pet_action", { value: { action: "refresh" } });
    view.unmount();
    vi.mocked(invoke).mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(invoke).not.toHaveBeenCalledWith("pet_action", { value: { action: "refresh" } });
  } finally {
    view.unmount();
    vi.useRealTimers();
  }
});

it("renders scoped content, undated grouping and honest finance qualifications", async () => {
  vi.mocked(invoke).mockImplementation(async (command) =>
    command === "pet_snapshot"
      ? {
          ...fixture,
          workspaces: ["tasks", "finances"],
          content: {
            tasks: {
              items: [{ id: "later", title: "Plan a trip", group: "undated" }],
              partial: true,
              range: { label: "All upcoming", timeZone: "America/New_York" },
            },
            finances: {
              range: { label: "Last 30 days" },
              facts: [
                {
                  currency: "USD",
                  cents: 12345,
                  quality: "qualified",
                  reasons: ["stale_evidence"],
                },
              ],
            },
          },
        }
      : undefined,
  );
  mount();
  expect(await screen.findByText("Plan a trip")).toBeInTheDocument();
  expect(screen.queryByText("Review the draft")).not.toBeInTheDocument();
  expect(screen.getByText("Undated")).toBeInTheDocument();
  expect(screen.getByText(/Showing a limited result/)).toBeInTheDocument();
  expect(screen.queryByText(/America\/New_York/)).not.toBeInTheDocument();
  expect(screen.getByText(/Last 30 days/)).toBeInTheDocument();
  expect(screen.getByText(/Qualified total/)).toBeInTheDocument();
});

it("shows due rituals first and opens the canonical occurrence without unpinning", async () => {
  vi.mocked(invoke).mockImplementation(async (command) =>
    command === "pet_snapshot"
      ? {
          ...fixture,
          presentation: { pinned: true, visible: true },
          content: {
            rituals: [
              {
                id: "morning-1",
                kind: "morning",
                status: "Ready",
                logicalDate: "2026-10-11",
                urgent: true,
                canOpen: true,
                stale: false,
                syncStatus: "saved",
              },
              {
                id: "night-1",
                kind: "night",
                status: "Completed",
                logicalDate: "2026-10-10",
                urgent: false,
                canOpen: false,
                stale: false,
                syncStatus: "saved",
              },
            ],
          },
        }
      : undefined,
  );
  mount();
  const open = await screen.findByRole("button", { name: "Open morning ritual" });
  expect(screen.getByText("Completed")).toBeInTheDocument();
  fireEvent.click(open);
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith("pet_action", {
      value: {
        action: "ritual",
        occurrenceId: "morning-1",
        serverUrl: "https://example.test",
        accountId: "account-a",
      },
    }),
  );
  expect(invoke).not.toHaveBeenCalledWith("pet_action", {
    value: { action: "pin", pinned: false },
  });
});

it("ignores older presentation snapshots after a newer native pin event", async () => {
  let revision = 1;
  vi.mocked(invoke).mockImplementation(async (command) =>
    command === "pet_snapshot"
      ? { ...fixture, presentation: { pinned: false, visible: true, revision: revision++ } }
      : undefined,
  );
  mount();
  await screen.findByRole("button", { name: "Pin quick access" });
  const handler = vi.mocked(listen).mock.calls.find(([name]) => name === "pet-presentation")?.[1];
  if (!handler) throw new Error("Presentation listener missing");
  await act(async () =>
    handler({
      event: "pet-presentation",
      id: 0,
      payload: { pinned: true, visible: true, revision: 100 },
    }),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Unpin quick access" })).toHaveAttribute(
      "aria-pressed",
      "true",
    ),
  );
});

it("disables cached actions and marks ritual status stale after a refresh failure", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let failed = false;
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command !== "pet_snapshot") return;
    if (failed) throw new Error("offline");
    return {
      ...fixture,
      content: {
        rituals: [
          {
            id: "r",
            kind: "morning",
            logicalDate: "2026-10-11",
            status: "Ready",
            urgent: true,
            canOpen: true,
            stale: false,
            syncStatus: "saved",
          },
        ],
      },
    };
  });
  mount(client);
  expect(await screen.findByRole("checkbox")).toBeEnabled();
  expect(await screen.findByRole("button", { name: "Open morning ritual" })).toBeEnabled();
  failed = true;
  await act(async () => {
    await client.refetchQueries({ queryKey: ["pet-snapshot"] });
  });
  await waitFor(() => expect(screen.getByRole("checkbox")).toBeDisabled());
  expect(screen.getByRole("button", { name: "Open morning ritual" })).toBeDisabled();
  expect(screen.getByText("Status needs refreshing")).toBeInTheDocument();
  expect(screen.queryByText("Ready")).not.toBeInTheDocument();
  expect(toast.error).toHaveBeenCalled();
  expect(screen.queryByText("offline")).not.toBeInTheDocument();
});
it("delivers content refresh errors through Sonner without showing empty date windows", async () => {
  vi.mocked(invoke).mockImplementation(async (command) =>
    command === "pet_snapshot"
      ? {
          ...fixture,
          content: { unavailable: true },
          contentError: "Couldn’t refresh quick-access content.",
          snapshot: { ...fixture.snapshot, stale: true },
        }
      : undefined,
  );
  mount();
  await waitFor(() => expect(toast.error).toHaveBeenCalled());
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(screen.queryByText("Nothing in this date window.")).not.toBeInTheDocument();
  expect(screen.queryByText("Couldn’t refresh quick-access content.")).not.toBeInTheDocument();
});

it.each([
  "tasks",
  "reminders",
  "finances",
  "rituals",
] as const)("isolates a %s failure while keeping other pet content usable", async (failed) => {
  vi.mocked(invoke).mockImplementation(async (command) =>
    command === "pet_snapshot"
      ? {
          ...fixture,
          workspaces: ["tasks", "reminders", "finances"],
          snapshot: {
            ...fixture.snapshot,
            reminders: [{ id: "reminder", title: "Take a break" }],
            financeSummary: "Old summary",
          },
          content: { errors: { [failed]: true } },
        }
      : undefined,
  );
  mount();
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      `Couldn’t refresh pet ${failed}. They will retry automatically.`,
      expect.anything(),
    ),
  );
  expect(screen.queryByText(/Couldn’t refresh pet/)).not.toBeInTheDocument();
  if (failed === "tasks")
    expect(
      screen.queryByRole("checkbox", { name: "Complete Review the draft" }),
    ).not.toBeInTheDocument();
  else expect(screen.getByRole("checkbox", { name: "Complete Review the draft" })).toBeEnabled();
  if (failed === "reminders")
    expect(
      screen.queryByRole("checkbox", { name: "Complete Take a break" }),
    ).not.toBeInTheDocument();
  else expect(screen.getByRole("checkbox", { name: "Complete Take a break" })).toBeEnabled();
  if (failed === "finances") expect(screen.queryByText("Old summary")).not.toBeInTheDocument();
});

it("routes scoped task and reminder links and preserves grouping", async () => {
  const range = { label: "This week", timeZone: "UTC" };
  vi.mocked(invoke).mockImplementation(async (command) =>
    command === "pet_snapshot"
      ? {
          ...fixture,
          workspaces: ["tasks", "reminders"],
          content: {
            tasks: {
              range,
              partial: true,
              items: [
                { id: "a", title: "Late task", group: "overdue" },
                { id: "b", title: "Soon task", group: "upcoming" },
                { id: "c", title: "Another task", group: "upcoming" },
              ],
            },
            reminders: {
              range,
              partial: true,
              items: [{ id: "r", title: "Call back", group: "upcoming" }],
            },
          },
        }
      : undefined,
  );
  mount();
  const task = await screen.findByText("Late task");
  expect(task.closest('[data-slot="task-item"]')).not.toBeNull();
  expect(screen.getByText("Call back").closest('[data-slot="reminder-item"]')).not.toBeNull();
  expect(screen.getAllByText("Overdue")).toHaveLength(1);
  expect(screen.getAllByText("Upcoming")).toHaveLength(2);
  for (const [name, path] of [
    ["Open Late task", "/tasks"],
    ["Open Call back", "/reminders"],
    ["View all tasks", "/tasks"],
    ["View all reminders", "/reminders"],
  ] as const) {
    fireEvent.click(screen.getByRole("button", { name }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("pet_action", { value: { action: "open", path } }),
    );
  }
});

it.each([
  { cents: 12345, quality: "verified", reasons: [], expected: "$123.45" },
  {
    cents: null,
    quality: "unavailable",
    reasons: ["incomplete_evidence"],
    expected: "Spending unavailable",
  },
  {
    cents: 100,
    quality: "unavailable",
    reasons: ["stale_evidence"],
    expected: "Spending unavailable",
  },
])("shows $quality finance evidence ($cents) without inventing totals", async ({
  cents,
  quality,
  reasons,
  expected,
}) => {
  vi.mocked(invoke).mockImplementation(async (command) =>
    command === "pet_snapshot"
      ? {
          ...fixture,
          workspaces: ["finances"],
          content: {
            finances: {
              range: { label: "Today", timeZone: "UTC" },
              facts: [{ currency: "USD", cents, quality, reasons }],
            },
          },
        }
      : undefined,
  );
  mount();
  expect(await screen.findByText(expected)).toBeInTheDocument();
  expect(screen.queryByText("Qualified total")).not.toBeInTheDocument();
  for (const reason of reasons)
    expect(screen.getByText(new RegExp(reason.replaceAll("_", " ")))).toBeInTheDocument();
});

it("shows sign-in state for an empty native session", async () => {
  vi.mocked(invoke).mockImplementation(async (command) =>
    command === "pet_snapshot" ? { workspaces: [], snapshot: null } : undefined,
  );
  mount();
  expect(await screen.findByText("Sign in to see your day")).toBeInTheDocument();
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
});

it("pauses refresh while hidden and ignores stale presentation events", async () => {
  vi.useFakeTimers();
  const view = mount();
  try {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const handler = vi.mocked(listen).mock.calls.find(([name]) => name === "pet-presentation")?.[1];
    if (!handler) throw new Error("Missing presentation listener");
    await act(async () =>
      handler({
        event: "pet-presentation",
        id: 0,
        payload: { visible: false, pinned: true, revision: 10 },
      }),
    );
    await act(async () =>
      handler({
        event: "pet-presentation",
        id: 0,
        payload: { visible: true, pinned: false, revision: 9 },
      }),
    );
    vi.mocked(invoke).mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Unpin quick access" })).toBeInTheDocument();
    view.unmount();
    await act(async () =>
      handler({
        event: "pet-presentation",
        id: 0,
        payload: { visible: true, pinned: false, revision: 11 },
      }),
    );
    expect(invoke).not.toHaveBeenCalled();
  } finally {
    view.unmount();
    vi.useRealTimers();
  }
});

it("ignores secondary drag buttons and supports pointer and keyboard resize without dragging", async () => {
  mount();
  const move = await screen.findByRole("button", { name: "Move pet card" });
  const resize = document.querySelector(".pet-resize--se");
  if (!resize) throw new Error("Missing resize corner");
  vi.mocked(invoke).mockClear();
  fireEvent(move, new MouseEvent("pointerdown", { bubbles: true, button: 2 }));
  fireEvent.keyDown(move, { key: "a" });
  expect(invoke).not.toHaveBeenCalled();
  fireEvent.keyDown(resize, { key: "ArrowRight" });
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith("pet_action", {
      value: { action: "resize", dw: 20, dh: 0 },
    }),
  );
  fireEvent(resize, new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith("pet_action", { value: { action: "resize", edge: "se" } }),
  );
  expect(invoke).not.toHaveBeenCalledWith("pet_action", { value: { action: "drag" } });
});

it("offers calendar navigation and HTTPS conference joins only for today's future events", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-11T12:00:00Z"));
  const now = new Date();
  const later = new Date(now.getTime() + 60_000).toISOString();
  const end = new Date(now.getTime() + 120_000).toISOString();
  vi.mocked(invoke).mockImplementation(async (command) =>
    command === "pet_snapshot"
      ? {
          ...fixture,
          workspaces: ["calendar"],
          snapshot: {
            ...fixture.snapshot,
            events: [
              {
                id: "day",
                title: "Holiday",
                startsAt: now.toISOString(),
                endsAt: end,
                allDay: true,
              },
              {
                id: "meeting",
                title: "Meeting",
                startsAt: later,
                endsAt: end,
                allDay: false,
                conferenceUrl: "https://meet.example.test/room",
              },
              {
                id: "unsafe",
                title: "Unsafe meeting",
                startsAt: later,
                endsAt: end,
                allDay: false,
                conferenceUrl: "http://meet.example.test/room",
              },
              {
                id: "tomorrow",
                title: "Tomorrow",
                startsAt: new Date(now.getTime() + 86_400_000).toISOString(),
                endsAt: new Date(now.getTime() + 87_000_000).toISOString(),
                allDay: false,
              },
            ],
          },
        }
      : undefined,
  );
  mount();
  fireEvent.click(await screen.findByRole("button", { name: /All day Holiday/ }));
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith("pet_action", {
      value: { action: "open", path: "/calendar" },
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Join Meeting" }));
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith("pet_action", {
      value: {
        action: "join",
        url: "https://meet.example.test/room",
        serverUrl: "https://example.test",
        accountId: "account-a",
      },
    }),
  );
  expect(screen.queryByRole("button", { name: "Join Unsafe meeting" })).not.toBeInTheDocument();
  expect(screen.queryByText("Tomorrow")).not.toBeInTheDocument();
  fireEvent.click(screen.getByText("Meeting"));
});

it("offers all-day navigation without an empty timed timeline", async () => {
  vi.mocked(invoke).mockImplementation(async (command) =>
    command === "pet_snapshot"
      ? {
          ...fixture,
          workspaces: ["calendar"],
          snapshot: { ...fixture.snapshot, events: [] },
        }
      : undefined,
  );
  mount();
  expect(await screen.findByText("No upcoming events today.")).toBeInTheDocument();
});

it("resizes from a card edge only on primary pointer input", async () => {
  const view = mount();
  await screen.findByRole("checkbox");
  const edge = view.container.querySelector(".pet-resize--nw");
  if (!edge) throw new Error("Missing northwest resize edge");
  vi.mocked(invoke).mockClear();
  fireEvent(edge, new MouseEvent("pointerdown", { bubbles: true, button: 2 }));
  expect(invoke).not.toHaveBeenCalled();
  fireEvent(edge, new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith("pet_action", { value: { action: "resize", edge: "nw" } }),
  );
  expect(invoke).not.toHaveBeenCalledWith("pet_action", { value: { action: "drag" } });
});

it("keeps task and reminder ranges inline without timezone descriptions", async () => {
  vi.mocked(invoke).mockImplementation(async (command) =>
    command === "pet_snapshot"
      ? {
          ...fixture,
          workspaces: ["tasks", "reminders"],
          content: {
            tasks: {
              items: [],
              partial: false,
              range: { label: "Today", timeZone: "America/New_York" },
            },
            reminders: {
              items: [],
              partial: false,
              range: { label: "This week", timeZone: "America/New_York" },
            },
          },
        }
      : undefined,
  );
  mount();
  expect(await screen.findByRole("heading", { name: "Tasks due today" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Reminders due this week" })).toBeInTheDocument();
  expect(screen.queryByText(/America\/New_York/)).not.toBeInTheDocument();
});

it("uses calendar colors for shared timed and all-day cards in one scroll area", async () => {
  vi.mocked(api.listCalendars).mockResolvedValue([{ id: "work", color: "#4285f4" }] as Awaited<
    ReturnType<typeof api.listCalendars>
  >);
  const now = new Date();
  const event = {
    calendarId: "work",
    startsAt: now.toISOString(),
    endsAt: new Date(now.getTime() + 3_600_000).toISOString(),
  };
  vi.mocked(invoke).mockImplementation(async (command) =>
    command === "pet_snapshot"
      ? {
          ...fixture,
          workspaces: ["calendar"],
          snapshot: {
            ...fixture.snapshot,
            events: [
              { ...event, id: "timed", title: "Team sync", allDay: false },
              { ...event, id: "day", title: "Planning day", allDay: true },
            ],
          },
        }
      : undefined,
  );
  const { container } = mount();
  const timed = (await screen.findByText("Team sync")).closest('[data-slot="event-card"]');
  await waitFor(() => expect(timed).toHaveStyle({ "--calendar-color": "#4285f4" }));
  expect(timed).toHaveAttribute("data-tone", "calendar");
  expect(screen.getByRole("button", { name: /All day Planning day/ })).toHaveStyle({
    "--occasion-color": "#4285f4",
  });
  expect(
    screen.getByRole("button", { name: /All day Planning day/ }).closest("li"),
  ).toBeInTheDocument();
  expect(container.querySelectorAll('[data-slot="scroll-area-viewport"]')).toHaveLength(1);
  expect(container.querySelector(".today-timeline")?.parentElement).not.toHaveClass(
    "overflow-y-auto",
    "max-h-72",
  );
  const pin = screen.getByRole("button", { name: "Pin quick access" });
  expect(pin).toHaveAttribute("data-variant", "ghost");
  fireEvent.click(pin);
  await waitFor(() => expect(pin).toHaveAttribute("aria-pressed", "true"));
  expect(pin).toHaveAttribute("data-variant", "secondary");
  expect(pin.querySelector('path[fill="currentColor"]')).not.toBeNull();
});

it("dismisses calendar color errors when the calendar workspace is removed", async () => {
  vi.mocked(api.listCalendars).mockRejectedValue(new Error("offline"));
  vi.mocked(invoke).mockImplementation(async (command) =>
    command === "pet_snapshot" ? { ...fixture, workspaces: ["calendar", "tasks"] } : undefined,
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mount(client);
  const message = "Couldn’t refresh calendar colors. Try reopening quick access.";
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message, expect.anything()));
  const call = vi.mocked(toast.error).mock.calls.find(([text]) => text === message);
  expect(screen.queryByText(message)).not.toBeInTheDocument();
  vi.mocked(toast.dismiss).mockClear();
  act(() => client.setQueryData(["pet-snapshot"], fixture));
  await waitFor(() => expect(toast.dismiss).toHaveBeenCalledWith(call?.[1]?.id));
  expect(api.listCalendars).toHaveBeenCalledTimes(1);
});

it("keeps provider all-day dates on their calendar day through late evening", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-07-15T03:00:00Z"));
  vi.mocked(invoke).mockImplementation(async (command) =>
    command === "pet_snapshot"
      ? {
          ...fixture,
          workspaces: ["calendar"],
          snapshot: {
            ...fixture.snapshot,
            timeZone: "America/New_York",
            events: [
              {
                id: "all-day",
                title: "Planning day",
                provider: "google",
                allDay: true,
                startsAt: "2026-07-14T00:00:00Z",
                endsAt: "2026-07-15T00:00:00Z",
              },
              {
                id: "tomorrow",
                title: "Tomorrow's event",
                provider: "google",
                allDay: true,
                startsAt: "2026-07-15T00:00:00Z",
                endsAt: "2026-07-16T00:00:00Z",
              },
            ],
          },
        }
      : undefined,
  );
  mount();
  const event = await screen.findByRole("button", { name: /All day Planning day/ });
  expect(event.querySelector("time")).toHaveAttribute("datetime", "2026-07-14");
  expect(screen.queryByText("Tomorrow's event")).not.toBeInTheDocument();
});

it("loads calendar colors again when the pet snapshot account changes", async () => {
  vi.mocked(api.listCalendars).mockRejectedValueOnce(new Error("old account offline"));
  vi.mocked(invoke).mockImplementation(async (command) =>
    command === "pet_snapshot" ? { ...fixture, workspaces: ["calendar"] } : undefined,
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mount(client);
  const message = "Couldn’t refresh calendar colors. Try reopening quick access.";
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message, expect.anything()));
  const errorCall = vi.mocked(toast.error).mock.calls.find(([text]) => text === message);
  act(() =>
    client.setQueryData(["pet-snapshot"], {
      ...fixture,
      workspaces: ["calendar"],
      snapshot: { ...fixture.snapshot, accountId: "account-b" },
    }),
  );
  await waitFor(() => expect(api.listCalendars).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(toast.dismiss).toHaveBeenCalledWith(errorCall?.[1]?.id));
  expect(screen.queryByText(message)).not.toBeInTheDocument();
});
