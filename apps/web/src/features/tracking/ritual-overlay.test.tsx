// @vitest-environment jsdom

import type { RitualState } from "@personal-os/domain";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import * as ritualBridge from "../desktop/ritual-bridge.js";
import { RitualChecklist, RitualOverlay } from "./ritual-overlay.js";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), loading: vi.fn(), success: vi.fn(), dismiss: vi.fn() },
  Toaster: () => null,
}));
beforeEach(() => vi.mocked(toast.error).mockClear());

const state = {
  current: {
    id: "occ",
    revision: 1,
    status: "pending",
    definition: {
      kind: "morning",
      title: "Good morning",
      steps: [
        { id: "teeth", label: "Brush teeth", kind: "checkbox" },
        { id: "journal", label: "Journal", kind: "short_text" },
      ],
    },
    responses: [],
  },
  syncStatus: "saved",
  snoozeCount: 2,
} as unknown as RitualState;
afterEach(cleanup);
it("autosaves text and shows counted snooze confirmation", async () => {
  const response = vi.fn().mockImplementation(async (stepId, input) => ({
    ...state,
    current: { ...state.current!, revision: 2, responses: [{ ...input, stepId }] },
  }));
  const action = vi.fn().mockResolvedValue({
    outcome: "confirmation_required",
    count: 2,
    challengeId: "challenge",
    state,
  });
  render(<RitualChecklist state={state} saveResponse={response} act={action} />);
  fireEvent.change(screen.getByRole("textbox", { name: "Journal" }), {
    target: { value: "Today" },
  });
  expect(response).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(response).toHaveBeenCalledWith(
      "journal",
      expect.objectContaining({ submitted: true, value: "Today" }),
    ),
  );
  await waitFor(() => expect(screen.getByRole("button", { name: "Snooze" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Snooze" }));
  expect(await screen.findByText(/2 times in the last 3 days/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Go back" }));
  await waitFor(() =>
    expect(action).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "cancel_snooze", challengeId: "challenge" }),
    ),
  );
});

it("confirms unavailable history explicitly and preserves the displayed local count", async () => {
  const action = vi
    .fn()
    .mockResolvedValueOnce({
      outcome: "confirmation_required",
      count: 1,
      challengeId: "offline",
      historyUnavailable: true,
      state,
    })
    .mockResolvedValueOnce({ outcome: "applied", state });
  render(
    <RitualChecklist
      state={{ ...state, syncStatus: "queued" }}
      saveResponse={vi.fn()}
      act={action}
    />,
  );
  expect(screen.getByText(/Saved on this Mac/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Snooze" }));
  expect(await screen.findByText(/history is unavailable/)).toHaveTextContent("1 snoozes");
  expect(screen.queryByRole("region", { name: "Ritual progress" })).not.toBeInTheDocument();
  expect(screen.queryByText(/Saved on this Mac/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Snooze 10 minutes" }));
  await waitFor(() =>
    expect(action).toHaveBeenLastCalledWith(
      expect.objectContaining({
        kind: "confirm_snooze",
        challengeId: "offline",
        displayedCount: 1,
        historyUnavailable: true,
      }),
    ),
  );
  await waitFor(() =>
    expect(screen.queryByRole("region", { name: "Confirm snooze" })).not.toBeInTheDocument(),
  );
});

it("keeps unsaved text after failure and enables explicit completion only after all answers save", async () => {
  let current = structuredClone(state);
  const response = vi
    .fn()
    .mockRejectedValueOnce(new Error("Save unavailable"))
    .mockImplementation(async (stepId, input) => {
      current = {
        ...current,
        current: {
          ...current.current!,
          revision: current.current!.revision + 1,
          responses: [...current.current!.responses, { ...input, stepId }],
        },
      };
      return current;
    });
  const action = vi.fn().mockImplementation(async () => ({
    outcome: "applied",
    state: { ...current, current: { ...current.current!, status: "completed", revision: 10 } },
  }));
  render(<RitualChecklist state={state} saveResponse={response} act={action} />);
  expect(screen.getByRole("button", { name: "0 of 2 tasks completed" })).toBeDisabled();
  fireEvent.change(screen.getByRole("textbox", { name: "Journal" }), {
    target: { value: "Keep this answer" },
  });
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("save your ritual answers"),
      expect.anything(),
    ),
  );
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Journal" })).toHaveValue("Keep this answer");
  fireEvent.change(screen.getByRole("textbox", { name: "Journal" }), {
    target: { value: "Keep this answer too" },
  });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "1 of 2 tasks completed" })).toBeDisabled(),
  );
  fireEvent.click(screen.getByRole("checkbox", { name: "Brush teeth" }));
  const complete = await screen.findByRole("button", { name: "Complete Morning Ritual" });
  expect(complete).toBeEnabled();
  expect(action).not.toHaveBeenCalled();
  fireEvent.click(complete);
  expect(await screen.findByRole("heading", { name: "All done." })).toBeInTheDocument();
  expect(action).toHaveBeenCalledWith(expect.objectContaining({ kind: "complete" }));
});

it("Escape cancels the pending confirmation and a rejected skip explains the conflict", async () => {
  const action = vi
    .fn()
    .mockResolvedValueOnce({
      outcome: "confirmation_required",
      count: 2,
      challengeId: "escape",
      state,
    })
    .mockResolvedValueOnce({ outcome: "applied", state })
    .mockResolvedValueOnce({ outcome: "conflict", state });
  render(<RitualChecklist state={state} saveResponse={vi.fn()} act={action} />);
  fireEvent.click(screen.getByRole("button", { name: "Snooze" }));
  await screen.findByRole("region", { name: "Confirm snooze" });
  fireEvent.keyDown(window, { key: "Escape" });
  await waitFor(() =>
    expect(screen.queryByRole("region", { name: "Confirm snooze" })).not.toBeInTheDocument(),
  );
  expect(action).toHaveBeenLastCalledWith(
    expect.objectContaining({ kind: "cancel_snooze", challengeId: "escape" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Skip for Today" }));
  expect(action).toHaveBeenCalledTimes(2);
  vi.useFakeTimers();
  fireEvent.keyDown(screen.getByRole("button", { name: "Hold to skip today" }), { key: " " });
  await act(async () => {
    vi.advanceTimersByTime(30000);
  });
  vi.useRealTimers();
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      "This ritual changed. Please try again.",
      expect.anything(),
    ),
  );
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("adopts a newer remote correction without resubmitting an already saved local answer", async () => {
  const saved = {
    ...state,
    current: {
      ...state.current!,
      revision: 2,
      responses: [{ stepId: "journal", value: "Local answer", submitted: true }],
    },
  } as RitualState;
  const response = vi.fn().mockResolvedValue(saved);
  const view = render(<RitualChecklist state={state} saveResponse={response} act={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Journal"), { target: { value: "Local answer" } });
  await waitFor(() => expect(screen.getByRole("button", { name: "Snooze" })).toBeEnabled());
  expect(response).toHaveBeenCalledTimes(1);
  const remote = {
    ...saved,
    current: {
      ...saved.current!,
      revision: 3,
      responses: [{ stepId: "journal", value: "Remote correction", submitted: true }],
    },
  } as RitualState;
  view.rerender(<RitualChecklist state={remote} saveResponse={response} act={vi.fn()} />);
  await waitFor(() => expect(screen.getByLabelText("Journal")).toHaveValue("Remote correction"));
  await new Promise((resolve) => setTimeout(resolve, 350));
  expect(response).toHaveBeenCalledTimes(1);
});

it("keeps newer typing while an older answer finishes saving", async () => {
  let finish: (value: RitualState) => void = () => {};
  const response = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<RitualState>((resolve) => {
          finish = resolve;
        }),
    )
    .mockImplementation(async (stepId, input) => ({
      ...state,
      current: { ...state.current!, revision: 3, responses: [{ ...input, stepId }] },
    }));
  render(<RitualChecklist state={state} saveResponse={response} act={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Journal"), { target: { value: "First" } });
  await waitFor(() => expect(response).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByLabelText("Journal"), { target: { value: "Second" } });
  finish({
    ...state,
    current: {
      ...state.current!,
      revision: 2,
      responses: [{ stepId: "journal", value: "First", submitted: true }],
    },
  } as RitualState);
  await waitFor(() => expect(response).toHaveBeenCalledTimes(2));
  expect(response).toHaveBeenLastCalledWith(
    "journal",
    expect.objectContaining({ value: "Second", expectedRevision: 2 }),
  );
  expect(screen.getByLabelText("Journal")).toHaveValue("Second");
});

it("does not retry a failed draft at the same revision, but resumes after a newer authoritative state", async () => {
  const response = vi.fn().mockRejectedValue(new Error("Revision conflict"));
  const view = render(<RitualChecklist state={state} saveResponse={response} act={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Journal"), { target: { value: "Unsaved answer" } });
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("save your ritual answers"),
      expect.anything(),
    ),
  );
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  view.rerender(
    <RitualChecklist state={structuredClone(state)} saveResponse={response} act={vi.fn()} />,
  );
  await new Promise((resolve) => setTimeout(resolve, 800));
  expect(response).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText("Journal")).toHaveValue("Unsaved answer");
  const refreshed = { ...state, current: { ...state.current!, revision: 2 } } as RitualState;
  response.mockImplementation(async (stepId, input) => ({
    ...refreshed,
    current: { ...refreshed.current!, revision: 3, responses: [{ ...input, stepId }] },
  }));
  view.rerender(<RitualChecklist state={refreshed} saveResponse={response} act={vi.fn()} />);
  await waitFor(() => expect(response).toHaveBeenCalledTimes(2));
  expect(response).toHaveBeenLastCalledWith(
    "journal",
    expect.objectContaining({ value: "Unsaved answer", expectedRevision: 2 }),
  );
  await waitFor(() => expect(screen.getByRole("button", { name: "Snooze" })).toBeEnabled());
});

it("retries readiness while preserving its visible error across successful state polling", async () => {
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { ready: Promise.resolve() },
  });
  const read = vi.spyOn(ritualBridge, "readRitualState").mockResolvedValue(state);
  let finish: () => void = () => {};
  const ready = vi
    .spyOn(ritualBridge, "ritualContentReady")
    .mockRejectedValueOnce(new Error("Unable to present ritual"))
    .mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
  const frame = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callback(0);
    return 1;
  });
  const view = render(<RitualOverlay />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Couldn’t prepare this ritual. Try again.",
  );
  expect(screen.getByRole("alert").closest("main")).toBeNull();
  await waitFor(() => expect(read.mock.calls.length).toBeGreaterThan(1), { timeout: 2000 });
  await waitFor(() => expect(ready).toHaveBeenCalledTimes(2), { timeout: 2000 });
  expect(screen.getByRole("alert")).toHaveTextContent("Couldn’t prepare this ritual. Try again.");
  finish();
  await waitFor(() => expect(screen.getByRole("main")).toHaveAttribute("data-ready", "true"));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  await new Promise((resolve) => setTimeout(resolve, 1100));
  expect(ready).toHaveBeenCalledTimes(2);
  view.unmount();
  read.mockRestore();
  ready.mockRestore();
  frame.mockRestore();
});

it("reports state-read failures as retryable without claiming an uncertain write", async () => {
  const read = vi
    .spyOn(ritualBridge, "readRitualState")
    .mockRejectedValueOnce(new Error("private state failure"))
    .mockResolvedValue({ ...state, current: null });
  const view = render(<RitualOverlay />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Couldn’t load this ritual. Try again.",
  );
  expect(screen.queryByText(/making the change twice/)).not.toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument(), {
    timeout: 2000,
  });
  expect(read).toHaveBeenCalledTimes(2);
  view.unmount();
  read.mockRestore();
});

it("completes optional steps without requiring answers and sends only an opted-in reminder time", async () => {
  const optionalState: RitualState = {
    ...state,
    current: {
      ...state.current!,
      scheduledLocalDate: "2026-10-17",
      timeZone: "UTC",
      definition: {
        ...state.current!.definition,
        timeZone: "UTC",
        reminderTime: "15:30",
        steps: [{ id: "journal", label: "Journal", kind: "short_text", optional: true }],
      },
    },
  };
  const action = vi.fn().mockResolvedValue({ outcome: "applied", state: optionalState });
  render(<RitualChecklist state={optionalState} saveResponse={vi.fn()} act={action} />);
  const finish = screen.getByRole("button", { name: "Complete Morning Ritual" });
  expect(finish).toBeEnabled();
  expect(screen.queryByLabelText("Reminder time")).not.toBeInTheDocument();
  fireEvent.click(finish);
  expect(action).not.toHaveBeenCalled();
  expect(screen.queryByRole("region", { name: "Ritual progress" })).not.toBeInTheDocument();
  expect(screen.queryByText("Saved to your account")).not.toBeInTheDocument();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByLabelText("Reminder time")).not.toBeInTheDocument();
  expect(action).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Complete Morning Ritual" }));
  expect(screen.getByLabelText("Reminder time")).toHaveValue("15:30");
  fireEvent.click(screen.getByRole("checkbox", { name: "Remind me about these later" }));
  fireEvent.change(screen.getByLabelText("Reminder time"), { target: { value: "16:45" } });
  fireEvent.click(screen.getByRole("button", { name: "Finish ritual" }));
  await waitFor(() =>
    expect(action).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "complete",
        optionalReminderAt: expect.stringMatching(/T16:45:00.000Z$/),
      }),
    ),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Complete Morning Ritual" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Complete Morning Ritual" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Remind me about these later" }));
  fireEvent.click(screen.getByRole("button", { name: "Finish ritual" }));
  await waitFor(() => expect(action).toHaveBeenCalledTimes(2));
  expect(action.mock.calls[1]![0]).not.toHaveProperty("optionalReminderAt");
});

it.each([
  "saved",
  "queued",
  "failure",
] as const)("uses one Sonner toast for optional reminder completion: %s", async (outcome) => {
  vi.mocked(toast.loading).mockClear();
  vi.mocked(toast.success).mockClear();
  const current = {
    ...state.current!,
    timeZone: "UTC",
    definition: {
      ...state.current!.definition,
      timeZone: "UTC",
      reminderTime: "12:00",
      steps: [{ id: "one", label: "Stretch", kind: "checkbox" as const, optional: true }],
    },
  };
  const initial = { ...state, current };
  const action =
    outcome === "failure"
      ? vi.fn().mockRejectedValue(new Error("unavailable"))
      : vi.fn().mockResolvedValue({
          outcome: "applied",
          state: {
            ...initial,
            syncStatus: outcome,
            current: {
              ...current,
              status: "completed",
              optionalFollowUp: {
                dueAt: "2026-10-18T12:00:00Z",
                stepIds: ["one"],
                ...(outcome === "saved" ? { reminderIds: ["reminder"] } : {}),
              },
            },
          },
        });
  render(<RitualChecklist state={initial} saveResponse={vi.fn()} act={action} />);
  fireEvent.click(screen.getByRole("button", { name: "Complete Morning Ritual" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Remind me about these later" }));
  fireEvent.click(screen.getByRole("button", { name: "Finish ritual" }));
  expect(toast.loading).toHaveBeenCalledWith("Finishing ritual…", expect.anything());
  const loadingId = vi.mocked(toast.loading).mock.calls[0]![1]!.id;
  if (outcome === "failure") {
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringContaining("save your ritual answers"),
        { id: loadingId },
      ),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Remind me about these later" })).toBeChecked();
  } else {
    const message =
      outcome === "saved"
        ? "Ritual complete. Reminders saved."
        : "Ritual saved on this Mac. Reminders are waiting to sync.";
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(message, { id: loadingId }));
    expect(screen.queryByText(message)).not.toBeInTheDocument();
  }
});

it("shows the current ritual streak and lets users back out of skipping", () => {
  const action = vi.fn();
  render(
    <RitualChecklist
      state={{ ...state, streakCount: 12, skipCount: 1 }}
      saveResponse={vi.fn()}
      act={action}
    />,
  );
  expect(screen.getByRole("button", { name: "12-day morning streak" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Skip for Today" }));
  expect(screen.getByText(/1 time in the last 3 days/)).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Ritual progress" })).not.toBeInTheDocument();
  expect(screen.queryByText("Saved to your account")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Go back" }));
  expect(screen.getByRole("checkbox", { name: "Brush teeth" })).toBeInTheDocument();
  expect(action).not.toHaveBeenCalled();
});

it("keeps the weekly completion strip alongside the streak and hides it in previews", () => {
  const progressState = {
    ...state,
    streakCount: 0,
    completionWeek: [
      { date: "2026-10-19", status: "completed" as const },
      { date: "2026-10-20", status: "pending" as const },
    ],
  };
  const view = render(
    <RitualChecklist state={progressState} saveResponse={vi.fn()} act={vi.fn()} />,
  );
  expect(screen.getByRole("button", { name: "0-day morning streak" })).toBeInTheDocument();
  expect(screen.queryByText("1 completed · Past 7 days")).not.toBeInTheDocument();
  const questions = screen.getByRole("region", { name: "Ritual questions" });
  expect(questions).toContainElement(screen.getByRole("checkbox", { name: "Brush teeth" }));
  expect(questions).not.toContainElement(
    screen.getByRole("button", { name: "0-day morning streak" }),
  );
  expect(questions).not.toContainElement(
    screen.getByRole("region", { name: "Past 7 ritual days" }),
  );
  expect(questions).not.toContainElement(screen.getByRole("region", { name: "Ritual actions" }));
  expect(view.container.querySelector("canvas")).toHaveAttribute("aria-hidden", "true");
  view.rerender(
    <RitualChecklist state={progressState} saveResponse={vi.fn()} act={vi.fn()} preview />,
  );
  expect(screen.queryByRole("region", { name: "Past 7 ritual days" })).not.toBeInTheDocument();
});

it("fills required progress independently of completed optional steps", () => {
  const current = state.current!;
  const response = (stepId: string) => ({
    id: stepId,
    requestId: stepId,
    stepId,
    value: true,
    submitted: true,
    observedAt: "2026-10-20T07:00:00Z",
    recordedAt: "2026-10-20T07:00:00Z",
  });
  const view = render(
    <RitualChecklist
      state={{
        ...state,
        current: {
          ...current,
          definition: {
            ...current.definition,
            steps: [
              ...current.definition.steps,
              { id: "stretch", label: "Stretch", kind: "checkbox", optional: true },
            ],
          },
          responses: [response("teeth"), response("stretch")],
        },
      }}
      saveResponse={vi.fn()}
      act={vi.fn()}
    />,
  );
  expect(screen.getByRole("button", { name: "1 of 2 tasks completed" })).toBeDisabled();
  expect(view.container.querySelector(".ritual-button-progress")).toHaveStyle({ width: "50%" });
  expect(screen.getByText("1 of 1 optional completed")).toBeInTheDocument();
  expect(screen.queryByLabelText("Reminder time")).not.toBeInTheDocument();
});
