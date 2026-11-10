import type { NotificationPreferences, NotificationStatus } from "@personal-os/domain";
import { defaultNotificationPreferences, notificationPreferencesSchema } from "@personal-os/domain";
import { router, Stack } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Text } from "react-native";
import { toast } from "sonner-native";
import { editorDismissOptions } from "../../components/editor-header";
import { useTheme } from "../../theme";
import { useAuth } from "../auth/context";
import { NotificationSettings } from "../notifications/provider";
import { Action, Choice, confirm, Field, FormBody, Section, State, ToggleRow } from "../tasks/ui";
import { useSettingsAction, useSettingsResource } from "./data";
import { ProfileTime } from "./profile-time";
import { SettingsRow } from "./settings-row";
export function NotificationsSettingsScreen() {
  const { state, session } = useAuth();
  return state.user ? <Notifications key={`${state.user.id}:${session.epoch()}`} /> : null;
}
function Notifications() {
  const t = useTheme();
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const onDirty = useCallback(
    (scope: string, changed: boolean) =>
      setDirty((current) =>
        current[scope] === changed ? current : { ...current, [scope]: changed },
      ),
    [],
  );
  const edited = Object.values(dirty).some(Boolean);
  const status = useSettingsResource("notification-policy", (api) => api.getNotificationStatus());
  return (
    <FormBody>
      <Stack.Screen
        options={{
          gestureEnabled: false,
          ...editorDismissOptions({
            label: edited ? "Cancel" : "Close",
            onPress: () =>
              edited
                ? confirm(
                    "Discard policy changes?",
                    "Your unsaved text-message preferences will be lost.",
                    () => router.back(),
                  )
                : router.back(),
          }),
        }}
      />
      <NotificationSettings />
      <Section title="Text-message delivery">
        <SettingsRow
          label="Texting"
          icon="mail"
          value="Phone and consent"
          onPress={() => router.push("/settings/texting")}
        />
      </Section>
      {status.data ? (
        <>
          <Text style={{ color: t.secondary, marginBottom: 16 }}>
            Text-message policy uses {status.data.timeZone}. Delivery is{" "}
            {status.data.capability === "available"
              ? "available"
              : `unavailable${status.data.reason ? `: ${status.data.reason.replaceAll("_", " ")}` : ""}`}
            .
          </Text>
          <NotificationPolicy
            onDirty={onDirty}
            scope="global"
            initial={status.data}
            refresh={() => status.refetch()}
          />
          <NotificationPolicy
            onDirty={onDirty}
            scope="finances"
            initial={status.data}
            refresh={() => status.refetch()}
          />
        </>
      ) : (
        <State loading={status.isPending} retry={() => void status.refetch()} />
      )}
    </FormBody>
  );
}
function NotificationPolicy({
  scope,
  initial,
  refresh,
  onDirty,
}: {
  scope: "global" | "finances";
  initial: NotificationStatus;
  refresh: () => Promise<unknown>;
  onDirty: (scope: string, changed: boolean) => void;
}) {
  const action = useSettingsAction();
  const t = useTheme();
  const saved = initial.preferences.find((row) => row.scope === scope);
  const global =
    initial.preferences.find((row) => row.scope === "global")?.preferences ??
    defaultNotificationPreferences;
  const [needsReview, setNeedsReview] = useState(false);
  const [revision, setRevision] = useState(saved?.revision ?? null);
  const [baseline, setBaseline] = useState(saved?.preferences ?? global);
  const [draft, setDraft] = useState<NotificationPreferences>(baseline);
  const [reminder, setReminder] = useState(
    draft.reminderDays === null ? "" : String(draft.reminderDays),
  );
  const changed = JSON.stringify(draft) !== JSON.stringify(baseline);
  useEffect(() => onDirty(scope, changed), [scope, changed, onDirty]);
  useEffect(() => {
    if (scope === "finances" && revision === null && !changed && global !== baseline) {
      setBaseline(global);
      setDraft(global);
      setReminder(global.reminderDays === null ? "" : String(global.reminderDays));
    }
  }, [scope, revision, changed, global, baseline]);
  const update = <K extends keyof NotificationPreferences>(
    key: K,
    value: NotificationPreferences[K],
  ) => setDraft((current) => ({ ...current, [key]: value }));
  return (
    <Section
      title={scope === "global" ? "Global text-message policy" : "Finances text-message policy"}
    >
      <ToggleRow
        label="Enabled"
        value={draft.enabled}
        disabled={action.pending}
        onChange={(value) => update("enabled", value)}
      />
      <Choice
        label="Quiet hours"
        value={draft.quietMode}
        disabled={action.pending}
        options={[
          { value: "window", label: "Set hours" },
          { value: "any_time", label: "Any time" },
        ]}
        onChange={(value) => update("quietMode", value as NotificationPreferences["quietMode"])}
      />
      {draft.quietMode === "window" && (
        <>
          <ProfileTime
            disabled={action.pending}
            label="Quiet hours start"
            value={draft.quietStartMinute}
            onChange={(value) => update("quietStartMinute", value)}
          />
          <ProfileTime
            disabled={action.pending}
            label="Quiet hours end"
            value={draft.quietEndMinute}
            onChange={(value) => update("quietEndMinute", value)}
          />
        </>
      )}
      <ToggleRow
        label="Repeat reminders"
        value={draft.reminderDays !== null}
        disabled={action.pending}
        onChange={(value) => {
          update("reminderDays", value ? 7 : null);
          setReminder(value ? "7" : "");
        }}
      />
      {draft.reminderDays !== null && (
        <Field
          label="Repeat after days"
          value={reminder}
          placeholder="7"
          keyboardType="number-pad"
          editable={!action.pending}
          onChangeText={(value) => {
            setReminder(value);
            update("reminderDays", /^\d+$/.test(value) ? Number(value) : Number.NaN);
          }}
        />
      )}
      <Choice
        label="Message detail"
        value={draft.detail}
        disabled={action.pending}
        options={[
          { value: "minimal", label: "Minimal" },
          { value: "context", label: "Include context" },
        ]}
        onChange={(value) => update("detail", value as NotificationPreferences["detail"])}
      />
      <Action
        label={`Save ${scope} text policy`}
        disabled={!changed || action.pending || needsReview}
        onPress={() => {
          const parsed = notificationPreferencesSchema.safeParse(draft);
          if (!parsed.success) {
            toast.error(parsed.error.issues[0]?.message ?? "Check notification preferences.");
            return;
          }
          void action
            .run(
              (api) =>
                api.saveNotificationPreferences(scope, {
                  expectedRevision: revision,
                  preferences: parsed.data,
                }),
              "Text-message policy saved",
            )
            .then((result) => {
              if (result.ok) {
                setRevision(result.value.revision);
                setBaseline(result.value.preferences);
                setDraft(result.value.preferences);
                void refresh();
              } else setNeedsReview(true);
            });
        }}
      />
      {needsReview && (
        <Action
          label={`Load latest ${scope} policy for review`}
          disabled={action.pending}
          onPress={() => {
            void action
              .run((api) => api.getNotificationStatus(), "Latest policy loaded")
              .then((result) => {
                if (!result.ok) return;
                const latest = result.value.preferences.find((row) => row.scope === scope);
                const inherited =
                  result.value.preferences.find((row) => row.scope === "global")?.preferences ??
                  defaultNotificationPreferences;
                const preferences = latest?.preferences ?? inherited;
                const localChanges = Object.fromEntries(
                  Object.entries(draft).filter(
                    ([key, value]) => value !== baseline[key as keyof NotificationPreferences],
                  ),
                );
                const retained = { ...preferences, ...localChanges };
                const describe = (value: NotificationPreferences) =>
                  `Enabled: ${value.enabled ? "Yes" : "No"}; quiet hours: ${value.quietMode === "any_time" ? "Any time" : `${value.quietStartMinute}–${value.quietEndMinute} minutes`}; repeat after days: ${value.reminderDays ?? "Off"}; detail: ${value.detail}`;
                confirm(
                  "Review latest policy",
                  `Latest saved policy:\n${describe(preferences)}\n\nYour retained edits:\n${describe(retained)}\n\nContinue to keep these edits. Save separately to apply any remaining differences.`,
                  () => {
                    setRevision(latest?.revision ?? null);
                    setBaseline(preferences);
                    setDraft(retained);
                    setReminder(
                      retained.reminderDays === null ? "" : String(retained.reminderDays),
                    );
                    setNeedsReview(false);
                  },
                );
              });
          }}
        />
      )}
      {scope === "finances" && revision !== null && (
        <Action
          label="Use global text policy"
          disabled={action.pending || needsReview}
          onPress={() =>
            confirm(
              "Use global text policy?",
              "Your Finance-specific text-message preferences will be removed.",
              () =>
                void action
                  .run(
                    (api) =>
                      api.resetFinanceNotificationPreferences({ expectedRevision: revision }),
                    "Finances now uses global text policy",
                  )
                  .then((result) => {
                    if (result.ok) {
                      setRevision(null);
                      setBaseline(global);
                      setDraft(global);
                      setReminder(global.reminderDays === null ? "" : String(global.reminderDays));
                      void refresh();
                    } else setNeedsReview(true);
                  }),
            )
          }
        />
      )}
      {scope === "finances" && revision === null && (
        <Text style={{ padding: 16, color: t.secondary }}>
          Using global preferences. Saving creates a Finances override.
        </Text>
      )}
      {changed && (
        <Action
          label="Discard policy changes"
          disabled={action.pending}
          onPress={() =>
            confirm(
              "Discard policy changes?",
              "Unsaved text-message preferences will be lost.",
              () => {
                setDraft(baseline);
                setReminder(baseline.reminderDays === null ? "" : String(baseline.reminderDays));
              },
            )
          }
        />
      )}
    </Section>
  );
}
