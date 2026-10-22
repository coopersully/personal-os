import {
  type FinanceAccount,
  type FinanceRecurringObligation,
  type ManageFinanceRecurringItemInput,
  manageFinanceRecurringItemInputSchema,
} from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { api } from "../../api.js";
import { useFeedbackMutation } from "../../lib/use-feedback-mutation.js";
import {
  isConfirmedFinanceMutationFailure,
  requireFinanceMutationResult,
} from "./mutation-retry.js";

type CostInput = Extract<ManageFinanceRecurringItemInput, { operation: "confirm_cost" }>;
export function RecurringCostConfirmation({
  item,
  account,
  today,
  open,
  onClose,
}: {
  item: FinanceRecurringObligation;
  account?: Pick<FinanceAccount, "id" | "name" | "currencyCode">;
  today: string;
  open: boolean;
  onClose: () => void;
}) {
  const id = useId();
  const client = useQueryClient();
  const [fixedness, setFixedness] = useState<"" | "fixed" | "variable">("");
  const [currency, setCurrency] = useState(account?.currencyCode ?? "");
  const [asOf, setAsOf] = useState(today);
  const [statement, setStatement] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const attempt = useRef<CostInput | null>(null);
  const amountCents =
    Number.isFinite(item.expectedAmount) &&
    Number(item.expectedAmount.toFixed(2)) === item.expectedAmount
      ? Math.round(item.expectedAmount * 100)
      : Number.NaN;
  const candidate = {
    operation: "confirm_cost",
    itemType: "obligation",
    itemId: item.id,
    expectedRevision: item.revision,
    expectedAmountCents: amountCents,
    cadence: item.cadence,
    accountId: item.accountId,
    currencyCode: currency,
    fixedness,
    asOf,
    idempotencyKey: "validation",
  };
  const parsed = manageFinanceRecurringItemInputSchema.safeParse(candidate);
  const valid =
    statement &&
    parsed.success &&
    asOf <= today &&
    (!account?.currencyCode || account.currencyCode === currency) &&
    (item.status === "active" || item.status === "needs_review");
  const mutation = useFeedbackMutation({
    feedback: {
      action: "save this recurring cost statement",
      safeToRetry: false,
      form: true,
      pending: "Saving cost statement…",
      success: "Cost statement saved.",
    },
    mutationFn: async () => {
      if (!attempt.current) {
        if (!valid || !parsed.success || parsed.data.operation !== "confirm_cost")
          throw new Error("Review the statement, currency, date, and source revision.");
        attempt.current = { ...parsed.data, idempotencyKey: crypto.randomUUID() };
      }
      const result = requireFinanceMutationResult(
        await api.manageFinanceRecurringItem(attempt.current),
      );
      if (result.outcome !== "completed") throw new Error(result.communication.headline);
      return result;
    },
    onError: (error) => {
      const rejected = isConfirmedFinanceMutationFailure(error);
      setUncertain(!rejected);
      if (rejected) attempt.current = null;
    },
    onSuccess: async () => {
      attempt.current = null;
      setUncertain(false);
      // A committed response remains committed even if refreshing the read fails.
      onClose();
      await client.invalidateQueries({ queryKey: ["finance-recurring-items"] });
    },
  });
  const locked = uncertain || mutation.isPending;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !locked) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Confirm cost for {item.displayName}</DialogTitle>
          <DialogDescription>
            State whether this expected payment is fixed or variable. This saves your statement and
            does not change the payment with its provider.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
          className="flex flex-col gap-4"
        >
          <dl className="grid gap-2 text-sm">
            <div>
              <dt>Expected amount</dt>
              <dd>{item.expectedAmount}</dd>
            </div>
            <div>
              <dt>Schedule</dt>
              <dd>{item.cadence}</dd>
            </div>
            <div>
              <dt>Account</dt>
              <dd>{account?.name ?? "No available account"}</dd>
            </div>
            <div>
              <dt>Source revision</dt>
              <dd>{item.revision ?? "Unavailable — refresh recurring activity"}</dd>
            </div>
          </dl>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={`${id}-fixedness`}>Amount behavior</FieldLabel>
              <NativeSelect
                id={`${id}-fixedness`}
                value={fixedness}
                disabled={locked}
                onChange={(event) => setFixedness(event.target.value as "" | "fixed" | "variable")}
              >
                <NativeSelectOption value="">Choose fixed or variable</NativeSelectOption>
                <NativeSelectOption value="fixed">Fixed</NativeSelectOption>
                <NativeSelectOption value="variable">Variable</NativeSelectOption>
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-currency`}>Currency code</FieldLabel>
              <Input
                id={`${id}-currency`}
                value={currency}
                disabled={locked}
                readOnly={Boolean(account?.currencyCode)}
                onChange={(event) => setCurrency(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-asof`}>Statement as of</FieldLabel>
              <Input
                id={`${id}-asof`}
                type="date"
                max={today}
                value={asOf}
                disabled={locked}
                onChange={(event) => setAsOf(event.target.value)}
              />
            </Field>
            <Field orientation="horizontal">
              <Checkbox
                id={`${id}-statement`}
                checked={statement}
                disabled={locked}
                onCheckedChange={(checked) => setStatement(checked === true)}
              />
              <FieldLabel htmlFor={`${id}-statement`}>
                I confirm this amount, schedule, currency, and amount behavior as of this date.
              </FieldLabel>
            </Field>
          </FieldGroup>
          {fixedness === "variable" ? (
            <p className="text-sm text-muted-foreground">
              Variable payments remain outside precise annual and monthly totals.
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={locked} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending || (!uncertain && !valid)}>
              {uncertain ? "Retry same statement" : "Save cost statement"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
