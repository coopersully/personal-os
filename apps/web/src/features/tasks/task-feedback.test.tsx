// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { Task } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TaskRow } from "./page";
import { TaskProjectDialog } from "./task-project-dialog";

const mocks = vi.hoisted(() => ({
  trashTask: vi.fn(),
  restoreTask: vi.fn(),
  completeTaskProject: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("../../api.js", () => ({ api: mocks }));
vi.mock("sonner", () => ({
  toast: { success: mocks.success, error: mocks.error, dismiss: vi.fn() },
}));
beforeEach(() => vi.resetAllMocks());

it.each([
  "restore",
  "refresh",
  "success",
])("reports Undo %s after the trashed task row unmounts", async (outcome) => {
  const task: Task = {
    id: "task",
    title: "Plan trip",
    lifecycle: "open",
    deletedAt: null,
    dueAt: null,
    scheduledAt: null,
    tags: [],
    priority: "medium",
    notes: null,
    estimateMinutes: null,
    revision: 2,
    timezone: "UTC",
    why: null,
    cancelledAt: null,
    completedAt: null,
    createdAt: "2026-09-30T10:00:00Z",
    updatedAt: "2026-09-30T10:00:00Z",
    legacyStatus: null,
    listId: "work",
    projectId: null,
    source: {
      accountId: null,
      provider: "local",
      remoteId: "task",
      revision: "2",
      sourceType: "task",
    },
  };
  const trashed = { ...task, deletedAt: "2026-09-30T12:00:00Z", revision: 3 };
  mocks.trashTask.mockResolvedValue(trashed);
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const view = render(
    <QueryClientProvider client={client}>
      <TaskRow task={task} timeZone="UTC" onEdit={() => {}} />
    </QueryClientProvider>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Remove Plan trip" }));
  await waitFor(() =>
    expect(mocks.success).toHaveBeenCalledWith("Task moved to Trash.", expect.any(Object)),
  );
  const undo = mocks.success.mock.calls[0]?.[1].action.onClick as () => void;
  view.unmount();
  invalidate.mockClear();
  if (outcome === "restore")
    mocks.restoreTask.mockRejectedValue(new Error("private provider failure"));
  else mocks.restoreTask.mockResolvedValue(task);
  if (outcome === "refresh") invalidate.mockRejectedValue(new Error("refresh failed"));
  await act(async () => {
    undo();
  });
  expect(mocks.restoreTask).toHaveBeenCalledWith("task", { expectedRevision: 3 });
  if (outcome === "restore") {
    expect(mocks.error).toHaveBeenCalledWith(
      expect.stringContaining("Couldn’t confirm whether we could restore this task"),
      { duration: Number.POSITIVE_INFINITY },
    );
    expect(mocks.error.mock.calls[0]?.[0]).toContain("Open Trash");
    expect(mocks.error.mock.calls[0]?.[0]).not.toContain("private provider failure");
    expect(invalidate).not.toHaveBeenCalled();
  } else if (outcome === "refresh") {
    expect(mocks.error).toHaveBeenCalledWith(
      "The task was restored, but the view couldn’t refresh. Refresh the page to see it.",
      { duration: Number.POSITIVE_INFINITY },
    );
  } else {
    expect(invalidate).toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
  }
});

it("shows project completion choices without a generic conflict but preserves resolution failures", async () => {
  mocks.completeTaskProject
    .mockRejectedValueOnce({
      details: {
        code: "task_project_has_open_tasks",
        currentRevisions: { destinationList: null, project: 8, sourceList: 4, task: null },
        openContentCounts: { projects: 0, tasks: 2 },
        resolutions: [
          "complete_open_tasks",
          "cancel_open_tasks",
          "move_open_tasks",
          "keep_project_open",
        ],
      },
    })
    .mockRejectedValueOnce(new Error("private resolution failure"))
    .mockResolvedValue({});
  const close = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TaskProjectDialog
        close={close}
        listId="work"
        lists={[]}
        projects={[]}
        project={{
          id: "project",
          name: "Launch",
          lifecycle: "open",
          listId: "work",
          revision: 5,
          availability: "active",
          archivedAt: null,
          cancelledAt: null,
          completedAt: null,
          createdAt: "2026-09-30T10:00:00Z",
          updatedAt: "2026-09-30T10:00:00Z",
          deletedAt: null,
          notes: null,
          targetDate: null,
          why: null,
          source: {
            accountId: null,
            provider: "local",
            remoteId: "project",
            revision: "5",
            sourceType: "task_project",
          },
        }}
      />
    </QueryClientProvider>,
  );
  const browser = userEvent.setup();
  await browser.click(screen.getByRole("button", { name: "Complete Project" }));
  expect(
    await screen.findByRole("heading", { name: "Choose what happens to open Tasks" }),
  ).toBeVisible();
  expect(screen.queryByText(/Couldn’t/)).not.toBeInTheDocument();
  await browser.click(screen.getByRole("button", { name: "Complete open Tasks" }));
  expect(
    await screen.findByText(/Couldn’t confirm whether we could update this project/),
  ).toBeVisible();
  await browser.click(screen.getByRole("button", { name: "Complete open Tasks" }));
  await waitFor(() => expect(close).toHaveBeenCalled());
  expect(mocks.completeTaskProject).toHaveBeenLastCalledWith("project", {
    expectedRevision: 8,
    resolution: "complete_open_tasks",
  });
});
