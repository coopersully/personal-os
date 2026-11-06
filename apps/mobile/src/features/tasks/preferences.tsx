import type { TasksWorkspacePreferences, WorkspaceSettings } from "@personal-os/domain";
import { Stack } from "expo-router";
import { useState } from "react";
import { NotificationSettings } from "../notifications/provider";
import { useTaskAction, useTaskApi, useTaskResources } from "./data";
import { SearchableChoice } from "./searchable-choice";
import { Action, Choice, FormBody, Section, State, ToggleRow } from "./ui";
export function TaskPreferencesScreen() {
  const resources = useTaskResources();
  if (!resources.settings.data)
    return (
      <State
        loading={resources.settings.isPending}
        retry={resources.settings.isError ? () => void resources.settings.refetch() : undefined}
      />
    );
  return (
    <Preferences
      key={resources.settings.data.revision}
      initial={resources.settings.data}
      lists={(resources.lists.data ?? [])
        .filter((row) => row.availability === "active")
        .map((row) => ({ value: row.id, label: row.name }))}
    />
  );
}
function Preferences({
  initial,
  lists,
}: {
  initial: WorkspaceSettings<"tasks">;
  lists: { value: string; label: string }[];
}) {
  const api = useTaskApi();
  const action = useTaskAction();
  const [draft, setDraft] = useState(initial.preferences);
  const update = <K extends keyof TasksWorkspacePreferences>(
    key: K,
    value: TasksWorkspacePreferences[K],
  ) => setDraft((current) => ({ ...current, [key]: value }));
  return (
    <>
      <Stack.Screen
        options={{
          title: "task preferences",
          headerRight: () => (
            <Action
              label="Save"
              disabled={action.pending}
              onPress={() =>
                void action.run("Saving preferences…", () =>
                  api.updateWorkspaceSettings("tasks", {
                    expectedRevision: initial.revision,
                    preferences: draft,
                  }),
                )
              }
            />
          ),
        }}
      />
      <FormBody>
        <NotificationSettings />
        <Section title="capture">
          <SearchableChoice
            entity="list"
            label="Default list"
            value={draft.defaultCaptureListId ?? ""}
            options={[{ value: "", label: "Inbox" }, ...lists]}
            onChange={(value) => update("defaultCaptureListId", value || null)}
          />
        </Section>
        <Section title="presentation">
          <Choice
            label="Sort"
            value={draft.taskSort}
            options={[
              "default",
              "date",
              "reserved",
              "priority",
              "newest",
              "oldest",
              "title",
              "estimate",
            ].map((value) => ({ value, label: value }))}
            onChange={(value) => update("taskSort", value as typeof draft.taskSort)}
          />
          <Choice
            label="Group"
            value={draft.taskGroup}
            options={["none", "date", "list", "project"].map((value) => ({ value, label: value }))}
            onChange={(value) => update("taskGroup", value as typeof draft.taskGroup)}
          />
          <Choice
            label="Container sort"
            value={draft.taskContainerSort}
            options={["updated", "name", "newest", "target"].map((value) => ({
              value,
              label: value,
            }))}
            onChange={(value) =>
              update("taskContainerSort", value as typeof draft.taskContainerSort)
            }
          />
          <ToggleRow
            label="Show completed tasks"
            value={draft.showCompletedTasks}
            onChange={(value) => update("showCompletedTasks", value)}
            disabled={action.pending}
          />
        </Section>
      </FormBody>
    </>
  );
}
