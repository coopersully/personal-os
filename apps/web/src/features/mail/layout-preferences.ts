import type { WorkspacePreferences } from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/api";
import { useFeedbackMutation } from "@/lib/use-feedback-mutation";
import { useWorkspacePreferences } from "../workspace-search/preferences";

export function useMailLayoutPreferences() {
  const settings = useWorkspacePreferences("mail");
  const cache = useQueryClient();
  const save = useFeedbackMutation({
    scope: { id: "mail-layout-preferences" },
    feedback: { action: "save your Mail layout", safeToRetry: false },
    mutationFn: async (
      preferences: Partial<
        Pick<WorkspacePreferences, "mailListDensity" | "mailListWidth" | "mailConversationLayout">
      >,
    ) => {
      const current = await api.getWorkspaceSettings("mail");
      return api.updateWorkspaceSettings("mail", {
        expectedRevision: current.revision,
        preferences,
      });
    },
    onSuccess: (data) => {
      cache.setQueryData(["workspace-settings", "mail"], data);
    },
    onError: () => {
      void cache.invalidateQueries({ queryKey: ["workspace-settings", "mail"] });
    },
  });
  return { settings, save };
}
