import {
  getDefaultWorkspacePreferences,
  type Workspace,
  type WorkspacePreferences,
} from "@personal-os/domain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { api } from "@/api";
import { QueryFeedback } from "@/components/async-state";
import { MutationFeedback } from "@/components/mutation-feedback";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { SettingsSection } from "../settings/settings-layout";
import { listAllTaskLists, listAllTaskProjects } from "../tasks/page";
import { sameSession, usePreferenceSession } from "./account-save-session";
import { useSaveWorkspacePreferences, useWorkspacePreferences } from "./preferences";
import { preferenceValueLabel, WorkspacePreferenceRecovery } from "./save-recovery";

type Save<W extends Workspace> = ReturnType<typeof useSaveWorkspacePreferences<W>>;
function PreferenceSection<W extends Workspace>({
  workspace,
  children,
  formatValue = preferenceValueLabel,
  recoveryUnavailable = false,
}: {
  workspace: W;
  formatValue?: (value: unknown, key: string) => string;
  recoveryUnavailable?: boolean;
  children: (values: WorkspacePreferences<W>, save: Save<W>, disabled: boolean) => ReactNode;
}) {
  const query = useWorkspacePreferences(workspace);
  const save = useSaveWorkspacePreferences(workspace);
  const values = (query.data?.preferences ??
    getDefaultWorkspacePreferences(workspace)) as WorkspacePreferences<W>;
  const disabled = !query.isSuccess || save.isPending || !!save.recovery;
  return (
    <SettingsSection title="Workspace preferences">
      <QueryFeedback query={query} title="Couldn’t load preferences." />
      {!save.recovery ? <MutationFeedback feedback={save.feedback} /> : null}
      <p className="text-sm text-muted-foreground">
        Unconfigured preferences use this workspace’s product defaults.
      </p>
      <WorkspacePreferenceRecovery
        workspace={workspace}
        formatValue={formatValue}
        unavailable={recoveryUnavailable}
      />
      <FieldGroup>
        {children(values, save, disabled)}
        <Toggle
          id={`${workspace}-search-archived`}
          label="Include completed and archived items in search"
          value={values.includeArchivedInSearch}
          disabled={disabled}
          onChange={(includeArchivedInSearch) =>
            save.mutate({ includeArchivedInSearch } as Partial<WorkspacePreferences<W>>)
          }
        />
      </FieldGroup>
    </SettingsSection>
  );
}
function Choice<T extends string>({
  id,
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: T;
  options: ReadonlyArray<readonly [T, string]>;
  disabled: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <NativeSelect
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as T)}
      >
        {options.map(([value, label]) => (
          <NativeSelectOption key={value} value={value}>
            {label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </Field>
  );
}
function Toggle({
  id,
  label,
  value,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <Field orientation="horizontal">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Switch id={id} checked={value} disabled={disabled} onCheckedChange={onChange} />
    </Field>
  );
}
function CalendarPreferences() {
  return (
    <PreferenceSection workspace="calendar">
      {(values, save, disabled) => (
        <>
          <Choice
            id="calendar-default-view"
            label="Preferred view"
            value={values.calendarView}
            disabled={disabled}
            onChange={(calendarView) => save.mutate({ calendarView })}
            options={[
              ["auto", "Automatic (day on phone, week on desktop)"],
              ["day", "Day"],
              ["week", "Week"],
              ["month", "Month"],
            ]}
          />
          <Choice
            id="calendar-week-start"
            label="Week starts on"
            value={values.weekStartsOn}
            disabled={disabled}
            onChange={(weekStartsOn) => save.mutate({ weekStartsOn })}
            options={[
              ["sunday", "Sunday"],
              ["monday", "Monday"],
            ]}
          />
          <Field>
            <FieldLabel htmlFor="calendar-default-duration">
              Default event duration (minutes)
            </FieldLabel>
            <Input
              key={values.defaultEventDurationMinutes}
              id="calendar-default-duration"
              type="number"
              min={5}
              max={1440}
              step={1}
              defaultValue={values.defaultEventDurationMinutes}
              disabled={disabled}
              onBlur={(event) => {
                const duration = event.target.valueAsNumber;
                if (
                  event.target.validity.valid &&
                  Number.isFinite(duration) &&
                  duration !== values.defaultEventDurationMinutes
                )
                  save.mutate({ defaultEventDurationMinutes: duration });
              }}
            />
          </Field>
          <Toggle
            id="calendar-auto-follow"
            label="Automatically follow today"
            value={values.autoFollowToday}
            disabled={disabled}
            onChange={(autoFollowToday) => save.mutate({ autoFollowToday })}
          />
          <Toggle
            id="calendar-snap-follow"
            label="Snap back to Follow"
            value={values.snapToFollow}
            disabled={disabled}
            onChange={(snapToFollow) => save.mutate({ snapToFollow })}
          />
          <Choice
            id="calendar-snap-sensitivity"
            label="Follow snap sensitivity"
            value={values.followSnapSensitivity}
            disabled={disabled || !values.snapToFollow}
            onChange={(followSnapSensitivity) => save.mutate({ followSnapSensitivity })}
            options={[
              ["precise", "Precise — almost exactly on target"],
              ["balanced", "Balanced — close to the target"],
              ["generous", "Generous — anywhere nearby"],
            ]}
          />
          <Toggle
            id="calendar-show-weekends"
            label="Show weekends"
            value={values.showWeekends}
            disabled={disabled}
            onChange={(showWeekends) => save.mutate({ showWeekends })}
          />
        </>
      )}
    </PreferenceSection>
  );
}
function MailPreferences() {
  return (
    <PreferenceSection workspace="mail">
      {(values, save, disabled) => (
        <>
          <Choice
            id="mail-conversation-layout"
            label="Conversation layout"
            value={values.mailConversationLayout}
            disabled={disabled}
            onChange={(mailConversationLayout) => save.mutate({ mailConversationLayout })}
            options={[
              ["split", "Split view (full-width on mobile)"],
              ["single", "Full-width view"],
            ]}
          />
          <Choice
            id="mail-list-density"
            label="Conversation density"
            value={values.mailListDensity}
            disabled={disabled}
            onChange={(mailListDensity) => save.mutate({ mailListDensity })}
            options={[
              ["compact", "Compact"],
              ["comfortable", "Comfortable"],
              ["expanded", "Expanded"],
            ]}
          />
          <Field>
            <FieldLabel htmlFor="mail-list-width">Conversation list width (%)</FieldLabel>
            <FieldDescription>
              Preferred share of the desktop split view. Smaller screens keep their responsive
              layout.
            </FieldDescription>
            <Input
              key={values.mailListWidth}
              id="mail-list-width"
              type="number"
              min={5}
              max={95}
              step="any"
              defaultValue={values.mailListWidth}
              disabled={disabled}
              onBlur={(event) => {
                const width = event.target.valueAsNumber;
                if (
                  event.target.validity.valid &&
                  Number.isFinite(width) &&
                  width !== values.mailListWidth
                )
                  save.mutate({ mailListWidth: width });
              }}
            />
          </Field>
        </>
      )}
    </PreferenceSection>
  );
}
function TasksPreferences() {
  const lists = useQuery({ queryKey: ["task-lists"], queryFn: listAllTaskLists });
  const recovery = useSaveWorkspacePreferences("tasks").recovery;
  const projects = useQuery({
    queryKey: ["task-projects"],
    queryFn: listAllTaskProjects,
    enabled: !!recovery?.attempted.pinnedProjectIds,
  });
  return (
    <PreferenceSection
      workspace="tasks"
      recoveryUnavailable={
        !!recovery &&
        ((!lists.isSuccess &&
          ("pinnedListIds" in recovery.attempted ||
            "defaultCaptureListId" in recovery.attempted)) ||
          (!projects.isSuccess && "pinnedProjectIds" in recovery.attempted))
      }
      formatValue={(value, key) => {
        if (key === "defaultCaptureListId" && typeof value === "string")
          return (
            lists.data?.items.find((list) => list.id === value)?.name ?? "Unavailable capture list"
          );
        if (Array.isArray(value) && (key === "pinnedListIds" || key === "pinnedProjectIds")) {
          const items = key === "pinnedListIds" ? lists.data?.items : projects.data?.items;
          return value.length
            ? value
                .map(
                  (id) => items?.find((item) => item.id === id)?.name ?? "Unavailable saved item",
                )
                .join(", ")
            : "None pinned";
        }
        return preferenceValueLabel(value, key);
      }}
    >
      {(values, save, disabled) => (
        <>
          <QueryFeedback query={lists} title="Couldn’t load capture lists." />
          {recovery?.attempted.pinnedProjectIds ? (
            <QueryFeedback query={projects} title="Couldn’t load pinned project names." />
          ) : null}
          <Choice
            id="tasks-default-capture-list"
            label="Default capture list"
            value={
              lists.data?.items.some(
                (list) => list.id === values.defaultCaptureListId && list.kind === "inbox",
              )
                ? ""
                : (values.defaultCaptureListId ?? "")
            }
            disabled={disabled || !lists.isSuccess}
            onChange={(value) => save.mutate({ defaultCaptureListId: value || null })}
            options={[
              ["", "Inbox"],
              ...(values.defaultCaptureListId &&
              !lists.data?.items.some(
                (list) => list.id === values.defaultCaptureListId && list.availability === "active",
              )
                ? [[values.defaultCaptureListId, "Unavailable list — new tasks use Inbox"] as const]
                : []),
              ...(lists.data?.items
                .filter((list) => list.availability === "active" && list.kind !== "inbox")
                .map((list) => [list.id, list.name] as const) ?? []),
            ]}
          />
          <Toggle
            id="tasks-show-completed"
            label="Show completed tasks in lists and projects"
            value={values.showCompletedTasks}
            disabled={disabled}
            onChange={(showCompletedTasks) => save.mutate({ showCompletedTasks })}
          />
          <Choice
            id="taskSort"
            label="Sort by"
            value={values.taskSort}
            disabled={disabled}
            onChange={(taskSort) => save.mutate({ taskSort })}
            options={[
              ["default", "Recommended"],
              ["date", "Relevant date"],
              ["reserved", "Reserved time"],
              ["priority", "Priority"],
              ["newest", "Newest first"],
              ["oldest", "Oldest first"],
              ["title", "Title A–Z"],
              ["estimate", "Shortest estimate"],
            ]}
          />
          <Choice
            id="taskGroup"
            label="Group by"
            value={values.taskGroup}
            disabled={disabled}
            onChange={(taskGroup) => save.mutate({ taskGroup })}
            options={[
              ["none", "No grouping"],
              ["date", "Date"],
              ["list", "List"],
              ["project", "Project"],
            ]}
          />
          <Choice
            id="taskContainerSort"
            label="List and project sorting"
            value={values.taskContainerSort}
            disabled={disabled}
            onChange={(taskContainerSort) => save.mutate({ taskContainerSort })}
            options={[
              ["updated", "Recently updated"],
              ["name", "Name A–Z"],
              ["newest", "Newest first"],
              ["target", "Target date"],
            ]}
          />
          <FieldDescription>Row details</FieldDescription>
          {(
            [
              ["estimate", "Estimates"],
              ["tags", "Tags"],
              ["notes", "Notes"],
            ] as const
          ).map(([key, label]) => (
            <Field orientation="horizontal" key={key}>
              <FieldLabel htmlFor={`task-details-${key}`}>{label}</FieldLabel>
              <Checkbox
                id={`task-details-${key}`}
                disabled={disabled}
                checked={values.taskRowDetails.includes(key)}
                onCheckedChange={(checked) =>
                  save.mutate((current) => ({
                    taskRowDetails: checked
                      ? [...new Set([...current.taskRowDetails, key])]
                      : current.taskRowDetails.filter((value) => value !== key),
                  }))
                }
              />
            </Field>
          ))}
        </>
      )}
    </PreferenceSection>
  );
}
function FinancesPreferences() {
  const cache = useQueryClient();
  const session = usePreferenceSession(cache);
  return <FinancesPreferencesForSession key={`${session.owner}:${session.epoch}`} />;
}
function FinancesPreferencesForSession() {
  const cache = useQueryClient();
  const session = usePreferenceSession(cache);
  const recovery = useSaveWorkspacePreferences("finances").recovery;
  const needsAccountNames =
    !!recovery && Object.keys(recovery.attempted).some((key) => key.endsWith("AccountIds"));
  const configuration = useQuery({
    queryKey: ["finance-settings-account-names", session.owner, session.epoch],
    queryFn: async () => {
      const result = await api.getFinanceConfiguration();
      if (!sameSession(cache, session)) throw new Error("Account session changed.");
      return result;
    },
    enabled: !!session.owner && needsAccountNames,
  });
  const accounts =
    configuration.data?.accounts.state === "loaded"
      ? configuration.data.accounts.value.accounts
      : undefined;
  return (
    <PreferenceSection
      workspace="finances"
      recoveryUnavailable={needsAccountNames && !accounts}
      formatValue={(value, key) => {
        if (Array.isArray(value) && key.endsWith("AccountIds"))
          return value.length
            ? value
                .map(
                  (id) =>
                    accounts?.find((account) => account.id === id)?.name ?? "Unavailable account",
                )
                .join(", ")
            : "None selected";
        return preferenceValueLabel(value, key);
      }}
    >
      {(values, save, disabled) => (
        <>
          {needsAccountNames ? (
            <QueryFeedback
              query={configuration}
              title="Couldn’t load account names for recovery."
            />
          ) : null}
          {needsAccountNames && configuration.isSuccess && !accounts ? (
            <>
              <p>
                Account names are unavailable. Reload them before reapplying account selections.
              </p>
              <Button
                type="button"
                variant="secondary"
                onClick={() => void configuration.refetch()}
              >
                Reload account names
              </Button>
            </>
          ) : null}
          <Choice
            id="financeTransactionView"
            label="Transaction view"
            value={values.financeTransactionView}
            disabled={disabled}
            onChange={(financeTransactionView) => save.mutate({ financeTransactionView })}
            options={[
              ["table", "Table"],
              ["cards", "Cards"],
            ]}
          />
          <Choice
            id="financeTransactionGroup"
            label="Group cards by"
            value={values.financeTransactionGroup}
            disabled={disabled}
            onChange={(financeTransactionGroup) => save.mutate({ financeTransactionGroup })}
            options={[
              ["none", "None"],
              ["date", "Date"],
              ["category", "Category"],
              ["merchant", "Merchant"],
              ["direction", "Direction"],
              ["posting", "Posting state"],
            ]}
          />
        </>
      )}
    </PreferenceSection>
  );
}
export function WorkspacePreferencesSection({ workspace }: { workspace: Workspace }) {
  switch (workspace) {
    case "calendar":
      return <CalendarPreferences />;
    case "tasks":
      return <TasksPreferences />;
    case "mail":
      return <MailPreferences />;
    case "finances":
      return <FinancesPreferences />;
  }
}
