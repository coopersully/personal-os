import type { AccountSetupWorkspace, User } from "@personal-os/domain";
import { updateUserInputSchema } from "@personal-os/domain";
import { router, Stack } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { toast } from "sonner-native";
import { editorDismissOptions } from "../../components/editor-header";
import { FormSave } from "../../components/forms/form-save";
import { useAuth } from "../auth/context";
import { SearchableChoice } from "../tasks/searchable-choice";
import { Action, confirm, Field, FormBody, Section, ToggleRow } from "../tasks/ui";
import { useSettingsAction, useUserSettings } from "./data";
import { planningTimezoneChoices } from "./planning-timezones";
import { ProfileLocation } from "./profile-location";
import { ProfileTime } from "./profile-time";
export function ProfileSettingsScreen() {
  const { state, session } = useAuth();
  return state.user ? (
    <Profile key={`${state.user.id}:${session.epoch()}`} initial={state.user} />
  ) : null;
}
export function profilePatch(
  initial: User,
  draft: {
    first: string;
    last: string;
    email: string;
    timezone: string;
    start: number;
    end: number;
    location: User["homeLocation"];
  },
) {
  const values = {
    displayName: [draft.first.trim(), draft.last.trim()].filter(Boolean).join(" "),
    email: draft.email.trim(),
    planningTimezone: draft.timezone,
    workdayStartMinute: draft.start,
    workdayEndMinute: draft.end,
    homeLocation: draft.location,
  };
  return Object.fromEntries(
    Object.entries(values).filter(
      ([key, value]) => JSON.stringify(value) !== JSON.stringify(initial[key as keyof User]),
    ),
  );
}
function Profile({ initial }: { initial: User }) {
  const { session } = useAuth();
  const userSettings = useUserSettings();
  const action = useSettingsAction();
  const [baseline, setBaseline] = useState(initial);
  const [draft, setDraft] = useState({
    first: initial.displayName.split(" ")[0] ?? "",
    last: initial.displayName.split(" ").slice(1).join(" "),
    email: initial.email,
    timezone: initial.planningTimezone,
    start: initial.workdayStartMinute,
    end: initial.workdayEndMinute,
    location: initial.homeLocation,
  });
  const patch = profilePatch(baseline, draft);
  const edited = Object.keys(patch).length > 0;
  const update = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const timezoneOptions = planningTimezoneChoices(draft.timezone).map((value) => ({
    value,
    label: value.replaceAll("_", " "),
  }));
  const close = () =>
    edited
      ? confirm("Discard changes?", "Your unsaved profile changes will be lost.", () =>
          router.back(),
        )
      : router.back();
  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          gestureEnabled: false,
          ...editorDismissOptions({
            label: edited ? "Cancel" : "Close",
            disabled: userSettings.pending,
            onPress: close,
          }),
        }}
      />
      <FormBody>
        <Section title="Identity">
          <Field
            label="First name"
            placeholder="Alex"
            value={draft.first}
            onChangeText={(value) => update("first", value)}
            autoComplete="given-name"
          />
          <Field
            label="Last name"
            placeholder="Morgan"
            value={draft.last}
            onChangeText={(value) => update("last", value)}
            autoComplete="family-name"
          />
          <Field
            label="Email"
            placeholder="alex@example.com"
            value={draft.email}
            onChangeText={(value) => update("email", value)}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
          />
          {!userSettings.user?.emailVerified && (
            <Action
              label="Send verification email"
              disabled={action.pending || draft.email !== baseline.email}
              onPress={() =>
                void action.run(
                  (api) => api.resendEmailVerification(),
                  "Verification email requested",
                )
              }
            />
          )}
        </Section>
        <Section title="Planning">
          <SearchableChoice
            label="Timezone"
            value={draft.timezone}
            options={timezoneOptions}
            onChange={(value) => update("timezone", value)}
          />
          <ProfileTime
            label="Day starts"
            value={draft.start}
            onChange={(value) => update("start", value)}
          />
          <ProfileTime
            label="Day ends"
            value={draft.end}
            end
            onChange={(value) => update("end", value)}
          />
        </Section>
        <Section>
          <ProfileLocation
            value={draft.location}
            onChange={(location) =>
              setDraft((current) => ({
                ...current,
                location,
                timezone: location?.timezone ?? current.timezone,
              }))
            }
          />
        </Section>
        <Section title="Workspace setup">
          {(["tasks", "mail", "calendar", "finances"] as AccountSetupWorkspace[]).map(
            (workspace) => (
              <ToggleRow
                key={workspace}
                label={workspace.charAt(0).toUpperCase() + workspace.slice(1)}
                value={userSettings.user?.setup.selectedWorkspaces.includes(workspace) ?? false}
                disabled={action.pending}
                onChange={(enabled) =>
                  void action.run(async (api) => {
                    const current = await api.getMe();
                    const selected = current.setup.selectedWorkspaces.filter(
                      (item) => item !== workspace,
                    );
                    if (enabled) selected.push(workspace);
                    const epoch = session.epoch();
                    const user = await api.updateAccountSetup({
                      action: "preferences",
                      selectedWorkspaces: selected,
                    });
                    session.acceptUserUpdate(user, epoch);
                  })
                }
              />
            ),
          )}
        </Section>
      </FormBody>
      <FormSave
        disabled={!edited || userSettings.pending}
        onPress={() => {
          if (draft.start >= draft.end) {
            toast.error("Day end must be after day start.");
            return;
          }
          const parsed = updateUserInputSchema.safeParse(patch);
          if (!parsed.success) {
            toast.error(parsed.error.issues[0]?.message ?? "Check your profile fields.");
            return;
          }
          void userSettings.save(parsed.data, "Profile updated").then((result) => {
            if (result.ok) {
              setBaseline(result.value);
            }
          });
        }}
      />
    </View>
  );
}
