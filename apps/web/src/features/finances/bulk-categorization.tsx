import type {
  FinanceCategorizationApplyResult,
  FinanceCategory,
  FinanceTransaction,
} from "@personal-os/domain";
import { useIsMutating, useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "@/api";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

const mutationKey = ["finance-bulk-categorization"];
const limit = 100;

/** Selection is a snapshot of the displayed records, never a query meaning “all matches”. */
export function useFinanceBulkSelection(transactions: FinanceTransaction[], disabled = false) {
  const pageCheckboxId = useId();
  const pending = useIsMutating({ mutationKey }) > 0;
  const version = JSON.stringify(transactions.map(({ id, updatedAt }) => [id, updatedAt]));
  const [snapshot, setSnapshot] = useState({ version, ids: [] as string[] });
  if (snapshot.version !== version) setSnapshot({ version, ids: [] });
  const selectedIds = snapshot.version === version ? snapshot.ids : [];
  const selected = transactions.filter((item) => selectedIds.includes(item.id));
  const [reloadRequired, setReloadRequired] = useState(false);
  const locked = disabled || pending || reloadRequired;
  const clear = () => setSnapshot({ version, ids: [] });
  const toggle = (id: string, checked: boolean) =>
    setSnapshot((current) => {
      const ids = current.version === version ? current.ids : [];
      return {
        version,
        ids: checked
          ? ids.includes(id) || ids.length >= limit
            ? ids
            : [...ids, id]
          : ids.filter((value) => value !== id),
      };
    });
  return {
    selected,
    pageCheckboxId,
    version,
    locked,
    reloadRequired,
    setReloadRequired,
    clear,
    selectPage: (
      <Checkbox
        id={pageCheckboxId}
        aria-label="Select this page"
        checked={
          selected.length > 0 && selected.length === transactions.length
            ? true
            : selected.length > 0
              ? "indeterminate"
              : false
        }
        disabled={locked || transactions.length === 0 || transactions.length > limit}
        onCheckedChange={(checked) =>
          setSnapshot({ version, ids: checked === true ? transactions.map((item) => item.id) : [] })
        }
      />
    ),
    control: (item: FinanceTransaction) => (
      <Checkbox
        aria-label={`Select ${item.merchant}, ${item.date}`}
        checked={selectedIds.includes(item.id)}
        disabled={locked || (!selectedIds.includes(item.id) && selected.length >= limit)}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
        onCheckedChange={(checked) => toggle(item.id, checked === true)}
      />
    ),
  };
}

type Selection = ReturnType<typeof useFinanceBulkSelection>;
function resultLabel(result: FinanceCategorizationApplyResult | undefined, fallback: string) {
  if (!result) return fallback;
  if (result.status === "applied" && result.applied) return "Applied";
  if (result.status === "review_required") return "Review required — open Reviews";
  if (result.error?.code === "conflict") return "Changed — reload and review before trying again";
  return "Failed — reload and review before trying again";
}

export function FinanceBulkCategorization({
  selection,
  categories,
}: {
  selection: Selection;
  categories: FinanceCategory[];
}) {
  const client = useQueryClient();
  const categoryInputId = useId();
  const [categoryId, setCategoryId] = useState("");
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const submitting = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const reloadButton = useRef<HTMLButtonElement>(null);
  const toolbar = useRef<HTMLFieldSetElement>(null);
  const category = categories.find((item) => item.id === categoryId);
  const open = confirmation === selection.version && selection.selected.length > 0;
  const reload = async () => {
    const id = toast.loading("Reloading transactions…");
    try {
      // throwOnError keeps an unsuccessful refresh from enabling a retry with old data.
      await client.invalidateQueries(
        { queryKey: ["finance-transactions"] },
        { throwOnError: true },
      );
      selection.clear();
      selection.setReloadRequired(false);
      toast.success("Transactions reloaded. Review and select records before trying again.", {
        id,
      });
    } catch {
      toast.error("Transactions could not reload. Try reloading again before categorizing.", {
        id,
      });
    }
  };
  const mutation = useMutation({
    mutationKey,
    retry: false,
    mutationFn: async () => {
      if (
        submitting.current ||
        selection.locked ||
        !category ||
        selection.selected.length === 0 ||
        selection.selected.length > limit ||
        !open
      )
        return;
      submitting.current = true;
      const records = [...selection.selected];
      const id = toast.loading(`Categorizing ${records.length} transactions…`);
      // Any submission may have changed records, even if its response is lost.
      selection.setReloadRequired(true);
      selection.clear();
      setConfirmation(null);
      try {
        const response = await api.applyFinanceCategorizations({
          decisions: records.map((item) => ({
            transactionId: item.id,
            expectedTransactionUpdatedAt: item.updatedAt,
            categoryId: category.id,
            confidence: 1,
            learnMerchant: "never",
            rationale: "Categorized by the user in Transactions.",
          })),
        });
        const results = Array.isArray(response)
          ? response
          : response.status === "applied"
            ? response.result
            : [];
        const fallback =
          !Array.isArray(response) && response.status === "pending_review"
            ? "Review required — open Reviews"
            : !Array.isArray(response) && response.status === "needs_input"
              ? "More information required — open Reviews"
              : "Outcome unconfirmed — reload before trying again";
        const byId = new Map(results.map((result) => [result.transactionId, result]));
        const applied = records.filter((item) => {
          const result = byId.get(item.id);
          return result?.status === "applied" && result.applied;
        }).length;
        const description = (
          <ul aria-label="Categorization outcomes" className="max-h-60 overflow-y-auto break-words">
            {records.map((item) => (
              <li key={item.id}>
                {item.merchant} · {item.date}: {resultLabel(byId.get(item.id), fallback)}
              </li>
            ))}
          </ul>
        );
        const options = { id, description, duration: Number.POSITIVE_INFINITY };
        if (applied === records.length)
          toast.success(`${applied} transaction${applied === 1 ? "" : "s"} categorized`, options);
        else toast.error(`${applied} of ${records.length} transactions categorized`, options);
      } catch {
        toast.error("Categorization outcome unconfirmed", {
          id,
          duration: Number.POSITIVE_INFINITY,
          description: (
            <ul
              aria-label="Categorization outcomes"
              className="max-h-60 overflow-y-auto break-words"
            >
              {records.map((item) => (
                <li key={item.id}>
                  {item.merchant} · {item.date}: Outcome unconfirmed — reload before trying again
                </li>
              ))}
            </ul>
          ),
        });
      } finally {
        submitting.current = false;
        // Refresh related projections, but require an explicit successful transaction reload before reselecting.
        void client.invalidateQueries({
          predicate: (query) =>
            typeof query.queryKey[0] === "string" && query.queryKey[0].startsWith("finance-"),
        });
      }
    },
  });
  return (
    <>
      <fieldset
        ref={toolbar}
        tabIndex={-1}
        className="flex flex-wrap items-center gap-3"
        aria-label="Bulk transaction categorization"
      >
        <label
          htmlFor={selection.pageCheckboxId}
          className="flex min-h-11 items-center gap-3 text-sm"
        >
          {selection.selectPage}Select this page
        </label>
        <span className="text-sm text-muted-foreground">
          {selection.selected.length} selected · this page only
        </span>
        <Button
          variant="secondary"
          disabled={selection.locked || selection.selected.length === 0 || categories.length === 0}
          ref={trigger}
          onClick={() => setConfirmation(selection.version)}
        >
          Categorize selected
        </Button>
        {selection.selected.length > 0 ? (
          <Button variant="ghost" disabled={mutation.isPending} onClick={selection.clear}>
            Clear selection
          </Button>
        ) : null}
        {selection.reloadRequired ? (
          <Button
            ref={reloadButton}
            variant="secondary"
            disabled={mutation.isPending}
            onClick={() => void reload()}
          >
            Reload transactions
          </Button>
        ) : null}
      </fieldset>
      <ResponsiveDialog open={open} onOpenChange={(value) => !value && setConfirmation(null)}>
        <ResponsiveDialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const target =
              selection.reloadRequired || trigger.current?.disabled
                ? toolbar.current
                : trigger.current;
            target?.focus();
          }}
        >
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>
              Categorize {selection.selected.length} selected transactions
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              Apply one category to these records. Existing categories will be replaced. Merchant
              rules stay unchanged.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <ResponsiveDialogBody className="grid gap-4">
            <ul
              aria-label="Selected transactions"
              className="max-h-60 overflow-y-auto break-words text-sm"
            >
              {selection.selected.map((item) => (
                <li key={item.id}>
                  {item.merchant} · {item.date} · {item.amount}{" "}
                  {item.currencyCode ?? "currency unknown"} · {item.category ?? "Uncategorized"}
                </li>
              ))}
            </ul>
            <Field>
              <FieldLabel htmlFor={categoryInputId}>Category for selected transactions</FieldLabel>
              <NativeSelect
                id={categoryInputId}
                value={categoryId}
                onChange={(event) => setCategoryId(event.target.value)}
              >
                <NativeSelectOption value="">Choose a category</NativeSelectOption>
                {categories.map((item) => (
                  <NativeSelectOption key={item.id} value={item.id}>
                    {item.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          </ResponsiveDialogBody>
          <ResponsiveDialogFooter>
            <Button variant="ghost" onClick={() => setConfirmation(null)}>
              Cancel
            </Button>
            <Button
              disabled={!category || selection.locked || mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              Apply category
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  );
}
