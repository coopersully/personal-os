import type { FinanceConversationReadiness } from "@personal-os/domain";
import { Link } from "react-router-dom";

export function FinanceConversationHostSummary({
  host,
}: {
  host: FinanceConversationReadiness["host"];
}) {
  if (!host) return null;
  const trigger = host.trigger;
  const timeZone =
    trigger.type === "scheduled"
      ? trigger.timeZone
      : trigger.type === "recurring"
        ? trigger.recurrence.timeZone
        : undefined;
  return (
    <div className="grid min-w-0 gap-1 text-sm text-muted-foreground">
      <p className="break-words">Chat host: {host.label}</p>
      <p className="break-words">
        {trigger.type === "scheduled"
          ? `Daily at ${trigger.localTimes.join(" and ")} · ${trigger.timeZone}`
          : trigger.type === "recurring"
            ? `Every ${trigger.recurrence.everyMinutes} minutes · ${trigger.recurrence.timeZone}`
            : "Event-based · next run unknown"}
      </p>
      {host.nextExpectedAt ? (
        <p>
          Next expected start:{" "}
          {new Date(host.nextExpectedAt).toLocaleString(
            undefined,
            timeZone ? { timeZone, timeZoneName: "short" } : undefined,
          )}
          . Starts may be late.
        </p>
      ) : null}
      <FinanceHostRunSummary run={host.latestRun} />
    </div>
  );
}

const runLabels = {
  queued: "waiting for host",
  running: "in progress",
  completed: "completed",
  completed_with_questions: "waiting for your answers",
  awaiting_agent_challenge: "waiting for host verification",
  awaiting_approval: "waiting for approval",
  blocked: "blocked",
  failed_recoverable: "needs retry",
  failed_terminal: "failed",
} as const;
export function FinanceHostRunSummary({
  run,
}: {
  run: NonNullable<FinanceConversationReadiness["host"]>["latestRun"];
}) {
  return (
    <div className="grid min-w-0 gap-1 text-sm text-muted-foreground">
      <p>
        {run
          ? `Latest run: ${runLabels[run.status]} · ${new Date(run.updatedAt).toLocaleString()}.`
          : "No run recorded for this host."}{" "}
        <Link className="underline underline-offset-4" to="/finances/activity">
          View Activity
        </Link>
      </p>
      {run?.failureMessage ? <p className="break-words">{run.failureMessage}</p> : null}
      {run && ["blocked", "failed_recoverable", "failed_terminal"].includes(run.status) ? (
        <p>Review host setup before relying on another run.</p>
      ) : null}
    </div>
  );
}
