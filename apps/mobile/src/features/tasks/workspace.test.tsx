// @vitest-environment jsdom
import type { TaskWorkspaceItem } from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
