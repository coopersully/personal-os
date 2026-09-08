import type { TaskWorkspaceItem } from "@personal-os/domain";
import { api, errorMessage } from "../../api";

export type WorkspaceAction = "complete" | "reopen" | "trash" | "restore";
export const workspaceActionLabels: Record<WorkspaceAction, string> = {
  complete: "Complete",
  reopen: "Reopen",
  trash: "Move to Trash",
  restore: "Restore",
};
export const itemKey = (item: TaskWorkspaceItem) => `${item.kind}:${item.record.id}`;

export function availableActions(items: TaskWorkspaceItem[]): WorkspaceAction[] {
  if (!items.length || items.some((item) => item.readOnly)) return [];
  if (items.every((item) => item.deletedAt !== null)) return ["restore"];
  if (items.some((item) => item.deletedAt !== null)) return [];
  const open = (item: TaskWorkspaceItem) =>
    item.kind === "task" ? item.record.lifecycle === "open" : item.record.completedAt === null;
  return [
    ...(items.every(open) ? ["complete" as const] : []),
    ...(items.every((item) => !open(item)) ? ["reopen" as const] : []),
    "trash",
  ];
}

type ActionTransport = Pick<
  typeof api,
  | "completeTask"
  | "reopenTask"
  | "trashTask"
  | "restoreTask"
  | "completeReminder"
  | "trashReminder"
  | "restoreReminder"
>;

/** Explicit, bounded, revision-guarded operations, not an atomic bulk endpoint. */
export async function runWorkspaceBatch(
  items: TaskWorkspaceItem[],
  action: WorkspaceAction,
  transport: ActionTransport = api,
) {
  if (items.length > 100 || !availableActions(items).includes(action))
    throw new Error("This action is not available for the selected items.");
  const succeeded: string[] = [];
  const failed: { key: string; title: string; message: string }[] = [];
  for (const item of items) {
    try {
      if (item.kind === "task") {
        const input = { expectedRevision: item.record.revision };
        if (action === "complete") await transport.completeTask(item.record.id, input);
        else if (action === "reopen") await transport.reopenTask(item.record.id, input);
        else if (action === "trash") await transport.trashTask(item.record.id, input);
        else await transport.restoreTask(item.record.id, input);
      } else {
        const { id, updatedAt } = item.record;
        if (action === "complete" || action === "reopen")
          await transport.completeReminder(id, action === "complete", updatedAt);
        else if (action === "trash") await transport.trashReminder(id, updatedAt);
        else await transport.restoreReminder(id, updatedAt);
      }
      succeeded.push(itemKey(item));
    } catch (error) {
      failed.push({ key: itemKey(item), title: item.record.title, message: errorMessage(error) });
    }
  }
  return { succeeded, failed };
}
