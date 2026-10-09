// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { Task, User } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { TaskDialog } from "./task-dialog";

const api = vi.hoisted(() => ({
  listTaskLists: vi.fn(),
  listTaskProjects: vi.fn(),
  restoreTask: vi.fn(),
  getWorkspaceSettings: vi.fn(),
}));
vi.mock("../../api", () => ({ api, errorMessage: (error: Error) => error.message }));
beforeEach(() => {
  vi.clearAllMocks();
  api.getWorkspaceSettings.mockResolvedValue({
    workspace: "tasks",
    revision: 0,
    preferences: { defaultCaptureListId: "work" },
  });
  api.listTaskLists.mockResolvedValue({
    items: [
      { id: "inbox", name: "Inbox", kind: "inbox", availability: "active" },
      { id: "work", name: "Work", kind: "standard", availability: "active" },
    ],
    nextCursor: null,
  });
  api.listTaskProjects.mockResolvedValue({
    items: [
      { id: "launch", name: "Launch", listId: "work", availability: "active", lifecycle: "open" },
    ],
    nextCursor: null,
  });
});
function setup(
  path: string,
  task?: Task,
  placement?: { listId: string; projectId: string | null },
) {
  const close = vi.fn();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[path]}>
        <TaskDialog
          close={close}
          task={task}
          placement={placement}
          user={{ planningTimezone: "UTC" } as User}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { user: userEvent.setup(), close };
}
it.each([
  ["/tasks?project=launch", "work", "launch"],
  ["/tasks?list=work", "work", ""],
  ["/tasks?list=missing", "inbox", ""],
  ["/tasks?list=inbox", "inbox", ""],
  ["/tasks", "work", ""],
])("initializes new task placement from %s", async (path, listId, projectId) => {
  setup(path);
  await waitFor(() => expect(screen.getByRole("combobox", { name: "List" })).toHaveValue(listId));
  expect(screen.getByRole("combobox", { name: "Project" })).toHaveValue(projectId);
});
it.each([
  "Lists",
  "Projects",
] as const)("recovers a failed %s lookup without losing the task title", async (kind) => {
  api[kind === "Lists" ? "listTaskLists" : "listTaskProjects"].mockRejectedValueOnce(
    new Error("Offline"),
  );
  const { user } = setup("/tasks");
  await user.type(screen.getByRole("textbox", { name: "Task" }), "Keep this draft");
  await user.click(await screen.findByRole("button", { name: `Retry ${kind}` }));
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: `Retry ${kind}` })).not.toBeInTheDocument(),
  );
  expect(screen.getByRole("textbox", { name: "Task" })).toHaveValue("Keep this draft");
});
it("restores a trashed task with the current revision", async () => {
  const task = {
    id: "t",
    title: "Recover plans",
    listId: "inbox",
    projectId: null,
    lifecycle: "open",
    deletedAt: "2026-10-01T12:00:00.000Z",
    revision: 4,
    tags: [],
    source: { provider: "local" },
  } as unknown as Task;
  api.restoreTask.mockResolvedValue({ ...task, deletedAt: null });
  const { user, close } = setup("/tasks?view=trash", task);
  await user.click(screen.getByRole("button", { name: "Restore task" }));
  await waitFor(() => expect(api.restoreTask).toHaveBeenCalledWith("t", { expectedRevision: 4 }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
});

it.each([
  "missing",
  "archived",
  null,
])("falls back to Inbox when the saved list is %s", async (defaultCaptureListId) => {
  api.getWorkspaceSettings.mockResolvedValue({
    workspace: "tasks",
    revision: 1,
    preferences: { defaultCaptureListId },
  });
  api.listTaskLists.mockResolvedValue({
    items: [
      { id: "inbox", name: "Inbox", kind: "inbox", availability: "active" },
      { id: "archived", name: "Old work", kind: "standard", availability: "archived" },
    ],
    nextCursor: null,
  });
  setup("/tasks");
  await waitFor(() => expect(screen.getByRole("combobox", { name: "List" })).toHaveValue("inbox"));
});
it("preserves an existing task destination despite saved capture settings", async () => {
  setup("/tasks", {
    id: "existing",
    title: "Existing task",
    listId: "inbox",
    projectId: null,
    lifecycle: "open",
    deletedAt: null,
    revision: 1,
    tags: [],
    source: { provider: "local" },
  } as unknown as Task);
  await waitFor(() => expect(screen.getByRole("combobox", { name: "List" })).toHaveValue("inbox"));
});

it("preserves explicit creation placement", async () => {
  setup("/tasks", undefined, { listId: "inbox", projectId: null });
  await waitFor(() => expect(screen.getByRole("combobox", { name: "List" })).toHaveValue("inbox"));
});
it("waits for a saved capture destination instead of locking in Inbox", async () => {
  let resolveSettings: (value: unknown) => void = () => {};
  api.getWorkspaceSettings.mockReturnValue(
    new Promise((resolve) => {
      resolveSettings = resolve;
    }),
  );
  setup("/tasks");
  await screen.findByRole("option", { name: "Inbox" });
  expect(screen.getByRole("combobox", { name: "List" })).toHaveValue("");
  resolveSettings({
    workspace: "tasks",
    revision: 0,
    preferences: { defaultCaptureListId: "work" },
  });
  await waitFor(() => expect(screen.getByRole("combobox", { name: "List" })).toHaveValue("work"));
});
