import type {
  FinanceMaintenanceInput,
  FinanceMaintenancePayload,
  FinanceToolResult,
} from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useRef, useState } from "react";
import { toast } from "sonner-native";
import { Action, Actions } from "../../components/forms/form-rows";
import { useCurrentSession } from "./budget-write";
import { useFinance, useFinanceRead } from "./data";
import { confirmedRejection, rejectionReason } from "./mutations";
import { Card, Copy, FinanceRow, ReadState, Section } from "./ui";

type Run = NonNullable<FinanceMaintenancePayload["run"]>;
const stages: Record<Run["status"], string> = {
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
/** A run in one of these states is over; the next request starts a new run. */
const finished: readonly Run["status"][] = [
  "completed",
  "completed_with_questions",
  "failed_terminal",
];

/**
 * Starts a maintenance run, or resumes the latest unfinished one. Everything shown about a run
 * is what the server returned for it: the latest run it lists, then each response to a request.
 */
export function SetupMaintenance() {
  const { api, owner } = useFinance();
  const client = useQueryClient();
  const current = useCurrentSession();
  const latest = useFinanceRead(["maintenance-latest"], (api) =>
    api.getFinanceMaintenanceHistory({ limit: 1 }),
  );
  const [response, setResponse] = useState<FinanceToolResult<FinanceMaintenancePayload> | null>(
    null,
  );
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const payload = response?.data ?? latest.data?.items[0] ?? null;
  const run = payload?.run ?? null;
  const input: FinanceMaintenanceInput =
    run && !finished.includes(run.status)
      ? { operation: "resume", runId: run.id }
      : { operation: "start", scope: { type: "all_outstanding" } };

  async function maintain() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    const id = toast.loading("Checking maintenance…");
    try {
      const result = await api.maintainFinances(input);
      if (!current()) return void toast.dismiss(id);
      if (result.outcome === "failed") toast.error(result.communication.headline, { id });
      else {
        setResponse(result);
        toast.success("Maintenance status updated", { id });
      }
    } catch (error) {
      if (!current()) return void toast.dismiss(id);
      // An unconfirmed request is never sent again here; the latest run is read again instead.
      toast.error(
        confirmedRejection(error)
          ? `Maintenance didn’t run.${rejectionReason(error)}`
          : "Couldn’t confirm maintenance ran. Check the latest run before starting again.",
        { id },
      );
    } finally {
      busy.current = false;
      if (current()) setPending(false);
      void client.invalidateQueries({ queryKey: ["finances", owner] });
    }
  }

  return (
    <Section title="Check records">
      <ReadState query={latest}>
        <Card>
          <Copy>
            {run
              ? stages[run.status]
              : payload?.recovery
                ? "Maintenance recovery"
                : "Maintain transaction evidence"}
          </Copy>
          <Copy secondary>
            {response?.communication.headline ??
              "Check categorization, reconciliation, and transaction evidence independently of your profile."}
          </Copy>
          {payload?.recovery && <Copy>{payload.recovery.reason}</Copy>}
          {payload?.nextAction && <Copy>{payload.nextAction.reason}</Copy>}
          {response?.communication.requiredDisclosures.map((disclosure) => (
            <Copy key={disclosure.message}>{disclosure.message}</Copy>
          ))}
          {(run?.status === "awaiting_approval" || run?.status === "completed_with_questions") && (
            <FinanceRow
              title="Answer in Review"
              icon="check"
              onPress={() => router.navigate("/finances/assistant")}
            />
          )}
          <Actions inset={false}>
            <Action
              label={
                input.operation === "resume"
                  ? "Check maintenance progress"
                  : "Start initial maintenance"
              }
              disabled={pending}
              onPress={() => void maintain()}
            />
          </Actions>
        </Card>
      </ReadState>
    </Section>
  );
}
