import { Link } from "react-router-dom";
import { PinIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  useSaveWorkspacePreferences,
  useWorkspacePreferences,
} from "../workspace-settings/preferences";

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
  const key = kind === "list" ? "pinnedListIds" : "pinnedProjectIds";
  const ids = query.data?.preferences[key] ?? [];
  const pinned = ids.includes(id);
  const save = useSaveWorkspacePreferences("tasks");
  const pinRecovery =
    !!save.recovery &&
    ("pinnedListIds" in save.recovery.attempted || "pinnedProjectIds" in save.recovery.attempted);
  if (unpinOnly && !pinned && !pinRecovery) return null;
  return (
    <>
      <Button
        type="button"
        size="icon-sm"
        variant={pinned ? "secondary" : "ghost"}
        aria-pressed={pinned}
        aria-label={`${pinned ? "Unpin" : "Pin"} ${name}`}
        title={`${pinned ? "Unpin" : "Pin"} ${name}`}
        disabled={
          !query.isSuccess || save.isPending || !!save.recovery || (!pinned && ids.length >= 100)
        }
        onClick={() => {
          const shouldPin = !pinned;
          save.mutate((current) => ({
            [key]: shouldPin
              ? [...new Set([...(current[key] ?? []), id])]
              : (current[key] ?? []).filter((value) => value !== id),
          }));
        }}
      >
        <PinIcon aria-hidden="true" weight={pinned ? "Filled" : "Outline"} />
      </Button>
      {pinRecovery ? (
        <Button asChild variant="secondary">
          <Link to="/settings?section=tasks">Review unsaved pin preferences</Link>
        </Button>
      ) : null}
    </>
  );
}
