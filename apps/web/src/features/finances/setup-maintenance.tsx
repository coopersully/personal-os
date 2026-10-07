import type {
  FinanceMaintenancePayload,
  FinanceSetupPayload,
  FinanceToolResult,
} from "@personal-os/domain";
import { financeMaintenanceInputSchema } from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { api } from "../../api.js";
import { MutationFeedback } from "../../components/mutation-feedback.js";
import { useFeedbackMutation } from "../../lib/use-feedback-mutation.js";
import { requireFinanceResult } from "./position-material.js";

const maintenanceStages: Record<NonNullable<FinanceMaintenancePayload["run"]>["status"], string> = {
  queued: "Maintenance queued",
  running: "Processing transaction evidence",
  completed: "Maintenance complete",
  completed_with_questions: "Maintenance complete with questions",
  awaiting_agent_challenge: "Ledger challenge required",
  awaiting_approval: "Action approval required",
  blocked: "Maintenance blocked",
  failed_recoverable: "Maintenance needs recovery",
  failed_terminal: "Maintenance failed",
};

export function SetupMaintenance({
  nextAction,
}: {
  nextAction: FinanceToolResult<FinanceSetupPayload>["nextAction"];
}) {
  const queryClient = useQueryClient();
  const [run, setRun] = useState<FinanceMaintenancePayload | null>(null);
  const [communication, setCommunication] = useState<
    FinanceToolResult<FinanceMaintenancePayload>["communication"] | null
  >(null);
  const instructedInput =
    nextAction?.tool === "maintain_finances"
      ? financeMaintenanceInputSchema.safeParse(nextAction.arguments)
      : null;
  const input = run?.run
    ? { operation: "resume" as const, runId: run.run.id }
    : instructedInput?.success
      ? instructedInput.data
      : null;
  const maintenance = useFeedbackMutation({
    feedback: { action: "run financial maintenance", safeToRetry: false, form: false },
    mutationFn: async () => {
      if (!input) throw new Error("Refresh setup progress to load the next maintenance action.");
      return requireFinanceResult(await api.maintainFinances(input));
    },
    onSuccess: (response) => {
      setRun(response.data);
      setCommunication(response.communication);
      void queryClient.invalidateQueries({
        predicate: (query) =>
          typeof query.queryKey[0] === "string" && query.queryKey[0].startsWith("finance-"),
      });
    },
  });
  return (
    <section className="grid gap-3" aria-label="Initial maintenance">
      <h3 className="font-medium">
        {run?.run
          ? maintenanceStages[run.run.status]
          : run?.recovery
            ? "Maintenance recovery"
            : "Maintain transaction evidence"}
      </h3>
      <p className="text-sm text-muted-foreground">
        {communication?.headline ??
          "Check categorization, reconciliation, and transaction evidence independently of your profile."}
      </p>
      {run?.recovery ? <p className="text-sm">{run.recovery.reason}</p> : null}
      {run?.nextAction ? <p className="text-sm">{run.nextAction.reason}</p> : null}
      {run?.run?.status === "awaiting_approval" ||
      run?.run?.status === "completed_with_questions" ? (
        <Button asChild variant="outline">
          <Link to="/finances?review=open">Answer in Review</Link>
        </Button>
      ) : null}
      {communication?.requiredDisclosures.map((disclosure) => (
        <Alert key={disclosure.message}>
          <AlertDescription>{disclosure.message}</AlertDescription>
        </Alert>
      ))}
      {maintenance.error ? <MutationFeedback feedback={maintenance.feedback} /> : null}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={maintenance.isPending || !input}
          onClick={() => maintenance.mutate()}
          variant="outline"
        >
          {maintenance.isPending
            ? "Checking maintenance…"
            : input?.operation === "resume"
              ? "Check maintenance progress"
              : "Start initial maintenance"}
        </Button>
        {run?.nextAction?.tool === "get_finance_ledger_challenge" ? (
          <Button asChild variant="ghost">
            <Link to="/settings?section=agent-connections">Connected agents</Link>
          </Button>
        ) : null}
      </div>
    </section>
  );
}
