// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RitualHistoryScreen, RitualsSettingsScreen } from "./settings";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
vi.mock("@tanstack/react-query", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/apps/web/package.json`)("@tanstack/react-query");
});
const h = vi.hoisted(() => ({
  owner: "owner",
  history: vi.fn(),
  definitions: vi.fn(),
  exportData: vi.fn(),
  remove: vi.fn(),
  share: vi.fn(),
  write: vi.fn(),
  deleteFile: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  buttons: [] as { text: string; onPress?: () => void }[],
}));
vi.mock("../auth/context", () => ({
  useOptionalAuth: () => null,
  useAuth: () => ({
    state: { user: { id: h.owner, planningTimezone: "UTC" } },
    session: {
      epoch: () => 1,
      api: () => ({
        listRitualHistory: h.history,
        listRituals: h.definitions,
        exportRitualData: h.exportData,
        deleteRitualData: h.remove,
      }),
    },
  }),
}));
vi.mock("expo-router", () => ({
  router: { back: vi.fn(), push: vi.fn() },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({}),
  usePreventRemove: () => () => {},
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => "11111111-1111-4111-8111-111111111111" }));
vi.mock("expo-secure-store", () => ({ getItemAsync: async () => "device" }));
vi.mock("expo-file-system", () => ({
  Paths: { cache: "cache" },
  File: class {
    uri = "file:///cache/rituals.json";
    write = h.write;
    delete = h.deleteFile;
  },
}));
vi.mock("react-native", async () => ({
  ...(await import("../../../test/native")),
  Switch: () => null,
  Alert: {
    alert: (_title: string, _message: string, buttons: typeof h.buttons) => {
      h.buttons = buttons;
    },
  },
  Share: { share: h.share, sharedAction: "shared", dismissedAction: "dismissed" },
}));
vi.mock("sonner-native", () => ({
  toast: Object.assign(vi.fn(), {
    loading: () => "toast",
    success: h.success,
    error: h.error,
    dismiss: vi.fn(),
  }),
}));
vi.mock("../../theme", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../theme")>()),
  useTheme: () => ({ ink: "black", secondary: "gray", information: "blue", surface: "white" }),
}));
vi.mock("../../components/screen", () => ({
  Screen: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../components/editor-header", () => ({ editorDismissOptions: () => ({}) }));
vi.mock("../../components/icons", () => ({ Icon: () => null }));
vi.mock("../../components/record-row", () => ({
  RecordRow: ({
    title,
    subtitle,
    onPress,
  }: {
    title: string;
    subtitle: string;
    onPress: () => void;
  }) => (
    <button type="button" onClick={onPress}>
      {title} {subtitle}
    </button>
  ),
}));
vi.mock("../../components/forms/form-save", () => ({ FormSave: () => null }));
vi.mock("../../components/forms/enum-choice", () => ({
  EnumChoice: ({
    options,
    onChange,
  }: {
    options: { label: string; value: string }[];
    onChange: (value: string) => void;
  }) => (
    <div>
      {options.map((o) => (
        <button type="button" key={o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  ),
}));
const occurrence = (id: string) => ({
  id,
  definition: {
    title: `Ritual ${id}`,
    steps: [{ id: "step", label: "Reflect", kind: "checkbox" }],
  },
  scheduledLocalDate: "2026-11-10",
  status: "completed",
  timeZone: "UTC",
  definitionRevision: 2,
  dueAt: "due",
  expiresAt: "expiry",
  settledAt: "settled",
  snoozedUntil: null,
  responses: [
    {
      id: "response",
      stepId: "step",
      value: "Rested",
      submitted: false,
      observedAt: "observed",
      recordedAt: "recorded",
    },
  ],
  actions: [
    {
      id: "action",
      kind: "complete_applied",
      outcome: "applied",
      count: 1,
      observedAt: "observed",
      recordedAt: "recorded",
    },
  ],
});
let client: QueryClient;
const wrap = (node: React.ReactNode) => (
  <QueryClientProvider client={client}>{node}</QueryClientProvider>
);
beforeEach(() => {
  vi.clearAllMocks();
  h.owner = "owner";
  h.buttons = [];
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  h.definitions.mockResolvedValue({ rituals: [] });
  h.history.mockImplementation(async (cursor?: string) => ({
    items: [occurrence(cursor ? "second" : "first")],
    nextCursor: cursor ? null : "next-page",
  }));
  h.exportData.mockResolvedValue({ definitions: [], occurrences: [] });
  h.share.mockResolvedValue({ action: "shared" });
  h.remove.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  client.clear();
});
it("loads actual next cursor, retains first page and shows immutable response/action detail", async () => {
  render(wrap(<RitualHistoryScreen />));
  fireEvent.click(await screen.findByText("Load more history"));
  await screen.findByText(/Ritual second/);
  expect(h.history).toHaveBeenCalledWith("next-page", expect.objectContaining({ sort: "newest" }));
  expect(screen.getByText(/Ritual first/)).toBeVisible();
  expect(screen.queryByText("Load more history")).toBeNull();
  fireEvent.click(screen.getByText(/Ritual second/));
  expect(screen.getByText(/Rested · Draft · observed observed · recorded recorded/)).toBeVisible();
  expect(screen.getByText(/complete_applied · applied · count/)).toBeVisible();
});
it("sends search and date filters to the server instead of filtering loaded pages", async () => {
  render(wrap(<RitualHistoryScreen />));
  await screen.findByText(/Ritual first/);
  fireEvent.change(screen.getByLabelText("Search history"), { target: { value: "reflect" } });
  await waitFor(() =>
    expect(h.history).toHaveBeenLastCalledWith(
      undefined,
      expect.objectContaining({ search: "reflect" }),
    ),
  );
  fireEvent.change(screen.getByLabelText("From date"), { target: { value: "2026-11-01" } });
  await waitFor(() =>
    expect(h.history).toHaveBeenLastCalledWith(
      undefined,
      expect.objectContaining({ dateFrom: "2026-11-01" }),
    ),
  );
});
it("isolates history on owner switch and does not display the old owner's cached results", async () => {
  const view = render(wrap(<RitualHistoryScreen />));
  await screen.findByText(/Ritual first/);
  fireEvent.click(screen.getByText(/Ritual first/));
  expect(screen.getByText(/Rested · Draft/)).toBeVisible();
  h.owner = "second-owner";
  h.history.mockResolvedValue({ items: [], nextCursor: null });
  view.rerender(wrap(<RitualHistoryScreen />));
  await screen.findByText("No matching history.");
  expect(screen.queryByText(/Ritual first/)).toBeNull();
  expect(
    client
      .getQueryCache()
      .getAll()
      .filter((q) => q.queryKey[1] === "second-owner"),
  ).toHaveLength(1);
});
it("exports a real JSON file URI, cleans the cache and does not claim success on cancellation", async () => {
  render(wrap(<RitualsSettingsScreen />));
  fireEvent.click(screen.getByText("Export ritual data"));
  await waitFor(() =>
    expect(h.share).toHaveBeenCalledWith({
      title: "nohmi ritual data",
      url: "file:///cache/rituals.json",
    }),
  );
  expect(h.write).toHaveBeenCalledWith(
    JSON.stringify({ definitions: [], occurrences: [] }, null, 2),
  );
  await waitFor(() => expect(h.deleteFile).toHaveBeenCalledOnce());
  expect(h.success).toHaveBeenCalledWith("Export shared");
  h.share.mockResolvedValue({ action: "dismissed" });
  h.success.mockClear();
  fireEvent.click(screen.getByText("Export ritual data"));
  await waitFor(() => expect(h.deleteFile).toHaveBeenCalledTimes(2));
  expect(h.success).not.toHaveBeenCalled();
});
it("requires exact ritual name and irreversible confirmation before permanent deletion", async () => {
  render(wrap(<RitualsSettingsScreen />));
  fireEvent.click(screen.getByText("Delete Evening data"));
  expect(screen.getByRole("button", { name: "Permanently delete data" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Ritual name"), { target: { value: "Evening" } });
  fireEvent.click(screen.getByText("Permanently delete data"));
  expect(h.remove).not.toHaveBeenCalled();
  await act(async () => h.buttons.find((b) => b.text === "Delete")?.onPress?.());
  await waitFor(() => expect(h.remove).toHaveBeenCalledWith("night"));
  expect(h.success).toHaveBeenCalledWith("Ritual data deleted", { id: "toast" });
});

it("reports failed export and deletion through Sonner and retains named deletion draft", async () => {
  h.exportData.mockRejectedValueOnce(new Error("Export unavailable"));
  render(wrap(<RitualsSettingsScreen />));
  fireEvent.click(screen.getByText("Export ritual data"));
  await waitFor(() => expect(h.error).toHaveBeenCalledWith("Export unavailable", { id: "toast" }));
  expect(h.share).not.toHaveBeenCalled();
  expect(screen.queryByText("Export unavailable")).toBeNull();
  h.remove.mockRejectedValueOnce(new Error("Deletion unavailable"));
  fireEvent.click(screen.getByText("Delete Morning data"));
  fireEvent.change(screen.getByLabelText("Ritual name"), { target: { value: "Morning" } });
  fireEvent.click(screen.getByText("Permanently delete data"));
  await act(async () => h.buttons.find((b) => b.text === "Delete")?.onPress?.());
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith("Deletion unavailable", { id: "toast" }),
  );
  expect(screen.getByLabelText("Ritual name")).toHaveValue("Morning");
  expect(h.success).not.toHaveBeenCalled();
});
