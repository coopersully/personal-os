import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ActionButton as Button } from "@/components/action-button";
import { QueryFeedback } from "@/components/async-state";
import {
  ChevronRightIcon,
  ClockIcon,
  ListChecksIcon,
  ListTodoIcon,
  PlusIcon,
  ProjectIcon,
} from "@/components/icons";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useWorkspacePreferences } from "../workspace-settings/preferences";
import { taskCaptureList } from "./capture-default";
import { TaskCreationProgress } from "./creation-progress";
import { listAllTaskLists, listAllTaskProjects } from "./page";
import { TaskListDialog } from "./task-list-dialog";
import { TaskProjectDialog } from "./task-project-dialog";

export type TaskCreationPlacement = { listId: string; projectId: string | null };
export function TasksCreateButton({
  onCreate,
  onCreateReminder,
}: {
  onCreate: (placement?: TaskCreationPlacement) => void;
  onCreateReminder?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        aria-label="Create in Tasks"
        title="Create in Tasks"
        size="icon"
        onClick={() => setOpen(true)}
      >
        <PlusIcon aria-hidden="true" />
      </Button>
      {open ? (
        <CreationFlow
          close={() => setOpen(false)}
          onCreate={onCreate}
          onCreateReminder={onCreateReminder}
        />
      ) : null}
    </>
  );
}
function CreationFlow({
  close,
  onCreate,
  onCreateReminder,
}: {
  close: () => void;
  onCreate: (placement?: TaskCreationPlacement) => void;
  onCreateReminder?: (() => void) | undefined;
}) {
  const [params] = useSearchParams();
  const preferences = useWorkspacePreferences("tasks");
  const [step, setStep] = useState<
    "choose" | "task" | "project" | "list-editor" | "project-editor"
  >("choose");
  const [listId, setListId] = useState(params.get("list") ?? "");
  const [projectId, setProjectId] = useState(params.get("project") ?? "");
  const lists = useQuery({ queryKey: ["task-lists"], queryFn: listAllTaskLists });
  const projects = useQuery({ queryKey: ["task-projects"], queryFn: listAllTaskProjects });
  const activeLists = lists.data?.items.filter((item) => item.availability === "active") ?? [];
  const activeProjects =
    projects.data?.items.filter(
      (item) =>
        item.availability === "active" &&
        item.lifecycle === "open" &&
        activeLists.some((list) => list.id === item.listId),
    ) ?? [];
  const selectedProject = activeProjects.find((item) => item.id === projectId);
  const unscoped = !listId && !projectId && !params.has("list") && !params.has("project");
  const selectedListId =
    selectedProject?.listId ??
    activeLists.find((item) => item.id === listId)?.id ??
    taskCaptureList(
      activeLists,
      step === "task" && unscoped ? preferences.data?.preferences.defaultCaptureListId : null,
    )?.id ??
    "";
  if (step === "list-editor")
    return <TaskListDialog close={close} list={undefined} lists={activeLists} />;
  if (step === "project-editor")
    return (
      <TaskProjectDialog
        close={close}
        listId={selectedListId}
        lists={activeLists}
        projects={activeProjects}
        project={undefined}
      />
    );
  const choices = [
    {
      label: "Task",
      description: "Something to do",
      icon: ListChecksIcon,
      action: () => setStep("task"),
    },
    ...(onCreateReminder
      ? [
          {
            label: "Reminder",
            description: "Something to remember",
            icon: ClockIcon,
            action: () => {
              close();
              onCreateReminder();
            },
          },
        ]
      : []),
    {
      label: "Project",
      description: "A goal with related tasks",
      icon: ProjectIcon,
      action: () => {
        setProjectId("");
        setStep("project");
      },
    },
    {
      label: "List",
      description: "A place to organize tasks and projects",
      icon: ListTodoIcon,
      action: () => setStep("list-editor"),
    },
  ];
  return (
    <ResponsiveDialog open onOpenChange={(value) => !value && close()}>
      <ResponsiveDialogContent>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>
            {step === "choose"
              ? "What would you like to create?"
              : step === "task"
                ? "Where does this task belong?"
                : "Where does this project belong?"}
          </ResponsiveDialogTitle>
          <TaskCreationProgress
            step={step === "choose" ? 1 : 2}
            total={step === "choose" ? undefined : 3}
          />
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody>
          {step === "choose" ? (
            <div className="flex flex-col gap-2">
              {choices.map((choice) => (
                <Button
                  key={choice.label}
                  variant="secondary"
                  className="h-auto justify-start gap-3 p-3 text-left"
                  onClick={choice.action}
                >
                  <choice.icon aria-hidden="true" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span>{choice.label}</span>
                    <span className="text-xs font-normal text-muted-foreground whitespace-normal">
                      {choice.description}
                    </span>
                  </span>
                  <ChevronRightIcon aria-hidden="true" />
                </Button>
              ))}
            </div>
          ) : (
            <>
              <QueryFeedback query={lists} title="Couldn’t load lists." />
              {step === "task" ? (
                <QueryFeedback query={projects} title="Couldn’t load projects." />
              ) : null}
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="create-placement-list">List</FieldLabel>
                  <NativeSelect
                    id="create-placement-list"
                    value={selectedListId}
                    disabled={!lists.isSuccess}
                    onChange={(event) => {
                      setListId(event.target.value);
                      setProjectId("");
                    }}
                  >
                    {activeLists.map((item) => (
                      <NativeSelectOption key={item.id} value={item.id}>
                        {item.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  {step === "task" &&
                  unscoped &&
                  lists.isSuccess &&
                  preferences.data?.preferences.defaultCaptureListId &&
                  selectedListId !== preferences.data.preferences.defaultCaptureListId ? (
                    <FieldDescription>
                      Your default list is unavailable. This task will go to Inbox.
                    </FieldDescription>
                  ) : null}
                </Field>
                {step === "task" ? (
                  <Field>
                    <FieldLabel htmlFor="create-placement-project">Project (optional)</FieldLabel>
                    <NativeSelect
                      id="create-placement-project"
                      value={selectedProject?.id ?? ""}
                      disabled={!projects.isSuccess}
                      onChange={(event) => setProjectId(event.target.value)}
                    >
                      <NativeSelectOption value="">No project</NativeSelectOption>
                      {activeProjects
                        .filter((item) => item.listId === selectedListId)
                        .map((item) => (
                          <NativeSelectOption key={item.id} value={item.id}>
                            {item.name}
                          </NativeSelectOption>
                        ))}
                    </NativeSelect>
                  </Field>
                ) : null}
              </FieldGroup>
            </>
          )}
        </ResponsiveDialogBody>
        {step !== "choose" ? (
          <ResponsiveDialogFooter>
            <Button variant="ghost" onClick={() => setStep("choose")}>
              Back
            </Button>
            <Button
              disabled={
                !lists.isSuccess ||
                !selectedListId ||
                (step === "task" && (!projects.isSuccess || (unscoped && preferences.isPending)))
              }
              onClick={() => {
                if (step === "project") setStep("project-editor");
                else {
                  close();
                  onCreate({ listId: selectedListId, projectId: selectedProject?.id ?? null });
                }
              }}
            >
              Continue
            </Button>
          </ResponsiveDialogFooter>
        ) : null}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
