// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RitualSettings } from "./ritual-settings.js";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  save: vi.fn(),
  history: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("../../api.js", () => ({
  api: {
    listRituals: mocks.list,
    saveRitual: mocks.save,
    listRitualHistory: mocks.history,
    deleteRitualData: mocks.remove,
  },
  errorMessage: (e: Error) => e.message,
}));
vi.mock("../desktop/ritual-bridge.js", () => ({
  ritualDeviceId: () => "test",
  enableRitualPresentation: vi.fn(),
  showRitualPreview: vi.fn(),
}));
afterEach(cleanup);
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
  expect(screen.getByDisplayValue("21:00")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("checkbox", { name: "Enable morning ritual" }));
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
  fireEvent.change(screen.getAllByLabelText("Time zone")[0]!, {
    target: { value: "Europe/London" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add step" }));
  fireEvent.change(screen.getAllByLabelText("Prompt")[2]!, { target: { value: "Water" } });
  fireEvent.change(screen.getAllByRole("combobox", { name: "Response type" })[2]!, {
    target: { value: "number" },
  });
  fireEvent.keyDown(screen.getByRole("button", { name: "Reorder step 3" }), { key: "ArrowUp" });
  fireEvent.keyDown(screen.getByRole("button", { name: "Reorder step 1" }), { key: "ArrowDown" });
  fireEvent.click(screen.getAllByRole("button", { name: "Remove step" })[2]!);
  expect(await screen.findByRole("alert")).toHaveTextContent("Settings changed");
  expect(screen.getByDisplayValue("07:15")).toBeInTheDocument();
  expect(mocks.save).toHaveBeenLastCalledWith(
    expect.objectContaining({
      time: "07:15",
      timeZone: "Europe/London",
      steps: [
        expect.objectContaining({ label: "Water", kind: "number" }),
        expect.objectContaining({ label: "Brush your teeth", kind: "checkbox" }),
      ],
    }),
  );
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
  expect(await screen.findByRole("alert")).toHaveTextContent("Server unavailable");
  mocks.list.mockResolvedValue({ rituals: [definition] });
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByDisplayValue("05:45")).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: "Remove step" })[0]).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox", { name: "Enable morning ritual" }));
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
  fireEvent.change(screen.getAllByRole("combobox", { name: "Response type" })[0]!, {
    target: { value: "multiple_choice" },
  });
  fireEvent.change(screen.getByLabelText("Choices"), { target: { value: "Happy\nCalm\nTired" } });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Show morning ritual" })).toBeEnabled(),
  );
  expect(mocks.save).toHaveBeenCalledWith(
    expect.objectContaining({
      steps: expect.arrayContaining([
        expect.objectContaining({ kind: "multiple_choice", options: ["Happy", "Calm", "Tired"] }),
      ]),
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Show morning ritual" }));
  expect(await screen.findByRole("dialog", { name: "Ritual preview" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Close preview" }));
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
  fireEvent.click(screen.getByRole("radio", { name: "History and data" }));
  fireEvent.click(await screen.findByRole("button", { name: "Delete morning data" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
  await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith("morning"));
  await waitFor(() => expect(screen.getByDisplayValue("06:00")).toBeInTheDocument());
  fireEvent.click(screen.getByRole("radio", { name: "Morning" }));
  expect(screen.getByRole("checkbox", { name: "Enable morning ritual" })).not.toBeChecked();
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
  expect(await screen.findByRole("alert")).toHaveTextContent("Your edits are preserved");
  await waitFor(() =>
    expect(screen.getAllByLabelText("Time zone")[0]).toHaveValue("Europe/London"),
  );
  expect(screen.getByDisplayValue("07:15")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry saving" }));
  await waitFor(() =>
    expect(mocks.save).toHaveBeenLastCalledWith(
      expect.objectContaining({ expectedRevision: 3, time: "07:15", timeZone: "Europe/London" }),
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
