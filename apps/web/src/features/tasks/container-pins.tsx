import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/api";
import { PinIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { useFeedbackMutation } from "@/lib/use-feedback-mutation";
import { useWorkspacePreferences } from "../workspace-search/preferences";

export function TaskContainerPin({
  id,
  kind,
  name,
  unpinOnly = false,
}: {
  id: string;
  kind: "list" | "project";
  name: string;
  unpinOnly?: boolean;
}) {
  const query = useWorkspacePreferences("tasks");
  const cache = useQueryClient();
  const key = kind === "list" ? "pinnedListIds" : "pinnedProjectIds";
  const ids = query.data?.preferences[key] ?? [];
  const pinned = ids.includes(id);
  const save = useFeedbackMutation({
    feedback: { action: pinned ? "unpin this item" : "pin this item", safeToRetry: false },
    scope: { id: "tasks-presentation-preferences" },
    mutationFn: async (shouldPin: boolean) => {
      const current = await api.getWorkspaceSettings("tasks");
      const currentIds = current.preferences[key] ?? [];
      return api.updateWorkspaceSettings("tasks", {
        expectedRevision: current.revision,
        preferences: {
          [key]: shouldPin
            ? [...new Set([...currentIds, id])]
            : currentIds.filter((value) => value !== id),
        },
      });
    },
    onSuccess: (data) => cache.setQueryData(["workspace-settings", "tasks"], data),
    onError: () => {
      void query.refetch();
    },
  });
  if (unpinOnly && !pinned) return null;
  return (
    <Button
      size="icon-sm"
      variant={pinned ? "secondary" : "ghost"}
      aria-pressed={pinned}
      aria-label={`${pinned ? "Unpin" : "Pin"} ${name}`}
      title={`${pinned ? "Unpin" : "Pin"} ${name}`}
      disabled={!query.isSuccess || save.isPending || (!pinned && ids.length >= 100)}
      onClick={() => save.mutate(!pinned)}
    >
      <PinIcon aria-hidden="true" weight={pinned ? "Filled" : "Outline"} />
    </Button>
  );
}
