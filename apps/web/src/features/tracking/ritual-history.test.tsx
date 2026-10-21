// @vitest-environment jsdom
import type { RitualOccurrence } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  const rows = await screen.findAllByRole("button", { name: /Morning Ritual.*steps done/ });
  expect(rows).toHaveLength(2);
  expect(mocks.history).toHaveBeenCalledWith(
    undefined,
    expect.objectContaining({ dateFrom: expect.any(String), dateTo: expect.any(String) }),
  );
  expect(mocks.history).toHaveBeenCalledWith("2026-09-29T10:00:00Z", expect.anything());
  fireEvent.click(rows[0]!);
  expect(screen.getByText(/^Due /)).toHaveTextContent(
    new Date(occurrence.dueAt).toLocaleString(undefined, {
      timeZone: occurrence.timeZone,
      timeZoneName: "short",
    }),
  );
  expect(screen.getByText(/Teeth: Done/)).toBeInTheDocument();
  expect(screen.getByText(/Teeth: Unchecked/)).toBeInTheDocument();
  expect(screen.getByText(/Private draft/)).toHaveTextContent("(draft)");
  expect(screen.getByText(/snooze pressed/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  fireEvent.keyDown(screen.getByRole("button", { name: /^Ritual:/ }), { key: "ArrowDown" });
  fireEvent.click(screen.getByRole("menuitemradio", { name: /^Morning$/ }));
  await waitFor(() =>
    expect(mocks.history).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ kind: "morning" }),
    ),
  );
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
  await screen.findByRole("button", { name: /Morning Ritual.*steps done/ });
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
  expect(await screen.findByRole("status")).toHaveTextContent("Couldn’t load ritual history");
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
  const rows = await screen.findAllByRole("button", { name: /Morning Ritual.*steps done/ });
  const expected = ["Reminder scheduled", "Not done", "Reminder waiting to sync"];
  const detailTexts: string[] = [];
  for (const row of rows) {
    fireEvent.click(row);
    detailTexts.push(screen.getByRole("dialog").textContent ?? "");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
  }
  for (const text of expected)
    expect(detailTexts.some((value) => value.includes(`Stretch: Optional · ${text}`))).toBe(true);
});

it("searches and sorts all cursor pages before paginating ten flat rows", async () => {
  const items = Array.from({ length: 12 }, (_, index) => ({
    ...occurrence,
    id: `row-${index}`,
    dueAt: `2026-10-${String(index + 1).padStart(2, "0")}T10:00:00Z`,
    scheduledLocalDate: `2026-10-${String(index + 1).padStart(2, "0")}`,
    definition: { ...occurrence.definition, title: index === 0 ? "Rare answer" : "Good morning" },
  }));
  mocks.history.mockImplementation((cursor) =>
    Promise.resolve({
      items: cursor ? items.slice(6) : items.slice(0, 6),
      nextCursor: cursor ? null : "next",
    }),
  );
  mount(<RitualHistory />);
  expect(await screen.findAllByRole("button", { name: /Morning Ritual.*steps done/ })).toHaveLength(
    10,
  );
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getAllByRole("button", { name: /Morning Ritual.*steps done/ })).toHaveLength(2);
  fireEvent.change(screen.getByRole("textbox", { name: "Search history" }), {
    target: { value: "Rare answer" },
  });
  expect(screen.getAllByRole("button", { name: /Morning Ritual.*steps done/ })).toHaveLength(1);
  expect(screen.getByText("1–1 of 1 rituals")).toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: "Search history" }), {
    target: { value: "" },
  });
  fireEvent.keyDown(screen.getByRole("button", { name: /^Sort:/ }), { key: "ArrowDown" });
  fireEvent.click(screen.getByRole("menuitemradio", { name: "Oldest First" }));
  expect(
    screen.getAllByRole("button", { name: /Morning Ritual.*steps done/ })[0],
  ).toHaveTextContent("Thu, Oct 1");
  fireEvent.click(screen.getByRole("button", { name: "Previous week" }));
  await waitFor(() =>
    expect(new Set(mocks.history.mock.calls.map((call) => call[1].dateFrom)).size).toBe(2),
  );
});
