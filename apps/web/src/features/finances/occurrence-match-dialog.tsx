import {
  type FinanceCashflowSourceSnapshots,
  type FinanceOccurrenceMatchEvent,
  type FinanceRecurringOccurrence,
  manageFinanceOccurrenceMatchInputSchema,
} from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import { useId, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "../../api.js";
import { FeedbackForm } from "../../components/feedback-form.js";
import { useFeedbackMutation } from "../../lib/use-feedback-mutation.js";
import {
  isConfirmedFinanceMutationFailure,
  requireFinanceMutationResult,
} from "./mutation-retry.js";
import { refreshFinancePosition } from "./position-material.js";

export interface OccurrenceMatchDialogProps {
  occurrence: FinanceRecurringOccurrence;
  candidates: FinanceCashflowSourceSnapshots["transactions"];
  matchEvents: FinanceOccurrenceMatchEvent[];
  onClose: () => void;
  onSaved?: () => void | Promise<void>;
}
function cents(value: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  return match ? Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0")) : null;
}
export function OccurrenceMatchDialog(props: OccurrenceMatchDialogProps) {
  const [{ occurrence, candidates, matchEvents }] = useState(() => props);
  const { onClose, onSaved } = props;
  const client = useQueryClient();
  const id = useId();
  const [mode, setMode] = useState(occurrence.inCurrentSchedule ? "match" : "reverse");
  const [transactionId, setTransactionId] = useState("");
  const [allocationId, setAllocationId] = useState("");
  const [amount, setAmount] = useState("");
  const [rationale, setRationale] = useState("");
  const [matchId, setMatchId] = useState("");
  const attempt = useRef<{ payload: string; key: string } | null>(null);
  const eligible = candidates.filter(
    (transaction) =>
      transaction.pending === false &&
      transaction.accountId === occurrence.accountId &&
      transaction.currencyCode === occurrence.currencyCode &&
      transaction.direction === (occurrence.source.kind === "income" ? "income" : "expense") &&
      (occurrence.source.kind === "income"
        ? transaction.incomeEligibility.eligible
        : transaction.allocations.some((allocation) => allocation.expenseEligibility.eligible)),
  );
  const selected = eligible.find((candidate) => candidate.id === transactionId);
  const allocations =
    selected?.allocations.filter((allocation) => allocation.expenseEligibility.eligible) ?? [];
  const allocation = allocations.find((row) => row.id === allocationId);
  const reversed = new Set(
    matchEvents.filter((event) => event.kind === "reverse").map((event) => event.reversesMatchId),
  );
  const activeMatches = matchEvents.filter(
    (event) =>
      event.kind === "match" &&
      event.occurrenceId === occurrence.occurrenceId &&
      occurrence.matchIds.includes(event.id) &&
      !reversed.has(event.id),
  );
  const statement = () =>
    manageFinanceOccurrenceMatchInputSchema.safeParse(
      mode === "reverse"
        ? {
            operation: "reverse",
            matchId,
            rationale: rationale.trim(),
            idempotencyKey: "validation",
          }
        : {
            operation: occurrence.source.kind === "income" ? "match_income" : "match_expense",
            occurrence: {
              scheduleVersionId: occurrence.scheduleVersionId,
              localDate: occurrence.localDate,
              slot: occurrence.slot,
            },
            transactionId,
            expectedTransactionRevision: selected?.transactionRevision ?? "",
            amountCents: cents(amount),
            currencyCode: occurrence.currencyCode,
            rationale: rationale.trim(),
            idempotencyKey: "validation",
            ...(occurrence.source.kind === "obligation"
              ? { allocationId, expectedAllocationRevision: allocation?.revision ?? 0 }
              : {}),
          },
    );
  const save = useFeedbackMutation({
    feedback: {
      action: "record this occurrence match",
      safeToRetry: false,
      form: true,
      pending: "Recording your match decision…",
      success: "Occurrence match updated.",
    },
    mutationFn: async () => {
      const parsed = statement();
      if (!parsed.success) throw parsed.error;
      const { idempotencyKey: _validation, ...changes } = parsed.data;
      const payload = JSON.stringify(changes);
      if (attempt.current?.payload !== payload)
        attempt.current = { payload, key: crypto.randomUUID() };
      return requireFinanceMutationResult(
        await api.manageFinanceOccurrenceMatch({ ...changes, idempotencyKey: attempt.current.key }),
      );
    },
    onSuccess: async () => {
      await refreshFinancePosition(client);
      await onSaved?.();
      onClose();
    },
    onError: (error) => {
      if (isConfirmedFinanceMutationFailure(error)) attempt.current = null;
      void refreshFinancePosition(client);
    },
  });
  const correctionFeedback = useMemo(
    () =>
      save.feedback
        ? {
            ...save.feedback,
            persistent: false,
            fields: Object.fromEntries(
              Object.entries(save.feedback.fields).filter(([field]) =>
                ["transactionId", "allocationId", "amountCents", "rationale", "matchId"].includes(
                  field,
                ),
              ),
            ),
          }
        : null,
    [save.feedback],
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) onClose();
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Match actual movement for {occurrence.displayName}</DialogTitle>
          <DialogDescription>
            {occurrence.localDate} · {occurrence.currencyCode} · Expected remaining{" "}
            {occurrence.remainingExpectedCents === null
              ? "unknown"
              : occurrence.remainingExpectedCents / 100}
            . Only explicitly posted canonical movements can replace expectations. Matching never
            creates a payment.
          </DialogDescription>
        </DialogHeader>
        {!occurrence.inCurrentSchedule ? (
          <p>
            This is retained history outside the current schedule. Only an existing match can be
            reversed; new matches require a current occurrence.
          </p>
        ) : null}
        {matchEvents.some((event) => event.occurrenceId === occurrence.occurrenceId) ? (
          <details>
            <summary>Immutable match history</summary>
            <ul className="max-h-48 overflow-auto">
              {matchEvents
                .filter((event) => event.occurrenceId === occurrence.occurrenceId)
                .map((event) => (
                  <li key={event.id}>
                    {event.kind === "reverse" ? "Full reversal" : "Original match"} ·{" "}
                    {event.amountCents / 100} {event.currencyCode} · {event.recordedAt} ·{" "}
                    {event.rationale}
                    <p className="break-all text-xs text-muted-foreground">
                      Event {event.id} · Actor {event.actorUserId} · Transaction revision{" "}
                      {event.transactionRevision}
                      {event.allocationId
                        ? ` · Allocation ${event.allocationId} revision ${event.allocationRevision}`
                        : ""}
                      {event.incomeTransactionId
                        ? ` · Income transaction ${event.incomeTransactionId}`
                        : ""}
                      {event.reversesMatchId ? ` · Reverses ${event.reversesMatchId}` : ""}
                    </p>
                  </li>
                ))}
            </ul>
          </details>
        ) : null}
        <FeedbackForm
          feedback={correctionFeedback}
          fieldNames={{ amountCents: "amount" }}
          className="flex flex-col gap-4"
          validate={() => {
            const parsed = statement();
            const errors: Record<string, string> = {};
            if (!parsed.success)
              for (const issue of parsed.error.issues)
                errors[String(issue.path[0]) === "amountCents" ? "amount" : String(issue.path[0])] =
                  issue.message;
            if (mode === "reverse" && !activeMatches.some((event) => event.id === matchId))
              errors.matchId = "Choose a current unreversed match for this occurrence.";
            if (mode === "match" && !selected)
              errors.transactionId = "Choose an eligible posted movement.";
            if (mode === "match" && occurrence.source.kind === "obligation" && !allocation)
              errors.allocationId = "Choose an active canonical expense allocation.";
            return errors;
          }}
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <FieldSet disabled={save.isPending}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor={`${id}-mode`}>Match operation</FieldLabel>
                <NativeSelect
                  id={`${id}-mode`}
                  value={mode}
                  onChange={(event) => setMode(event.target.value)}
                >
                  <NativeSelectOption value="match" disabled={!occurrence.inCurrentSchedule}>
                    Match a partial or full amount
                  </NativeSelectOption>
                  <NativeSelectOption value="reverse">
                    Reverse an entire existing match
                  </NativeSelectOption>
                </NativeSelect>
              </Field>
              {mode === "match" ? (
                <>
                  <Field>
                    <FieldLabel htmlFor={`${id}-transaction`}>Posted actual movement</FieldLabel>
                    <NativeSelect
                      id={`${id}-transaction`}
                      name="transactionId"
                      required
                      value={transactionId}
                      onChange={(event) => {
                        setTransactionId(event.target.value);
                        setAllocationId("");
                      }}
                    >
                      <NativeSelectOption value="">Choose a posted movement</NativeSelectOption>
                      {eligible.map((transaction) => (
                        <NativeSelectOption key={transaction.id} value={transaction.id}>
                          {transaction.merchant} · {transaction.date} ·{" "}
                          {transaction.amountCents / 100}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </Field>
                  {occurrence.source.kind === "obligation" ? (
                    <Field>
                      <FieldLabel htmlFor={`${id}-allocation`}>
                        Canonical expense allocation
                      </FieldLabel>
                      <NativeSelect
                        id={`${id}-allocation`}
                        name="allocationId"
                        required
                        value={allocationId}
                        onChange={(event) => setAllocationId(event.target.value)}
                      >
                        <NativeSelectOption value="">
                          Choose an active allocation
                        </NativeSelectOption>
                        {allocations.map((row) => (
                          <NativeSelectOption key={row.id} value={row.id}>
                            {row.amountCents / 100} · {row.treatment} · revision {row.revision}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </Field>
                  ) : null}
                  <Field>
                    <FieldLabel htmlFor={`${id}-amount`}>
                      Amount of this occurrence matched
                    </FieldLabel>
                    <Input
                      id={`${id}-amount`}
                      name="amount"
                      inputMode="decimal"
                      required
                      value={amount}
                      onChange={(event) => setAmount(event.target.value)}
                    />
                  </Field>
                </>
              ) : (
                <>
                  <Field>
                    <FieldLabel htmlFor={`${id}-match`}>
                      Existing match to reverse in full
                    </FieldLabel>
                    <NativeSelect
                      id={`${id}-match`}
                      name="matchId"
                      required
                      value={matchId}
                      onChange={(event) => setMatchId(event.target.value)}
                    >
                      <NativeSelectOption value="">Choose an unreversed match</NativeSelectOption>
                      {activeMatches.map((event) => (
                        <NativeSelectOption key={event.id} value={event.id}>
                          {event.amountCents / 100} {event.currencyCode} · {event.recordedAt}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </Field>
                  <p className="text-sm text-muted-foreground">
                    This reverses the whole selected match. Its original event and rationale remain
                    in immutable history.
                  </p>
                </>
              )}
              <Field>
                <FieldLabel htmlFor={`${id}-rationale`}>Reason for this match decision</FieldLabel>
                <Textarea
                  id={`${id}-rationale`}
                  name="rationale"
                  required
                  maxLength={2000}
                  value={rationale}
                  onChange={(event) => setRationale(event.target.value)}
                />
              </Field>
            </FieldGroup>
          </FieldSet>
          {mode === "match" && !eligible.length ? (
            <p>
              No eligible posted movement is available. Review or refresh the canonical transaction
              history first.
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {mode === "reverse" ? "Reverse the whole match" : "Confirm actual match"}
            </Button>
          </DialogFooter>
        </FeedbackForm>
      </DialogContent>
    </Dialog>
  );
}
