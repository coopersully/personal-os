// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { ApiClientError } from "@personal-os/api-client";
import {
  financeAccountListSchema,
  type FinanceConfiguration,
  resolveWorkspaceSettings,
  type SearchableWorkspace,
  taskListSchema,
  taskProjectSchema,
} from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { api } from "@/api";
import { useSaveWorkspacePreferences, useWorkspacePreferences } from "./preferences";
import { WorkspacePreferenceRecovery } from "./save-recovery";
import { WorkspacePreferencesSection } from "./section";

beforeEach(() => {
  let preferences: Record<string, unknown> = {};
  let revision = 0;
  vi.spyOn(api, "listTaskLists").mockResolvedValue({ items: [], nextCursor: null });
  vi.spyOn(api, "getWorkspaceSettings").mockImplementation(async (workspace) =>
    resolveWorkspaceSettings(workspace, { ...preferences, revision }),
  );
  vi.spyOn(api, "updateWorkspaceSettings").mockImplementation(async (workspace, input) => {
    expect(input.expectedRevision).toBe(revision);
    preferences = { ...preferences, ...input.preferences };
    return resolveWorkspaceSettings(workspace, { ...preferences, revision: ++revision });
  });
});
afterEach(() => vi.restoreAllMocks());
async function show(workspace: SearchableWorkspace) {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  cache.setQueryData(["me"], { id: "owner" });
  render(
    <QueryClientProvider client={cache}>
      <MemoryRouter>
        <WorkspacePreferencesSection workspace={workspace} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(
      screen.getByRole("switch", { name: "Include completed and archived items in search" }),
    ).toBeEnabled(),
  );
  return userEvent.setup();
}
async function select(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
  value: string,
  patch: object,
) {
  await user.selectOptions(screen.getByLabelText(label), value);
  await waitFor(() =>
    expect(api.updateWorkspaceSettings).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({ preferences: patch }),
    ),
  );
  await waitFor(() => expect(screen.getByLabelText(label)).toBeEnabled());
}
it("persists Calendar choices independently with the latest revision", async () => {
  const user = await show("calendar");
  await select(user, "Preferred view", "month", { calendarView: "month" });
  for (const [label, key] of [
    ["Automatically follow today", "autoFollowToday"],
    ["Show weekends", "showWeekends"],
    ["Snap back to Follow", "snapToFollow"],
  ] as const) {
    await user.click(screen.getByRole("switch", { name: label }));
    await waitFor(() =>
      expect(api.updateWorkspaceSettings).toHaveBeenLastCalledWith(
        "calendar",
        expect.objectContaining({ preferences: { [key]: false } }),
      ),
    );
    await waitFor(() => expect(screen.getByRole("switch", { name: label })).toBeEnabled());
  }
  expect(screen.getByLabelText("Follow snap sensitivity")).toBeDisabled();
  await user.click(screen.getByRole("switch", { name: "Snap back to Follow" }));
  await waitFor(() => expect(screen.getByLabelText("Follow snap sensitivity")).toBeEnabled());
  await select(user, "Follow snap sensitivity", "precise", { followSnapSensitivity: "precise" });
});
it("persists Mail layout and validates split width before saving", async () => {
  const user = await show("mail");
  await select(user, "Conversation layout", "single", { mailConversationLayout: "single" });
  await select(user, "Conversation density", "compact", { mailListDensity: "compact" });
  const width = screen.getByLabelText("Conversation list width (%)");
  for (const value of ["", "0", "100", "34"]) {
    fireEvent.change(width, { target: { value } });
    fireEvent.blur(width);
  }
  expect(api.updateWorkspaceSettings).toHaveBeenCalledTimes(2);
  fireEvent.change(width, { target: { value: "45.5" } });
  fireEvent.blur(width);
  await waitFor(() =>
    expect(api.updateWorkspaceSettings).toHaveBeenLastCalledWith(
      "mail",
      expect.objectContaining({ preferences: { mailListWidth: 45.5 } }),
    ),
  );
});
it("saves Finance view and grouping preferences", async () => {
  const user = await show("finances");
  await select(user, "Transaction view", "cards", { financeTransactionView: "cards" });
  await select(user, "Group cards by", "category", { financeTransactionGroup: "category" });
});
it("saves Task sorting and toggles individual row details without losing siblings", async () => {
  const user = await show("tasks");
  await select(user, "Sort by", "priority", { taskSort: "priority" });
  await select(user, "Group by", "project", { taskGroup: "project" });
  await select(user, "List and project sorting", "name", { taskContainerSort: "name" });
  await user.click(screen.getByRole("checkbox", { name: "Notes" }));
  await waitFor(() =>
    expect(api.updateWorkspaceSettings).toHaveBeenLastCalledWith(
      "tasks",
      expect.objectContaining({ preferences: { taskRowDetails: ["estimate", "notes"] } }),
    ),
  );
  await waitFor(() => expect(screen.getByRole("checkbox", { name: "Estimates" })).toBeEnabled());
  await user.click(screen.getByRole("checkbox", { name: "Estimates" }));
  await waitFor(() =>
    expect(api.updateWorkspaceSettings).toHaveBeenLastCalledWith(
      "tasks",
      expect.objectContaining({ preferences: { taskRowDetails: ["notes"] } }),
    ),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("switch", { name: "Include completed and archived items in search" }),
    ).toBeEnabled(),
  );
  await user.click(
    screen.getByRole("switch", { name: "Include completed and archived items in search" }),
  );
  await waitFor(() =>
    expect(api.updateWorkspaceSettings).toHaveBeenLastCalledWith(
      "tasks",
      expect.objectContaining({ preferences: { includeArchivedInSearch: false } }),
    ),
  );
});
it("recovers authoritative settings after a rejected write", async () => {
  vi.mocked(api.updateWorkspaceSettings).mockRejectedValueOnce(new Error("Revision conflict"));
  const user = await show("finances");
  await user.selectOptions(screen.getByLabelText("Transaction view"), "cards");
  await waitFor(() =>
    expect(vi.mocked(api.getWorkspaceSettings).mock.calls.length).toBeGreaterThan(1),
  );
  await waitFor(() => expect(screen.getByLabelText("Transaction view")).toHaveValue("table"));
  expect(screen.getByText("Your change: cards")).toBeInTheDocument();
  expect(screen.getByLabelText("Transaction view")).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Refresh latest settings" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Use latest settings" })).toBeEnabled(),
  );
  expect(screen.getByText("Latest: table")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Use latest settings" }));
  await select(user, "Transaction view", "cards", { financeTransactionView: "cards" });
});

it("saves Calendar week start and duration and ignores invalid duration", async () => {
  const user = await show("calendar");
  await select(user, "Week starts on", "monday", { weekStartsOn: "monday" });
  const input = screen.getByLabelText("Default event duration (minutes)");
  for (const value of ["", "0", "1441", "60"]) {
    fireEvent.change(input, { target: { value } });
    fireEvent.blur(input);
  }
  expect(api.updateWorkspaceSettings).toHaveBeenCalledTimes(1);
  fireEvent.change(input, { target: { value: "90" } });
  fireEvent.blur(input);
  await waitFor(() =>
    expect(api.updateWorkspaceSettings).toHaveBeenLastCalledWith(
      "calendar",
      expect.objectContaining({ preferences: { defaultEventDurationMinutes: 90 } }),
    ),
  );
});
it("saves Tasks completed visibility and explicitly resets a stale capture destination", async () => {
  const id = "00000000-0000-4000-8000-000000000124";
  vi.mocked(api.getWorkspaceSettings).mockResolvedValueOnce(
    resolveWorkspaceSettings("tasks", { defaultCaptureListId: id }),
  );
  const user = await show("tasks");
  await waitFor(() => expect(screen.getByLabelText("Default capture list")).toBeEnabled());
  expect(
    screen.getByRole("option", { name: "Unavailable list — new tasks use Inbox" }),
  ).toBeInTheDocument();
  await select(user, "Default capture list", "", { defaultCaptureListId: null });
  await user.click(
    screen.getByRole("switch", { name: "Show completed tasks in lists and projects" }),
  );
  await waitFor(() =>
    expect(api.updateWorkspaceSettings).toHaveBeenLastCalledWith(
      "tasks",
      expect.objectContaining({ preferences: { showCompletedTasks: true } }),
    ),
  );
});

it("keeps pinned-project recovery readable through failed name loading and exact reviewed replay", async () => {
  const listId = "00000000-0000-4000-8000-000000000121";
  const projectId = "00000000-0000-4000-8000-000000000122";
  const project = taskProjectSchema.parse({
    id: projectId,
    listId,
    name: "Launch",
    lifecycle: "open",
    availability: "active",
    archivedAt: null,
    cancelledAt: null,
    completedAt: null,
    deletedAt: null,
    createdAt: "2026-10-09T00:00:00.000Z",
    updatedAt: "2026-10-09T00:00:00.000Z",
    notes: null,
    targetDate: null,
    why: null,
    revision: 1,
    source: {
      accountId: null,
      provider: "local",
      remoteId: projectId,
      revision: "1",
      sourceType: "task_project",
    },
  });
  let rejectNames!: (error: Error) => void;
  const names = vi
    .spyOn(api, "listTaskProjects")
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectNames = reject;
        }),
    )
    .mockResolvedValue({ items: [project], nextCursor: null });
  let settings = resolveWorkspaceSettings("tasks", {
    revision: 3,
    taskSort: "title",
    pinnedProjectIds: [],
  });
  vi.mocked(api.getWorkspaceSettings).mockImplementation(async () => settings);
  const update = vi
    .mocked(api.updateWorkspaceSettings)
    .mockRejectedValueOnce(
      new ApiClientError({ status: 409, code: "conflict", message: "Changed" }),
    )
    .mockImplementation(async (_workspace, input) => {
      settings = resolveWorkspaceSettings("tasks", {
        ...settings.preferences,
        ...input.preferences,
        revision: 7,
      });
      return settings;
    });
  function Writer() {
    const query = useWorkspacePreferences("tasks");
    const save = useSaveWorkspacePreferences("tasks");
    return (
      <button
        type="button"
        disabled={!query.isSuccess || save.isWorkspacePending}
        onClick={() => save.mutate({ pinnedProjectIds: [projectId] })}
      >
        Pin Launch elsewhere
      </button>
    );
  }
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  cache.setQueryData(["me"], { id: "owner" });
  render(
    <QueryClientProvider client={cache}>
      <MemoryRouter>
        <Writer />
        <WorkspacePreferencesSection workspace="tasks" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Pin Launch elsewhere" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Pin Launch elsewhere" }));
  await waitFor(() => expect(names).toHaveBeenCalledTimes(1));
  expect(screen.getByLabelText("Sort by")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Reapply reviewed change" })).toBeDisabled();
  await act(async () => rejectNames(new Error("Project names offline")));
  await screen.findByText("Couldn’t load pinned project names.");
  expect(update).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await screen.findByText("Your change: Launch");
  expect(screen.getByLabelText("Sort by")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Reapply reviewed change" })).toBeDisabled();
  settings = resolveWorkspaceSettings("tasks", {
    revision: 6,
    taskSort: "title",
    pinnedProjectIds: [],
  });
  fireEvent.click(screen.getByRole("button", { name: "Refresh latest settings" }));
  await screen.findByText("Latest: None pinned");
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Reapply reviewed change" })).toBeEnabled(),
  );
  expect(update).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Reapply reviewed change" }));
  await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
  expect(update).toHaveBeenLastCalledWith("tasks", {
    expectedRevision: 6,
    preferences: { pinnedProjectIds: [projectId] },
  });
  await waitFor(() => expect(screen.getByLabelText("Sort by")).toBeEnabled());
  expect(settings.preferences.taskSort).toBe("title");
});

it("represents a configured Inbox as the product default while reviewing a failed capture reset", async () => {
  const id = "00000000-0000-4000-8000-000000000124";
  const inbox = taskListSchema.parse({
    id,
    name: "Inbox",
    kind: "inbox",
    availability: "active",
    color: null,
    description: null,
    icon: "list",
    archivedAt: null,
    deletedAt: null,
    revision: 1,
    createdAt: "2026-10-09T00:00:00.000Z",
    updatedAt: "2026-10-09T00:00:00.000Z",
    source: {
      accountId: null,
      provider: "local",
      remoteId: id,
      revision: "1",
      sourceType: "task_list",
    },
  });
  vi.mocked(api.listTaskLists).mockResolvedValue({ items: [inbox], nextCursor: null });
  let settings = resolveWorkspaceSettings("tasks", {
    revision: 3,
    defaultCaptureListId: id,
    showCompletedTasks: true,
  });
  vi.mocked(api.getWorkspaceSettings).mockImplementation(async () => settings);
  const update = vi
    .mocked(api.updateWorkspaceSettings)
    .mockRejectedValue(new Error("Reset response lost"));
  function Writer() {
    const query = useWorkspacePreferences("tasks");
    const save = useSaveWorkspacePreferences("tasks");
    return (
      <button
        type="button"
        disabled={!query.isSuccess}
        onClick={() => save.mutate({ defaultCaptureListId: null })}
      >
        Reset capture destination elsewhere
      </button>
    );
  }
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  cache.setQueryData(["me"], { id: "owner" });
  render(
    <QueryClientProvider client={cache}>
      <MemoryRouter>
        <Writer />
        <WorkspacePreferencesSection workspace="tasks" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.getByLabelText("Default capture list")).toBeEnabled());
  expect(screen.getByLabelText("Default capture list")).toHaveValue("");
  expect(screen.getByRole("option", { name: "Inbox" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Reset capture destination elsewhere" }));
  await screen.findByText("Your change: Inbox (product default)");
  expect(screen.getByLabelText("Default capture list")).toBeDisabled();
  expect(update).toHaveBeenLastCalledWith("tasks", {
    expectedRevision: 3,
    preferences: { defaultCaptureListId: null },
  });
  settings = resolveWorkspaceSettings("tasks", {
    revision: 6,
    defaultCaptureListId: id,
    showCompletedTasks: true,
  });
  fireEvent.click(screen.getByRole("button", { name: "Refresh latest settings" }));
  await screen.findByText("Latest: Inbox");
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Use latest settings" })).toBeEnabled(),
  );
  expect(update).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Use latest settings" }));
  await waitFor(() => expect(screen.getByLabelText("Default capture list")).toBeEnabled());
  expect(screen.getByLabelText("Default capture list")).toHaveValue("");
  expect(
    screen.getByRole("switch", { name: "Show completed tasks in lists and projects" }),
  ).toBeChecked();
  expect(update).toHaveBeenCalledTimes(1);
});

it("reloads unavailable Finance account names before an exact reviewed selection replay", async () => {
  const known = "00000000-0000-4000-8000-000000000123";
  const missing = "00000000-0000-4000-8000-000000000125";
  let settings = resolveWorkspaceSettings("finances", {
    revision: 3,
    cashAccountIds: [],
    financeTransactionView: "cards",
    financeTransactionGroup: "category",
  });
  const accounts = financeAccountListSchema.parse({
    accounts: [
      {
        id: known,
        name: "Everyday checking",
        institution: "Example Bank",
        balance: 20,
        currencyCode: "USD",
        includeInPlanning: true,
        kind: "cash",
        kindSource: "provider",
        ownershipType: "unknown",
        ownershipShare: null,
        provider: "plaid",
        status: "connected",
        providerType: "depository",
        providerSubtype: "checking",
        lastSyncedAt: "2026-10-09T00:00:00.000Z",
        updatedAt: "2026-10-09T00:00:00.000Z",
        createdAt: "2026-10-09T00:00:00.000Z",
        synchronization: {
          failureCode: null,
          failureCount: 0,
          lastAttemptAt: null,
          recovery: null,
          state: "current",
          message: null,
          lastSuccessAt: "2026-10-09T00:00:00.000Z",
          nextRetryAt: null,
        },
      },
    ],
    accountSemantics: {
      excludedAccountIds: [],
      possibleDuplicateGroups: [],
      trustworthy: true,
      unresolvedOwnershipAccountIds: [],
    },
    totals: { cash: 20, debt: 0, investments: 0, netWorth: 20, otherAssets: 0 },
  });
  const unavailable: FinanceConfiguration = {
    execution: { state: "unavailable" },
    profile: { state: "unavailable" },
    preferences: { state: "loaded", value: settings },
    income: { state: "unavailable" },
    budget: { state: "unavailable" },
    accounts: { state: "unavailable" },
    guidance: { state: "unavailable" },
    capabilities: {
      budget: { state: "unavailable", reason: null, href: null, action: null },
      cashflow: { state: "unavailable", reason: null, href: null, action: null },
      wealth: { state: "unavailable", reason: null, href: null, action: null },
    },
  };
  const load = vi
    .spyOn(api, "getFinanceConfiguration")
    .mockResolvedValueOnce(unavailable)
    .mockResolvedValue({ ...unavailable, accounts: { state: "loaded", value: accounts } });
  vi.mocked(api.getWorkspaceSettings).mockImplementation(async () => settings);
  const update = vi
    .mocked(api.updateWorkspaceSettings)
    .mockRejectedValueOnce(
      new ApiClientError({ status: 409, code: "conflict", message: "Changed" }),
    )
    .mockImplementation(async (_workspace, input) => {
      settings = resolveWorkspaceSettings("finances", {
        ...settings.preferences,
        ...input.preferences,
        revision: 7,
      });
      return settings;
    });
  function Writer() {
    const query = useWorkspacePreferences("finances");
    const save = useSaveWorkspacePreferences("finances");
    return (
      <button
        type="button"
        disabled={!query.isSuccess}
        onClick={() => save.mutate({ cashAccountIds: [known, missing] })}
      >
        Choose cash accounts elsewhere
      </button>
    );
  }
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  cache.setQueryData(["me"], { id: "owner" });
  render(
    <QueryClientProvider client={cache}>
      <MemoryRouter>
        <Writer />
        <WorkspacePreferencesSection workspace="finances" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Choose cash accounts elsewhere" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Choose cash accounts elsewhere" }));
  await screen.findByText(
    "Account names are unavailable. Reload them before reapplying account selections.",
  );
  expect(screen.getByRole("button", { name: "Reapply reviewed change" })).toBeDisabled();
  expect(screen.getByLabelText("Transaction view")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Reload account names" }));
  await screen.findByText("Your change: Everyday checking, Unavailable account");
  expect(load).toHaveBeenCalledTimes(2);
  expect(update).toHaveBeenCalledTimes(1);
  settings = resolveWorkspaceSettings("finances", {
    revision: 6,
    cashAccountIds: [],
    financeTransactionView: "cards",
    financeTransactionGroup: "category",
  });
  fireEvent.click(screen.getByRole("button", { name: "Refresh latest settings" }));
  await screen.findByText("Latest: None selected");
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Reapply reviewed change" })).toBeEnabled(),
  );
  expect(update).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Reapply reviewed change" }));
  await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
  expect(update).toHaveBeenLastCalledWith("finances", {
    expectedRevision: 6,
    preferences: { cashAccountIds: [known, missing] },
  });
  await waitFor(() => expect(screen.getByLabelText("Transaction view")).toBeEnabled());
  expect(settings.preferences.financeTransactionView).toBe("cards");
  expect(settings.preferences.financeTransactionGroup).toBe("category");
});

it("fences account names and retained recovery across mounted Settings A to B to A with a late read", async () => {
  function Writer() {
    const save = useSaveWorkspacePreferences("finances");
    const preferences = useWorkspacePreferences("finances");
    return (
      <button
        type="button"
        disabled={!preferences.isSuccess}
        onClick={() => save.mutate({ cashAccountIds: [] })}
      >
        Attempt cash selection
      </button>
    );
  }
  const configuration = (name: string) =>
    ({
      accounts: {
        state: "loaded",
        value: { accounts: [{ id: "00000000-0000-4000-8000-000000000123", name }] },
      },
    }) as unknown as FinanceConfiguration;
  let release!: (value: FinanceConfiguration) => void;
  const load = vi
    .spyOn(api, "getFinanceConfiguration")
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    )
    .mockResolvedValueOnce(configuration("B checking"))
    .mockResolvedValue(configuration("New A checking"));
  vi.mocked(api.getWorkspaceSettings).mockResolvedValue(
    resolveWorkspaceSettings("finances", {
      cashAccountIds: ["00000000-0000-4000-8000-000000000123"],
      revision: 3,
    }),
  );
  vi.mocked(api.updateWorkspaceSettings).mockRejectedValue(new Error("Save uncertain"));
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  cache.setQueryData(["me"], { id: "A" });
  render(
    <QueryClientProvider client={cache}>
      <MemoryRouter>
        <Writer />
        <WorkspacePreferencesSection workspace="finances" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Attempt cash selection" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Attempt cash selection" }));
  await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
  act(() => cache.setQueryData(["me"], { id: "B" }));
  await waitFor(() =>
    expect(screen.queryByText("Your change: None selected")).not.toBeInTheDocument(),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Attempt cash selection" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Attempt cash selection" }));
  await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole("button", { name: "Refresh latest settings" }));
  await screen.findByText("Latest: B checking");
  act(() => cache.setQueryData(["me"], { id: "A" }));
  await waitFor(() =>
    expect(screen.queryByText("Your change: None selected")).not.toBeInTheDocument(),
  );
  await act(async () => release(configuration("Old A checking")));
  expect(screen.queryByText(/Old A checking|B checking/)).not.toBeInTheDocument();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Attempt cash selection" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Attempt cash selection" }));
  await waitFor(() => expect(load).toHaveBeenCalledTimes(3));
  fireEvent.click(screen.getByRole("button", { name: "Refresh latest settings" }));
  await screen.findByText("Latest: New A checking");
  expect(screen.queryByText(/Old A checking|B checking/)).not.toBeInTheDocument();
  expect(api.updateWorkspaceSettings).toHaveBeenCalledTimes(3);
});

it.each([
  "uncertain",
  "rejected",
] as const)("keeps %s default-reset intent readable and refreshes it without another write", async (kind) => {
  const initial = resolveWorkspaceSettings("tasks", { revision: 3, showCompletedTasks: true });
  vi.mocked(api.getWorkspaceSettings).mockResolvedValue(initial);
  vi.mocked(api.updateWorkspaceSettings).mockRejectedValueOnce(
    kind === "uncertain"
      ? new Error("Response lost after sending defaults")
      : new ApiClientError({ status: 403, code: "forbidden", message: "No access" }),
  );
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  cache.setQueryData(["me"], { id: "owner" });
  cache.setQueryData(["workspace-settings", "tasks"], initial);
  const defaults = { defaultCaptureListId: null, taskRowDetails: [], showCompletedTasks: false };
  function ResetDefaults() {
    const query = useWorkspacePreferences("tasks");
    const save = useSaveWorkspacePreferences("tasks");
    return (
      <>
        <button
          type="button"
          disabled={!query.isSuccess || save.isWorkspacePending}
          onClick={() => save.mutate(defaults)}
        >
          Reset displayed task defaults
        </button>
        <WorkspacePreferenceRecovery workspace="tasks" />
      </>
    );
  }
  render(
    <QueryClientProvider client={cache}>
      <ResetDefaults />
    </QueryClientProvider>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Reset displayed task defaults" }));
  expect(
    await screen.findByText(
      kind === "uncertain"
        ? "The change may have been saved. Refresh checks the current values without writing."
        : "The change could not be applied. Refresh the current values before trying again.",
    ),
  ).toBeVisible();
  for (const label of [
    "Your change: Inbox (product default)",
    "Your change: None selected",
    "Your change: Disabled",
  ])
    expect(screen.getByText(label)).toBeVisible();
  expect(api.updateWorkspaceSettings).toHaveBeenLastCalledWith("tasks", {
    expectedRevision: 3,
    preferences: defaults,
  });
  expect(screen.getByRole("button", { name: "Reapply reviewed change" })).toBeDisabled();
  const latest = resolveWorkspaceSettings("tasks", { revision: 6, showCompletedTasks: true });
  vi.mocked(api.getWorkspaceSettings).mockResolvedValue(latest);
  await userEvent.click(screen.getByRole("button", { name: "Refresh latest settings" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Use latest settings" })).toBeEnabled(),
  );
  expect(screen.getByText("Latest: Enabled")).toBeVisible();
  expect(api.updateWorkspaceSettings).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole("button", { name: "Use latest settings" }));
  expect(api.updateWorkspaceSettings).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("button", { name: "Refresh latest settings" })).not.toBeInTheDocument();
});
