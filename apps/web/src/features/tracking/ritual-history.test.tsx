// @vitest-environment jsdom
import type { RitualOccurrence } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";
import { SettingsFeedbackContext } from "../../lib/settings-feedback.js";
import { RitualDataAction } from "./ritual-data-action.js";
import { RitualHistory } from "./ritual-history.js";
import { RitualLocal } from "./ritual-local.js";

const mocks = vi.hoisted(() => ({
  profile: vi.fn(),
  history: vi.fn(),
  export: vi.fn(),
  remove: vi.fn(),
  invoke: vi.fn(),
}));
vi.mock("../../api.js", () => ({
  api: {
    getMe: mocks.profile,
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
  localStorage.clear();
  mocks.profile.mockResolvedValue({ planningTimezone: "America/New_York" });
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
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it.each([
  ["2026-10-26T00:15:00Z", "week", "2026-10-19", "2026-10-25"],
  ["2026-11-01T00:15:00Z", "month", "2026-10-01", "2026-10-31"],
])("waits for the planning timezone at %s before requesting %s history", async (now, period, dateFrom, dateTo) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(now));
  let resolveProfile!: (profile: { planningTimezone: string }) => void;
  mocks.profile.mockReturnValue(
    new Promise((resolve) => {
      resolveProfile = resolve;
    }),
  );
  mount(<RitualHistory />);
  if (period === "month") {
    fireEvent.click(screen.getByRole("button", { name: "Filters" }));
    fireEvent.keyDown(screen.getByRole("button", { name: /^Period:/ }), { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("menuitemradio", { name: "This Month" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
  }
  expect(screen.getByRole("status", { name: "Loading ritual history" })).toBeInTheDocument();
  expect(mocks.history).not.toHaveBeenCalled();
  await act(async () => resolveProfile({ planningTimezone: "America/New_York" }));
  await screen.findByRole("button", { name: /Morning Ritual/ });
  expect(mocks.history).toHaveBeenCalledExactlyOnceWith(undefined, {
    dateFrom,
    dateTo,
    sort: "newest",
    limit: 10,
  });
});

it("retries the missing planning profile before querying history", async () => {
  mocks.profile.mockRejectedValueOnce(new Error("private profile detail"));
  mount(<RitualHistory />);
  await screen.findByRole("region", { name: "History unavailable" });
  expect(mocks.history).not.toHaveBeenCalled();
  expect(screen.queryByRole("status", { name: "Loading ritual history" })).not.toBeInTheDocument();
  expect(toast.error).toHaveBeenCalledWith("Couldn’t load ritual history.", expect.any(Object));
  expect(screen.queryByText("Couldn’t load ritual history.")).not.toBeInTheDocument();
  expect(
    screen.queryByText(/private profile detail|No rituals|No ritual history/),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await screen.findByRole("button", { name: /Morning Ritual/ });
  expect(mocks.profile).toHaveBeenCalledTimes(2);
  expect(mocks.history).toHaveBeenCalledTimes(1);
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
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-26T00:15:00Z"));
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
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith("Couldn’t load ritual history.", expect.any(Object)),
  );
  expect(screen.queryByText("Last available results")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Morning Ritual/ })).toBeEnabled();
  expect(screen.getByRole("combobox", { name: "Rows per page" })).toBeEnabled();
  expect(screen.queryByText(/No rituals|No ritual history/)).not.toBeInTheDocument();
  mocks.history.mockResolvedValue({ items: [occurrence], nextCursor: null });
  const attempts = mocks.history.mock.calls.length;
  const action = vi.mocked(toast.error).mock.calls.at(-1)?.[1]?.action;
  if (!action || typeof action !== "object" || !("onClick" in action))
    throw new Error("Missing toast retry");
  render(
    <button type="button" onClick={action.onClick}>
      Retry history
    </button>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Retry history" }));
  await waitFor(() => expect(mocks.history).toHaveBeenCalledTimes(attempts + 1));
  await waitFor(() => expect(toast.dismiss).toHaveBeenCalled());
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

it("exposes advanced columns and exports submitted answers without leaking draft answer text", async () => {
  const user = (await import("@testing-library/user-event")).default.setup();
  localStorage.removeItem("nohmi:data-view:ritual-history");
  mocks.history.mockResolvedValue({
    items: [
      {
        ...occurrence,
        definition: {
          ...occurrence.definition,
          kind: "night",
          steps: [
            { id: "journal", label: "Reflection", kind: "short_text" },
            { id: "draft", label: "Private note", kind: "short_text", optional: true },
          ],
        },
        responses: [
          {
            id: "one",
            stepId: "journal",
            value: "A useful reflection",
            submitted: true,
            recordedAt: occurrence.dueAt,
          },
          {
            id: "two",
            stepId: "draft",
            value: "Unsubmitted private draft",
            submitted: false,
            recordedAt: occurrence.dueAt,
          },
        ],
        actions: [
          {
            id: "snooze",
            kind: "snooze_confirmed",
            outcome: "applied",
            recordedAt: occurrence.dueAt,
          },
        ],
      },
    ],
    nextCursor: null,
  });
  mount(<RitualHistory />);
  await screen.findByRole("button", { name: /Evening Ritual/ });
  await user.click(screen.getByRole("button", { name: "Table actions" }));
  await user.click(screen.getByRole("menuitem", { name: "Table Options" }));
  for (const label of ["Written Answer", "Outcome", "Scheduled Time", "Time Zone"]) {
    await user.click(screen.getByRole("checkbox", { name: label }));
  }
  await user.click(screen.getByRole("button", { name: "Done" }));
  expect(screen.getByText("Reflection: A useful reflection")).toBeInTheDocument();
  expect(screen.getByText("America/New_York")).toBeInTheDocument();
  expect(screen.getByText(/Snoozed 1 time/)).toBeInTheDocument();
  expect(screen.queryByText("Unsubmitted private draft")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Table actions" }));
  await user.click(screen.getByRole("menuitem", { name: "Export Page" }));
  const blob = vi.mocked(URL.createObjectURL).mock.calls[0]![0] as Blob;
  const csv = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob);
  });
  expect(csv).toContain('"Written Answer"');
  expect(csv).toContain('"Time Zone"');
  expect(csv).toContain("A useful reflection");
  expect(csv).not.toContain("Unsubmitted private draft");
});

it("distinguishes saved, empty, unchecked, removed-step and rejected-action evidence", async () => {
  const row = {
    ...occurrence,
    status: "skipped",
    definition: {
      ...occurrence.definition,
      steps: [
        { id: "done", kind: "checkbox", label: "Water" },
        { id: "unchecked", kind: "checkbox", label: "Stretch", optional: true },
        { id: "empty", kind: "short_text", label: "Reflection", optional: true },
      ],
    },
    responses: [
      {
        id: "done",
        stepId: "done",
        value: true,
        submitted: true,
        recordedAt: "2026-09-29T10:00:00Z",
      },
      {
        id: "unchecked",
        stepId: "unchecked",
        value: false,
        submitted: false,
        recordedAt: "2026-09-29T10:01:00Z",
      },
      {
        id: "empty",
        stepId: "empty",
        value: "",
        submitted: true,
        recordedAt: "2026-09-29T10:02:00Z",
      },
      {
        id: "removed",
        stepId: "removed",
        value: "Past answer",
        submitted: true,
        recordedAt: "2026-09-29T10:03:00Z",
      },
    ],
    actions: [
      {
        id: "rejected",
        kind: "skip_applied",
        outcome: "rejected",
        recordedAt: "2026-09-29T10:04:00Z",
      },
      {
        id: "applied",
        kind: "skip_applied",
        outcome: "applied",
        recordedAt: "2026-09-29T10:05:00Z",
      },
    ],
  };
  mocks.history.mockResolvedValue({ items: [row], nextCursor: null });
  mount(<RitualHistory />);
  fireEvent.click(await screen.findByRole("button", { name: /Morning Ritual/ }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText("Done", { exact: true })).toBeVisible();
  expect(within(dialog).getByText("Not done (draft)")).toBeVisible();
  expect(within(dialog).getByText("No answer", { exact: true })).toBeVisible();
  fireEvent.click(within(dialog).getByRole("button", { name: "Interaction Log" }));
  expect(within(dialog).getByText("Unchecked (draft)", { exact: false })).toBeVisible();
  expect(within(dialog).getByText("Removed step:")).toBeVisible();
  expect(within(dialog).getByText("Not applied", { exact: false })).toBeVisible();
  expect(within(dialog).getByText("Recorded", { exact: false })).toBeVisible();
});

it("explains configuration cancellation in the outcome column and filters it server-side", async () => {
  mocks.history.mockResolvedValue({
    items: [{ ...occurrence, status: "cancelled_configuration", responses: [], actions: [] }],
    total: 1,
    nextCursor: null,
  });
  mount(<RitualHistory />);
  await screen.findByRole("button", { name: /Morning Ritual/ });
  fireEvent.keyDown(screen.getByRole("button", { name: "Table actions" }), { key: "ArrowDown" });
  fireEvent.click(screen.getByRole("menuitem", { name: "Table Options" }));
  const written = screen.getByRole("checkbox", { name: "Written Answer" });
  if (written.getAttribute("data-state") !== "checked") fireEvent.click(written);
  const outcome = screen.getByRole("checkbox", { name: "Outcome" });
  if (outcome.getAttribute("data-state") !== "checked") fireEvent.click(outcome);
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(screen.getByText("Settings changed before this ritual finished")).toBeVisible();
  expect(screen.getByText("No submitted written answer")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Filters" }));
  fireEvent.keyDown(screen.getByRole("button", { name: /^Status:/ }), { key: "ArrowDown" });
  fireEvent.click(screen.getByRole("menuitemradio", { name: "Cancelled" }));
  await waitFor(() =>
    expect(mocks.history).toHaveBeenLastCalledWith(
      undefined,
      expect.objectContaining({ status: "cancelled_configuration" }),
    ),
  );
  fireEvent.click(
    within(screen.getByRole("dialog", { name: "Filters" })).getByRole("button", { name: "Done" }),
  );
  fireEvent.click(await screen.findByRole("button", { name: /Morning Ritual/ }));
  expect(
    within(screen.getByRole("dialog")).queryByRole("button", { name: "Interaction Log" }),
  ).not.toBeInTheDocument();
  expect(within(screen.getByRole("dialog")).getAllByText("Not done")).toHaveLength(2);
});

it("recovers a now-empty cursor page without trapping the user beyond the last available record", async () => {
  mocks.history.mockImplementation((cursor) =>
    Promise.resolve(
      cursor ? { items: [], nextCursor: null } : { items: [occurrence], nextCursor: "next" },
    ),
  );
  mount(<RitualHistory />);
  await screen.findByRole("button", { name: /Morning Ritual/ });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  fireEvent.click(await screen.findByRole("button", { name: "Previous page" }));
  expect(await screen.findByRole("button", { name: /Morning Ritual/ })).toBeVisible();
  expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
});

it("applies month navigation and page-size changes through server criteria with a reset cursor", async () => {
  mocks.history.mockResolvedValue({ items: [occurrence], nextCursor: "next" });
  mount(<RitualHistory />);
  await screen.findByRole("button", { name: /Morning Ritual/ });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await waitFor(() => expect(mocks.history).toHaveBeenLastCalledWith("next", expect.anything()));
  fireEvent.click(screen.getByRole("button", { name: "Filters" }));
  fireEvent.keyDown(screen.getByRole("button", { name: /^Period:/ }), { key: "ArrowDown" });
  fireEvent.click(screen.getByRole("menuitemradio", { name: "This Month" }));
  fireEvent.click(
    within(screen.getByRole("dialog", { name: "Filters" })).getByRole("button", { name: "Done" }),
  );
  await waitFor(() =>
    expect(mocks.history).toHaveBeenLastCalledWith(
      undefined,
      expect.objectContaining({ dateFrom: expect.stringMatching(/-01$/) }),
    ),
  );
  const initial = mocks.history.mock.calls.at(-1)?.[1].dateFrom;
  fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
  await waitFor(() => expect(mocks.history.mock.calls.at(-1)?.[1].dateFrom).not.toBe(initial));
  fireEvent.click(screen.getByRole("button", { name: "Next month" }));
  await waitFor(() => expect(mocks.history.mock.calls.at(-1)?.[1].dateFrom).toBe(initial));
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await waitFor(() => expect(mocks.history).toHaveBeenLastCalledWith("next", expect.anything()));
  fireEvent.change(await screen.findByRole("combobox", { name: "Rows per page" }), {
    target: { value: "25" },
  });
  await waitFor(() =>
    expect(mocks.history).toHaveBeenLastCalledWith(
      undefined,
      expect.objectContaining({ limit: 25 }),
    ),
  );
});

it("summarizes multiple accepted snoozes while excluding a cancelled snooze", async () => {
  mocks.history.mockResolvedValue({
    items: [
      {
        ...occurrence,
        actions: [
          { id: "one", kind: "snooze_confirmed", outcome: "applied", recordedAt: occurrence.dueAt },
          { id: "two", kind: "snooze_confirmed", outcome: "applied", recordedAt: occurrence.dueAt },
          {
            id: "three",
            kind: "snooze_cancelled",
            outcome: "applied",
            recordedAt: occurrence.dueAt,
          },
        ],
      },
    ],
    nextCursor: null,
  });
  localStorage.setItem(
    "nohmi:data-view:ritual-history:account",
    JSON.stringify({ order: ["ritual", "outcome"], hidden: [] }),
  );
  mount(<RitualHistory />);
  expect(await screen.findByText(/Snoozed 2 times/)).toBeVisible();
});
