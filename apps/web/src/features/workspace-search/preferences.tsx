import {
  type SearchableWorkspace,
  type WorkspacePreferences,
  workspacePreferencesSchema,
} from "@personal-os/domain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api";
import { QueryFeedback } from "@/components/async-state";
import { MutationFeedback } from "@/components/mutation-feedback";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { useFeedbackMutation } from "@/lib/use-feedback-mutation";
import { SettingsSection } from "../settings/settings-layout";

export const defaultWorkspacePreferences = workspacePreferencesSchema.parse({});
export function useWorkspacePreferences(workspace: SearchableWorkspace) {
  return useQuery({
    queryKey: ["workspace-settings", workspace],
    queryFn: () => api.getWorkspaceSettings(workspace),
    staleTime: 60_000,
  });
}
export function WorkspacePreferencesSection({ workspace }: { workspace: SearchableWorkspace }) {
  const query = useWorkspacePreferences(workspace);
  const cache = useQueryClient();
  const save = useFeedbackMutation({
    feedback: { action: "update workspace preferences", safeToRetry: false },
    mutationFn: (preferences: Partial<WorkspacePreferences>) =>
      api.updateWorkspaceSettings(workspace, {
        expectedRevision: query.data?.revision ?? 0,
        preferences,
      }),
    onSuccess: (data) => {
      cache.setQueryData(["workspace-settings", workspace], data);
    },
    onError: () => {
      void query.refetch();
    },
  });
  const values = query.data?.preferences ?? defaultWorkspacePreferences;
  const disabled = !query.isSuccess || save.isPending;
  return (
    <SettingsSection title="Workspace preferences">
      <QueryFeedback query={query} title="Couldn’t load preferences." />
      <MutationFeedback feedback={save.feedback} />
      <FieldGroup>
        {workspace === "calendar" ? (
          <>
            <Field>
              <FieldLabel htmlFor="calendar-default-view">Preferred view</FieldLabel>
              <NativeSelect
                id="calendar-default-view"
                value={values.calendarView}
                disabled={disabled}
                onChange={(event) =>
                  save.mutate({
                    calendarView: event.target.value as WorkspacePreferences["calendarView"],
                  })
                }
              >
                <NativeSelectOption value="auto">
                  Automatic (day on phone, week on desktop)
                </NativeSelectOption>
                <NativeSelectOption value="day">Day</NativeSelectOption>
                <NativeSelectOption value="week">Week</NativeSelectOption>
                <NativeSelectOption value="month">Month</NativeSelectOption>
              </NativeSelect>
            </Field>
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor="calendar-auto-follow">Automatically follow today</FieldLabel>
                <FieldDescription>
                  Open Calendar at the current time. When off, start at midnight.
                </FieldDescription>
              </FieldContent>
              <Switch
                id="calendar-auto-follow"
                checked={values.autoFollowToday}
                disabled={disabled}
                onCheckedChange={(autoFollowToday) => save.mutate({ autoFollowToday })}
              />
            </Field>
            <Field orientation="horizontal">
              <FieldLabel htmlFor="calendar-snap-follow">Snap back to Follow</FieldLabel>
              <Switch
                id="calendar-snap-follow"
                checked={values.snapToFollow}
                disabled={disabled}
                onCheckedChange={(snapToFollow) => save.mutate({ snapToFollow })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="calendar-snap-sensitivity">Follow snap sensitivity</FieldLabel>
              <NativeSelect
                id="calendar-snap-sensitivity"
                value={values.followSnapSensitivity}
                disabled={disabled || !values.snapToFollow}
                onChange={(event) =>
                  save.mutate({
                    followSnapSensitivity: event.target
                      .value as WorkspacePreferences["followSnapSensitivity"],
                  })
                }
              >
                <NativeSelectOption value="precise">
                  Precise — almost exactly on target
                </NativeSelectOption>
                <NativeSelectOption value="balanced">
                  Balanced — close to the target
                </NativeSelectOption>
                <NativeSelectOption value="generous">Generous — anywhere nearby</NativeSelectOption>
              </NativeSelect>
            </Field>
            <Field orientation="horizontal">
              <FieldLabel htmlFor="calendar-show-weekends">Show weekends</FieldLabel>
              <Switch
                id="calendar-show-weekends"
                checked={values.showWeekends}
                disabled={disabled}
                onCheckedChange={(showWeekends) => save.mutate({ showWeekends })}
              />
            </Field>
          </>
        ) : null}
        {workspace === "mail" ? (
          <>
            <Field>
              <FieldLabel htmlFor="mail-conversation-layout">Conversation layout</FieldLabel>
              <NativeSelect
                id="mail-conversation-layout"
                value={values.mailConversationLayout ?? "split"}
                disabled={disabled}
                onChange={(event) =>
                  save.mutate({ mailConversationLayout: event.target.value as "split" | "single" })
                }
              >
                <option value="split">Split view (full-width on mobile)</option>
                <option value="single">Full-width view</option>
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="mail-list-density">Conversation density</FieldLabel>
              <NativeSelect
                id="mail-list-density"
                value={values.mailListDensity ?? "comfortable"}
                disabled={disabled}
                onChange={(event) =>
                  save.mutate({
                    mailListDensity: event.target.value as WorkspacePreferences["mailListDensity"],
                  })
                }
              >
                <NativeSelectOption value="compact">Compact</NativeSelectOption>
                <NativeSelectOption value="comfortable">Comfortable</NativeSelectOption>
                <NativeSelectOption value="expanded">Expanded</NativeSelectOption>
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="mail-list-width">Conversation list width (%)</FieldLabel>
              <FieldDescription>
                Preferred share of the desktop split view. Smaller screens keep their responsive
                layout.
              </FieldDescription>
              <Input
                key={values.mailListWidth ?? 34}
                id="mail-list-width"
                type="number"
                min={5}
                max={95}
                step="any"
                defaultValue={values.mailListWidth ?? 34}
                disabled={disabled}
                onBlur={(event) => {
                  const width = event.target.valueAsNumber;
                  if (
                    event.target.validity.valid &&
                    Number.isFinite(width) &&
                    width !== (values.mailListWidth ?? 34)
                  )
                    save.mutate({ mailListWidth: width });
                }}
              />
            </Field>
          </>
        ) : null}
        {workspace === "finances"
          ? (
              [
                [
                  "financeTransactionView",
                  "Transaction view",
                  "table",
                  [
                    ["table", "Table"],
                    ["cards", "Cards"],
                  ],
                ],
                [
                  "financeTransactionGroup",
                  "Group cards by",
                  "none",
                  [
                    ["none", "None"],
                    ["date", "Date"],
                    ["category", "Category"],
                    ["merchant", "Merchant"],
                    ["direction", "Direction"],
                    ["posting", "Posting state"],
                  ],
                ],
              ] as const
            ).map(([key, label, fallback, options]) => (
              <Field key={key}>
                <FieldLabel htmlFor={key}>{label}</FieldLabel>
                <NativeSelect
                  id={key}
                  value={values[key] ?? fallback}
                  disabled={disabled}
                  onChange={(event) => save.mutate({ [key]: event.target.value })}
                >
                  {options.map(([value, name]) => (
                    <NativeSelectOption key={value} value={value}>
                      {name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
            ))
          : null}
        {workspace === "tasks" ? (
          <>
            {(
              [
                [
                  "taskSort",
                  "Sort by",
                  "default",
                  [
                    ["default", "Recommended"],
                    ["date", "Relevant date"],
                    ["reserved", "Reserved time"],
                    ["priority", "Priority"],
                    ["newest", "Newest first"],
                    ["oldest", "Oldest first"],
                    ["title", "Title A–Z"],
                    ["estimate", "Shortest estimate"],
                  ],
                ],
                [
                  "taskGroup",
                  "Group by",
                  "none",
                  [
                    ["none", "No grouping"],
                    ["date", "Date"],
                    ["list", "List"],
                    ["project", "Project"],
                  ],
                ],
                [
                  "taskContainerSort",
                  "List and project sorting",
                  "updated",
                  [
                    ["updated", "Recently updated"],
                    ["name", "Name A–Z"],
                    ["newest", "Newest first"],
                    ["target", "Target date"],
                  ],
                ],
              ] as const
            ).map(([key, label, fallback, options]) => (
              <Field key={key}>
                <FieldLabel htmlFor={key}>{label}</FieldLabel>
                <NativeSelect
                  id={key}
                  value={values[key] ?? fallback}
                  disabled={disabled}
                  onChange={(event) => save.mutate({ [key]: event.target.value })}
                >
                  {options.map(([value, name]) => (
                    <NativeSelectOption key={value} value={value}>
                      {name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
            ))}
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
                  checked={(values.taskRowDetails ?? ["estimate"]).includes(key)}
                  onCheckedChange={(checked) =>
                    save.mutate({
                      taskRowDetails: checked
                        ? [...(values.taskRowDetails ?? ["estimate"]), key]
                        : (values.taskRowDetails ?? ["estimate"]).filter((value) => value !== key),
                    })
                  }
                />
              </Field>
            ))}
          </>
        ) : null}
        <Field orientation="horizontal">
          <FieldLabel htmlFor={`${workspace}-search-archived`}>
            Include completed and archived items in search
          </FieldLabel>
          <Switch
            id={`${workspace}-search-archived`}
            checked={values.includeArchivedInSearch}
            disabled={disabled}
            onCheckedChange={(includeArchivedInSearch) => save.mutate({ includeArchivedInSearch })}
          />
        </Field>
      </FieldGroup>
    </SettingsSection>
  );
}
