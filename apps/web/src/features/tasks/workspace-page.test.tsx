// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { TaskWorkspaceItem } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { SidebarProvider } from "@/components/ui/sidebar";
import {
  TaskScopeHeader,
  TasksCreateButton,
  TasksPage,
  TasksSidebar,
  taskDescription,
  taskTiming,
} from "./page";
import { TasksWorkspacePage } from "./workspace-page";

const mocks = vi.hoisted(() => ({
  listTaskWorkspace: vi.fn(),
  listTaskLists: vi.fn(),
  listTaskProjects: vi.fn(),
  completeTask: vi.fn(),
  completeReminder: vi.fn(),
  getTask: vi.fn(),
  getReminder: vi.fn(),
  listTasks: vi.fn(),
  reopenTask: vi.fn(),
  restoreTask: vi.fn(),
  trashTask: vi.fn(),
}));
vi.mock("../../api", () => ({ api: mocks, errorMessage: (error: Error) => error.message }));
const task = {
  kind: "task",
  record: {
    id: "t",
    title: "Plan trip",
    listId: "inbox",
    projectId: null,
    lifecycle: "open",
    dueAt: null,
    scheduledAt: null,
    estimateMinutes: 30,
    tags: ["travel"],
    notes: "Compare options",
    revision: 2,
    priority: "medium",
  },
  deletedAt: null,
  readOnly: false,
  relevantAt: null,
  groupKey: "none",
} as TaskWorkspaceItem;
const reminder = {
  kind: "reminder",
  record: {
    id: "r",
    title: "Call Sam",
    completedAt: null,
    dueAt: null,
    priority: "high",
    updatedAt: "2026-09-03T00:00:00.000Z",
  },
  deletedAt: null,
  readOnly: false,
  relevantAt: null,
  groupKey: "none",
} as TaskWorkspaceItem;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.listTaskWorkspace.mockResolvedValue({
    items: [task, reminder],
    nextCursor: null,
    total: 2,
  });
  mocks.listTaskLists.mockResolvedValue({
    items: [{ id: "inbox", name: "Inbox", kind: "inbox", availability: "active" }],
    nextCursor: null,
  });
  mocks.listTaskProjects.mockResolvedValue({ items: [], nextCursor: null });
  mocks.listTasks.mockResolvedValue({ items: [], nextCursor: null });
});
function setup(path = "/tasks?view=all") {
  const onEdit = vi.fn();
  const onEditReminder = vi.fn();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[path]}>
        <TasksWorkspacePage
          onEdit={onEdit}
          onEditReminder={onEditReminder}
          timeZone="America/New_York"
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { browser: userEvent.setup(), onEdit, onEditReminder };
}

function setupLegacy(path: string) {
  const onEdit = vi.fn();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[path]}>
        <TasksPage onEdit={onEdit} timeZone="America/New_York" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { browser: userEvent.setup(), onEdit };
}
function setupSidebar() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <SidebarProvider>
          <TasksSidebar onNavigate={vi.fn()} />
        </SidebarProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}
it("mixes concise rows with distinct inspectors and progressive row details", async () => {
  const { browser, onEditReminder } = setup();
  await screen.findByRole("button", { name: "Open Plan trip" });
  expect(screen.getByText("2 items")).toBeInTheDocument();
  expect(screen.queryByText("Compare options")).not.toBeInTheDocument();
  await browser.click(screen.getByRole("button", { name: "Open Call Sam" }));
  expect(onEditReminder).toHaveBeenCalledWith(reminder.record);
  await browser.click(screen.getByRole("button", { name: "Display" }));
  await browser.click(screen.getByRole("menuitemcheckbox", { name: "Notes" }));
  expect(await screen.findByText("Compare options")).toBeInTheDocument();
});
it("keeps create choices compact and exposes the optional reminder action", async () => {
  const user = userEvent.setup();
  const onCreate = vi.fn();
  const onCreateReminder = vi.fn();
  render(<TasksCreateButton onCreate={onCreate} onCreateReminder={onCreateReminder} />);
  await user.click(screen.getByRole("button", { name: "New task" }));
  await user.click(screen.getByRole("button", { name: "More create options" }));
  await user.click(screen.getByRole("menuitem", { name: "New reminder" }));
  expect(onCreate).toHaveBeenCalledOnce();
  expect(onCreateReminder).toHaveBeenCalledOnce();
  cleanup();
  render(<TasksCreateButton onCreate={onCreate} />);
  expect(screen.queryByRole("button", { name: "More create options" })).not.toBeInTheDocument();
});

it("filters inactive sidebar containers and recovers each navigation dependency", async () => {
  mocks.listTaskLists.mockResolvedValueOnce({
    items: [
      { id: "inbox", name: "Inbox", kind: "inbox", availability: "active" },
      { id: "archived", name: "Archived", kind: "custom", availability: "archived" },
    ],
    nextCursor: null,
  });
  mocks.listTaskProjects.mockResolvedValueOnce({
    items: [
      {
        id: "open",
        name: "Open project",
        listId: "inbox",
        lifecycle: "open",
        availability: "active",
      },
      {
        id: "closed",
        name: "Closed project",
        listId: "inbox",
        lifecycle: "completed",
        availability: "active",
      },
      {
        id: "orphan",
        name: "Orphan project",
        listId: "archived",
        lifecycle: "open",
        availability: "active",
      },
    ],
    nextCursor: null,
  });
  setupSidebar();
  expect(await screen.findByText("Open project")).toBeVisible();
  expect(screen.queryByText("Closed project")).not.toBeInTheDocument();
  expect(screen.queryByText("Orphan project")).not.toBeInTheDocument();
  cleanup();
  mocks.listTaskLists.mockRejectedValueOnce(new Error("Lists offline"));
  mocks.listTaskProjects.mockRejectedValueOnce(new Error("Projects offline"));
  const user = setupSidebar();
  expect(await screen.findByText("Lists offline")).toBeVisible();
  expect(screen.getByText("Projects offline")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Retry Lists" }));
  await user.click(screen.getByRole("button", { name: "Retry Projects" }));
  expect(mocks.listTaskLists).toHaveBeenCalledTimes(3);
  expect(mocks.listTaskProjects).toHaveBeenCalledTimes(3);
});
it("shows exact partial batch failures and never labels them all successful", async () => {
  mocks.completeTask.mockResolvedValue(task.record);
  mocks.completeReminder.mockRejectedValue(new Error("Changed elsewhere"));
  const { browser } = setup();
  await screen.findByRole("button", { name: "Open Plan trip" });
  await browser.click(screen.getByRole("button", { name: "Select items" }));
  await browser.click(screen.getByRole("checkbox", { name: "Select Plan trip" }));
  await browser.click(screen.getByRole("checkbox", { name: "Select Call Sam" }));
  await browser.click(
    within(screen.getByRole("group", { name: "Selected item actions" })).getByRole("button", {
      name: "Complete",
    }),
  );
  expect(await screen.findByText("1 updated, 1 not changed.")).toBeInTheDocument();
  expect(screen.getByText("Call Sam: Changed elsewhere")).toBeInTheDocument();
});

it("keeps global items available when navigation dependencies fail", async () => {
  mocks.listTaskLists.mockRejectedValue(new Error("Lists unavailable"));
  mocks.listTaskProjects.mockRejectedValue(new Error("Projects unavailable"));
  setup();
  expect(await screen.findByRole("button", { name: "Open Plan trip" })).toBeInTheDocument();
});

it("keeps loaded rows and retries a failed next page", async () => {
  mocks.listTaskWorkspace
    .mockResolvedValueOnce({ items: [task], nextCursor: "page-2", total: 2 })
    .mockRejectedValueOnce(new Error("Page unavailable"))
    .mockResolvedValueOnce({ items: [reminder], nextCursor: null, total: 2 });
  const { browser } = setup();
  await browser.click(await screen.findByRole("button", { name: "Load more items" }));
  expect(await screen.findByText("Page unavailable")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Open Plan trip" })).toBeInTheDocument();
  await browser.click(screen.getByRole("button", { name: "Retry loading more items" }));
  expect(await screen.findByRole("button", { name: "Open Call Sam" })).toBeInTheDocument();
  expect(mocks.listTaskWorkspace.mock.calls.at(-1)?.[0]).toMatchObject({ cursor: "page-2" });
});

it("opens read-only projections without exposing the mutable inspector", async () => {
  mocks.listTaskWorkspace.mockResolvedValue({
    items: [{ ...task, readOnly: true }],
    nextCursor: null,
    total: 1,
  });
  const { browser, onEdit } = setup("/tasks?view=history");
  await browser.click(await screen.findByRole("button", { name: "Open Plan trip" }));
  expect(await screen.findByRole("dialog", { name: "Plan trip" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "View archived context" })).toBeInTheDocument();
  expect(onEdit).not.toHaveBeenCalled();
});

it("checks archived ownership before opening off-page task links", async () => {
  mocks.listTaskWorkspace.mockResolvedValue({ items: [], nextCursor: null, total: 0 });
  mocks.getTask.mockResolvedValue({ ...task.record, listId: "archived" });
  mocks.listTaskLists.mockResolvedValue({
    items: [{ id: "archived", name: "Old list", kind: "custom", availability: "archived" }],
    nextCursor: null,
  });
  const { onEdit } = setup("/tasks?view=history&task=t");
  expect(await screen.findByRole("dialog", { name: "Plan trip" })).toBeInTheDocument();
  expect(onEdit).not.toHaveBeenCalled();
});

it("offers a retry when off-page inspection cannot verify its container", async () => {
  mocks.listTaskWorkspace.mockResolvedValue({ items: [], nextCursor: null, total: 0 });
  mocks.getTask.mockResolvedValue(task.record);
  mocks.listTaskProjects.mockRejectedValueOnce(new Error("Project lookup failed"));
  const { browser, onEdit } = setup("/tasks?view=all&task=t");
  expect(await screen.findByText("Project lookup failed")).toBeInTheDocument();
  expect(onEdit).not.toHaveBeenCalled();
  await browser.click(screen.getByRole("button", { name: "Retry task details" }));
  await vi.waitFor(() => expect(onEdit).toHaveBeenCalledWith(task.record));
});

it("deduplicates edited items that reappear on a later page before selecting", async () => {
  mocks.listTaskWorkspace
    .mockResolvedValueOnce({ items: [task], nextCursor: "page-2", total: 2 })
    .mockResolvedValueOnce({
      items: [{ ...task, record: { ...task.record, revision: 3 } }, reminder],
      nextCursor: null,
      total: 2,
    });
  mocks.completeTask.mockResolvedValue(task.record);
  const { browser } = setup();
  await browser.click(await screen.findByRole("button", { name: "Load more items" }));
  await screen.findByRole("button", { name: "Open Call Sam" });
  expect(screen.getAllByRole("button", { name: "Open Plan trip" })).toHaveLength(1);
  await browser.click(screen.getByRole("button", { name: "Select items" }));
  await browser.click(screen.getByRole("checkbox", { name: "Select Plan trip" }));
  await browser.click(
    within(screen.getByRole("group", { name: "Selected item actions" })).getByRole("button", {
      name: "Complete",
    }),
  );
  expect(mocks.completeTask).toHaveBeenCalledExactlyOnceWith("t", { expectedRevision: 3 });
});

it("accepts valid offset-aware date ranges when applying another filter", async () => {
  const { browser } = setup(
    "/tasks?view=all&dueAfter=2026-09-03T01%3A00%3A00%2B02%3A00&dueBefore=2026-09-03T00%3A00%3A00Z",
  );
  await browser.click(await screen.findByRole("button", { name: "Filters (2)" }));
  await browser.selectOptions(screen.getByRole("combobox", { name: "Priority" }), "high");
  await browser.click(screen.getByRole("button", { name: "Apply filters" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(mocks.listTaskWorkspace).toHaveBeenLastCalledWith(
    expect.objectContaining({ priority: "high" }),
  );
});

it("keeps archived lists inspectable and their retained tasks actionable", async () => {
  const archivedTask = {
    ...task.record,
    cancelledAt: null,
    completedAt: "2026-09-02T12:00:00.000Z",
    createdAt: "2026-09-01T12:00:00.000Z",
    deletedAt: null,
    legacyStatus: "completed",
    lifecycle: "completed",
    listId: "archived",
    source: {
      accountId: null,
      provider: "local",
      remoteId: "t",
      revision: "2",
      sourceType: "task",
    },
    updatedAt: "2026-09-02T12:00:00.000Z",
    why: null,
  } as const;
  mocks.listTaskLists.mockResolvedValue({
    items: [
      { id: "inbox", name: "Inbox", kind: "inbox", availability: "active" },
      {
        id: "archived",
        name: "Someday",
        kind: "standard",
        availability: "archived",
        description: "Ideas retained for later",
      },
    ],
    nextCursor: null,
  });
  mocks.listTasks.mockResolvedValue({ items: [archivedTask], nextCursor: null });
  mocks.reopenTask.mockResolvedValue({ ...archivedTask, lifecycle: "open" });
  mocks.trashTask.mockResolvedValue({ ...archivedTask, deletedAt: "2026-09-03T12:00:00.000Z" });
  const { browser, onEdit } = setup("/tasks?archive=list&list=archived");

  await browser.click(await screen.findByRole("button", { name: "Open Plan trip" }));
  expect(onEdit).toHaveBeenCalledWith(archivedTask);
  await browser.click(screen.getByRole("checkbox", { name: "Reopen Plan trip" }));
  await vi.waitFor(() =>
    expect(mocks.reopenTask).toHaveBeenCalledWith("t", { expectedRevision: 2 }),
  );
  await browser.click(screen.getByRole("button", { name: "Plan trip options" }));
  await browser.click(screen.getByRole("menuitem", { name: "Move to Trash" }));
  await vi.waitFor(() =>
    expect(mocks.trashTask).toHaveBeenCalledWith("t", { expectedRevision: 2 }),
  );
});

it("lists every archived container from the retained-work overview", async () => {
  mocks.listTaskLists.mockResolvedValue({
    items: [{ id: "archived", name: "Someday", kind: "standard", availability: "archived" }],
    nextCursor: null,
  });
  mocks.listTaskProjects.mockResolvedValue({
    items: [
      {
        id: "finished",
        name: "Kitchen refresh",
        listId: "archived",
        availability: "active",
        lifecycle: "completed",
      },
    ],
    nextCursor: null,
  });
  setup("/tasks?archive=all");
  expect(await screen.findByRole("link", { name: "Someday" })).toHaveAttribute(
    "href",
    "/tasks?archive=list&list=archived",
  );
  expect(screen.getByRole("link", { name: "Kitchen refresh" })).toHaveAttribute(
    "href",
    "/tasks?archive=project&project=finished",
  );
});

it("keeps the retained task filter surface complete and reversible", async () => {
  mocks.listTaskLists.mockResolvedValue({
    items: [{ id: "inbox", name: "Inbox", kind: "inbox", availability: "active" }],
    nextCursor: null,
  });
  const { browser } = setupLegacy(
    "/tasks?lifecycle=completed&dueAfter=2026-09-01T00%3A00%3A00.000Z&dueBefore=2026-09-30T23%3A59%3A00.000Z&scheduledAfter=2026-09-01T00%3A00%3A00.000Z&scheduledBefore=2026-09-30T23%3A59%3A00.000Z",
  );

  await browser.click(await screen.findByRole("button", { name: "Filters (5)" }));
  expect(screen.getByRole("dialog", { name: "Task filters" })).toBeVisible();
  await browser.selectOptions(screen.getByLabelText("Deadline"), "today");
  await browser.selectOptions(screen.getByLabelText("Reserved time"), "custom");
  expect(screen.getByLabelText("Deadline after")).toBeVisible();
  await browser.clear(screen.getByLabelText("Reserved after"));
  await browser.type(screen.getByLabelText("Reserved after"), "2026-09-08T09:30");
  await browser.selectOptions(screen.getByLabelText("Show"), "cancelled");
  await browser.click(screen.getByRole("button", { name: "Apply filters" }));

  await browser.click(await screen.findByRole("button", { name: /Filters \(/ }));
  await browser.click(screen.getByRole("button", { name: "Clear" }));
  expect(await screen.findByRole("button", { name: "Filters" })).toBeVisible();
});

it("renders every retained task lifecycle without exposing invalid actions", async () => {
  const base = {
    cancelledAt: null,
    completedAt: null,
    createdAt: "2026-09-01T12:00:00.000Z",
    deletedAt: null,
    dueAt: "2026-09-02T12:00:00.000Z",
    estimateMinutes: 20,
    legacyStatus: "inbox",
    lifecycle: "open",
    listId: "inbox",
    notes: "Keep the evidence",
    priority: "high",
    projectId: null,
    revision: 2,
    scheduledAt: "2026-09-03T12:00:00.000Z",
    source: {
      accountId: null,
      provider: "local",
      remoteId: "base",
      revision: "2",
      sourceType: "task",
    },
    tags: ["planning"],
    timezone: "America/New_York",
    title: "Open task",
    updatedAt: "2026-09-01T12:00:00.000Z",
    why: null,
  } as const;
  mocks.listTaskLists.mockResolvedValue({
    items: [{ id: "inbox", name: "Inbox", kind: "inbox", availability: "active" }],
    nextCursor: null,
  });
  mocks.listTasks.mockResolvedValue({
    items: [
      { ...base, id: "open" },
      {
        ...base,
        completedAt: "2026-09-02T12:00:00.000Z",
        id: "complete",
        legacyStatus: "completed",
        lifecycle: "completed",
        priority: "low",
        title: "Completed task",
      },
      {
        ...base,
        cancelledAt: "2026-09-02T12:00:00.000Z",
        id: "cancelled",
        legacyStatus: "cancelled",
        lifecycle: "cancelled",
        priority: "medium",
        title: "Cancelled task",
      },
      {
        ...base,
        deletedAt: "2026-09-02T12:00:00.000Z",
        id: "trash",
        title: "Trashed task",
      },
    ],
    nextCursor: null,
  });

  setupLegacy("/tasks");
  expect(await screen.findByRole("checkbox", { name: "Complete Open task" })).toBeVisible();
  expect(screen.getByRole("checkbox", { name: "Reopen Completed task" })).toBeChecked();
  expect(screen.queryByRole("checkbox", { name: /Cancelled task/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Trashed task options" })).not.toBeInTheDocument();
  expect(screen.getByText("Cancelled")).toBeVisible();
  expect(screen.getByText("Trash")).toBeVisible();
});

it("retries retained task pagination without dropping the first page", async () => {
  const openTask = {
    ...task.record,
    cancelledAt: null,
    completedAt: null,
    createdAt: "2026-09-01T12:00:00.000Z",
    deletedAt: null,
    legacyStatus: "inbox",
    lifecycle: "open",
    source: {
      accountId: null,
      provider: "local",
      remoteId: "t",
      revision: "2",
      sourceType: "task",
    },
    updatedAt: "2026-09-01T12:00:00.000Z",
    why: null,
  } as const;
  mocks.listTaskLists.mockResolvedValue({
    items: [{ id: "inbox", name: "Inbox", kind: "inbox", availability: "active" }],
    nextCursor: null,
  });
  mocks.listTasks
    .mockResolvedValueOnce({ items: [openTask], nextCursor: "next-page" })
    .mockRejectedValueOnce(new Error("More tasks unavailable"))
    .mockResolvedValueOnce({
      items: [{ ...openTask, id: "later", title: "Later task" }],
      nextCursor: null,
    });
  const { browser } = setupLegacy("/tasks");
  await browser.click(await screen.findByRole("button", { name: "Load more Tasks" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("More tasks unavailable");
  expect(screen.getByRole("button", { name: "Open Plan trip" })).toBeVisible();
  await browser.click(screen.getByRole("button", { name: "Retry loading more Tasks" }));
  expect(await screen.findByRole("button", { name: "Open Later task" })).toBeVisible();
});

it("formats every concise task metadata combination", () => {
  const base = task.record;
  expect(taskTiming({ ...base, dueAt: null, scheduledAt: null } as never, "UTC")).toBeNull();
  expect(
    taskTiming(
      {
        ...base,
        dueAt: "2026-09-08T12:00:00.000Z",
        scheduledAt: "2026-09-08T10:00:00.000Z",
      } as never,
      "UTC",
    ),
  ).toContain("Reserved");
  expect(taskDescription({ ...base, estimateMinutes: null, notes: null } as never)).toBeNull();
  expect(
    taskDescription(
      { ...base, estimateMinutes: 15, notes: "Details" } as never,
      { id: "work", name: "Work" } as never,
      { id: "launch", name: "Launch" } as never,
    ),
  ).toBe("Work / Launch · 15 min · Details");
  expect(
    taskDescription(base as never, undefined, { id: "launch", name: "Launch" } as never, false),
  ).toBe("Launch · 30 min");
  expect(taskDescription(base as never, { id: "work", name: "Work" } as never)).toContain("Work");
});

it("keeps each legacy dependency and empty scope state explicit", async () => {
  mocks.listTasks.mockRejectedValueOnce(new Error("Tasks failed"));
  const failed = setupLegacy("/tasks");
  expect(await screen.findByRole("alert")).toHaveTextContent("Tasks failed");
  await failed.browser.click(screen.getByRole("button", { name: "Retry Tasks" }));
  expect(await screen.findByText("Nothing here yet")).toBeVisible();
  cleanup();

  setupLegacy("/tasks?q=missing");
  expect(await screen.findByText("No matching tasks")).toBeVisible();
  expect(screen.getByText("Try another title or note.")).toBeVisible();
  cleanup();

  setupLegacy("/tasks?dueAfter=2026-09-01T00%3A00%3A00.000Z");
  expect(
    await screen.findByText("Try a different filter or clear the current filters."),
  ).toBeVisible();
  cleanup();

  setupLegacy("/tasks?archive=all");
  expect(await screen.findByText("No archived Lists.")).toBeVisible();
  expect(screen.getByText("No finished Projects.")).toBeVisible();
});

it("describes a selected project and exposes its scoped task metadata", async () => {
  mocks.listTaskLists.mockResolvedValue({
    items: [
      {
        id: "work",
        name: "Work",
        kind: "standard",
        availability: "active",
        description: "Work commitments",
      },
    ],
    nextCursor: null,
  });
  mocks.listTaskProjects.mockResolvedValue({
    items: [
      {
        id: "launch",
        name: "Launch",
        listId: "work",
        lifecycle: "open",
        availability: "active",
        why: "Ship the release",
        targetDate: "2026-09-30",
      },
    ],
    nextCursor: null,
  });
  mocks.listTasks.mockResolvedValue({
    items: [{ ...task.record, listId: "work", projectId: "launch" }],
    nextCursor: null,
  });
  setupLegacy("/tasks?list=work&project=launch");
  expect(await screen.findByText("Launch")).toBeVisible();
  expect(screen.getByText("Work")).toBeVisible();
  expect(screen.getByText("Ship the release")).toBeVisible();
  expect(screen.getByText(/Target Sep 30, 2026/)).toBeVisible();
});

it("renders grouped workspace fallbacks and every contextual empty message", async () => {
  const groupedTask = {
    ...task,
    groupKey: "2026-09-08",
    record: { ...task.record, listId: "missing", projectId: "missing" },
  } as TaskWorkspaceItem;
  mocks.listTaskWorkspace.mockResolvedValue({ items: [groupedTask], nextCursor: null, total: 3 });
  setup("/tasks?view=all&group=date");
  expect(await screen.findByText(/Tue, Sep 8/)).toBeVisible();
  expect(screen.getByText("1 of 3 shown")).toBeVisible();
  cleanup();

  for (const [path, copy] of [
    ["/tasks?view=today", "Nothing is due or reserved for today."],
    ["/tasks?view=history", "Completed items and archived context will appear here."],
    ["/tasks?view=trash", "Removed items stay here until you restore them."],
    ["/tasks?view=all&q=missing", "Try another filter or search."],
  ] as const) {
    mocks.listTaskWorkspace.mockResolvedValueOnce({ items: [], nextCursor: null, total: 0 });
    setup(path);
    expect(await screen.findByText(copy)).toBeVisible();
    cleanup();
  }
});

it("surfaces direct task and reminder inspection failures", async () => {
  mocks.listTaskWorkspace.mockResolvedValue({ items: [], nextCursor: null, total: 0 });
  mocks.getTask.mockRejectedValueOnce(new Error("Task unavailable"));
  setup("/tasks?view=all&task=missing");
  expect(await screen.findByRole("alert")).toHaveTextContent("Task unavailable");
  cleanup();
  mocks.getReminder.mockRejectedValueOnce(new Error("Reminder unavailable"));
  setup("/tasks?view=all&reminder=missing");
  expect(await screen.findByRole("alert")).toHaveTextContent("Reminder unavailable");
});

it("keeps task scope headings concise across lists, projects, and counts", () => {
  const list = { id: "work", name: "Work", description: "Work commitments" } as never;
  const project = {
    id: "launch",
    name: "Launch",
    why: "Ship the release",
    targetDate: "2026-09-30",
  } as never;
  const { rerender } = render(
    <TaskScopeHeader list={list} scopeName="Work" taskCount={1} hasMore={false} />,
  );
  expect(screen.getByText("1 task")).toBeVisible();
  expect(screen.getByText("Work commitments")).toBeVisible();
  rerender(
    <TaskScopeHeader
      list={list}
      project={project}
      scopeName="Launch"
      taskCount={2}
      hasMore
      taskLifecycle="completed"
    />,
  );
  expect(screen.getByText("2+ completed tasks")).toBeVisible();
  expect(screen.getByText("Ship the release")).toBeVisible();
  expect(screen.getByText(/Target Sep 30, 2026/)).toBeVisible();
});

it("labels each grouped workspace fallback", async () => {
  for (const [group, item, label] of [
    ["date", task, "No date"],
    ["project", task, "No project"],
    ["list", { ...task, groupKey: "unknown" }, "List"],
    ["project", { ...task, groupKey: "unknown" }, "Project"],
    ["list", reminder, "Reminders"],
  ] as const) {
    mocks.listTaskWorkspace.mockResolvedValueOnce({ items: [item], nextCursor: null, total: 1 });
    setup(`/tasks?view=all&group=${group}`);
    expect(await screen.findByText(label)).toBeVisible();
    cleanup();
  }
});

it("toggles visible selection and confirms destructive workspace actions", async () => {
  mocks.trashTask.mockResolvedValue({ ...task.record, deletedAt: "2026-09-07T12:00:00.000Z" });
  const { browser } = setup();
  await screen.findByRole("button", { name: "Open Plan trip" });
  await browser.click(screen.getByRole("button", { name: "Select items" }));
  await browser.click(screen.getByRole("checkbox", { name: "Select Plan trip" }));
  expect(screen.getAllByText("1 selected")).toHaveLength(2);
  await browser.click(screen.getByRole("checkbox", { name: "Select Plan trip" }));
  await browser.click(screen.getByRole("checkbox", { name: "Select visible items" }));
  expect(screen.getAllByText("2 selected")).toHaveLength(2);
  await browser.click(screen.getByRole("checkbox", { name: "Select visible items" }));
  await browser.click(screen.getByRole("checkbox", { name: "Select Plan trip" }));
  await browser.click(
    within(screen.getByRole("group", { name: "Selected item actions" })).getByRole("button", {
      name: "Move to Trash",
    }),
  );
  expect(await screen.findByRole("dialog", { name: "Move item to Trash?" })).toBeVisible();
  await browser.click(screen.getByRole("button", { name: "Cancel" }));
  await browser.click(
    within(screen.getByRole("group", { name: "Selected item actions" })).getByRole("button", {
      name: "Move to Trash",
    }),
  );
  await browser.click(screen.getByRole("button", { name: "Move to Trash" }));
  await vi.waitFor(() =>
    expect(mocks.trashTask).toHaveBeenCalledWith("t", { expectedRevision: 2 }),
  );
});
