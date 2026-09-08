import type { TaskList, TaskProject, TaskWorkspaceItem } from "@personal-os/domain";
import { MoreHorizontalIcon } from "@/components/icons";
import { ReminderItem, ReminderItemCompletion } from "@/components/reminder-item";
import {
  TaskItem,
  TaskItemCompletion,
  TaskItemContent,
  TaskItemDescription,
  TaskItemPrimaryAction,
  TaskItemTitle,
} from "@/components/task-item";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatRelativeMaterialDateTime } from "../../lib/date-format";
import { availableActions, type WorkspaceAction, workspaceActionLabels } from "./workspace-actions";

export function WorkspaceRow({
  item,
  list,
  project,
  timeZone,
  details,
  selectionMode,
  selected,
  disabled,
  onSelect,
  onOpen,
  onAction,
}: {
  item: TaskWorkspaceItem;
  list?: TaskList;
  project?: TaskProject;
  timeZone: string;
  details: string[];
  selectionMode: boolean;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onAction: (action: WorkspaceAction) => void;
}) {
  const record = item.record;
  const completed =
    item.kind === "task"
      ? record.completedAt !== null && record.completedAt !== undefined
      : record.completedAt !== null;
  const actions = availableActions([item]);
  const completeAction = actions.includes("reopen") ? "reopen" : "complete";
  const overdue =
    !completed && !item.deletedAt && record.dueAt && Date.parse(record.dueAt) < Date.now();
  const Row = item.kind === "task" ? TaskItem : ReminderItem;
  const Completion = item.kind === "task" ? TaskItemCompletion : ReminderItemCompletion;
  const context =
    item.kind === "task" ? [list?.name, project?.name].filter(Boolean).join(" / ") : "";
  const meta = [
    context,
    item.kind === "task" && details.includes("estimate") && item.record.estimateMinutes
      ? `${item.record.estimateMinutes} min`
      : null,
    item.readOnly ? "Read only" : null,
    item.kind === "task" && item.record.lifecycle === "cancelled" ? "Cancelled" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Row
      className="task-workspace-row min-h-0 items-center gap-x-2 py-2 data-[selected=true]:bg-accent"
      data-completed={completed}
      data-priority={record.priority}
      data-selected={selected}
    >
      <Completion className="self-center pt-0">
        <Checkbox
          aria-label={
            selectionMode
              ? `Select ${record.title}`
              : `${completeAction === "reopen" ? "Reopen" : "Complete"} ${record.title}`
          }
          checked={selectionMode ? selected : completed}
          disabled={disabled || (selectionMode ? item.readOnly : !actions.includes(completeAction))}
          onCheckedChange={() => (selectionMode ? onSelect() : onAction(completeAction))}
        />
      </Completion>
      <TaskItemPrimaryAction aria-label={`Open ${record.title}`} onClick={onOpen}>
        <TaskItemContent className="gap-0.5">
          <TaskItemTitle className="pr-1 group-hover/commitment-item:no-underline group-focus-within/commitment-item:no-underline">
            {record.title}
          </TaskItemTitle>
          {record.priority === "high" ? <span className="sr-only">High priority</span> : null}
          {item.kind === "reminder" ? <span className="sr-only">Reminder</span> : null}
          {record.dueAt || (item.kind === "task" && item.record.scheduledAt) || meta ? (
            <TaskItemDescription>
              {item.kind === "task" && item.record.scheduledAt ? (
                <span>
                  Reserved {formatRelativeMaterialDateTime(item.record.scheduledAt, timeZone)}
                  {record.dueAt || meta ? " · " : ""}
                </span>
              ) : null}
              {record.dueAt ? (
                <>
                  <span className={overdue ? "text-destructive" : undefined}>
                    Due {formatRelativeMaterialDateTime(record.dueAt, timeZone)}
                  </span>
                  {meta ? " · " : ""}
                </>
              ) : null}
              {meta}
            </TaskItemDescription>
          ) : null}
          {details.includes("notes") && record.notes ? (
            <TaskItemDescription>{record.notes}</TaskItemDescription>
          ) : null}
          {details.includes("tags") && item.kind === "task" && item.record.tags.length ? (
            <span className="flex flex-wrap gap-1">
              {item.record.tags.map((tag) => (
                <Badge variant="secondary" key={tag}>
                  {tag}
                </Badge>
              ))}
            </span>
          ) : null}
        </TaskItemContent>
      </TaskItemPrimaryAction>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon-xs"
            variant="ghost"
            disabled={disabled}
            aria-label={`${record.title} options`}
          >
            <MoreHorizontalIcon aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={onOpen}>Open {item.kind}</DropdownMenuItem>
            {!item.readOnly ? (
              <DropdownMenuItem onSelect={onSelect}>
                {selected ? "Deselect" : "Select"}
              </DropdownMenuItem>
            ) : null}
            {actions.map((action) => (
              <DropdownMenuItem key={action} onSelect={() => onAction(action)}>
                {workspaceActionLabels[action]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </Row>
  );
}
