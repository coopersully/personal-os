import type { TextingAgentRun, TextingAgentStatus } from "@personal-os/domain";
import { useId, useState } from "react";
import { api } from "../../api.js";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "../../components/responsive-dialog.js";
import { Button } from "../../components/ui/button.js";
import { Checkbox } from "../../components/ui/checkbox.js";
import { useFeedbackMutation } from "../../lib/use-feedback-mutation.js";

export function TextingRunRecovery({
  run,
  onRecovered,
}: {
  run: TextingAgentRun;
  onRecovered: (status: TextingAgentStatus) => void;
}) {
  const confirmationId = useId();
  const [open, setOpen] = useState(false);
  const [stopped, setStopped] = useState(false);
  const recover = useFeedbackMutation({
    feedback: { action: "recover this conversation", safeToRetry: true },
    mutationFn: (retry: boolean) =>
      api.recoverTextingAgentRun(
        run.id,
        retry ? { action: "retry" } : { action: "close", hostStopped: true },
      ),
    onSuccess: (status) => {
      onRecovered(status);
      setOpen(false);
      setStopped(false);
    },
  });
  if (
    run.state === "completed" ||
    run.reason === "retry_requested" ||
    run.reason === "human_closed" ||
    run.reason === "rate_limited" ||
    run.reason === "shutdown_deferred"
  )
    return null;
  return (
    <>
      <Button variant="ghost" className="self-start" onClick={() => setOpen(true)}>
        Review this run
      </Button>
      <ResponsiveDialog open={open} onOpenChange={setOpen}>
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Recover your conversation</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              A new session must not repeat work an earlier session may still be doing.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <a
            className="text-sm underline"
            href={
              run.hostSessionId
                ? `https://claude.ai/code/${encodeURIComponent(run.hostSessionId)}`
                : "https://claude.ai/code/routines"
            }
            target="_blank"
            rel="noreferrer"
          >
            Inspect the session in Claude (opens in a new tab)
          </a>
          {run.reason === "host_rejected" ? (
            <>
              <p className="text-sm text-muted-foreground">
                Claude rejected this start. Repair the routine’s API trigger or account access, then
                retry the saved request.
              </p>
              <p className="text-sm text-muted-foreground">
                You can also close this rejected request. Its messages remain in your history, and
                nohmi will not retry it.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button disabled={recover.isPending} onClick={() => recover.mutate(true)}>
                  Retry saved request
                </Button>
                <Button
                  variant="outline"
                  disabled={recover.isPending}
                  onClick={() => recover.mutate(false)}
                >
                  Close saved request
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Stop the old session in Claude first. Closing here releases this conversation for
                new messages; it does not stop Claude or resend the old request. Unfinished work
                remains saved for inspection.
              </p>
              <label htmlFor={confirmationId} className="flex items-start gap-3 text-sm">
                <Checkbox
                  id={confirmationId}
                  checked={stopped}
                  onCheckedChange={(value) => setStopped(value === true)}
                />
                I checked Claude and confirmed this session is stopped.
              </label>
              <Button
                disabled={!stopped || recover.isPending}
                onClick={() => recover.mutate(false)}
              >
                Close interrupted run
              </Button>
            </>
          )}
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  );
}
