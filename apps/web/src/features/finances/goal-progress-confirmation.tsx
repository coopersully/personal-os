import {
  type FinanceGoal,
  financeConfirmGoalPlanningEvidenceInputSchema,
  financePlanningEvidenceApplicability,
  financePlanningEvidenceCurrencySchema,
} from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";
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
import { api } from "../../api.js";
import { FeedbackForm } from "../../components/feedback-form.js";
import { useFeedbackMutation } from "../../lib/use-feedback-mutation.js";
import {
  isConfirmedFinanceMutationFailure,
  requireFinanceMutationResult,
} from "./mutation-retry.js";
import { refreshFinancePosition } from "./position-material.js";

function exactCents(value: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

/** The authenticated goal read owns identity; a default amount or matching content alone is insufficient. */
export function goalProgressApplicability(goal: FinanceGoal, ownerUserId: string, today: string) {
  const progressAmountCents = exactCents(String(goal.currentAmount));
  if (progressAmountCents === null) return { state: "unknown", reason: "source_changed" } as const;
  try {
    return financePlanningEvidenceApplicability({
      ownerUserId,
      today,
      source: {
        kind: "goal",
        id: goal.id,
        ownerUserId,
        version: goal.version,
        progressAmountCents,
        currencyCode: null,
        status: goal.status,
      },
      evidence: goal.planningEvidence,
    });
  } catch {
    return { state: "unknown", reason: "invalid_evidence" } as const;
  }
}

export function GoalProgressConfirmation({
  goal,
  todayLocalDate,
  onClose,
}: {
  goal: FinanceGoal;
  todayLocalDate: string;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const id = useId();
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("");
  const [asOf, setAsOf] = useState("");
  const lastAttempt = useRef<{ payload: string; key: string } | null>(null);
  const save = useFeedbackMutation({
    feedback: {
      action: "confirm this goal progress",
      safeToRetry: false,
      form: true,
      pending: "Recording your goal progress…",
      success: "Goal progress confirmed.",
    },
    mutationFn: async () => {
      const statement = financeConfirmGoalPlanningEvidenceInputSchema.parse({
        goalId: goal.id,
        expectedVersion: goal.version,
        progressAmountCents: exactCents(amount),
        currencyCode: currency.trim(),
        asOf,
      });
      const payload = JSON.stringify(statement);
      if (lastAttempt.current?.payload !== payload)
        lastAttempt.current = { payload, key: crypto.randomUUID() };
      return requireFinanceMutationResult(
        await api.manageFinanceGoal({
          operation: "confirm_progress",
          ...statement,
          idempotencyKey: lastAttempt.current.key,
        }),
      );
    },
    onSuccess: async () => {
      await refreshFinancePosition(client);
      onClose();
    },
    onError: (error) => {
      if (isConfirmedFinanceMutationFailure(error)) lastAttempt.current = null;
      void refreshFinancePosition(client);
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirm progress for {goal.name}</DialogTitle>
          <DialogDescription>
            Your statement applies to the target and current progress of this goal at version{" "}
            {goal.version}. It records what you confirm, without moving money or changing budget
            allocations.
          </DialogDescription>
        </DialogHeader>
        <FeedbackForm
          feedback={save.feedback}
          fieldNames={{ progressAmountCents: "amount", currencyCode: "currency", asOf: "asOf" }}
          className="flex flex-col gap-4"
          validate={() => {
            const errors: Record<string, string> = {};
            const cents = exactCents(amount);
            if (cents === null || cents > 2_147_483_647)
              errors.amount =
                "Enter a non-negative amount with at most two decimal places, no greater than 21,474,836.47.";
            if (!financePlanningEvidenceCurrencySchema.safeParse(currency.trim()).success)
              errors.currency = "Choose a recognized currency with two minor-unit digits.";
            const parsed = financeConfirmGoalPlanningEvidenceInputSchema.shape.asOf.safeParse(asOf);
            if (!parsed.success) errors.asOf = "Choose the date this progress statement is true.";
            else if (asOf > todayLocalDate)
              errors.asOf = "The progress date cannot be in the future.";
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
                <FieldLabel htmlFor={`${id}-amount`}>Current goal amount you confirm</FieldLabel>
                <Input
                  id={`${id}-amount`}
                  name="amount"
                  inputMode="decimal"
                  required
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-currency`}>Currency for the whole goal</FieldLabel>
                <Input
                  id={`${id}-currency`}
                  name="currency"
                  required
                  value={currency}
                  onChange={(event) => setCurrency(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-as-of`}>Progress statement as-of date</FieldLabel>
                <Input
                  id={`${id}-as-of`}
                  name="asOf"
                  type="date"
                  max={todayLocalDate}
                  required
                  value={asOf}
                  onChange={(event) => setAsOf(event.target.value)}
                />
              </Field>
            </FieldGroup>
          </FieldSet>
          <p className="text-sm text-muted-foreground">
            By confirming, you state that this amount and currency describe your goal progress on
            the selected date. An explicitly entered zero is valid.
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Confirming…" : "Confirm my progress statement"}
            </Button>
          </DialogFooter>
        </FeedbackForm>
      </DialogContent>
    </Dialog>
  );
}
