import {
  type TaskList,
  type TaskProject,
  type TaskProjectCompletionConflict,
  type TaskProjectCompletionResolution,
  type TaskProjectMovePreview,
  taskProjectCompletionConflictSchema,
} from "@personal-os/domain";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { FormEvent } from "react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "../../api.js";
import { InlineError } from "../../components/async-state.js";
import { invalidateMaterial } from "../../lib/material-queries.js";
import { ProjectConflictDialog } from "./project-conflict-dialog.js";

export function TaskProjectDialog({
  close,
  listId,
  lists,
  project,
  projects,
}: {
  close: () => void;
  listId: string;
  lists: TaskList[];
  project: TaskProject | undefined;
  projects: TaskProject[];
}) {
  const queryClient = useQueryClient();
  const [completionConflict, setCompletionConflict] =
    useState<TaskProjectCompletionConflict | null>(null);
  const [moveDestinationListId, setMoveDestinationListId] = useState(project?.listId ?? listId);
  const [movePreview, setMovePreview] = useState<TaskProjectMovePreview | null>(null);
  const finish = async (message: string) => {
    toast.success(message);
    await Promise.all([
      invalidateMaterial(queryClient),
      queryClient.invalidateQueries({ queryKey: ["task-lists"] }),
      queryClient.invalidateQueries({ queryKey: ["task-projects"] }),
    ]);
    close();
  };
  const save = useMutation({
    mutationFn: (input: {
      name: string;
      notes: string | null;
      targetDate: string | null;
      why: string | null;
    }) =>
      project
        ? api.updateTaskProject(project.id, { ...input, expectedRevision: project.revision })
        : api.createTaskProject({ ...input, listId }),
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: () => finish(project ? "Project updated." : "Project created."),
  });
  const lifecycle = useMutation({
    mutationFn: async ({
      destinationListId,
      destinationProjectId,
      resolution,
      type,
    }: {
      destinationListId?: string;
      destinationProjectId?: string;
      resolution?: TaskProjectCompletionResolution;
      type: "archive" | "cancel" | "complete";
    }) => {
      if (!project) throw new Error("Create the Project before changing its lifecycle.");
      if (type === "archive") {
        return api.archiveTaskProject(project.id, { expectedRevision: project.revision });
      }
      if (type === "cancel") {
        return api.cancelTaskProject(project.id, { expectedRevision: project.revision });
      }
      return api.completeTaskProject(project.id, {
        ...(destinationListId ? { destinationListId } : {}),
        ...(destinationProjectId ? { destinationProjectId } : {}),
        expectedRevision: completionConflict?.currentRevisions.project ?? project.revision,
        ...(resolution ? { resolution } : {}),
      });
    },
    onError: (error, variables) => {
      if (variables.type === "complete") {
        const parsed = projectCompletionConflict(error);
        if (parsed) {
          setCompletionConflict(parsed);
          return;
        }
      }
      toast.error(errorMessage(error));
    },
    onSuccess: (_result, variables) => {
      if (variables.resolution === "keep_project_open") {
        setCompletionConflict(null);
        return;
      }
      return finish(
        variables.type === "archive"
          ? "Project archived."
          : variables.type === "cancel"
            ? "Project cancelled."
            : "Project completed.",
      );
    },
  });
  const previewMove = useMutation({
    mutationFn: () => {
      if (!project) throw new Error("Create the Project before moving it.");
      return api.previewTaskProjectMove(project.id, {
        destinationListId: moveDestinationListId,
        expectedRevision: project.revision,
      });
    },
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: setMovePreview,
  });
  const confirmMove = useMutation({
    mutationFn: () => {
      if (!project || !movePreview) throw new Error("The Project move preview expired.");
      return api.moveTaskProject(project.id, {
        destinationListId: movePreview.destinationListId,
        expectedRevision: movePreview.taskProjectRevision,
        previewToken: movePreview.previewToken,
      });
    },
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: () => finish("Project and Tasks moved."),
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    save.mutate({
      name: String(form.get("name") ?? ""),
      notes: nullable(form.get("notes")),
      targetDate: nullable(form.get("targetDate")),
      why: nullable(form.get("why")),
    });
  };
  const pending =
    save.isPending || lifecycle.isPending || previewMove.isPending || confirmMove.isPending;

  return (
    <>
      <Dialog
        open={!movePreview && !completionConflict}
        onOpenChange={(open) => !open && !movePreview && !completionConflict && close()}
      >
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{project ? `Manage ${project.name}` : "Create a Project"}</DialogTitle>
            <DialogDescription>
              Projects group Tasks toward one finite outcome inside a List.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="task-project-name">Name</FieldLabel>
                <Input
                  autoFocus
                  defaultValue={project?.name}
                  id="task-project-name"
                  name="name"
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="task-project-why">Why it matters</FieldLabel>
                <Textarea
                  defaultValue={project?.why ?? ""}
                  id="task-project-why"
                  name="why"
                  rows={2}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="task-project-target-date">Target date</FieldLabel>
                <Input
                  defaultValue={project?.targetDate ?? ""}
                  id="task-project-target-date"
                  name="targetDate"
                  type="date"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="task-project-notes">Notes</FieldLabel>
                <Textarea
                  defaultValue={project?.notes ?? ""}
                  id="task-project-notes"
                  name="notes"
                  rows={3}
                />
              </Field>
            </FieldGroup>
            {save.isError ? <InlineError error={save.error} /> : null}
            <DialogFooter className="mt-5">
              <Button onClick={close} type="button" variant="outline">
                Cancel
              </Button>
              <Button disabled={pending} type="submit">
                {save.isPending ? "Saving…" : project ? "Save changes" : "Create Project"}
              </Button>
            </DialogFooter>
          </form>
          {project ? (
            <FieldGroup>
              {project.lifecycle === "open" ? (
                <fieldset aria-label="Project lifecycle actions" className="flex flex-wrap gap-2">
                  <Button disabled={pending} onClick={() => lifecycle.mutate({ type: "complete" })}>
                    Complete Project
                  </Button>
                  <Button
                    disabled={pending}
                    onClick={() => lifecycle.mutate({ type: "cancel" })}
                    variant="outline"
                  >
                    Cancel Project
                  </Button>
                </fieldset>
              ) : null}
              <Field>
                <FieldLabel htmlFor="task-project-move-list">Move to List</FieldLabel>
                <NativeSelect
                  id="task-project-move-list"
                  onChange={(event) => setMoveDestinationListId(event.target.value)}
                  value={moveDestinationListId}
                >
                  {lists.map((list) => (
                    <NativeSelectOption key={list.id} value={list.id}>
                      {list.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <Button
                  disabled={pending || moveDestinationListId === project.listId}
                  onClick={() => previewMove.mutate()}
                  variant="outline"
                >
                  Preview Project move
                </Button>
              </Field>
              <Button
                disabled={pending}
                onClick={() => lifecycle.mutate({ type: "archive" })}
                variant="destructive"
              >
                Archive Project
              </Button>
            </FieldGroup>
          ) : null}
        </DialogContent>
      </Dialog>

      {movePreview ? (
        <ProjectConflictDialog
          close={() => setMovePreview(null)}
          onConfirmMove={() => confirmMove.mutate()}
          pending={confirmMove.isPending}
          preview={movePreview}
        />
      ) : null}
      {completionConflict ? (
        <ProjectConflictDialog
          close={() => setCompletionConflict(null)}
          conflict={completionConflict}
          lists={lists}
          onResolve={(resolution, destinationListId, destinationProjectId) =>
            lifecycle.mutate({
              ...(destinationListId ? { destinationListId } : {}),
              ...(destinationProjectId ? { destinationProjectId } : {}),
              resolution,
              type: "complete",
            })
          }
          pending={lifecycle.isPending}
          projects={projects.filter((candidate) => candidate.id !== project?.id)}
        />
      ) : null}
    </>
  );
}

function projectCompletionConflict(error: unknown): TaskProjectCompletionConflict | null {
  const details =
    typeof error === "object" && error !== null && "details" in error ? error.details : undefined;
  const parsed = taskProjectCompletionConflictSchema.safeParse(details);
  return parsed.success ? parsed.data : null;
}

function nullable(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text || null;
}
