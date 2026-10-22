import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../api.js";
import { useConfirmAction } from "../../components/confirm-action.js";
import { Button } from "../../components/ui/button.js";
import { useFeedbackMutation } from "../../lib/use-feedback-mutation.js";

export function RitualDataAction({ kind, disabled = false }: { kind?: "morning" | "night"; disabled?: boolean }) {
  const cache = useQueryClient();
  const exportData = useFeedbackMutation({
    feedback: { action: "export ritual history", safeToRetry: true, form: false },
    mutationFn: async () => {
      const data = await api.exportRitualData();
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "nohmi-rituals.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  });
  const remove = useFeedbackMutation({
    feedback: {
      action: "delete ritual history",
      form: false,
      safeToRetry: true,
      success: "Ritual history deleted.",
    },
    mutationFn: (kind: "morning" | "night") => api.deleteRitualData(kind),
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: ["rituals"] });
      await cache.invalidateQueries({ queryKey: ["ritual-history"] });
    },
  });
  const { confirm, confirmation } = useConfirmAction();
  const deleteHistory = (kind: "morning" | "night") =>
    confirm({
      title: `Delete ${kind === "night" ? "evening" : "morning"} ritual data?`,
      description:
        "This permanently deletes the ritual, its answers, and its history. This cannot be undone.",
      actionLabel: "Delete permanently",
      onConfirm: () => remove.mutate(kind),
    });

  return <>
    {kind ? <Button variant="destructive" size="sm" disabled={disabled || remove.isPending} onClick={() => deleteHistory(kind)}>Delete Data</Button> :
      <Button variant="secondary" size="sm" disabled={exportData.isPending} onClick={() => confirm({
        intent: "default",
        title: "Export Rituals?",
        description: "Download your ritual definitions, answers, and history as a JSON file on this device.",
        actionLabel: "Export Rituals",
        onConfirm: () => exportData.mutate(),
      })}>Export Rituals</Button>}
    {confirmation}
  </>;
}
