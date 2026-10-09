import type { TaskList, TaskProject, TaskSystemView } from "@personal-os/domain";
import { type ReactNode, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { ActionButton as Button } from "@/components/action-button";
import {
  ArchiveIcon,
  CalendarIcon,
  CircleCheckIcon,
  ClockIcon,
  EditIcon,
  HistoryIcon,
  type Icon,
  InboxIcon,
  ListTodoIcon,
  MoreHorizontalIcon,
  ProjectIcon,
  TrashIcon,
  XIcon,
} from "@/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { useWorkspacePreferences } from "../workspace-settings/preferences";
import { TaskListDialog } from "./task-list-dialog";
import { getTaskListIcon } from "./task-list-icons";
import { TaskProjectDialog } from "./task-project-dialog";

export const taskViews: Array<{ icon: Icon; label: string; value: TaskSystemView }> = [
  { icon: CalendarIcon, label: "Today", value: "today" },
  { icon: ClockIcon, label: "Upcoming", value: "upcoming" },
  { icon: CalendarIcon, label: "Scheduled", value: "scheduled" },
  { icon: CircleCheckIcon, label: "Completed", value: "completed" },
  { icon: XIcon, label: "Cancelled", value: "cancelled" },
  { icon: TrashIcon, label: "Trash", value: "trash" },
];

export function taskViewFromParams(params: URLSearchParams): TaskSystemView | null {
  const value = params.get("view");
  return taskViews.some((view) => view.value === value) ? (value as TaskSystemView) : null;
}

export function archiveScopeFromParams(params: URLSearchParams) {
  const scope = params.get("archive");
  return scope === "all" || scope === "list" || scope === "project" ? scope : null;
}

export function taskPath(
  current: URLSearchParams,
  selection: {
    list?: string | null;
    project?: string | null;
    view?: TaskSystemView | "all" | "history" | "lists" | "projects";
  },
  preserveTask = false,
) {
  const params = new URLSearchParams();
  for (const key of [
    "q",
    "dueAfter",
    "dueBefore",
    "scheduledAfter",
    "scheduledBefore",
    "lifecycle",
    "kind",
    "status",
    "priority",
    "tag",
    "due",
    "reserved",
    "sort",
    "group",
    "details",
  ]) {
    if (
      (current.get("view") === "lists" ||
        current.get("view") === "projects" ||
        selection.view === "lists" ||
        selection.view === "projects") &&
      key !== "q"
    )
      continue;
    const value = current.get(key);
    if (value) params.set(key, value);
  }
  if (preserveTask && current.get("task")) params.set("task", current.get("task") as string);
  if (selection.view) params.set("view", selection.view);
  if (selection.list) params.set("list", selection.list);
  if (selection.project) params.set("project", selection.project);
  return params.size ? `/tasks?${params}` : "/tasks";
}

export function TaskContainerActions({
  list,
  project,
  lists,
  projects,
  sidebar = false,
}: {
  list: TaskList;
  project?: TaskProject;
  lists: TaskList[];
  projects: TaskProject[];
  sidebar?: boolean;
}) {
  const [dialog, setDialog] = useState<"edit" | "archive" | null>(null);
  const label = `${project?.name ?? list.name} options`;
  const close = () => setDialog(null);
  if (!project && list.kind === "inbox") return null;
  return (
    <>
      {project ? (
        sidebar ? (
          <SidebarMenuAction
            aria-label={`Edit ${project.name}`}
            title={`Edit ${project.name}`}
            onClick={() => setDialog("edit")}
            showOnHover
            className="[@media(hover:none)]:opacity-100"
          >
            <EditIcon aria-hidden="true" />
          </SidebarMenuAction>
        ) : (
          <Button
            aria-label={`Edit ${project.name}`}
            title={`Edit ${project.name}`}
            size="icon-sm"
            variant="ghost"
            onClick={() => setDialog("edit")}
          >
            <EditIcon aria-hidden="true" />
          </Button>
        )
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            {sidebar ? (
              <SidebarMenuAction
                aria-label={label}
                title={label}
                className="[@media(hover:none)]:opacity-100"
                showOnHover
              >
                <MoreHorizontalIcon aria-hidden="true" />
              </SidebarMenuAction>
            ) : (
              <Button aria-label={label} title={label} size="icon-sm" variant="ghost">
                <MoreHorizontalIcon aria-hidden="true" />
              </Button>
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              {project || list.kind !== "inbox" ? (
                <DropdownMenuItem onSelect={() => setDialog("edit")}>
                  <EditIcon aria-hidden="true" />
                  {project ? "Manage project" : "Edit list"}
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuGroup>
            {!project && list.kind !== "inbox" ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem onSelect={() => setDialog("archive")}>
                    <ArchiveIcon aria-hidden="true" />
                    Archive list
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {dialog === "edit" && project ? (
        <TaskProjectDialog
          close={close}
          listId={list.id}
          lists={lists}
          project={project}
          projects={projects}
        />
      ) : null}
      {(dialog === "edit" && !project) || dialog === "archive" ? (
        <TaskListDialog
          close={close}
          list={list}
          lists={lists}
          archiveOnly={dialog === "archive"}
        />
      ) : null}
    </>
  );
}

function TaskListBranch({
  list,
  lists,
  projects,
  params,
  selectedListId,
  selectedProjectId,
  onNavigate,
}: {
  list: TaskList;
  lists: TaskList[];
  projects: TaskProject[];
  params: URLSearchParams;
  selectedListId: string | null;
  selectedProjectId: string | null;
  onNavigate: () => void;
}) {
  const children = projects.filter((project) => project.listId === list.id);
  const selected = selectedListId === list.id && !selectedProjectId;
  const ListIcon = list.kind === "inbox" ? InboxIcon : getTaskListIcon(list.icon);
  return (
    <SidebarMenuItem>
      <div className="relative flex items-center">
        <SidebarMenuButton
          asChild
          isActive={selected}
          tooltip={list.name}
          className="min-w-0 max-md:h-10"
          data-user-created={list.kind === "standard" ? "true" : undefined}
        >
          <Link
            aria-current={selected ? "page" : undefined}
            onClick={onNavigate}
            to={taskPath(params, { list: list.kind === "inbox" ? null : list.id })}
          >
            <ListIcon
              aria-hidden="true"
              data-list-icon={list.kind === "standard" ? list.icon : undefined}
              weight={selected ? "Filled" : "Outline"}
            />
            <span>{list.name}</span>
          </Link>
        </SidebarMenuButton>
        <TaskContainerActions list={list} lists={lists} projects={projects} sidebar />
      </div>
      {children.length > 0 ? (
        <SidebarMenuSub>
          {children.map((project) => (
            <SidebarMenuSubItem key={project.id} className="group/menu-item">
              <SidebarMenuSubButton
                asChild
                isActive={selectedProjectId === project.id}
                className="pr-8 max-md:h-10"
              >
                <Link
                  aria-current={selectedProjectId === project.id ? "page" : undefined}
                  onClick={onNavigate}
                  to={taskPath(params, { list: list.id, project: project.id })}
                >
                  <ProjectIcon
                    aria-hidden="true"
                    weight={selectedProjectId === project.id ? "Filled" : "Outline"}
                  />
                  <span>{project.name}</span>
                </Link>
              </SidebarMenuSubButton>
              <TaskContainerActions
                list={list}
                project={project}
                lists={lists}
                projects={projects}
                sidebar
              />
            </SidebarMenuSubItem>
          ))}
        </SidebarMenuSub>
      ) : null}
    </SidebarMenuItem>
  );
}

export function TaskNavigation({
  lists,
  projects,
  status,
  onNavigate,
}: {
  lists: TaskList[];
  projects: TaskProject[];
  status?: ReactNode;
  onNavigate: () => void;
}) {
  const [params] = useSearchParams();
  const pathname = useLocation().pathname;
  const decisions = pathname === "/tasks/decisions";
  const reminders = pathname === "/reminders";
  const rawView = params.get("view");
  const selectedView = reminders
    ? rawView === "completed"
      ? "history"
      : "all"
    : rawView === "all" || rawView === "history" || rawView === "lists" || rawView === "projects"
      ? rawView
      : rawView === "scheduled"
        ? "all"
        : rawView === "completed" || rawView === "cancelled"
          ? "history"
          : taskViewFromParams(params);
  const archive = !reminders && archiveScopeFromParams(params) !== null;
  const selectedProject =
    !reminders && !selectedView && !archive
      ? projects.find((project) => project.id === params.get("project"))
      : undefined;
  const selectedListId =
    decisions || reminders || selectedView || archive
      ? null
      : (selectedProject?.listId ??
        params.get("list") ??
        lists.find((list) => list.kind === "inbox")?.id ??
        null);
  const pins = useWorkspacePreferences("tasks");
  // A destination changes scope, not the user's presentation preferences.
  const taskParams = new URLSearchParams();
  for (const key of ["q", "sort", "group", "details"]) {
    const value = params.get(key);
    if (value) taskParams.set(key, value);
  }
  const renderView = (
    value: TaskSystemView | "all" | "history" | "lists" | "projects" | "archive",
  ) => {
    const view =
      value === "archive"
        ? { icon: ArchiveIcon, label: "Archive" }
        : value === "lists"
          ? { icon: ListTodoIcon, label: "All Lists" }
          : value === "projects"
            ? { icon: ProjectIcon, label: "Projects" }
            : value === "all"
              ? { icon: ListTodoIcon, label: "All" }
              : value === "history"
                ? { icon: HistoryIcon, label: "History" }
                : taskViews.find((candidate) => candidate.value === value);
    if (!view) return null;
    const ViewIcon = view.icon;
    return (
      <SidebarMenuItem key={value}>
        <SidebarMenuButton
          asChild
          isActive={selectedView === value || (archive && value === "archive")}
          className="max-md:h-10"
          tooltip={view.label}
        >
          <Link
            aria-current={
              selectedView === value || (archive && value === "archive") ? "page" : undefined
            }
            onClick={onNavigate}
            to={value === "archive" ? "/tasks?archive=all" : taskPath(taskParams, { view: value })}
          >
            <ViewIcon aria-hidden="true" weight={selectedView === value ? "Filled" : "Outline"} />
            <span>{view.label}</span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  };
  const renderList = (list: TaskList) => (
    <TaskListBranch
      key={list.id}
      list={list}
      lists={lists}
      projects={[]}
      params={taskParams}
      selectedListId={selectedListId}
      selectedProjectId={selectedProject?.id ?? null}
      onNavigate={onNavigate}
    />
  );
  return (
    <>
      <SidebarGroup>
        <SidebarGroupLabel>Views</SidebarGroupLabel>
        <SidebarGroupContent>
          <nav aria-label="Task views">
            <SidebarMenu>
              {lists.filter((list) => list.kind === "inbox").map(renderList)}
              {renderView("today")}
              {renderView("upcoming")}
              {renderView("all")}
              {renderView("lists")}
              {renderView("projects")}
            </SidebarMenu>
          </nav>
        </SidebarGroupContent>
      </SidebarGroup>
      <SidebarGroup>
        <SidebarGroupLabel>Pinned</SidebarGroupLabel>
        <SidebarGroupContent>
          {status}
          <nav aria-label="Pinned lists and projects">
            <SidebarMenu>
              {lists
                .filter((list) => pins.data?.preferences.pinnedListIds?.includes(list.id))
                .map((list) => (
                  <TaskListBranch
                    key={list.id}
                    list={list}
                    lists={lists}
                    projects={[]}
                    params={taskParams}
                    selectedListId={selectedListId}
                    selectedProjectId={selectedProject?.id ?? null}
                    onNavigate={onNavigate}
                  />
                ))}
              {projects
                .filter((project) => pins.data?.preferences.pinnedProjectIds?.includes(project.id))
                .map((project) => (
                  <SidebarMenuItem key={project.id}>
                    <SidebarMenuButton
                      asChild
                      isActive={selectedProject?.id === project.id}
                      tooltip={project.name}
                    >
                      <Link
                        to={taskPath(taskParams, { list: project.listId, project: project.id })}
                        onClick={onNavigate}
                        aria-current={selectedProject?.id === project.id ? "page" : undefined}
                      >
                        <ProjectIcon aria-hidden="true" />
                        <span>{project.name}</span>
                      </Link>
                    </SidebarMenuButton>
                    {lists
                      .filter((list) => list.id === project.listId)
                      .map((list) => (
                        <TaskContainerActions
                          key={list.id}
                          list={list}
                          project={project}
                          lists={lists}
                          projects={projects}
                          sidebar
                        />
                      ))}
                  </SidebarMenuItem>
                ))}
            </SidebarMenu>
            {pins.isError ? (
              <p className="px-2 text-xs text-muted-foreground">Couldn’t load pins.</p>
            ) : pins.isSuccess &&
              !(
                lists.some((list) => pins.data.preferences.pinnedListIds?.includes(list.id)) ||
                projects.some((project) =>
                  pins.data.preferences.pinnedProjectIds?.includes(project.id),
                )
              ) ? (
              <p className="px-2 text-xs text-muted-foreground">
                Pin items from Lists or Projects.
              </p>
            ) : null}
          </nav>
        </SidebarGroupContent>
      </SidebarGroup>
      <SidebarGroup>
        <SidebarGroupLabel>History</SidebarGroupLabel>
        <SidebarGroupContent>
          <nav aria-label="Task history">
            <SidebarMenu>
              {renderView("history")}
              {renderView("trash")}
              {renderView("archive")}
            </SidebarMenu>
          </nav>
        </SidebarGroupContent>
      </SidebarGroup>
    </>
  );
}
