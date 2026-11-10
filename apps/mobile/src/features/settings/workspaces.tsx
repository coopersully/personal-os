import {
  calendarAutomaticEvidenceKindSchema,
  calendarProfilePreferencesSchema,
  createLocalCalendarInputSchema,
  type DomainProfile,
  mailProfilePreferencesSchema,
  type UpsertDomainProfileInput,
  upsertDomainProfileInputSchema,
  type Workspace,
  type WorkspacePreferences,
  type WorkspaceSettings,
  workspacePreferenceSchemas,
} from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import { editorDismissOptions } from "../../components/editor-header";
import { FormSave } from "../../components/forms/form-save";
import { useDirtyDismiss } from "../../components/forms/use-dirty-dismiss";
import { useTheme } from "../../theme";
import { useAuth } from "../auth/context";
import { Action, Choice, confirm, Field, FormBody, Section, State, ToggleRow } from "../tasks/ui";
import { useSettingsAction, useSettingsResource } from "./data";
import { FinanceConfigurationSettings } from "./finance-settings";
import { useWorkspacePreferenceQueue } from "./preferences-hook";

/** Preserve hidden policy fields and the version the human actually reviewed. */
export function guidanceInput(
  profile: DomainProfile,
  objective: string,
  instructions: string,
  preferences = profile.preferences,
): UpsertDomainProfileInput {
  return upsertDomainProfileInputSchema.parse({
    categories: profile.categories,
    domain: profile.domain,
    expectedVersion: profile.version,
    instructions: instructions
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
    objective: objective.trim(),
    preferences,
    sourceContexts: profile.sourceContexts,
    status: profile.status,
    summary: profile.summary,
  });
}
const labels: Record<string, string> = {
  includeArchivedInSearch: "Include archived in search",
  mailConversationLayout: "Conversation layout",
  mailListDensity: "List density",
  mailListWidth: "List width (%)",
  calendarView: "Calendar view",
  showWeekends: "Show weekends",
  autoFollowToday: "Follow today",
  snapToFollow: "Snap to today",
  followSnapSensitivity: "Snap sensitivity",
  weekStartsOn: "Week starts on",
  defaultEventDurationMinutes: "Default event length (minutes)",
  financeTransactionView: "Transaction view",
  financeManualVisibility: "Manual transactions",
  financeSpendingView: "Spending view",
  financeSpendingGrouping: "Spending grouping",
  financeSpendingIncludePending: "Include pending",
  financeSpendingIncludeUncategorized: "Include uncategorized",
  financeSpendingBasis: "Spending basis",
  financeSpendingSubtractRefunds: "Subtract refunds",
  financeSpendingPeriod: "Spending period",
  financeTransactionGroup: "Transaction grouping",
};
const choices: Record<string, readonly string[]> = {
  mailConversationLayout: ["split", "single"],
  mailListDensity: ["compact", "comfortable", "expanded"],
  calendarView: ["auto", "day", "week", "month"],
  followSnapSensitivity: ["precise", "balanced", "generous"],
  weekStartsOn: ["sunday", "monday"],
  financeTransactionView: ["table", "cards"],
  financeManualVisibility: ["auto", "show", "hide"],
  financeSpendingView: ["bubbles", "list", "trends", "rhythm"],
  financeSpendingGrouping: ["auto", "buckets", "categories"],
  financeSpendingBasis: ["personal_cost", "full_outflow"],
  financeSpendingPeriod: ["today", "week", "month", "custom"],
  financeTransactionGroup: ["none", "date", "category", "merchant", "direction", "posting"],
};
const human = (value: string) => value.replaceAll("_", " ");
function WorkspacePreferencesEditor({ initial }: { initial: WorkspaceSettings }) {
  const t = useTheme();
  const action = useSettingsAction();
  const cache = useQueryClient();
  const [draft, setDraft] = useState<Record<string, unknown>>({ ...initial.preferences });
  const queue = useWorkspacePreferenceQueue(initial);
  const [failed, setFailed] = useState(queue.blocked);
  const [recovery, setRecovery] = useState(0);
  const save = (key: string, value: unknown) => {
    setDraft((current) => ({ ...current, [key]: value }));
    void action.run(async () => {
      try {
        const candidate = workspacePreferenceSchemas[initial.workspace].parse({
          ...queue.current.preferences,
          [key]: value,
        });
        const next = await queue.save({
          [key]: candidate[key as keyof typeof candidate],
        } as Partial<WorkspacePreferences>);
        await cache.invalidateQueries({ queryKey: [initial.workspace] });
        return next;
      } catch (error) {
        setFailed(true);
        throw error;
      }
    });
  };
  const reload = () =>
    confirm(
      "Reload preferences?",
      "Your unsaved choice will be replaced by current server settings. Review them before changing anything again.",
      () =>
        void action.run(async (api) => {
          const next = await api.getWorkspaceSettings(initial.workspace);
          queue.recover(next);
          setDraft({ ...next.preferences });
          setFailed(false);
          setRecovery((current) => current + 1);
        }),
    );
  return (
    <Section title="Shared workspace preferences">
      <Text style={{ color: t.secondary, padding: 16 }}>
        These preferences are shared with your other devices. Desktop layout choices do not change
        the iPhone layout.
      </Text>
      {Object.entries(labels)
        .filter(([key]) => key in draft)
        .map(([key, label]) => {
          const value = draft[key];
          if (typeof value === "boolean")
            return (
              <ToggleRow
                key={key}
                label={label}
                value={value}
                disabled={action.pending || queue.pending || failed || queue.blocked}
                onChange={(next) => save(key, next)}
              />
            );
          if (choices[key])
            return (
              <Choice
                key={key}
                label={label}
                value={String(value)}
                disabled={action.pending || queue.pending || failed || queue.blocked}
                options={choices[key].map((value) => ({ value, label: human(value) }))}
                onChange={(next) => save(key, next)}
              />
            );
          return (
            <NumberPreference
              key={`${key}-${recovery}`}
              label={label}
              value={Number(value)}
              disabled={action.pending || queue.pending || failed || queue.blocked}
              onSave={(next) => save(key, next)}
            />
          );
        })}
      {(failed || queue.blocked) && (
        <Action
          label="Reload and review preferences"
          onPress={reload}
          disabled={action.pending || queue.pending}
        />
      )}
    </Section>
  );
}
function NumberPreference({
  label,
  value,
  disabled,
  onSave,
}: {
  label: string;
  value: number;
  disabled: boolean;
  onSave: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));
  return (
    <Field
      label={label}
      value={text}
      editable={!disabled}
      keyboardType="number-pad"
      onChangeText={setText}
      onEndEditing={() => {
        if (text !== String(value)) onSave(Number(text));
      }}
    />
  );
}
function GuidanceEditor({ initial }: { initial: DomainProfile }) {
  const t = useTheme();
  const action = useSettingsAction();
  const cache = useQueryClient();
  const [baseline, setBaseline] = useState(initial);
  const [objective, setObjective] = useState(initial.objective);
  const [instructions, setInstructions] = useState(initial.instructions.join("\n"));
  const [preferences, setPreferences] = useState(initial.preferences);
  const calendarSources = useSettingsResource(
    "calendar-sources",
    (api) => api.listCalendars(),
    initial.domain === "calendar",
  );
  const dirty =
    objective !== baseline.objective ||
    instructions !== baseline.instructions.join("\n") ||
    JSON.stringify(preferences) !== JSON.stringify(baseline.preferences);
  const allowDismiss = useDirtyDismiss(dirty, action.pending);
  const close = () =>
    dirty
      ? confirm(
          "Discard guidance changes?",
          "Your unsaved guidance will be lost.",
          () => {
            allowDismiss();
            router.back();
          },
          true,
        )
      : router.back();
  const save = () =>
    confirm(
      "Save workspace guidance?",
      guidanceConfirmation(baseline, preferences),
      () =>
        void action.run(async (api) => {
          if (
            baseline.domain === "calendar" &&
            preferences.defaultCalendarId !== baseline.preferences.defaultCalendarId &&
            !calendarSources.data?.some(
              (calendar) =>
                calendar.id === preferences.defaultCalendarId &&
                calendar.isWritable &&
                baseline.sourceContexts.some((source) => source.sourceId === calendar.id),
            )
          )
            throw new Error("Choose a writable calendar from the configured guidance sources.");
          const next = await api.upsertDomainProfile(
            guidanceInput(
              baseline,
              objective,
              instructions,
              validateGuidancePreferences(baseline, preferences),
            ),
          );
          setBaseline(next);
          setPreferences(next.preferences);
          setObjective(next.objective);
          setInstructions(next.instructions.join("\n"));
          await cache.invalidateQueries({ queryKey: ["settings"] });
          await cache.invalidateQueries({ queryKey: ["assistant-setup-status"] });
          return next;
        }, "Guidance saved"),
    );
  return (
    <View style={{ flex: 1 }}>
      <FormBody>
        <Section title="Agent guidance">
          <Stack.Screen
            options={{
              gestureEnabled: !dirty,
              ...editorDismissOptions({
                label: dirty ? "Cancel" : "Back",
                onPress: close,
                disabled: action.pending,
              }),
            }}
          />
          <Text style={{ color: t.secondary, padding: 16 }}>
            Version {baseline.version} · {baseline.status}
          </Text>
          <Field
            label="Objective"
            value={objective}
            onChangeText={setObjective}
            multiline
            maxLength={1000}
            editable={!action.pending}
            placeholder="What should this workspace help you achieve?"
          />
          <Field
            label="Instructions (one per line)"
            value={instructions}
            onChangeText={setInstructions}
            multiline
            editable={!action.pending}
            placeholder="Keep suggestions focused on my priorities"
          />
          {baseline.domain === "mail" && (
            <>
              <Choice
                label="Inbox style"
                value={String(preferences.inboxStyle ?? "conservative")}
                options={["signal_only", "balanced", "conservative", "custom"].map((value) => ({
                  value,
                  label: human(value),
                }))}
                onChange={(inboxStyle) => setPreferences({ ...preferences, inboxStyle })}
                disabled={action.pending}
              />
              <Choice
                label="Important email"
                value={String(preferences.importantEmailHandling ?? "inbox_and_attention")}
                options={["inbox_only", "inbox_and_attention"].map((value) => ({
                  value,
                  label: human(value),
                }))}
                onChange={(importantEmailHandling) =>
                  setPreferences({ ...preferences, importantEmailHandling })
                }
                disabled={action.pending}
              />
              <Choice
                label="Noise handling"
                value={String(preferences.noiseDisposition ?? "review_only")}
                options={["review_only", "archive_after_days", "trash_after_days"].map((value) => ({
                  value,
                  label: human(value),
                }))}
                onChange={(noiseDisposition) =>
                  setPreferences({
                    ...preferences,
                    noiseDisposition,
                    noiseRetentionDays:
                      noiseDisposition === "review_only"
                        ? null
                        : (preferences.noiseRetentionDays ?? 30),
                  })
                }
                disabled={action.pending}
              />
              {preferences.noiseDisposition !== "review_only" && (
                <Field
                  label="Noise retention (days)"
                  value={String(preferences.noiseRetentionDays ?? 30)}
                  keyboardType="number-pad"
                  editable={!action.pending}
                  onChangeText={(value) =>
                    setPreferences({ ...preferences, noiseRetentionDays: Number(value) })
                  }
                />
              )}
            </>
          )}
          {baseline.domain === "calendar" && (
            <>
              {calendarSources.data ? (
                <Choice
                  label="Default calendar"
                  value={String(preferences.defaultCalendarId ?? "")}
                  disabled={action.pending}
                  options={[
                    ...(!calendarSources.data.some(
                      (calendar) =>
                        calendar.id === preferences.defaultCalendarId &&
                        calendar.isWritable &&
                        baseline.sourceContexts.some((source) => source.sourceId === calendar.id),
                    ) && preferences.defaultCalendarId
                      ? [
                          {
                            value: String(preferences.defaultCalendarId),
                            label: "Current calendar unavailable — choose a writable source",
                          },
                        ]
                      : []),
                    ...calendarSources.data
                      .filter(
                        (calendar) =>
                          calendar.isWritable &&
                          baseline.sourceContexts.some((source) => source.sourceId === calendar.id),
                      )
                      .map((calendar) => ({
                        value: calendar.id,
                        label: `${calendar.name}${calendar.source ? ` · ${calendar.source.accountLabel}` : ""}`,
                      })),
                  ]}
                  onChange={(defaultCalendarId) =>
                    setPreferences({ ...preferences, defaultCalendarId })
                  }
                />
              ) : (
                <State
                  loading={calendarSources.isPending}
                  retry={calendarSources.isError ? () => void calendarSources.refetch() : undefined}
                />
              )}
              <ToggleRow
                label="Create events automatically"
                value={preferences.automaticEventCreation === true}
                disabled={action.pending}
                onChange={(automaticEventCreation) =>
                  setPreferences({ ...preferences, automaticEventCreation })
                }
              />
              {calendarAutomaticEvidenceKindSchema.options.map((evidence) => (
                <ToggleRow
                  key={evidence}
                  label={`Allow evidence: ${human(evidence)}`}
                  value={
                    Array.isArray(preferences.automaticEventEvidence) &&
                    preferences.automaticEventEvidence.includes(evidence)
                  }
                  disabled={action.pending}
                  onChange={(enabled) => {
                    const current = Array.isArray(preferences.automaticEventEvidence)
                      ? preferences.automaticEventEvidence
                      : [];
                    setPreferences({
                      ...preferences,
                      automaticEventEvidence: enabled
                        ? [...current, evidence]
                        : current.filter((value) => value !== evidence),
                    });
                  }}
                />
              ))}

              <Field
                label="Before-event buffer (minutes)"
                value={String(preferences.beforeBufferMinutes ?? 0)}
                keyboardType="number-pad"
                editable={!action.pending}
                onChangeText={(value) =>
                  setPreferences({ ...preferences, beforeBufferMinutes: Number(value) })
                }
              />
              <Field
                label="After-event buffer (minutes)"
                value={String(preferences.afterBufferMinutes ?? 0)}
                keyboardType="number-pad"
                editable={!action.pending}
                onChangeText={(value) =>
                  setPreferences({ ...preferences, afterBufferMinutes: Number(value) })
                }
              />
              <Choice
                label="Busy-block privacy"
                value={String(preferences.busyBlockPrivacy ?? "busy")}
                options={["busy", "details"].map((value) => ({ value, label: human(value) }))}
                onChange={(busyBlockPrivacy) =>
                  setPreferences({ ...preferences, busyBlockPrivacy })
                }
                disabled={action.pending}
              />
            </>
          )}
          <Action
            label="Reload guidance"
            disabled={action.pending}
            onPress={() =>
              confirm(
                "Reload guidance?",
                "Replace your draft with current server guidance, then review it before saving.",
                () =>
                  void action.run(async (api) => {
                    const next = await api.getDomainProfile(baseline.domain);
                    if (!next) throw new Error("Guidance is no longer available.");
                    setBaseline(next);
                    setPreferences(next.preferences);
                    setObjective(next.objective);
                    setInstructions(next.instructions.join("\n"));
                  }),
              )
            }
          />
        </Section>
      </FormBody>
      <FormSave disabled={!dirty || action.pending} onPress={save} />
    </View>
  );
}
function WorkspaceSettingsScreen({ workspace }: { workspace: Exclude<Workspace, "tasks"> }) {
  const settings = useSettingsResource(`workspace-${workspace}`, (api) =>
    api.getWorkspaceSettings(workspace),
  );
  const guidance = useSettingsResource(`guidance-${workspace}`, (api) =>
    api.getDomainProfile(workspace),
  );
  return (
    <FormBody>
      {settings.data ? (
        <WorkspacePreferencesEditor key={workspace} initial={settings.data} />
      ) : (
        <State
          loading={settings.isPending}
          retry={settings.isError ? () => void settings.refetch() : undefined}
        />
      )}
      {workspace === "finances" && <FinanceConfigurationSettings />}
      {workspace === "mail" && <MailRules />}
      {workspace === "calendar" && <CalendarSources />}
      {guidance.data ? (
        <Action
          label="Workspace guidance"
          onPress={() =>
            router.push({ pathname: "/settings/guidance", params: { domain: workspace } })
          }
        />
      ) : (
        <State
          loading={guidance.isPending}
          retry={guidance.isError ? () => void guidance.refetch() : undefined}
          empty="No agent guidance has been configured for this workspace."
        />
      )}
      {!guidance.isPending && !guidance.isError && !guidance.data && (
        <Action label="Open agent setup" onPress={() => router.push("/settings/agents")} />
      )}
      <Section title="Related settings">
        <Action label="Notifications" onPress={() => router.push("/settings/notifications")} />
        {workspace !== "finances" && (
          <Action label="Connections" onPress={() => router.push("/settings/connections")} />
        )}
      </Section>
    </FormBody>
  );
}
export function MailSettingsScreen() {
  const { state, session } = useAuth();
  return <WorkspaceSettingsScreen key={`${state.user?.id}-${session.epoch()}`} workspace="mail" />;
}
export function CalendarSettingsScreen() {
  const { state, session } = useAuth();
  return (
    <WorkspaceSettingsScreen key={`${state.user?.id}-${session.epoch()}`} workspace="calendar" />
  );
}
export function FinanceSettingsScreen() {
  const { state, session } = useAuth();
  return (
    <WorkspaceSettingsScreen key={`${state.user?.id}-${session.epoch()}`} workspace="finances" />
  );
}

export function validateGuidancePreferences(
  profile: DomainProfile,
  preferences: DomainProfile["preferences"],
) {
  if (profile.domain === "mail") return mailProfilePreferencesSchema.parse(preferences);
  if (profile.domain === "calendar")
    (profile.status === "draft"
      ? calendarProfilePreferencesSchema.partial()
      : calendarProfilePreferencesSchema
    ).parse(preferences);
  return preferences;
}
function MailRules() {
  const t = useTheme();
  const rules = useSettingsResource("mail-rules", (api) => api.listMailRules());
  const action = useSettingsAction();
  return (
    <Section title="Mail rules">
      {rules.data?.map((rule) => (
        <Section key={rule.id} title={rule.name}>
          <Text style={{ color: t.secondary, padding: 16 }}>
            {rule.enabled ? "Enabled" : "Disabled"} · {rule.policy.replaceAll("_", " ")}
          </Text>
          {rule.enabled && (
            <Action
              label={`Disable ${rule.name}`}
              disabled={action.pending}
              onPress={() =>
                confirm(
                  "Disable Mail rule?",
                  `${rule.name} will stop applying to new mail.`,
                  () =>
                    void action.run(async (api) => {
                      await api.updateMailRule(rule.id, {
                        enabled: false,
                        expectedVersion: rule.version,
                      });
                      await rules.refetch();
                    }, "Mail rule disabled"),
                )
              }
            />
          )}
        </Section>
      ))}
      {!rules.data && (
        <State
          loading={rules.isPending}
          retry={rules.isError ? () => void rules.refetch() : undefined}
        />
      )}{" "}
      {rules.data?.length === 0 && <State empty="No Mail rules." />}
    </Section>
  );
}
function CalendarSources() {
  const { state } = useAuth();
  const t = useTheme();
  const calendars = useSettingsResource("calendar-sources", (api) => api.listCalendars());
  const action = useSettingsAction();
  const cache = useQueryClient();
  const [name, setName] = useState("");
  const [color, setColor] = useState("");
  useDirtyDismiss(!!name.trim() || !!color.trim(), action.pending);
  const refresh = async () => {
    await calendars.refetch();
    await cache.invalidateQueries({ queryKey: ["calendar"] });
  };
  return (
    <>
      <Section title="Calendar sources">
        {calendars.data?.map((calendar) => (
          <Section key={calendar.id} title={calendar.name}>
            <ToggleRow
              label={`Show ${calendar.name}${calendar.source ? ` · ${calendar.source.accountLabel}` : ""}`}
              value={calendar.isSelected}
              disabled={action.pending}
              onChange={(selected) =>
                void action.run(async (api) => {
                  await api.setCalendarSelected(calendar.id, selected);
                  await refresh();
                })
              }
            />
            <Text style={{ color: t.secondary, padding: 16 }}>
              {calendar.isWritable ? "Writable" : "Read only"} · {calendar.provider}
            </Text>
            {calendar.provider === "local" && (
              <Action
                label={`Delete ${calendar.name}`}
                disabled={action.pending}
                destructive
                onPress={() =>
                  confirm(
                    `Delete ${calendar.name}?`,
                    "This permanently deletes this local calendar and its events. Any guidance using this source will need to be reviewed.",
                    () =>
                      void action.run(async (api) => {
                        await api.deleteCalendar(calendar.id);
                        await refresh();
                      }, "Calendar deleted"),
                    true,
                  )
                }
              />
            )}
          </Section>
        ))}
        {!calendars.data && (
          <State
            loading={calendars.isPending}
            retry={calendars.isError ? () => void calendars.refetch() : undefined}
          />
        )}{" "}
        {calendars.data?.length === 0 && <State empty="No calendars connected." />}
      </Section>
      <Section title="New local calendar">
        <Field
          label="Calendar name"
          value={name}
          onChangeText={setName}
          maxLength={120}
          editable={!action.pending}
          placeholder="Personal projects"
        />
        <Field
          label="Color (optional)"
          value={color}
          onChangeText={setColor}
          editable={!action.pending}
          placeholder="#7928ff"
        />
        <Action
          label="Create calendar"
          disabled={action.pending || !name.trim() || !state.user?.planningTimezone}
          onPress={() =>
            void action.run(async (api) => {
              await api.createCalendar(
                createLocalCalendarInputSchema.parse({
                  name,
                  color: color.trim() || null,
                  timezone: state.user?.planningTimezone,
                }),
              );
              setName("");
              setColor("");
              await refresh();
            }, "Calendar created")
          }
        />
      </Section>
    </>
  );
}

export function TaskSettingsScreen() {
  const { state, session } = useAuth();
  return <TaskSettings key={`${state.user?.id}-${session.epoch()}`} />;
}
function TaskSettings() {
  const guidance = useSettingsResource("guidance-tasks", (api) => api.getDomainProfile("tasks"));
  return (
    <FormBody>
      <Section title="Tasks">
        <Action label="Task preferences" onPress={() => router.push("/task-preferences")} />
      </Section>
      {guidance.data ? (
        <Action
          label="Workspace guidance"
          onPress={() =>
            router.push({ pathname: "/settings/guidance", params: { domain: "tasks" } })
          }
        />
      ) : (
        <State
          loading={guidance.isPending}
          retry={guidance.isError ? () => void guidance.refetch() : undefined}
          empty="No agent guidance has been configured for Tasks."
        />
      )}
    </FormBody>
  );
}

export function guidanceConfirmation(
  profile: DomainProfile,
  preferences: DomainProfile["preferences"],
) {
  let message =
    "Agents will use this workspace guidance. Existing scopes and explicit approval boundaries still apply.";
  if (
    profile.domain === "mail" &&
    (preferences.noiseDisposition !== profile.preferences.noiseDisposition ||
      preferences.noiseRetentionDays !== profile.preferences.noiseRetentionDays)
  )
    message += ` Noise handling becomes ${preferences.noiseDisposition === "trash_after_days" ? "trash" : preferences.noiseDisposition === "archive_after_days" ? "archive" : "review only"}${preferences.noiseDisposition !== "review_only" ? ` after ${preferences.noiseRetentionDays} days` : ""}. This can change what happens to future Mail noise.`;
  if (
    profile.domain === "calendar" &&
    preferences.automaticEventCreation !== profile.preferences.automaticEventCreation
  )
    message += preferences.automaticEventCreation
      ? " Automatic event creation will be enabled for the selected evidence types."
      : " Automatic event creation will be disabled.";
  return message;
}

export function GuidanceSettingsScreen() {
  const { state, session } = useAuth();
  const { domain } = useLocalSearchParams<{ domain: string }>();
  return <GuidanceLoader key={`${state.user?.id}-${session.epoch()}-${domain}`} domain={domain} />;
}
function GuidanceLoader({ domain }: { domain: string }) {
  const valid = ["tasks", "mail", "calendar", "finances"].includes(domain);
  const profile = useSettingsResource(
    `guidance-${domain}`,
    (api) => api.getDomainProfile(domain as Workspace),
    valid,
  );
  if (!profile.data)
    return (
      <State
        loading={profile.isPending && valid}
        retry={profile.isError ? () => void profile.refetch() : undefined}
        empty="No guidance is configured for this workspace."
      />
    );
  return <GuidanceEditor initial={profile.data} />;
}
