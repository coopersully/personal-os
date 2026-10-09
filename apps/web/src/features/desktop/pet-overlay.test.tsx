// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
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
function mount() {
  return render(
    <QueryClientProvider
      client={
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
