import type { TaskList } from "@personal-os/domain";

/** A stale saved destination falls back to the system Inbox, never an arbitrary list. */
export function taskCaptureList(lists: TaskList[], defaultCaptureListId?: string | null) {
  const active = lists.filter((list) => list.availability === "active");
  return (
    active.find((list) => list.id === defaultCaptureListId) ??
    active.find((list) => list.kind === "inbox")
  );
}
