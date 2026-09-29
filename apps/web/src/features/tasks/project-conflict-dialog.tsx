import type {
  TaskList,
  TaskProject,
  TaskProjectCompletionConflict,
  TaskProjectCompletionResolution,
  TaskProjectMovePreview,
} from "@personal-os/domain";
import { useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

type CompletionProps = {
  close: () => void;
  conflict: TaskProjectCompletionConflict;
  lists: TaskList[];
  onResolve: (
    resolution: TaskProjectCompletionResolution,
    destinationListId?: string,
    destinationProjectId?: string,
  ) => void;
  pending: boolean;
  projects: TaskProject[];
  preview?: never;
  onConfirmMove?: never;
};

type MoveProps = {
  close: () => void;
  conflict?: never;
  lists?: never;
  onConfirmMove: () => void;
  onResolve?: never;
  pending: boolean;
  preview: TaskProjectMovePreview;
  projects?: never;
};

export function ProjectConflictDialog(props: CompletionProps | MoveProps) {
  if (props.preview) {
    return (
      <Dialog open onOpenChange={(open) => !open && props.close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move Project?</DialogTitle>
            <DialogDescription>
              The Project and its Tasks will move together to the selected List.
            </DialogDescription>
          </DialogHeader>
          <Alert>
            <AlertTitle>{props.preview.affectedTaskCount} Tasks will move</AlertTitle>
            <AlertDescription>
              This preview is revision-bound. If the Project changes, request a new preview.
            </AlertDescription>
          </Alert>
          <DialogFooter>
            <Button onClick={props.close} variant="outline">
              Keep current List
            </Button>
            <Button disabled={props.pending} onClick={props.onConfirmMove}>
              Move Project and Tasks
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }
  return <CompletionConflict {...props} />;
}

function CompletionConflict({
  close,
  conflict,
  lists,
  onResolve,
  pending,
  projects,
}: CompletionProps) {
  const [destinationListId, setDestinationListId] = useState("");
  const [destinationProjectId, setDestinationProjectId] = useState("");
  const availableProjects = useMemo(
    () =>
      projects.filter(
        (project) =>
          project.availability === "active" &&
          project.lifecycle === "open" &&
          project.listId === destinationListId,
      ),
    [destinationListId, projects],
  );
  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Choose what happens to open Tasks</DialogTitle>
          <DialogDescription>
            The Project has {conflict.openContentCounts.tasks} open Tasks. Choose one of the
            outcomes returned by ilo.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          {conflict.resolutions.includes("complete_open_tasks") ? (
            <Button disabled={pending} onClick={() => onResolve("complete_open_tasks")}>
              Complete open Tasks
            </Button>
          ) : null}
          {conflict.resolutions.includes("cancel_open_tasks") ? (
            <Button
              disabled={pending}
              onClick={() => onResolve("cancel_open_tasks")}
              variant="outline"
            >
              Cancel open Tasks
            </Button>
          ) : null}
          {conflict.resolutions.includes("move_open_tasks") ? (
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="project-completion-list">Destination List</FieldLabel>
                <NativeSelect
                  id="project-completion-list"
                  onChange={(event) => {
                    setDestinationListId(event.target.value);
                    setDestinationProjectId("");
                  }}
                  value={destinationListId}
                >
                  <NativeSelectOption value="">Select a List</NativeSelectOption>
                  {lists.map((list) => (
                    <NativeSelectOption key={list.id} value={list.id}>
                      {list.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor="project-completion-project">Destination Project</FieldLabel>
                <NativeSelect
                  disabled={!destinationListId}
                  id="project-completion-project"
                  onChange={(event) => setDestinationProjectId(event.target.value)}
                  value={destinationProjectId}
                >
                  <NativeSelectOption value="">No Project</NativeSelectOption>
                  {availableProjects.map((project) => (
                    <NativeSelectOption key={project.id} value={project.id}>
                      {project.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <Button
                disabled={pending || !destinationListId}
                onClick={() =>
                  onResolve("move_open_tasks", destinationListId, destinationProjectId || undefined)
                }
                variant="outline"
              >
                Move open Tasks
              </Button>
            </FieldGroup>
          ) : null}
          {conflict.resolutions.includes("keep_project_open") ? (
            <Button
              disabled={pending}
              onClick={() => onResolve("keep_project_open")}
              variant="outline"
            >
              Keep Project open
            </Button>
          ) : null}
        </FieldGroup>
      </DialogContent>
    </Dialog>
  );
}
