import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useId } from "react";
import { api } from "../../api.js";
import { QueryFeedback } from "../../components/async-state.js";
import { MutationFeedback } from "../../components/mutation-feedback.js";
import { Button } from "../../components/ui/button.js";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "../../components/ui/field.js";
import { NativeSelect, NativeSelectOption } from "../../components/ui/native-select.js";
import { Switch } from "../../components/ui/switch.js";
import { useFeedbackMutation } from "../../lib/use-feedback-mutation.js";
import { SettingsSection } from "../settings/settings-layout.js";
import { sameSession, usePreferenceSession } from "../workspace-settings/account-save-session.js";

export function activeReminderInput(form: FormData): { activeReminder?: boolean } {
  const value = form.get("activeReminder");
  return value === "true"
    ? { activeReminder: true }
    : value === "false"
      ? { activeReminder: false }
      : {};
}
export function ActiveReminderField({ ownerId, value }: { ownerId: string; value?: boolean }) {
  const id = useId();
  const query = useQuery({
    queryKey: ["active-reminder-preferences", ownerId],
    queryFn: () => api.getActiveReminderPreferences(ownerId),
    enabled: value === undefined,
    retry: false,
  });
  return (
    <Field>
      <FieldLabel htmlFor={id}>Active reminder</FieldLabel>
      <NativeSelect
        id={id}
        name="activeReminder"
        defaultValue={value === undefined ? "inherit" : String(value)}
      >
        {value === undefined ? (
          <NativeSelectOption value="inherit">
            {query.data
              ? `Use account default (${query.data.defaultActiveReminder ? "on" : "off"})`
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
export function ActiveReminderSettings({ ownerId }: { ownerId: string }) {
  const cache = useQueryClient();
  const session = usePreferenceSession(cache);
  const id = useId();
  const key = ["active-reminder-preferences", ownerId];
  const query = useQuery({
    queryKey: key,
    queryFn: () => api.getActiveReminderPreferences(ownerId),
    enabled: session.owner === ownerId,
  });
  const save = useFeedbackMutation({
    feedback: { action: "save active reminder defaults", safeToRetry: false },
    mutationFn: async (defaultActiveReminder: boolean) => {
      if (!sameSession(cache, session) || session.owner !== ownerId || !query.data)
        throw new Error("Your account changed. Reload these settings.");
      return api.saveActiveReminderPreferences(
        { defaultActiveReminder, expectedRevision: query.data.revision },
        ownerId,
      );
    },
    onSuccess: (result) => {
      if (sameSession(cache, session)) cache.setQueryData(key, result);
    },
    onError: () => {
      if (sameSession(cache, session)) void query.refetch();
    },
  });
  return (
    <SettingsSection title="Active reminders">
      <QueryFeedback query={query} title="Couldn’t load active reminder defaults." />
      <MutationFeedback feedback={save.feedback} />
      <FieldGroup>
        <Field orientation="horizontal">
          <FieldLabel htmlFor={id}>Use active reminders for new items</FieldLabel>
          <Switch
            id={id}
            checked={query.data?.defaultActiveReminder ?? false}
            disabled={!query.isSuccess || save.isPending || session.owner !== ownerId}
            onCheckedChange={(value) => save.mutate(value)}
          />
        </Field>
        <FieldDescription>
          On macOS, active reminders stay on screen until completed. While you’re away, nohmi sends
          the usual notification and shows the card when you return if it’s still incomplete. Cards
          can appear during macOS Focus. Existing items keep their own setting.
        </FieldDescription>
      </FieldGroup>
    </SettingsSection>
  );
}
