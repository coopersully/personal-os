// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { beforeEach, expect, it, vi } from "vitest";
import { type PetData, PetOverlay } from "./pet-overlay.js";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock("../../api.js", () => ({ api: { getMe: vi.fn().mockResolvedValue({ theme: "dark" }) } }));
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
beforeEach(() => {
  vi.clearAllMocks();
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
it("drags the card surface, excludes controls, and exposes pin and keyboard resize", async () => {
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
  fireEvent.keyDown(screen.getByRole("button", { name: "Resize pet card" }), { key: "ArrowRight" });
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith("pet_action", {
      value: { action: "resize", dw: 20, dh: 0 },
    }),
  );
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
  fireEvent.keyDown(screen.getByRole("button", { name: "Resize pet card" }), { key: "ArrowRight" });
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
  expect(screen.getByText(/America\/New_York/)).toBeInTheDocument();
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
