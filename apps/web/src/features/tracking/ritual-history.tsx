import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../api.js";
import { QueryFeedback } from "../../components/async-state.js";
import { useConfirmAction } from "../../components/confirm-action.js";
import { MutationFeedback } from "../../components/mutation-feedback.js";
import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";
import { NativeSelect, NativeSelectOption } from "../../components/ui/native-select.js";
import { useFeedbackMutation } from "../../lib/use-feedback-mutation.js";
export function RitualHistory() {
  const cache = useQueryClient();
  const [kind, setKind] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const filters = {
    ...(kind ? { kind } : {}),
    ...(dateFrom ? { dateFrom } : {}),
    ...(dateTo ? { dateTo } : {}),
  };
  const history = useInfiniteQuery({
    refetchInterval: 5000,
    queryKey: ["ritual-history", filters],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.listRitualHistory(pageParam, filters),
    getNextPageParam: (p) => p.nextCursor ?? undefined,
  });
  const exportData = useFeedbackMutation({
    feedback: { action: "export ritual history", safeToRetry: true, form: true },
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
      form: true,
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
  return (
    <section className="flex flex-col gap-4" aria-label="Ritual history">
      <div className="flex flex-wrap gap-3">
        <label htmlFor="ritual-history-kind">
          Ritual
          <NativeSelect
            id="ritual-history-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <NativeSelectOption value="">Both rituals</NativeSelectOption>
            <NativeSelectOption value="morning">Morning</NativeSelectOption>
            <NativeSelectOption value="night">Evening</NativeSelectOption>
          </NativeSelect>
        </label>
        <label htmlFor="ritual-history-from">
          From
          <Input
            id="ritual-history-from"
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </label>
        <label htmlFor="ritual-history-through">
          Through
          <Input
            id="ritual-history-through"
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </label>
      </div>
      {history.isPending ? <p>Loading history…</p> : null}
      <QueryFeedback query={history} title="Couldn’t load ritual history." />
      {history.data?.pages
        .flatMap((p) => p.items)
        .map((o) => (
          <details key={o.id}>
            <summary>
              {o.definition.kind === "night" ? "Evening ritual" : "Morning ritual"} ·{" "}
              {o.scheduledLocalDate} · {o.status.replaceAll("_", " ")}
            </summary>
            <div className="flex flex-col gap-2 py-3">
              <p>
                Due{" "}
                {new Date(o.dueAt).toLocaleString(undefined, {
                  timeZone: o.timeZone,
                  timeZoneName: "short",
                })}
              </p>
              {o.responses.map((r) => (
                <p key={r.id}>
                  {o.definition.steps.find((s) => s.id === r.stepId)?.label}:{" "}
                  {typeof r.value === "boolean" ? (r.value ? "Done" : "Unchecked") : r.value}{" "}
                  {r.submitted ? "" : "(draft)"} ·{" "}
                  {new Date(r.recordedAt).toLocaleString(undefined, {
                    timeZone: o.timeZone,
                    timeZoneName: "short",
                  })}
                </p>
              ))}
              {o.actions.map((a) => (
                <p key={a.id}>
                  {a.kind.replaceAll("_", " ")} · {a.outcome} ·{" "}
                  {new Date(a.recordedAt).toLocaleString(undefined, {
                    timeZone: o.timeZone,
                    timeZoneName: "short",
                  })}
                </p>
              ))}
            </div>
          </details>
        ))}
      {history.data?.pages[0]?.items.length === 0 ? (
        <p className="text-muted-foreground">Your ritual history will appear here.</p>
      ) : null}
      {history.hasNextPage ? (
        <Button variant="outline" onClick={() => void history.fetchNextPage()}>
          More history
        </Button>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => exportData.mutate()}>
          Export rituals
        </Button>
        <Button variant="ghost" onClick={() => deleteHistory("morning")}>
          Delete morning data
        </Button>
        <Button variant="ghost" onClick={() => deleteHistory("night")}>
          Delete evening data
        </Button>
      </div>
      <MutationFeedback feedback={exportData.feedback} />
      <MutationFeedback feedback={remove.feedback} />
      {confirmation}
    </section>
  );
}
