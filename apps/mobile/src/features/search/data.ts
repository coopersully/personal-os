import type { SearchableWorkspace, WorkspaceSearchResult } from "@personal-os/domain";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner-native";
import { useAuth } from "../auth/context";

/** Search owns its failure toast, so the shared read-error toast stays out of the way. */
const meta = { scopedReadFeedback: true };

/** Display order of result groups; it follows the workspace selector. */
export const searchWorkspaces = [
  "tasks",
  "mail",
  "finances",
  "calendar",
] as const satisfies readonly SearchableWorkspace[];

export type WorkspaceSearchGroup = {
  workspace: SearchableWorkspace;
  status: "waiting" | "failed" | "ready";
  items: WorkspaceSearchResult[];
  /** The server holds more matches than this bounded page shows. */
  more: boolean;
};

function useWorkspaceResults(
  workspace: SearchableWorkspace,
  term: string,
  on: boolean,
  turn: boolean,
  limit: number,
  archiveOverride: boolean | null,
) {
  const { session, state } = useAuth();
  const api = session.api();
  const owner = state.user?.id;
  const active = on && !!owner && term.length > 0;
  // The preference is re-read for each search session so a change made in Settings applies at once.
  const settings = useQuery({
    queryKey: ["workspace-search", owner, "settings", workspace],
    queryFn: () => api.getWorkspaceSettings(workspace),
    enabled: active && archiveOverride === null,
    staleTime: 0,
    meta,
  });
  // An unreadable preference falls back to the server default, which includes archived records.
  const includeArchived =
    archiveOverride ?? settings.data?.preferences.includeArchivedInSearch ?? true;
  const results = useQuery({
    queryKey: ["workspace-search", owner, workspace, term, limit, includeArchived],
    queryFn: ({ signal }) =>
      api.searchWorkspace(workspace, { q: term, kind: "content", limit, includeArchived }, signal),
    enabled: active && turn && (archiveOverride !== null || !settings.isPending),
    // Private previews are not kept after the search surface lets go of them.
    staleTime: 0,
    gcTime: 0,
    meta,
  });
  const failedAt = results.isError ? results.errorUpdatedAt : 0;
  useEffect(() => {
    if (failedAt)
      toast.error(`Couldn’t search ${workspace}. Check your connection and try again.`, {
        id: `workspace-search-${workspace}`,
      });
  }, [failedAt, workspace]);
  return {
    workspace,
    on,
    includeArchived,
    settled: !active || results.isSuccess || results.isError,
    failed: active && results.isError,
    items: active ? (results.data?.items ?? []) : [],
    more: active && results.data?.nextOffset != null,
    refetch: results.refetch,
  };
}

/**
 * Real results from each workspace's search route, grouped by workspace.
 *
 * The API admits one search per account at a time and a newer queued search replaces an older
 * one, so workspaces are asked one after another, never in parallel. A failed workspace reports
 * itself through Sonner and leaves the other groups in place.
 */
export function useWorkspaceSearch(
  scope: readonly SearchableWorkspace[],
  typed: string,
  archiveOverride: boolean | null,
) {
  const text = typed.trim();
  const [term, setTerm] = useState("");
  useEffect(() => {
    if (!text) return setTerm("");
    const timer = setTimeout(() => setTerm(text), 250);
    return () => clearTimeout(timer);
  }, [text]);
  const limit = scope.length > 1 ? 5 : 20;
  const has = (workspace: SearchableWorkspace) => scope.includes(workspace);
  const tasks = useWorkspaceResults("tasks", term, has("tasks"), true, limit, archiveOverride);
  const mail = useWorkspaceResults(
    "mail",
    term,
    has("mail"),
    tasks.settled,
    limit,
    archiveOverride,
  );
  const finances = useWorkspaceResults(
    "finances",
    term,
    has("finances"),
    tasks.settled && mail.settled,
    limit,
    archiveOverride,
  );
  const calendar = useWorkspaceResults(
    "calendar",
    term,
    has("calendar"),
    tasks.settled && mail.settled && finances.settled,
    limit,
    archiveOverride,
  );
  const slots = [tasks, mail, finances, calendar].filter((slot) => slot.on);
  // A term still inside the debounce window has no results of its own yet.
  const current = term === text;
  const groups: WorkspaceSearchGroup[] = slots.map((slot) => ({
    workspace: slot.workspace,
    status: !current || !slot.settled ? "waiting" : slot.failed ? "failed" : "ready",
    items: current ? slot.items : [],
    more: current && slot.more,
  }));
  return {
    groups,
    searching: !!text && groups.some((group) => group.status === "waiting"),
    includeArchived: slots.every((slot) => slot.includeArchived),
    /** Failed workspaces are asked again in order, for the same one-at-a-time reason. */
    retry: async () => {
      const id = "workspace-search-retry";
      toast.loading("Searching again…", { id });
      let failed = false;
      for (const slot of slots) if (slot.failed) failed = (await slot.refetch()).isError || failed;
      // Each workspace that failed again has already said so in its own toast.
      if (failed) toast.dismiss(id);
      else toast.success("Search updated", { id });
    },
  };
}
