import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";
import { errorMessage } from "../../api.js";
import { Button } from "../../components/ui/button.js";
export function RitualLocal() {
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");
  const local = useQuery({
    queryKey: ["ritual-local"],
    queryFn: () =>
      invoke<{ queue: unknown[]; enabled: boolean; localHistory: unknown[] }>("ritual_local", {
        discard: false,
      }),
    refetchInterval: 10000,
  });
  async function discard() {
    try {
      await invoke("ritual_local", { discard: true });
      setConfirm(false);
      await local.refetch();
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  function exportPending() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(local.data, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "nohmi-pending-ritual-changes.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted-foreground">
        Automatic rituals on this Mac: {local.data?.enabled ? "on" : "off"}
      </p>
      {local.data?.queue?.length || local.data?.localHistory?.length ? (
        <>
          <p role="status">
            {local.data?.queue?.length ?? 0} ritual changes are waiting to sync or need review.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={exportPending}>
              Export pending changes
            </Button>
            <Button variant="ghost" onClick={() => setConfirm(true)}>
              Discard pending changes
            </Button>
          </div>
          <details>
            <summary>Inspect pending changes</summary>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs">
              {JSON.stringify(local.data, null, 2)}
            </pre>
          </details>
        </>
      ) : null}
      {confirm ? (
        <div role="alert">
          <p>
            Discard the unsynced changes on this Mac? Export them first if you want to keep a copy.
          </p>
          <Button variant="destructive" onClick={() => void discard()}>
            Discard changes
          </Button>
          <Button variant="ghost" onClick={() => setConfirm(false)}>
            Keep changes
          </Button>
        </div>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
