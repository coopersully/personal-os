import type { TaskList, TaskProject, TaskWorkspaceQuery } from "@personal-os/domain";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { toast } from "sonner-native";
import type { ContainerRow } from "./container-directory";
import { errorMessage, useTaskApi } from "./data";

export type TaskScope = Partial<TaskWorkspaceQuery>;

/** The Browse destinations. Each row opens, and counts, exactly this scope. */
export const browseScopes = {
  all: { view: "all" },
  upcoming: { view: "upcoming" },
  scheduled: { view: "all", reserved: "scheduled", sort: "reserved" },
  reminders: { view: "all", kind: "reminder" },
  tasks: { view: "all", kind: "task" },
  trash: { view: "trash" },
  history: { view: "history" },
} satisfies Record<string, TaskScope>;

/**
 * The scope a List or Project opens. An archived container, and a finished Project, list their
 * tasks in every status; an open one lists what the view's own status allows.
 */
export const containerScope = ({ kind, record }: ContainerRow, archived: boolean): TaskScope => ({
  view: "all",
  ...(archived || (kind === "project" && (record as TaskProject).lifecycle !== "open")
    ? { status: "all" as const }
    : {}),
  kind: "task",
  ...(kind === "list"
    ? { listId: (record as TaskList).id }
    : { projectId: record.id, listId: (record as TaskProject).listId }),
});

/** The status a view lists when neither the destination nor the person has chosen one. */
export const viewStatus = (scope: TaskScope, showCompletedTasks: boolean | undefined) =>
  scope.status ??
  (showCompletedTasks && scope.view !== "history" && scope.view !== "trash"
    ? ("open_and_completed" as const)
    : undefined);

/**
 * The number of items each scope lists, read as the `total` of a one-item page so it is the
 * same number the opened list shows when no search narrows it. Undefined while a total is unread or could not be read: a
 * destination then shows no count rather than a zero. Failed totals raise one Sonner error.
 */
export function useItemCounts(scopes: TaskScope[]): (number | undefined)[] {
  const api = useTaskApi();
  // Watches the preferences the screen already reads without asking for them again: a row
  // that mounts must not retry a failed read behind the screen's own Retry.
  const settings = useQuery({
    queryKey: ["tasks", "settings"],
    queryFn: () => api.getWorkspaceSettings("tasks"),
    enabled: false,
  });
  const showCompleted = settings.data?.preferences.showCompletedTasks;
  const results = useQueries({
    queries: scopes.map((scope) => {
      // Sorting and grouping never change a total, so they stay out of the read and its key.
      const { sort: _sort, group: _group, ...rest } = scope;
      const status = viewStatus(scope, showCompleted);
      const query = { ...rest, ...(status ? { status } : {}), limit: 1 };
      return {
        queryKey: ["tasks", "count", query],
        // The preference decides the status, so the count waits for it rather than reading twice.
        enabled: !settings.isPending,
        // Reported below, so a screen of failed totals raises one Sonner error, not one each.
        meta: { scopedReadFeedback: true },
        queryFn: () => api.listTaskWorkspace(query),
      };
    }),
  });
  const failedAt = Math.max(0, ...results.map((result) => result.errorUpdatedAt));
  const failure = results.find((result) => result.isError && result.errorUpdatedAt === failedAt);
  const settled = results.every((result) => !result.isFetching);
  // Seeded from the cache so a remount does not report a failure that was already reported.
  const reported = useRef(failedAt);
  useEffect(() => {
    if (!settled || !failure || failedAt <= reported.current) return;
    reported.current = failedAt;
    // Tab screens stay mounted, so one id keeps several directories to a single toast.
    toast.error(errorMessage(failure.error), { id: "task-counts" });
  }, [settled, failure, failedAt]);
  return results.map((result) => (result.isError ? undefined : result.data?.total));
}
