import type { WorkspacePreferences } from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "@/api";
import { useFeedbackMutation } from "@/lib/use-feedback-mutation";
import { useWorkspacePreferences } from "../workspace-search/preferences";

/** Explicit links override saved defaults without changing the account's preferences. */
export function financePresentationParams(
  params: URLSearchParams,
  preferences?: WorkspacePreferences,
) {
  const next = new URLSearchParams(params);
  const defaults = {
    view: preferences?.financeTransactionView ?? "table",
    group: preferences?.financeTransactionGroup ?? "none",
  };
  for (const [key, value] of Object.entries(defaults)) {
    if (!next.has(key)) next.set(key, value);
  }
  return next;
}

export function useFinancePresentationParams() {
  const [params] = useSearchParams();
  const settings = useWorkspacePreferences("finances");
  return useMemo(
    () => financePresentationParams(params, settings.data?.preferences),
    [params, settings.data?.preferences],
  );
}

export function useSaveFinancePresentation() {
  const cache = useQueryClient();
  return useFeedbackMutation({
    scope: { id: "finances-presentation-preferences" },
    feedback: { action: "save your Finance display preferences", safeToRetry: false },
    mutationFn: async (
      preferences: Partial<
        Pick<WorkspacePreferences, "financeTransactionView" | "financeTransactionGroup">
      >,
    ) => {
      // Read the revision when this queued write starts, not when the menu rendered.
      const current = await api.getWorkspaceSettings("finances");
      return api.updateWorkspaceSettings("finances", {
        expectedRevision: current.revision,
        preferences,
      });
    },
    onSuccess: (data) => {
      cache.setQueryData(["workspace-settings", "finances"], data);
    },
    onError: () => {
      void cache.invalidateQueries({ queryKey: ["workspace-settings", "finances"] });
    },
  });
}
