import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { RecoverySurface } from "./recovery-surface";
import { Button } from "./ui/button";

/** Account verification gates every workspace; recovery must not reshape its shell. */
export function AccountRecoveryDialog({
  query,
  enabled = true,
  children,
}: {
  query: {
    isError: boolean;
    isSuccess: boolean;
    isFetching: boolean;
    refetch: () => Promise<{ isError: boolean }>;
  };
  enabled?: boolean;
  children?: ReactNode;
}) {
  const [blocked, setBlocked] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const busy = useRef(false);
  const toastId = useId();
  useEffect(
    () => () => {
      toast.dismiss(toastId);
    },
    [toastId],
  );
  useEffect(() => {
    if (!enabled || (query.isSuccess && !query.isFetching)) {
      setBlocked(false);
      toast.dismiss(toastId);
    } else if (query.isError) setBlocked(true);
  }, [enabled, query.isError, query.isSuccess, query.isFetching, toastId]);
  const open = enabled && (blocked || query.isError);
  async function retry() {
    if (busy.current || query.isFetching) return;
    busy.current = true;
    setRetrying(true);
    toast.loading("Reconnecting to your account…", { id: toastId, position: "top-center" });
    try {
      const result = await query.refetch();
      if (result.isError) throw new Error("Account recovery failed");
      toast.dismiss(toastId);
    } catch {
      toast.error("Couldn’t reconnect to your account.", {
        id: toastId,
        position: "top-center",
        duration: Number.POSITIVE_INFINITY,
      });
    } finally {
      busy.current = false;
      setRetrying(false);
    }
  }
  return (
    <RecoverySurface
      open={open}
      title="Reconnect to your account"
      description="nohmi can’t verify your account right now. Reconnect before continuing; your saved work stays in place."
      actions={
        <Button
          aria-disabled={query.isFetching || retrying}
          aria-busy={query.isFetching || retrying}
          className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
          onClick={() => {
            void retry();
          }}
        >
          {query.isFetching || retrying ? "Reconnecting…" : "Try again"}
        </Button>
      }
    >
      {children}
    </RecoverySurface>
  );
}
