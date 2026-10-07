import {
  type TaskList,
  type TaskListArchiveConflict,
  type TaskListIcon,
  taskListArchiveConflictSchema,
} from "@personal-os/domain";
import { useQueryClient } from "@tanstack/react-query";
import type { FormEvent } from "react";
import { useState } from "react";
import { toast } from "sonner";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { api } from "../../api.js";
import { FeedbackForm } from "../../components/feedback-form.js";
import { MutationFeedback } from "../../components/mutation-feedback.js";
import { invalidateMaterial } from "../../lib/material-queries.js";
import { useFeedbackMutation } from "../../lib/use-feedback-mutation.js";
import { TaskCreationProgress } from "./creation-progress";
import { taskListIconOptions } from "./task-list-icons";

export function TaskListDialog({
  archiveOnly = false,
  close,
  list,
  lists,
}: {
  archiveOnly?: boolean;
  close: () => void;
  list: TaskList | undefined;
  lists: TaskList[];
}) {
  const queryClient = useQueryClient();
  const [conflict, setConflict] = useState<TaskListArchiveConflict | null>(null);
  const [destinationListId, setDestinationListId] = useState("");
  const [icon, setIcon] = useState<TaskListIcon>(list?.icon ?? "list");
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
  const save = useFeedbackMutation({
    feedback: { action: "save this list", safeToRetry: false, form: true },
    mutationFn: (input: { description: string | null; icon: TaskListIcon; name: string }) =>
      list
        ? api.updateTaskList(list.id, { ...input, expectedRevision: list.revision })
        : api.createTaskList({ ...input, color: null }),
    onSuccess: () => finish(list ? "List updated." : "List created."),
  });
  const archive = useFeedbackMutation({
    feedback: { action: "archive this list", safeToRetry: false, form: false },
    mutationFn: async (
      resolution?: "archive_contents_together" | "cancel" | "move_active_contents",
    ) => {
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
      icon,
      name: String(form.get("name") ?? ""),
    });
  };

  if (protectedInbox) return null;
  return (
    <ResponsiveDialog open onOpenChange={(open) => !open && close()}>
      <ResponsiveDialogContent className="max-sm:px-4 max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            {archiveOnly && list
              ? `Archive ${list.name}?`
              : list
                ? `Manage ${list.name}`
                : "Create a List"}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {archiveOnly
              ? "This list will move to Archive. If it has active contents, you’ll choose what happens to them next."
              : "Lists are stable areas for related Tasks and Projects. System View names are reserved."}
          </ResponsiveDialogDescription>
          {!list && !archiveOnly ? <TaskCreationProgress step={2} total={2} /> : null}
        </ResponsiveDialogHeader>
        <MutationFeedback feedback={taskListConflict(archive.error) ? null : archive.feedback} />
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
        ) : archiveOnly ? (
          <ResponsiveDialogFooter>
            <Button onClick={close} variant="outline">
              Cancel
            </Button>
            <Button
              disabled={archive.isPending}
              onClick={() => archive.mutate(undefined)}
              variant="destructive"
            >
              Archive List
            </Button>
          </ResponsiveDialogFooter>
        ) : (
          <>
            <FeedbackForm feedback={save.feedback} onSubmit={submit}>
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
                <FieldSet>
                  <FieldLegend variant="label">Icon</FieldLegend>
                  <RadioGroup
                    aria-label="List icon"
                    className="grid-cols-[repeat(auto-fit,minmax(2.5rem,1fr))]"
                    onValueChange={(value) => setIcon(value as TaskListIcon)}
                    value={icon}
                  >
                    {taskListIconOptions.map((option) => {
                      const OptionIcon = option.icon;
                      return (
                        <RadioGroupItem
                          aria-label={option.label}
                          title={option.label}
                          className="h-10 w-full aspect-square items-center justify-center gap-2 rounded-md bg-muted px-3 text-muted-foreground after:hidden hover:bg-accent hover:text-accent-foreground data-[state=checked]:bg-selection data-[state=checked]:text-foreground [&>[data-slot=radio-group-indicator]]:hidden [&>svg]:size-4"
                          key={option.value}
                          value={option.value}
                        >
                          <OptionIcon aria-hidden="true" />
                        </RadioGroupItem>
                      );
                    })}
                  </RadioGroup>
                </FieldSet>
              </FieldGroup>

              <ResponsiveDialogFooter className="mt-5">
                <Button onClick={close} type="button" variant="outline">
                  Cancel
                </Button>
                <Button disabled={save.isPending} type="submit">
                  {save.isPending ? "Saving…" : list ? "Save changes" : "Create List"}
                </Button>
              </ResponsiveDialogFooter>
            </FeedbackForm>
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
      </ResponsiveDialogContent>
    </ResponsiveDialog>
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
  onResolve: (resolution: "archive_contents_together" | "move_active_contents") => void;
  pending: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Alert>
        <AlertTitle>Choose what happens to active contents</AlertTitle>
        <AlertDescription>
          This List has {conflict.openContentCounts.projects} open Projects and{" "}
          {conflict.openContentCounts.tasks} open Tasks. Move them to another List or archive the
          List and its contents together.
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
      {conflict.resolutions.includes("archive_contents_together") ? (
        <Button
          disabled={pending}
          onClick={() => onResolve("archive_contents_together")}
          variant="destructive"
        >
          Archive contents together
        </Button>
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
