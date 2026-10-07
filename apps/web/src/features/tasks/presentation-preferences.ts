import type { WorkspacePreferences } from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "@/api";
import { useFeedbackMutation } from "@/lib/use-feedback-mutation";
import { useWorkspacePreferences } from "../workspace-search/preferences";

/** Explicit links override saved defaults without changing the account's preferences. */
export function taskPresentationParams(
  params: URLSearchParams,
  preferences?: WorkspacePreferences,
) {
  const next = new URLSearchParams(params);
  const defaults = {
    sort: preferences?.taskSort ?? "default",
    group: preferences?.taskGroup ?? "none",
    details:
      preferences?.taskRowDetails?.join(",") || (preferences?.taskRowDetails ? "none" : "estimate"),
    containerSort: preferences?.taskContainerSort ?? "updated",
  };
  for (const [key, value] of Object.entries(defaults)) {
    if (!next.has(key)) next.set(key, value);
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
  const cache = useQueryClient();
  return useFeedbackMutation({
    scope: { id: "tasks-presentation-preferences" },
    feedback: { action: "save your Tasks display preferences", safeToRetry: false },
    mutationFn: async (
      preferences: Partial<
        Pick<
          WorkspacePreferences,
          "taskSort" | "taskGroup" | "taskRowDetails" | "taskContainerSort"
        >
      >,
    ) => {
      // Read the revision when this queued write starts, not when the menu rendered.
      const current = await api.getWorkspaceSettings("tasks");
      return api.updateWorkspaceSettings("tasks", {
        expectedRevision: current.revision,
        preferences,
      });
    },
    onSuccess: (data) => {
      cache.setQueryData(["workspace-settings", "tasks"], data);
    },
    onError: () => {
      void cache.invalidateQueries({ queryKey: ["workspace-settings", "tasks"] });
    },
  });
}
