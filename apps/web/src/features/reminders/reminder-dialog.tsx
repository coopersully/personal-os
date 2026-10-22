import type { Reminder, User } from "@personal-os/domain";
import { localDateTimeToUtc, parseLocalDate } from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import type { FormEvent } from "react";
import { api } from "../../api.js";
import { FeedbackForm } from "../../components/feedback-form.js";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "../../components/responsive-dialog.js";
import { Button } from "../../components/ui/button.js";
import {
  Field as ShadcnField,
  FieldGroup as ShadcnFieldGroup,
  FieldLabel as ShadcnFieldLabel,
} from "../../components/ui/field.js";
import { Input as ShadcnInput } from "../../components/ui/input.js";
import {
  NativeSelectOption,
  NativeSelect as ShadcnNativeSelect,
} from "../../components/ui/native-select.js";
import { Textarea as ShadcnTextarea } from "../../components/ui/textarea.js";
import { invalidateMaterial } from "../../lib/material-queries.js";
import { useFeedbackMutation } from "../../lib/use-feedback-mutation.js";
import {
  ActiveReminderField,
  activeReminderInput,
} from "../notifications/active-reminder-settings.js";
import { TaskCreationProgress } from "../tasks/creation-progress.js";

export function ReminderDialog({
  close,
  reminder,
  user,
}: {
  close: () => void;
  reminder: Reminder | undefined;
  user: User;
}) {
  const queryClient = useQueryClient();
  const mutation = useFeedbackMutation({
    feedback: { action: "save this reminder", form: true },
    mutationFn: (input: {
      activeReminder?: boolean;
      dueAt: string | null;
      notes: string | null;
      priority: "low" | "medium" | "high";
      timezone: string | null;
      title: string;
    }) =>
      reminder
        ? api.updateReminder(reminder.id, { ...input, expectedUpdatedAt: reminder.updatedAt })
        : api.createReminder(input),
    onSuccess: async () => {
      await invalidateMaterial(queryClient);
      close();
    },
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const due = String(form.get("dueAt"));
    mutation.mutate({
      ...activeReminderInput(form),
      dueAt: due ? dateTimeLocalToIso(due, user.planningTimezone) : null,
      notes: nullable(form.get("notes")),
      priority: String(form.get("priority")) as "low" | "medium" | "high",
      timezone: due ? user.planningTimezone : null,
      title: String(form.get("title")),
    });
  };
  return (
    <ResponsiveDialog open onOpenChange={(open) => !open && close()}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            {reminder ? "Refine reminder" : "Create a reminder"}
          </ResponsiveDialogTitle>
          {!reminder ? <TaskCreationProgress step={2} total={2} /> : null}
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody>
          <FeedbackForm feedback={mutation.feedback} onSubmit={submit}>
            <ShadcnFieldGroup>
              <ShadcnField>
                <ShadcnFieldLabel htmlFor="reminder-title">What needs attention?</ShadcnFieldLabel>
                <ShadcnInput
                  autoFocus
                  id="reminder-title"
                  defaultValue={reminder?.title}
                  name="title"
                  required
                />
              </ShadcnField>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <ShadcnField>
                  <ShadcnFieldLabel htmlFor="reminder-deadline">Deadline</ShadcnFieldLabel>
                  <ShadcnInput
                    id="reminder-deadline"
                    defaultValue={toDateTimeLocal(reminder?.dueAt, user.planningTimezone)}
                    name="dueAt"
                    type="datetime-local"
                  />
                </ShadcnField>
                <ShadcnField>
                  <ShadcnFieldLabel htmlFor="reminder-priority">Priority</ShadcnFieldLabel>
                  <ShadcnNativeSelect
                    id="reminder-priority"
                    defaultValue={reminder?.priority ?? "medium"}
                    name="priority"
                  >
                    <NativeSelectOption value="low">Low</NativeSelectOption>
                    <NativeSelectOption value="medium">Medium</NativeSelectOption>
                    <NativeSelectOption value="high">High</NativeSelectOption>
                  </ShadcnNativeSelect>
                </ShadcnField>
              </div>
              <ActiveReminderField
                ownerId={user.id}
                {...(reminder ? { value: reminder.activeReminder ?? false } : {})}
              />
              <ShadcnField>
                <ShadcnFieldLabel htmlFor="reminder-notes">Notes</ShadcnFieldLabel>
                <ShadcnTextarea
                  id="reminder-notes"
                  defaultValue={reminder?.notes ?? ""}
                  name="notes"
                  rows={4}
                />
              </ShadcnField>
            </ShadcnFieldGroup>
            <ResponsiveDialogFooter className="mt-5">
              <Button disabled={mutation.isPending} type="submit">
                {mutation.isPending ? "Saving…" : reminder ? "Save changes" : "Create reminder"}
              </Button>
            </ResponsiveDialogFooter>
          </FeedbackForm>
        </ResponsiveDialogBody>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

function nullable(value: FormDataEntryValue | null): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}
function toDateTimeLocal(
  value: string | null | undefined,
  timeZone: string,
  hoursFromNow?: number,
) {
  if (!value && hoursFromNow === undefined) return "";
  const date = value
    ? new Date(value)
    : new Date(Date.now() + (hoursFromNow as number) * 3_600_000);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      day: "2-digit",
      hour: "2-digit",
      hour12: false,
      minute: "2-digit",
      month: "2-digit",
      timeZone,
      year: "numeric",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${String(Number(parts.hour) % 24).padStart(2, "0")}:${parts.minute}`;
}
function dateTimeLocalToIso(value: string, timeZone: string): string {
  const [dateValue, timeValue] = value.split("T");
  const date = parseLocalDate(dateValue as string);
  const [hour, minute] = (timeValue as string).split(":").map(Number);
  return localDateTimeToUtc(
    date,
    (hour as number) * 60 + (minute as number),
    timeZone,
  ).toISOString();
}
