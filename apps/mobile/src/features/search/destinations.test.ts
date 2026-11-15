import { expect, it } from "vitest";
import { searchDestination, searchResultIcon, searchResultPreview } from "./destinations";

const result = (kind: string, state: string | null = null, title = "Name") => ({
  id: "r1",
  kind,
  title,
  preview: "",
  href: "/web-only",
  state,
});
it.each([
  ["calendar", "Event", "push", { pathname: "/calendar-event", params: { id: "r1" } }],
  ["calendar", "Calendar", "push", { pathname: "/settings/calendar/source", params: { id: "r1" } }],
  ["tasks", "Task", "push", { pathname: "/task-editor", params: { id: "r1", kind: "task" } }],
  [
    "tasks",
    "Reminder",
    "push",
    { pathname: "/task-editor", params: { id: "r1", kind: "reminder" } },
  ],
  [
    "tasks",
    "List",
    "push",
    {
      pathname: "/task-browser",
      params: { title: "Name", view: "all", kind: "task", listId: "r1" },
    },
  ],
  [
    "tasks",
    "Project",
    "push",
    {
      pathname: "/task-browser",
      params: { title: "Name", view: "all", kind: "task", projectId: "r1" },
    },
  ],
  ["mail", "Conversation", "navigate", { pathname: "/mail", params: { mailSearch: "Name" } }],
  ["mail", "Mailbox", "navigate", "/mail/mailboxes"],
  ["mail", "Rule", "push", { pathname: "/settings/mail/rule", params: { id: "r1" } }],
  ["finances", "Transaction", "push", { pathname: "/finance-transaction", params: { id: "r1" } }],
  ["finances", "Account", "push", { pathname: "/finance-account", params: { id: "r1" } }],
  ["finances", "Category", "push", "/settings/finances"],
  ["finances", "Plan", "navigate", "/finances/plan"],
  ["calendar", "Something new", "navigate", "/calendar"],
] as const)("opens a %s %s result with %s", (workspace, kind, open, href) => {
  expect(searchDestination(workspace, result(kind))).toEqual({ href, open });
});
it("shows every status inside a closed or archived container and opens Mail for an untitled conversation", () => {
  expect(searchDestination("tasks", result("Project", "Completed")).href).toMatchObject({
    params: { projectId: "r1", status: "all" },
  });
  expect(searchDestination("tasks", result("List", "Archived")).href).toMatchObject({
    params: { listId: "r1", status: "all" },
  });
  // Mail's list search reads inboxes only, so it cannot show an archived conversation.
  expect(searchDestination("mail", result("Conversation", "Archived"))).toEqual({
    href: "/mail/mailboxes",
    open: "navigate",
  });
  // The mail list accepts at most 200 characters of search.
  expect(
    searchDestination("mail", result("Conversation", null, ` ${"s".repeat(300)}`)).href,
  ).toEqual({ pathname: "/mail", params: { mailSearch: "s".repeat(200) } });
  expect(searchDestination("mail", result("Conversation", null, " "))).toEqual({
    href: "/mail",
    open: "navigate",
  });
});
it("picks a registry icon per kind and trims empty preview parts", () => {
  expect(searchResultIcon("tasks", "Reminder")).toBe("clock");
  expect(searchResultIcon("finances", "Something new")).toBe("finances");
  expect(searchResultPreview("Task ·  ·  · Due Nov 20, 2026")).toBe("Task · Due Nov 20, 2026");
  expect(searchResultPreview(" · ")).toBe("");
});
