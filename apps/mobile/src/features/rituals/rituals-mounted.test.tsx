// @vitest-environment jsdom

import { ApiClientError } from "@personal-os/api-client";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usePageRefresh } from "../../components/page-refresh";
import { MobileDataProvider } from "../tasks/data";
import { RitualEditorScreen, RitualHistoryScreen, RitualsSettingsScreen } from "./settings";

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
  timezone: "UTC" as string | undefined,
  rowCallbacks: {} as Record<string, () => void>,
  push: vi.fn(),
  back: vi.fn(),
  params: { kind: "morning" },
  close: undefined as undefined | (() => void),
  history: vi.fn(),
  definitions: vi.fn(),
  exportData: vi.fn(),
  remove: vi.fn(),
  share: vi.fn(),
  write: vi.fn(),
  deleteFile: vi.fn(),
  success: vi.fn(),
  loading: vi.fn(() => "ritual-refresh"),
  error: vi.fn(),
  buttons: [] as { text: string; onPress?: () => void }[],
}));
vi.mock("../auth/context", () => ({
  useOptionalAuth: () => null,
  useAuth: () => ({
    state: { user: { id: h.owner, planningTimezone: h.timezone } },
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
  router: { back: h.back, push: h.push },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => h.params,
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
    loading: h.loading,
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
  Screen: ({
    children,
    onRefresh,
  }: {
    children: React.ReactNode;
    onRefresh?: () => Promise<unknown>;
  }) => {
    const refresh = usePageRefresh([], onRefresh);
    return (
      <div>
        {children}
        {onRefresh && (
          <button
            type="button"
            aria-busy={refresh.refreshing}
            onClick={() => void refresh.refresh()}
          >
            Refresh records
          </button>
        )}
      </div>
    );
  },
}));
vi.mock("../../components/editor-header", () => ({
  editorDismissOptions: ({ onPress }: { onPress: () => void }) => {
    h.close = onPress;
    return {};
  },
}));
vi.mock("../../components/icons", () => ({ Icon: () => null }));
vi.mock("../../components/record-row", () => ({
  RecordRow: ({
    title,
    subtitle,
    value,
    onPress,
  }: {
    title: string;
    subtitle: string;
    value?: string;
    onPress: () => void;
  }) => {
    h.rowCallbacks[title] = onPress;
    return (
      <button type="button" onClick={onPress}>
        {title} {subtitle} {value}
      </button>
    );
  },
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

const definition = {
  id: "morning",
  kind: "morning",
  title: "Morning",
  time: "08:00",
  enabled: true,
  revision: 1,
  timeZone: "UTC",
  steps: [{ id: "step", kind: "checkbox", label: "Reflect" }],
};
const wrap = (node: React.ReactNode) => (
  <MobileDataProvider key={h.owner}>{node}</MobileDataProvider>
);
beforeEach(() => {
  vi.clearAllMocks();
  h.rowCallbacks = {};
  h.owner = "owner";
  h.timezone = "UTC";
  h.params = { kind: "morning" };
  h.definitions.mockResolvedValue({ rituals: [definition] });
  h.history.mockResolvedValue({ items: [], nextCursor: null });
});
afterEach(cleanup);
it("retries failed ritual reads and navigates to configured/unconfigured kinds or history", async () => {
  h.definitions.mockRejectedValueOnce(new Error("Offline"));
  render(wrap(<RitualsSettingsScreen />));
  fireEvent.click(await screen.findByText("Unable to load. Retry"));
  const morning = await screen.findByRole("button", { name: /^Morning/ });
  // Ritual rows and record rows each live in their own titled group.
  const ritualGroup = morning.closest('[data-testid="form-group"]');
  const recordGroup = screen.getByText("History").closest('[data-testid="form-group"]');
  expect(ritualGroup).not.toBeNull();
  expect(recordGroup).not.toBeNull();
  expect(ritualGroup).not.toBe(recordGroup);
  expect(ritualGroup?.contains(screen.getByRole("button", { name: /^Evening/ }))).toBe(true);
  expect(screen.getByRole("heading", { name: "Rituals" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "Records" })).toBeVisible();
  fireEvent.click(morning);
  expect(h.push).toHaveBeenLastCalledWith({
    pathname: "/settings/rituals/edit",
    params: { kind: "morning" },
  });
  fireEvent.click(screen.getByRole("button", { name: /^Evening/ }));
  expect(h.push).toHaveBeenLastCalledWith({
    pathname: "/settings/rituals/edit",
    params: { kind: "night" },
  });
  fireEvent.click(screen.getByText("History"));
  expect(h.push).toHaveBeenLastCalledWith("/settings/rituals/history");
  expect(h.definitions).toHaveBeenCalledTimes(2);
  expect(h.error).toHaveBeenCalled();
});
it("refreshes definitions from the authority and allows cancelling named deletion without mutation", async () => {
  render(wrap(<RitualsSettingsScreen />));
  await screen.findByRole("button", { name: /^Morning/ });
  fireEvent.click(screen.getByText("Refresh records"));
  await waitFor(() => expect(h.definitions).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Refresh records" })).toHaveAttribute(
      "aria-busy",
      "false",
    ),
  );
  expect(h.success).not.toHaveBeenCalled();
  expect(h.loading).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Delete Evening data"));
  fireEvent.change(screen.getByLabelText("Ritual name"), { target: { value: "Evening" } });
  fireEvent.click(screen.getByText("Cancel deletion"));
  expect(screen.queryByLabelText("Ritual name")).toBeNull();
  expect(h.remove).not.toHaveBeenCalled();
});
it("loads an editor only after retry succeeds and closes the untouched reviewed form", async () => {
  h.definitions.mockRejectedValueOnce(new Error("Offline"));
  render(wrap(<RitualEditorScreen />));
  fireEvent.click(await screen.findByText("Unable to load. Retry"));
  await screen.findByLabelText("Title");
  expect(screen.getByLabelText("Title")).toHaveValue("Morning");
  act(() => h.close?.());
  expect(h.back).toHaveBeenCalledOnce();
});
it("history retries failed reads and preserves server filtering and refresh semantics", async () => {
  h.history.mockRejectedValueOnce(new Error("Offline"));
  render(wrap(<RitualHistoryScreen />));
  fireEvent.click(await screen.findByText("Unable to load. Retry"));
  const empty = await screen.findByText("No matching history.");
  // With no rows there is no History group; the note stands in an untitled group.
  expect(screen.queryByRole("heading", { name: "History" })).toBeNull();
  expect(empty.closest('[data-testid="form-group"]')).not.toBeNull();
  expect(screen.queryByTestId("section-item")).toBeNull();
  expect(screen.getByRole("heading", { name: "Filters" })).toBeVisible();
  fireEvent.click(screen.getByText("Oldest First"));
  await waitFor(() =>
    expect(h.history).toHaveBeenLastCalledWith(
      undefined,
      expect.objectContaining({ sort: "oldest" }),
    ),
  );
  const count = h.history.mock.calls.length;
  fireEvent.click(screen.getByText("Refresh records"));
  await waitFor(() => expect(h.history).toHaveBeenCalledTimes(count + 1));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Refresh records" })).toHaveAttribute(
      "aria-busy",
      "false",
    ),
  );
  expect(h.success).not.toHaveBeenCalled();
  expect(h.loading).not.toHaveBeenCalled();
  act(() => h.close?.());
  expect(h.back).toHaveBeenCalledOnce();
});

it("announces one failed ritual-history refresh without dropping cached history or replaying writes", async () => {
  h.history.mockResolvedValue({
    items: [
      {
        id: "history",
        definition: { title: "Evening record" },
        scheduledLocalDate: "2026-11-10",
        status: "completed",
      },
    ],
    nextCursor: null,
  });
  render(wrap(<RitualHistoryScreen />));
  const occurrence = await screen.findByText(/Evening record/);
  expect(screen.getByRole("heading", { name: "History" })).toBeVisible();
  expect(
    occurrence.closest('[data-testid="section-item"]')?.closest('[data-testid="form-group"]'),
  ).toBeTruthy();
  expect(screen.queryByText("No matching history.")).toBeNull();
  h.history.mockRejectedValueOnce(new Error("History offline"));
  fireEvent.click(screen.getByText("Refresh records"));
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledExactlyOnceWith(
      "Couldn’t confirm the result. Check your connection and refresh before retrying.",
      { id: undefined },
    ),
  );
  expect(h.loading).not.toHaveBeenCalled();
  expect(h.success).not.toHaveBeenCalled();
  expect(screen.getByText(/Evening record/)).toBeVisible();
  expect(screen.queryByText("History offline")).toBeNull();
  expect(h.remove).not.toHaveBeenCalled();
});

const privateOccurrence = {
  id: "private-history",
  definition: { ...definition, title: "Private ritual" },
  scheduledLocalDate: "2026-11-10",
  status: "completed",
  timeZone: "UTC",
  definitionRevision: 1,
  dueAt: "2026-11-10T08:00:00Z",
  expiresAt: "2026-11-10T20:00:00Z",
  settledAt: null,
  snoozedUntil: null,
  responses: [
    {
      id: "response",
      stepId: "step",
      value: "Private reflection answer",
      submitted: true,
      observedAt: "2026-11-10T08:01:00Z",
      recordedAt: "2026-11-10T08:01:00Z",
    },
  ],
  actions: [],
};
it.each([
  401, 403,
])("removes a selected private occurrence immediately after authoritative%s and does not reopen it on retry", async (status) => {
  h.history.mockResolvedValue({ items: [privateOccurrence], nextCursor: null });
  render(wrap(<RitualHistoryScreen />));
  fireEvent.click(await screen.findByText(/Private ritual/));
  expect(screen.getByText(/Private reflection answer/)).toBeVisible();
  h.history.mockRejectedValueOnce(
    new ApiClientError({
      status,
      code: status === 401 ? "unauthorized" : "forbidden",
      message: "Access revoked",
    }),
  );
  fireEvent.click(screen.getByText("Refresh records"));
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledExactlyOnceWith("Access revoked", { id: undefined }),
  );
  expect(screen.queryByText(/Private reflection answer/)).toBeNull();
  expect(screen.queryByText(/Private ritual/)).toBeNull();
  expect(h.history).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByText("Unable to load. Retry"));
  await screen.findByText(/Private ritual/);
  expect(screen.queryByText(/Private reflection answer/)).toBeNull();
  expect(h.history).toHaveBeenCalledTimes(3);
});
it("retains the selected occurrence and private responses after a transient500 refresh failure", async () => {
  h.history.mockResolvedValue({ items: [privateOccurrence], nextCursor: null });
  render(wrap(<RitualHistoryScreen />));
  fireEvent.click(await screen.findByText(/Private ritual/));
  expect(screen.getByText(/Private reflection answer/)).toBeVisible();
  h.history.mockRejectedValueOnce(
    new ApiClientError({ status: 500, code: "internal_error", message: "Temporary failure" }),
  );
  fireEvent.click(screen.getByText("Refresh records"));
  await waitFor(() => expect(h.error).toHaveBeenCalledOnce());
  expect(screen.getByText(/Private reflection answer/)).toBeVisible();
  expect(screen.getByText(/Private ritual/)).toBeVisible();
  expect(h.history).toHaveBeenCalledTimes(2);
  expect(h.loading).not.toHaveBeenCalled();
  expect(h.success).not.toHaveBeenCalled();
});

it("rejects a queued predenial row event after detail cleanup, throughout retry, and after fresh authorized data", async () => {
  h.history.mockResolvedValue({ items: [privateOccurrence], nextCursor: null });
  render(wrap(<RitualHistoryScreen />));
  fireEvent.click(await screen.findByText(/Private ritual/));
  const queued = h.rowCallbacks["Private ritual"];
  if (!queued) throw new Error("Missing native row callback");
  expect(screen.getByText(/Private reflection answer/)).toBeVisible();
  h.history.mockRejectedValueOnce(
    new ApiClientError({ status: 403, code: "forbidden", message: "Access revoked" }),
  );
  fireEvent.click(screen.getByText("Refresh records"));
  await screen.findByText("Unable to load. Retry");
  act(() => queued());
  expect(screen.queryByText(/Private reflection answer|Private ritual/)).toBeNull();
  let resolve: (value: unknown) => void = () => {};
  h.history.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  fireEvent.click(screen.getByText("Unable to load. Retry"));
  await waitFor(() => expect(h.history).toHaveBeenCalledTimes(3));
  act(() => queued());
  expect(screen.queryByText(/Private reflection answer|Private ritual/)).toBeNull();
  await act(async () =>
    resolve({
      items: [{ ...privateOccurrence, definition: { ...definition, title: "Fresh ritual" } }],
      nextCursor: null,
    }),
  );
  await screen.findByText(/Fresh ritual/);
  expect(screen.queryByText(/Private reflection answer/)).toBeNull();
  act(() => queued());
  expect(screen.queryByText(/Private reflection answer|Private ritual/)).toBeNull();
  expect(screen.getByText(/Fresh ritual/)).toBeVisible();
  expect(h.history).toHaveBeenCalledTimes(3);
});

it("filters actual history by ritual/status and renders optional follow-up plus removed-step response provenance", async () => {
  const snapshot = {
    ...privateOccurrence,
    status: "missed",
    definition: {
      ...privateOccurrence.definition,
      title: "Historical check-in",
      steps: [{ id: "step", label: "Optional reflection", kind: "checkbox", optional: true }],
    },
    responses: [
      {
        ...privateOccurrence.responses[0],
        stepId: "removed-step",
        value: "Historical response",
        submitted: false,
      },
    ],
    optionalFollowUp: { dueAt: "2026-11-11T08:00:00Z", stepIds: ["step"] },
  };
  h.history.mockResolvedValue({ items: [snapshot], nextCursor: null });
  render(wrap(<RitualHistoryScreen />));
  await screen.findByText(/Historical check-in/);
  fireEvent.click(screen.getByText("Evening"));
  fireEvent.click(screen.getByText("Missed"));
  await waitFor(() =>
    expect(h.history).toHaveBeenLastCalledWith(
      undefined,
      expect.objectContaining({ kind: "night", status: "missed" }),
    ),
  );
  fireEvent.click(await screen.findByText(/Historical check-in/));
  expect(screen.getByText(/Optional reflection \(checkbox, optional\)/)).toBeVisible();
  expect(screen.getByText(/removed-step: Historical response · Draft/)).toBeVisible();
  expect(screen.getByText(/Optional follow-up due 2026-11-11/)).toBeVisible();
  act(() => h.close?.());
  expect(screen.queryByText(/Historical response/)).toBeNull();
});

it("keeps a disabled ritual visibly configured instead of treating it as absent", async () => {
  h.definitions.mockResolvedValue({ rituals: [{ ...definition, enabled: false }] });
  render(wrap(<RitualsSettingsScreen />));
  expect(await screen.findByRole("button", { name: /Morning.*Disabled/ })).toBeVisible();
  expect(h.remove).not.toHaveBeenCalled();
});
it("uses entered history date boundaries without requiring a record-specific timezone", async () => {
  h.timezone = undefined;
  render(wrap(<RitualHistoryScreen />));
  await screen.findByText("No matching history.");
  fireEvent.change(screen.getByLabelText("From date"), { target: { value: "2026-11-01" } });
  fireEvent.change(screen.getByLabelText("To date"), { target: { value: "2026-11-30" } });
  await waitFor(() =>
    expect(h.history).toHaveBeenLastCalledWith(
      undefined,
      expect.objectContaining({ dateFrom: "2026-11-01", dateTo: "2026-11-30" }),
    ),
  );
  expect(h.remove).not.toHaveBeenCalled();
});
