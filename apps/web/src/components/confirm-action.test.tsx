// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { useConfirmAction } from "./confirm-action.js";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "./ui/context-menu.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu.js";

function Harness({ onConfirm, menu = false }: { onConfirm: () => void; menu?: boolean }) {
  const { confirm, confirmation } = useConfirmAction();
  const request = () =>
    confirm({
      title: "Delete Sample?",
      description: "Sample and its saved content will be removed.",
      actionLabel: "Delete Sample",
      onConfirm,
    });
  return (
    <>
      {menu ? (
        <DropdownMenu>
          <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={request}>Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <button type="button" onClick={request}>
          Delete
        </button>
      )}
      {confirmation}
    </>
  );
}

describe("useConfirmAction", () => {
  it.each([
    false,
    true,
  ])("restores a context trigger after a disappearing item (deferred: %s)", async (deferred) => {
    const user = userEvent.setup();
    const action = vi.fn();
    function ContextHarness() {
      const { confirm, confirmation } = useConfirmAction();
      const trigger = useRef<HTMLButtonElement>(null);
      return (
        <>
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <button ref={trigger} type="button">
                Event
              </button>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem
                onSelect={() => {
                  const request = () =>
                    confirm({
                      title: "Delete event?",
                      description: "Removes this event.",
                      actionLabel: "Delete event",
                      onConfirm: action,
                      ...(deferred ? { returnFocus: trigger.current } : {}),
                    });
                  if (deferred) setTimeout(request, 0);
                  else request();
                }}
              >
                Delete
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
          {confirmation}
        </>
      );
    }
    render(<ContextHarness />);
    const trigger = screen.getByRole("button", { name: "Event" });
    fireEvent.contextMenu(trigger);
    await user.keyboard("{ArrowDown}{Enter}");
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus());
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(action).not.toHaveBeenCalled();
  });
  it("focuses Cancel, describes the consequence, and restores focus after keyboard cancellation", async () => {
    const user = userEvent.setup();
    const action = vi.fn();
    render(<Harness onConfirm={action} />);
    const trigger = screen.getByRole("button", { name: "Delete" });
    await user.tab();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("dialog", { name: "Delete Sample?" })).toHaveAccessibleDescription(
      "Sample and its saved content will be removed.",
    );
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(action).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(action).not.toHaveBeenCalled();
  });

  it("runs the named action once after deliberate keyboard confirmation", async () => {
    const user = userEvent.setup();
    const action = vi.fn();
    render(<Harness onConfirm={action} />);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.tab();
    expect(screen.getByRole("button", { name: "Delete Sample" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(action).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete" })).toHaveFocus());
  });

  it("returns focus to the menu trigger after the invoking menu item unmounts", async () => {
    const user = userEvent.setup();
    const action = vi.fn();
    render(<Harness onConfirm={action} menu />);
    const trigger = screen.getByRole("button", { name: "Actions" });
    await user.tab();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveFocus());
    await user.keyboard("{Enter}");
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(action).not.toHaveBeenCalled();
  });
});
