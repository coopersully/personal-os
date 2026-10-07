// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ActionButton } from "./action-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

it("labels icon actions and shows a tooltip on keyboard focus without breaking menu triggers", async () => {
  const user = userEvent.setup();
  render(
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <ActionButton size="icon" aria-label="Sort items">
          S
        </ActionButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem>Newest</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>,
  );
  await user.tab();
  expect(await screen.findByRole("tooltip")).toHaveTextContent("Sort items");
  await user.keyboard("{Enter}");
  expect(await screen.findByRole("menuitem", { name: "Newest" })).toBeVisible();
});
it("keeps icon links as a single focusable link with a tooltip", async () => {
  const user = userEvent.setup();
  render(
    <ActionButton asChild size="icon">
      <a href="/settings" aria-label="Settings">
        S
      </a>
    </ActionButton>,
  );
  await user.tab();
  expect(screen.getByRole("link", { name: "Settings" })).toHaveFocus();
  expect(await screen.findByRole("tooltip")).toHaveTextContent("Settings");
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
