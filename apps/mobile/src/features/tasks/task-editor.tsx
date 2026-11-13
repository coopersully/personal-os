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
import { AppToaster } from "../../components/app-toaster";
import { editorActionsOptions, editorDismissOptions } from "../../components/editor-header";
import { Icon } from "../../components/icons";
import { useTheme } from "../../theme";
import { useAuth } from "../auth/context";
import { actWithUndo, type ItemAction, useTaskAction, useTaskApi, useTaskResources } from "./data";
import { DateField } from "./date-field";
import { FormSave } from "./form-save";
import { useDraftField } from "./form-state";
import { loadTrashedRecord } from "./logic";
import { RecordIdentity } from "./record-identity";
import { SearchableChoice } from "./searchable-choice";
import { TagsField } from "./tags-field";
import { Action, Choice, confirm, Field, FormBody, Section, State } from "./ui";

type TaskEditorParams = {
  id?: string;
  kind?: string;
  listId?: string;
  projectId?: string;
  readOnly?: string;
  deleted?: string;
};
export function TaskEditorScreen() {
  const params = useLocalSearchParams<TaskEditorParams>();
  return <TaskEditorRecord key={`${params.kind}:${params.id}:${params.deleted}`} params={params} />;
}
function TaskEditorRecord({ params }: { params: TaskEditorParams }) {
  const api = useTaskApi();
  const kind = params.kind === "reminder" ? "reminder" : "task";
  const recordIdentity = `${kind}:${params.id ?? "new"}`;
  const [openedRecord, setOpenedRecord] = useState<string | null>(null);
  const record = useQuery({
    queryKey: ["tasks", "detail", kind, params.id, params.deleted],
    enabled: !!params.id,
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async () => {
      if (params.deleted === "1") return loadTrashedRecord(api, kind, params.id as string);
      return kind === "task"
        ? api.getTask(params.id as string)
        : api.getReminder(params.id as string);
    },
  });
  useEffect(() => {
    if (record.isFetchedAfterMount && record.isSuccess) setOpenedRecord(recordIdentity);
  }, [record.isFetchedAfterMount, record.isSuccess, recordIdentity]);
  if (params.id && (openedRecord !== recordIdentity || !record.data))
    return (
      <>
        <Stack.Screen
          options={{
            title: `${kind} details`,
            ...editorActionsOptions("Record actions", []),
            ...editorDismissOptions({ label: "Close", onPress: () => router.back() }),
          }}
        />
        <State
          loading={record.isPending || record.isFetching}
          retry={record.isError ? () => void record.refetch() : undefined}
        />
        <AppToaster editor />
      </>
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
  const [edited, setEdited] = useState(false);
  const markEdited = () => setEdited(true);
  const [title, setTitle] = useDraftField(initial?.title ?? "", markEdited);
  const [notes, setNotes] = useDraftField(initial?.notes ?? "", markEdited);
  const [priority, setPriority] = useDraftField(initial?.priority ?? "medium", markEdited);
  const [dueAt, setDueAt] = useDraftField(initial?.dueAt ?? null, markEdited);
  const [scheduledAt, setScheduledAt] = useDraftField(task?.scheduledAt ?? null, markEdited);
  const [why, setWhy] = useDraftField(task?.why ?? "", markEdited);
  const [estimate, setEstimate] = useDraftField(
    task?.estimateMinutes?.toString() ?? "",
    markEdited,
  );
  const [tags, setTags] = useDraftField<string[]>(task?.tags ?? [], markEdited);
  const { state: authState } = useAuth();
  const timezone = authState.user?.planningTimezone;
  const [listId, setListId, initializeListId] = useDraftField(
    task?.listId ?? params.listId ?? "",
    markEdited,
  );
  const [projectId, setProjectId] = useDraftField(
    task?.projectId ?? params.projectId ?? "",
    markEdited,
  );
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
    initializeListId(project?.listId ?? list?.id ?? "");
  }, [
    listId,
    projectId,
    resources.lists.data,
    resources.projects.data,
    resources.settings.data,
    initializeListId,
  ]);
  const fields = () => ({
    title,
    notes: notes.trim() || null,
    priority,
    dueAt,
    timezone: dueAt || scheduledAt ? timezone : null,
  });
  const taskFields = () => ({
    ...fields(),
    scheduledAt,
    why: why.trim() || null,
    estimateMinutes: estimate.trim() ? Number(estimate) : null,
    tags,
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
        if (!timezone)
          throw new Error("Your account time zone is unavailable. Reopen nohmi to refresh it.");
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
      (result) => ({ message: result ? "Saved" : "Review the move before saving" }),
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
      void action.run(
        "Updating…",
        () => actWithUndo(api, item, operation),
        finish,
        handleError,
        () => ({
          message:
            operation === "trash"
              ? "Moved to Trash"
              : operation === "complete"
                ? "Completed"
                : operation === "cancel"
                  ? "Task cancelled"
                  : "Updated",
        }),
        (result) => result.undo(),
      );
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
          ...editorDismissOptions({
            label: edited ? "Cancel" : "Close",
            disabled: action.pending,
            onPress: () =>
              edited
                ? confirm("Discard changes?", "Unsaved edits will be lost.", finish)
                : finish(),
          }),
          ...editorActionsOptions(
            "Record actions",
            !persisted
              ? []
              : deleted
                ? [
                    {
                      id: "restore",
                      label: "Restore",
                      icon: "history",
                      disabled: action.pending || readOnly || conflict,
                      onPress: () => transition("restore"),
                    },
                  ]
                : [
                    {
                      id: "complete",
                      label: (task ? task.lifecycle !== "open" : !!persisted.completedAt)
                        ? "Reopen"
                        : "Complete",
                      icon: "check",
                      disabled: action.pending || readOnly || conflict,
                      onPress: () =>
                        transition(
                          (task ? task.lifecycle !== "open" : !!persisted.completedAt)
                            ? "reopen"
                            : "complete",
                        ),
                    },
                    ...(task?.lifecycle === "open"
                      ? [
                          {
                            id: "cancel",
                            destructive: true,
                            label: "Cancel task",
                            icon: "cancel" as const,
                            disabled: action.pending || readOnly || conflict,
                            onPress: () => transition("cancel"),
                          },
                        ]
                      : []),
                    {
                      id: "trash",
                      label: "Move to Trash",
                      icon: "trash",
                      destructive: true,
                      disabled: action.pending || readOnly || conflict,
                      onPress: () => transition("trash"),
                    },
                  ],
          ),
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
        <View pointerEvents={writable && !action.pending && !uncertain ? "auto" : "none"}>
          <RecordIdentity
            icon={<Icon name={kind === "task" ? "check" : "clock"} color={t.ink} size={28} />}
            title={title}
            onTitleChange={setTitle}
            description={notes}
            onDescriptionChange={setNotes}
            placeholder={kind === "task" ? "Plan meals for the week" : "Water the balcony plants"}
            descriptionPlaceholder={
              kind === "task"
                ? "Choose three dinners and make a grocery list."
                : "Check the soil and water each pot if it feels dry."
            }
          />
          <Section title="Due & priority">
            <DateField due label="Due date" value={dueAt} onChange={setDueAt} />
            <Choice
              label="Priority"
              value={priority}
              options={[
                { value: "low", label: "Low" },
                { value: "medium", label: "Medium" },
                { value: "high", label: "High" },
              ]}
              onChange={(value) => setPriority(value as typeof priority)}
            />
          </Section>
          {kind === "task" && (
            <Section title="Schedule & effort">
              <DateField label="Reserved time" value={scheduledAt} onChange={setScheduledAt} />
              <Field
                label="Estimate (minutes)"
                value={estimate}
                onChangeText={setEstimate}
                keyboardType="number-pad"
                placeholder="30"
              />
            </Section>
          )}
          {kind === "task" && (
            <Section title="Organization">
              <SearchableChoice
                entity="list"
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

              <SearchableChoice
                entity="project"
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
              <TagsField value={tags} onChange={setTags} />
              <Field
                label="Why it matters"
                placeholder="Make weeknight dinners less stressful"
                value={why}
                onChangeText={setWhy}
                multiline
                maxLength={10000}
              />
            </Section>
          )}
          {!persisted && (
            <Section>
              <Choice
                label="Item type"
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
      </FormBody>
      {writable && (
        <FormSave
          disabled={
            !edited ||
            action.pending ||
            conflict ||
            (uncertain && kind === "reminder") ||
            !title.trim() ||
            (kind === "task" && !listId)
          }
          onPress={save}
        />
      )}
      <AppToaster editor />
    </View>
  );
}
