// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { TaskListDialog } from "./task-list-dialog";

const mocks = vi.hoisted(() => ({
  archiveTaskList: vi.fn(),
  createTaskList: vi.fn(),
  updateTaskList: vi.fn(),
}));

vi.mock("../../api.js", () => ({
  api: mocks,
  errorMessage: (error: Error) => error.message,
}));

it("creates a user List with the selected sidebar icon", async () => {
  const user = userEvent.setup();
  const close = vi.fn();
  mocks.createTaskList.mockResolvedValue({});
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TaskListDialog close={close} list={undefined} lists={[]} />
    </QueryClientProvider>,
  );

  await user.type(screen.getByLabelText("Name"), "Household");
  await user.click(screen.getByRole("radio", { name: "Home" }));
  await user.click(screen.getByRole("button", { name: "Create List" }));

  await waitFor(() =>
    expect(mocks.createTaskList).toHaveBeenCalledWith({
      color: null,
      description: null,
      icon: "home",
      name: "Household",
    }),
  );
  await waitFor(() => expect(close).toHaveBeenCalled());
});

it("updates and archives an existing user List", async () => {
  const user = userEvent.setup();
  const close = vi.fn();
  const list = {
    id: "work",
    kind: "standard",
    name: "Work",
    description: "Original",
    icon: "star",
    revision: 4,
  } as never;
  mocks.updateTaskList.mockResolvedValue({});
  mocks.archiveTaskList.mockResolvedValue({});
  const { rerender } = render(
    <QueryClientProvider client={new QueryClient()}>
      <TaskListDialog close={close} list={list} lists={[list]} />
    </QueryClientProvider>,
  );

  await user.clear(screen.getByLabelText("Name"));
  await user.type(screen.getByLabelText("Name"), "Work projects");
  await user.clear(screen.getByLabelText("Description"));
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() =>
    expect(mocks.updateTaskList).toHaveBeenCalledWith("work", {
      description: null,
      icon: "star",
      name: "Work projects",
      expectedRevision: 4,
    }),
  );

  rerender(
    <QueryClientProvider client={new QueryClient()}>
      <TaskListDialog archiveOnly close={close} list={list} lists={[list]} />
    </QueryClientProvider>,
  );
  await user.click(screen.getByRole("button", { name: "Archive List" }));
  await waitFor(() =>
    expect(mocks.archiveTaskList).toHaveBeenCalledWith("work", { expectedRevision: 4 }),
  );
});

it("does not allow the protected Inbox to be edited", () => {
  const { container } = render(
    <QueryClientProvider client={new QueryClient()}>
      <TaskListDialog
        close={() => {}}
        list={{ id: "inbox", kind: "inbox", icon: "list", revision: 1 } as never}
        lists={[]}
      />
    </QueryClientProvider>,
  );
  expect(container).toBeEmptyDOMElement();
});

it("resolves an active-content archive conflict with a destination and current revision", async () => {
  const user = userEvent.setup();
  const list = {
    id: "work",
    kind: "standard",
    name: "Work",
    icon: "list",
    revision: 4,
  } as never;
  const destination = {
    id: "personal",
    kind: "standard",
    name: "Personal",
    icon: "home",
    revision: 2,
  } as never;
  mocks.archiveTaskList
    .mockRejectedValueOnce({
      details: {
        code: "task_list_has_active_contents",
        currentRevisions: { destinationList: null, project: null, sourceList: 8, task: null },
        openContentCounts: { projects: 1, tasks: 2 },
        resolutions: ["move_active_contents", "archive_contents_together", "cancel"],
      },
    })
    .mockResolvedValueOnce({});
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TaskListDialog archiveOnly close={() => {}} list={list} lists={[list, destination]} />
    </QueryClientProvider>,
  );

  await user.click(screen.getByRole("button", { name: "Archive List" }));
  expect(await screen.findByText("Choose what happens to active contents")).toBeVisible();
  expect(screen.getByRole("button", { name: "Move active contents" })).toBeDisabled();
  await user.selectOptions(screen.getByLabelText("Destination List"), "personal");
  await user.click(screen.getByRole("button", { name: "Move active contents" }));
  await waitFor(() =>
    expect(mocks.archiveTaskList).toHaveBeenLastCalledWith("work", {
      destinationListId: "personal",
      expectedRevision: 8,
      resolution: "move_active_contents",
    }),
  );
});

it("keeps save failures visible and closes from the standard cancel action", async () => {
  const user = userEvent.setup();
  const close = vi.fn();
  mocks.createTaskList.mockRejectedValueOnce(new Error("Name already exists"));
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TaskListDialog close={close} list={undefined} lists={[]} />
    </QueryClientProvider>,
  );
  await user.type(screen.getByLabelText("Name"), "Work");
  await user.type(screen.getByLabelText("Description"), "  Useful work  ");
  await user.click(screen.getByRole("button", { name: "Create List" }));
  expect(await screen.findByText("Name already exists")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(close).toHaveBeenCalled();
});
