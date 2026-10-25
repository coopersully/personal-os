import {
  type ConfirmFinanceRecurringScheduleInput,
  confirmFinanceRecurringScheduleInputSchema,
  type FinanceAccount,
  type FinanceRecurringSchedule,
} from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import { useId, useMemo, useRef, useState } from "react";
import {
  ResponsiveDialog as Dialog,
  ResponsiveDialogContent as DialogContent,
  ResponsiveDialogDescription as DialogDescription,
  ResponsiveDialogFooter as DialogFooter,
  ResponsiveDialogHeader as DialogHeader,
  ResponsiveDialogTitle as DialogTitle,
  ResponsiveDialogBody,
} from "@/components/responsive-dialog";
import { Button } from "@/components/ui/button";
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

export interface RecurringScheduleFormProps {
  source: ConfirmFinanceRecurringScheduleInput["source"];
  sourceName: string;
  expectedSourceRevision: number;
  supersedes: FinanceRecurringSchedule | null;
  accounts: Pick<FinanceAccount, "id" | "name" | "currencyCode">[];
  onClose: () => void;
  onSaved?: () => void | Promise<void>;
}
function cents(value: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  return match ? Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0")) : null;
}
export function RecurringScheduleForm(props: RecurringScheduleFormProps) {
  const [{ source, sourceName, expectedSourceRevision, supersedes, accounts }] = useState(
    () => props,
  );
  const { onClose, onSaved } = props;
  const client = useQueryClient();
  const id = useId();
  const [draft, setDraft] = useState({
    accountId: "",
    cadence: "",
    timezone: "",
    anchorLocalDate: "",
    effectiveFrom: "",
    day1: "",
    day2: "",
    amountBasis: "",
    amount: "",
    currencyCode: "",
  });
  const attempt = useRef<{ payload: string; key: string } | null>(null);
  const statement = () =>
    confirmFinanceRecurringScheduleInputSchema.safeParse({
      source,
      expectedSourceRevision,
      supersedesId: supersedes?.id ?? null,
      accountId: draft.accountId === "none" ? null : draft.accountId,
      cadence: draft.cadence,
      timezone: draft.timezone.trim(),
      anchorLocalDate: draft.anchorLocalDate,
      effectiveFrom: draft.effectiveFrom,
      semimonthlyDays:
        draft.cadence === "semimonthly" ? [Number(draft.day1), Number(draft.day2)] : null,
      amountBasis: draft.amountBasis,
      amountCents: draft.amount.trim() ? cents(draft.amount) : null,
      currencyCode: draft.currencyCode.trim(),
      idempotencyKey: "validation",
    });
  const save = useFeedbackMutation({
    feedback: {
      action: "confirm this recurring schedule",
      safeToRetry: false,
      form: true,
      pending: "Recording your schedule…",
      success: "Recurring schedule confirmed.",
    },
    mutationFn: async () => {
      const parsed = statement();
      if (!parsed.success) throw parsed.error;
      const { idempotencyKey: _validation, ...changes } = parsed.data;
      const payload = JSON.stringify(changes);
      if (attempt.current?.payload !== payload)
        attempt.current = { payload, key: crypto.randomUUID() };
      return requireFinanceMutationResult(
        await api.confirmFinanceRecurringSchedule({
          ...changes,
          idempotencyKey: attempt.current.key,
        }),
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
  const input = (key: keyof typeof draft, label: string, type = "text") => (
    <Field key={key}>
      <FieldLabel htmlFor={`${id}-${key}`}>{label}</FieldLabel>
      <Input
        id={`${id}-${key}`}
        name={key}
        type={type}
        required={key !== "amount" || draft.amountBasis === "fixed"}
        value={draft[key]}
        onChange={(event) => setDraft((value) => ({ ...value, [key]: event.target.value }))}
      />
    </Field>
  );
  const correctionFeedback = useMemo(
    () =>
      save.feedback
        ? {
            ...save.feedback,
            persistent: false,
            fields: Object.fromEntries(
              Object.entries(save.feedback.fields).filter(([field]) =>
                [
                  "accountId",
                  "cadence",
                  "timezone",
                  "anchorLocalDate",
                  "effectiveFrom",
                  "semimonthlyDays",
                  "semimonthlyDays.0",
                  "semimonthlyDays.1",
                  "amountBasis",
                  "amountCents",
                  "currencyCode",
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
      <DialogContent data-finance-dialog data-finance-size="default">
        <DialogHeader>
          <DialogTitle>Confirm schedule for {sourceName}</DialogTitle>
          <DialogDescription>
            State the original anchor and schedule you know. No date is inferred from a next
            expected payment. Confirmation records your statement; it does not schedule a bank
            payment.
          </DialogDescription>
        </DialogHeader>
        <ResponsiveDialogBody>
          <FeedbackForm
            feedback={correctionFeedback}
            fieldNames={{ amountCents: "amount", semimonthlyDays: "day1" }}
            className="flex flex-col gap-4"
            validate={() => {
              const parsed = statement();
              const errors: Record<string, string> = {};
              if (!parsed.success)
                for (const issue of parsed.error.issues) {
                  const key = String(issue.path[0]);
                  errors[
                    key === "amountCents" ? "amount" : key === "semimonthlyDays" ? "day1" : key
                  ] = issue.message;
                }
              if (draft.amount.trim() && cents(draft.amount) === null)
                errors.amount = "Enter an exact amount with at most two decimal places.";
              if (
                supersedes &&
                (supersedes.source.id !== source.id || supersedes.source.kind !== source.kind)
              )
                errors.effectiveFrom = "Reload the latest schedule for this source.";
              if (supersedes && draft.effectiveFrom <= supersedes.effectiveFrom)
                errors.effectiveFrom =
                  "Choose an effective date after the previous schedule boundary.";
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
                  <FieldLabel htmlFor={`${id}-accountId`}>Schedule account</FieldLabel>
                  <NativeSelect
                    id={`${id}-accountId`}
                    name="accountId"
                    required
                    value={draft.accountId}
                    onChange={(event) =>
                      setDraft((value) => ({ ...value, accountId: event.target.value }))
                    }
                  >
                    <NativeSelectOption value="">Choose account scope</NativeSelectOption>
                    <NativeSelectOption value="none">No account established</NativeSelectOption>
                    {accounts.map((account) => (
                      <NativeSelectOption key={account.id} value={account.id}>
                        {account.name} · {account.currencyCode ?? "Currency unknown"}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
                <Field>
                  <FieldLabel htmlFor={`${id}-cadence`}>Confirmed cadence</FieldLabel>
                  <NativeSelect
                    id={`${id}-cadence`}
                    name="cadence"
                    required
                    value={draft.cadence}
                    onChange={(event) =>
                      setDraft((value) => ({ ...value, cadence: event.target.value }))
                    }
                  >
                    <NativeSelectOption value="">Choose cadence</NativeSelectOption>
                    {[
                      "weekly",
                      "biweekly",
                      "semimonthly",
                      "monthly",
                      "quarterly",
                      "yearly",
                      "irregular",
                    ].map((cadence) => (
                      <NativeSelectOption key={cadence} value={cadence}>
                        {cadence}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
                {input("timezone", "Schedule timezone (IANA)")}
                {input("anchorLocalDate", "Original anchor local date", "date")}
                {input("effectiveFrom", "Effective from local date", "date")}
                {draft.cadence === "semimonthly" ? (
                  <>
                    {input("day1", "First semimonthly day (1–31)", "number")}
                    {input("day2", "Second semimonthly day (1–31)", "number")}
                  </>
                ) : null}
                <Field>
                  <FieldLabel htmlFor={`${id}-amountBasis`}>Amount basis</FieldLabel>
                  <NativeSelect
                    id={`${id}-amountBasis`}
                    name="amountBasis"
                    required
                    value={draft.amountBasis}
                    onChange={(event) =>
                      setDraft((value) => ({ ...value, amountBasis: event.target.value }))
                    }
                  >
                    <NativeSelectOption value="">Choose fixed or variable</NativeSelectOption>
                    <NativeSelectOption value="fixed">Fixed</NativeSelectOption>
                    <NativeSelectOption value="variable">Variable</NativeSelectOption>
                  </NativeSelect>
                </Field>
                {input("amount", "Expected amount (blank if variable and unknown)")}
                {input("currencyCode", "Schedule currency code")}
              </FieldGroup>
            </FieldSet>
            <p className="text-sm text-muted-foreground">
              Source revision {expectedSourceRevision}. A replacement retains previous history.
              Existing matches may need full reversals before an earlier schedule boundary can
              change.
            </p>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>
                Cancel
              </Button>
              <Button type="submit" disabled={save.isPending}>
                Confirm my schedule statement
              </Button>
            </DialogFooter>
          </FeedbackForm>
        </ResponsiveDialogBody>
      </DialogContent>
    </Dialog>
  );
}
