// @vitest-environment jsdom
import type { RitualOccurrence } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    listRitualHistory: mocks.history,
    exportRitualData: mocks.export,
    deleteRitualData: mocks.remove,
  },
  errorMessage: (e: Error) => e.message,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
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
  mount(<RitualHistory />);
  expect(await screen.findByText(/Morning ritual · 2026-09-29 · completed/)).toBeInTheDocument();
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
  fireEvent.change(screen.getByLabelText("Ritual"), { target: { value: "morning" } });
  fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-09-01" } });
  fireEvent.change(screen.getByLabelText("Through"), { target: { value: "2026-09-30" } });
  await waitFor(() =>
    expect(mocks.history).toHaveBeenLastCalledWith(undefined, {
      kind: "morning",
      dateFrom: "2026-09-01",
      dateTo: "2026-09-30",
    }),
  );
  fireEvent.click(await screen.findByRole("button", { name: "More history" }));
  expect(await screen.findByText(/Morning ritual · 2026-09-28/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Export rituals" }));
  await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob)));
  expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
});
it("requires explicit deletion and keeps failure visible for retry", async () => {
  mount(<RitualHistory />);
  await screen.findByText(/Morning ritual · 2026-09-29/);
  fireEvent.click(screen.getByRole("button", { name: "Delete morning data" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(mocks.remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Delete evening data" }));
  mocks.remove.mockRejectedValueOnce(new Error("Deletion unavailable"));
  fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
  expect(await screen.findByText(/Couldn’t delete ritual history/)).toBeInTheDocument();
  mocks.history.mockResolvedValue({ items: [], nextCursor: null });
  fireEvent.click(screen.getByRole("button", { name: "Delete evening data" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
  expect(await screen.findByText("Your ritual history will appear here.")).toBeInTheDocument();
  expect(screen.queryByText(/Couldn’t delete ritual history/)).not.toBeInTheDocument();
  expect(mocks.remove).toHaveBeenLastCalledWith("night");
  mocks.export.mockRejectedValueOnce(new Error("Export unavailable"));
  fireEvent.click(screen.getByRole("button", { name: "Export rituals" }));
  expect(await screen.findByText(/Couldn’t export ritual history/)).toBeInTheDocument();
  mocks.export.mockResolvedValue({ occurrences: [] });
  fireEvent.click(screen.getByRole("button", { name: "Export rituals" }));
  await waitFor(() =>
    expect(screen.queryByText(/Couldn’t export ritual history/)).not.toBeInTheDocument(),
  );
});
it("reports unavailable account history", async () => {
  mocks.history.mockRejectedValue(new Error("History unavailable"));
  mount(<RitualHistory />);
  expect(await screen.findByRole("status")).toHaveTextContent("Couldn’t load ritual history");
});
it("exports pending native evidence and only discards after explicit confirmation", async () => {
  mocks.invoke.mockResolvedValue({
    enabled: true,
    queue: [{ value: "Unsynced draft" }],
    localHistory: [],
  });
  mount(<RitualLocal />);
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
  expect(await screen.findByText(/update automatic rituals/)).toBeInTheDocument();
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
