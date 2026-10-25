import { ApiClientError } from "@personal-os/api-client";
import {
  type FinanceReimbursement,
  financeReimbursementSchema,
  type ReconcileFinanceReimbursementInput,
  reconcileFinanceReimbursementInputSchema,
} from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "../../api.js";
import { useFeedbackMutation } from "../../lib/use-feedback-mutation.js";

type CorrectionInput = Extract<
  ReconcileFinanceReimbursementInput,
  { operation: "correct_expected" | "unmatch_credit" }
>;
export function ReimbursementCorrectionDialog({
  reimbursement,
  operation,
  matchId,
  onClose,
  onDenied,
}: {
  reimbursement: FinanceReimbursement;
  operation: "correct_expected" | "unmatch_credit";
  matchId?: string;
  onClose: () => void;
  onDenied: () => void;
}) {
  // Never silently bind a checked statement or uncertain retry to newer props.
  const [snapshot] = useState(() => structuredClone(reimbursement));
  const [sourceOperation] = useState(operation);
  const [sourceMatchId] = useState(matchId);
  const id = useId();
  const client = useQueryClient();
  const [amount, setAmount] = useState(String(snapshot.expectedAmount));
  const [payer, setPayer] = useState(snapshot.payer ?? "");
  const [dueDate, setDueDate] = useState(snapshot.dueDate ?? "");
  const [rationale, setRationale] = useState("");
  const [summary, setSummary] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [denied, setDenied] = useState(false);
  const attempt = useRef<CorrectionInput | null>(null);
  const match = snapshot.matches.find((entry) => entry.id === sourceMatchId);
  const evidence = {
    summary,
    sourceRefs:
      sourceOperation === "unmatch_credit" && match
        ? match.evidence.sourceRefs
        : snapshot.evidence.sourceRefs,
  };
  const common = {
    reimbursementId: snapshot.id,
    expectedRevision: snapshot.revision,
    rationale,
    evidence,
    idempotencyKey: "validation-only",
  };
  const candidate =
    sourceOperation === "unmatch_credit"
      ? { ...common, operation: "unmatch_credit", matchId: sourceMatchId }
      : {
          ...common,
          operation: "correct_expected",
          expectedAmount: Number(amount),
          payer: payer.trim() || null,
          dueDate: dueDate || null,
        };
  const parsed = reconcileFinanceReimbursementInputSchema.safeParse(candidate);
  const exactAmount =
    /^\d+(?:\.\d{1,2})?$/.test(amount) && Number(amount) >= snapshot.receivedAmount;
  const valid =
    confirmed &&
    parsed.success &&
    (sourceOperation === "unmatch_credit"
      ? Boolean(match)
      : snapshot.status !== "cancelled" && exactAmount);
  const mutation = useFeedbackMutation({
    feedback: {
      action:
        sourceOperation === "unmatch_credit"
          ? "remove this receipt match"
          : "correct this reimbursement expectation",
      form: true,
      safeToRetry: false,
      pending: "Saving reimbursement correction…",
      success: "Reimbursement correction saved.",
    },
    mutationFn: async () => {
      if (!attempt.current) {
        if (
          !valid ||
          !parsed.success ||
          (parsed.data.operation !== "correct_expected" &&
            parsed.data.operation !== "unmatch_credit")
        )
          throw new Error("Review and confirm the correction.");
        attempt.current = { ...parsed.data, idempotencyKey: crypto.randomUUID() };
      }
      const response = await api.reconcileFinanceReimbursement(attempt.current);
      const direct = financeReimbursementSchema.safeParse(response);
      const applied =
        !direct.success &&
        response &&
        typeof response === "object" &&
        "status" in response &&
        response.status === "applied"
          ? financeReimbursementSchema.safeParse(response.result)
          : direct;
      if (!applied.success || applied.data.id !== snapshot.id)
        throw new Error(
          "The correction is not confirmed. Recover the same request before making another change.",
        );
      return applied.data;
    },
    onError: (error) => {
      if (error instanceof ApiClientError && [401, 403].includes(error.status)) {
        setDenied(true);
        onDenied();
        return;
      }
      const rejected = error instanceof ApiClientError && error.status >= 400 && error.status < 500;
      setUncertain(!rejected);
      if (rejected) attempt.current = null;
    },
    onSuccess: async () => {
      attempt.current = null;
      setUncertain(false);
      onClose();
      await Promise.all(
        [
          "finance-reimbursements",
          "finance-transactions",
          "finance-status",
          "finance-snapshot",
          "finance-forecast",
        ].map((key) => client.invalidateQueries({ queryKey: [key] })),
      );
    },
  });
  const locked = uncertain || mutation.isPending;
  if (denied) return null;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !locked) onClose();
      }}
    >
      <DialogContent data-finance-dialog data-finance-size="default">
        <DialogHeader>
          <DialogTitle>
            {sourceOperation === "unmatch_credit"
              ? "Remove receipt match"
              : "Correct reimbursement expectation"}
          </DialogTitle>
          <DialogDescription>
            {sourceOperation === "unmatch_credit"
              ? "Remove this link to an existing credit. The credit transaction stays in your ledger and the correction remains in history."
              : "Correct the existing claim. This does not create a new expense or bank transaction."}
          </DialogDescription>
        </DialogHeader>
        <ResponsiveDialogBody>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              mutation.mutate();
            }}
          >
            <dl className="text-sm">
              <div>
                <dt>Claim</dt>
                <dd className="break-all">{snapshot.id}</dd>
              </div>
              <div>
                <dt>Current revision</dt>
                <dd>{snapshot.revision}</dd>
              </div>
              {match ? (
                <div>
                  <dt>Receipt being removed</dt>
                  <dd>
                    {match.amount} · Credit {match.creditTransactionId}
                  </dd>
                </div>
              ) : null}
            </dl>
            <FieldGroup>
              {sourceOperation === "correct_expected" ? (
                <>
                  <Field>
                    <FieldLabel htmlFor={`${id}-amount`}>Expected amount</FieldLabel>
                    <Input
                      id={`${id}-amount`}
                      inputMode="decimal"
                      value={amount}
                      disabled={locked}
                      onChange={(event) => setAmount(event.target.value)}
                    />
                    <p className="text-sm text-muted-foreground">
                      Currency: {snapshot.sourceExpense?.currency ?? "unknown"}. At least the
                      already received amount: {snapshot.receivedAmount}.
                    </p>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`${id}-payer`}>Payer</FieldLabel>
                    <Input
                      id={`${id}-payer`}
                      value={payer}
                      disabled={locked}
                      onChange={(event) => setPayer(event.target.value)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`${id}-due`}>Due date</FieldLabel>
                    <Input
                      id={`${id}-due`}
                      type="date"
                      value={dueDate}
                      disabled={locked}
                      onChange={(event) => setDueDate(event.target.value)}
                    />
                  </Field>
                </>
              ) : null}
              <Field>
                <FieldLabel htmlFor={`${id}-rationale`}>Reason for correction</FieldLabel>
                <Textarea
                  id={`${id}-rationale`}
                  maxLength={1000}
                  value={rationale}
                  disabled={locked}
                  onChange={(event) => setRationale(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-summary`}>Supporting evidence</FieldLabel>
                <Textarea
                  id={`${id}-summary`}
                  maxLength={1000}
                  value={summary}
                  disabled={locked}
                  onChange={(event) => setSummary(event.target.value)}
                />
              </Field>
              <Field orientation="horizontal">
                <Checkbox
                  id={`${id}-confirm`}
                  checked={confirmed}
                  disabled={locked}
                  onCheckedChange={(value) => setConfirmed(value === true)}
                />
                <FieldLabel htmlFor={`${id}-confirm`}>
                  I confirm this correction to the existing reimbursement.
                </FieldLabel>
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button type="button" variant="ghost" disabled={locked} onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={mutation.isPending || (!uncertain && !valid)}>
                {uncertain ? "Retry same correction" : "Save correction"}
              </Button>
            </DialogFooter>
          </form>
        </ResponsiveDialogBody>
      </DialogContent>
    </Dialog>
  );
}
