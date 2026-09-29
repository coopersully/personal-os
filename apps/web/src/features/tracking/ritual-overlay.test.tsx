// @vitest-environment jsdom

import type { RitualState } from "@personal-os/domain";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RitualChecklist } from "./ritual-overlay.js";

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
  expect(await screen.findByRole("alert")).toHaveTextContent("Save unavailable");
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
  expect(await screen.findByRole("alert")).toHaveTextContent("This ritual changed");
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
  expect(await screen.findByRole("alert")).toHaveTextContent("Revision conflict");
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
