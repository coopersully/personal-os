import { ApiClientError } from "@personal-os/api-client";
import {
  createReminderInputSchema,
  createTaskInputSchema,
  type Reminder,
  type Task,
  type TaskMovePreview,
  type TaskWorkspaceItem,
} from "@personal-os/domain";
import { useQuery } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { Toaster } from "sonner-native";
import { useTheme } from "../../theme";
import { actOnItem, type ItemAction, useTaskAction, useTaskApi, useTaskResources } from "./data";
import { DateField } from "./date-field";
import { Action, Choice, confirm, Field, FormBody, Section, State, styles } from "./ui";

export function TaskEditorScreen() {
  const params = useLocalSearchParams<{
    id?: string;
    kind?: string;
    listId?: string;
    projectId?: string;
    readOnly?: string;
    deleted?: string;
  }>();
  const api = useTaskApi();
  const kind = params.kind === "reminder" ? "reminder" : "task";
  const record = useQuery({
    queryKey: ["tasks", "detail", kind, params.id],
    enabled: !!params.id,
    queryFn: () =>
      kind === "task" ? api.getTask(params.id as string) : api.getReminder(params.id as string),
  });
  if (params.id && !record.data)
    return (
      <State
        loading={record.isPending}
        retry={record.isError ? () => void record.refetch() : undefined}
      />
    );
  return (
    <TaskEditor
      key={`${kind}:${params.id ?? "new"}`}
      kind={kind}
      initial={record.data}
      params={params}
      refresh={() => void record.refetch()}
    />
  );
}
function TaskEditor({
  kind,
  initial,
  params,
  refresh,
}: {
  kind: "task" | "reminder";
  initial?: Task | Reminder;
  params: { listId?: string; projectId?: string; readOnly?: string; deleted?: string };
  refresh: () => void;
}) {
  const api = useTaskApi();
  const t = useTheme();
  const resources = useTaskResources();
  const action = useTaskAction();
  const [persisted, setPersisted] = useState(initial);
  const task = kind === "task" ? (persisted as Task | undefined) : undefined;
  const [title, setTitle] = useState(initial?.title ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [priority, setPriority] = useState(initial?.priority ?? "medium");
  const [dueAt, setDueAt] = useState(initial?.dueAt ?? null);
  const [scheduledAt, setScheduledAt] = useState(task?.scheduledAt ?? null);
  const [why, setWhy] = useState(task?.why ?? "");
  const [estimate, setEstimate] = useState(task?.estimateMinutes?.toString() ?? "");
  const [tags, setTags] = useState(task?.tags.join(", ") ?? "");
  const [timezone, setTimezone] = useState(
    initial?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const [listId, setListId] = useState(task?.listId ?? params.listId ?? "");
  const [projectId, setProjectId] = useState(task?.projectId ?? params.projectId ?? "");
  const [uncertain, setUncertain] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [move, setMove] = useState<TaskMovePreview | null>(null);
  const [mutationId] = useState(randomUUID);
  const frozen = useRef<ReturnType<typeof createTaskInputSchema.parse> | null>(null);
  const deleted = params.deleted === "1" || !!task?.deletedAt;
  const ownerList = task && resources.lists.data?.find((row) => row.id === task.listId);
  const ownerProject = task?.projectId
    ? resources.projects.data?.find((row) => row.id === task.projectId)
    : undefined;
  const readOnly =
    params.readOnly === "1" ||
    (!!task &&
      !deleted &&
      (ownerList?.availability !== "active" ||
        !!ownerList.deletedAt ||
        (!!task.projectId &&
          (ownerProject?.availability !== "active" ||
            ownerProject.lifecycle !== "open" ||
            !!ownerProject.deletedAt))));
  const writable = !readOnly && !deleted;
  useEffect(() => {
    if (listId || !resources.lists.data || !resources.settings.data) return;
    const project = resources.projects.data?.find((row) => row.id === projectId);
    const preferred = resources.settings.data.preferences.defaultCaptureListId;
    const list =
      resources.lists.data.find((row) => row.id === preferred && row.availability === "active") ??
      resources.lists.data.find((row) => row.kind === "inbox");
    setListId(project?.listId ?? list?.id ?? "");
  }, [listId, projectId, resources.lists.data, resources.projects.data, resources.settings.data]);
  const fields = () => ({
    title,
    notes: notes.trim() || null,
    priority,
    dueAt,
    timezone: timezone.trim() || null,
  });
  const taskFields = () => ({
    ...fields(),
    scheduledAt,
    why: why.trim() || null,
    estimateMinutes: estimate.trim() ? Number(estimate) : null,
    tags: tags
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  });
  const handleError = (error: unknown) => {
    if (error instanceof ApiClientError && error.status === 409) setConflict(true);
    if (
      !persisted &&
      (!(error instanceof ApiClientError) || error.status >= 500) &&
      !(error instanceof Error && error.name === "ZodError")
    )
      setUncertain(true);
  };
  const finish = () => router.back();
  const save = () =>
    void action.run(
      "Saving…",
      async () => {
        if (kind === "reminder") {
          const values = createReminderInputSchema.parse(fields());
          return persisted
            ? api.updateReminder(persisted.id, {
                ...values,
                expectedUpdatedAt: persisted.updatedAt,
              })
            : api.createReminder(values);
        }
        const values = createTaskInputSchema.parse({
          ...taskFields(),
          listId: listId || undefined,
          projectId: projectId || undefined,
          lifecycle: "open",
          idempotencyKey: mutationId,
        });
        if (!task) {
          if (!uncertain) frozen.current = values;
          return api.createTask(frozen.current ?? values);
        }
        const {
          listId: _list,
          projectId: _project,
          lifecycle: _lifecycle,
          idempotencyKey: _key,
          ...content
        } = values;
        if (task.listId !== listId || (task.projectId ?? "") !== projectId) {
          const preview = await api.previewTaskMove(task.id, {
            destinationListId: listId,
            destinationProjectId: projectId || null,
            expectedRevision: task.revision,
          });
          setMove(preview);
          return null;
        }
        return api.updateTask(task.id, { ...content, expectedRevision: task.revision });
      },
      (result) => {
        if (result) finish();
      },
      handleError,
    );
  const commitMove = () =>
    void action.run(
      "Moving task…",
      async () => {
        if (!task || !move) throw new Error("Refresh the move preview.");
        const moved = await api.moveTask(task.id, {
          destinationListId: move.destinationListId,
          destinationProjectId: move.destinationProjectId,
          expectedRevision: task.revision,
          previewToken: move.previewToken,
        });
        setPersisted(moved);
        setMove(null);
        const parsed = createTaskInputSchema.parse({ ...taskFields(), lifecycle: "open" });
        const {
          lifecycle: _life,
          idempotencyKey: _key,
          listId: _list,
          projectId: _project,
          ...content
        } = parsed;
        return api.updateTask(moved.id, { ...content, expectedRevision: moved.revision });
      },
      finish,
      handleError,
    );
  const transition = (operation: ItemAction) => {
    if (!persisted) return;
    const item = {
      kind,
      record: persisted,
      deletedAt: deleted ? persisted.updatedAt : null,
      readOnly,
      relevantAt: persisted.dueAt,
      groupKey: "none",
    } as TaskWorkspaceItem;
    const run = () =>
      void action.run("Updating…", () => actOnItem(api, item, operation), finish, handleError);
    if (operation === "trash" || operation === "cancel")
      confirm(
        operation === "trash" ? "Move to Trash?" : "Cancel task?",
        operation === "trash"
          ? "You can restore this item from Trash."
          : "You can reopen it from History.",
        run,
        true,
      );
    else run();
  };
  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          title: persisted ? `${kind} details` : `new ${kind}`,
          gestureEnabled: false,
          headerLeft: () => (
            <Action
              label="Cancel"
              disabled={action.pending}
              onPress={() => confirm("Discard changes?", "Unsaved edits will be lost.", finish)}
            />
          ),
          headerRight: () =>
            writable ? (
              <Action
                label="Save"
                disabled={
                  action.pending ||
                  conflict ||
                  (uncertain && kind === "reminder") ||
                  !title.trim() ||
                  (kind === "task" && !listId)
                }
                onPress={save}
              />
            ) : null,
        }}
      />
      <FormBody>
        {(resources.lists.isError || resources.projects.isError || resources.settings.isError) && (
          <Action
            label="Retry task organization"
            onPress={() => {
              void resources.lists.refetch();
              void resources.projects.refetch();
              void resources.settings.refetch();
            }}
          />
        )}
        {!persisted && (
          <Section>
            <Choice
              label="Create"
              value={kind}
              options={[
                { value: "task", label: "Task" },
                { value: "reminder", label: "Reminder" },
              ]}
              disabled={action.pending || uncertain}
              onChange={(value) =>
                confirm("Change item type?", "The current draft will be discarded.", () =>
                  router.replace({ pathname: "/task-editor", params: { kind: value } }),
                )
              }
            />
          </Section>
        )}
        <View pointerEvents={writable && !action.pending && !uncertain ? "auto" : "none"}>
          <Section>
            <Field
              label="Title"
              value={title}
              onChangeText={setTitle}
              maxLength={240}
              placeholder="What needs doing?"
            />
            <Field
              label="Notes"
              value={notes}
              onChangeText={setNotes}
              multiline
              maxLength={10000}
              placeholder="Add details"
            />
          </Section>
          <Section title="planning">
            <DateField label="Due" value={dueAt} onChange={setDueAt} />
            {kind === "task" && (
              <DateField label="Reserved time" value={scheduledAt} onChange={setScheduledAt} />
            )}
            <Field
              label="Time zone"
              value={timezone}
              onChangeText={setTimezone}
              autoCapitalize="none"
            />
            <Choice
              label="Priority"
              value={priority}
              options={["low", "medium", "high"].map((value) => ({ value, label: value }))}
              onChange={(value) => setPriority(value as typeof priority)}
            />
            {kind === "task" && (
              <Field
                label="Estimate (minutes)"
                value={estimate}
                onChangeText={setEstimate}
                keyboardType="number-pad"
                placeholder="None"
              />
            )}
          </Section>
          {kind === "task" && (
            <>
              <Section title="organization">
                <Choice
                  label="List"
                  value={listId}
                  options={(resources.lists.data ?? [])
                    .filter((row) => !row.deletedAt && row.availability === "active")
                    .map((row) => ({ value: row.id, label: row.name }))}
                  onChange={(value) => {
                    setListId(value);
                    setProjectId("");
                  }}
                />
                <Choice
                  label="Project"
                  value={projectId}
                  options={[
                    { value: "", label: "None" },
                    ...(resources.projects.data ?? [])
                      .filter(
                        (row) =>
                          row.listId === listId &&
                          row.availability === "active" &&
                          row.lifecycle === "open" &&
                          !row.deletedAt,
                      )
                      .map((row) => ({ value: row.id, label: row.name })),
                  ]}
                  onChange={setProjectId}
                />
                <Field label="Tags (comma separated)" value={tags} onChangeText={setTags} />
              </Section>
              <Section>
                <Field
                  label="Why it matters"
                  value={why}
                  onChangeText={setWhy}
                  multiline
                  maxLength={10000}
                />
              </Section>
            </>
          )}
        </View>
        {resources.lists.isError && kind === "task" && (
          <Action label="Retry lists" onPress={() => void resources.lists.refetch()} />
        )}
        {resources.projects.isError && kind === "task" && (
          <Action label="Retry projects" onPress={() => void resources.projects.refetch()} />
        )}
        {uncertain && (
          <Section title="recovery">
            <Action
              label={
                kind === "task"
                  ? "Retry the same task creation"
                  : "Review reminders before creating again"
              }
              disabled={action.pending}
              onPress={
                kind === "task"
                  ? save
                  : () =>
                      router.replace({
                        pathname: "/task-browser",
                        params: { kind: "reminder", view: "all", title: "reminders" },
                      })
              }
            />
          </Section>
        )}
        {conflict && (
          <Action
            label="Reload current record (discard draft)"
            onPress={() =>
              confirm("Reload current record?", "Your draft will be discarded.", () => {
                refresh();
                finish();
              })
            }
          />
        )}
        {move && (
          <Section title="move preview">
            <Text style={{ color: t.ink, padding: 12 }}>
              {move.detachedProjectId
                ? "This move detaches the task from its current project."
                : "Move this task to the chosen list and project?"}
            </Text>
            <Action label="Confirm move and save" disabled={action.pending} onPress={commitMove} />
            <Action label="Cancel move" onPress={() => setMove(null)} />
          </Section>
        )}
        {persisted && (
          <Section title={readOnly ? "read-only container" : "actions"}>
            {deleted ? (
              <Action
                label="Restore"
                disabled={action.pending || readOnly}
                onPress={() => transition("restore")}
              />
            ) : (
              <View style={styles.toolbar}>
                <Action
                  label={
                    task
                      ? task.lifecycle === "open"
                        ? "Complete"
                        : "Reopen"
                      : persisted.completedAt
                        ? "Reopen"
                        : "Complete"
                  }
                  disabled={action.pending || readOnly}
                  onPress={() =>
                    transition(
                      task
                        ? task.lifecycle === "open"
                          ? "complete"
                          : "reopen"
                        : persisted.completedAt
                          ? "reopen"
                          : "complete",
                    )
                  }
                />
                {task?.lifecycle === "open" && (
                  <Action
                    label="Cancel task"
                    disabled={action.pending || readOnly}
                    onPress={() => transition("cancel")}
                  />
                )}
                <Action
                  label="Move to Trash"
                  destructive
                  disabled={action.pending || readOnly}
                  onPress={() => transition("trash")}
                />
              </View>
            )}
          </Section>
        )}
      </FormBody>
      <Toaster />
    </View>
  );
}
