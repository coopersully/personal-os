// @vitest-environment jsdom
import { ApiClientError } from "@personal-os/api-client";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PropsWithChildren, ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ContainerEditorScreen from "../../app/task-container";
import TaskEditorScreen from "../../app/task-editor";
import { MobileDataProvider } from "./data";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
const h = vi.hoisted(() => ({
  params: {} as Record<string, string>,
  record: undefined as unknown,
  isError: false,
  resourceError: false,
  liveQueries: false,
  headerOptions: {} as { headerLeft?: () => ReactNode; headerRight?: () => ReactNode },
  timezone: "America/New_York" as string | undefined,
  back: vi.fn(),
  replace: vi.fn(),
  refetch: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  loading: vi.fn(() => "action"),
  api: {
    listTaskWorkspace: vi.fn(),
    getTask: vi.fn(),
    getReminder: vi.fn(),
    getTaskList: vi.fn(),
    getTaskProject: vi.fn(),
    completeTask: vi.fn(),
    reopenTask: vi.fn(),
    cancelTask: vi.fn(),
    trashTask: vi.fn(),
    restoreTask: vi.fn(),
    completeReminder: vi.fn(),
    trashReminder: vi.fn(),
    restoreReminder: vi.fn(),
    createTaskList: vi.fn(),
    updateTaskList: vi.fn(),
    archiveTaskList: vi.fn(),
    createTaskProject: vi.fn(),
    updateTaskProject: vi.fn(),
    completeTaskProject: vi.fn(),
    cancelTaskProject: vi.fn(),
    archiveTaskProject: vi.fn(),
    createTask: vi.fn(),
    updateTask: vi.fn(),
    createReminder: vi.fn(),
    updateReminder: vi.fn(),
    previewTaskMove: vi.fn(),
    moveTask: vi.fn(),
    previewTaskProjectMove: vi.fn(),
    moveTaskProject: vi.fn(),
  },
}));
// Native primitives are rendered as accessible DOM controls; real form/state/action modules run.
vi.mock("react-native", () => {
  const Box = ({ children }: PropsWithChildren) => <div>{children}</div>;
  return {
    useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1, scale: 3 }),
    Keyboard: { addListener: () => ({ remove: () => {} }) },
    View: Box,
    Text: Box,
    ScrollView: Box,
    KeyboardAvoidingView: Box,
    Image: () => null,
    Pressable: ({
      children,
      onPress,
      disabled,
      accessibilityLabel,
      accessibilityRole,
      accessibilityState,
    }: PropsWithChildren<{
      onPress?: () => void;
      disabled?: boolean;
      accessibilityLabel?: string;
      accessibilityRole?: string;
      accessibilityState?: { checked?: boolean; expanded?: boolean };
    }>) =>
      accessibilityRole === "radio" ? (
        <label>
          <input
            type="radio"
            aria-label={accessibilityLabel}
            checked={accessibilityState?.checked}
            disabled={disabled}
            onChange={onPress}
          />
          {children}
        </label>
      ) : (
        <button
          type="button"
          aria-label={accessibilityLabel}
          aria-expanded={accessibilityState?.expanded}
          disabled={disabled}
          onClick={onPress}
        >
          {children}
        </button>
      ),
    TextInput: ({
      value,
      onChangeText,
      accessibilityLabel,
      placeholder,
      onBlur,
    }: {
      value?: string;
      onChangeText?: (s: string) => void;
      accessibilityLabel?: string;
      placeholder?: string;
      onBlur?: () => void;
    }) => (
      <input
        aria-label={accessibilityLabel}
        placeholder={placeholder}
        value={value ?? ""}
        onChange={(e) => onChangeText?.(e.target.value)}
        onBlur={onBlur}
      />
    ),
    Modal: ({ visible, children }: PropsWithChildren<{ visible: boolean }>) =>
      visible ? <div role="dialog">{children}</div> : null,
    FlatList: ({
      data,
      renderItem,
      ListEmptyComponent,
    }: {
      data: { value: string; label: string }[];
      renderItem: (v: { item: { value: string; label: string } }) => ReactNode;
      ListEmptyComponent: ReactNode;
    }) => (
      <div>
        {data.length
          ? data.map((item) => <div key={item.value}>{renderItem({ item })}</div>)
          : ListEmptyComponent}
      </div>
    ),
    ActivityIndicator: () => <div role="progressbar" />,
    StyleSheet: { create: (v: unknown) => v, hairlineWidth: 1 },
    Platform: { OS: "web" },
    useColorScheme: () => "light",
    Alert: { alert: vi.fn() },
  };
});
vi.mock("react-native-safe-area-context", async () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaView: ({ children }: PropsWithChildren) => <div>{children}</div>,
}));
vi.mock("expo-glass-effect", () => ({
  GlassView: ({ children }: PropsWithChildren) => <div>{children}</div>,
  isLiquidGlassAvailable: () => false,
}));
vi.mock("expo-router", () => ({
  router: { back: h.back, replace: h.replace },
  useLocalSearchParams: () => h.params,
  usePathname: () => "/task-editor",
  Stack: {
    Screen: ({
      options,
    }: {
      options: { headerLeft?: () => ReactNode; headerRight?: () => ReactNode };
    }) => {
      // Native navigation merges options; omitting a slot retains the previous action.
      Object.assign(h.headerOptions, options);
      return (
        <div>
          {h.headerOptions.headerLeft?.()}
          {h.headerOptions.headerRight?.()}
        </div>
      );
    },
  },
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => "00000000-0000-4000-8000-000000000099" }));
vi.mock("../../components/icons", () => ({
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
}));
vi.mock("../auth/context", () => ({
  useOptionalAuth: () => null,
  useAuth: () => ({ state: { user: { planningTimezone: h.timezone } } }),
}));
vi.mock("sonner-native", () => ({
  toast: { success: h.success, error: h.error, loading: h.loading },
  Toaster: () => <div data-testid="editor-toaster" />,
}));
vi.mock("../notifications/events", () => ({ refreshDueAlerts: vi.fn() }));
vi.mock("@tanstack/react-query", async () => {
  const { createRequire } = await import("node:module");
  const real = createRequire(`${process.cwd()}/apps/web/package.json`)(
    "@tanstack/react-query",
  ) as typeof import("@tanstack/react-query");
  return {
    ...real,
    // Each test selects its query implementation before mounting, never during a render.
    useQuery: (options: Parameters<typeof real.useQuery>[0]) => {
      const useSelectedQuery = h.liveQueries
        ? real.useQuery
        : () => ({
            data: h.record,
            isPending: !h.record && !h.isError,
            isError: h.isError,
            isSuccess: !!h.record && !h.isError,
            isFetchedAfterMount: !!h.record || h.isError,
            refetch: h.refetch,
          });
      return useSelectedQuery(options);
    },
    useQueryClient: () => {
      const useSelectedClient = h.liveQueries
        ? real.useQueryClient
        : () => ({ invalidateQueries: vi.fn(), refetchQueries: vi.fn() });
      return useSelectedClient();
    },
  };
});
const inbox = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Inbox",
  kind: "inbox",
  availability: "active",
  deletedAt: null,
  revision: 1,
};
const garden = {
  id: "00000000-0000-4000-8000-000000000002",
  name: "Garden",
  kind: "list",
  availability: "active",
  deletedAt: null,
  revision: 1,
};
vi.mock("./data", async (original) => ({
  ...(await original<typeof import("./data")>()),
  useTaskApi: () => h.api,
  useTaskResources: () => ({
    lists: { data: [inbox, garden], isError: h.resourceError, refetch: h.refetch },
    projects: { data: [], isError: h.resourceError, refetch: h.refetch },
    settings: {
      data: { preferences: { defaultCaptureListId: null } },
      isError: h.resourceError,
      refetch: h.refetch,
    },
  }),
}));
beforeEach(() => {
  vi.clearAllMocks();
  h.params = {};
  h.record = undefined;
  h.isError = false;
  h.resourceError = false;
  h.liveQueries = false;
  h.headerOptions = {};
  h.timezone = "America/New_York";
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true),
  );
  for (const fn of Object.values(h.api))
    fn.mockReset().mockResolvedValue({ id: "saved", revision: 2 });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const save = () => screen.getByRole("button", { name: "Save changes" });
it.each([
  "list",
  "project",
])("creates a %s only after editing and preserves compact identity fields", async (kind) => {
  h.params = { kind };
  render(<ContainerEditorScreen />);
  expect(save()).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(h.back).toHaveBeenCalledOnce();
  h.back.mockClear();
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Balcony garden" } });
  expect(screen.getByRole("button", { name: "Cancel" })).toBeVisible();
  expect(save()).toBeEnabled();
  fireEvent.click(save());
  await waitFor(() =>
    expect(kind === "list" ? h.api.createTaskList : h.api.createTaskProject).toHaveBeenCalledOnce(),
  );
  expect(kind === "list" ? h.api.createTaskList : h.api.createTaskProject).toHaveBeenCalledWith(
    expect.objectContaining({ name: "Balcony garden" }),
  );
  await waitFor(() => expect(h.back).toHaveBeenCalledOnce());
  expect(h.success).toHaveBeenCalledWith("Saved", expect.anything());
});
it.each([
  "list",
  "project",
])("keeps the %s draft paired with its original revision after a query refresh", async (kind) => {
  h.params = { kind, id: garden.id };
  h.record = {
    ...garden,
    name: "Original",
    description: "Old description",
    notes: "Old description",
    icon: "list",
    color: null,
    listId: inbox.id,
    lifecycle: "open",
  };
  const { rerender } = render(<ContainerEditorScreen />);
  h.record = {
    ...(h.record as object),
    revision: 2,
    description: "Remote update",
    notes: "Remote update",
  };
  rerender(<ContainerEditorScreen />);
  const update = kind === "list" ? h.api.updateTaskList : h.api.updateTaskProject;
  update.mockRejectedValue(
    new ApiClientError({ status: 409, code: "CONFLICT", message: "Changed elsewhere" }),
  );
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "My edit" } });
  fireEvent.click(save());
  await waitFor(() =>
    expect(update).toHaveBeenCalledWith(
      garden.id,
      expect.objectContaining({ expectedRevision: 1, name: "My edit" }),
    ),
  );
  expect(screen.getByLabelText("Title")).toHaveValue("My edit");
  expect(h.back).not.toHaveBeenCalled();
  await waitFor(() => expect(h.error).toHaveBeenCalled());
  expect(save()).toBeDisabled();
});
it.each(["task", "reminder"])("creates a %s with edited title and priority", async (kind) => {
  h.params = { kind };
  render(<TaskEditorScreen />);
  expect(save()).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Plan meals" } });
  fireEvent.click(screen.getByRole("button", { name: "Priority, Medium" }));
  fireEvent.click(screen.getByRole("radio", { name: "High" }));
  fireEvent.click(save());
  const create = kind === "task" ? h.api.createTask : h.api.createReminder;
  await waitFor(() =>
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Plan meals", priority: "high" }),
    ),
  );
  await waitFor(() => expect(h.back).toHaveBeenCalledOnce());
});
it("keeps the toast host available while uncached editors load or fail", () => {
  h.params = { id: garden.id, kind: "list" };
  h.isError = true;
  render(<ContainerEditorScreen />);
  expect(screen.getByTestId("editor-toaster")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Retry loading" }));
  expect(h.refetch).toHaveBeenCalledOnce();
});
it.each([
  "task",
  "reminder",
])("keeps an uncertain %s creation recoverable without silently duplicating it", async (kind) => {
  h.params = { kind };
  const create = kind === "task" ? h.api.createTask : h.api.createReminder;
  create.mockRejectedValueOnce(new Error("Connection lost"));
  render(<TaskEditorScreen />);
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Water plants" } });
  fireEvent.click(save());
  await waitFor(() => expect(h.error).toHaveBeenCalled());
  expect(h.back).not.toHaveBeenCalled();
  if (kind === "task") {
    fireEvent.click(screen.getByRole("button", { name: "Retry the same task creation" }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create.mock.calls[1]).toEqual(create.mock.calls[0]);
    await waitFor(() => expect(h.back).toHaveBeenCalledOnce());
  } else {
    expect(save()).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Review reminders before creating again" }));
    expect(h.replace).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: "/task-browser",
        params: expect.objectContaining({ kind: "reminder" }),
      }),
    );
    expect(create).toHaveBeenCalledOnce();
  }
});
it("validates a task estimate before making a network mutation and permits correction", async () => {
  render(<TaskEditorScreen />);
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Plan meals" } });
  fireEvent.change(screen.getByLabelText("Estimate (minutes)"), { target: { value: "-4" } });
  fireEvent.click(save());
  await waitFor(() => expect(h.error).toHaveBeenCalled());
  expect(h.api.createTask).not.toHaveBeenCalled();
  expect(screen.queryByText("recovery")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Estimate (minutes)"), { target: { value: "30" } });
  fireEvent.click(screen.getByRole("button", { name: /Why it matters/ }));
  fireEvent.change(screen.getByLabelText("Why it matters"), {
    target: { value: " Calm evenings " },
  });
  fireEvent.blur(screen.getByLabelText("Why it matters"));
  expect(screen.getByRole("button", { name: "Why it matters, Calm evenings" })).toBeVisible();
  fireEvent.change(screen.getByLabelText("Description"), { target: { value: " Choose dinners " } });
  fireEvent.click(save());
  await waitFor(() =>
    expect(h.api.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        estimateMinutes: 30,
        why: "Calm evenings",
        notes: "Choose dinners",
      }),
    ),
  );
});
it("confirms discarding drafts and changing between task and reminder", () => {
  render(<TaskEditorScreen />);
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Draft" } });
  vi.mocked(window.confirm).mockReturnValue(false);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(h.back).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Item type, Task" }));
  fireEvent.click(screen.getByRole("radio", { name: "Reminder" }));
  expect(h.replace).not.toHaveBeenCalled();
  vi.mocked(window.confirm).mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: "Item type, Task" }));
  fireEvent.click(screen.getByRole("radio", { name: "Reminder" }));
  expect(h.replace).toHaveBeenCalledWith({
    pathname: "/task-editor",
    params: { kind: "reminder" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(h.back).toHaveBeenCalledOnce();
});
const existingTask = () => ({
  id: garden.id,
  title: "Original task",
  notes: null,
  priority: "medium",
  dueAt: null,
  scheduledAt: null,
  why: null,
  estimateMinutes: null,
  tags: [],
  listId: inbox.id,
  projectId: null,
  lifecycle: "open",
  deletedAt: null,
  revision: 4,
  updatedAt: "2026-11-06T12:00:00Z",
});
it.each([
  "task",
  "reminder",
])("updates a %s against its original revision and handles conflicts with explicit reload", async (kind) => {
  h.params = { kind, id: garden.id };
  h.record = existingTask();
  const update = kind === "task" ? h.api.updateTask : h.api.updateReminder;
  update.mockRejectedValueOnce(
    new ApiClientError({ status: 409, code: "CONFLICT", message: "Changed elsewhere" }),
  );
  render(<TaskEditorScreen />);
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "My draft" } });
  fireEvent.click(save());
  await waitFor(() =>
    expect(update).toHaveBeenCalledWith(
      garden.id,
      expect.objectContaining(
        kind === "task"
          ? { expectedRevision: 4, title: "My draft" }
          : { expectedUpdatedAt: "2026-11-06T12:00:00Z", title: "My draft" },
      ),
    ),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Reload current record (discard draft)" }),
    ).toBeVisible(),
  );
  expect(save()).toBeDisabled();
  vi.mocked(window.confirm).mockReturnValue(false);
  fireEvent.click(screen.getByRole("button", { name: "Reload current record (discard draft)" }));
  expect(h.refetch).not.toHaveBeenCalled();
  vi.mocked(window.confirm).mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: "Reload current record (discard draft)" }));
  expect(h.refetch).toHaveBeenCalledOnce();
  expect(h.back).toHaveBeenCalledOnce();
});
it("previews a list move before committing it and saves content against the returned revision", async () => {
  h.params = { kind: "task", id: garden.id };
  h.record = existingTask();
  h.api.previewTaskMove.mockResolvedValue({
    destinationListId: garden.id,
    destinationProjectId: null,
    detachedProjectId: null,
    previewToken: "preview",
  });
  h.api.moveTask.mockResolvedValue({ ...existingTask(), listId: garden.id, revision: 5 });
  render(<TaskEditorScreen />);
  fireEvent.click(screen.getByRole("button", { name: "List, Inbox" }));
  fireEvent.click(screen.getByRole("button", { name: "Garden" }));
  fireEvent.click(save());
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Confirm move and save" })).toBeVisible(),
  );
  expect(h.api.previewTaskMove).toHaveBeenCalledWith(garden.id, {
    destinationListId: garden.id,
    destinationProjectId: null,
    expectedRevision: 4,
  });
  expect(h.api.moveTask).not.toHaveBeenCalled();
  expect(h.api.updateTask).not.toHaveBeenCalled();
  expect(h.back).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel move" }));
  expect(screen.queryByText("move preview")).not.toBeInTheDocument();
  fireEvent.click(save());
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Confirm move and save" })).toBeVisible(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Confirm move and save" }));
  await waitFor(() =>
    expect(h.api.updateTask).toHaveBeenCalledWith(
      garden.id,
      expect.objectContaining({ expectedRevision: 5 }),
    ),
  );
  expect(h.api.moveTask).toHaveBeenCalledWith(
    garden.id,
    expect.objectContaining({ previewToken: "preview", expectedRevision: 4 }),
  );
  await waitFor(() => expect(h.back).toHaveBeenCalledOnce());
});
it("keeps a failed task fetch recoverable with the editor toast host present", () => {
  h.params = { kind: "task", id: garden.id };
  h.isError = true;
  render(<TaskEditorScreen />);
  expect(screen.getByTestId("editor-toaster")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Retry loading" }));
  expect(h.refetch).toHaveBeenCalledOnce();
});
it.each([
  "list",
  "project",
])("prevents uncertain %s recreation and offers reviewing existing containers", async (kind) => {
  h.params = { kind };
  const create = kind === "list" ? h.api.createTaskList : h.api.createTaskProject;
  create.mockRejectedValueOnce(new Error("Disconnected"));
  render(<ContainerEditorScreen />);
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Garden" } });
  fireEvent.click(save());
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Review containers before creating again" }),
    ).toBeVisible(),
  );
  expect(save()).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Review containers before creating again" }));
  expect(h.back).toHaveBeenCalledOnce();
  expect(create).toHaveBeenCalledOnce();
});
it("requires an explicit project move preview and commits its token", async () => {
  h.params = { kind: "project", id: garden.id };
  h.record = {
    ...garden,
    listId: inbox.id,
    lifecycle: "open",
    notes: null,
    why: null,
    targetDate: null,
  };
  h.api.previewTaskProjectMove.mockResolvedValue({
    destinationListId: garden.id,
    affectedTaskCount: 3,
    previewToken: "approved-move",
  });
  render(<ContainerEditorScreen />);
  expect(screen.getByRole("button", { name: "Preview project move" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Move to list, None" }));
  fireEvent.click(screen.getByRole("button", { name: "Garden" }));
  fireEvent.click(screen.getByRole("button", { name: "Preview project move" }));
  await waitFor(() =>
    expect(screen.getByText("3 tasks will move with this project.")).toBeVisible(),
  );
  expect(h.api.moveTaskProject).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel move" }));
  expect(screen.queryByText("move preview")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Preview project move" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Confirm move" })).toBeVisible());
  fireEvent.click(screen.getByRole("button", { name: "Confirm move" }));
  await waitFor(() =>
    expect(h.api.moveTaskProject).toHaveBeenCalledWith(garden.id, {
      destinationListId: garden.id,
      expectedRevision: 1,
      previewToken: "approved-move",
    }),
  );
  await waitFor(() => expect(h.back).toHaveBeenCalledOnce());
});
it.each([
  "Archive",
  "Cancel project",
  "Complete project",
])("routes %s through the project action menu with revision checks", async (label) => {
  h.params = { kind: "project", id: garden.id };
  h.record = { ...garden, listId: inbox.id, lifecycle: "open", notes: null };
  render(<ContainerEditorScreen />);
  fireEvent.click(screen.getByRole("button", { name: "Record actions" }));
  fireEvent.click(screen.getByRole("button", { name: label }));
  const api =
    label === "Archive"
      ? h.api.archiveTaskProject
      : label === "Cancel project"
        ? h.api.cancelTaskProject
        : h.api.completeTaskProject;
  await waitFor(() => expect(api).toHaveBeenCalledWith(garden.id, { expectedRevision: 1 }));
  await waitFor(() => expect(h.back).toHaveBeenCalledOnce());
});
it("keeps Inbox permanent and archived containers read-only", () => {
  h.params = { kind: "list", id: inbox.id };
  h.record = { ...inbox, icon: "list", color: null, description: null };
  const { rerender } = render(<ContainerEditorScreen />);
  expect(screen.queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
  h.params = { kind: "list", id: garden.id };
  h.record = { ...garden, availability: "archived", icon: "list", color: null, description: null };
  rerender(<ContainerEditorScreen />);
  expect(screen.getByText("This container is archived and read-only.")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
});
it.each([
  "Complete",
  "Cancel task",
  "Move to Trash",
])("offers Undo for accepted task action %s from the editor", async (label) => {
  h.params = { kind: "task", id: garden.id };
  h.record = existingTask();
  render(<TaskEditorScreen />);
  fireEvent.click(screen.getByRole("button", { name: "Record actions" }));
  fireEvent.click(screen.getByRole("button", { name: label }));
  const operation =
    label === "Complete"
      ? h.api.completeTask
      : label === "Cancel task"
        ? h.api.cancelTask
        : h.api.trashTask;
  await waitFor(() => expect(operation).toHaveBeenCalledWith(garden.id, { expectedRevision: 4 }));
  await waitFor(() => expect(h.back).toHaveBeenCalledOnce());
  const options = h.success.mock.calls.at(-1)?.[1];
  expect(options.action.label).toBe("Undo");
  options.action.onClick();
  await waitFor(() =>
    expect(label === "Move to Trash" ? h.api.restoreTask : h.api.reopenTask).toHaveBeenCalledWith(
      "saved",
      { expectedRevision: 2 },
    ),
  );
});
it("restores deleted tasks and offers reopening completed reminders", async () => {
  h.params = { kind: "task", id: garden.id, deleted: "1" };
  h.record = existingTask();
  const { unmount } = render(<TaskEditorScreen />);
  expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Restore" }));
  await waitFor(() =>
    expect(h.api.restoreTask).toHaveBeenCalledWith(garden.id, { expectedRevision: 4 }),
  );
  await waitFor(() => expect(h.back).toHaveBeenCalledOnce());
  unmount();
  h.params = { kind: "reminder", id: garden.id };
  h.record = { ...existingTask(), completedAt: "2026-11-06T10:00:00Z" };
  render(<TaskEditorScreen />);
  fireEvent.click(screen.getByRole("button", { name: "Record actions" }));
  fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
  await waitFor(() =>
    expect(h.api.completeReminder).toHaveBeenCalledWith(garden.id, false, "2026-11-06T12:00:00Z"),
  );
});
it("cannot mutate an explicitly read-only task", () => {
  h.params = { kind: "task", id: garden.id, readOnly: "1" };
  h.record = existingTask();
  render(<TaskEditorScreen />);
  expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Record actions" }));
  for (const label of ["Complete", "Cancel task", "Move to Trash"])
    expect(screen.getByRole("button", { name: label })).toBeDisabled();
});
it("resolves list archival only after explicitly choosing how to handle active contents", async () => {
  h.params = { kind: "list", id: garden.id };
  h.record = { ...garden, description: null, icon: "list", color: null };
  const details = {
    code: "task_list_has_active_contents",
    currentRevisions: { destinationList: null, project: null, sourceList: 1, task: null },
    openContentCounts: { tasks: 2, projects: 1 },
    resolutions: ["move_active_contents", "archive_contents_together", "cancel"],
  };
  h.api.archiveTaskList.mockRejectedValueOnce(
    new ApiClientError({ status: 409, code: "CONFLICT", message: "Active contents", details }),
  );
  render(<ContainerEditorScreen />);
  fireEvent.click(screen.getByRole("button", { name: "Archive" }));
  await screen.findByText("resolve open contents");
  expect(screen.getByRole("button", { name: "move active contents" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Destination list, None" }));
  fireEvent.click(screen.getByRole("button", { name: "Inbox" }));
  fireEvent.click(screen.getByRole("button", { name: "move active contents" }));
  await waitFor(() =>
    expect(h.api.archiveTaskList).toHaveBeenLastCalledWith(garden.id, {
      expectedRevision: 1,
      resolution: "move_active_contents",
      destinationListId: inbox.id,
    }),
  );
  await waitFor(() => expect(h.back).toHaveBeenCalledOnce());
});
it("edits fallback due-date fields inline and clears them without a timezone selector", async () => {
  render(<TaskEditorScreen />);
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Plan meals" } });
  fireEvent.change(screen.getByLabelText("Due date (ISO date/time)"), {
    target: { value: "2026-12-01T12:00:00Z" },
  });
  fireEvent.change(screen.getByLabelText("Reserved time (ISO date/time)"), {
    target: { value: "2026-12-01T11:00:00Z" },
  });
  fireEvent.change(screen.getByLabelText("Due date (ISO date/time)"), { target: { value: "" } });
  fireEvent.click(save());
  await waitFor(() =>
    expect(h.api.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        dueAt: null,
        scheduledAt: "2026-12-01T11:00:00Z",
        timezone: "America/New_York",
      }),
    ),
  );
  expect(screen.queryByLabelText(/time zone/i)).not.toBeInTheDocument();
});
it("offers resource retries when task organization cannot load", () => {
  h.resourceError = true;
  render(<TaskEditorScreen />);
  for (const label of ["Retry task organization", "Retry lists", "Retry projects"])
    fireEvent.click(screen.getByRole("button", { name: label }));
  expect(h.refetch).toHaveBeenCalledTimes(5);
});
it("does not invent a task timezone when account configuration is unavailable", async () => {
  h.timezone = undefined;
  render(<TaskEditorScreen />);
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Plan meals" } });
  fireEvent.click(save());
  await waitFor(() => expect(h.error).toHaveBeenCalled());
  expect(h.api.createTask).not.toHaveBeenCalled();
  expect(h.back).not.toHaveBeenCalled();
});
it.each([
  "complete open tasks",
  "cancel open tasks",
  "move open tasks",
])("resolves project completion using %s only after confirmation", async (resolution) => {
  h.params = { kind: "project", id: garden.id };
  h.record = { ...garden, listId: inbox.id, lifecycle: "open", notes: null };
  const details = {
    code: "task_project_has_open_tasks",
    currentRevisions: { destinationList: null, project: 1, sourceList: 1, task: null },
    openContentCounts: { tasks: 2, projects: 0 },
    resolutions: [
      "complete_open_tasks",
      "cancel_open_tasks",
      "move_open_tasks",
      "keep_project_open",
    ],
  };
  h.api.completeTaskProject.mockRejectedValueOnce(
    new ApiClientError({ status: 409, code: "CONFLICT", message: "Open tasks", details }),
  );
  render(<ContainerEditorScreen />);
  fireEvent.click(screen.getByRole("button", { name: "Record actions" }));
  fireEvent.click(screen.getByRole("button", { name: "Complete project" }));
  await screen.findByText("resolve open contents");
  if (resolution === "move open tasks") {
    expect(screen.getByRole("button", { name: resolution })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Destination list, None" }));
    fireEvent.click(screen.getByRole("button", { name: "Inbox" }));
    fireEvent.click(screen.getByRole("button", { name: "Destination project, None" }));
    fireEvent.click(screen.getByRole("button", { name: "None" }));
  }
  vi.mocked(window.confirm).mockReturnValue(false);
  fireEvent.click(screen.getByRole("button", { name: resolution }));
  expect(h.api.completeTaskProject).toHaveBeenCalledOnce();
  vi.mocked(window.confirm).mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: resolution }));
  await waitFor(() =>
    expect(h.api.completeTaskProject).toHaveBeenLastCalledWith(
      garden.id,
      expect.objectContaining({ expectedRevision: 1, resolution: resolution.replaceAll(" ", "_") }),
    ),
  );
  await waitFor(() => expect(h.back).toHaveBeenCalledOnce());
});
it("lets the user leave a conflicted project unchanged and exit a stale container editor", async () => {
  h.params = { kind: "project", id: garden.id };
  h.record = { ...garden, listId: inbox.id, lifecycle: "open", notes: null };
  const details = {
    code: "task_project_has_open_tasks",
    currentRevisions: { destinationList: null, project: 1, sourceList: 1, task: null },
    openContentCounts: { tasks: 1, projects: 0 },
    resolutions: [
      "complete_open_tasks",
      "cancel_open_tasks",
      "move_open_tasks",
      "keep_project_open",
    ],
  };
  h.api.completeTaskProject.mockRejectedValueOnce(
    new ApiClientError({ status: 409, code: "CONFLICT", message: "Open tasks", details }),
  );
  render(<ContainerEditorScreen />);
  fireEvent.click(screen.getByRole("button", { name: "Record actions" }));
  fireEvent.click(screen.getByRole("button", { name: "Complete project" }));
  fireEvent.click(await screen.findByRole("button", { name: "Keep unchanged" }));
  expect(screen.queryByText("resolve open contents")).not.toBeInTheDocument();
  expect(h.back).not.toHaveBeenCalled();
  h.api.updateTaskProject.mockRejectedValueOnce(
    new ApiClientError({ status: 409, code: "CONFLICT", message: "Stale" }),
  );
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Changed" } });
  fireEvent.click(save());
  fireEvent.click(
    await screen.findByRole("button", { name: "Close and reopen to load current version" }),
  );
  expect(h.back).toHaveBeenCalledOnce();
});
it.each([
  { listId: "unavailable-list" },
  { projectId: "unavailable-project" },
])("protects a task whose organization is unavailable: %j", (overrides) => {
  h.params = { kind: "task", id: garden.id };
  h.record = { ...existingTask(), ...overrides };
  render(<TaskEditorScreen />);
  expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Record actions" }));
  expect(screen.getByRole("button", { name: "Complete" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Move to Trash" })).toBeDisabled();
});
it.each([
  422, 503,
])("distinguishes a rejected task creation from an uncertain server failure (%s)", async (status) => {
  h.api.createTask.mockRejectedValueOnce(
    new ApiClientError({ status, code: "REQUEST_FAILED", message: "Unable to save" }),
  );
  render(<TaskEditorScreen />);
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Plan meals" } });
  fireEvent.click(save());
  await waitFor(() => expect(h.error).toHaveBeenCalled());
  expect(h.back).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Title")).toHaveValue("Plan meals");
  if (status >= 500)
    expect(screen.getByRole("button", { name: "Retry the same task creation" })).toBeVisible();
  else
    expect(
      screen.queryByRole("button", { name: "Retry the same task creation" }),
    ).not.toBeInTheDocument();
});

it.each([
  "task",
  "list",
])("reopens a %s editor with fresh visible fields and a current revision after a successful edit", async (kind) => {
  h.liveQueries = true;
  h.params = { kind, id: garden.id };
  let serverRecord =
    kind === "task"
      ? existingTask()
      : { ...garden, name: "Original list", icon: "list", color: null, description: null };
  const get = kind === "task" ? h.api.getTask : h.api.getTaskList;
  const update = kind === "task" ? h.api.updateTask : h.api.updateTaskList;
  get.mockImplementation(async () => serverRecord);
  update.mockImplementation(async (_id, values) => {
    serverRecord = { ...serverRecord, ...values, revision: 8 };
    return serverRecord;
  });
  const Editor = kind === "task" ? TaskEditorScreen : ContainerEditorScreen;
  const frame = (visible: boolean) => (
    <MobileDataProvider>{visible ? <Editor /> : null}</MobileDataProvider>
  );
  const { rerender } = render(frame(true));
  await screen.findByLabelText("Title");
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Accepted edit" } });
  fireEvent.click(save());
  await waitFor(() => expect(h.back).toHaveBeenCalledOnce());
  expect(get).toHaveBeenCalledOnce();
  rerender(frame(false));
  let finish!: (value: unknown) => void;
  get.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  rerender(frame(true));
  expect(screen.queryByLabelText("Title")).not.toBeInTheDocument();
  await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  await act(async () => finish(serverRecord));
  await waitFor(() => expect(screen.getByLabelText("Title")).toHaveValue("Accepted edit"));
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Second edit" } });
  fireEvent.click(save());
  await waitFor(() =>
    expect(update).toHaveBeenLastCalledWith(
      garden.id,
      expect.objectContaining({ expectedRevision: 8 }),
    ),
  );
});

it.each([
  "task",
  "list",
])("does not expose a stale %s form when reopening fails, and can retry", async (kind) => {
  h.liveQueries = true;
  h.params = { kind, id: garden.id };
  const original =
    kind === "task"
      ? existingTask()
      : { ...garden, name: "Original list", icon: "list", color: null, description: null };
  const get = kind === "task" ? h.api.getTask : h.api.getTaskList;
  get.mockResolvedValueOnce(original).mockRejectedValueOnce(new Error("offline"));
  const Editor = kind === "task" ? TaskEditorScreen : ContainerEditorScreen;
  const frame = (visible: boolean) => (
    <MobileDataProvider>{visible ? <Editor /> : null}</MobileDataProvider>
  );
  const { rerender } = render(frame(true));
  await screen.findByLabelText("Title");
  rerender(frame(false));
  rerender(frame(true));
  const retry = await screen.findByRole("button", { name: "Retry loading" });
  expect(screen.queryByLabelText("Title")).not.toBeInTheDocument();
  expect(h.error).toHaveBeenCalledOnce();
  get.mockResolvedValue({ ...original, title: "Current task", name: "Current list" });
  fireEvent.click(retry);
  await waitFor(() =>
    expect(screen.getByLabelText("Title")).toHaveValue(
      kind === "task" ? "Current task" : "Current list",
    ),
  );
});

it.each([
  "task",
  "reminder",
])("loads a trashed %s through the Trash projection and restores its current version", async (kind) => {
  h.liveQueries = true;
  h.params = { kind, id: garden.id, deleted: "1" };
  const record = {
    ...existingTask(),
    updatedAt: "2026-11-06T12:00:00Z",
    deletedAt: "2026-11-06T11:00:00Z",
  };
  h.api.listTaskWorkspace
    .mockResolvedValueOnce({ items: [], nextCursor: "second" })
    .mockResolvedValueOnce({ items: [{ kind, record }], nextCursor: null });
  render(
    <MobileDataProvider>
      <TaskEditorScreen />
    </MobileDataProvider>,
  );
  await screen.findByLabelText("Title");
  expect(h.api.listTaskWorkspace).toHaveBeenLastCalledWith({
    view: "trash",
    kind,
    limit: 100,
    cursor: "second",
  });
  expect(h.api.getTask).not.toHaveBeenCalled();
  expect(h.api.getReminder).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Restore" }));
  await waitFor(() => expect(h.back).toHaveBeenCalled());
  if (kind === "task")
    expect(h.api.restoreTask).toHaveBeenCalledWith(garden.id, { expectedRevision: 4 });
  else expect(h.api.restoreReminder).toHaveBeenCalledWith(garden.id, record.updatedAt);
});
it("keeps Close accessible when an item is no longer in Trash", async () => {
  h.liveQueries = true;
  h.params = { kind: "task", id: garden.id, deleted: "1" };
  h.api.listTaskWorkspace.mockResolvedValue({ items: [], nextCursor: null });
  render(
    <MobileDataProvider>
      <TaskEditorScreen />
    </MobileDataProvider>,
  );
  await screen.findByRole("button", { name: "Retry loading" });
  expect(h.error).toHaveBeenCalledWith(
    "This item is no longer in Trash. Close this screen and refresh Trash.",
  );
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(h.back).toHaveBeenCalledOnce();
});

it.each([
  "task",
  "list",
])("isolates the %s initial-load gate when route identity changes A to pending B to A", async (kind) => {
  h.liveQueries = true;
  h.params = { kind, id: garden.id };
  const original =
    kind === "task"
      ? existingTask()
      : { ...garden, name: "Original list", icon: "list", color: null, description: null };
  const get = kind === "task" ? h.api.getTask : h.api.getTaskList;
  get.mockResolvedValueOnce(original).mockImplementationOnce(() => new Promise(() => {}));
  const Editor = kind === "task" ? TaskEditorScreen : ContainerEditorScreen;
  const { rerender } = render(
    <MobileDataProvider>
      <Editor />
    </MobileDataProvider>,
  );
  await screen.findByLabelText("Title");
  h.params = { kind, id: "another" };
  rerender(
    <MobileDataProvider>
      <Editor />
    </MobileDataProvider>,
  );
  expect(screen.queryByLabelText("Title")).not.toBeInTheDocument();
  expect(h.headerOptions.headerRight).toBeUndefined();
  let finish!: (value: unknown) => void;
  get.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  h.params = { kind, id: garden.id };
  rerender(
    <MobileDataProvider>
      <Editor />
    </MobileDataProvider>,
  );
  expect(screen.queryByLabelText("Title")).not.toBeInTheDocument();
  expect(h.headerOptions.headerRight).toBeUndefined();
  await waitFor(() => expect(get).toHaveBeenCalledTimes(3));
  await act(async () => finish({ ...original, title: "Updated task", name: "Updated list" }));
  await waitFor(() =>
    expect(screen.getByLabelText("Title")).toHaveValue(
      kind === "task" ? "Updated task" : "Updated list",
    ),
  );
});

it("closes an unavailable existing container without inventing an editable record", () => {
  h.params = { kind: "list", id: garden.id };
  h.isError = true;
  render(<ContainerEditorScreen />);
  expect(screen.queryByLabelText("Title")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(h.back).toHaveBeenCalledOnce();
  expect(h.api.updateTaskList).not.toHaveBeenCalled();
});
it("retains a reviewed list appearance in the draft and submits its identity only on Save", async () => {
  h.params = { kind: "list" };
  render(<ContainerEditorScreen />);
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Home improvements" } });
  fireEvent.click(screen.getByRole("button", { name: "Edit list icon and color" }));
  fireEvent.click(screen.getByRole("button", { name: "home icon" }));
  fireEvent.click(screen.getByRole("button", { name: "#22c55e" }));
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(h.api.createTaskList).not.toHaveBeenCalled();
  fireEvent.click(save());
  await waitFor(() =>
    expect(h.api.createTaskList).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Home improvements", icon: "home", color: "#22c55e" }),
    ),
  );
});
