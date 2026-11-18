import type { FinanceTransaction } from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import { type ReactElement, useRef, useState } from "react";
import { api } from "@/api";
import { ActionButton } from "@/components/action-button";
import { FeedbackForm } from "@/components/feedback-form";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog";
import { Field, FieldLabel } from "@/components/settings-field";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useFeedbackMutation } from "@/lib/use-feedback-mutation";

export function TransactionContextMenu({
  transaction,
  children,
  onSplit,
  onContext,
  onCategorize,
}: {
  transaction: FinanceTransaction;
  children: ReactElement;
  onSplit: () => void;
  onContext: () => void;
  onCategorize: () => void;
}) {
  const opening = useRef(false);
  const select = (action: () => void) => {
    opening.current = true;
    action();
  };
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent
        onCloseAutoFocus={(event) => {
          if (opening.current) event.preventDefault();
          opening.current = false;
        }}
      >
        <ContextMenuItem onSelect={() => select(onSplit)}>Split purchase</ContextMenuItem>
        <ContextMenuItem onSelect={() => select(onContext)}>
          {transaction.notes ? "Edit context" : "Add context"}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => select(onCategorize)}>
          {transaction.category || transaction.categoryId ? "Recategorize" : "Categorize"}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function TransactionContextEditor({
  transaction,
  onClose,
}: {
  transaction: FinanceTransaction;
  onClose: () => void;
}) {
  const [notes, setNotes] = useState(transaction.notes ?? "");
  const client = useQueryClient();
  const save = useFeedbackMutation({
    feedback: { action: "save transaction context", safeToRetry: true, form: true },
    mutationFn: async () => {
      const result = await api.updateFinanceTransaction(transaction.id, {
        notes: notes.trim() || null,
        expectedTransactionUpdatedAt: transaction.updatedAt,
      });
      if ("status" in result && result.status !== "applied")
        throw new Error(
          result.status === "pending_review"
            ? "This change is awaiting review."
            : "This change needs more information.",
        );
      return result;
    },
    onSuccess: async () => {
      await client.invalidateQueries({
        predicate: (query) => String(query.queryKey[0]).startsWith("finance-"),
      });
      onClose();
    },
  });
  return (
    <ResponsiveDialog open onOpenChange={(open) => !open && onClose()}>
      <ResponsiveDialogContent data-finance-dialog data-finance-size="default">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            {transaction.notes ? "Edit context" : "Add context"}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Save a note to explain this transaction.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <FeedbackForm
          feedback={save.feedback}
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <ResponsiveDialogBody>
            <Field>
              <FieldLabel htmlFor="transaction-context-notes">
                Context for {transaction.merchant}
              </FieldLabel>
              <Textarea
                id="transaction-context-notes"
                name="notes"
                maxLength={4000}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </Field>
          </ResponsiveDialogBody>
          <ResponsiveDialogFooter>
            <ActionButton type="button" variant="ghost" onClick={onClose}>
              Cancel
            </ActionButton>
            <ActionButton type="submit" disabled={save.isPending}>
              Save context
            </ActionButton>
          </ResponsiveDialogFooter>
        </FeedbackForm>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

/**
 * Corrects the date of a manually entered transaction. A synced date is provider
 * evidence, so a synced transaction gets no input at all.
 */
export function TransactionDateEditor({
  transaction,
  manual,
  onSaved,
}: {
  transaction: FinanceTransaction;
  manual: boolean;
  /** The transaction this was opened with is stale once its date is saved. */
  onSaved?: () => void;
}) {
  const [date, setDate] = useState(transaction.date);
  const client = useQueryClient();
  // A date change is guarded by the observed revision, but an unknown outcome is never retried.
  const save = useFeedbackMutation({
    feedback: {
      action: "save the transaction date",
      pending: "Saving date…",
      success: "Date updated",
      form: true,
    },
    mutationFn: async () => {
      const result = await api.updateFinanceTransaction(transaction.id, {
        date,
        expectedTransactionUpdatedAt: transaction.updatedAt,
      });
      if ("status" in result && result.status !== "applied")
        throw new Error(
          result.status === "pending_review"
            ? "This change is awaiting review."
            : "This change needs more information.",
        );
      return result;
    },
    onSuccess: async () => {
      await client.invalidateQueries({
        predicate: (query) => String(query.queryKey[0]).startsWith("finance-"),
      });
      onSaved?.();
    },
  });
  if (!manual) return null;
  return (
    <FeedbackForm
      feedback={save.feedback}
      className="flex flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (date && date !== transaction.date && !save.isPending) save.mutate();
      }}
    >
      <Field>
        <FieldLabel htmlFor="transaction-date">Date</FieldLabel>
        <Input
          id="transaction-date"
          name="date"
          type="date"
          required
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
      </Field>
      <ActionButton
        type="submit"
        variant="outline"
        disabled={save.isPending || !date || date === transaction.date}
      >
        Save date
      </ActionButton>
    </FeedbackForm>
  );
}
