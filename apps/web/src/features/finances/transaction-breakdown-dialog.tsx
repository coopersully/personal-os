import type { FinanceCategory, FinanceTransaction } from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { CurrencyInput } from "@/components/currency-input";
import { TrashIcon } from "@/components/icons";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { api } from "../../api.js";
import { MutationFeedback } from "../../components/mutation-feedback.js";
import { useFeedbackMutation } from "../../lib/use-feedback-mutation.js";
import { formatMoney } from "./format.js";

type Row = {
  amount: string;
  categoryId: string;
  id: string;
  treatment: "personal" | "reimbursable";
};

export function TransactionBreakdownDialog({
  categories,
  onOpenChange,
  open,
  transaction,
}: {
  categories: FinanceCategory[];
  onOpenChange: (open: boolean) => void;
  open: boolean;
  transaction: FinanceTransaction | null;
}) {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<Row[]>([]);
  const [futureRule, setFutureRule] = useState(false);
  useEffect(() => {
    if (!transaction || !open) return;
    const firstCategory = transaction.categoryId ?? categories[0]?.id ?? "";
    setRows([
      {
        amount: transaction.amount.toFixed(2),
        categoryId: firstCategory,
        id: crypto.randomUUID(),
        treatment: "personal",
      },
      {
        amount: "",
        categoryId: firstCategory,
        id: crypto.randomUUID(),
        treatment: "reimbursable",
      },
    ]);
    setFutureRule(false);
  }, [categories, open, transaction]);
  const expectedCents = Math.round((transaction?.amount ?? 0) * 100);
  const allocatedCents = rows.reduce(
    (sum, row) => sum + Math.round((Number(row.amount) || 0) * 100),
    0,
  );
  const remainingCents = expectedCents - allocatedCents;
  const activeRows = rows.filter((row) => Number(row.amount) > 0);
  const duplicate =
    new Set(activeRows.map((row) => `${row.categoryId}:${row.treatment}`)).size !==
    activeRows.length;
  const valid =
    rows.every(
      (row) =>
        row.amount === "" ||
        (/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(row.amount) &&
          Number.isFinite(Number(row.amount))),
    ) &&
    Boolean(transaction) &&
    remainingCents === 0 &&
    activeRows.length > 0 &&
    activeRows.every((row) => row.categoryId) &&
    !duplicate;
  const mutation = useFeedbackMutation({
    feedback: { action: "save this transaction breakdown", safeToRetry: false, form: true },
    mutationFn: async () => {
      if (!transaction) throw new Error("Choose a transaction to split.");
      return api.setFinanceTransactionBreakdown(transaction.id, {
        allocations: activeRows.map((row) => ({
          amount: Number(row.amount),
          categoryId: row.categoryId,
          rationale: "User-entered transaction breakdown.",
          treatment: row.treatment,
        })),
        expectedTransactionUpdatedAt: transaction.updatedAt,
        futureRule:
          futureRule && activeRows.length === 1
            ? {
                categoryId: activeRows[0]?.categoryId ?? "",
                rationale:
                  "Use this category for future single-category purchases from this merchant.",
              }
            : null,
        rationale: "User-entered transaction breakdown.",
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["finance-transactions"] }),
        queryClient.invalidateQueries({ queryKey: ["finance-reimbursements"] }),
        queryClient.invalidateQueries({ queryKey: ["finance-status"] }),
      ]);
      onOpenChange(false);
    },
  });
  const remaining = useMemo(() => formatMoney(Math.abs(remainingCents) / 100), [remainingCents]);
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Split {transaction?.merchant ?? "transaction"}</DialogTitle>
          <DialogDescription>
            Assign every cent once. Mark only the portion someone should repay as reimbursable.
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-w-0 gap-4">
          {rows.map((row, index) => (
            <FieldSet className="min-w-0 rounded-lg bg-card p-4" key={row.id}>
              <div className="flex items-center justify-between gap-2">
                <FieldLegend className="mb-0">Allocation {index + 1}</FieldLegend>
                <Button
                  aria-label={`Remove allocation ${index + 1}`}
                  disabled={rows.length === 1}
                  onClick={() =>
                    setRows((current) => current.filter((_, itemIndex) => itemIndex !== index))
                  }
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <TrashIcon />
                </Button>
              </div>
              <FieldGroup className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field className="min-w-0">
                  <FieldLabel htmlFor={`breakdown-category-${index}`}>Category</FieldLabel>
                  <NativeSelect
                    id={`breakdown-category-${index}`}
                    onChange={(event) =>
                      setRows((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, categoryId: event.target.value } : item,
                        ),
                      )
                    }
                    value={row.categoryId}
                  >
                    {categories.map((category) => (
                      <NativeSelectOption key={category.id} value={category.id}>
                        {category.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
                <Field className="min-w-0">
                  <FieldLabel htmlFor={`breakdown-amount-${index}`}>Amount</FieldLabel>
                  <CurrencyInput
                    id={`breakdown-amount-${index}`}
                    inputMode="decimal"
                    onValueChange={(value) =>
                      setRows((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, amount: value } : item,
                        ),
                      )
                    }
                    value={row.amount}
                  />
                </Field>
                <Field className="min-w-0">
                  <FieldLabel htmlFor={`breakdown-treatment-${index}`}>Treatment</FieldLabel>
                  <NativeSelect
                    id={`breakdown-treatment-${index}`}
                    onChange={(event) =>
                      setRows((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, treatment: event.target.value as Row["treatment"] }
                            : item,
                        ),
                      )
                    }
                    value={row.treatment}
                  >
                    <NativeSelectOption value="personal">Mine</NativeSelectOption>
                    <NativeSelectOption value="reimbursable">Reimbursable</NativeSelectOption>
                  </NativeSelect>
                </Field>
              </FieldGroup>
            </FieldSet>
          ))}
          <Button
            onClick={() =>
              setRows((current) => [
                ...current,
                {
                  amount: "",
                  categoryId: categories[0]?.id ?? "",
                  id: crypto.randomUUID(),
                  treatment: "personal",
                },
              ])
            }
            size="sm"
            type="button"
            variant="outline"
          >
            Add split
          </Button>
          <Alert variant={remainingCents === 0 && !duplicate ? "default" : "destructive"}>
            <AlertTitle>
              {remainingCents === 0
                ? "Every cent assigned"
                : remainingCents > 0
                  ? `${remaining} left to assign`
                  : `${remaining} over-assigned`}
            </AlertTitle>
            <AlertDescription>
              {duplicate
                ? "Combine rows that use the same category and treatment."
                : activeRows.some((row) => row.treatment === "reimbursable")
                  ? "Reimbursable portions stay out of personal spending and remain visible until matched."
                  : "The personal total will update immediately after this saves."}
            </AlertDescription>
          </Alert>
          <label
            className="flex items-center justify-between gap-4 rounded-md border p-3 text-sm"
            htmlFor="finance-breakdown-future-rule"
          >
            <span>
              <strong className="block">Use for future purchases</strong>
              <span className="text-muted-foreground">
                Available only for a single-category breakdown. Off by default.
              </span>
            </span>
            <Switch
              checked={futureRule}
              disabled={activeRows.length !== 1}
              id="finance-breakdown-future-rule"
              onCheckedChange={setFutureRule}
            />
          </label>
          {mutation.error ? <MutationFeedback feedback={mutation.feedback} /> : null}
        </div>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} type="button" variant="outline">
            Cancel
          </Button>
          <Button disabled={!valid || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? "Saving…" : "Save breakdown"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
