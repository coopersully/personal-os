import {
  type FinanceCashflowSourceSnapshots,
  type FinanceBalanceBasis,
  confirmFinanceBalanceBasisInputSchema,
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
import { api } from "../../api.js";
import { FeedbackForm } from "../../components/feedback-form.js";
import { useFeedbackMutation } from "../../lib/use-feedback-mutation.js";
import {
  isConfirmedFinanceMutationFailure,
  requireFinanceMutationResult,
} from "./mutation-retry.js";
import { refreshFinancePosition } from "./position-material.js";

export interface BalanceBasisFormProps {
  account: FinanceCashflowSourceSnapshots["accounts"][number];
  previousBasis: FinanceBalanceBasis | null;
  transactions: FinanceCashflowSourceSnapshots["transactions"];
  coverage: FinanceCashflowSourceSnapshots["coverage"];
  onClose: () => void;
  onSaved?: () => void | Promise<void>;
}
function cents(value: string): number | null {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  return match
    ? (Number(match[2]) * 100 + Number((match[3] ?? "").padEnd(2, "0"))) * (match[1] ? -1 : 1)
    : null;
}
export function BalanceBasisForm(props: BalanceBasisFormProps) {
  const [{ account, previousBasis, transactions, coverage }] = useState(() => props);
  const { onClose, onSaved } = props;
  const client = useQueryClient();
  const expectedAccountRevision = account.accountRevision;
  const id = useId();
  const [draft, setDraft] = useState({
    kind: "",
    amount: "",
    currencyCode: "",
    asOf: "",
    validUntil: "",
    floor: "",
  });
  const [reflections, setReflections] = useState<Record<string, string>>({});
  const attempt = useRef<{ payload: string; key: string } | null>(null);
  const statement = () =>
    confirmFinanceBalanceBasisInputSchema.safeParse({
      accountId: account.id,
      expectedAccountRevision,
      expectedBasisRevision: previousBasis?.basisRevision ?? 0,
      kind: draft.kind,
      amountCents: cents(draft.amount),
      currencyCode: draft.currencyCode.trim(),
      asOf: draft.asOf,
      validUntil: draft.validUntil,
      protectedFloorCents: draft.floor.trim() ? cents(draft.floor) : null,
      reflections: transactions.map((transaction) => ({
        transactionId: transaction.id,
        transactionRevision: transaction.transactionRevision,
        reflection: reflections[transaction.id] ?? "unknown",
      })),
      idempotencyKey: "validation",
    });
  const save = useFeedbackMutation({
    feedback: {
      action: "confirm this balance basis",
      safeToRetry: false,
      form: true,
      pending: "Recording your balance statement…",
      success: "Balance basis confirmed.",
    },
    mutationFn: async () => {
      const parsed = statement();
      if (!parsed.success) throw parsed.error;
      const { idempotencyKey: _validation, ...changes } = parsed.data;
      const payload = JSON.stringify(changes);
      if (attempt.current?.payload !== payload)
        attempt.current = { payload, key: crypto.randomUUID() };
      return requireFinanceMutationResult(
        await api.confirmFinanceBalanceBasis({ ...changes, idempotencyKey: attempt.current.key }),
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
                [
                  "kind",
                  "amountCents",
                  "currencyCode",
                  "asOf",
                  "validUntil",
                  "protectedFloorCents",
                ].includes(field),
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
          <DialogTitle>Confirm balance basis for {account.name}</DialogTitle>
          <DialogDescription>
            State a current or available balance and exactly which listed movements it includes.
            Your statement is not a bank freshness guarantee. No reflection is inferred from a
            movement's date or posting status.
          </DialogDescription>
        </DialogHeader>
        {coverage.truncated ? (
          <p>
            Source transaction coverage is incomplete. Narrow the account or date window and reload
            before confirming.
          </p>
        ) : null}
        <FeedbackForm
          feedback={correctionFeedback}
          fieldNames={{ amountCents: "amount", protectedFloorCents: "floor" }}
          className="flex flex-col gap-4"
          validate={() => {
            const parsed = statement();
            const errors: Record<string, string> = {};
            if (!parsed.success)
              for (const issue of parsed.error.issues) {
                const key = String(issue.path[0]);
                errors[
                  key === "amountCents" ? "amount" : key === "protectedFloorCents" ? "floor" : key
                ] = issue.message;
              }
            transactions.forEach((transaction) => {
              if (!reflections[transaction.id])
                errors[`reflection-${transaction.id}`] =
                  "Explicitly state whether this movement is included.";
              if (transaction.accountId !== account.id)
                errors.amount = "Reload transactions for this account before confirming.";
            });
            if (coverage.truncated)
              errors.amount =
                "Load a complete source transaction window before confirming reflections.";
            if (previousBasis && previousBasis.accountId !== account.id)
              errors.amount = "Reload the prior balance basis for this account.";
            if (draft.floor.trim() && cents(draft.floor) === null)
              errors.floor =
                "Enter an exact non-negative amount or leave the optional floor blank.";
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
                <FieldLabel htmlFor={`${id}-kind`}>Balance kind you confirm</FieldLabel>
                <NativeSelect
                  id={`${id}-kind`}
                  name="kind"
                  required
                  value={draft.kind}
                  onChange={(event) =>
                    setDraft((value) => ({ ...value, kind: event.target.value }))
                  }
                >
                  <NativeSelectOption value="">Choose current or available</NativeSelectOption>
                  <NativeSelectOption value="current">Current</NativeSelectOption>
                  <NativeSelectOption value="available">Available</NativeSelectOption>
                </NativeSelect>
              </Field>
              {(
                [
                  ["amount", "Balance amount"],
                  ["currencyCode", "Balance currency code"],
                  ["asOf", "Balance as-of instant (ISO with offset)"],
                  ["validUntil", "Valid-until instant (ISO with offset)"],
                  ["floor", "Optional protected floor (blank means unknown)"],
                ] as const
              ).map(([key, label]) => (
                <Field key={key}>
                  <FieldLabel htmlFor={`${id}-${key}`}>{label}</FieldLabel>
                  <Input
                    id={`${id}-${key}`}
                    name={key}
                    required={key !== "floor"}
                    value={draft[key]}
                    onChange={(event) =>
                      setDraft((value) => ({ ...value, [key]: event.target.value }))
                    }
                  />
                </Field>
              ))}
              {transactions.map((transaction) => (
                <Field key={transaction.id}>
                  <FieldLabel htmlFor={`${id}-reflection-${transaction.id}`}>
                    Balance reflection for {transaction.merchant} · {transaction.date} · revision{" "}
                    {transaction.transactionRevision}
                  </FieldLabel>
                  <NativeSelect
                    id={`${id}-reflection-${transaction.id}`}
                    name={`reflection-${transaction.id}`}
                    required
                    value={reflections[transaction.id] ?? ""}
                    onChange={(event) =>
                      setReflections((value) => ({
                        ...value,
                        [transaction.id]: event.target.value,
                      }))
                    }
                  >
                    <NativeSelectOption value="">Choose explicitly</NativeSelectOption>
                    <NativeSelectOption value="included">
                      Already included in this balance
                    </NativeSelectOption>
                    <NativeSelectOption value="not_included">
                      Not included in this balance
                    </NativeSelectOption>
                  </NativeSelect>
                </Field>
              ))}
            </FieldGroup>
          </FieldSet>
          <p className="text-sm text-muted-foreground">
            Account revision {expectedAccountRevision}; previous basis revision{" "}
            {previousBasis?.basisRevision ?? 0}. A zero protected floor is an explicit choice;
            leaving it blank does not mean zero.
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={save.isPending} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              Confirm my balance statement
            </Button>
          </DialogFooter>
        </FeedbackForm>
      </DialogContent>
    </Dialog>
  );
}
