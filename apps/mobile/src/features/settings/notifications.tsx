import type { NotificationPreferences, NotificationStatus } from "@personal-os/domain";
import { defaultNotificationPreferences, notificationPreferencesSchema } from "@personal-os/domain";
import { router, Stack } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { toast } from "sonner-native";
import { editorDismissOptions } from "../../components/editor-header";
import { FormSave } from "../../components/forms/form-save";
import { SectionNote } from "../../components/forms/section-content";
import { useDirtyDismiss } from "../../components/forms/use-dirty-dismiss";
import { useTheme } from "../../theme";
import { useAuth } from "../auth/context";
import { NotificationSettings } from "../notifications/provider";
import { Choice, confirm, Field, FormBody, Section, State, ToggleRow } from "../tasks/ui";
import { useSettingsAction, useSettingsResource } from "./data";
import { ProfileTime } from "./profile-time";
import { SettingsActionRow as Action, SettingsDetailRow, SettingsRow } from "./settings-row";
export function NotificationsSettingsScreen() {
  const { state, session } = useAuth();
  return state.user ? <Notifications key={`${state.user.id}:${session.epoch()}`} /> : null;
}
function policySummary(status: NotificationStatus, scope: "global" | "finances") {
  const saved = status.preferences.find((row) => row.scope === scope);
  if (scope === "finances" && !saved) return "Uses Global Policy";
  const preferences = saved?.preferences ?? defaultNotificationPreferences;
  return `${preferences.enabled ? "On" : "Off"} · ${preferences.quietMode === "any_time" ? "Any Time" : "Quiet Hours"}`;
}
function Notifications() {
  const status = useSettingsResource("notification-policy", (api) => api.getNotificationStatus());
  return (
    <FormBody>
      <Stack.Screen options={{ title: "Notifications" }} />
      <NotificationSettings />
      <Section title="Text Messages">
        <SettingsRow
          label="Global Policy"
          icon="mail"
          value={status.data ? policySummary(status.data, "global") : ""}
          onPress={() => router.push("/settings/notifications/global")}
        />
        <SettingsRow
          label="Finances Policy"
          icon="finances"
          value={status.data ? policySummary(status.data, "finances") : ""}
          onPress={() => router.push("/settings/notifications/finances")}
        />
        <SettingsRow
          label="Texting"
          icon="mail"
          value="Phone and Consent"
          onPress={() => router.push("/settings/texting")}
        />
      </Section>
      {!status.data && <State loading={status.isPending} retry={() => void status.refetch()} />}
    </FormBody>
  );
}
export function GlobalNotificationPolicyScreen() {
  return <PolicyScreen scope="global" />;
}
export function FinanceNotificationPolicyScreen() {
  return <PolicyScreen scope="finances" />;
}
function PolicyScreen({ scope }: { scope: "global" | "finances" }) {
  const { state, session } = useAuth();
  return state.user ? (
    <PolicyPage key={`${state.user.id}:${session.epoch()}:${scope}`} scope={scope} />
  ) : null;
}
function PolicyPage({ scope }: { scope: "global" | "finances" }) {
  const status = useSettingsResource("notification-policy", (api) => api.getNotificationStatus());
  if (!status.data)
    return (
      <FormBody>
        <Stack.Screen
          options={{ title: scope === "global" ? "Global Text Policy" : "Finances Text Policy" }}
        />
        <State loading={status.isPending} retry={() => void status.refetch()} />
      </FormBody>
    );
  return (
    <NotificationPolicy scope={scope} initial={status.data} refresh={() => status.refetch()} />
  );
}
function NotificationPolicy({
  scope,
  initial,
  refresh,
}: {
  scope: "global" | "finances";
  initial: NotificationStatus;
  refresh: () => Promise<unknown>;
}) {
  const action = useSettingsAction();
  const _t = useTheme();
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
  useDirtyDismiss(changed, action.pending);
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
  const savePolicy = () => {
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
  };
  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          title: scope === "global" ? "Global Text Policy" : "Finances Text Policy",
          ...editorDismissOptions({
            label: changed ? "Cancel" : "Close",
            disabled: action.pending,
            onPress: () => router.back(),
          }),
        }}
      />
      <FormBody>
        <Section title="Delivery">
          <SettingsDetailRow label="Timezone" value={initial.timeZone} />
          <SettingsDetailRow
            label="Text Delivery"
            value={initial.capability === "available" ? "Available" : "Unavailable"}
          />
          {initial.reason && (
            <SettingsDetailRow
              label="Delivery Reason"
              value={initial.reason.replaceAll("_", " ")}
            />
          )}
        </Section>
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
            icon="clock"
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
            icon="history"
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
              icon="calendar"
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
            icon="mail"
            value={draft.detail}
            disabled={action.pending}
            options={[
              { value: "minimal", label: "Minimal" },
              { value: "context", label: "Include context" },
            ]}
            onChange={(value) => update("detail", value as NotificationPreferences["detail"])}
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
                          setReminder(
                            global.reminderDays === null ? "" : String(global.reminderDays),
                          );
                          void refresh();
                        } else setNeedsReview(true);
                      }),
                )
              }
            />
          )}
          {scope === "finances" && revision === null && (
            <SectionNote>Using global preferences. Saving creates a Finances override.</SectionNote>
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
                    setReminder(
                      baseline.reminderDays === null ? "" : String(baseline.reminderDays),
                    );
                  },
                )
              }
            />
          )}
        </Section>
      </FormBody>
      <FormSave
        label="Save policy"
        disabled={!changed || action.pending || needsReview}
        onPress={savePolicy}
      />
    </View>
  );
}
