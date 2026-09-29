import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, errorMessage } from "../../api.js";
import { Button } from "../../components/ui/button.js";
import { Input } from "../../components/ui/input.js";
import { NativeSelect, NativeSelectOption } from "../../components/ui/native-select.js";
export function RitualHistory() {
  const cache = useQueryClient();
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<"morning" | "night" | null>(null);
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
  async function exportData() {
    try {
      const data = await api.exportRitualData();
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "nohmi-rituals.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  async function remove() {
    if (!deleting) return;
    try {
      await api.deleteRitualData(deleting);
      setDeleting(null);
      await cache.invalidateQueries({ queryKey: ["rituals"] });
      await history.refetch();
    } catch (e) {
      setError(errorMessage(e));
    }
  }
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
      {history.isError ? <p role="alert">{errorMessage(history.error)}</p> : null}
      {history.data?.pages
        .flatMap((p) => p.items)
        .map((o) => (
          <details key={o.id}>
            <summary>
              {o.definition.kind === "night" ? "Evening ritual" : "Morning ritual"} ·{" "}
              {o.scheduledLocalDate} · {o.status.replaceAll("_", " ")}
            </summary>
            <div className="flex flex-col gap-2 py-3">
              <p>Due {new Date(o.dueAt).toLocaleString()}</p>
              {o.responses.map((r) => (
                <p key={r.id}>
                  {o.definition.steps.find((s) => s.id === r.stepId)?.label}:{" "}
                  {typeof r.value === "boolean" ? (r.value ? "Done" : "Unchecked") : r.value}{" "}
                  {r.submitted ? "" : "(draft)"} · {new Date(r.recordedAt).toLocaleString()}
                </p>
              ))}
              {o.actions.map((a) => (
                <p key={a.id}>
                  {a.kind.replaceAll("_", " ")} · {a.outcome} ·{" "}
                  {new Date(a.recordedAt).toLocaleString()}
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
        <Button variant="outline" onClick={() => void exportData()}>
          Export rituals
        </Button>
        <Button variant="ghost" onClick={() => setDeleting("morning")}>
          Delete morning data
        </Button>
        <Button variant="ghost" onClick={() => setDeleting("night")}>
          Delete evening data
        </Button>
      </div>
      {deleting ? (
        <div role="alert">
          <p>
            Delete the {deleting === "night" ? "evening" : "morning"} ritual and all its answers and
            history? This cannot be undone.
          </p>
          <Button variant="destructive" onClick={() => void remove()}>
            Delete permanently
          </Button>
          <Button variant="ghost" onClick={() => setDeleting(null)}>
            Cancel
          </Button>
        </div>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
