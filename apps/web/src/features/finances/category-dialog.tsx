import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useFeedbackMutation } from "@/lib/use-feedback-mutation";

export function FinanceCategoryDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const client = useQueryClient();
  const save = useFeedbackMutation({
    feedback: { action: "save this category", safeToRetry: true, form: true },
    mutationFn: () => api.createFinanceCategory({ name: name.trim() }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["finance-categories"] });
      onClose();
    },
  });
  return (
    <ResponsiveDialog open onOpenChange={(open) => !open && onClose()}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Add category</ResponsiveDialogTitle>
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
              <FieldLabel htmlFor="finance-category-name">Name</FieldLabel>
              <Input
                id="finance-category-name"
                name="name"
                required
                maxLength={120}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
          </ResponsiveDialogBody>
          <ResponsiveDialogFooter>
            <ActionButton type="button" variant="ghost" onClick={onClose}>
              Cancel
            </ActionButton>
            <ActionButton type="submit" disabled={save.isPending}>
              Save category
            </ActionButton>
          </ResponsiveDialogFooter>
        </FeedbackForm>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
