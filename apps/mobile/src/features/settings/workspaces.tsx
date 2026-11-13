import {
  type Calendar,
  calendarAutomaticEvidenceKindSchema,
  calendarProfilePreferencesSchema,
  type DomainProfile,
  type MailRule,
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
import { useRef, useState } from "react";
import { View } from "react-native";
import { toast } from "sonner-native";
import { editorDismissOptions } from "../../components/editor-header";
import { FloatingAdd, FormSave } from "../../components/forms/form-save";
import { SectionNote } from "../../components/forms/section-content";
import { useDirtyDismiss } from "../../components/forms/use-dirty-dismiss";
import type { IconName } from "../../components/icons";
import { useTheme } from "../../theme";
import { useAuth } from "../auth/context";
import { TaskPreferencesScreen } from "../tasks/preferences";
import { Action, Choice, confirm, Field, FormBody, Section, State, ToggleRow } from "../tasks/ui";
import { useSettingsAction, useSettingsResource } from "./data";
import { FinanceConfigurationSettings } from "./finance-settings";
import { useWorkspacePreferenceQueue } from "./preferences-hook";
import { SettingsActionRow, SettingsDetailRow, SettingsRow } from "./settings-row";

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
const preferenceIcons: Record<string, IconName> = {
  includeArchivedInSearch: "archive",
  mailConversationLayout: "categoryLayers",
  mailListDensity: "views",
  mailListWidth: "mail",
  calendarView: "calendar",
  showWeekends: "calendar",
  autoFollowToday: "today",
  snapToFollow: "today",
  followSnapSensitivity: "target",
  weekStartsOn: "calendar",
  defaultEventDurationMinutes: "clock",
  financeTransactionView: "receipt",
  financeManualVisibility: "edit",
  financeSpendingView: "wallet",
  financeSpendingGrouping: "categoryLayers",
  financeSpendingIncludePending: "clock",
  financeSpendingIncludeUncategorized: "categoryTags",
  financeSpendingBasis: "wallet",
  financeSpendingSubtractRefunds: "reply",
  financeSpendingPeriod: "calendar",
  financeTransactionGroup: "categoryLayers",
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
const human = (value: string) => {
  const words = value.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};
const preferenceGroups = [
  { title: "Search", keys: ["includeArchivedInSearch"] },
  {
    title: "Mail layout on other devices",
    keys: ["mailConversationLayout", "mailListDensity", "mailListWidth"],
    help: "These layout choices apply on web and desktop. The iPhone keeps its native Mail layout.",
  },
  {
    title: "Calendar layout on other devices",
    keys: ["calendarView", "showWeekends", "weekStartsOn"],
    help: "These choices apply to the web and desktop calendar, not the iPhone agenda.",
  },
  {
    title: "Following today on other devices",
    keys: ["autoFollowToday", "snapToFollow", "followSnapSensitivity"],
    help: "Following keeps today in view. Snapping returns the web timeline to following when you scroll close to today.",
  },
  { title: "Event defaults on other devices", keys: ["defaultEventDurationMinutes"] },
  {
    title: "Spending defaults on other devices",
    keys: [
      "financeSpendingBasis",
      "financeSpendingPeriod",
      "financeSpendingIncludePending",
      "financeSpendingIncludeUncategorized",
      "financeSpendingSubtractRefunds",
    ],
  },
  {
    title: "Transaction defaults on other devices",
    keys: ["financeManualVisibility", "financeTransactionGroup"],
  },
  {
    title: "Finance layout on other devices",
    keys: ["financeSpendingView", "financeSpendingGrouping", "financeTransactionView"],
    help: "These shared web and desktop layout choices do not change the iPhone Finance views.",
  },
];
function WorkspacePreferencesEditor({ initial }: { initial: WorkspaceSettings }) {
  const _t = useTheme();
  const action = useSettingsAction();
  const cache = useQueryClient();
  const { state, session } = useAuth();
  const owner = state.user?.id;
  const epoch = session.epoch();
  const scope = useRef({ owner, epoch });
  scope.current = { owner, epoch };
  const edits = useRef<Record<string, number>>({});
  const saving = useRef(false);
  const [draft, setDraft] = useState<Record<string, unknown>>({ ...initial.preferences });
  const queue = useWorkspacePreferenceQueue(initial);
  const [failed, setFailed] = useState(queue.blocked);
  const [recovery, setRecovery] = useState(0);
  const save = (key: string, value: unknown) => {
    // Native picker events can already be queued when the control becomes disabled.
    // Reject before optimism so the displayed value always remains retryable.
    if (saving.current) {
      toast.error("Your previous choice is still saving. Choose again when it finishes.");
      return;
    }
    saving.current = true;
    edits.current[key] = (edits.current[key] ?? 0) + 1;
    const submittedEdits = { ...edits.current };
    const isCurrentScope = () =>
      scope.current.owner === owner && scope.current.epoch === epoch && session.epoch() === epoch;
    setDraft((current) => ({ ...current, [key]: value }));
    void action
      .run(async () => {
        try {
          const candidate = workspacePreferenceSchemas[initial.workspace].parse({
            ...queue.current.preferences,
            [key]: value,
          });
          const next = await queue.save({
            [key]: candidate[key as keyof typeof candidate],
          } as Partial<WorkspacePreferences>);
          if (!isCurrentScope()) return next;
          const queryKey = ["settings", owner, epoch, `workspace-${initial.workspace}`];
          // A pre-write read must not overwrite the accepted server response later.
          await cache.cancelQueries({ queryKey, exact: true });
          if (!isCurrentScope()) return next;
          const accepted = cache.setQueryData<WorkspaceSettings>(queryKey, (current) =>
            current && current.revision > next.revision ? current : next,
          );
          if (accepted) {
            setDraft((current) => {
              const reconciled: Record<string, unknown> = { ...accepted.preferences };
              for (const field of Object.keys(current)) {
                if ((edits.current[field] ?? 0) > (submittedEdits[field] ?? 0)) {
                  reconciled[field] = current[field];
                }
              }
              return reconciled;
            });
          }
          await cache.invalidateQueries({ queryKey: [initial.workspace] });
          return next;
        } catch (error) {
          setFailed(true);
          throw error;
        }
      })
      .finally(() => {
        saving.current = false;
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
  const control = (key: string) => {
    const label = labels[key] ?? key;
    const value = draft[key];
    const disabled = action.pending || queue.pending || failed || queue.blocked;
    if (typeof value === "boolean")
      return (
        <ToggleRow
          key={key}
          icon={preferenceIcons[key]}
          label={label}
          value={value}
          disabled={disabled}
          onChange={(next) => save(key, next)}
        />
      );
    if (choices[key])
      return (
        <Choice
          key={key}
          icon={preferenceIcons[key]}
          label={label}
          value={String(value)}
          disabled={disabled || (key === "followSnapSensitivity" && !draft.snapToFollow)}
          options={choices[key].map((value) => ({
            value,
            label:
              key === "mailConversationLayout"
                ? value === "split"
                  ? "Split view"
                  : "Single column"
                : human(value),
          }))}
          onChange={(next) => save(key, next)}
        />
      );
    return (
      <NumberPreference
        key={`${key}-${recovery}`}
        icon={preferenceIcons[key]}
        label={label}
        value={Number(value)}
        disabled={disabled}
        onSave={(next) => save(key, next)}
      />
    );
  };
  return (
    <>
      {preferenceGroups.map((group) => {
        const keys = group.keys.filter((key) => key in draft);
        return keys.length > 0 ? (
          <Section key={group.title} title={group.title}>
            {group.help && <SectionNote>{group.help}</SectionNote>}
            {keys.map(control)}
          </Section>
        ) : null;
      })}
      {(failed || queue.blocked) && (
        <Section>
          <Action
            label="Reload and review preferences"
            onPress={reload}
            disabled={action.pending || queue.pending}
          />
        </Section>
      )}
    </>
  );
}

function NumberPreference({
  label,
  icon,
  value,
  disabled,
  onSave,
}: {
  label: string;
  value: number;
  disabled: boolean;
  onSave: (value: number) => void;
  icon?: IconName;
}) {
  const [text, setText] = useState(String(value));
  return (
    <Field
      label={label}
      icon={icon}
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
  const _t = useTheme();
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
          <SectionNote>
            Version {baseline.version} · {baseline.status}
          </SectionNote>
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
                icon="inbox"
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
                icon="mail"
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
                icon="mail"
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
                  icon="clock"
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
                  icon="calendar"
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
                icon="calendar"
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
                icon="clock"
                value={String(preferences.beforeBufferMinutes ?? 0)}
                keyboardType="number-pad"
                editable={!action.pending}
                onChangeText={(value) =>
                  setPreferences({ ...preferences, beforeBufferMinutes: Number(value) })
                }
              />
              <Field
                label="After-event buffer (minutes)"
                icon="clock"
                value={String(preferences.afterBufferMinutes ?? 0)}
                keyboardType="number-pad"
                editable={!action.pending}
                onChangeText={(value) =>
                  setPreferences({ ...preferences, afterBufferMinutes: Number(value) })
                }
              />
              <Choice
                label="Busy-block privacy"
                icon="calendar"
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
    <View style={{ flex: 1 }}>
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
      {workspace === "calendar" && (
        <FloatingAdd label="Add calendar" onPress={() => router.push("/settings/calendar/new")} />
      )}
    </View>
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
/** Publish an accepted record without letting an older in-flight read replace it. */
function useSettingsListPublisher<T>(name: string) {
  const { state, session } = useAuth();
  const cache = useQueryClient();
  const owner = state.user?.id;
  const epoch = session.epoch();
  const live = useRef({ owner, epoch });
  live.current = { owner, epoch };
  return async (update: (records: T[]) => T[]) => {
    const current = () =>
      !!owner &&
      live.current.owner === owner &&
      live.current.epoch === epoch &&
      session.epoch() === epoch;
    if (!current()) return false;
    const queryKey = ["settings", owner, epoch, name];
    await cache.cancelQueries({ queryKey, exact: true });
    if (!current()) return false;
    cache.setQueryData<T[]>(queryKey, (records) => update(records ?? []));
    return true;
  };
}
function MailRules() {
  const rules = useSettingsResource("mail-rules", (api) => api.listMailRules());
  return (
    <Section title="Mail rules">
      {rules.data?.map((rule) => (
        <SettingsRow
          key={rule.id}
          icon="mail"
          label={rule.name}
          value={`${rule.enabled ? "On" : "Off"} · ${human(rule.policy)}`}
          onPress={() => router.push({ pathname: "/settings/mail/rule", params: { id: rule.id } })}
        />
      ))}
      {!rules.data && (
        <State
          loading={rules.isPending}
          retry={rules.isError ? () => void rules.refetch() : undefined}
        />
      )}
      {rules.data?.length === 0 && <State empty="No Mail rules." />}
    </Section>
  );
}
export function MailRuleSettingsScreen() {
  const { state, session } = useAuth();
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  return (
    <MailRuleDetails
      key={`${state.user?.id}:${session.epoch()}:${String(id)}`}
      id={typeof id === "string" ? id : undefined}
    />
  );
}
function MailRuleDetails({ id }: { id: string | undefined }) {
  const rules = useSettingsResource("mail-rules", (api) => api.listMailRules());
  const action = useSettingsAction();
  const publish = useSettingsListPublisher<MailRule>("mail-rules");
  useDirtyDismiss(false, action.pending);
  const rule = id ? rules.data?.find((candidate) => candidate.id === id) : undefined;
  return (
    <FormBody>
      <Stack.Screen options={{ title: rule?.name ?? "Mail rule" }} />
      {rule ? (
        <>
          <Section title="Rule">
            <SettingsDetailRow label="Name" value={rule.name} icon="mail" />
            <SettingsDetailRow label="Status" value={rule.enabled ? "Enabled" : "Disabled"} />
            <SettingsDetailRow label="Policy" value={human(rule.policy)} />
          </Section>
          {rule.enabled && (
            <Section>
              <SettingsActionRow
                icon="cancel"
                label={`Disable ${rule.name}`}
                disabled={action.pending}
                onPress={() =>
                  confirm(
                    "Disable Mail rule?",
                    `${rule.name} will stop applying to new mail.`,
                    () =>
                      void action.run(async (api) => {
                        const accepted = await api.updateMailRule(rule.id, {
                          enabled: false,
                          expectedVersion: rule.version,
                        });
                        await publish((records) =>
                          records.map((current) =>
                            current.id === rule.id && current.version <= accepted.version
                              ? accepted
                              : current,
                          ),
                        );
                      }, "Mail rule disabled"),
                  )
                }
              />
            </Section>
          )}
        </>
      ) : (
        <State
          loading={rules.isPending}
          retry={rules.isError ? () => void rules.refetch() : undefined}
          empty="This Mail rule is no longer available."
        />
      )}
    </FormBody>
  );
}
function CalendarSources() {
  const calendars = useSettingsResource("calendar-sources", (api) => api.listCalendars());
  return (
    <Section title="Calendar sources">
      {calendars.data?.map((calendar) => (
        <SettingsRow
          key={calendar.id}
          icon="calendar"
          label={calendar.name}
          value={`${calendar.isSelected ? "Shown" : "Hidden"} · ${calendar.source?.accountLabel ?? human(calendar.provider)}`}
          onPress={() =>
            router.push({ pathname: "/settings/calendar/source", params: { id: calendar.id } })
          }
        />
      ))}
      {!calendars.data && (
        <State
          loading={calendars.isPending}
          retry={calendars.isError ? () => void calendars.refetch() : undefined}
        />
      )}
      {calendars.data?.length === 0 && <State empty="No calendars connected." />}
    </Section>
  );
}
export function CalendarSourceSettingsScreen() {
  const { state, session } = useAuth();
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  return (
    <CalendarSourceDetails
      key={`${state.user?.id}:${session.epoch()}:${String(id)}`}
      id={typeof id === "string" ? id : undefined}
    />
  );
}
function CalendarSourceDetails({ id }: { id: string | undefined }) {
  const calendars = useSettingsResource("calendar-sources", (api) => api.listCalendars());
  const action = useSettingsAction();
  const publish = useSettingsListPublisher<Calendar>("calendar-sources");
  const cache = useQueryClient();
  useDirtyDismiss(false, action.pending);
  const calendar = id ? calendars.data?.find((candidate) => candidate.id === id) : undefined;
  return (
    <FormBody>
      <Stack.Screen options={{ title: calendar?.name ?? "Calendar source" }} />
      {calendar ? (
        <>
          <Section title="Calendar">
            <SettingsDetailRow label="Name" value={calendar.name} icon="calendar" />
            <SettingsDetailRow
              label="Source"
              value={calendar.source?.accountLabel ?? human(calendar.provider)}
            />
            <SettingsDetailRow
              label="Access"
              value={calendar.isWritable ? "Writable" : "Read only"}
            />
            <ToggleRow
              label={`Show ${calendar.name}`}
              value={calendar.isSelected}
              disabled={action.pending}
              onChange={(selected) =>
                void action.run(async (api) => {
                  const accepted = await api.setCalendarSelected(calendar.id, selected);
                  if (
                    await publish((records) =>
                      records.map((current) => (current.id === calendar.id ? accepted : current)),
                    )
                  )
                    await cache.invalidateQueries({ queryKey: ["calendar"] });
                })
              }
            />
          </Section>
          {calendar.provider === "local" && (
            <Section>
              <SettingsActionRow
                icon="trash"
                label={`Delete ${calendar.name}`}
                destructive
                disabled={action.pending}
                onPress={() =>
                  confirm(
                    `Delete ${calendar.name}?`,
                    "This permanently deletes this local calendar and its events. Any guidance using this source will need to be reviewed.",
                    () =>
                      void action.run(async (api) => {
                        await api.deleteCalendar(calendar.id);
                        if (
                          await publish((records) =>
                            records.filter((current) => current.id !== calendar.id),
                          )
                        ) {
                          await cache.invalidateQueries({ queryKey: ["calendar"] });
                          router.back();
                        }
                      }, "Calendar deleted"),
                    true,
                  )
                }
              />
            </Section>
          )}
        </>
      ) : (
        <State
          loading={calendars.isPending}
          retry={calendars.isError ? () => void calendars.refetch() : undefined}
          empty="This calendar is no longer available."
        />
      )}
    </FormBody>
  );
}

export function TaskSettingsScreen() {
  const { state, session } = useAuth();
  return <TaskSettings key={`${state.user?.id}-${session.epoch()}`} />;
}
function TaskSettings() {
  const guidance = useSettingsResource("guidance-tasks", (api) => api.getDomainProfile("tasks"));
  return (
    <TaskPreferencesScreen
      relatedSettings={
        <Section title="Workspace guidance">
          {guidance.data ? (
            <SettingsRow
              icon="agent"
              label="Workspace guidance"
              onPress={() =>
                router.push({ pathname: "/settings/guidance", params: { domain: "tasks" } })
              }
            />
          ) : guidance.isError || guidance.isPending ? (
            <State
              loading={guidance.isPending}
              retry={guidance.isError ? () => void guidance.refetch() : undefined}
            />
          ) : (
            <SettingsRow
              icon="agent"
              label="Set up workspace guidance"
              onPress={() => router.push("/settings/agents")}
            />
          )}
        </Section>
      }
    />
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
