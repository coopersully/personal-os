// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { TaskList, TaskProject } from "@personal-os/domain";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WorkspaceNavigationPage } from "@/components/workspace-navigation-page";
import { getTaskListIcon } from "./task-list-icons";
import {
  archiveScopeFromParams,
  TaskContainerActions,
  TaskNavigation,
  taskPath,
  taskViewFromParams,
} from "./task-navigation";

vi.mock("../workspace-settings/preferences", () => ({
  useWorkspacePreferences: () => ({
    isSuccess: true,
    data: { preferences: { pinnedListIds: ["work"], pinnedProjectIds: ["launch"] } },
  }),
}));

it("exposes collection views and explicitly pinned containers", () => {
  const lists = [
    { id: "inbox", icon: "list", name: "Inbox", kind: "inbox" },
    { id: "work", icon: "star", name: "Work", kind: "standard" },
    { id: "other", icon: "list", name: "Not pinned", kind: "standard" },
  ] as TaskList[];
  const projects = [{ id: "launch", listId: "work", name: "Launch" }] as TaskProject[];
  render(
    <MemoryRouter initialEntries={["/tasks?view=today"]}>
      <TooltipProvider>
        <SidebarProvider>
          <TaskNavigation
            lists={lists}
            projects={projects}
            counts={{
              inbox: 3,
              today: 12,
              upcoming: 0,
              all: 24,
              lists: 3,
              projects: 1,
              history: 4,
              trash: 0,
              archive: 2,
            }}
            onNavigate={() => {}}
          />
        </SidebarProvider>
      </TooltipProvider>
    </MemoryRouter>,
  );
  for (const name of ["Inbox", "Today", "Upcoming", "All", "Work", "Launch", "History", "Trash"]) {
    expect(screen.getByRole("link", { name })).toBeVisible();
  }
  expect(
    screen.queryByRole("button", { name: /More views|Expand|Collapse/ }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Today" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "All" })).toHaveAttribute("href", "/tasks?view=all");
  expect(screen.getByText("Pinned")).toBeVisible();
  expect(screen.queryByRole("link", { name: "Not pinned" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Inbox options" })).not.toBeInTheDocument();
  const work = screen.getByRole("link", { name: "Work" });
  expect(work).toHaveAttribute("data-user-created", "true");
  expect(work.querySelector('[data-list-icon="star"]')).toBeInTheDocument();
  expect(screen.getByRole("group", { name: "Inbox items: 3" })).toBeVisible();
  expect(screen.getByRole("group", { name: "Today items: 12" })).toBeVisible();
  expect(screen.getByRole("group", { name: "Upcoming items: 0" })).toBeVisible();
});

it("parses bounded destinations and preserves presentation filters", () => {
  expect(taskViewFromParams(new URLSearchParams("view=upcoming"))).toBe("upcoming");
  expect(taskViewFromParams(new URLSearchParams("view=unknown"))).toBeNull();
  expect(archiveScopeFromParams(new URLSearchParams("archive=project"))).toBe("project");
  expect(archiveScopeFromParams(new URLSearchParams("archive=unknown"))).toBeNull();
  expect(
    taskPath(
      new URLSearchParams("q=rent&sort=due&task=t1&ignored=nope"),
      { list: "list-1", project: "project-1", view: "all" },
      true,
    ),
  ).toBe("/tasks?q=rent&sort=due&task=t1&view=all&list=list-1&project=project-1");
  expect(taskPath(new URLSearchParams(), {})).toBe("/tasks");
  expect(getTaskListIcon("unknown" as never)).toBe(getTaskListIcon(null));
});

it("opens the contextual list and project management surfaces", async () => {
  const user = userEvent.setup();
  const list = {
    id: "work",
    icon: "star",
    name: "Work",
    kind: "standard",
    revision: 1,
  } as TaskList;
  const project = { id: "launch", listId: "work", name: "Launch", revision: 1 } as TaskProject;
  const client = new QueryClient();
  const { unmount } = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TooltipProvider>
          <SidebarProvider>
            <TaskContainerActions list={list} lists={[list]} projects={[project]} />
          </SidebarProvider>
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await user.click(screen.getByRole("button", { name: "Work options" }));
  await user.click(screen.getByRole("menuitem", { name: "Edit list" }));
  expect(screen.getByRole("heading", { name: "Manage Work" })).toBeVisible();
  unmount();

  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TooltipProvider>
          <SidebarProvider>
            <TaskContainerActions
              list={list}
              project={project}
              lists={[list]}
              projects={[project]}
            />
          </SidebarProvider>
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await user.click(screen.getByRole("button", { name: "Edit Launch" }));
  expect(screen.getByRole("heading", { name: "Manage Launch" })).toBeVisible();
});

it("normalizes reminder, history, scheduled, archive, and project destinations", () => {
  const lists = [
    { id: "inbox", icon: "list", name: "Inbox", kind: "inbox" },
    { id: "work", icon: null, name: "Work", kind: "standard" },
  ] as TaskList[];
  const projects = [{ id: "launch", listId: "work", name: "Launch" }] as TaskProject[];
  const cases = [
    ["/reminders?view=completed", "History"],
    ["/reminders", "All"],
    ["/tasks?view=scheduled", "All"],
    ["/tasks?view=cancelled", "History"],
    ["/tasks?archive=all", "Archive"],
    ["/tasks?list=work&project=launch", "Launch"],
  ] as const;

  for (const [entry, selected] of cases) {
    const { unmount } = render(
      <MemoryRouter initialEntries={[entry]}>
        <TooltipProvider>
          <SidebarProvider>
            <TaskNavigation lists={lists} projects={projects} onNavigate={() => {}} />
          </SidebarProvider>
        </TooltipProvider>
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: selected })).toHaveAttribute("aria-current", "page");
    unmount();
  }
});

it("keeps creation in the primary flow instead of the pinned group", () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/tasks"]}>
        <TooltipProvider>
          <SidebarProvider>
            <TaskNavigation
              lists={[]}
              projects={[]}
              status={<span>Loading lists</span>}
              onNavigate={() => {}}
            />
          </SidebarProvider>
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(screen.getByText("Loading lists")).toBeVisible();
  expect(screen.queryByRole("button", { name: "New List" })).not.toBeInTheDocument();
  expect(screen.queryByText("My lists")).not.toBeInTheDocument();
});

it("reuses only the requested section in a mobile landing page", () => {
  render(
    <MemoryRouter initialEntries={["/tasks?navigation=history"]}>
      <TooltipProvider>
        <SidebarProvider>
          <WorkspaceNavigationPage section="history">
            <TaskNavigation
              lists={[]}
              projects={[]}
              counts={{ history: 4, trash: 0 }}
              onNavigate={() => {}}
            />
          </WorkspaceNavigationPage>
        </SidebarProvider>
      </TooltipProvider>
    </MemoryRouter>,
  );
  expect(screen.getByRole("link", { name: "History" })).toHaveAttribute(
    "href",
    "/tasks?view=history",
  );
  expect(screen.getByRole("group", { name: "Trash items: 0" })).toBeInTheDocument();
  expect(screen.queryByRole("navigation", { name: "Task views" })).not.toBeInTheDocument();
  expect(
    screen.queryByRole("navigation", { name: "Pinned lists and projects" }),
  ).not.toBeInTheDocument();
});

it("omits direct app-bar shortcuts only inside the mobile category page", () => {
  const { unmount } = render(
    <MemoryRouter>
      <TooltipProvider>
        <SidebarProvider>
          <WorkspaceNavigationPage section="views" shortcuts={["today"]}>
            <TaskNavigation lists={[]} projects={[]} onNavigate={() => {}} />
          </WorkspaceNavigationPage>
        </SidebarProvider>
      </TooltipProvider>
    </MemoryRouter>,
  );
  expect(screen.queryByRole("link", { name: "Today" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Upcoming" })).toBeInTheDocument();
  unmount();
  render(
    <MemoryRouter>
      <TooltipProvider>
        <SidebarProvider>
          <TaskNavigation lists={[]} projects={[]} onNavigate={() => {}} />
        </SidebarProvider>
      </TooltipProvider>
    </MemoryRouter>,
  );
  expect(screen.getByRole("link", { name: "Today" })).toBeInTheDocument();
});
