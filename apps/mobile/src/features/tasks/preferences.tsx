import type { TasksWorkspacePreferences, WorkspaceSettings } from "@personal-os/domain";
import { router, Stack } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import { editorDismissOptions } from "../../components/editor-header";
import { FormSave } from "../../components/forms/form-save";
import { useTheme } from "../../theme";
import { useAuth } from "../auth/context";
import { NotificationSettings } from "../notifications/provider";
import { useTaskAction, useTaskApi, useTaskResources } from "./data";
import { listOption } from "./list-presentation";
import { SearchableChoice } from "./searchable-choice";
import { Action, Choice, confirm, FormBody, Section, State, ToggleRow } from "./ui";
export function TaskPreferencesScreen() {
  const { state, session } = useAuth();
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
      key={`${state.user?.id}:${session.epoch()}`}
      initial={resources.settings.data}
      lists={(resources.lists.data ?? [])
        .filter((row) => row.availability === "active")
        .map(listOption)}
    />
  );
}
function Preferences({
  initial: opened,
  lists,
}: {
  initial: WorkspaceSettings<"tasks">;
  lists: { value: string; label: string }[];
}) {
  const t = useTheme();
  const api = useTaskApi();
  const action = useTaskAction();
  const [initial, setInitial] = useState(opened);
  const [edited, setEdited] = useState(false);
  const [needsReview, setNeedsReview] = useState(false);
  const [draft, setDraft] = useState(initial.preferences);
  const update = <K extends keyof TasksWorkspacePreferences>(
    key: K,
    value: TasksWorkspacePreferences[K],
  ) => {
    if (action.pending) return;
    setEdited(true);
    setDraft((current) => ({ ...current, [key]: value }));
  };
  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          title: "task preferences",
          gestureEnabled: false,
          ...editorDismissOptions({
            label: edited ? "Cancel" : "Close",
            disabled: action.pending,
            onPress: () =>
              edited
                ? confirm("Discard changes?", "Unsaved preferences will be lost.", () =>
                    router.back(),
                  )
                : router.back(),
          }),
          headerRight: () => null,
        }}
      />
      <FormBody>
        <NotificationSettings />
        <Section title="capture">
          <SearchableChoice
            entity="list"
            disabled={action.pending}
            label="Default list"
            value={draft.defaultCaptureListId ?? ""}
            options={[{ value: "", label: "Inbox" }, ...lists]}
            onChange={(value) => update("defaultCaptureListId", value || null)}
          />
        </Section>
        <Section title="presentation">
          <Choice
            label="Sort"
            disabled={action.pending}
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
            ].map((value) => ({
              value,
              label:
                (
                  {
                    default: "Recommended",
                    date: "Due date",
                    reserved: "Reserved time",
                    priority: "Priority",
                    newest: "Newest first",
                    oldest: "Oldest first",
                    title: "Title (A–Z)",
                    estimate: "Estimated duration",
                    none: "None",
                    list: "List",
                    project: "Project",
                  } as Record<string, string>
                )[value] ?? value,
            }))}
            onChange={(value) => update("taskSort", value as typeof draft.taskSort)}
          />
          <Choice
            label="Group"
            disabled={action.pending}
            value={draft.taskGroup}
            options={["none", "date", "list", "project"].map((value) => ({
              value,
              label:
                (
                  {
                    default: "Recommended",
                    date: "Due date",
                    reserved: "Reserved time",
                    priority: "Priority",
                    newest: "Newest first",
                    oldest: "Oldest first",
                    title: "Title (A–Z)",
                    estimate: "Estimated duration",
                    none: "None",
                    list: "List",
                    project: "Project",
                  } as Record<string, string>
                )[value] ?? value,
            }))}
            onChange={(value) => update("taskGroup", value as typeof draft.taskGroup)}
          />
          <Choice
            label="Container sort"
            disabled={action.pending}
            value={draft.taskContainerSort}
            options={["updated", "name", "newest", "target"].map((value) => ({
              value,
              label: (
                {
                  updated: "Recently updated",
                  name: "Name (A–Z)",
                  newest: "Newest first",
                  target: "Target date",
                } as Record<string, string>
              )[value],
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
        <Section title="Task row details">
          <Text style={{ color: t.secondary, padding: 16 }}>
            These row-detail preferences configure the web app.
          </Text>
          {(["estimate", "tags", "notes"] as const).map((detail) => (
            <ToggleRow
              key={detail}
              label={
                detail === "estimate"
                  ? "Show estimate"
                  : detail === "tags"
                    ? "Show tags"
                    : "Show notes"
              }
              value={draft.taskRowDetails.includes(detail)}
              disabled={action.pending}
              onChange={(enabled) =>
                update(
                  "taskRowDetails",
                  enabled
                    ? [...draft.taskRowDetails, detail]
                    : draft.taskRowDetails.filter((value) => value !== detail),
                )
              }
            />
          ))}
        </Section>
        <Section title="Search">
          <ToggleRow
            label="Include archived in search"
            value={draft.includeArchivedInSearch}
            disabled={action.pending}
            onChange={(value) => update("includeArchivedInSearch", value)}
          />
        </Section>
        {needsReview && (
          <Action
            label="Load latest preferences"
            disabled={action.pending}
            onPress={() =>
              void action.run(
                "Loading preferences…",
                () => api.getWorkspaceSettings("tasks"),
                (latest) => {
                  if (latest.revision < initial.revision)
                    throw new Error("The loaded preferences are older than your reviewed version.");
                  const changes = Object.entries(draft).filter(
                    ([key, value]) =>
                      JSON.stringify(value) !==
                      JSON.stringify(initial.preferences[key as keyof TasksWorkspacePreferences]),
                  );
                  const retained = { ...latest.preferences, ...Object.fromEntries(changes) };
                  const labels: Record<string, string> = {
                    defaultCaptureListId: "Default list",
                    taskSort: "Sort",
                    taskGroup: "Group",
                    taskContainerSort: "Container sort",
                    showCompletedTasks: "Show completed tasks",
                    taskRowDetails: "Row details",
                    includeArchivedInSearch: "Include archived in search",
                  };
                  const display = (key: string, value: unknown): string => {
                    if (key === "defaultCaptureListId")
                      return value
                        ? (lists.find((list) => list.value === value)?.label ?? "Unavailable list")
                        : "Inbox";
                    if (typeof value === "boolean") return value ? "On" : "Off";
                    if (Array.isArray(value)) return value.join(", ") || "None";
                    return String(value ?? "None").replaceAll("_", " ");
                  };
                  const summary = changes
                    .map(
                      ([key, value]) =>
                        `${labels[key] ?? key}: saved ${display(key, latest.preferences[key as keyof TasksWorkspacePreferences])}; your draft ${display(key, value)}`,
                    )
                    .join("\n");
                  confirm(
                    "Review latest preferences",
                    `${summary || "Your draft has no changes."}\n\nKeep your edits with the latest saved preferences? Review the result, then save separately.`,
                    () => {
                      setInitial(latest);
                      setDraft(retained);
                      setEdited(JSON.stringify(retained) !== JSON.stringify(latest.preferences));
                      setNeedsReview(false);
                    },
                  );
                },
                undefined,
                () => ({ message: "Latest preferences loaded for review" }),
              )
            }
          />
        )}
      </FormBody>
      <FormSave
        disabled={!edited || action.pending || needsReview}
        onPress={() =>
          void action.run(
            "Saving preferences…",
            () =>
              api.updateWorkspaceSettings("tasks", {
                expectedRevision: initial.revision,
                preferences: draft,
              }),
            () => router.back(),
            () => setNeedsReview(true),
          )
        }
      />
    </View>
  );
}
