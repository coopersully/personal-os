// @vitest-environment jsdom
import type { TaskWorkspaceItem } from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { PropsWithChildren, ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import TaskPreferencesScreen from "../../app/task-preferences";
import { MobileDataProvider } from "./data";
import { TasksHub } from "./hub";
import { TaskListScreen } from "./task-list";

vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
vi.mock("@tanstack/react-query", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/apps/web/package.json`)("@tanstack/react-query");
});
vi.mock("react-native", () => import("../../../test/native"));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children }: PropsWithChildren) => <div>{children}</div>,
  useSafeAreaInsets: () => ({ bottom: 20, top: 0 }),
}));
vi.mock("expo-glass-effect", () => ({
  isLiquidGlassAvailable: () => false,
  GlassView: ({ children }: PropsWithChildren) => <div>{children}</div>,
}));
const h = vi.hoisted(() => ({
  epoch: 1,
  items: [] as TaskWorkspaceItem[],
  lists: [] as object[],
  projects: [] as object[],
  preferences: {
    pinnedListIds: [] as string[],
    pinnedProjectIds: [] as string[],
    taskSort: "default",
    taskGroup: "none",
    showCompletedTasks: false,
    taskContainerSort: "name",
    taskRowDetails: ["estimate"],
    includeArchivedInSearch: true,
  },
  listTaskWorkspace: vi.fn(),
  listTaskLists: vi.fn(),
  listTaskProjects: vi.fn(),
  getWorkspaceSettings: vi.fn(),
  updateWorkspaceSettings: vi.fn(),
  completeTask: vi.fn(),
  reopenTask: vi.fn(),
  trashTask: vi.fn(),
  restoreTask: vi.fn(),
  cancelTask: vi.fn(),
  completeReminder: vi.fn(),
  trashReminder: vi.fn(),
  restoreReminder: vi.fn(),
  push: vi.fn(),
  back: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  loading: vi.fn(() => "task-toast"),
}));
vi.mock("../auth/context", () => ({
  useOptionalAuth: () => null,
  useAuth: () => ({
    state: { user: { id: "fixture", planningTimezone: "UTC" } },
    session: { api: () => h, epoch: () => h.epoch },
  }),
}));
vi.mock("expo-router", () => ({
  router: { push: h.push, back: h.back },
  Stack: {
    Screen: ({
      options,
    }: {
      options: { headerRight?: () => ReactNode; headerLeft?: () => ReactNode };
    }) => (
      <div>
        {options.headerLeft?.()}
        {options.headerRight?.()}
      </div>
    ),
  },
}));
vi.mock("../../components/icons", () => ({
  Icon: ({ name, color }: { name: string; color: string }) => (
    <span data-icon={name} data-color={color} />
  ),
}));
vi.mock("sonner-native", () => ({ toast: h }));
const task = (id: string, overrides: object = {}) =>
  ({
    kind: "task",
    deletedAt: null,
    readOnly: false,
    groupKey: "none",
    relevantAt: null,
    record: {
      id,
      title: `Task ${id}`,
      notes: null,
      timezone: null,
      why: null,
      cancelledAt: null,
      completedAt: null,
      deletedAt: null,
      createdAt: "2026-11-01T12:00:00Z",
      updatedAt: "2026-11-01T12:00:00Z",
      legacyStatus: null,
      source: {
        accountId: null,
        provider: "local",
        remoteId: id,
        revision: "1",
        sourceType: "task",
      },
      revision: 1,
      lifecycle: "open",
      dueAt: null,
      scheduledAt: null,
      tags: [],
      priority: "medium",
      estimateMinutes: null,
      listId: "inbox",
      projectId: null,
      ...overrides,
    },
  }) as TaskWorkspaceItem;
const list = (id: string, name: string, overrides: object = {}) => ({
  id,
  name,
  kind: "list",
  availability: "active",
  deletedAt: null,
  revision: 1,
  description: null,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-02",
  ...overrides,
});
const project = (id: string, name: string, overrides: object = {}) => ({
  ...list(id, name),
  listId: "inbox",
  lifecycle: "open",
  targetDate: null,
  ...overrides,
});
beforeEach(() => {
  vi.clearAllMocks();
  h.epoch = 1;
  h.items = [task("one")];
  h.lists = [list("inbox", "Inbox", { kind: "inbox" })];
  h.projects = [];
  h.preferences = {
    pinnedListIds: [],
    pinnedProjectIds: [],
    taskSort: "default",
    taskGroup: "none",
    showCompletedTasks: false,
    taskContainerSort: "name",
    taskRowDetails: ["estimate"],
    includeArchivedInSearch: true,
  };
  h.listTaskWorkspace
    .mockReset()
    .mockImplementation(async () => ({ items: h.items, total: h.items.length, nextCursor: null }));
  h.listTaskLists
    .mockReset()
    .mockImplementation(async () => ({ items: h.lists, nextCursor: null }));
  h.listTaskProjects
    .mockReset()
    .mockImplementation(async () => ({ items: h.projects, nextCursor: null }));
  h.getWorkspaceSettings
    .mockReset()
    .mockImplementation(async () => ({ revision: 3, preferences: h.preferences }));
  h.updateWorkspaceSettings.mockReset().mockImplementation(async (_workspace, input) => {
    Object.assign(h.preferences, input.preferences);
    return { revision: 4, preferences: h.preferences };
  });
  for (const operation of [
    h.completeTask,
    h.reopenTask,
    h.trashTask,
    h.restoreTask,
    h.cancelTask,
    h.completeReminder,
    h.trashReminder,
    h.restoreReminder,
  ])
    operation
      .mockReset()
      .mockResolvedValue({ id: "one", revision: 7, updatedAt: "2026-11-06T12:00:00Z" });
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const show = (props: Partial<Parameters<typeof TaskListScreen>[0]> = {}) =>
  render(
    <MobileDataProvider>
      <TaskListScreen title="to-do" scope={{ view: "all" }} {...props} />
    </MobileDataProvider>,
  );
const loaded = () => screen.findByRole("button", { name: "Open task: Task one" });
const openOptions = () =>
  fireEvent.click(screen.getByRole("button", { name: "Task view options" }));
const filters = () => {
  openOptions();
  fireEvent.click(screen.getByRole("button", { name: "Filters…" }));
};
it("requests today's automatic view, paginates, opens records and keeps add context", async () => {
  h.items = [task("one", { dueAt: "2020-01-01T12:00:00Z" })];
  h.listTaskWorkspace.mockImplementation(async (query) => ({
    items: query.cursor ? [task("two")] : h.items,
    total: 2,
    nextCursor: query.cursor ? null : "page-two",
  }));
  show({
    standalone: true,
    scope: { view: "all", listId: "inbox", sort: "auto" },
    initialFilters: { due: "today" },
  });
  await loaded();
  expect(h.listTaskWorkspace).toHaveBeenCalledWith(
    expect.objectContaining({ due: "today", sort: "auto", listId: "inbox", limit: 30 }),
  );
  expect(screen.getByText(/Overdue/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Load more" }));
  await screen.findByText("Task two");
  expect(h.listTaskWorkspace).toHaveBeenCalledWith(expect.objectContaining({ cursor: "page-two" }));
  fireEvent.click(await loaded());
  expect(h.push).toHaveBeenCalledWith({
    pathname: "/task-editor",
    params: { id: "one", kind: "task", readOnly: "0", deleted: "0" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add task" }));
  expect(h.push).toHaveBeenLastCalledWith({
    pathname: "/task-editor",
    params: { kind: "task", listId: "inbox", projectId: undefined },
  });
  const calls = h.listTaskWorkspace.mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: "Refresh list" }));
  await waitFor(() => expect(h.listTaskWorkspace.mock.calls.length).toBeGreaterThan(calls));
});
it("applies progressive filters and sorting, displays active chips and resets the view", async () => {
  show({ standalone: true, initialFilters: { due: "today" } });
  await loaded();
  openOptions();
  fireEvent.click(screen.getByRole("button", { name: "Sort by, Recommended" }));
  fireEvent.click(screen.getByRole("radio", { name: "Priority" }));
  await waitFor(() =>
    expect(h.listTaskWorkspace).toHaveBeenLastCalledWith(
      expect.objectContaining({ sort: "priority" }),
    ),
  );
  filters();
  fireEvent.click(screen.getByRole("button", { name: "Priority, Any" }));
  fireEvent.click(screen.getByRole("radio", { name: "High" }));
  fireEvent.change(screen.getByLabelText("Tag"), { target: { value: " errands " } });
  fireEvent.click(screen.getByRole("button", { name: "Save sort and grouping as defaults" }));
  await waitFor(() =>
    expect(h.updateWorkspaceSettings).toHaveBeenCalledWith("tasks", {
      expectedRevision: 3,
      preferences: { taskSort: "priority", taskGroup: "none" },
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(screen.getByRole("button", { name: "Remove Priority: High" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Remove Priority: High" }));
  fireEvent.change(screen.getByLabelText("Search tasks"), { target: { value: "garden" } });
  await waitFor(() =>
    expect(h.listTaskWorkspace).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: "garden", tag: "errands" }),
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Remove Search: garden" }));
  fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
  await waitFor(() => expect(h.listTaskWorkspace.mock.calls.at(-1)?.[0]).not.toHaveProperty("due"));
  openOptions();
  fireEvent.click(screen.getByRole("button", { name: "Reset view" }));
  await waitFor(() =>
    expect(h.listTaskWorkspace).toHaveBeenLastCalledWith(expect.objectContaining({ due: "today" })),
  );
});
it("completes a task and reverses only its confirmed revision through Sonner", async () => {
  show();
  await loaded();
  fireEvent.click(screen.getByRole("checkbox", { name: "Complete Task one" }));
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith(
      "1 completed",
      expect.objectContaining({ action: expect.objectContaining({ label: "Undo" }) }),
    ),
  );
  expect(h.completeTask).toHaveBeenCalledWith("one", { expectedRevision: 1 });
  const options = h.success.mock.calls[0][1];
  await act(async () => options.action.onClick());
  expect(h.reopenTask).toHaveBeenCalledWith("one", { expectedRevision: 7 });
  expect(screen.queryByText("1 completed")).not.toBeInTheDocument();
});
it("keeps failed bulk items selected and offers Undo only for confirmed changes", async () => {
  h.items = [task("one"), task("two")];
  h.completeTask
    .mockRejectedValueOnce(new Error("conflict"))
    .mockResolvedValueOnce({ id: "two", revision: 7 });
  show();
  fireEvent.contextMenu(await loaded());
  fireEvent.click(screen.getByRole("checkbox", { name: "Select Task two" }));
  fireEvent.click(screen.getByRole("button", { name: "Complete" }));
  await waitFor(() =>
    expect(h.error).toHaveBeenCalledWith(
      "1 completed; 1 not confirmed. Refresh before retrying.",
      expect.anything(),
    ),
  );
  expect(screen.getByText("1 selected")).toBeVisible();
  await act(async () => h.error.mock.calls[0][1].action.onClick());
  expect(h.reopenTask).toHaveBeenCalledExactlyOnceWith("two", { expectedRevision: 7 });
});
it("does not report success if every selected mutation fails", async () => {
  h.completeTask.mockRejectedValue(new Error("offline"));
  show();
  fireEvent.contextMenu(await loaded());
  fireEvent.click(screen.getByRole("button", { name: "Complete" }));
  await waitFor(() => expect(h.error).toHaveBeenCalled());
  expect(h.success).not.toHaveBeenCalled();
  expect(screen.getByText("1 selected")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByText("1 selected")).not.toBeInTheDocument();
});
it("confirms trash and exposes a guarded restore through Undo", async () => {
  show();
  fireEvent.contextMenu(await loaded());
  vi.mocked(globalThis.confirm).mockReturnValueOnce(false);
  fireEvent.click(screen.getByRole("button", { name: "Trash" }));
  expect(h.trashTask).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Trash" }));
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith("1 moved to Trash", expect.anything()),
  );
  await act(async () => h.success.mock.calls[0][1].action.onClick());
  expect(h.restoreTask).toHaveBeenCalledWith("one", { expectedRevision: 7 });
});
it("disables direct changes to read-only records while keeping details accessible", async () => {
  h.items = [{ ...task("one"), readOnly: true }];
  show();
  await loaded();
  expect(screen.getByRole("checkbox", { name: "Complete Task one" })).toBeDisabled();
  fireEvent.click(await loaded());
  expect(h.push).toHaveBeenLastCalledWith(
    expect.objectContaining({ params: expect.objectContaining({ readOnly: "1" }) }),
  );
  fireEvent.contextMenu(await loaded());
  expect(screen.queryByRole("button", { name: "Complete" })).not.toBeInTheDocument();
});
it("restores trashed selections and never adds new items from Trash", async () => {
  h.items = [{ ...task("one"), deletedAt: "2026-11-01T12:00:00Z" }];
  show({ standalone: true, scope: { view: "trash" } });
  fireEvent.contextMenu(await loaded());
  fireEvent.click(screen.getByRole("button", { name: "Restore" }));
  await waitFor(() => expect(h.restoreTask).toHaveBeenCalledWith("one", { expectedRevision: 1 }));
  expect(screen.queryByRole("button", { name: "Add task" })).not.toBeInTheDocument();
});
it("reopens completed selections and uses check glyphs inside the existing circles", async () => {
  h.items = [task("one", { lifecycle: "completed", completedAt: "2026-11-01T12:00:00Z" })];
  show({ scope: { view: "history" } });
  await loaded();
  expect(
    screen.getByRole("checkbox", { name: "Reopen Task one" }).querySelector('[data-icon="save"]'),
  ).not.toBeNull();
  fireEvent.contextMenu(await loaded());
  fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
  await waitFor(() => expect(h.reopenTask).toHaveBeenCalledWith("one", { expectedRevision: 1 }));
});
it("recovers a failed query using an explicit retry", async () => {
  h.listTaskWorkspace.mockRejectedValueOnce(new Error("offline"));
  show();
  fireEvent.click(await screen.findByRole("button", { name: "Retry loading" }));
  await loaded();
  expect(h.error).toHaveBeenCalled();
});
it("keeps pinned lists out of the directory, indicates permanent Inbox, and persists pin changes", async () => {
  h.lists.push(list("garden", "Garden", { description: "Balcony planting" }));
  h.preferences.pinnedListIds = ["garden"];
  render(
    <MobileDataProvider>
      <TasksHub mode="lists" />
    </MobileDataProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Open pinned list: Garden" }));
  expect(screen.queryByRole("button", { name: "Open Garden" })).not.toBeInTheDocument();
  expect(screen.getByText("Permanent")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Actions for Garden" }));
  fireEvent.click(screen.getByRole("button", { name: "Unpin Garden" }));
  await waitFor(() =>
    expect(h.updateWorkspaceSettings).toHaveBeenCalledWith("tasks", {
      expectedRevision: 3,
      preferences: { pinnedListIds: [] },
    }),
  );
  await screen.findByRole("button", { name: "Open Garden" });
  expect(screen.queryByText("Pinned lists")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Pin Inbox" }));
  await waitFor(() =>
    expect(h.updateWorkspaceSettings).toHaveBeenLastCalledWith(
      "tasks",
      expect.objectContaining({ preferences: { pinnedListIds: ["inbox"] } }),
    ),
  );
});
it("opens and edits active projects while keeping archived and deleted records separate", async () => {
  h.projects = [
    project("trip", "Trip", { targetDate: "2026-12-01" }),
    project("old", "Old", { availability: "archived" }),
    project("deleted", "Deleted", { deletedAt: "2026-01-01" }),
  ];
  render(
    <MobileDataProvider>
      <TasksHub mode="projects" />
    </MobileDataProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Open Trip" }));
  expect(screen.getByText(/^Inbox · Target .*2026$/)).toBeVisible();
  expect(screen.queryByText(/2026-12-01/)).not.toBeInTheDocument();
  expect(h.push).toHaveBeenLastCalledWith({
    pathname: "/task-browser",
    params: { title: "Trip", view: "all", kind: "task", projectId: "trip", listId: "inbox" },
  });
  expect(screen.queryByText("Old")).not.toBeInTheDocument();
  expect(screen.queryByText("Deleted")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Actions for Trip" }));
  fireEvent.click(screen.getByRole("button", { name: "Edit Trip" }));
  expect(h.push).toHaveBeenLastCalledWith({
    pathname: "/task-container",
    params: { kind: "project", id: "trip" },
  });
});
it("reaches completed and cancelled projects through status chips and opens their finished work", async () => {
  h.projects = [
    project("trip", "Trip"),
    project("move", "Move", { lifecycle: "completed" }),
    project("boat", "Boat", { lifecycle: "cancelled" }),
    project("old", "Old", { lifecycle: "completed", availability: "archived" }),
  ];
  render(
    <MobileDataProvider>
      <TasksHub mode="projects" />
    </MobileDataProvider>,
  );
  await screen.findByRole("button", { name: "Open Trip" });
  expect(screen.getByRole("button", { name: "Active · 1" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(screen.queryByRole("button", { name: "Open Move" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Completed · 1" }));
  expect(screen.queryByRole("button", { name: "Open Trip" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Open Old" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Open Move, completed" }));
  expect(h.push).toHaveBeenLastCalledWith({
    pathname: "/task-browser",
    params: {
      title: "Move",
      view: "all",
      status: "all",
      kind: "task",
      projectId: "move",
      listId: "inbox",
    },
  });
  fireEvent.click(screen.getByRole("button", { name: "Cancelled · 1" }));
  expect(screen.getByRole("button", { name: "Open Boat, cancelled" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "All · 3" }));
  expect(screen.getByRole("button", { name: "Open Trip" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Open Move, completed" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Open Boat, cancelled" })).toBeVisible();
  expect(screen.getByText("Completed · Inbox")).toBeVisible();
  expect(screen.getByText("Cancelled · Inbox")).toBeVisible();
});
it("shows bare status chips, never a zero count, while projects are loading or failed", async () => {
  h.projects = [project("trip", "Trip")];
  h.listTaskProjects.mockReset().mockImplementation(() => new Promise(() => {}));
  const pending = render(
    <MobileDataProvider>
      <TasksHub mode="projects" />
    </MobileDataProvider>,
  );
  await waitFor(() => expect(h.listTaskLists).toHaveBeenCalled());
  for (const label of ["Active", "Completed", "Cancelled", "All"])
    expect(screen.getByRole("button", { name: label })).toBeVisible();
  expect(screen.queryByRole("button", { name: /· \d/ })).not.toBeInTheDocument();
  pending.unmount();
  h.listTaskProjects
    .mockReset()
    .mockRejectedValueOnce(new Error("offline"))
    .mockImplementation(async () => ({ items: h.projects, nextCursor: null }));
  render(
    <MobileDataProvider>
      <TasksHub mode="projects" />
    </MobileDataProvider>,
  );
  const retry = await screen.findByRole("button", { name: "Retry loading" });
  expect(screen.getByRole("button", { name: "Active" })).toBeVisible();
  expect(screen.queryByRole("button", { name: /· \d/ })).not.toBeInTheDocument();
  fireEvent.click(retry);
  expect(await screen.findByRole("button", { name: "Active · 1" })).toBeVisible();
});
it("names the status on a pinned finished project and says when there are no projects at all", async () => {
  h.projects = [project("move", "Move", { lifecycle: "completed" })];
  h.preferences.pinnedProjectIds = ["move"];
  const view = render(
    <MobileDataProvider>
      <TasksHub mode="projects" />
    </MobileDataProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Completed · 1" }));
  expect(
    await screen.findByRole("button", { name: "Open pinned project: Move, completed" }),
  ).toBeVisible();
  expect(screen.getByText("Completed")).toBeVisible();
  view.unmount();
  h.projects = [];
  h.preferences.pinnedProjectIds = [];
  render(
    <MobileDataProvider>
      <TasksHub mode="projects" />
    </MobileDataProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "All · 0" }));
  expect(await screen.findByText("No projects yet.")).toBeVisible();
});
it.each([
  ["completed", { lifecycle: "completed" }],
  ["cancelled", { lifecycle: "cancelled" }],
  ["archived", { availability: "archived" }],
])("offers no Add inside a %s project, where the server would reject the save", async (_name, state) => {
  h.projects = [project("move", "Move", state), project("trip", "Trip")];
  const view = show({
    standalone: true,
    scope: { view: "all", status: "all", projectId: "move", listId: "inbox" },
  });
  await loaded();
  await waitFor(() => expect(h.listTaskProjects).toHaveBeenCalled());
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Add task" })).not.toBeInTheDocument(),
  );
  view.unmount();
  show({ standalone: true, scope: { view: "all", projectId: "trip", listId: "inbox" } });
  await loaded();
  expect(screen.getByRole("button", { name: "Add task" })).toBeVisible();
});
it("offers no Add in a project whose list is archived, or before the project is known", async () => {
  h.lists.push(list("old", "Old list", { availability: "archived" }));
  h.projects = [project("attic", "Attic", { listId: "old" }), project("trip", "Trip")];
  const view = show({
    standalone: true,
    scope: { view: "all", status: "all", projectId: "attic", listId: "old" },
  });
  await loaded();
  await waitFor(() => expect(h.listTaskProjects).toHaveBeenCalled());
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Add task" })).not.toBeInTheDocument(),
  );
  view.unmount();
  h.listTaskProjects.mockReset().mockRejectedValue(new Error("offline"));
  show({ standalone: true, scope: { view: "all", projectId: "trip", listId: "inbox" } });
  await loaded();
  await waitFor(() => expect(h.listTaskProjects).toHaveBeenCalled());
  expect(screen.queryByRole("button", { name: "Add task" })).not.toBeInTheDocument();
});
it("explains an empty project status and keeps status chips off Lists", async () => {
  h.projects = [project("trip", "Trip")];
  const view = render(
    <MobileDataProvider>
      <TasksHub mode="projects" />
    </MobileDataProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Cancelled · 0" }));
  expect(await screen.findByText("No cancelled projects.")).toBeVisible();
  view.unmount();
  render(
    <MobileDataProvider>
      <TasksHub mode="lists" />
    </MobileDataProvider>,
  );
  await screen.findByRole("button", { name: "Open Inbox" });
  expect(screen.queryByRole("button", { name: /^Active/ })).not.toBeInTheDocument();
});
it("keeps Upcoming and History prominent and routes storage and type views independently", async () => {
  render(
    <MobileDataProvider>
      <TasksHub mode="views" />
    </MobileDataProvider>,
  );
  for (const [label, params] of [
    ["Upcoming", { view: "upcoming" }],
    ["History", { view: "history" }],
    ["Trash", { view: "trash" }],
    ["Tasks", { view: "all", kind: "task" }],
    ["Reminders", { view: "all", kind: "reminder" }],
    ["Scheduled", { view: "all", reserved: "scheduled", sort: "reserved" }],
    ["All tasks & reminders", { view: "all" }],
  ] as const) {
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(h.push).toHaveBeenLastCalledWith(
      expect.objectContaining({
        pathname: "/task-browser",
        params: expect.objectContaining(params),
      }),
    );
  }
  fireEvent.click(screen.getByRole("button", { name: "Archive" }));
  expect(h.push).toHaveBeenLastCalledWith({
    pathname: "/task-containers",
    params: { mode: "archive" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Task preferences" }));
  expect(h.push).toHaveBeenLastCalledWith("/task-preferences");
  expect(screen.queryByRole("button", { name: /Add/ })).not.toBeInTheDocument();
});
it("shows only archived containers and supports searching their names", async () => {
  h.lists.push(list("old", "Old list", { availability: "archived" }));
  h.projects = [project("inherited", "Inherited", { listId: "old" }), project("active", "Active")];
  render(
    <MobileDataProvider>
      <TasksHub mode="archive" />
    </MobileDataProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Open Inherited" }));
  expect(h.push).toHaveBeenLastCalledWith(
    expect.objectContaining({
      params: expect.objectContaining({ status: "all", projectId: "inherited" }),
    }),
  );
  expect(screen.queryByRole("button", { name: "Open Active" })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Search containers"), { target: { value: "Old list" } });
  expect(screen.queryByRole("button", { name: "Open Inherited" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Open Old list" })).toBeVisible();
});
it("saves task preferences with a searchable default list and the loaded revision", async () => {
  h.lists.push(
    list("garden", "Garden"),
    list("archived", "Archived list", { availability: "archived" }),
  );
  render(
    <MobileDataProvider>
      <TaskPreferencesScreen />
    </MobileDataProvider>,
  );
  await screen.findByRole("button", { name: "Default list, Inbox" });
  fireEvent.click(screen.getByRole("button", { name: "Default list, Inbox" }));
  expect(screen.queryByRole("button", { name: "Archived list" })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Search default list"), { target: { value: "garden" } });
  fireEvent.click(screen.getByRole("button", { name: "Garden" }));
  for (const [label, value] of [
    ["Sort, Recommended", "Priority"],
    ["Group, None", "List"],
    ["Container sort, Name (A–Z)", "Target date"],
  ] as const) {
    fireEvent.click(screen.getByRole("button", { name: label }));
    fireEvent.click(screen.getByRole("radio", { name: value }));
  }
  fireEvent.click(screen.getByRole("switch", { name: "Show completed tasks" }));
  fireEvent.click(screen.getByRole("switch", { name: "Show tags" }));
  fireEvent.click(screen.getByRole("switch", { name: "Show notes" }));
  fireEvent.click(screen.getByRole("switch", { name: "Include archived in search" }));
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(h.updateWorkspaceSettings).toHaveBeenCalledWith("tasks", {
      expectedRevision: 3,
      preferences: expect.objectContaining({
        defaultCaptureListId: "garden",
        taskSort: "priority",
        taskGroup: "list",
        taskContainerSort: "target",
        showCompletedTasks: true,
        taskRowDetails: ["estimate", "tags", "notes"],
        includeArchivedInSearch: false,
      }),
    }),
  );
  await waitFor(() => expect(h.success).toHaveBeenCalledWith("Saved", expect.anything()));
});
it("retries preferences loading and reports a save failure through Sonner", async () => {
  h.getWorkspaceSettings.mockRejectedValueOnce(new Error("offline"));
  render(
    <MobileDataProvider>
      <TaskPreferencesScreen />
    </MobileDataProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Retry loading" }));
  await screen.findByRole("button", { name: "Default list, Inbox" });
  h.updateWorkspaceSettings.mockRejectedValueOnce(new Error("offline"));
  h.error.mockClear();
  fireEvent.click(screen.getByRole("switch", { name: "Show completed tasks" }));
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(h.error).toHaveBeenCalledOnce());
  expect(screen.queryByText("offline")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Load latest preferences" })).toBeEnabled();
});
it("applies date boundaries and clears filters without losing sort or grouping", async () => {
  show();
  await loaded();
  filters();
  for (const label of ["Due after", "Due before", "Reserved after", "Reserved before"])
    fireEvent.change(screen.getByLabelText(`${label} (ISO date/time)`), {
      target: { value: "2026-12-01T12:00:00Z" },
    });
  await waitFor(() =>
    expect(h.listTaskWorkspace).toHaveBeenLastCalledWith(
      expect.objectContaining({
        dueAfter: "2026-12-01T12:00:00Z",
        dueBefore: "2026-12-01T12:00:00Z",
        scheduledAfter: "2026-12-01T12:00:00Z",
        scheduledBefore: "2026-12-01T12:00:00Z",
      }),
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Reset filters" }));
  await waitFor(() =>
    expect(h.listTaskWorkspace.mock.calls.at(-1)?.[0]).not.toHaveProperty("dueAfter"),
  );
  expect(h.listTaskWorkspace.mock.calls.at(-1)?.[0]).not.toHaveProperty("scheduledBefore");
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("edits a pinned project through its actions while keeping the regular directory deduplicated", async () => {
  h.projects = [project("garden", "Garden")];
  h.preferences.pinnedProjectIds = ["garden"];
  render(
    <MobileDataProvider>
      <TasksHub mode="projects" />
    </MobileDataProvider>,
  );
  await screen.findByRole("button", { name: "Open pinned project: Garden" });
  fireEvent.click(screen.getByRole("button", { name: "Actions for Garden" }));
  fireEvent.click(screen.getByRole("button", { name: "Edit Garden" }));
  expect(h.push).toHaveBeenCalledWith({
    pathname: "/task-container",
    params: { kind: "project", id: "garden" },
  });
  expect(screen.queryByRole("button", { name: "Open Garden" })).not.toBeInTheDocument();
});
it("recovers a failed container directory without inventing empty results", async () => {
  h.listTaskLists.mockRejectedValueOnce(new Error("offline"));
  render(
    <MobileDataProvider>
      <TasksHub mode="lists" />
    </MobileDataProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Retry loading" }));
  await screen.findByRole("button", { name: "Open Inbox" });
  expect(h.listTaskLists).toHaveBeenCalledTimes(2);
});
it.each([
  "list",
  "project",
])("labels %s groups, coalesces adjacent records and labels missing associations Ungrouped", async (group) => {
  h.lists.push(list("garden", "Garden list"));
  h.projects = [project("garden", "Garden project")];
  h.items = [
    { ...task("one"), groupKey: "garden" },
    { ...task("two"), groupKey: "garden" },
    task("three"),
  ];
  show({ scope: { view: "all", group: group as "list" | "project" } });
  await loaded();
  expect(screen.getAllByRole("heading", { name: `Garden ${group}` })).toHaveLength(1);
  expect(screen.getByRole("heading", { name: "Ungrouped" })).toBeVisible();
});
it("shows clear empty states and includes completed work only when preferences request it", async () => {
  h.items = [];
  h.preferences.showCompletedTasks = true;
  show();
  await screen.findByText("You’re all caught up here.");
  await waitFor(() =>
    expect(h.listTaskWorkspace).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "open_and_completed" }),
    ),
  );
  filters();
  fireEvent.change(screen.getByLabelText("Tag"), { target: { value: "errands" } });
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  await screen.findByText("No matches. Adjust your filters or search.");
});
it("reopens a completed selection and reports a rejected Undo without claiming success", async () => {
  h.items = [task("one", { lifecycle: "completed", completedAt: "2026-11-06T12:00:00Z" })];
  show({ scope: { view: "history" } });
  fireEvent.contextMenu(await loaded());
  fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
  await waitFor(() => expect(h.reopenTask).toHaveBeenCalledWith("one", { expectedRevision: 1 }));
  await waitFor(() => expect(h.success).toHaveBeenCalled());
  h.completeTask.mockRejectedValueOnce(new Error("changed"));
  const undo = h.success.mock.calls.at(-1)?.[1].action;
  await act(async () => undo.onClick());
  await waitFor(() => expect(h.error).toHaveBeenCalled());
  expect(h.success.mock.calls.map((call) => call[0])).not.toContain("Action undone");
});
it("limits batch controls to compatible selections and supports deselecting individual items", async () => {
  h.items = [task("one"), { ...task("two"), readOnly: true }];
  show();
  fireEvent.contextMenu(await loaded());
  fireEvent.click(screen.getByRole("button", { name: "Open task: Task two" }));
  expect(screen.getByText("2 selected")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Complete" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Open task: Task two" }));
  expect(screen.getByText("1 selected")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByText("1 selected")).not.toBeInTheDocument();
});
it.each([
  ["updated", ["Bravo", "Charlie", "Alpha"]],
  ["newest", ["Charlie", "Alpha", "Bravo"]],
  ["target", ["Charlie", "Bravo", "Alpha"]],
] as const)("orders the project directory by %s", async (sort, expected) => {
  h.preferences.taskContainerSort = sort;
  h.projects = [
    project("a", "Alpha", { createdAt: "2026-02-01", updatedAt: "2026-01-01", targetDate: null }),
    project("b", "Bravo", {
      createdAt: "2026-01-01",
      updatedAt: "2026-03-01",
      targetDate: "2026-12-01",
    }),
    project("c", "Charlie", {
      createdAt: "2026-03-01",
      updatedAt: "2026-02-01",
      targetDate: "2026-11-01",
    }),
  ];
  render(
    <MobileDataProvider>
      <TasksHub mode="projects" />
    </MobileDataProvider>,
  );
  await screen.findByRole("button", { name: "Open Alpha" });
  expect(
    screen
      .getAllByRole("button", { name: /^Open (Alpha|Bravo|Charlie)$/ })
      .map((node) => node.getAttribute("aria-label")),
  ).toEqual(expected.map((name) => `Open ${name}`));
});
it("clears each optional date boundary without sending an empty date string", async () => {
  show();
  await loaded();
  filters();
  for (const label of ["Due after", "Due before", "Reserved after", "Reserved before"]) {
    fireEvent.change(screen.getByLabelText(`${label} (ISO date/time)`), {
      target: { value: "2026-12-01T12:00:00Z" },
    });
    fireEvent.change(screen.getByLabelText(`${label} (ISO date/time)`), { target: { value: "" } });
  }
  fireEvent.change(screen.getByLabelText("Tag"), { target: { value: "errands" } });
  await waitFor(() =>
    expect(h.listTaskWorkspace.mock.calls.at(-1)?.[0]).toMatchObject({
      tag: "errands",
      dueAfter: undefined,
      dueBefore: undefined,
      scheduledAfter: undefined,
      scheduledBefore: undefined,
    }),
  );
});
it("includes projects inherited from archived lists but excludes deleted projects", async () => {
  h.lists = [list("old", "Old list", { availability: "archived" })];
  h.projects = [
    project("kept", "Kept project", { listId: "old" }),
    project("deleted", "Deleted project", { listId: "old", deletedAt: "2026-01-01" }),
  ];
  render(
    <MobileDataProvider>
      <TasksHub mode="archive" />
    </MobileDataProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Open Kept project" }));
  expect(h.push).toHaveBeenCalledWith({
    pathname: "/task-browser",
    params: expect.objectContaining({ projectId: "kept", listId: "old", status: "all" }),
  });
  expect(screen.queryByText("Deleted project")).not.toBeInTheDocument();
});
it("retries pinned preferences independently and unpins a saved project", async () => {
  h.projects = [project("garden", "Garden")];
  h.preferences.pinnedProjectIds = ["garden"];
  h.getWorkspaceSettings.mockRejectedValueOnce(new Error("offline"));
  render(
    <MobileDataProvider>
      <TasksHub mode="projects" />
    </MobileDataProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Retry pins" }));
  await screen.findByRole("button", { name: "Open pinned project: Garden" });
  fireEvent.click(screen.getByRole("button", { name: "Actions for Garden" }));
  fireEvent.click(screen.getByRole("button", { name: "Unpin Garden" }));
  await waitFor(() =>
    expect(h.updateWorkspaceSettings).toHaveBeenCalledWith("tasks", {
      expectedRevision: 3,
      preferences: { pinnedProjectIds: [] },
    }),
  );
  await screen.findByRole("button", { name: "Open Garden" });
  expect(screen.queryByText("Pinned projects")).not.toBeInTheDocument();
});
it("clears a custom capture list back to the default Inbox", async () => {
  h.lists = [list("garden", "Garden")];
  Object.assign(h.preferences, { defaultCaptureListId: "garden" });
  render(
    <MobileDataProvider>
      <TaskPreferencesScreen />
    </MobileDataProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Default list, Garden" }));
  fireEvent.click(screen.getByRole("button", { name: "Inbox" }));
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(h.updateWorkspaceSettings).toHaveBeenCalledWith(
      "tasks",
      expect.objectContaining({
        preferences: expect.objectContaining({ defaultCaptureListId: null }),
      }),
    ),
  );
});

function RefreshPreferencesFixture() {
  const query = useQueryClient();
  return (
    <button
      type="button"
      onClick={() => void query.refetchQueries({ queryKey: ["tasks", "settings"] })}
    >
      Background preferences refresh
    </button>
  );
}
it("retains the opened draft and reviewed revision when background preferences change", async () => {
  render(
    <MobileDataProvider>
      <TaskPreferencesScreen />
      <RefreshPreferencesFixture />
    </MobileDataProvider>,
  );
  await screen.findByRole("button", { name: "Default list, Inbox" });
  fireEvent.click(screen.getByRole("switch", { name: "Show notes" }));
  expect(screen.getByRole("switch", { name: "Show notes" })).toBeChecked();
  h.getWorkspaceSettings.mockResolvedValueOnce({
    revision: 19,
    preferences: { ...h.preferences, taskRowDetails: ["tags"] },
  });
  fireEvent.click(screen.getByRole("button", { name: "Background preferences refresh" }));
  await waitFor(() => expect(h.getWorkspaceSettings).toHaveBeenCalledTimes(2));
  await act(async () => {});
  expect(screen.getByRole("switch", { name: "Show notes" })).toBeChecked();
  expect(screen.getByRole("switch", { name: "Show tags" })).not.toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(h.updateWorkspaceSettings).toHaveBeenCalledWith(
      "tasks",
      expect.objectContaining({
        expectedRevision: 3,
        preferences: expect.objectContaining({ taskRowDetails: ["estimate", "notes"] }),
      }),
    ),
  );
});

it("blocks stale retries until latest preferences are explicitly reviewed, preserving the local draft and unrelated remote fields", async () => {
  render(
    <MobileDataProvider>
      <TaskPreferencesScreen />
    </MobileDataProvider>,
  );
  await screen.findByRole("button", { name: "Default list, Inbox" });
  fireEvent.click(screen.getByRole("switch", { name: "Show notes" }));
  h.updateWorkspaceSettings.mockRejectedValueOnce(new Error("Conflict"));
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  const reload = await screen.findByRole("button", { name: "Load latest preferences" });
  await waitFor(() => expect(reload).toBeEnabled());
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  expect(screen.getByRole("switch", { name: "Show notes" })).toBeChecked();
  h.getWorkspaceSettings.mockRejectedValueOnce(new Error("Read offline"));
  fireEvent.click(reload);
  await waitFor(() => expect(h.error).toHaveBeenCalledTimes(2));
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  h.getWorkspaceSettings.mockResolvedValue({
    revision: 19,
    preferences: { ...h.preferences, taskGroup: "list", taskRowDetails: ["tags"] },
  });
  vi.mocked(globalThis.confirm).mockReturnValueOnce(false);
  fireEvent.click(reload);
  await waitFor(() =>
    expect(globalThis.confirm).toHaveBeenCalledWith(
      expect.stringContaining("Review latest preferences"),
    ),
  );
  await waitFor(() => expect(reload).toBeEnabled());
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  fireEvent.click(reload);
  await waitFor(() => expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled());
  expect(screen.getByRole("button", { name: "Group, List" })).toBeTruthy();
  expect(screen.getByRole("switch", { name: "Show notes" })).toBeChecked();
  expect(globalThis.confirm).toHaveBeenLastCalledWith(
    expect.stringContaining("saved tags; your draft estimate, notes"),
  );
  expect(h.updateWorkspaceSettings).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(h.updateWorkspaceSettings).toHaveBeenLastCalledWith("tasks", {
      expectedRevision: 19,
      preferences: expect.objectContaining({
        taskGroup: "list",
        taskRowDetails: ["estimate", "notes"],
      }),
    }),
  );
});
it("recognizes an uncertain already-committed preference draft without sending it again", async () => {
  render(
    <MobileDataProvider>
      <TaskPreferencesScreen />
    </MobileDataProvider>,
  );
  await screen.findByRole("button", { name: "Default list, Inbox" });
  fireEvent.click(screen.getByRole("switch", { name: "Show notes" }));
  h.updateWorkspaceSettings.mockRejectedValueOnce(new Error("Response interrupted"));
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  const reload = await screen.findByRole("button", { name: "Load latest preferences" });
  await waitFor(() => expect(reload).toBeEnabled());
  h.getWorkspaceSettings.mockResolvedValue({
    revision: 4,
    preferences: { ...h.preferences, taskRowDetails: ["estimate", "notes"] },
  });
  fireEvent.click(reload);
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Load latest preferences" })).toBeNull(),
  );
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  expect(screen.getByRole("switch", { name: "Show notes" })).toBeChecked();
  expect(h.updateWorkspaceSettings).toHaveBeenCalledOnce();
});

it("closes untouched Task preferences, confirms dirty cancellation, and links notification controls without saving", async () => {
  render(
    <MobileDataProvider>
      <TaskPreferencesScreen />
    </MobileDataProvider>,
  );
  await screen.findByRole("button", { name: "Default list, Inbox" });
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(h.back).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "iPhone notifications" }));
  expect(h.push).toHaveBeenCalledWith("/settings/notifications");
  fireEvent.click(screen.getByRole("switch", { name: "Show notes" }));
  vi.mocked(globalThis.confirm).mockReturnValueOnce(false);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(h.back).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(h.back).toHaveBeenCalledTimes(2);
  expect(h.updateWorkspaceSettings).not.toHaveBeenCalled();
});

it("rejects an older authoritative preference reload and keeps the reviewed local draft locked", async () => {
  render(
    <MobileDataProvider>
      <TaskPreferencesScreen />
    </MobileDataProvider>,
  );
  await screen.findByRole("button", { name: "Default list, Inbox" });
  fireEvent.click(screen.getByRole("switch", { name: "Show notes" }));
  h.updateWorkspaceSettings.mockRejectedValueOnce(new Error("Conflict"));
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  const reload = await screen.findByRole("button", { name: "Load latest preferences" });
  await waitFor(() => expect(reload).toBeEnabled());
  h.getWorkspaceSettings.mockResolvedValueOnce({
    revision: 2,
    preferences: { ...h.preferences, taskRowDetails: [] },
  });
  fireEvent.click(reload);
  await waitFor(() => expect(h.error).toHaveBeenCalledTimes(2));
  expect(screen.getByRole("switch", { name: "Show notes" })).toBeChecked();
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  expect(h.updateWorkspaceSettings).toHaveBeenCalledOnce();
});
it("reviews an unavailable saved capture list and explicitly empty row details without losing local choices", async () => {
  h.lists = [list("garden", "Garden")];
  render(
    <MobileDataProvider>
      <TaskPreferencesScreen />
    </MobileDataProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Default list, Inbox" }));
  fireEvent.click(screen.getByRole("button", { name: "Garden" }));
  fireEvent.click(screen.getByRole("switch", { name: "Show estimate" }));
  fireEvent.click(screen.getByRole("switch", { name: "Include archived in search" }));
  h.updateWorkspaceSettings.mockRejectedValueOnce(new Error("Conflict"));
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  const reload = await screen.findByRole("button", { name: "Load latest preferences" });
  await waitFor(() => expect(reload).toBeEnabled());
  h.getWorkspaceSettings.mockResolvedValueOnce({
    revision: 4,
    preferences: {
      ...h.preferences,
      defaultCaptureListId: "missing",
      taskRowDetails: ["notes"],
      includeArchivedInSearch: true,
    },
  });
  fireEvent.click(reload);
  await waitFor(() =>
    expect(globalThis.confirm).toHaveBeenCalledWith(
      expect.stringContaining("saved Unavailable list; your draft Garden"),
    ),
  );
  expect(globalThis.confirm).toHaveBeenCalledWith(expect.stringContaining("your draft None"));
  expect(globalThis.confirm).toHaveBeenCalledWith(
    expect.stringContaining("saved On; your draft Off"),
  );
  await waitFor(() => expect(screen.getByRole("button", { name: "Save changes" })).toBeEnabled());
});
const lastQuery = () => h.listTaskWorkspace.mock.calls.at(-1)?.[0];
it("narrows a global view by List and Project, shows removable chips and clears each", async () => {
  h.lists.push(
    list("home", "Home"),
    list("work", "Work"),
    list("old", "Old list", { availability: "archived" }),
  );
  h.projects = [project("garden", "Garden", { listId: "home" }), project("taxes", "Taxes")];
  show({ initialFilters: { due: "today" } });
  await loaded();
  filters();
  fireEvent.click(await screen.findByRole("button", { name: "List, Any list" }));
  expect(screen.queryByRole("button", { name: "Old list" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Home" }));
  await waitFor(() =>
    expect(lastQuery()).toMatchObject({ listId: "home", kind: "task", due: "today" }),
  );
  // Lists and projects only hold tasks, so the Type choice no longer applies.
  expect(screen.queryByRole("button", { name: /^Type,/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Project, Any project" }));
  expect(screen.queryByRole("button", { name: "Taxes" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Garden" }));
  await waitFor(() => expect(lastQuery()).toMatchObject({ listId: "home", projectId: "garden" }));
  expect(screen.getByRole("button", { name: "Remove List: Home" })).toBeVisible();
  // Each later step lands on a query not seen before, so the request itself is asserted.
  fireEvent.click(screen.getByRole("button", { name: "Priority, Any" }));
  fireEvent.click(screen.getByRole("radio", { name: "High" }));
  fireEvent.click(screen.getByRole("button", { name: "Remove Project: Garden" }));
  await waitFor(() => expect(lastQuery()).not.toHaveProperty("projectId"));
  expect(lastQuery()).toMatchObject({ listId: "home", priority: "high" });
  fireEvent.click(screen.getByRole("button", { name: "Remove List: Home" }));
  await waitFor(() => expect(lastQuery()).not.toHaveProperty("listId"));
  expect(lastQuery()).not.toHaveProperty("kind");
  expect(screen.queryByRole("button", { name: "Remove List: Home" })).not.toBeInTheDocument();
  // A project can be chosen on its own; choosing another list drops it.
  fireEvent.click(screen.getByRole("button", { name: "Project, Any project" }));
  fireEvent.click(screen.getByRole("button", { name: "Taxes" }));
  await waitFor(() => expect(lastQuery()).toMatchObject({ projectId: "taxes", kind: "task" }));
  expect(lastQuery()).not.toHaveProperty("listId");
  fireEvent.click(screen.getByRole("button", { name: "List, Any list" }));
  fireEvent.click(screen.getByRole("button", { name: "Work" }));
  await waitFor(() => expect(lastQuery()).toMatchObject({ listId: "work" }));
  expect(lastQuery()).not.toHaveProperty("projectId");
  expect(screen.queryByRole("button", { name: "Remove Project: Taxes" })).not.toBeInTheDocument();
  // Choosing Any list returns to a query already answered, so it is read from the screen.
  fireEvent.click(screen.getByRole("button", { name: "List, Work" }));
  fireEvent.click(screen.getByRole("button", { name: "Any list" }));
  expect(await screen.findByRole("button", { name: "List, Any list" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Remove List: Work" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "List, Any list" }));
  fireEvent.click(screen.getByRole("button", { name: "Work" }));
  await screen.findByRole("button", { name: "Remove List: Work" });
  // Reset filters drops every match, including the view's own due default.
  fireEvent.click(screen.getByRole("button", { name: "Reset filters" }));
  await waitFor(() => expect(lastQuery()).not.toHaveProperty("priority"));
  expect(lastQuery()).not.toHaveProperty("listId");
  expect(lastQuery()).not.toHaveProperty("due");
  // Reset view returns to the destination's defaults instead.
  fireEvent.click(screen.getByRole("button", { name: "List, Any list" }));
  fireEvent.click(screen.getByRole("button", { name: "Work" }));
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  openOptions();
  fireEvent.click(screen.getByRole("button", { name: "Reset view" }));
  expect(await screen.findByRole("button", { name: "Remove Due: Today & overdue" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Remove List: Work" })).not.toBeInTheDocument();
});
it("keeps a list, project or reminder scope out of the List and Project filters", async () => {
  h.projects = [project("garden", "Garden")];
  for (const scope of [
    { view: "all", listId: "inbox" },
    { view: "all", projectId: "garden" },
    { view: "all", kind: "reminder" },
  ] as const) {
    const view = show({ scope, standalone: true });
    await loaded();
    filters();
    expect(screen.getByRole("button", { name: "Priority, Any" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /^List,/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Project,/ })).not.toBeInTheDocument();
    expect(lastQuery()).toMatchObject(scope);
    view.unmount();
  }
});
it("does not offer List or Project choices before they load or for reminders", async () => {
  h.listTaskLists.mockImplementation(() => new Promise(() => {}));
  h.projects = [project("garden", "Garden")];
  show();
  await loaded();
  filters();
  expect(screen.getByRole("button", { name: "List, Any list" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Project, Any project" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Type, Tasks & reminders" }));
  fireEvent.click(screen.getByRole("radio", { name: "Reminders" }));
  await waitFor(() => expect(lastQuery()).toMatchObject({ kind: "reminder" }));
  expect(screen.getByRole("button", { name: "List, Any list" })).toBeDisabled();
});
it("applies and clears the Today, Tomorrow and Next 7 days due shortcuts", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-14T15:00:00Z"));
  show({ initialFilters: { due: "today" } });
  await loaded();
  filters();
  let current = "Any time";
  for (const [label, dueAfter, dueBefore] of [
    ["Today", "2026-11-14T00:00:00.000Z", "2026-11-14T23:59:59.999Z"],
    ["Tomorrow", "2026-11-15T00:00:00.000Z", "2026-11-15T23:59:59.999Z"],
    ["Next 7 days", "2026-11-14T00:00:00.000Z", "2026-11-20T23:59:59.999Z"],
  ]) {
    fireEvent.click(screen.getByRole("button", { name: `Due within, ${current}` }));
    fireEvent.click(screen.getByRole("radio", { name: label }));
    await waitFor(() => expect(lastQuery()).toMatchObject({ dueAfter, dueBefore }));
    // A shortcut replaces the view's "Today & overdue" default instead of contradicting it.
    expect(lastQuery()).not.toHaveProperty("due");
    expect(screen.getByRole("button", { name: `Remove Due within: ${label}` })).toBeVisible();
    expect(screen.queryByRole("button", { name: /^Remove Due (after|before)/ })).toBeNull();
    current = label;
  }
  fireEvent.click(screen.getByRole("button", { name: "Due within, Next 7 days" }));
  fireEvent.click(screen.getByRole("radio", { name: "Any time" }));
  await waitFor(() => expect(lastQuery()).not.toHaveProperty("dueAfter"));
  expect(lastQuery()).not.toHaveProperty("dueBefore");
  fireEvent.click(screen.getByRole("button", { name: "Due within, Any time" }));
  fireEvent.click(screen.getByRole("radio", { name: "Tomorrow" }));
  // Both of these queries were already answered, so the cleared state is read from the screen.
  fireEvent.click(await screen.findByRole("button", { name: "Remove Due within: Tomorrow" }));
  expect(await screen.findByRole("button", { name: "Due within, Any time" })).toBeVisible();
  expect(screen.queryByRole("button", { name: /^Remove Due/ })).toBeNull();
  // A hand-picked boundary is a custom range and keeps its own chips.
  fireEvent.click(screen.getByRole("button", { name: "Due within, Any time" }));
  fireEvent.click(screen.getByRole("radio", { name: "Today" }));
  fireEvent.change(screen.getByLabelText("Due before (ISO date/time)"), {
    target: { value: "2026-11-16T12:00:00.000Z" },
  });
  expect(await screen.findByRole("button", { name: "Due within, Custom range" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Remove Due before: Nov 16" })).toBeVisible();
  // A due state such as Overdue cannot also carry a date range.
  fireEvent.click(screen.getByRole("button", { name: "Due, Any" }));
  fireEvent.click(screen.getByRole("radio", { name: "Overdue" }));
  await waitFor(() => expect(lastQuery()).toMatchObject({ due: "overdue" }));
  expect(lastQuery()).not.toHaveProperty("dueAfter");
  expect(lastQuery()).not.toHaveProperty("dueBefore");
});
it("says when lists and projects could not be read and offers a retry", async () => {
  h.listTaskLists.mockRejectedValue(new Error("offline"));
  show();
  await loaded();
  filters();
  expect(await screen.findByRole("button", { name: "List, Unavailable" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Project, Unavailable" })).toBeDisabled();
  h.listTaskLists.mockImplementation(async () => ({ items: h.lists, nextCursor: null }));
  fireEvent.click(screen.getByRole("button", { name: "Retry loading lists and projects" }));
  expect(await screen.findByRole("button", { name: "List, Any list" })).toBeEnabled();
  expect(screen.queryByRole("button", { name: "Retry loading lists and projects" })).toBeNull();
});
function RefreshDirectoryFixture() {
  const query = useQueryClient();
  return (
    <button
      type="button"
      onClick={() => void query.refetchQueries({ queryKey: ["tasks", "lists"] })}
    >
      Background directory refresh
    </button>
  );
}
it("keeps cached lists and projects usable when a refresh fails, reports it through Sonner and offers a retry", async () => {
  h.lists.push(list("home", "Home"));
  render(
    <MobileDataProvider>
      <TaskListScreen title="to-do" scope={{ view: "all" }} />
      <RefreshDirectoryFixture />
    </MobileDataProvider>,
  );
  await loaded();
  filters();
  expect(await screen.findByRole("button", { name: "List, Any list" })).toBeEnabled();
  expect(screen.queryByRole("button", { name: "Retry loading lists and projects" })).toBeNull();
  h.listTaskLists.mockRejectedValue(new Error("offline"));
  fireEvent.click(screen.getByRole("button", { name: "Background directory refresh" }));
  fireEvent.click(await screen.findByRole("button", { name: "Retry loading lists and projects" }));
  // The failure is one Sonner error, never copy in the sheet, and the choices already read stay.
  expect(h.error).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/offline|could not|couldn/i)).toBeNull();
  expect(screen.getByRole("button", { name: "Project, Any project" })).toBeEnabled();
  // A retry that fails again is said again, once.
  await waitFor(() => expect(h.error).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole("button", { name: "List, Any list" }));
  fireEvent.click(screen.getByRole("button", { name: "Home" }));
  await waitFor(() => expect(lastQuery()).toMatchObject({ listId: "home" }));
  h.listTaskLists.mockImplementation(async () => ({ items: h.lists, nextCursor: null }));
  fireEvent.click(screen.getByRole("button", { name: "Retry loading lists and projects" }));
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Retry loading lists and projects" })).toBeNull(),
  );
  expect(h.error).toHaveBeenCalledTimes(2);
});
it("keeps a project chosen on its own when its parent list is chosen", async () => {
  h.lists.push(list("home", "Home"), list("work", "Work"));
  h.projects = [project("garden", "Garden", { listId: "home" })];
  show();
  await loaded();
  filters();
  fireEvent.click(await screen.findByRole("button", { name: "Project, Any project" }));
  fireEvent.click(screen.getByRole("button", { name: "Garden" }));
  await waitFor(() => expect(lastQuery()).toMatchObject({ projectId: "garden" }));
  expect(lastQuery()).not.toHaveProperty("listId");
  fireEvent.click(screen.getByRole("button", { name: "List, Any list" }));
  fireEvent.click(screen.getByRole("button", { name: "Home" }));
  await waitFor(() => expect(lastQuery()).toMatchObject({ listId: "home", projectId: "garden" }));
  expect(screen.getByRole("button", { name: "Remove Project: Garden" })).toBeVisible();
  // Another list still drops it.
  fireEvent.click(screen.getByRole("button", { name: "List, Home" }));
  fireEvent.click(screen.getByRole("button", { name: "Work" }));
  await waitFor(() => expect(lastQuery()).toMatchObject({ listId: "work" }));
  expect(lastQuery()).not.toHaveProperty("projectId");
});
it("keeps a selected list or project that is no longer offered, so it can still be cleared", async () => {
  show({ initialFilters: { listId: "gone", projectId: "lost" } });
  await loaded();
  filters();
  // The row and the chip agree, instead of the row reading None.
  expect(await screen.findByRole("button", { name: "List, Unavailable" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Project, Unavailable" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Remove List: Unavailable" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "List, Unavailable" }));
  expect(screen.getByRole("button", { name: "Unavailable" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  fireEvent.click(screen.getByRole("button", { name: "Any list" }));
  await waitFor(() => expect(lastQuery()).not.toHaveProperty("listId"));
  expect(lastQuery()).not.toHaveProperty("projectId");
});
it("drops the view's due default when a due date is picked by hand", async () => {
  show({ initialFilters: { due: "today" } });
  await loaded();
  filters();
  fireEvent.change(screen.getByLabelText("Due after (ISO date/time)"), {
    target: { value: "2026-12-01T12:00:00Z" },
  });
  await waitFor(() => expect(lastQuery()).toMatchObject({ dueAfter: "2026-12-01T12:00:00Z" }));
  expect(lastQuery()).not.toHaveProperty("due");
  expect(screen.queryByRole("button", { name: /^Remove Due: / })).toBeNull();
});
it("draws a list's icon beside each list but none beside Any list", async () => {
  h.lists.push(list("home", "Home"));
  show();
  await loaded();
  filters();
  fireEvent.click(await screen.findByRole("button", { name: "List, Any list" }));
  expect(
    screen.getByRole("button", { name: "Home" }).querySelector('[data-icon="views"]'),
  ).not.toBeNull();
  expect(
    screen.getByRole("button", { name: "Any list" }).querySelector('[data-icon="views"]'),
  ).toBeNull();
});
it("names an archived selected list and project the same in the row and the chip", async () => {
  h.lists.push(list("old", "Old list", { availability: "archived" }));
  h.projects = [project("attic", "Attic", { listId: "old", availability: "archived" })];
  show({ initialFilters: { listId: "old", projectId: "attic" } });
  await loaded();
  filters();
  expect(await screen.findByRole("button", { name: "List, Old list" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Project, Attic" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Remove List: Old list" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Remove Project: Attic" })).toBeVisible();
  // It is kept only as the current selection, never offered as a fresh choice.
  fireEvent.click(screen.getByRole("button", { name: "Remove List: Old list" }));
  fireEvent.click(await screen.findByRole("button", { name: "List, Any list" }));
  expect(screen.queryByRole("button", { name: "Old list" })).not.toBeInTheDocument();
});
it("names a filter set before a failed read the same in the row and the chip", async () => {
  h.listTaskLists.mockRejectedValue(new Error("offline"));
  h.listTaskProjects.mockRejectedValue(new Error("offline"));
  show({ initialFilters: { listId: "home", projectId: "garden" } });
  await loaded();
  filters();
  expect(await screen.findByRole("button", { name: "List, Unavailable" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Project, Unavailable" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Remove List: Unavailable" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Remove Project: Unavailable" })).toBeVisible();
  expect(screen.queryByRole("button", { name: /, None$/ })).toBeNull();
});
const detailed = () =>
  task("one", {
    scheduledAt: "2026-11-06T09:30:00Z",
    estimateMinutes: 90,
    notes: "Bring the long ladder",
    tags: ["home", "errands"],
    listId: "house",
    projectId: "move",
  });
const withContainers = () => {
  h.lists.push(list("house", "House"));
  h.projects = [project("move", "Move", { listId: "house" })];
};
it("always shows the owning list, project and reserved time on a task row", async () => {
  withContainers();
  h.items = [detailed()];
  h.preferences.taskRowDetails = [];
  show();
  await loaded();
  // The container has its own line, so reserved time cannot push it out of view.
  expect(await screen.findByText("House / Move")).toBeVisible();
  expect(screen.getByText("Reserved Nov 6, 9:30 AM")).toBeVisible();
  expect(screen.queryByText(/1 hr 30 min/)).not.toBeInTheDocument();
  expect(screen.queryByText("Bring the long ladder")).not.toBeInTheDocument();
  expect(screen.queryByText("home")).not.toBeInTheDocument();
});
it.each([
  ["estimate", "Reserved Nov 6, 9:30 AM · 1 hr 30 min", ["Bring the long ladder", "home"]],
  ["notes", "Bring the long ladder", ["home", "errands"]],
  ["tags", "errands", ["Bring the long ladder"]],
] as const)("shows the %s row detail only when its preference is on", async (detail, shown, hidden) => {
  withContainers();
  h.items = [detailed()];
  h.preferences.taskRowDetails = [detail];
  show();
  await loaded();
  expect(await screen.findByText(shown)).toBeVisible();
  if (detail !== "estimate") expect(screen.queryByText(/1 hr 30 min/)).not.toBeInTheDocument();
  for (const text of hidden) expect(screen.queryByText(text)).not.toBeInTheDocument();
});
it("renders no detail line for a task with nothing to show and counts tags beyond the fifth", async () => {
  h.items = [
    task("one"),
    task("two", { tags: ["a", "b", "c", "d", "e", "f", "g"], listId: "gone" }),
  ];
  h.preferences.taskRowDetails = ["estimate", "tags", "notes"];
  show({ scope: { view: "all", listId: "inbox" } });
  const row = await loaded();
  // Scoped to Inbox, the row has no container to repeat and no other detail.
  expect(row.textContent).toBe("Task one");
  expect(screen.getByText("e")).toBeVisible();
  expect(screen.queryByText("f")).not.toBeInTheDocument();
  expect(screen.getByText("+2 more")).toBeVisible();
});
it("leaves out a container that cannot be named", async () => {
  h.items = [task("one", { listId: "gone", projectId: "missing" })];
  show();
  const row = await loaded();
  await waitFor(() => expect(h.listTaskProjects).toHaveBeenCalled());
  await act(async () => {});
  expect(row.textContent).toBe("Task one");
});
const search = (value: string) =>
  fireEvent.change(screen.getByLabelText("Search tasks"), { target: { value } });
it("widens a search to finished and archived items when the preference is on", async () => {
  h.listTaskWorkspace.mockImplementation(async (query) =>
    query.status === "archived"
      ? { items: [task("old", { title: "Garden shed" })], total: 1, nextCursor: null }
      : { items: h.items, total: h.items.length, nextCursor: null },
  );
  show({ standalone: true });
  await loaded();
  expect(h.listTaskWorkspace).not.toHaveBeenCalledWith(
    expect.objectContaining({ status: "archived" }),
  );
  search("garden");
  await screen.findByRole("button", { name: "Open task: Garden shed" });
  expect(h.listTaskWorkspace).toHaveBeenCalledWith(
    expect.objectContaining({ query: "garden", status: "all" }),
  );
  expect(h.listTaskWorkspace).toHaveBeenCalledWith(
    expect.objectContaining({ query: "garden", status: "archived" }),
  );
  expect(
    screen.getByRole("heading", { name: "In archived or finished lists and projects" }),
  ).toBeVisible();
  expect(screen.getByText(/^2 items/)).toBeVisible();
});
it("keeps a search to the view's own status when the preference is off", async () => {
  h.preferences.includeArchivedInSearch = false;
  show({ standalone: true });
  await loaded();
  search("garden");
  await waitFor(() =>
    expect(h.listTaskWorkspace).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: "garden" }),
    ),
  );
  await act(async () => {});
  for (const [query] of h.listTaskWorkspace.mock.calls) {
    expect(query.status).toBeUndefined();
  }
  expect(
    screen.queryByRole("heading", { name: "In archived or finished lists and projects" }),
  ).not.toBeInTheDocument();
});
it("does not widen a search past a fixed or chosen status, or inside a list", async () => {
  const { unmount } = show({ standalone: true, scope: { view: "all", status: "open" } });
  await loaded();
  search("garden");
  await waitFor(() =>
    expect(h.listTaskWorkspace).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: "garden", status: "open" }),
    ),
  );
  unmount();
  h.listTaskWorkspace.mockClear();
  show({ standalone: true, scope: { view: "all", listId: "inbox" } });
  await loaded();
  search("garden");
  // A list already returns its own archived work, so one read with every status is enough.
  await waitFor(() =>
    expect(h.listTaskWorkspace).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: "garden", status: "all", listId: "inbox" }),
    ),
  );
  await act(async () => {});
  expect(h.listTaskWorkspace).not.toHaveBeenCalledWith(
    expect.objectContaining({ status: "archived" }),
  );
});
it("explains the row-detail and search preferences without calling them web-only", async () => {
  render(
    <MobileDataProvider>
      <TaskPreferencesScreen />
    </MobileDataProvider>,
  );
  await screen.findByRole("switch", { name: "Show estimate" });
  expect(screen.queryByText(/configure the web app/)).not.toBeInTheDocument();
  expect(screen.getByText(/Shown under each task on iPhone and in the web app/)).toBeVisible();
  expect(screen.getByText(/also finds completed and cancelled items/)).toBeVisible();
});
it("pages and refreshes archived matches after the other matches, and retries a failed archived read", async () => {
  h.items = [];
  let fail = true;
  h.listTaskWorkspace.mockImplementation(async (query) => {
    if (query.status !== "archived") return { items: [], total: 0, nextCursor: null };
    if (fail) throw new Error("offline");
    return query.cursor
      ? { items: [task("older", { title: "Garden gate" })], total: 2, nextCursor: null }
      : { items: [task("old", { title: "Garden shed" })], total: 2, nextCursor: "more" };
  });
  show({ standalone: true });
  await screen.findByText("You’re all caught up here.");
  search("garden");
  // The failed archived read is one Sonner error and a retry, never an empty result.
  const retry = await screen.findByRole("button", { name: "Retry loading" });
  expect(h.error).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("No matches. Adjust your filters or search.")).not.toBeInTheDocument();
  fail = false;
  fireEvent.click(retry);
  await screen.findByRole("button", { name: "Open task: Garden shed" });
  fireEvent.click(screen.getByRole("button", { name: "Load more" }));
  await screen.findByRole("button", { name: "Open task: Garden gate" });
  expect(h.listTaskWorkspace).toHaveBeenCalledWith(
    expect.objectContaining({ status: "archived", cursor: "more" }),
  );
  expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  const calls = h.listTaskWorkspace.mock.calls.filter(([q]) => q.status === "archived").length;
  fireEvent.click(screen.getByRole("button", { name: "Refresh list" }));
  await waitFor(() =>
    expect(
      h.listTaskWorkspace.mock.calls.filter(([q]) => q.status === "archived").length,
    ).toBeGreaterThan(calls),
  );
});
it("lists archived matches only after every other match has loaded", async () => {
  h.listTaskWorkspace.mockImplementation(async (query) =>
    query.status === "archived"
      ? { items: [task("old", { title: "Garden shed" })], total: 1, nextCursor: null }
      : query.cursor
        ? { items: [task("two", { title: "Garden two" })], total: 2, nextCursor: null }
        : { items: [task("one")], total: 2, nextCursor: "next" },
  );
  show({ standalone: true });
  await loaded();
  search("garden");
  await waitFor(() =>
    expect(h.listTaskWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ query: "garden", status: "archived" }),
    ),
  );
  await act(async () => {});
  expect(screen.queryByRole("button", { name: "Open task: Garden shed" })).not.toBeInTheDocument();
  // Load more continues the other matches first.
  fireEvent.click(screen.getByRole("button", { name: "Load more" }));
  await screen.findByRole("button", { name: "Open task: Garden two" });
  expect(h.listTaskWorkspace).toHaveBeenCalledWith(
    expect.objectContaining({ status: "all", cursor: "next" }),
  );
  expect(await screen.findByRole("button", { name: "Open task: Garden shed" })).toBeVisible();
  expect(screen.getByText(/^3 items/)).toBeVisible();
});
it("starts the archived section as its own block when results are grouped", async () => {
  h.preferences.taskGroup = "list";
  h.listTaskWorkspace.mockImplementation(async (query) =>
    query.status === "archived"
      ? {
          items: [{ ...task("old", { title: "Garden shed" }), groupKey: "inbox" }],
          total: 1,
          nextCursor: null,
        }
      : { items: [{ ...task("one"), groupKey: "inbox" }], total: 1, nextCursor: null },
  );
  show({ standalone: true });
  await loaded();
  search("garden");
  await screen.findByRole("button", { name: "Open task: Garden shed" });
  expect(
    screen.getByRole("heading", { name: "In archived or finished lists and projects" }),
  ).toBeVisible();
  // The same list heads both blocks: once above the other matches, once under Archived.
  expect(screen.getAllByRole("heading", { name: "Inbox" })).toHaveLength(2);
});
it.each([
  ["History", { scope: { view: "history" } }, undefined],
  ["Reminders", { scope: { view: "all", kind: "reminder" } }, "all"],
] as const)("makes no archived read when searching %s", async (_name, props, status) => {
  show({ standalone: true, ...props } as never);
  await loaded();
  search("garden");
  await waitFor(() =>
    expect(h.listTaskWorkspace).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: "garden" }),
    ),
  );
  await act(async () => {});
  expect(h.listTaskWorkspace.mock.lastCall?.[0].status).toBe(status);
  expect(h.listTaskWorkspace).not.toHaveBeenCalledWith(
    expect.objectContaining({ status: "archived" }),
  );
});
it("keeps a chosen Status when searching", async () => {
  show({ standalone: true, initialFilters: { status: "completed" } });
  await loaded();
  search("garden");
  await waitFor(() =>
    expect(h.listTaskWorkspace).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: "garden", status: "completed" }),
    ),
  );
  await act(async () => {});
  expect(h.listTaskWorkspace).not.toHaveBeenCalledWith(
    expect.objectContaining({ status: "archived" }),
  );
});
it("raises one Sonner error when both reads of a search fail", async () => {
  show({ standalone: true });
  await loaded();
  h.listTaskWorkspace.mockRejectedValue(new Error("offline"));
  search("garden");
  await screen.findByRole("button", { name: "Retry loading" });
  await act(async () => {});
  expect(h.error).toHaveBeenCalledTimes(1);
});
it("offers a retry for archived matches beside the matches that did load", async () => {
  let fail = true;
  h.listTaskWorkspace.mockImplementation(async (query) => {
    if (query.status !== "archived") return { items: h.items, total: 1, nextCursor: null };
    if (fail) throw new Error("offline");
    return { items: [task("old", { title: "Garden shed" })], total: 1, nextCursor: null };
  });
  show({ standalone: true });
  await loaded();
  search("garden");
  const retry = await screen.findByRole("button", { name: "Retry loading archived matches" });
  await waitFor(() => expect(h.error).toHaveBeenCalledTimes(1));
  expect(screen.getByText(/^1 items/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Open task: Task one" })).toBeVisible();
  fail = false;
  fireEvent.click(retry);
  await screen.findByRole("button", { name: "Open task: Garden shed" });
  expect(
    screen.queryByRole("button", { name: "Retry loading archived matches" }),
  ).not.toBeInTheDocument();
  expect(h.error).toHaveBeenCalledTimes(1);
});
it("names a cancelled task on its scan line", async () => {
  h.items = [task("one", { lifecycle: "cancelled", cancelledAt: "2026-11-02T12:00:00Z" })];
  show({ scope: { view: "history" } });
  await loaded();
  expect(screen.getByText("Cancelled")).toBeVisible();
});
it("keeps Load more for ordinary matches when the archived read fails", async () => {
  h.listTaskWorkspace.mockImplementation(async (query) => {
    if (query.status === "archived") throw new Error("offline");
    return query.cursor
      ? { items: [task("two", { title: "Garden two" })], total: 2, nextCursor: null }
      : { items: [task("one")], total: 2, nextCursor: "next" };
  });
  show({ standalone: true });
  await loaded();
  search("garden");
  await waitFor(() => expect(h.error).toHaveBeenCalledTimes(1));
  // Ordinary pages come first; the archived retry waits until they are all loaded.
  expect(
    screen.queryByRole("button", { name: "Retry loading archived matches" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Load more" }));
  await screen.findByRole("button", { name: "Open task: Garden two" });
  expect(h.listTaskWorkspace).toHaveBeenCalledWith(
    expect.objectContaining({ status: "all", cursor: "next" }),
  );
  expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Retry loading archived matches" })).toBeVisible();
});
it("selects every visible item that can change from a mixed selection, then acts on all of them", async () => {
  h.items = [task("one"), task("two"), { ...task("three"), readOnly: true }, task("four")];
  show();
  fireEvent.contextMenu(await loaded());
  fireEvent.click(screen.getByRole("button", { name: "Open task: Task three" }));
  expect(screen.getByText("2 selected")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Complete" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Select all" }));
  // The read-only pick is dropped, so the selection can be acted on.
  expect(screen.getByText("3 selected")).toBeVisible();
  expect(screen.getByRole("checkbox", { name: "Select Task three" })).not.toBeChecked();
  for (const id of ["one", "two", "four"])
    expect(screen.getByRole("checkbox", { name: `Select Task ${id}` })).toBeChecked();
  expect(screen.queryByRole("button", { name: "Select all" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Open task: Task two" }));
  expect(screen.getByText("2 selected")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Select all" }));
  expect(screen.getByText("3 selected")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Complete" }));
  await waitFor(() => expect(h.completeTask).toHaveBeenCalledTimes(3));
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith(
      "3 completed",
      expect.objectContaining({ id: "task-toast" }),
    ),
  );
  expect(screen.queryByText("3 completed")).not.toBeInTheDocument();
});
it("offers no Select all when nothing visible can change, and trashes a full selection after confirming", async () => {
  h.items = [{ ...task("one"), readOnly: true }];
  const view = show();
  fireEvent.contextMenu(await loaded());
  expect(screen.getByText("1 selected")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Select all" })).not.toBeInTheDocument();
  view.unmount();
  h.items = [task("one"), task("two")];
  show();
  fireEvent.contextMenu(await loaded());
  fireEvent.click(screen.getByRole("button", { name: "Select all" }));
  fireEvent.click(screen.getByRole("button", { name: "Trash" }));
  await waitFor(() => expect(h.trashTask).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(h.success).toHaveBeenCalledWith(
      "2 moved to Trash",
      expect.objectContaining({ id: "task-toast" }),
    ),
  );
  expect(screen.queryByText("2 moved to Trash")).not.toBeInTheDocument();
});
const totals = (pick: (query: Record<string, unknown>) => number) =>
  h.listTaskWorkspace.mockImplementation(async (query) => ({
    items: [],
    total: pick(query),
    nextCursor: null,
  }));
const hub = (mode: Parameters<typeof TasksHub>[0]["mode"]) =>
  render(
    <MobileDataProvider>
      <TasksHub mode={mode} />
    </MobileDataProvider>,
  );
it("shows each Browse destination's item count from the API total", async () => {
  h.lists = [
    list("inbox", "Inbox", { kind: "inbox" }),
    list("old", "Old", { availability: "archived" }),
  ];
  totals((query) =>
    query.view === "upcoming"
      ? 4
      : query.view === "history"
        ? 12
        : query.view === "trash"
          ? 2
          : query.kind === "task"
            ? 7
            : query.kind === "reminder"
              ? 1
              : query.reserved === "scheduled"
                ? 5
                : 1234,
  );
  hub("views");
  for (const [label, count] of [
    ["Upcoming", "4"],
    ["History", "12"],
    ["Trash", "2"],
    ["Tasks", "7"],
    ["Reminders", "1"],
    ["Scheduled", "5"],
    ["All tasks & reminders", "1,234"],
    ["Archive", "1"],
  ] as const)
    expect(
      await within(screen.getByRole("button", { name: label })).findByText(count),
    ).toBeVisible();
  expect(h.listTaskWorkspace).toHaveBeenCalledWith({ view: "upcoming", limit: 1 });
  expect(h.listTaskWorkspace).toHaveBeenCalledWith({
    view: "all",
    reserved: "scheduled",
    limit: 1,
  });
  expect(h.listTaskWorkspace).toHaveBeenCalledTimes(7);
});
it("counts what a destination will list when completed tasks are shown", async () => {
  h.preferences.showCompletedTasks = true;
  totals(() => 3);
  hub("views");
  await within(screen.getByRole("button", { name: "Tasks" })).findByText("3");
  expect(h.listTaskWorkspace).toHaveBeenCalledWith({
    view: "all",
    kind: "task",
    status: "open_and_completed",
    limit: 1,
  });
  // History and Trash keep their own status.
  expect(h.listTaskWorkspace).toHaveBeenCalledWith({ view: "history", limit: 1 });
  expect(h.listTaskWorkspace).toHaveBeenCalledWith({ view: "trash", limit: 1 });
});
it("shows no count, never a zero, when the totals cannot be read, and reports it once through Sonner", async () => {
  h.listTaskWorkspace.mockRejectedValue(new Error("offline"));
  hub("views");
  await waitFor(() => expect(h.error).toHaveBeenCalledTimes(1));
  expect(screen.getByRole("button", { name: "Trash" })).toHaveTextContent(/^Trash$/);
  for (const label of ["Upcoming", "History", "Tasks", "Reminders", "Scheduled"])
    expect(screen.getByRole("button", { name: label })).not.toHaveTextContent(/\d/);
  expect(screen.queryByText(/Couldn’t confirm/)).not.toBeInTheDocument();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(h.error).toHaveBeenCalledTimes(1);
});
it("shows item counts on list rows and pinned cards, matching the list each one opens", async () => {
  h.lists = [list("inbox", "Inbox", { kind: "inbox" }), list("home", "Home"), list("work", "Work")];
  h.preferences.pinnedListIds = ["work"];
  totals((query) => (query.listId === "home" ? 1 : query.listId === "work" ? 8 : 0));
  hub("lists");
  expect(
    await within(await screen.findByRole("button", { name: "Open Home" })).findByText("1 item"),
  ).toBeVisible();
  expect(
    within(screen.getByRole("button", { name: "Open Inbox" })).getByText("0 items"),
  ).toBeVisible();
  expect(
    within(screen.getByRole("button", { name: "Open pinned list: Work" })).getByText("8 items"),
  ).toBeVisible();
  expect(h.listTaskWorkspace).toHaveBeenCalledWith({
    view: "all",
    kind: "task",
    listId: "home",
    limit: 1,
  });
  fireEvent.click(screen.getByRole("button", { name: "Open Home" }));
  expect(h.push).toHaveBeenLastCalledWith({
    pathname: "/task-browser",
    params: { title: "Home", view: "all", kind: "task", listId: "home" },
  });
});
it("counts a finished project's tasks in every status, as its page lists them", async () => {
  h.projects = [
    project("open", "Open project"),
    project("done", "Done project", { lifecycle: "completed" }),
  ];
  totals((query) => (query.projectId === "done" ? 6 : 2));
  hub("projects");
  expect(
    await within(await screen.findByRole("button", { name: "Open Open project" })).findByText(
      "2 items",
    ),
  ).toBeVisible();
  expect(h.listTaskWorkspace).toHaveBeenCalledWith({
    view: "all",
    kind: "task",
    projectId: "open",
    listId: "inbox",
    limit: 1,
  });
  fireEvent.click(screen.getByRole("button", { name: "Completed · 1" }));
  expect(
    await within(screen.getByRole("button", { name: "Open Done project, completed" })).findByText(
      "6 items",
    ),
  ).toBeVisible();
  expect(h.listTaskWorkspace).toHaveBeenCalledWith({
    view: "all",
    status: "all",
    kind: "task",
    projectId: "done",
    listId: "inbox",
    limit: 1,
  });
});
it("shows a project's why and target date above its tasks, and nothing for a project without them", async () => {
  h.projects = [
    project("trip", "Trip", { why: "See the coast before winter", targetDate: "2026-12-05" }),
    project("bare", "Bare"),
  ];
  const view = show({
    title: "Trip",
    scope: { view: "all", kind: "task", projectId: "trip", listId: "inbox" },
  });
  await loaded();
  const why = await screen.findByText("See the coast before winter");
  expect(screen.getByText("Target Dec 5, 2026")).toBeVisible();
  expect(
    why.compareDocumentPosition(screen.getByRole("button", { name: "Open task: Task one" })) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  view.unmount();
  show({ title: "Bare", scope: { view: "all", kind: "task", projectId: "bare", listId: "inbox" } });
  await loaded();
  expect(screen.queryByText(/^Target /)).not.toBeInTheDocument();
  expect(screen.queryByText("See the coast before winter")).not.toBeInTheDocument();
});
