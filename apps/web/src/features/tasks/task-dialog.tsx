import type { Task, TaskMovePreview, User } from "@personal-os/domain";
import { localDateTimeToUtc, parseLocalDate } from "@personal-os/domain";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { api } from "../../api.js";
import { InlineError } from "../../components/async-state.js";
import { FeedbackForm } from "../../components/feedback-form.js";
import { MutationFeedback } from "../../components/mutation-feedback.js";
import { invalidateMaterial } from "../../lib/material-queries.js";
import { useFeedbackMutation } from "../../lib/use-feedback-mutation.js";
import { useWorkspacePreferences } from "../workspace-settings/preferences";
import { taskCaptureList } from "./capture-default";
import { TaskCreationProgress } from "./creation-progress";
import { listAllTaskLists, listAllTaskProjects } from "./page.js";

type TaskFields = {
  dueAt: string | null;
  estimateMinutes: number | null;
  notes: string | null;
  priority: "high" | "low" | "medium";
  scheduledAt: string | null;
  tags: string[];
  timezone: string | null;
  title: string;
  why: string | null;
};

type PendingMove = {
  fields: TaskFields;
  preview: TaskMovePreview;
};

export function TaskDialog({
  placement,
  close,
  task,
  user,
}: {
  close: () => void;
  task: Task | undefined;
  placement?: { listId: string; projectId: string | null } | undefined;
  user: User;
}) {
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const preferences = useWorkspacePreferences("tasks");
  const lists = useQuery({ queryFn: listAllTaskLists, queryKey: ["task-lists"] });
  const projects = useQuery({
    queryFn: listAllTaskProjects,
    queryKey: ["task-projects"],
  });
  const requestedProjectId = placement
    ? (placement.projectId ?? "")
    : (searchParams.get("project") ?? "");
  const [currentTask, setCurrentTask] = useState(task);
  const [listId, setListId] = useState(task?.listId ?? placement?.listId ?? "");
  const [projectId, setProjectId] = useState(task?.projectId ?? placement?.projectId ?? "");
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
  const unscoped = !task && !placement && !searchParams.has("list") && !searchParams.has("project");
  const captureList = taskCaptureList(
    lists.data?.items ?? [],
    unscoped ? preferences.data?.preferences.defaultCaptureListId : null,
  );
  const activeLists = lists.data?.items.filter((list) => list.availability === "active") ?? [];
  const requestedProject = projects.data?.items.find(
    (project) =>
      project.id === requestedProjectId &&
      project.availability === "active" &&
      project.lifecycle === "open" &&
      activeLists.some((list) => list.id === project.listId),
  );
  const requestedList = lists.data?.items.find(
    (list) => list.id === searchParams.get("list") && list.availability === "active",
  );

  useEffect(() => {
    if (listId || (unscoped && preferences.isPending) || (requestedProjectId && projects.isPending))
      return;
    setListId(requestedProject?.listId ?? requestedList?.id ?? captureList?.id ?? "");
  }, [
    captureList?.id,
    listId,
    preferences.isPending,
    projects.isPending,
    requestedList?.id,
    requestedProject?.listId,
    requestedProjectId,
    unscoped,
  ]);
  useEffect(() => {
    if (!task && requestedProject && !projectId) setProjectId(requestedProject.id);
  }, [projectId, requestedProject, task]);

  const availableProjects =
    projects.data?.items.filter(
      (project) =>
        project.availability === "active" &&
        project.lifecycle === "open" &&
        project.listId === listId,
    ) ?? [];

  const finish = async (message: string) => {
    toast.success(message);
    await invalidateMaterial(queryClient);
    close();
  };

  const save = useFeedbackMutation({
    feedback: { action: "save this task", safeToRetry: false, form: true },
    mutationFn: async ({ fields }: { fields: TaskFields }) => {
      if (!task) {
        return api.createTask({
          ...fields,
          lifecycle: "open",
          ...(listId ? { listId } : {}),
          ...(projectId ? { projectId } : {}),
        });
      }
      const persistedTask = currentTask ?? task;
      const moved =
        persistedTask.listId !== listId || (persistedTask.projectId ?? "") !== projectId;
      if (!moved) {
        return api.updateTask(task.id, {
          ...fields,
          expectedRevision: persistedTask.revision,
        });
      }
      const preview = await api.previewTaskMove(task.id, {
        destinationListId: listId,
        destinationProjectId: projectId || null,
        expectedRevision: persistedTask.revision,
      });
      if (preview.detachedProjectId) {
        setPendingMove({ fields, preview });
        return null;
      }
      const movedTask = await api.moveTask(task.id, {
        destinationListId: listId,
        destinationProjectId: projectId || null,
        expectedRevision: persistedTask.revision,
        previewToken: preview.previewToken,
      });
      setCurrentTask(movedTask);
      return api.updateTask(task.id, { ...fields, expectedRevision: movedTask.revision });
    },
    onError: async (_error) => {
      await invalidateMaterial(queryClient);
    },
    onSuccess: async (result) => {
      if (result) await finish(task ? "Task updated." : "Task created.");
    },
  });

  const confirmMove = useFeedbackMutation({
    feedback: { action: "move and save this task", safeToRetry: false, form: true },
    mutationFn: async () => {
      if (!task || !pendingMove) throw new Error("The Task move preview is no longer available.");
      const movedTask = await api.moveTask(task.id, {
        destinationListId: pendingMove.preview.destinationListId,
        destinationProjectId: pendingMove.preview.destinationProjectId,
        expectedRevision: pendingMove.preview.taskRevision,
        previewToken: pendingMove.preview.previewToken,
      });
      setCurrentTask(movedTask);
      setListId(movedTask.listId);
      setProjectId(movedTask.projectId ?? "");
      setPendingMove(null);
      return api.updateTask(task.id, {
        ...pendingMove.fields,
        expectedRevision: movedTask.revision,
      });
    },
    onError: async (_error) => {
      await invalidateMaterial(queryClient);
    },
    onSuccess: () => finish("Task moved and updated."),
  });

  const transition = useFeedbackMutation({
    feedback: { action: "update this task", safeToRetry: false, form: false },
    mutationFn: async (action: "cancel" | "complete" | "reopen" | "restore" | "trash") => {
      const persistedTask = currentTask ?? task;
      if (!persistedTask) throw new Error("Save the Task before changing its lifecycle.");
      const input = { expectedRevision: persistedTask.revision };
      if (action === "complete") return api.completeTask(persistedTask.id, input);
      if (action === "cancel") return api.cancelTask(persistedTask.id, input);
      if (action === "restore") return api.restoreTask(persistedTask.id, input);
      if (action === "trash") return api.trashTask(persistedTask.id, input);
      return api.reopenTask(persistedTask.id, input);
    },
    onSuccess: (_result, action) => finish(taskActionResult(action)),
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const dueAt = String(form.get("dueAt") ?? "");
    const scheduledAt = String(form.get("scheduledAt") ?? "");
    const estimate = String(form.get("estimateMinutes") ?? "");
    save.mutate({
      fields: {
        dueAt: dueAt ? dateTimeLocalToIso(dueAt, user.planningTimezone) : null,
        estimateMinutes: estimate ? Number(estimate) : null,
        notes: nullable(form.get("notes")),
        priority: String(form.get("priority")) as TaskFields["priority"],
        scheduledAt: scheduledAt ? dateTimeLocalToIso(scheduledAt, user.planningTimezone) : null,
        tags: String(form.get("tags") ?? "")
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        timezone: dueAt || scheduledAt ? user.planningTimezone : null,
        title: String(form.get("title") ?? ""),
        why: nullable(form.get("why")),
      },
    });
  };

  const pending = save.isPending || confirmMove.isPending || transition.isPending;
  const EditorRoot = task ? Sheet : ResponsiveDialog;
  const EditorContent = task ? SheetContent : ResponsiveDialogContent;
  const EditorHeader = task ? SheetHeader : ResponsiveDialogHeader;
  const EditorTitle = task ? SheetTitle : ResponsiveDialogTitle;
  const EditorDescription = task ? SheetDescription : ResponsiveDialogDescription;
  const EditorFooter = task ? SheetFooter : ResponsiveDialogFooter;
  return (
    <>
      <EditorRoot open={!pendingMove} onOpenChange={(open) => !open && !pendingMove && close()}>
        <EditorContent
          className={
            task
              ? "w-full overflow-y-auto sm:max-w-lg"
              : "max-sm:px-4 max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
          }
        >
          <EditorHeader>
            <EditorTitle>{task ? "Refine task" : "Capture a task"}</EditorTitle>
            <EditorDescription>
              Keep the commitment separate from its deadline and reserved time.
            </EditorDescription>
            {!task ? <TaskCreationProgress step={3} total={3} /> : null}
          </EditorHeader>
          <MutationFeedback feedback={transition.feedback} />
          {lists.isError ? (
            <div className="flex flex-col gap-3">
              <InlineError
                error={lists.error}
                retry={lists.refetch}
                stale={lists.data !== undefined}
              />
              <Button onClick={() => lists.refetch()} type="button" variant="outline">
                Retry Lists
              </Button>
            </div>
          ) : null}
          {projects.isError ? (
            <div className="flex flex-col gap-3">
              <InlineError
                error={projects.error}
                retry={projects.refetch}
                stale={projects.data !== undefined}
              />
              <Button onClick={() => projects.refetch()} type="button" variant="outline">
                Retry Projects
              </Button>
            </div>
          ) : null}
          <FeedbackForm
            feedback={save.feedback}
            className={task ? "px-4" : undefined}
            onSubmit={submit}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="task-title">Task</FieldLabel>
                <Input autoFocus defaultValue={task?.title} id="task-title" name="title" required />
              </Field>
              <FieldGroup className="grid gap-5 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="task-list">List</FieldLabel>
                  <NativeSelect
                    disabled={lists.isPending}
                    id="task-list"
                    name="listId"
                    onChange={(event) => {
                      setListId(event.target.value);
                      setProjectId("");
                    }}
                    required
                    value={listId}
                  >
                    <NativeSelectOption value="">Select a List</NativeSelectOption>
                    {activeLists.map((list) => (
                      <NativeSelectOption key={list.id} value={list.id}>
                        {list.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  {unscoped &&
                  lists.isSuccess &&
                  preferences.data?.preferences.defaultCaptureListId &&
                  captureList?.kind === "inbox" &&
                  captureList.id === listId &&
                  captureList.id !== preferences.data.preferences.defaultCaptureListId ? (
                    <FieldDescription>
                      Your default list is unavailable. This task will go to Inbox.
                    </FieldDescription>
                  ) : null}
                </Field>
                <Field>
                  <FieldLabel htmlFor="task-project">Project</FieldLabel>
                  <NativeSelect
                    disabled={!listId || projects.isPending}
                    id="task-project"
                    name="projectId"
                    onChange={(event) => setProjectId(event.target.value)}
                    value={projectId}
                  >
                    <NativeSelectOption value="">No Project</NativeSelectOption>
                    {availableProjects.map((project) => (
                      <NativeSelectOption key={project.id} value={project.id}>
                        {project.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
              </FieldGroup>
              <FieldGroup className="grid gap-5 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="task-due-at">Deadline</FieldLabel>
                  <Input
                    defaultValue={toDateTimeLocal(task?.dueAt, user.planningTimezone)}
                    id="task-due-at"
                    name="dueAt"
                    type="datetime-local"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="task-scheduled-at">Reserved time</FieldLabel>
                  <Input
                    defaultValue={toDateTimeLocal(task?.scheduledAt, user.planningTimezone)}
                    id="task-scheduled-at"
                    name="scheduledAt"
                    type="datetime-local"
                  />
                </Field>
              </FieldGroup>
              <details
                className="rounded-lg border border-border px-3 py-2"
                open={task ? true : undefined}
              >
                <summary className="cursor-pointer text-sm font-medium">More details</summary>
                <FieldGroup className="mt-4">
                  <Field>
                    <FieldLabel htmlFor="task-why">Why it matters</FieldLabel>
                    <Textarea defaultValue={task?.why ?? ""} id="task-why" name="why" rows={2} />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="task-notes">Notes</FieldLabel>
                    <Textarea
                      defaultValue={task?.notes ?? ""}
                      id="task-notes"
                      name="notes"
                      rows={3}
                    />
                  </Field>
                  <FieldGroup className="grid gap-5 sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="task-priority">Priority</FieldLabel>
                      <NativeSelect
                        defaultValue={task?.priority ?? "medium"}
                        id="task-priority"
                        name="priority"
                      >
                        <NativeSelectOption value="low">Low</NativeSelectOption>
                        <NativeSelectOption value="medium">Medium</NativeSelectOption>
                        <NativeSelectOption value="high">High</NativeSelectOption>
                      </NativeSelect>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="task-estimate">Estimate in minutes</FieldLabel>
                      <Input
                        defaultValue={task?.estimateMinutes ?? ""}
                        id="task-estimate"
                        max={24 * 60}
                        min={5}
                        name="estimateMinutes"
                        step={5}
                        type="number"
                      />
                    </Field>
                  </FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="task-tags">Tags</FieldLabel>
                    <Input
                      defaultValue={task?.tags.join(", ") ?? ""}
                      id="task-tags"
                      name="tags"
                      placeholder="Planning, home"
                    />
                    <FieldDescription>Separate tags with commas.</FieldDescription>
                  </Field>
                </FieldGroup>
              </details>
            </FieldGroup>
            <MutationFeedback feedback={confirmMove.feedback} />
            <EditorFooter className={task ? "mt-5 p-0" : "mt-5"}>
              <Button onClick={close} type="button" variant="outline">
                Cancel
              </Button>
              <Button
                disabled={pending || !listId || lists.isError || projects.isError}
                type="submit"
              >
                {save.isPending ? "Saving…" : task ? "Save changes" : "Create task"}
              </Button>
            </EditorFooter>
          </FeedbackForm>
          {task ? (
            <div className="flex flex-col gap-4 px-4 pb-4">
              <details className="rounded-lg border border-border px-3 py-2">
                <summary className="cursor-pointer text-sm font-medium">Record details</summary>
                <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <dt>Source</dt>
                  <dd>{task.source.provider}</dd>
                  <dt>Revision</dt>
                  <dd>{task.revision}</dd>
                  <dt>Created</dt>
                  <dd>{new Date(task.createdAt).toLocaleString()}</dd>
                  <dt>Updated</dt>
                  <dd>{new Date(task.updatedAt).toLocaleString()}</dd>
                </dl>
              </details>
              <fieldset aria-label="Task lifecycle actions" className="flex flex-wrap gap-2">
                {task.deletedAt ? (
                  <Button
                    disabled={pending}
                    onClick={() => transition.mutate("restore")}
                    variant="outline"
                  >
                    Restore task
                  </Button>
                ) : (
                  <>
                    {task.lifecycle === "open" ? (
                      <>
                        <Button disabled={pending} onClick={() => transition.mutate("complete")}>
                          Complete task
                        </Button>
                        <Button
                          disabled={pending}
                          onClick={() => transition.mutate("cancel")}
                          variant="outline"
                        >
                          Cancel task
                        </Button>
                      </>
                    ) : (
                      <Button
                        disabled={pending}
                        onClick={() => transition.mutate("reopen")}
                        variant="outline"
                      >
                        Reopen task
                      </Button>
                    )}
                    <Button
                      disabled={pending}
                      onClick={() => transition.mutate("trash")}
                      variant="destructive"
                    >
                      Move to Trash
                    </Button>
                  </>
                )}
              </fieldset>
            </div>
          ) : null}
        </EditorContent>
      </EditorRoot>

      {pendingMove ? (
        <Dialog open onOpenChange={(open) => !open && setPendingMove(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Move Task without its Project?</DialogTitle>
              <DialogDescription>
                This List change will detach the Task from its current Project. The Task will remain
                open in the selected List.
              </DialogDescription>
            </DialogHeader>
            <MutationFeedback feedback={confirmMove.feedback} />
            <DialogFooter>
              <Button
                onClick={() => {
                  const persistedTask = currentTask ?? task;
                  if (persistedTask) {
                    setListId(persistedTask.listId);
                    setProjectId(persistedTask.projectId ?? "");
                  }
                  setPendingMove(null);
                }}
                type="button"
                variant="outline"
              >
                Keep current placement
              </Button>
              <Button disabled={confirmMove.isPending} onClick={() => confirmMove.mutate()}>
                Move and detach Project
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

function nullable(value: FormDataEntryValue | null): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function toDateTimeLocal(value: string | null | undefined, timeZone: string) {
  if (!value) return "";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      day: "2-digit",
      hour: "2-digit",
      hour12: false,
      minute: "2-digit",
      month: "2-digit",
      timeZone,
      year: "numeric",
    })
      .formatToParts(new Date(value))
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${String(Number(parts.hour) % 24).padStart(2, "0")}:${parts.minute}`;
}

function dateTimeLocalToIso(value: string, timeZone: string): string {
  const [dateValue, timeValue] = value.split("T");
  const date = parseLocalDate(dateValue as string);
  const [hour, minute] = (timeValue as string).split(":").map(Number);
  return localDateTimeToUtc(
    date,
    (hour as number) * 60 + (minute as number),
    timeZone,
  ).toISOString();
}

function taskActionResult(action: "cancel" | "complete" | "reopen" | "restore" | "trash") {
  return {
    cancel: "Task cancelled.",
    complete: "Task completed.",
    reopen: "Task reopened.",
    restore: "Task restored.",
    trash: "Task moved to Trash.",
  }[action];
}
