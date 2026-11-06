import { ApiClientError, type createApiClient } from "@personal-os/api-client";
import type { TaskWorkspaceItem } from "@personal-os/domain";
export async function allPages<T>(
  load: (cursor?: string) => Promise<{ items: T[]; nextCursor: string | null }>,
) {
  const items: T[] = [];
  let cursor: string | undefined;
  const seen = new Set<string>();
  for (let page = 0; page < 30; page++) {
    const result = await load(cursor);
    items.push(...result.items);
    if (!result.nextCursor) return items;
    if (seen.has(result.nextCursor)) throw new Error("Repeated pagination cursor");
    seen.add(result.nextCursor);
    cursor = result.nextCursor;
  }
  throw new Error("Too many task containers to load. Narrow the workspace on web.");
}
/** Direct getters exclude deleted records; Trash exposes the authoritative restore version. */
export async function loadTrashedRecord(
  api: Pick<ReturnType<typeof createApiClient>, "listTaskWorkspace">,
  kind: "task" | "reminder",
  id: string,
) {
  let cursor: string | undefined;
  const seen = new Set<string>();
  for (let page = 0; page < 30; page++) {
    const result = await api.listTaskWorkspace({ view: "trash", kind, limit: 100, cursor });
    const item = result.items.find((item) => item.kind === kind && item.record.id === id);
    if (item) return item.record;
    if (!result.nextCursor)
      throw new ApiClientError({
        status: 404,
        code: "NOT_FOUND",
        message: "This item is no longer in Trash. Close this screen and refresh Trash.",
      });
    if (seen.has(result.nextCursor)) throw new Error("Repeated pagination cursor");
    seen.add(result.nextCursor);
    cursor = result.nextCursor;
  }
  throw new Error("Trash is too large to load this record. Restore it from the Trash list.");
}
export const itemKey = (item: TaskWorkspaceItem) => `${item.kind}:${item.record.id}`;
export function uniqueItems(items: TaskWorkspaceItem[]) {
  const unique = new Map<string, TaskWorkspaceItem>();
  for (const item of items) {
    unique.delete(itemKey(item));
    unique.set(itemKey(item), item);
  }
  return [...unique.values()];
}
export function isOpen(item: TaskWorkspaceItem) {
  return item.kind === "task" ? item.record.lifecycle === "open" : !item.record.completedAt;
}
export type ItemAction = "complete" | "reopen" | "trash" | "restore" | "cancel";
export async function actOnItem(
  api: ReturnType<typeof createApiClient>,
  item: TaskWorkspaceItem,
  action: ItemAction,
) {
  if (item.readOnly) throw new Error("This item is read-only.");
  if (item.kind === "task") {
    const input = { expectedRevision: item.record.revision };
    if (action === "complete") return api.completeTask(item.record.id, input);
    if (action === "reopen") return api.reopenTask(item.record.id, input);
    if (action === "cancel") return api.cancelTask(item.record.id, input);
    if (action === "trash") return api.trashTask(item.record.id, input);
    return api.restoreTask(item.record.id, input);
  }
  if (action === "cancel") throw new Error("Reminders do not have a cancelled state.");
  const { id, updatedAt } = item.record;
  if (action === "complete" || action === "reopen")
    return api.completeReminder(id, action === "complete", updatedAt);
  if (action === "trash") return api.trashReminder(id, updatedAt);
  return api.restoreReminder(id, updatedAt);
}

/** Reverse only a confirmed mutation, using its revision rather than a newer fetched record. */
export async function actWithUndo(
  api: ReturnType<typeof createApiClient>,
  item: TaskWorkspaceItem,
  action: ItemAction,
) {
  const record = await actOnItem(api, item, action);
  const inverse: ItemAction =
    action === "trash"
      ? "restore"
      : action === "restore"
        ? "trash"
        : action === "reopen"
          ? item.kind === "task" && item.record.lifecycle === "cancelled"
            ? "cancel"
            : "complete"
          : "reopen";
  const updated = { ...item, record } as TaskWorkspaceItem;
  return {
    undo: async () => {
      await actOnItem(api, updated, inverse);
    },
  };
}
