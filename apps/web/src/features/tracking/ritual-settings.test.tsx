// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render as renderUi, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { toast } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SettingsFeedbackContext } from "../../lib/settings-feedback";
import { RitualSettings } from "./ritual-settings.js";

const render = (ui: ReactElement) =>
  renderUi(
    <SettingsFeedbackContext.Provider value={true}>
      <TooltipProvider>{ui}</TooltipProvider>
    </SettingsFeedbackContext.Provider>,
  );

function openSubpage(view: "morning" | "night" | "history", timeZone = "UTC") {
  cleanup();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RitualSettings view={view} timeZone={timeZone} />
    </QueryClientProvider>,
  );
}

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), dismiss: vi.fn() } }));
beforeEach(() => vi.mocked(toast.error).mockClear());

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  save: vi.fn(),
  history: vi.fn(),
  remove: vi.fn(),
  automatic: vi.fn(),
  desktop: false,
}));
vi.mock("../desktop/bridge.js", () => ({ isDesktop: () => mocks.desktop }));
vi.mock("./ritual-local.js", () => ({ RitualLocal: () => null }));
vi.mock("../../api.js", () => ({
  api: {
    getMe: async () => ({ displayName: "Alex Morgan" }),
    listRituals: mocks.list,
    saveRitual: mocks.save,
    listRitualHistory: mocks.history,
    deleteRitualData: mocks.remove,
  },
  errorMessage: (e: Error) => e.message,
}));
vi.mock("../desktop/ritual-bridge.js", () => ({
  ritualDeviceId: () => "test",
  enableRitualPresentation: mocks.automatic,
  showRitualPreview: vi.fn(),
}));
afterEach(() => {
  cleanup();
  mocks.desktop = false;
});

it("allows retrying a failed preview without implying settings were saved", async () => {
  mocks.list.mockResolvedValue({ rituals: [] });
  mocks.save.mockClear();
  mocks.history
    .mockRejectedValueOnce(new Error("private failure"))
    .mockResolvedValue({ items: [], nextCursor: null });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RitualSettings timeZone="UTC" />
    </QueryClientProvider>,
  );
  const show = await screen.findByRole("button", { name: "Preview Morning Ritual" });
  fireEvent.click(show);
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      "Couldn’t show this ritual. Try again.",
      expect.anything(),
    ),
  );
  expect(screen.queryByText("Couldn’t show this ritual. Try again.")).not.toBeInTheDocument();
  expect(mocks.save).not.toHaveBeenCalled();
  fireEvent.click(show);
  expect(await screen.findByRole("dialog", { name: "Ritual preview" })).toBeInTheDocument();
  expect(screen.queryByText("Couldn’t show this ritual. Try again.")).not.toBeInTheDocument();
});

it.each([
  [true, "Enable", "enable"],
  [false, "Pause", "pause"],
] as const)("names and safely retries automatic presentation enabled=%s", async (enabled, button, action) => {
  mocks.desktop = true;
  mocks.list.mockResolvedValue({ rituals: [] });
  mocks.automatic
    .mockReset()
    .mockRejectedValueOnce(new Error("private failure"))
    .mockResolvedValue(undefined);
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RitualSettings timeZone="UTC" />
    </QueryClientProvider>,
  );
  const toggle = await screen.findByRole("button", { name: button });
  fireEvent.click(toggle);
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      `Couldn’t ${action} automatic rituals. Try again.`,
      expect.anything(),
    ),
  );
  expect(
    screen.queryByText(`Couldn’t ${action} automatic rituals. Try again.`),
  ).not.toBeInTheDocument();
  fireEvent.click(toggle);
  await waitFor(() =>
    expect(toast.success).toHaveBeenCalledWith(
      enabled ? "Automatic rituals enabled" : "Automatic rituals paused",
    ),
  );
  expect(
    screen.queryByText(enabled ? "Automatic rituals enabled" : "Automatic rituals paused"),
  ).not.toBeInTheDocument();
  expect(mocks.automatic).toHaveBeenLastCalledWith(enabled);
});
it("offers opt-in defaults and saves explicit steps", async () => {
  mocks.list.mockResolvedValue({ rituals: [] });
  mocks.history.mockResolvedValue({ items: [], nextCursor: null });
  mocks.save.mockImplementation(async (input) => ({ ...input, id: input.kind, revision: 1 }));
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RitualSettings timeZone="America/New_York" />
    </QueryClientProvider>,
  );
  expect(await screen.findByDisplayValue("06:00")).toBeInTheDocument();
  expect(screen.queryByDisplayValue("21:00")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("switch", { name: "Enable morning ritual" }));
  await waitFor(() =>
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "morning",
        enabled: true,
        time: "06:00",
        timeZone: "America/New_York",
      }),
    ),
  );
});

it("autosaves reordered custom steps and retains edits when saving fails", async () => {
  mocks.list.mockResolvedValue({ rituals: [] });
  mocks.history.mockResolvedValue({ items: [], nextCursor: null });
  mocks.save.mockReset().mockRejectedValueOnce(new Error("Settings changed"));
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RitualSettings timeZone="America/New_York" />
    </QueryClientProvider>,
  );
  await screen.findByDisplayValue("06:00");
  fireEvent.change(screen.getAllByLabelText("Available from")[0]!, { target: { value: "07:15" } });
  fireEvent.click(screen.getByRole("button", { name: "Add step" }));
  fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "Water" } });
  fireEvent.change(screen.getByRole("combobox", { name: "Response type" }), {
    target: { value: "number" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  fireEvent.keyDown(screen.getByRole("button", { name: "Reorder step 3" }), { key: "ArrowUp" });
  fireEvent.keyDown(screen.getByRole("button", { name: "Reorder step 1" }), { key: "ArrowDown" });
  fireEvent.click(screen.getByRole("button", { name: "Edit step 3" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete step" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("save ritual settings"),
      expect.anything(),
    ),
  );
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByDisplayValue("07:15")).toBeInTheDocument();
  expect(mocks.save).toHaveBeenLastCalledWith(
    expect.objectContaining({
      time: "07:15",
      timeZone: "America/New_York",
      steps: [
        expect.objectContaining({ label: "Water", kind: "number" }),
        expect.objectContaining({ label: "Brush your teeth", kind: "checkbox" }),
      ],
    }),
  );
  mocks.list.mockRejectedValueOnce(new Error("private refresh failure"));
  expect(screen.queryByText("Saving", { exact: true })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry saving" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      "Couldn’t refresh ritual settings. Try again.",
      expect.anything(),
    ),
  );
  expect(screen.queryByText(/making the change twice/)).not.toBeInTheDocument();
  mocks.save.mockImplementation(async (input) => ({ ...input, id: input.kind, revision: 1 }));
  fireEvent.click(screen.getByRole("button", { name: "Retry saving" }));
  await waitFor(() => expect(screen.queryByText("Changes not saved")).not.toBeInTheDocument());
});

it("recovers from an unavailable server and retains definition revisions", async () => {
  mocks.list.mockReset().mockRejectedValueOnce(new Error("Server unavailable"));
  mocks.history.mockResolvedValue({ items: [], nextCursor: null });
  const definition = {
    id: "morning",
    revision: 4,
    kind: "morning",
    title: "Hello",
    enabled: true,
    time: "05:45",
    timeZone: "Europe/London",
    steps: [{ id: "water", label: "Water", kind: "checkbox" }],
  };
  mocks.save.mockReset().mockResolvedValue({ ...definition, revision: 5 });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RitualSettings timeZone="America/New_York" />
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("Couldn’t load ritual settings"),
      expect.anything(),
    ),
  );
  expect(screen.queryByText("Couldn’t load ritual settings")).not.toBeInTheDocument();
  mocks.list.mockResolvedValue({ rituals: [definition] });
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByDisplayValue("05:45")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Edit step 1" }));
  expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  fireEvent.click(screen.getByRole("switch", { name: "Enable morning ritual" }));
  await waitFor(() =>
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({ expectedRevision: 4, enabled: false, time: "05:45" }),
    ),
  );
});

it("edits multiple choices and shows a full-screen preview without recording responses", async () => {
  mocks.list.mockResolvedValue({ rituals: [] });
  mocks.history.mockResolvedValue({ items: [], nextCursor: null });
  mocks.save.mockImplementation(async (input) => ({ ...input, id: input.kind, revision: 1 }));
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RitualSettings timeZone="UTC" />
    </QueryClientProvider>,
  );
  await screen.findByDisplayValue("06:00");
  expect(screen.queryByRole("combobox", { name: "Response type" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Edit step 1" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Response type" }), {
    target: { value: "multiple_choice" },
  });
  fireEvent.change(screen.getByLabelText("Choices"), { target: { value: "Happy\nCalm\nTired" } });
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Preview Morning Ritual" })).toBeEnabled(),
  );
  expect(mocks.save).toHaveBeenCalledWith(
    expect.objectContaining({
      steps: expect.arrayContaining([
        expect.objectContaining({ kind: "multiple_choice", options: ["Happy", "Calm", "Tired"] }),
      ]),
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Preview Morning Ritual" }));
  expect(await screen.findByRole("dialog", { name: "Ritual preview" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Close Preview" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

it("resets the editor after deleting its history and definition", async () => {
  mocks.list.mockResolvedValue({
    rituals: [
      {
        id: "morning",
        kind: "morning",
        title: "Morning",
        enabled: true,
        time: "07:00",
        timeZone: "UTC",
        revision: 2,
        steps: [{ id: "water", label: "Water", kind: "checkbox" }],
      },
    ],
  });
  mocks.history.mockResolvedValue({ items: [], nextCursor: null });
  mocks.remove.mockImplementation(async () => {
    mocks.list.mockResolvedValue({ rituals: [] });
  });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RitualSettings timeZone="UTC" />
    </QueryClientProvider>,
  );
  await screen.findByDisplayValue("07:00");
  fireEvent.click(await screen.findByRole("button", { name: "Delete Data" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
  await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith("morning"));
  openSubpage("morning");
  await screen.findByDisplayValue("06:00");
  expect(screen.getByRole("switch", { name: "Enable morning ritual" })).not.toBeChecked();
});

it("refreshes conflicting settings and rebases local edits onto the latest revision", async () => {
  const definition = {
    id: "morning",
    kind: "morning",
    title: "Morning",
    enabled: true,
    time: "06:00",
    timeZone: "UTC",
    revision: 2,
    steps: [{ id: "water", label: "Water", kind: "checkbox" }],
  };
  mocks.list
    .mockResolvedValueOnce({ rituals: [definition] })
    .mockResolvedValue({ rituals: [{ ...definition, revision: 3, timeZone: "Europe/London" }] });
  mocks.save
    .mockReset()
    .mockRejectedValueOnce(Object.assign(new Error("Revision conflict"), { status: 409 }))
    .mockImplementation(async (input) => ({ ...input, id: "morning", revision: 4 }));
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RitualSettings timeZone="UTC" />
    </QueryClientProvider>,
  );
  await screen.findByDisplayValue("06:00");
  fireEvent.change(screen.getAllByLabelText("Available from")[0]!, { target: { value: "07:15" } });
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("Your edits are preserved"),
      expect.anything(),
    ),
  );
  expect(screen.queryByRole("textbox", { name: "Time zone" })).not.toBeInTheDocument();
  expect(screen.getByDisplayValue("07:15")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry saving" }));
  await waitFor(() =>
    expect(mocks.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ expectedRevision: 3, time: "07:15", timeZone: "UTC" }),
    ),
  );
});

it("adopts external changes to clean settings without saving them back", async () => {
  const definition = {
    id: "morning",
    kind: "morning",
    title: "Morning",
    enabled: true,
    time: "06:00",
    timeZone: "UTC",
    revision: 2,
    steps: [{ id: "water", label: "Water", kind: "checkbox" }],
  };
  mocks.list.mockResolvedValue({ rituals: [definition] });
  mocks.save.mockClear();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RitualSettings timeZone="UTC" />
    </QueryClientProvider>,
  );
  await screen.findByDisplayValue("06:00");
  client.setQueryData(["rituals"], { rituals: [{ ...definition, revision: 3, time: "08:00" }] });
  expect(await screen.findByDisplayValue("08:00")).toBeInTheDocument();
  await new Promise((resolve) => setTimeout(resolve, 600));
  expect(mocks.save).not.toHaveBeenCalled();
});

it("uses the profile zone for both rituals rather than a separately stored zone", async () => {
  const morning = {
    id: "morning",
    kind: "morning",
    title: "Morning",
    revision: 1,
    enabled: true,
    time: "06:00",
    timeZone: "Europe/London",
    steps: [{ id: "check", label: "Check", kind: "checkbox" }],
  };
  mocks.list.mockResolvedValue({ rituals: [morning] });
  mocks.save
    .mockReset()
    .mockImplementation(async (input) => ({ ...input, id: input.kind, revision: 1 }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RitualSettings timeZone="America/New_York" />
    </QueryClientProvider>,
  );
  await screen.findByDisplayValue("06:00");
  expect(screen.queryByRole("textbox", { name: "Time zone" })).not.toBeInTheDocument();
  const updated = { ...morning, revision: 2, timeZone: "Asia/Tokyo" };
  mocks.list.mockResolvedValue({ rituals: [updated] });
  await client.invalidateQueries({ queryKey: ["rituals"] });
  expect(screen.queryByText(/America\/New York/)).not.toBeInTheDocument();
  openSubpage("night", "America/New_York");
  fireEvent.click(await screen.findByRole("switch", { name: "Enable evening ritual" }));
  await waitFor(() =>
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "night", enabled: true, timeZone: "America/New_York" }),
    ),
  );
});

it("blocks background setup navigation until ritual edits are saved", async () => {
  mocks.desktop = true;
  mocks.list.mockResolvedValue({ rituals: [] });
  mocks.save.mockReset().mockRejectedValue(new Error("Offline"));
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RitualSettings timeZone="UTC" />
    </QueryClientProvider>,
  );
  await screen.findByRole("link", { name: "Background settings" });
  fireEvent.change(screen.getAllByLabelText("Available from")[0]!, { target: { value: "07:15" } });
  expect(screen.getByRole("button", { name: "Background settings" })).toBeDisabled();
  expect(screen.queryByRole("link", { name: "Background settings" })).not.toBeInTheDocument();
  await waitFor(() => expect(toast.error).toHaveBeenCalled());
  expect(screen.getByRole("button", { name: "Background settings" })).toBeDisabled();
});

it("autosaves optional steps, custom days, and independent reminder defaults", async () => {
  mocks.list.mockResolvedValue({ rituals: [] });
  mocks.save.mockReset().mockImplementation(async (input) => ({
    ...input,
    id: input.kind,
    revision: input.expectedRevision + 1,
    enabledAt: "2026-10-17T00:00:00Z",
  }));
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RitualSettings timeZone="UTC" />
    </QueryClientProvider>,
  );
  const time = await screen.findByLabelText("Morning reminder time");
  fireEvent.change(time, { target: { value: "13:45" } });
  fireEvent.click(screen.getByRole("button", { name: "Edit step 1" }));
  fireEvent.click(screen.getAllByRole("switch", { name: "Required" })[0]!);
  fireEvent.change(screen.getAllByLabelText("Include on")[0]!, { target: { value: "custom" } });
  fireEvent.click(screen.getByRole("checkbox", { name: "Monday" }));
  await waitFor(() =>
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "morning",
        reminderTime: "13:45",
        steps: expect.arrayContaining([
          expect.objectContaining({ optional: true, days: [2, 3, 4, 5] }),
        ]),
      }),
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  openSubpage("night");
  expect(await screen.findByLabelText("Evening reminder time")).toHaveValue("22:00");
});

it("locks dependent schedule fields until the ritual is enabled and keeps their values", async () => {
  mocks.list.mockResolvedValue({ rituals: [] });
  openSubpage("morning");
  const toggle = await screen.findByRole("switch", { name: "Enable morning ritual" });
  const time = screen.getByDisplayValue("06:00");
  const reminder = screen.getByLabelText("Morning reminder time");
  expect(time).toBeDisabled();
  expect(reminder).toBeDisabled();
  expect(
    screen.getByLabelText(
      "Turn on Enable morning ritual to change its schedule and reminder time.",
    ),
  ).toHaveAttribute("tabindex", "0");
  fireEvent.click(toggle);
  expect(time).toBeEnabled();
  expect(reminder).toBeEnabled();
  fireEvent.click(toggle);
  expect(time).toBeDisabled();
  expect(time).toHaveValue("06:00");
});

it("offers recovery when definitions fail without blocking the independent history collection", async () => {
  mocks.list.mockReset().mockRejectedValue(new Error("Offline"));
  mocks.history.mockReset().mockResolvedValue({ items: [], total: 0, nextCursor: null });
  openSubpage("morning");
  const unavailable = await screen.findByRole("region", { name: "Ritual settings unavailable" });
  expect(unavailable).toHaveTextContent("Try again");
  expect(screen.queryByText("Offline")).not.toBeInTheDocument();
  await waitFor(() => expect(toast.error).toHaveBeenCalled());
  openSubpage("history");
  expect(await screen.findByText("No rituals in this period")).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Ritual settings unavailable" })).not.toBeInTheDocument();
});
