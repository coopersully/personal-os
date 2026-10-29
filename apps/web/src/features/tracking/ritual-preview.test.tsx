// @vitest-environment jsdom
import type { RitualDefinition, RitualState } from "@personal-os/domain";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { nearestPreviewWeekday } from "./ritual-card-header.js";
import { makeRitualPreview, RitualPreview, RitualPreviewChecklist } from "./ritual-preview.js";

const mocks = vi.hoisted(() => ({ history: vi.fn(), desktop: vi.fn(), close: vi.fn() }));
vi.mock("../../api.js", () => ({
  api: { getMe: async () => ({ displayName: "Alex Morgan" }), listRitualHistory: mocks.history },
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
it("supports all six responses locally and keeps the preview close action available", async () => {
  mocks.desktop.mockReturnValue(true);
  const state = await makeRitualPreview(definition);
  const close = vi.fn();
  render(<RitualPreviewChecklist initialState={state} onClose={close} />);
  expect(screen.queryByText("Preview only")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("checkbox", { name: "Teeth" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Close Preview" })).toBeEnabled());
  for (const [label, value] of [
    ["Reflection", "A good day"],
    ["Bedtime", "22:30"],
    ["Day", "2026-09-29"],
    ["Minutes", "10"],
  ]) {
    fireEvent.change(screen.getByLabelText(new RegExp(label!)), { target: { value } });
    await waitFor(() => expect(screen.getByRole("radio", { name: "Good" })).toBeEnabled());
  }
  await waitFor(() => expect(screen.getByRole("button", { name: "Close Preview" })).toBeEnabled(), {
    timeout: 2500,
  });
  fireEvent.click(screen.getByRole("radio", { name: "Good" }));
  const complete = await screen.findByRole("button", { name: "Close Preview" });
  fireEvent.click(complete);
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  expect(mocks.history).toHaveBeenCalledTimes(1);
});
it("closes a preview through its escape or close control", async () => {
  const close = vi.fn();
  const state: RitualState = await makeRitualPreview(definition);
  render(<RitualPreviewChecklist initialState={state} onClose={close} />);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(close).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Close Preview" }));
  await waitFor(() => expect(close).toHaveBeenCalledTimes(2));
});

it("previews another weekday with its scheduled steps and resets local answers", async () => {
  const state = await makeRitualPreview({
    ...definition,
    steps: [
      { id: "daily", kind: "checkbox", label: "Daily" },
      { id: "monday", kind: "checkbox", label: "Monday only", days: [1], optional: true },
    ],
  });
  state.current!.scheduledLocalDate = "2026-10-18";
  state.current!.definition = {
    ...state.current!.definition,
    steps: [{ id: "daily", kind: "checkbox", label: "Daily" }],
  };
  render(<RitualPreviewChecklist initialState={state} onClose={vi.fn()} />);
  expect(await screen.findByText("Good evening, Alex")).toBeInTheDocument();
  expect(screen.getByText("0/1 done")).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("checkbox", { name: "Daily" })).toHaveFocus());
  fireEvent.click(screen.getByRole("checkbox", { name: "Daily" }));
  await waitFor(() => expect(screen.getByText("1/1 done")).toBeInTheDocument());
  fireEvent.keyDown(screen.getByRole("button", { name: /Preview weekday/ }), { key: "ArrowDown" });
  fireEvent.click(screen.getByRole("menuitemradio", { name: /^Monday$/ }));
  await waitFor(() =>
    expect(screen.getByRole("checkbox", { name: "Monday only" })).toBeInTheDocument(),
  );
  expect(screen.getByText("0/2 done")).toBeInTheDocument();
  expect(mocks.history).toHaveBeenCalledTimes(1);
});

it("chooses the nearest weekday using the ritual time zone across month boundaries", () => {
  const instant = new Date("2026-11-01T01:00:00Z");
  expect(nearestPreviewWeekday(0, "America/New_York", instant)).toBe("2026-11-01");
  expect(nearestPreviewWeekday(5, "America/New_York", instant)).toBe("2026-10-30");
  expect(nearestPreviewWeekday(6, "America/New_York", instant)).toBe("2026-10-31");
  expect(nearestPreviewWeekday(3, "America/New_York", instant)).toBe("2026-10-28");
});

it("opens the full preview without a drawer and keeps its close action available", async () => {
  const state = await makeRitualPreview(definition);
  const close = vi.fn();
  const view = render(<button type="button">Preview routine</button>);
  const trigger = screen.getByRole("button", { name: "Preview routine" });
  trigger.focus();
  view.rerender(
    <>
      <button type="button">Preview routine</button>
      <RitualPreview state={state} onClose={close} />
    </>,
  );
  const preview = await screen.findByRole("dialog", { name: "Ritual preview" });
  expect(preview).not.toHaveAttribute("data-vaul-drawer");
  expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Close Preview" }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
});
