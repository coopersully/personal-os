// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { TasksCreateButton } from "./create-flow";

const api = vi.hoisted(() => ({
  listTaskLists: vi.fn(),
  listTaskProjects: vi.fn(),
  getWorkspaceSettings: vi.fn(),
}));
vi.mock("@/api", () => ({ api }));
beforeEach(() => {
  vi.clearAllMocks();
  api.listTaskLists.mockResolvedValue({
    items: [
      { id: "inbox", name: "Inbox", kind: "inbox", availability: "active" },
      { id: "work", name: "Work", kind: "standard", availability: "active" },
    ],
    nextCursor: null,
  });
  api.listTaskProjects.mockResolvedValue({
    items: [
      { id: "launch", name: "Launch", listId: "inbox", availability: "active", lifecycle: "open" },
    ],
    nextCursor: null,
  });
  api.getWorkspaceSettings.mockResolvedValue({
    workspace: "tasks",
    revision: 0,
    preferences: { defaultCaptureListId: "work" },
  });
});
it.each([
  ["/tasks", "work", null],
  ["/tasks?list=inbox", "inbox", null],
  ["/tasks?project=launch", "inbox", "launch"],
])("uses the appropriate initial task destination on %s", async (path, listId, projectId) => {
  const onCreate = vi.fn();
  const user = userEvent.setup();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["me"], { id: "owner" });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <TasksCreateButton onCreate={onCreate} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await user.click(screen.getByRole("button", { name: "Create in Tasks" }));
  await user.click(screen.getByRole("button", { name: "Task Something to do" }));
  await waitFor(() => expect(screen.getByRole("combobox", { name: "List" })).toHaveValue(listId));
  await user.click(screen.getByRole("button", { name: "Continue" }));
  expect(onCreate).toHaveBeenCalledWith({ listId, projectId });
});
