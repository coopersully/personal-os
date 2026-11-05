import { useQuery } from "@tanstack/react-query";
import { useId } from "react";
import { api } from "../../api.js";
import { QueryFeedback } from "../../components/async-state.js";
import { Button } from "../../components/ui/button.js";
import { Field, FieldDescription, FieldLabel } from "../../components/ui/field.js";
import { NativeSelect, NativeSelectOption } from "../../components/ui/native-select.js";

export function activeReminderInput(form: FormData): { activeReminder?: boolean } {
  const value = form.get("activeReminder");
  return value === "true"
    ? { activeReminder: true }
    : value === "false"
      ? { activeReminder: false }
      : {};
}
export function ActiveReminderField({
  ownerId,
  value,
  kind = "reminder",
}: {
  ownerId: string;
  value?: boolean;
  kind?: "task" | "reminder";
}) {
  const id = useId();
  const query = useQuery({
    queryKey: ["active-reminder-preferences", ownerId],
    queryFn: () => api.getActiveReminderPreferences(ownerId),
    enabled: value === undefined,
    retry: false,
  });
  const accountDefault =
    kind === "task"
      ? query.data?.defaultTaskActiveReminder
      : query.data?.defaultReminderActiveReminder;
  return (
    <Field>
      {value === undefined ? (
        <QueryFeedback query={query} title="Couldn’t load the active reminder default." toastOnly />
      ) : null}
      <FieldLabel htmlFor={id}>Active reminder</FieldLabel>
      <NativeSelect
        id={id}
        name="activeReminder"
        defaultValue={value === undefined ? "inherit" : String(value)}
      >
        {value === undefined ? (
          <NativeSelectOption value="inherit">
            {query.data
              ? `Use account default (${accountDefault ? "on" : "off"})`
              : "Use account default"}
          </NativeSelectOption>
        ) : null}
        <NativeSelectOption value="true">On</NativeSelectOption>
        <NativeSelectOption value="false">Off</NativeSelectOption>
      </NativeSelect>
      <FieldDescription>
        Keep a movable card on your Mac until this item is complete.
      </FieldDescription>
      {value === undefined && query.isError ? (
        <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>
          Retry active reminder default
        </Button>
      ) : null}
    </Field>
  );
}
