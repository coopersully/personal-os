// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EditIcon, TrashIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ReminderItem,
  ReminderItemActions,
  ReminderItemCompletion,
  ReminderItemDescription,
  ReminderItemPrimaryAction,
  ReminderItemTitle,
} from "./reminder-item";
import {
  TaskItem,
  TaskItemActions,
  TaskItemCompletion,
  TaskItemDescription,
  TaskItemMetadata,
  TaskItemPrimaryAction,
  TaskItemTitle,
} from "./task-item";

describe("commitment item components", () => {
  it("keeps task completion, detail, and secondary actions independently operable", async () => {
    const onComplete = vi.fn();
    const onOpen = vi.fn();
    const onRemove = vi.fn();
    const user = userEvent.setup();

    render(
      <TaskItem>
        <TaskItemCompletion>
          <Checkbox aria-label="Complete Draft product update" onCheckedChange={onComplete} />
        </TaskItemCompletion>
        <TaskItemPrimaryAction aria-label="Open Draft product update" onClick={onOpen}>
          <TaskItemTitle>Draft product update</TaskItemTitle>
          <TaskItemDescription>Due today · 20 min</TaskItemDescription>
        </TaskItemPrimaryAction>
        <TaskItemMetadata>
          <Badge>next</Badge>
        </TaskItemMetadata>
        <TaskItemActions>
          <Button
            aria-label="Remove Draft product update"
            onClick={onRemove}
            size="icon-sm"
            variant="ghost"
          >
            <TrashIcon />
          </Button>
        </TaskItemActions>
      </TaskItem>,
    );

    await user.click(screen.getByRole("checkbox", { name: "Complete Draft product update" }));
    await user.click(screen.getByRole("button", { name: "Open Draft product update" }));
    await user.click(screen.getByRole("button", { name: "Remove Draft product update" }));

    expect(
      screen
        .getByRole("button", { name: "Open Draft product update" })
        .closest('[data-component="commitment-item"]'),
    ).toHaveAttribute("data-slot", "task-item");
    expect(onComplete).toHaveBeenCalledWith(true);
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it("allows a reminder to omit metadata while keeping its completion and detail actions named", async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();

    render(
      <ReminderItem>
        <ReminderItemCompletion>
          <Checkbox aria-label="Reopen Call Mom" checked />
        </ReminderItemCompletion>
        <ReminderItemPrimaryAction aria-label="Open Call Mom" onClick={onOpen}>
          <ReminderItemTitle>Call Mom</ReminderItemTitle>
          <ReminderItemDescription>No due date</ReminderItemDescription>
        </ReminderItemPrimaryAction>
        <ReminderItemActions>
          <Button aria-label="Edit Call Mom" size="icon-sm" variant="ghost">
            <EditIcon />
          </Button>
        </ReminderItemActions>
      </ReminderItem>,
    );

    await user.click(screen.getByRole("button", { name: "Open Call Mom" }));

    expect(
      screen.getByRole("button", { name: "Open Call Mom" }).closest('[data-component="commitment-item"]'),
    ).toHaveAttribute("data-slot", "reminder-item");
    expect(screen.getByRole("checkbox", { name: "Reopen Call Mom" })).toBeChecked();
    expect(onOpen).toHaveBeenCalledOnce();
  });
});
