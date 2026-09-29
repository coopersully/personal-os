import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { useState } from "react";
import { errorMessage } from "../../api.js";
import { Alert, AlertDescription, AlertTitle } from "../../components/ui/alert.js";
import { Button } from "../../components/ui/button.js";
export function RitualLocal({ recoveryOnly = false }: { recoveryOnly?: boolean } = {}) {
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");
  const local = useQuery({
    queryKey: ["ritual-local"],
    queryFn: () =>
      invoke<{
        queue: unknown[];
        enabled: boolean;
        localHistory: unknown[];
        deliveryHealth?: { stage: string; failedAt: string; nextRetryAt: string } | null;
      }>("ritual_local", {
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
  const health = local.isError ? null : local.data?.deliveryHealth;
  const stageMessages: Record<string, string> = {
    identity: "Unable to confirm the account for this Mac",
    store_read: "Unable to read saved ritual changes on this Mac",
    sync: "Unable to sync rituals with your account",
    store_write: "Unable to save ritual changes on this Mac",
    presentation: "Unable to show the ritual on this Mac",
  };
  const retryAt = health ? new Date(health.nextRetryAt) : null;
  const hasPending = Boolean(local.data?.queue?.length || local.data?.localHistory?.length);
  if (recoveryOnly && !hasPending) return null;
  return (
    <div className="flex flex-col gap-2">
      {recoveryOnly ? (
        <p>
          Unsynced ritual changes remain on this Mac from your previous session. Sign back into the
          same account to sync them, or export and discard them before switching accounts.
        </p>
      ) : (
        <p className="text-muted-foreground">
          Automatic rituals on this Mac:{" "}
          {local.isError
            ? "unavailable"
            : local.isPending
              ? "loading"
              : local.data?.enabled
                ? "on"
                : "off"}
        </p>
      )}
      {!recoveryOnly && local.isError ? (
        <Alert variant="warning">
          <AlertTitle>Ritual status unavailable</AlertTitle>
          <AlertDescription>Unable to read this Mac’s ritual status</AlertDescription>
          <Button
            size="sm"
            variant="ghost"
            disabled={local.isFetching}
            onClick={() => void local.refetch()}
          >
            Retry
          </Button>
        </Alert>
      ) : !recoveryOnly && health ? (
        <Alert variant="warning">
          <AlertTitle>
            {stageMessages[health.stage] ?? "Ritual delivery needs attention"}
          </AlertTitle>
          <AlertDescription>
            Retrying automatically
            {retryAt && Number.isFinite(retryAt.getTime())
              ? ` at ${retryAt.toLocaleTimeString()}`
              : " shortly"}
          </AlertDescription>
        </Alert>
      ) : null}
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
          {!recoveryOnly ? (
            <details>
              <summary>Inspect pending changes</summary>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs">
                {JSON.stringify(local.data, null, 2)}
              </pre>
            </details>
          ) : null}
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
