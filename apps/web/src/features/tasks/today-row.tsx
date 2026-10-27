import type { Reminder, Task, TaskWorkspaceItem } from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateMaterial } from "@/lib/material-queries";
import { useFeedbackMutation } from "@/lib/use-feedback-mutation";
import { runWorkspaceBatch, type WorkspaceAction } from "./workspace-actions";
import { WorkspaceRow } from "./workspace-row";

/** Today supplies scope; Tasks owns record rendering and guarded mutations. */
export function TodayCommitmentRow({
  record,
  kind,
  onOpen,
  timeZone,
}: {
  record: Task | Reminder;
  kind: "task" | "reminder";
  onOpen: () => void;
  timeZone: string;
}) {
  const cache = useQueryClient();
  const item = {
    kind,
    record,
    deletedAt: null,
    readOnly: false,
    relevantAt: record.dueAt,
    groupKey: "none",
  } as TaskWorkspaceItem;
  const mutation = useFeedbackMutation({
    feedback: {
      action: "update this item",
      safeToRetry: false,
      pending: "Updating item…",
      success: "Item updated.",
    },
    mutationFn: async (action: WorkspaceAction) => {
      const result = await runWorkspaceBatch([item], action);
      if (result.failed.length) throw new Error(result.failed[0]?.message);
    },
    onSuccess: () => invalidateMaterial(cache),
  });
  return (
    <WorkspaceRow
      item={item}
      timeZone={timeZone}
      details={["estimate"]}
      selectionMode={false}
      selected={false}
      disabled={mutation.isPending}
      onOpen={onOpen}
      onAction={(action) => mutation.mutate(action)}
    />
  );
}
