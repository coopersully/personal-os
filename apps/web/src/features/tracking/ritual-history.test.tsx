// @vitest-environment jsdom
import type { RitualOccurrence } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";
import { SettingsFeedbackContext } from "../../lib/settings-feedback.js";
import { RitualDataAction } from "./ritual-data-action.js";
import { RitualHistory } from "./ritual-history.js";
import { RitualLocal } from "./ritual-local.js";

const mocks = vi.hoisted(() => ({
  history: vi.fn(),
  export: vi.fn(),
  remove: vi.fn(),
  invoke: vi.fn(),
}));
vi.mock("../../api.js", () => ({
  api: {
    getMe: async () => ({ planningTimezone: "America/New_York" }),
    listRitualHistory: mocks.history,
    exportRitualData: mocks.export,
    deleteRitualData: mocks.remove,
  },
  errorMessage: (e: Error) => e.message,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), dismiss: vi.fn() } }));
const occurrence = {
  id: "one",
  status: "completed",
  scheduledLocalDate: "2026-09-29",
  dueAt: "2026-09-29T10:00:00Z",
  timeZone: "America/New_York",
  definition: {
    title: "Good morning",
    steps: [
      { id: "teeth", label: "Teeth" },
      { id: "journal", label: "Journal" },
    ],
  },
  responses: [
    { id: "a", stepId: "teeth", value: true, submitted: true, recordedAt: "2026-09-29T10:00:00Z" },
    { id: "b", stepId: "teeth", value: false, submitted: true, recordedAt: "2026-09-29T10:01:00Z" },
    {
      id: "c",
      stepId: "journal",
      value: "Private draft",
      submitted: false,
      recordedAt: "2026-09-29T10:02:00Z",
    },
  ],
  actions: [
    { id: "press", kind: "snooze_pressed", outcome: "pending", recordedAt: "2026-09-29T10:00:00Z" },
  ],
} as unknown as RitualOccurrence;
function mount(child: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {child}
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.history.mockResolvedValue({ items: [occurrence], nextCursor: null });
  mocks.export.mockResolvedValue({ occurrences: [occurrence] });
  mocks.remove.mockResolvedValue(undefined);
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn().mockReturnValue("blob:export"),
    revokeObjectURL: vi.fn(),
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
afterEach(async () => {
  cleanup();
  // Export revokes each blob URL after the browser has consumed the download.
  // Keep the browser mock installed until those callbacks have actually settled.
  await waitFor(
    () =>
      expect(URL.revokeObjectURL).toHaveBeenCalledTimes(
        vi.mocked(URL.createObjectURL).mock.calls.length,
      ),
    { timeout: 3_000 },
  );
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("filters, paginates and exports complete response and escape history", async () => {
  mocks.history.mockImplementation((cursor) =>
    Promise.resolve({
      items: cursor
        ? [{ ...occurrence, id: "two", scheduledLocalDate: "2026-09-28" }]
        : [occurrence],
      nextCursor: cursor ? null : "2026-09-29T10:00:00Z",
    }),
  );
  mount(
    <>
      <RitualHistory />
      <RitualDataAction />
      <RitualDataAction kind="morning" />
      <RitualDataAction kind="night" />
    </>,
  );
  const rows = await screen.findAllByRole("button", { name: /Morning Ritual/ });
  expect(rows).toHaveLength(1);
  expect(mocks.history).toHaveBeenCalledWith(
    undefined,
    expect.objectContaining({ dateFrom: expect.any(String), dateTo: expect.any(String) }),
  );
  fireEvent.click(rows[0]!);
  expect(screen.getByText(/^Due /)).toHaveTextContent(
    new Date(occurrence.dueAt).toLocaleString(undefined, {
      timeZone: occurrence.timeZone,
      timeZoneName: "short",
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Interaction Log" }));
  expect(
    screen.getByText(
      (_, element) => element?.tagName === "P" && element.textContent === "Teeth: Done",
    ),
  ).toBeInTheDocument();
  expect(
    screen.getByText(
      (_, element) => element?.tagName === "P" && element.textContent === "Teeth: Unchecked",
    ),
  ).toBeInTheDocument();
  expect(screen.getAllByText(/Private draft/)[0]).toHaveTextContent("(draft)");
  expect(screen.getByText(/Snooze opened/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await waitFor(() =>
    expect(mocks.history).toHaveBeenCalledWith("2026-09-29T10:00:00Z", expect.anything()),
  );
  fireEvent.click(screen.getByRole("button", { name: "Filters" }));
  fireEvent.keyDown(screen.getByRole("button", { name: /^Ritual:/ }), { key: "ArrowDown" });
  fireEvent.click(screen.getByRole("menuitemradio", { name: /^Morning$/ }));
  await waitFor(() =>
    expect(mocks.history).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ kind: "morning" }),
    ),
  );
  if (screen.queryByRole("dialog", { name: "Filters" }))
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
  fireEvent.click(screen.getByRole("button", { name: "Export Rituals" }));
  expect(screen.getByRole("dialog", { name: "Export Rituals?" })).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole("button", { name: "Export Rituals" }).at(-1)!);
  await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob)));
  expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
});
it("requires explicit deletion and keeps failure visible for retry", async () => {
  mount(
    <>
      <RitualHistory />
      <RitualDataAction />
      <RitualDataAction kind="morning" />
      <RitualDataAction kind="night" />
    </>,
  );
  await screen.findByRole("button", { name: /Morning Ritual/ });
  fireEvent.click(screen.getAllByRole("button", { name: "Delete Data" })[0]!);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(mocks.remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getAllByRole("button", { name: "Delete Data" })[1]!);
  mocks.remove.mockRejectedValueOnce(new Error("Deletion unavailable"));
  fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("delete ritual history"),
      expect.anything(),
    ),
  );
  expect(screen.queryByText(/Couldn’t delete ritual history/)).not.toBeInTheDocument();
  mocks.history.mockResolvedValue({ items: [], nextCursor: null });
  fireEvent.click(screen.getAllByRole("button", { name: "Delete Data" })[1]!);
  fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
  expect(await screen.findByText("No rituals in this period")).toBeInTheDocument();
  expect(screen.queryByText(/Couldn’t delete ritual history/)).not.toBeInTheDocument();
  expect(mocks.remove).toHaveBeenLastCalledWith("night");
  mocks.export.mockRejectedValueOnce(new Error("Export unavailable"));
  if (screen.queryByRole("dialog", { name: "Filters" }))
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
  fireEvent.click(screen.getByRole("button", { name: "Export Rituals" }));
  expect(screen.getByRole("dialog", { name: "Export Rituals?" })).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole("button", { name: "Export Rituals" }).at(-1)!);
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("export ritual history"),
      expect.anything(),
    ),
  );
  expect(screen.queryByText(/Couldn’t export ritual history/)).not.toBeInTheDocument();
  mocks.export.mockResolvedValue({ occurrences: [] });
  if (screen.queryByRole("dialog", { name: "Filters" }))
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
  fireEvent.click(screen.getByRole("button", { name: "Export Rituals" }));
  expect(screen.getByRole("dialog", { name: "Export Rituals?" })).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole("button", { name: "Export Rituals" }).at(-1)!);
  await waitFor(() =>
    expect(screen.queryByText(/Couldn’t export ritual history/)).not.toBeInTheDocument(),
  );
});
it("reports unavailable account history", async () => {
  mocks.history.mockRejectedValue(new Error("History unavailable"));
  mount(
    <>
      <RitualHistory />
      <RitualDataAction />
      <RitualDataAction kind="morning" />
      <RitualDataAction kind="night" />
    </>,
  );
  await screen.findByRole("region", { name: "History unavailable" });
  expect(toast.error).toHaveBeenCalledWith("Couldn’t load ritual history.", expect.any(Object));
  expect(screen.queryByText("Couldn’t load ritual history.")).not.toBeInTheDocument();
});
it("exports pending native evidence and only discards after explicit confirmation", async () => {
  mocks.invoke.mockResolvedValue({
    enabled: true,
    queue: [{ value: "Unsynced draft" }],
    localHistory: [],
  });
  mount(
    <SettingsFeedbackContext.Provider value={true}>
      <RitualLocal />
    </SettingsFeedbackContext.Provider>,
  );
  expect(await screen.findByRole("status")).toHaveTextContent("1 ritual changes");
  expect(screen.getByText(/Automatic rituals on this Mac: on/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Export pending changes" }));
  expect(URL.createObjectURL).toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Discard pending changes" }));
  fireEvent.click(screen.getByRole("button", { name: "Keep changes" }));
  expect(mocks.invoke).not.toHaveBeenCalledWith("ritual_local", { discard: true });
  fireEvent.click(screen.getByRole("button", { name: "Discard pending changes" }));
  mocks.invoke.mockRejectedValueOnce(new Error("Storage locked"));
  fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("update automatic rituals"),
      expect.anything(),
    ),
  );
  expect(screen.queryByText(/update automatic rituals/)).not.toBeInTheDocument();
  mocks.invoke.mockResolvedValue({ enabled: false, queue: [], localHistory: [] });
  fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Discard pending changes" }),
    ).not.toBeInTheDocument(),
  );
  expect(screen.getByText(/Automatic rituals on this Mac: off/)).toBeInTheDocument();
});
it("keeps orphaned local history inspectable even without queued requests", async () => {
  mocks.invoke.mockResolvedValue({ enabled: false, localHistory: [{ value: "Unmatched answer" }] });
  mount(<RitualLocal />);
  expect(await screen.findByRole("status")).toHaveTextContent("0 ritual changes");
  expect(screen.getByText(/Unmatched answer/)).toBeInTheDocument();
});

it("distinguishes optional not done from accepted and queued follow-ups", async () => {
  const steps = [{ id: "optional", label: "Stretch", kind: "checkbox" as const, optional: true }];
  const base = { ...occurrence, definition: { ...occurrence.definition, steps }, responses: [] };
  mocks.history.mockResolvedValue({
    items: [
      { ...base, id: "skipped" },
      {
        ...base,
        id: "scheduled",
        optionalFollowUp: {
          dueAt: "2026-09-29T16:00:00Z",
          stepIds: ["optional"],
          reminderIds: ["reminder"],
        },
      },
      {
        ...base,
        id: "queued",
        optionalFollowUp: { dueAt: "2026-09-29T16:00:00Z", stepIds: ["optional"] },
      },
    ],
    nextCursor: null,
  });
  mount(
    <>
      <RitualHistory />
      <RitualDataAction />
      <RitualDataAction kind="morning" />
      <RitualDataAction kind="night" />
    </>,
  );
  const rows = await screen.findAllByRole("button", { name: /Morning Ritual/ });
  const expected = ["Reminder scheduled", "Not done", "Reminder waiting to sync"];
  const detailTexts: string[] = [];
  for (let index = 0; index < rows.length; index++) {
    fireEvent.click(screen.getAllByRole("button", { name: /Morning Ritual/ })[index]!);
    detailTexts.push(screen.getByRole("dialog").textContent ?? "");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
  }
  for (const text of expected) expect(detailTexts.some((value) => value.includes(text))).toBe(true);
});

it("requests server search and sort and follows page cursors", async () => {
  const items = Array.from({ length: 12 }, (_, index) => ({
    ...occurrence,
    id: `row-${index}`,
    dueAt: `2026-10-${String(index + 1).padStart(2, "0")}T10:00:00Z`,
    scheduledLocalDate: `2026-10-${String(index + 1).padStart(2, "0")}`,
    definition: { ...occurrence.definition, title: index === 0 ? "Rare answer" : "Good morning" },
  }));
  mocks.history.mockImplementation((cursor, filters) => {
    let result = items.filter(
      (item) => !filters.search || item.definition.title.includes(filters.search),
    );
    result = [...result].sort((a, b) =>
      filters.sort === "oldest" ? a.dueAt.localeCompare(b.dueAt) : b.dueAt.localeCompare(a.dueAt),
    );
    const start = Number(cursor ?? 0);
    return Promise.resolve({
      items: result.slice(start, start + 10),
      total: result.length,
      nextCursor: start + 10 < result.length ? String(start + 10) : null,
    });
  });
  mount(<RitualHistory />);
  expect(await screen.findAllByRole("button", { name: /Morning Ritual/ })).toHaveLength(10);
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await waitFor(() =>
    expect(screen.getAllByRole("button", { name: /Morning Ritual/ })).toHaveLength(2),
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Search history" }), {
    target: { value: "Rare answer" },
  });
  await waitFor(() =>
    expect(screen.getAllByRole("button", { name: /Morning Ritual/ })).toHaveLength(1),
  );
  expect(screen.getByText("1–1 of 1 rituals")).toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: "Search history" }), {
    target: { value: "" },
  });
  fireEvent.keyDown(screen.getByRole("button", { name: /^Sort:/ }), { key: "ArrowDown" });
  fireEvent.click(screen.getByRole("menuitemradio", { name: "Oldest First" }));
  await waitFor(() =>
    expect(
      screen.getAllByRole("button", { name: /Morning Ritual/ })[0]!.closest("tr"),
    ).toHaveTextContent("Thu, Oct 1"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Previous week" }));
  await waitFor(() =>
    expect(new Set(mocks.history.mock.calls.map((call) => call[1].dateFrom)).size).toBe(2),
  );
});

it("puts active filter chips first and restores unfiltered dashed triggers", async () => {
  mount(<RitualHistory />);
  await screen.findByRole("button", { name: /Morning Ritual/ });
  expect(screen.queryByRole("button", { name: /^Ritual:/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Filters" }));
  const ritual = screen.getByRole("button", { name: /^Ritual:/ });
  expect(ritual).toHaveTextContent("Both Rituals");
  fireEvent.keyDown(ritual, { key: "ArrowDown" });
  fireEvent.click(screen.getByRole("menuitemradio", { name: /^Morning$/ }));
  expect(screen.getByRole("button", { name: "Ritual: Morning" })).toHaveTextContent("Morning");
  fireEvent.keyDown(screen.getByRole("button", { name: /^Period:/ }), { key: "ArrowDown" });
  fireEvent.click(screen.getByRole("menuitemradio", { name: "All Time" }));
  await waitFor(() =>
    expect(mocks.history).toHaveBeenLastCalledWith(undefined, {
      kind: "morning",
      sort: "newest",
      limit: 10,
    }),
  );
  const filters = within(screen.getByRole("dialog", { name: "Filters" })).getAllByRole("button");
  expect(filters[0]).toHaveAccessibleName("Ritual: Morning");
  expect(screen.getByRole("button", { name: "Period: All Time" })).toHaveTextContent("All Time");
});

it("removes meaningless empty-table controls while preserving a non-destructive way out", async () => {
  mocks.history.mockResolvedValue({ items: [], total: 0, nextCursor: null });
  mount(<RitualHistory />);
  await screen.findByText("No rituals in this period");
  expect(screen.queryByRole("button", { name: /^Sort:/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("combobox", { name: "Rows per page" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Table actions" })).not.toBeInTheDocument();
  expect(screen.queryByText(/0–0/)).not.toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Search history" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Filters" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Show all history" }));
  await screen.findByText("No ritual history yet");
  expect(mocks.history.mock.lastCall?.[1]).not.toHaveProperty("dateFrom");
  expect(mocks.remove).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Show all history" })).not.toBeInTheDocument();
});

it("does not confuse failed history with empty history and retries with preserved criteria", async () => {
  mocks.history.mockRejectedValueOnce(new Error("private query detail"));
  mount(<RitualHistory />);
  await screen.findByRole("region", { name: "History unavailable" });
  expect(toast.error).toHaveBeenCalledWith("Couldn’t load ritual history.", expect.any(Object));
  expect(screen.queryByText("Couldn’t load ritual history.")).not.toBeInTheDocument();
  expect(screen.queryByText(/No rituals|No ritual history/)).not.toBeInTheDocument();
  expect(screen.queryByText(/private query detail/)).not.toBeInTheDocument();
  mocks.history.mockResolvedValueOnce({ items: [occurrence], nextCursor: null });
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await screen.findByRole("button", { name: /Morning Ritual/ });
  expect(screen.queryByRole("region", { name: "History unavailable" })).not.toBeInTheDocument();
  expect(mocks.history.mock.calls[0]?.[1]).toEqual(mocks.history.mock.lastCall?.[1]);
});

it("retains cached records and pagination after a refresh failure", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RitualHistory />
    </QueryClientProvider>,
  );
  await screen.findByRole("button", { name: /Morning Ritual/ });
  mocks.history.mockRejectedValue(new Error("network failure"));
  await client.invalidateQueries({ queryKey: ["ritual-history"] });
  await screen.findByText("Last available results");
  expect(screen.getByRole("button", { name: /Morning Ritual/ })).toBeEnabled();
  expect(screen.getByRole("combobox", { name: "Rows per page" })).toBeEnabled();
  expect(screen.queryByText(/No rituals|No ritual history/)).not.toBeInTheDocument();
  mocks.history.mockResolvedValue({ items: [occurrence], nextCursor: null });
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(screen.queryByText("Last available results")).not.toBeInTheDocument());
});

it("restores the full toolbar after Show All and keeps a direct path back to the current week", async () => {
  mocks.history.mockImplementation((_cursor, filters) =>
    Promise.resolve({
      items: filters.search ? [] : [occurrence],
      total: filters.search ? 0 : 1,
      nextCursor: null,
    }),
  );
  mount(<RitualHistory />);
  await screen.findByRole("button", { name: /Morning Ritual/ });
  fireEvent.change(screen.getByRole("textbox", { name: "Search history" }), {
    target: { value: "no match" },
  });
  await screen.findByText("No matching rituals");
  fireEvent.click(screen.getByRole("button", { name: "Show all history" }));
  await screen.findByRole("button", { name: /Morning Ritual/ });
  expect(screen.getByRole("button", { name: /^Sort:/ })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Table actions" })).toBeEnabled();
  expect(screen.getByRole("combobox", { name: "Rows per page" })).toBeEnabled();
  expect(screen.getByRole("textbox", { name: "Search history" })).toHaveValue("");
  expect(screen.getByText("All time")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "This week" }));
  await screen.findByRole("button", { name: "Previous week" });
  expect(mocks.history.mock.lastCall?.[1]).toHaveProperty("dateFrom");
});
