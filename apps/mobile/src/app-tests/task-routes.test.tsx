// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import ToDo from "../app/(workspaces)/tasks/index";
import Lists from "../app/(workspaces)/tasks/lists";
import Projects from "../app/(workspaces)/tasks/projects";
import Browse from "../app/(workspaces)/tasks/views";
import Reminders from "../app/reminders";
import TaskBrowser from "../app/task-browser";
import TaskContainers from "../app/task-containers";

vi.mock("sonner-native", () => ({
  toast: { info: vi.fn(), loading: vi.fn(), success: vi.fn(), error: vi.fn(), dismiss: vi.fn() },
}));
vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  return createRequire(`${process.cwd()}/package.json`)("react");
});
vi.mock("react-native", () => import("../../test/native"));
vi.mock("../components/icons", () => ({ Icon: () => null }));
const h = vi.hoisted(() => ({
  params: {} as Record<string, unknown>,
  list: {} as Record<string, unknown>,
  redirect: {} as Record<string, unknown>,
}));
vi.mock("expo-router", () => ({
  useLocalSearchParams: () => h.params,
  Stack: { Screen: () => null },
  Redirect: ({ href }: { href: Record<string, unknown> }) => {
    h.redirect = href;
    return <span>redirecting</span>;
  },
}));
vi.mock("../features/tasks/task-list", () => ({
  TaskListScreen: (props: Record<string, unknown>) => {
    h.list = props;
    return <span>{String(props.title)}</span>;
  },
}));
vi.mock("../features/tasks/hub", () => ({
  TasksHub: ({ mode }: { mode: string }) => <span>{mode}</span>,
}));
afterEach(() => {
  cleanup();
  h.params = {};
});
it("validates browser link parameters and preserves valid scoped task filters", () => {
  h.params = { view: "all", kind: "task", due: "today", sort: "auto", title: "My tasks" };
  const { rerender } = render(<TaskBrowser />);
  expect(h.list).toMatchObject({
    title: "My tasks",
    standalone: true,
    scope: { view: "all", kind: "task", due: "today", sort: "auto" },
  });
  h.params = { view: "invalid" };
  rerender(<TaskBrowser />);
  expect(screen.getByText("This task link is invalid.")).toBeVisible();
  expect(screen.queryByText("My tasks")).not.toBeInTheDocument();
  h.params = {};
  rerender(<TaskBrowser />);
  expect(h.list.title).toBe("tasks");
});
it.each([
  "projects",
  "archive",
  "lists",
  "invalid",
])("resolves container mode %s safely", (mode) => {
  h.params = { mode };
  render(<TaskContainers />);
  expect(
    screen.getByText(mode === "projects" || mode === "archive" ? mode : "lists"),
  ).toBeVisible();
});
it("routes notification reminder links to the exact record and generic links to reminders", () => {
  h.params = { reminder: "reminder-id" };
  const { rerender } = render(<Reminders />);
  expect(h.redirect).toEqual({
    pathname: "/task-editor",
    params: { id: "reminder-id", kind: "reminder" },
  });
  h.params = {};
  rerender(<Reminders />);
  expect(h.redirect).toEqual({
    pathname: "/task-browser",
    params: { view: "all", kind: "reminder", title: "reminders" },
  });
});
it("defaults To-do to today and auto sorting and keeps projects/lists/browse separate", () => {
  const { rerender } = render(<ToDo />);
  expect(h.list).toMatchObject({ title: "to-do", scope: { view: "all" } });
  expect(h.list).toMatchObject({
    initialFilters: { due: "today" },
    scope: { sort: "auto", status: "open" },
  });
  rerender(<Lists />);
  expect(screen.getByText("lists")).toBeVisible();
  rerender(<Projects />);
  expect(screen.getByText("projects")).toBeVisible();
  rerender(<Browse />);
  expect(screen.getByText("views")).toBeVisible();
});
