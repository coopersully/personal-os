// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, expect, it } from "vitest";
import { MenuIcon } from "./icons";
import { MobileWorkspaceDock } from "./mobile-workspace-dock";
import { MotionProvider } from "./motion-provider";

afterEach(cleanup);
function Route() {
  const location = useLocation();
  return (
    <output>
      {location.pathname}
      {location.search}
    </output>
  );
}
function mount() {
  render(
    <MotionProvider>
      <MemoryRouter>
        <MobileWorkspaceDock
          title="Finances"
          pages={[
            { label: "Overview", path: "/finances", icon: MenuIcon },
            { label: "Spending", path: "/finances/spending", icon: MenuIcon },
            { label: "Budget", path: "/finances/plan", icon: MenuIcon },
            { label: "Accounts", path: "/finances/accounts", icon: MenuIcon },
          ]}
        />
        <Route />
      </MemoryRouter>
    </MotionProvider>,
  );
}
it("opens overflow navigation, dismisses with Escape, and restores trigger focus", async () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Workspace actions" }));
  expect(screen.getByRole("dialog", { name: "Finances" })).toBeInTheDocument();
  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(screen.getByRole("button", { name: "Workspace actions" })).toHaveFocus();
});
it("closes on navigation and on outside interaction", async () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Workspace actions" }));
  fireEvent.click(screen.getByRole("link", { name: "Accounts" }));
  expect(screen.getByRole("status")).toHaveTextContent("/finances/accounts");
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "Workspace actions" }));
  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

it("keeps three primary destinations visible and marks overflow routes", async () => {
  mount();
  expect(screen.getAllByRole("link")).toHaveLength(3);
  fireEvent.click(screen.getByRole("link", { name: "Spending" }));
  expect(screen.getByRole("link", { name: "Spending" })).toHaveAttribute("aria-current", "page");
  fireEvent.click(screen.getByRole("button", { name: "Workspace actions" }));
  fireEvent.click(screen.getByRole("link", { name: "Accounts" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(screen.getByRole("button", { name: "Workspace actions" })).toHaveAttribute(
    "data-active",
    "true",
  );
});

it("preserves Mail account and search context while clearing the selected thread", () => {
  render(
    <MemoryRouter initialEntries={["/mail?account=a&q=Budget&thread=old&unread=1"]}>
      <MobileWorkspaceDock
        title="Mail"
        pages={[{ label: "drafts", path: "/mail?scope=drafts", icon: MenuIcon }]}
      />
      <Route />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("link", { name: "drafts" }));
  expect(screen.getByRole("status")).toHaveTextContent("/mail?scope=drafts&account=a&q=Budget");
  expect(screen.getByRole("status")).not.toHaveTextContent("thread=");
  expect(screen.getByRole("link", { name: "drafts" })).toHaveAttribute("aria-current", "page");
});
