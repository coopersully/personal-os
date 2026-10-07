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
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Field, FieldLabel } from "@/components/ui/field";
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
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            {transaction.notes ? "Edit context" : "Add context"}
          </ResponsiveDialogTitle>
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
