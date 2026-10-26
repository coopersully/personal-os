import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ResponsiveDialog as Dialog,
  ResponsiveDialogContent as DialogContent,
  ResponsiveDialogDescription as DialogDescription,
  ResponsiveDialogFooter as DialogFooter,
  ResponsiveDialogHeader as DialogHeader,
  ResponsiveDialogTitle as DialogTitle,
  ResponsiveDialogBody,
} from "@/components/responsive-dialog";
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
  const previousFocus = useRef<HTMLElement | null>(null);
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
    toast.loading("Reconnecting to your account…", { id: toastId });
    try {
      const result = await query.refetch();
      if (result.isError) throw new Error("Account recovery failed");
      toast.dismiss(toastId);
    } catch {
      toast.error("Couldn’t reconnect to your account.", {
        id: toastId,
        duration: Number.POSITIVE_INFINITY,
      });
    } finally {
      busy.current = false;
      setRetrying(false);
    }
  }
  return (
    <Dialog dismissible={false} open={open}>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        onOpenAutoFocus={() => {
          previousFocus.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }}
        onCloseAutoFocus={(event) => {
          if (previousFocus.current?.isConnected) {
            event.preventDefault();
            previousFocus.current.focus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Reconnect to your account</DialogTitle>
          <DialogDescription>
            nohmi can’t verify your account right now. Reconnect before continuing; your saved work
            stays in place.
          </DialogDescription>
        </DialogHeader>
        <ResponsiveDialogBody>{children}</ResponsiveDialogBody>
        <DialogFooter>
          <Button
            disabled={query.isFetching || retrying}
            onClick={() => {
              void retry();
            }}
          >
            {query.isFetching || retrying ? "Reconnecting…" : "Try again"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
