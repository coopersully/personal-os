// @vitest-environment jsdom
import type { TaskList, TaskProject } from "@personal-os/domain";
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { selectTaskContainers, TaskContainerControls, TaskContainersPage } from "./containers-page";
import { taskPath } from "./task-navigation";

const lists = [
  {
    id: "work",
    name: "Work",
    description: "Career",
    availability: "active",
    updatedAt: "2026-10-01",
    createdAt: "2026-01-01",
  },
  {
    id: "home",
    name: "Home",
    description: "Household",
    availability: "active",
    updatedAt: "2026-10-03",
    createdAt: "2026-02-01",
  },
  {
    id: "archive",
    name: "Past",
    availability: "archived",
    updatedAt: "2026-10-02",
    createdAt: "2026-03-01",
  },
] as TaskList[];
const projects = [
  {
    id: "launch",
    name: "Launch",
    listId: "work",
    notes: "Invite partners",
    lifecycle: "open",
    availability: "active",
    targetDate: "2026-11-01",
    updatedAt: "2026-10-03",
    createdAt: "2026-01-01",
  },
  {
    id: "garden",
    name: "Garden",
    listId: "home",
    lifecycle: "open",
    availability: "active",
    targetDate: null,
    updatedAt: "2026-10-01",
    createdAt: "2026-02-01",
  },
  {
    id: "done",
    name: "Delivered",
    listId: "work",
    lifecycle: "completed",
    availability: "active",
    updatedAt: "2026-10-02",
    createdAt: "2026-03-01",
  },
  {
    id: "past",
    name: "Past work",
    listId: "archive",
    lifecycle: "open",
    availability: "active",
    updatedAt: "2026-10-02",
    createdAt: "2026-03-01",
  },
] as TaskProject[];
const ids = (kind: "lists" | "projects" | "archive", search = "") =>
  selectTaskContainers(kind, lists, projects, new URLSearchParams(search)).map(
    (record) => record.id,
  );

describe("task container collections", () => {
  it("shows retained containers in Archive with shared search, status, and sort", () => {
    expect(ids("archive")).toEqual(["done", "archive", "past"]);
    expect(ids("archive", "q=delivered")).toEqual(["done"]);
    expect(ids("archive", "containerStatus=archived")).toEqual(["archive", "past"]);
    expect(ids("archive", "containerStatus=completed")).toEqual(["done"]);
  });
  it("shows active lists and open projects with active owners by default", () => {
    expect(ids("lists")).toEqual(["home", "work"]);
    expect(ids("projects")).toEqual(["launch", "garden"]);
    expect(ids("projects", "containerStatus=archived")).toEqual(["past"]);
    expect(ids("projects", "containerStatus=completed")).toEqual(["done"]);
  });
  it("searches descriptions, notes, and owning list names", () => {
    expect(ids("lists", "q=household")).toEqual(["home"]);
    expect(ids("projects", "q=partners")).toEqual(["launch"]);
    expect(ids("projects", "q=work")).toEqual(["launch"]);
  });
  it("sorts recent updates and puts undated projects last", () => {
    expect(ids("projects", "containerSort=updated")).toEqual(["launch", "garden"]);
    expect(ids("projects", "containerSort=target")).toEqual(["launch", "garden"]);
  });
  it("does not carry incompatible task filters into collection views or back", () => {
    expect(
      taskPath(new URLSearchParams("priority=high&sort=priority&q=launch"), { view: "projects" }),
    ).toBe("/tasks?q=launch&view=projects");
    expect(
      taskPath(new URLSearchParams("view=projects&containerStatus=archived&containerSort=target"), {
        view: "all",
      }),
    ).toBe("/tasks?view=all");
  });
});

const api = vi.hoisted(() => ({
  listTaskLists: vi.fn(),
  listTaskProjects: vi.fn(),
  getWorkspaceSettings: vi.fn(),
  updateWorkspaceSettings: vi.fn(),
}));
vi.mock("../../api", () => ({ api, errorMessage: (error: Error) => error.message }));
beforeEach(() => {
  vi.clearAllMocks();
  api.listTaskLists.mockResolvedValue({ items: lists, nextCursor: null });
  api.listTaskProjects.mockResolvedValue({ items: projects, nextCursor: null });
  api.getWorkspaceSettings.mockResolvedValue({ revision: 2, preferences: {} });
  api.updateWorkspaceSettings.mockResolvedValue({ revision: 3, preferences: {} });
});
function renderCollection(kind: "lists" | "projects" | "archive", query = "") {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[`/tasks?view=${kind}&${query}`]}>
        <TaskContainerControls kind={kind} />
        <TaskContainersPage kind={kind} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}
it("uses updated order and a selected Lists option when Projects saved target-date sorting", async () => {
  api.getWorkspaceSettings.mockResolvedValue({
    revision: 2,
    preferences: { taskContainerSort: "target" },
  });
  const records = [
    { ...lists[0], name: "Alpha", updatedAt: "2026-10-01" },
    { ...lists[1], name: "Zulu", updatedAt: "2026-10-04" },
  ] as TaskList[];
  expect(
    selectTaskContainers("lists", records, [], new URLSearchParams("containerSort=target")).map(
      ({ name }) => name,
    ),
  ).toEqual(["Zulu", "Alpha"]);
  const user = renderCollection("lists");
  await screen.findByText("Work");
  await user.click(screen.getByRole("button", { name: "Sort lists" }));
  expect(screen.getByRole("menuitemradio", { name: "Recently updated" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  expect(screen.queryByRole("menuitemradio", { name: "Target date" })).not.toBeInTheDocument();
  expect(api.updateWorkspaceSettings).not.toHaveBeenCalled();
});
it("excludes deleted containers and projects whose owner was deleted in all statuses", () => {
  const deletedLists = lists.map((list) =>
    list.id === "work" ? { ...list, deletedAt: "2026-10-01" } : list,
  );
  const deletedProjects = projects.map((project) =>
    project.id === "garden" ? { ...project, deletedAt: "2026-10-01" } : project,
  );
  expect(
    selectTaskContainers(
      "lists",
      deletedLists,
      deletedProjects,
      new URLSearchParams("containerStatus=all"),
    ).map(({ id }) => id),
  ).toEqual(["home", "archive"]);
  expect(
    selectTaskContainers(
      "projects",
      deletedLists,
      deletedProjects,
      new URLSearchParams("containerStatus=all"),
    ).map(({ id }) => id),
  ).toEqual(["past"]);
});
it("orders newest and named collections deterministically, including undated archive ties", () => {
  expect(ids("projects", "containerStatus=all&containerSort=newest")).toEqual([
    "done",
    "past",
    "garden",
    "launch",
  ]);
  expect(ids("projects", "containerSort=name")).toEqual(["garden", "launch"]);
  const twins = [
    { ...projects[0], id: "z", name: "Same", targetDate: null },
    { ...projects[0], id: "a", name: "Same", targetDate: null },
  ] as TaskProject[];
  expect(
    selectTaskContainers("projects", lists, twins, new URLSearchParams("containerSort=target")).map(
      ({ id }) => id,
    ),
  ).toEqual(["a", "z"]);
  expect(ids("archive", "containerSort=target")).toEqual(["done", "archive", "past"]);
});
it("clears an unsuccessful collection search and status together", async () => {
  const user = renderCollection("lists", "q=missing&containerStatus=archived");
  expect(await screen.findByText("No matches")).toBeVisible();
  expect(screen.getByText("0 lists matching “missing”")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Clear filters" }));
  expect(await screen.findByRole("link", { name: "Work" })).toHaveAttribute(
    "href",
    "/tasks?list=work",
  );
  expect(screen.getByText("2 lists")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
});
it("filters completed and cancelled projects to their history links", async () => {
  api.listTaskProjects.mockResolvedValue({
    items: [
      ...projects,
      {
        ...projects[0],
        id: "cancel",
        name: "Stopped",
        lifecycle: "cancelled",
        why: "No longer needed",
      },
    ],
    nextCursor: null,
  });
  const user = renderCollection("projects", "containerStatus=all");
  expect(await screen.findByRole("link", { name: "Launch" })).toHaveAttribute(
    "href",
    "/tasks?list=work&project=launch",
  );
  expect(screen.getByRole("link", { name: "Stopped" })).toHaveAttribute(
    "href",
    "/tasks?view=history&project=cancel&status=cancelled",
  );
  expect(screen.getByText("Cancelled")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Filter projects" }));
  await user.selectOptions(screen.getByRole("combobox", { name: "Status" }), "completed");
  expect(await screen.findByText("1 project")).toBeVisible();
  expect(screen.getByRole("link", { name: "Delivered" })).toHaveAttribute(
    "href",
    "/tasks?view=history&project=done&status=completed",
  );
  await user.selectOptions(screen.getByRole("combobox", { name: "Status" }), "cancelled");
  expect(screen.queryByRole("link", { name: "Delivered" })).not.toBeInTheDocument();
  expect(screen.getByText("No longer needed")).toBeVisible();
});
it("offers only list-relevant sorting and persists a chosen order", async () => {
  const user = renderCollection("lists");
  await screen.findByText("2 lists");
  await user.click(screen.getByRole("button", { name: "Sort lists" }));
  expect(screen.queryByRole("menuitemradio", { name: "Target date" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("menuitemradio", { name: "Newest first" }));
  await waitFor(() =>
    expect(api.updateWorkspaceSettings).toHaveBeenCalledWith("tasks", {
      expectedRevision: 2,
      preferences: { taskContainerSort: "newest" },
    }),
  );
  expect(
    screen
      .getAllByRole("listitem")
      .map((item) => within(item).getAllByRole("link")[0]?.textContent),
  ).toEqual(["Home", "Work"]);
});
it("keeps a project with unavailable list context inspectable", async () => {
  api.listTaskProjects.mockResolvedValue({
    items: [{ ...projects[0], listId: "missing" }],
    nextCursor: null,
  });
  renderCollection("projects");
  expect(await screen.findByText("List unavailable")).toBeVisible();
  expect(screen.getByRole("link", { name: "Launch" })).toHaveAttribute(
    "href",
    "/tasks?list=missing&project=launch",
  );
});
it("links the Inbox collection directly to its default task route", async () => {
  api.listTaskLists.mockResolvedValue({
    items: [{ ...lists[0], kind: "inbox" }],
    nextCursor: null,
  });
  renderCollection("lists");
  expect(await screen.findByRole("link", { name: "Work" })).toHaveAttribute("href", "/tasks");
});
it("counts a single retained item and keeps archive status filtering explicit", async () => {
  api.listTaskLists.mockResolvedValue({ items: [lists[2]], nextCursor: null });
  api.listTaskProjects.mockResolvedValue({ items: [], nextCursor: null });
  const user = renderCollection("archive", "containerStatus=all");
  expect(await screen.findByText("1 item")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Filter archive" }));
  expect(screen.queryByRole("option", { name: "Active" })).not.toBeInTheDocument();
  await user.selectOptions(screen.getByRole("combobox", { name: "Status" }), "completed");
  expect(await screen.findByText("No matches")).toBeVisible();
});
it.each([
  "lists",
  "projects",
] as const)("shows an empty %s collection without invented records", async (kind) => {
  api.listTaskLists.mockResolvedValue({ items: [], nextCursor: null });
  api.listTaskProjects.mockResolvedValue({ items: [], nextCursor: null });
  renderCollection(kind);
  expect(await screen.findByText(`No active ${kind}`)).toBeVisible();
});
it.each([
  "lists",
  "projects",
] as const)("shows the failed %s dependency without a misleading empty state", async (kind) => {
  api[kind === "lists" ? "listTaskLists" : "listTaskProjects"].mockRejectedValueOnce(
    new Error("Offline"),
  );
  renderCollection("projects");
  expect(await screen.findByText(`Couldn’t load ${kind}.`)).toBeVisible();
  expect(screen.queryByText("No active projects")).not.toBeInTheDocument();
});
