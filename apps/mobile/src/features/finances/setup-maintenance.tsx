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

const time = (value: string | undefined) => (value ? Date.parse(value) || 0 : 0);
/**
 * Whether an action's response describes the run at least as recently as the run read. The
 * server's own times decide it; a read that lists no run predates a response that has one.
 */
function responseIsNewest(
  response: { payload: FinanceMaintenancePayload; at: number },
  read: { payload: FinanceMaintenancePayload; at: number } | null,
) {
  if (!read) return true;
  const answered = response.payload.run;
  const listed = read.payload.run;
  if (answered && listed)
    return answered.id === listed.id
      ? time(answered.updatedAt) >= time(listed.updatedAt)
      : time(answered.createdAt) >= time(listed.createdAt);
  return answered ? true : response.at >= read.at;
}

/**
 * Starts a maintenance run, or resumes the latest unfinished one. Everything shown about a run
 * is what the server returned for it: the newer of the latest run it lists and the last response
 * to a request.
 */
export function SetupMaintenance() {
  const { api, owner } = useFinance();
  const client = useQueryClient();
  const current = useCurrentSession();
  const latest = useFinanceRead(["maintenance-latest"], (api) =>
    api.getFinanceMaintenanceHistory({ limit: 1 }),
  );
  const [response, setResponse] = useState<{
    result: FinanceToolResult<FinanceMaintenancePayload>;
    at: number;
  } | null>(null);
  const [pending, setPending] = useState(false);
  // After an unconfirmed request a run may exist that this screen has not read yet.
  const [unchecked, setUnchecked] = useState(false);
  const busy = useRef(false);
  const listed = latest.data?.items[0];
  const answered =
    response &&
    responseIsNewest(
      { payload: response.result.data, at: response.at },
      listed ? { payload: listed, at: latest.dataUpdatedAt } : null,
    )
      ? response.result
      : null;
  const payload = answered?.data ?? listed ?? null;
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
        setResponse({ result, at: Date.now() });
        toast.success("Maintenance status updated", { id });
      }
    } catch (error) {
      if (!current()) return void toast.dismiss(id);
      const rejected = confirmedRejection(error);
      toast.error(
        rejected
          ? `Maintenance didn’t run.${rejectionReason(error)}`
          : "Couldn’t confirm maintenance ran. Check the latest run before starting again.",
        { id },
      );
      // An unconfirmed request is never sent again here. The run it may have started is read
      // before another request is allowed, so a start that landed is resumed, not repeated.
      if (!rejected) {
        setUnchecked(true);
        const read = await latest.refetch();
        if (current() && !read.isError) setUnchecked(false);
      }
    } finally {
      busy.current = false;
      if (current()) setPending(false);
      void client.invalidateQueries({ queryKey: ["finances", owner] });
    }
  }

  /** Reads the latest run again after a read that failed, under its own toast. */
  async function check() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    const id = toast.loading("Checking the latest run…");
    try {
      const read = await latest.refetch();
      if (!current()) return void toast.dismiss(id);
      if (read.isError)
        toast.error("Couldn’t read the latest run. Check again before starting.", { id });
      else {
        setUnchecked(false);
        toast.success("Latest run checked", { id });
      }
    } finally {
      busy.current = false;
      if (current()) setPending(false);
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
            {answered?.communication.headline ??
              "Check categorization, reconciliation, and transaction evidence independently of your profile."}
          </Copy>
          {payload?.recovery && <Copy>{payload.recovery.reason}</Copy>}
          {payload?.nextAction && <Copy>{payload.nextAction.reason}</Copy>}
          {answered?.communication.requiredDisclosures.map((disclosure) => (
            <Copy key={disclosure.message}>{disclosure.message}</Copy>
          ))}
          {(run?.status === "awaiting_approval" || run?.status === "completed_with_questions") && (
            <FinanceRow
              title="Answer in Review"
              icon="check"
              onPress={() => router.navigate("/finances/assistant")}
            />
          )}
          {unchecked && !pending && (
            <FinanceRow
              title="Check the latest run"
              subtitle="Read the latest run before starting maintenance again."
              icon="refresh"
              onPress={() => void check()}
            />
          )}
          <Actions inset={false}>
            <Action
              label={
                input.operation === "resume"
                  ? "Check maintenance progress"
                  : "Start initial maintenance"
              }
              disabled={pending || unchecked}
              onPress={() => void maintain()}
            />
          </Actions>
        </Card>
      </ReadState>
    </Section>
  );
}
