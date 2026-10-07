import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ArchiveIcon,
  CalendarIcon,
  ChevronDownIcon,
  ClockIcon,
  HistoryIcon,
  InboxIcon,
  ListTodoIcon,
  ProjectIcon,
  TrashIcon,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TaskContainerControls } from "./containers-page";
import { listAllTaskLists, listAllTaskProjects } from "./page";
import { useTaskPresentationParams } from "./presentation-preferences";
import { getTaskListIcon } from "./task-list-icons";
import { TaskContainerActions, taskPath } from "./task-navigation";
import { WorkspaceDisplay, WorkspaceFilters, WorkspaceSort } from "./workspace-controls";

const views = [
  { value: "inbox", label: "Inbox", icon: InboxIcon },
  { value: "today", label: "Today", icon: CalendarIcon },
  { value: "upcoming", label: "Upcoming", icon: ClockIcon },
  { value: "lists", label: "All Lists", icon: ListTodoIcon },
  { value: "projects", label: "Projects", icon: ProjectIcon },
] as const;
const historyViews = [
  { value: "history", label: "History", icon: HistoryIcon },
  { value: "trash", label: "Trash", icon: TrashIcon },
  { value: "archive", label: "Archive", icon: ArchiveIcon },
] as const;

export function TasksAppBarControls({ search, timeZone }: { search: ReactNode; timeZone: string }) {
  const params = useTaskPresentationParams();
  const [routeParams] = useSearchParams();
  const navigate = useNavigate();
  const lists = useQuery({ queryKey: ["task-lists"], queryFn: listAllTaskLists });
  const projects = useQuery({ queryKey: ["task-projects"], queryFn: listAllTaskProjects });
  const activeLists = lists.data?.items.filter((list) => list.availability === "active") ?? [];
  const activeProjects =
    projects.data?.items.filter(
      (project) =>
        project.availability === "active" &&
        project.lifecycle === "open" &&
        activeLists.some((list) => list.id === project.listId),
    ) ?? [];
  const project = projects.data?.items.find((item) => item.id === params.get("project"));
  const list = lists.data?.items.find(
    (item) =>
      item.id === (project?.listId ?? params.get("list")) ||
      (!params.has("view") &&
        !params.has("list") &&
        !params.has("project") &&
        !params.has("archive") &&
        item.kind === "inbox"),
  );
  const archive = params.has("archive");
  const scope =
    params.get("view") ??
    (project || (list?.kind !== "inbox" && params.has("list")) ? "container" : "inbox");
  const label = archive
    ? (project?.name ?? list?.name ?? "Archive")
    : (views.find((view) => view.value === scope)?.label ??
      (scope === "all"
        ? "All tasks"
        : scope === "history"
          ? "History"
          : scope === "trash"
            ? "Trash"
            : (project?.name ?? list?.name ?? "Tasks")));
  const selectedValue = archive
    ? "archive"
    : scope === "container"
      ? project
        ? `project:${project.id}`
        : `list:${list?.id}`
      : scope;
  const SelectedIcon = archive
    ? ArchiveIcon
    : ([...views, ...historyViews].find((view) => view.value === scope)?.icon ??
      (project ? ProjectIcon : getTaskListIcon(list?.icon)));
  const selectScope = (value: string) => {
    if (value === "archive") navigate("/tasks?archive=all");
    else
      navigate(
        taskPath(
          routeParams,
          value === "inbox"
            ? {}
            : {
                view: value as
                  | "today"
                  | "upcoming"
                  | "all"
                  | "history"
                  | "trash"
                  | "lists"
                  | "projects",
              },
        ),
      );
  };
  return (
    <div className="tasks-header-context">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="tasks-header-view"
            aria-label={`Tasks view: ${label}`}
            title={label}
          >
            <SelectedIcon aria-hidden="true" />
            <span className="truncate">{label}</span>
            <ChevronDownIcon aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-80 max-w-[calc(100vw-2rem)]">
          <DropdownMenuRadioGroup value={selectedValue} onValueChange={selectScope}>
            {views.map((view) => (
              <DropdownMenuRadioItem key={view.value} value={view.value}>
                <view.icon aria-hidden="true" />
                {view.label}
              </DropdownMenuRadioItem>
            ))}
            {historyViews.map((view) => (
              <DropdownMenuRadioItem key={view.value} value={view.value}>
                <view.icon aria-hidden="true" />
                {view.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="tasks-header-tools">
        {search}
        {params.get("archive") === "all" ? (
          <TaskContainerControls kind="archive" />
        ) : scope === "lists" || scope === "projects" ? (
          <TaskContainerControls kind={scope} />
        ) : !archive ? (
          <>
            <WorkspaceFilters
              params={params}
              routeParams={routeParams}
              timeZone={timeZone}
              lists={activeLists}
              projects={activeProjects}
            />
            <WorkspaceSort params={params} routeParams={routeParams} />
            <WorkspaceDisplay params={params} routeParams={routeParams} />
            {!params.has("view") && list ? (
              <TaskContainerActions
                list={list}
                {...(project ? { project } : {})}
                lists={activeLists}
                projects={projects.data?.items ?? []}
              />
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
