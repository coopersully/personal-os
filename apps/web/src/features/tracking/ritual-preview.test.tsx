// @vitest-environment jsdom
import type { RitualDefinition, RitualState } from "@personal-os/domain";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { makeRitualPreview, RitualPreviewChecklist } from "./ritual-preview.js";

const mocks = vi.hoisted(() => ({ history: vi.fn(), desktop: vi.fn(), close: vi.fn() }));
vi.mock("../../api.js", () => ({
  api: { listRitualHistory: mocks.history },
  errorMessage: (e: Error) => e.message,
}));
vi.mock("../desktop/bridge.js", () => ({ isDesktop: mocks.desktop }));
vi.mock("../desktop/ritual-bridge.js", () => ({
  showRitualPreview: mocks.close,
  ritualDeviceId: () => "test",
}));
const definition: RitualDefinition = {
  id: "night",
  kind: "night",
  title: "Good evening",
  revision: 2,
  enabled: true,
  enabledAt: "2026-09-29T00:00:00Z",
  time: "21:00",
  timeZone: "UTC",
  steps: [
    { id: "check", kind: "checkbox", label: "Teeth" },
    { id: "text", kind: "short_text", label: "Reflection" },
    { id: "time", kind: "time", label: "Bedtime" },
    { id: "date", kind: "date", label: "Day" },
    { id: "number", kind: "number", label: "Minutes" },
    { id: "choice", kind: "multiple_choice", label: "Mood", options: ["Good", "Okay"] },
  ],
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.history.mockResolvedValue({ items: [], nextCursor: null });
});
afterEach(cleanup);
it("prefills only today's matching definition without writing account data", async () => {
  const date = new Date().toISOString().slice(0, 10);
  const responses = [{ stepId: "check", value: true, submitted: true }];
  mocks.history.mockResolvedValue({
    items: [
      { definitionRevision: 1, scheduledLocalDate: date, responses: [] },
      { definitionRevision: 2, scheduledLocalDate: date, responses },
    ],
    nextCursor: null,
  });
  const state = await makeRitualPreview(definition);
  expect(state.preview).toBe(true);
  expect(state.current?.status).toBe("pending");
  expect(state.current?.responses).toEqual(responses);
  expect(mocks.history).toHaveBeenCalledWith(undefined, {
    kind: "night",
    dateFrom: date,
    dateTo: date,
  });
});
it("supports all six responses locally and closes native completion with its exit animation", async () => {
  mocks.desktop.mockReturnValue(true);
  const state = await makeRitualPreview(definition);
  render(<RitualPreviewChecklist initialState={state} onClose={vi.fn()} />);
  expect(screen.getByText("Preview only")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("checkbox", { name: "Teeth" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "1 of 6 tasks completed" })).toBeDisabled(),
  );
  for (const [label, value] of [
    ["Reflection", "A good day"],
    ["Bedtime", "22:30"],
    ["Day", "2026-09-29"],
    ["Minutes", "10"],
  ]) {
    fireEvent.change(screen.getByLabelText(label!), { target: { value } });
    await waitFor(() => expect(screen.getByRole("radio", { name: "Good" })).toBeEnabled());
  }
  await waitFor(
    () => expect(screen.getByRole("button", { name: "5 of 6 tasks completed" })).toBeDisabled(),
    { timeout: 2500 },
  );
  fireEvent.click(screen.getByRole("radio", { name: "Good" }));
  const complete = await screen.findByRole("button", { name: "Complete Evening Ritual" });
  fireEvent.click(complete);
  await waitFor(() => expect(mocks.close).toHaveBeenCalledWith(null, true));
  expect(mocks.history).toHaveBeenCalledTimes(1);
});
it("closes a preview through its escape or close control", async () => {
  const close = vi.fn();
  const state: RitualState = await makeRitualPreview(definition);
  render(<RitualPreviewChecklist initialState={state} onClose={close} />);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(close).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Close preview" }));
  await waitFor(() => expect(close).toHaveBeenCalledTimes(2));
});
