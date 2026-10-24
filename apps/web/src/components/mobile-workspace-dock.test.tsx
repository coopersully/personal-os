// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, expect, it } from "vitest";
import { MenuIcon } from "./icons";
import { MobileWorkspaceDock } from "./mobile-workspace-dock";
import { MotionProvider } from "./motion-provider";

afterEach(cleanup);
function Route() {
  return <output>{useLocation().pathname}</output>;
}
function mount() {
  render(
    <MotionProvider>
      <MemoryRouter>
        <MobileWorkspaceDock
          title="Finances"
          pages={[{ label: "Accounts", path: "/finances/accounts", icon: MenuIcon }]}
        />
        <Route />
      </MemoryRouter>
    </MotionProvider>,
  );
}
it("opens anchored navigation, dismisses with Escape, and restores trigger focus", async () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Workspace actions" }));
  expect(screen.getByRole("dialog", { name: "Finances" })).toHaveFocus();
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
  fireEvent.pointerDown(document.body);
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});
