import {
  getDefaultWorkspacePreferences,
  type TasksWorkspacePreferences,
} from "@personal-os/domain";
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import {
  useSaveWorkspacePreferences,
  useWorkspacePreferences,
} from "../workspace-settings/preferences";

/** Explicit links override saved defaults without changing the account's preferences. */
export function taskPresentationParams(
  params: URLSearchParams,
  preferences?: TasksWorkspacePreferences,
) {
  const next = new URLSearchParams(params);
  const values = { ...getDefaultWorkspacePreferences("tasks"), ...preferences };
  const defaults = {
    sort: values.taskSort,
    group: values.taskGroup,
    details: values.taskRowDetails.join(",") || "none",
    containerSort: values.taskContainerSort,
  };
  for (const [key, value] of Object.entries(defaults)) {
    if (!next.has(key)) next.set(key, value);
  }
  // Lifecycle views and explicit filters keep their own semantics.
  const view = params.get("view");
  const container = !view || (view === "all" && (params.has("list") || params.has("project")));
  if (container && !next.has("status") && values.showCompletedTasks) {
    next.set("status", "open_and_completed");
  }
  return next;
}

export function useTaskPresentationParams() {
  const [params] = useSearchParams();
  const settings = useWorkspacePreferences("tasks");
  return useMemo(
    () => taskPresentationParams(params, settings.data?.preferences),
    [params, settings.data?.preferences],
  );
}

export function useSaveTaskPresentation() {
  return useSaveWorkspacePreferences("tasks");
}
