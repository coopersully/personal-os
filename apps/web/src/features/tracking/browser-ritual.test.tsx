// @vitest-environment jsdom
import { ApiClientError } from "@personal-os/api-client";
import type { RitualState } from "@personal-os/domain";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { createAppQueryClient } from "../../lib/query-client.js";
import { BrowserRitual } from "./browser-ritual.js";

const mocks = vi.hoisted(() => ({ read: vi.fn(), response: vi.fn(), action: vi.fn() }));
vi.mock("../../api.js", () => ({
  api: {
    getMe: async () => ({ displayName: "Alex Morgan" }),
    getCurrentRitual: mocks.read,
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
      scheduledLocalDate: "2026-10-20",
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
it("covers the current page and requires ritual actions instead of Escape or an outside click", async () => {
  mocks.read.mockResolvedValue(state());
  setup();
  const dialog = await screen.findByRole("dialog", { name: "Morning ritual" });
  expect(screen.getByRole("checkbox", { name: "Drink water" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "3-day morning streak" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
  const shortcut = vi.fn();
  window.addEventListener("keydown", shortcut);
  fireEvent.keyDown(dialog, { key: "k", ctrlKey: true });
  expect(shortcut).not.toHaveBeenCalled();
  window.removeEventListener("keydown", shortcut);
  fireEvent.keyDown(dialog, { key: "Escape" });
  fireEvent.pointerDown(document.body);
  expect(dialog).toBeInTheDocument();
  expect(screen.getByLabelText("Existing draft")).toHaveValue("Keep this draft");
});
it("saves real answers, completes the same occurrence, and restores the underlying page", async () => {
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
  const draft = screen.getByLabelText("Existing draft");
  draft.focus();
  await screen.findByRole("dialog");
  fireEvent.click(screen.getByRole("checkbox", { name: "Drink water" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Done" })).toBeEnabled());
  expect(mocks.response).toHaveBeenCalledWith(
    "today",
    "water",
    expect.objectContaining({ expectedRevision: 1, value: true, submitted: true }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  await waitFor(() => expect(draft).toHaveFocus());
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
it("does not present before due, after expiry, or while snoozed", async () => {
  const initial = state();
  mocks.read.mockResolvedValue({
    ...initial,
    current: { ...initial.current!, snoozedUntil: new Date(Date.now() + 600000).toISOString() },
  });
  const { client } = setup();
  await waitFor(() => expect(mocks.read).toHaveBeenCalledOnce());
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  mocks.read.mockResolvedValue({
    ...initial,
    current: { ...initial.current!, status: "completed" },
  });
  await act(async () => {
    await client.refetchQueries({ queryKey: ["ritual-current", "owner"] });
  });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("snoozes and returns when the server's snooze time elapses", async () => {
  vi.useFakeTimers();
  let current = state();
  mocks.read.mockImplementation(async () => ({ ...current, serverNow: new Date().toISOString() }));
  mocks.action.mockImplementation(async () => {
    current = {
      ...current,
      current: {
        ...current.current!,
        revision: 2,
        snoozedUntil: new Date(Date.now() + 600000).toISOString(),
      },
    };
    return { outcome: "applied", state: current };
  });
  setup();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(50);
  });
  fireEvent.click(screen.getByRole("button", { name: "Snooze" }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(50);
  });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600000);
  });
  expect(screen.getByRole("dialog", { name: "Morning ritual" })).toBeInTheDocument();
});
it.each([401, 403])("clears private material on read denial %s", async (status) => {
  const initial = state();
  mocks.read.mockResolvedValue(initial);
  const { client } = setup();
  await screen.findByRole("checkbox", { name: "Drink water" });
  mocks.read.mockRejectedValue(
    new ApiClientError({ status, code: "unauthorized", message: "Sign in again." }),
  );
  await act(async () => {
    await client.refetchQueries({ queryKey: ["ritual-current", "owner"] });
  });
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(screen.queryByText("Good morning")).not.toBeInTheDocument();
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
  await screen.findByRole("dialog");
  mocks.read.mockResolvedValue({
    ...initial,
    current: { ...initial.current!, status: "completed" },
  });
  fireEvent.focus(window);
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
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
  await screen.findByRole("dialog", { name: "Morning ritual" });
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
  await screen.findByRole("dialog");
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
  await screen.findByRole("dialog");
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
  expect(client.getQueryData(["ritual-current", "owner"])).toBeUndefined();
});
it("clears private answers when a mutation receives an authoritative access denial", async () => {
  const initial = state();
  mocks.read.mockResolvedValue(initial);
  mocks.response.mockRejectedValue(
    new ApiClientError({ status: 401, code: "unauthorized", message: "Sign in again." }),
  );
  setup();
  await screen.findByRole("dialog");
  fireEvent.click(screen.getByRole("checkbox", { name: "Drink water" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(screen.queryByText("Good morning")).not.toBeInTheDocument();
});
