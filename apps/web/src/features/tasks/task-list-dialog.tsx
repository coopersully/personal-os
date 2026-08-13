import {
  type TaskList,
  type TaskListArchiveConflict,
  taskListArchiveConflictSchema,
} from "@personal-os/domain";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { FormEvent } from "react";
import { useState } from "react";
import { toast } from "sonner";
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
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { api, errorMessage } from "../../api.js";
import { InlineError } from "../../components/async-state.js";
import { invalidateMaterial } from "../../lib/material-queries.js";

export function TaskListDialog({
  close,
  list,
  lists,
}: {
  close: () => void;
  list: TaskList | undefined;
  lists: TaskList[];
}) {
  const queryClient = useQueryClient();
  const [conflict, setConflict] = useState<TaskListArchiveConflict | null>(null);
  const [destinationListId, setDestinationListId] = useState("");
  const protectedInbox = list?.kind === "inbox";
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
    mutationFn: (input: { description: string | null; name: string }) =>
      list
        ? api.updateTaskList(list.id, { ...input, expectedRevision: list.revision })
        : api.createTaskList({ ...input, color: null }),
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: () => finish(list ? "List updated." : "List created."),
  });
  const archive = useMutation({
    mutationFn: async (resolution?: "cancel" | "move_active_contents") => {
      if (!list) throw new Error("Create the List before archiving it.");
      return api.archiveTaskList(list.id, {
        ...(destinationListId ? { destinationListId } : {}),
        expectedRevision: conflict?.currentRevisions.sourceList ?? list.revision,
        ...(resolution ? { resolution } : {}),
      });
    },
    onError: (error) => {
      const parsed = taskListConflict(error);
      if (parsed) setConflict(parsed);
      else toast.error(errorMessage(error));
    },
    onSuccess: (_result, resolution) => {
      if (resolution === "cancel") {
        setConflict(null);
        return;
      }
      return finish("List archived.");
    },
  });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    save.mutate({
      description: nullable(form.get("description")),
      name: String(form.get("name") ?? ""),
    });
  };

  if (protectedInbox) return null;
  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{list ? `Manage ${list.name}` : "Create a List"}</DialogTitle>
          <DialogDescription>
            Lists are stable areas for related Tasks and Projects. System View names are reserved.
          </DialogDescription>
        </DialogHeader>
        {conflict ? (
          <ListArchiveConflict
            conflict={conflict}
            destinationListId={destinationListId}
            destinations={lists.filter((candidate) => candidate.id !== list?.id)}
            onCancel={() => archive.mutate("cancel")}
            onDestinationChange={setDestinationListId}
            onResolve={(resolution) => archive.mutate(resolution)}
            pending={archive.isPending}
          />
        ) : (
          <>
            <form onSubmit={submit}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="task-list-name">Name</FieldLabel>
                  <Input
                    autoFocus
                    defaultValue={list?.name}
                    id="task-list-name"
                    name="name"
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="task-list-description">Description</FieldLabel>
                  <Textarea
                    defaultValue={list?.description ?? ""}
                    id="task-list-description"
                    name="description"
                    rows={3}
                  />
                </Field>
              </FieldGroup>
              {save.isError ? <InlineError error={save.error} /> : null}
              <DialogFooter className="mt-5">
                <Button onClick={close} type="button" variant="outline">
                  Cancel
                </Button>
                <Button disabled={save.isPending} type="submit">
                  {save.isPending ? "Saving…" : list ? "Save changes" : "Create List"}
                </Button>
              </DialogFooter>
            </form>
            {list ? (
              <Button
                disabled={archive.isPending}
                onClick={() => archive.mutate(undefined)}
                variant="destructive"
              >
                Archive List
              </Button>
            ) : null}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ListArchiveConflict({
  conflict,
  destinationListId,
  destinations,
  onCancel,
  onDestinationChange,
  onResolve,
  pending,
}: {
  conflict: TaskListArchiveConflict;
  destinationListId: string;
  destinations: TaskList[];
  onCancel: () => void;
  onDestinationChange: (id: string) => void;
  onResolve: (resolution: "move_active_contents") => void;
  pending: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Alert>
        <AlertTitle>Choose what happens to active contents</AlertTitle>
        <AlertDescription>
          This List has {conflict.openContentCounts.projects} open Projects and{" "}
          {conflict.openContentCounts.tasks} open Tasks. Move active contents to another List before
          archiving this List.
        </AlertDescription>
      </Alert>
      {conflict.resolutions.includes("move_active_contents") ? (
        <Field>
          <FieldLabel htmlFor="task-list-archive-destination">Destination List</FieldLabel>
          <NativeSelect
            id="task-list-archive-destination"
            onChange={(event) => onDestinationChange(event.target.value)}
            value={destinationListId}
          >
            <NativeSelectOption value="">Select a List</NativeSelectOption>
            {destinations.map((destination) => (
              <NativeSelectOption key={destination.id} value={destination.id}>
                {destination.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <Button
            disabled={pending || !destinationListId}
            onClick={() => onResolve("move_active_contents")}
            variant="outline"
          >
            Move active contents
          </Button>
        </Field>
      ) : null}
      {conflict.resolutions.includes("cancel") ? (
        <Button disabled={pending} onClick={onCancel} variant="outline">
          Keep List active
        </Button>
      ) : null}
    </div>
  );
}

function taskListConflict(error: unknown): TaskListArchiveConflict | null {
  const details =
    typeof error === "object" && error !== null && "details" in error ? error.details : undefined;
  const parsed = taskListArchiveConflictSchema.safeParse(details);
  return parsed.success ? parsed.data : null;
}

function nullable(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text || null;
}
