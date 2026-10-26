// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, expect, it } from "vitest";
import { activeWorkspaceSection, workspaceSectionPages } from "../navigation/workspace-sections";
import { MobileWorkspaceDock } from "./mobile-workspace-dock";

afterEach(cleanup);
function Navigation({ owner }: { owner: string }) {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <MobileWorkspaceDock
        workspace={owner}
        pages={workspaceSectionPages(owner, location.search)}
        activeSection={activeWorkspaceSection(owner, location.pathname, location.search)}
      />
      <button type="button" onClick={() => navigate(-1)}>
        back
      </button>
      <output>
        {location.pathname}
        {location.search}
      </output>
    </>
  );
}

it("opens section pages with browser history and keeps the child section selected", () => {
  render(
    <MemoryRouter initialEntries={["/finances/plan"]}>
      <Navigation owner="finances" />
    </MemoryRouter>,
  );
  expect(screen.getByRole("link", { name: "planning" })).toHaveAttribute("aria-current", "page");
  expect(screen.queryByRole("button", { name: "Workspace actions" })).not.toBeInTheDocument();
  const bar = screen.getByRole("navigation", { name: "Workspace sections" });
  expect(bar).toHaveAttribute("data-workspace", "finances");
  expect(bar.style.getPropertyValue("--navigation-selected-index")).toBe("2");
  fireEvent.click(screen.getByRole("link", { name: "money" }));
  expect(screen.getByRole("navigation", { name: "Workspace sections" })).toBe(bar);
  expect(bar.style.getPropertyValue("--navigation-selected-index")).toBe("1");
  expect(screen.getByRole("status")).toHaveTextContent("/finances?navigation=money");
  expect(screen.getByRole("link", { name: "money" })).toHaveAttribute("aria-current", "page");
  fireEvent.click(screen.getByRole("button", { name: "back" }));
  expect(screen.getByRole("status")).toHaveTextContent("/finances/plan");
});

it("preserves selected Mail accounts and exits thread/filter context for the mailbox hub", () => {
  render(
    <MemoryRouter initialEntries={["/mail?account=a&account=b&q=budget&thread=old&unread=1"]}>
      <Navigation owner="mail" />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("link", { name: "mailboxes" }));
  expect(screen.getByRole("status")).toHaveTextContent(
    "/mail?navigation=mailboxes&account=a&account=b",
  );
  expect(screen.getByRole("status")).not.toHaveTextContent("thread=");
});

it("shows every Settings section without a More drawer", () => {
  render(
    <MemoryRouter>
      <Navigation owner="settings" />
    </MemoryRouter>,
  );
  expect(screen.getAllByRole("link").map((link) => link.textContent?.trim())).toEqual([
    "account",
    "personal",
    "workspaces",
    "app",
  ]);
});

it("does not add redundant navigation to Calendar or Today", () => {
  expect(workspaceSectionPages("calendar", "?view=week")).toEqual([]);
  expect(workspaceSectionPages("today", "")).toEqual([]);
});

it("maps historical task views and finance aliases to their section", () => {
  for (const search of ["?archive=all", "?view=completed", "?view=trash"]) {
    expect(activeWorkspaceSection("tasks", "/tasks", search)).toBe("history");
  }
  expect(activeWorkspaceSection("tasks", "/tasks", "?navigation=pinned")).toBe("pinned");
  expect(activeWorkspaceSection("tasks", "/tasks", "?navigation=unknown")).toBe("views");
  expect(activeWorkspaceSection("finances", "/finances/subscriptions", "")).toBe("planning");
});

it("returns to frequent destinations directly while preserving Mail account scope", () => {
  expect(workspaceSectionPages("tasks", "")[0]).toMatchObject({
    path: "/tasks?view=today",
    kind: "destination",
  });
  expect(workspaceSectionPages("finances", "")[0]).toMatchObject({
    path: "/finances",
    kind: "destination",
  });
  const inbox = workspaceSectionPages("mail", "?account=a&account=b&view=sent&thread=old")[0];
  expect(inbox).toMatchObject({ path: "/mail?account=a&account=b", kind: "destination" });
  expect(activeWorkspaceSection("mail", "/mail", "?account=a&thread=message")).toBe("inbox");
  expect(activeWorkspaceSection("mail", "/mail", "?view=sent")).toBe("mailboxes");
  expect(activeWorkspaceSection("tasks", "/tasks", "?view=today")).toBe("today");
  expect(activeWorkspaceSection("finances", "/finances", "")).toBe("overview");
});
