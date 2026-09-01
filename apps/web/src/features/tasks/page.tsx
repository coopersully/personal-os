import type { DailyBrief, Task, TaskList, TaskProject, TaskSystemView } from "@personal-os/domain";
import { localDateTimeToUtc, parseLocalDate } from "@personal-os/domain";
import { EmptyState } from "@personal-os/ui";
import {
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  CalendarIcon,
  CircleCheckIcon,
  ClockIcon,
  EditIcon,
  type Icon,
  InboxIcon,
  ListChecksIcon,
  ListTodoIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
  XIcon,
} from "@/components/icons";
import {
  TaskItem,
  TaskItemCompletion,
  TaskItemContent,
  TaskItemDescription,
  TaskItemDue,
  TaskItemMetadata,
  TaskItemPrimaryAction,
  TaskItemTags,
  TaskItemTitle,
} from "@/components/task-item";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ItemGroup } from "@/components/ui/item";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "../../api.js";
import { InlineError } from "../../components/async-state.js";
import { WorkspaceSearch, workspaceSearchFromParams } from "../../components/workspace-search.js";
import { WorkspaceSkeleton } from "../../components/workspace-skeleton.js";
import { formatMaterialDateTime } from "../../lib/date-format.js";
import { invalidateMaterial } from "../../lib/material-queries.js";
import { RemindersSidebar } from "../reminders/page.js";
import { TaskListDialog } from "./task-list-dialog.js";
import { TaskProjectDialog } from "./task-project-dialog.js";

const taskViews: Array<{ icon: Icon; label: string; value: TaskSystemView }> = [
  { icon: CalendarIcon, label: "Today", value: "today" },
  { icon: ClockIcon, label: "Upcoming", value: "upcoming" },
  { icon: CalendarIcon, label: "Scheduled", value: "scheduled" },
  { icon: CircleCheckIcon, label: "Completed", value: "completed" },
  { icon: XIcon, label: "Cancelled", value: "cancelled" },
  { icon: TrashIcon, label: "Trash", value: "trash" },
];

/** Tasks owns both commitment surfaces, so the contextual sidebar links them as siblings. */
const relatedCommitments: Array<{ icon: Icon; label: string; path: string }> = [
  { icon: ListChecksIcon, label: "Tasks", path: "/tasks" },
  { icon: ListTodoIcon, label: "Reminders", path: "/reminders" },
];

const taskEmptyCopy: Record<TaskSystemView | "list", string> = {
  cancelled: "Cancelled tasks will collect here.",
  completed: "Completed tasks will collect here.",
  list: "Capture the first task worth keeping.",
  scheduled: "Tasks with reserved time will collect here.",
  today: "Nothing is due or reserved for today.",
  trash: "Trashed tasks will collect here until restored.",
  upcoming: "No upcoming deadlines or reserved time.",
};

type TaskPage = { items: Task[]; nextCursor: string | null };

export function TasksCreateButton({ onCreate }: { onCreate: () => void }) {
  return (
    <Button onClick={onCreate} size="sm">
      <PlusIcon aria-hidden="true" data-icon="inline-start" />
      New task
    </Button>
  );
}

export function TasksTopbarControls() {
  return <WorkspaceSearch label="Search tasks" />;
}

export function TasksSidebar({ onNavigate }: { onNavigate: () => void }) {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const remindersActive = location.pathname === "/reminders";
  const [listDialog, setListDialog] = useState<TaskList | null | undefined>(undefined);
  const [projectDialog, setProjectDialog] = useState<TaskProject | null | undefined>(undefined);
  const lists = useQuery({ queryFn: listAllTaskLists, queryKey: ["task-lists"] });
  const projects = useQuery({
    queryFn: listAllTaskProjects,
    queryKey: ["task-projects"],
  });
  const selectedView = taskViewFromParams(searchParams);
  const archiveScope = archiveScopeFromParams(searchParams);
  const selectedProjectId = searchParams.get("project");
  const activeListIds = new Set(
    lists.data?.items.filter((list) => list.availability === "active").map((list) => list.id) ?? [],
  );
  const selectedProject = projects.data?.items.find(
    (project) =>
      project.id === selectedProjectId &&
      project.availability === "active" &&
      project.lifecycle === "open" &&
      activeListIds.has(project.listId),
  );
  const inbox = lists.data?.items.find((list) => list.kind === "inbox");
  const selectedListId = selectedView
    ? null
    : (selectedProject?.listId ?? searchParams.get("list") ?? inbox?.id ?? null);
  const activeLists = lists.data?.items.filter((list) => list.availability === "active") ?? [];
  const activeProjects =
    projects.data?.items.filter(
      (project) =>
        project.availability === "active" &&
        project.lifecycle === "open" &&
        project.listId === selectedListId,
    ) ?? [];

  return (
    <>
      {remindersActive ? (
        <RemindersSidebar onNavigate={onNavigate} />
      ) : (
        <>
          <SidebarGroup>
            <SidebarGroupLabel>Views</SidebarGroupLabel>
            <SidebarGroupContent>
              <nav aria-label="Task views">
                <SidebarMenu>
                  {taskViews.map(({ icon: ViewIcon, label, value }) => {
                    const selected = selectedView === value;
                    return (
                      <SidebarMenuItem key={value}>
                        <SidebarMenuButton asChild isActive={selected}>
                          <Link
                            aria-current={selected ? "page" : undefined}
                            onClick={onNavigate}
                            to={taskPath(searchParams, { view: value })}
                          >
                            <ViewIcon aria-hidden="true" weight={selected ? "Filled" : "Outline"} />
                            <span>{label}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={archiveScope !== null}>
                      <Link
                        aria-current={archiveScope !== null ? "page" : undefined}
                        onClick={onNavigate}
                        to="/tasks?archive=all"
                      >
                        <TrashIcon
                          aria-hidden="true"
                          weight={archiveScope !== null ? "Filled" : "Outline"}
                        />
                        <span>Archive</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </nav>
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarGroup>
            <SidebarGroupLabel>Lists</SidebarGroupLabel>
            <SidebarGroupContent>
              {lists.isPending ? (
                <div aria-label="Loading Lists" className="flex flex-col gap-2" role="status">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-3/4" />
                </div>
              ) : lists.isError ? (
                <DependencyFailure
                  error={lists.error}
                  name="Lists"
                  retry={() => void lists.refetch()}
                />
              ) : (
                <nav aria-label="Task Lists">
                  <SidebarMenu>
                    {activeLists.map((list) => {
                      const selected = selectedView === null && selectedListId === list.id;
                      return (
                        <SidebarMenuItem key={list.id}>
                          <SidebarMenuButton asChild isActive={selected}>
                            <Link
                              aria-current={selected ? "page" : undefined}
                              onClick={onNavigate}
                              to={taskPath(searchParams, {
                                list: list.kind === "inbox" ? null : list.id,
                              })}
                            >
                              {list.kind === "inbox" ? (
                                <InboxIcon
                                  aria-hidden="true"
                                  weight={selected ? "Filled" : "Outline"}
                                />
                              ) : (
                                <ListTodoIcon
                                  aria-hidden="true"
                                  weight={selected ? "Filled" : "Outline"}
                                />
                              )}
                              <span>{list.name}</span>
                            </Link>
                          </SidebarMenuButton>
                          {list.kind !== "inbox" ? (
                            <SidebarMenuAction
                              aria-label={`Manage ${list.name}`}
                              onClick={() => setListDialog(list)}
                              showOnHover
                            >
                              <EditIcon aria-hidden="true" />
                            </SidebarMenuAction>
                          ) : null}
                        </SidebarMenuItem>
                      );
                    })}
                    <SidebarMenuItem>
                      <SidebarMenuButton onClick={() => setListDialog(null)}>
                        <PlusIcon aria-hidden="true" />
                        <span>New List</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  </SidebarMenu>
                </nav>
              )}
            </SidebarGroupContent>
          </SidebarGroup>

          {selectedListId ? (
            <SidebarGroup>
              <SidebarGroupLabel>Projects</SidebarGroupLabel>
              <SidebarGroupContent>
                {projects.isPending ? (
                  <Skeleton aria-label="Loading Projects" className="h-8 w-full" role="status" />
                ) : projects.isError ? (
                  <DependencyFailure
                    error={projects.error}
                    name="Projects"
                    retry={() => void projects.refetch()}
                  />
                ) : (
                  <nav aria-label="Task Projects">
                    <SidebarMenu>
                      {activeProjects.map((project) => {
                        const selected = selectedProjectId === project.id;
                        return (
                          <SidebarMenuItem key={project.id}>
                            <SidebarMenuButton asChild isActive={selected}>
                              <Link
                                aria-current={selected ? "page" : undefined}
                                onClick={onNavigate}
                                to={taskPath(searchParams, {
                                  list: project.listId,
                                  project: project.id,
                                })}
                              >
                                <ListChecksIcon
                                  aria-hidden="true"
                                  weight={selected ? "Filled" : "Outline"}
                                />
                                <span>{project.name}</span>
                              </Link>
                            </SidebarMenuButton>
                            <SidebarMenuAction
                              aria-label={`Manage ${project.name}`}
                              onClick={() => setProjectDialog(project)}
                              showOnHover
                            >
                              <EditIcon aria-hidden="true" />
                            </SidebarMenuAction>
                          </SidebarMenuItem>
                        );
                      })}
                      <SidebarMenuItem>
                        <SidebarMenuButton onClick={() => setProjectDialog(null)}>
                          <PlusIcon aria-hidden="true" />
                          <span>New Project</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    </SidebarMenu>
                  </nav>
                )}
              </SidebarGroupContent>
            </SidebarGroup>
          ) : null}
        </>
      )}

      <SidebarGroup>
        <SidebarGroupLabel>Related</SidebarGroupLabel>
        <SidebarGroupContent>
          <nav aria-label="Related commitments">
            <SidebarMenu>
              {relatedCommitments.map(({ icon: RelatedIcon, label, path }) => {
                const selected = path === (remindersActive ? "/reminders" : "/tasks");
                return (
                  <SidebarMenuItem key={path}>
                    <SidebarMenuButton asChild isActive={selected}>
                      <Link
                        aria-current={selected ? "page" : undefined}
                        onClick={onNavigate}
                        to={path}
                      >
                        <RelatedIcon aria-hidden="true" weight={selected ? "Filled" : "Outline"} />
                        <span>{label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </nav>
        </SidebarGroupContent>
      </SidebarGroup>

      {listDialog !== undefined ? (
        <TaskListDialog
          close={() => setListDialog(undefined)}
          list={listDialog ?? undefined}
          lists={activeLists}
        />
      ) : null}
      {projectDialog !== undefined && selectedListId ? (
        <TaskProjectDialog
          close={() => setProjectDialog(undefined)}
          listId={selectedListId}
          lists={activeLists}
          project={projectDialog ?? undefined}
          projects={projects.data?.items ?? []}
        />
      ) : null}
    </>
  );
}

export function TasksPage({
  onEdit,
  timeZone,
}: {
  onEdit: (task: Task) => void;
  timeZone: string;
}) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const openedTaskId = useRef<string | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<unknown>(null);
  const selectedView = taskViewFromParams(searchParams);
  const archiveScope = archiveScopeFromParams(searchParams);
  const selectedProjectId = searchParams.get("project");
  const requestedListId = searchParams.get("list");
  const search = workspaceSearchFromParams(searchParams).trim();
  const requestedTaskId = searchParams.get("task");
  const lifecycleFilter = lifecycleFilterFromParams(searchParams);
  const lists = useQuery({ queryFn: listAllTaskLists, queryKey: ["task-lists"] });
  const projects = useQuery({
    queryFn: listAllTaskProjects,
    queryKey: ["task-projects"],
  });
  const activeListIds = new Set(
    lists.data?.items.filter((list) => list.availability === "active").map((list) => list.id) ?? [],
  );
  const selectedProject = projects.data?.items.find((project) => {
    if (project.id !== selectedProjectId) return false;
    if (archiveScope === "project") {
      return project.availability === "archived" || project.lifecycle !== "open";
    }
    return (
      project.availability === "active" &&
      project.lifecycle === "open" &&
      activeListIds.has(project.listId)
    );
  });
  const inbox = lists.data?.items.find((list) => list.kind === "inbox");
  const requestedList = lists.data?.items.find((list) => {
    if (list.id !== requestedListId) return false;
    return archiveScope === "list"
      ? list.availability === "archived"
      : list.availability === "active";
  });
  const selectedListId =
    selectedView || archiveScope === "all"
      ? null
      : (selectedProject?.listId ?? requestedList?.id ?? inbox?.id ?? null);
  const canonicalPath =
    archiveScope === "all"
      ? "/tasks?archive=all"
      : archiveScope === "project" && selectedProject
        ? `/tasks?archive=project&project=${selectedProject.id}`
        : archiveScope === "list" && requestedList
          ? `/tasks?archive=list&list=${requestedList.id}`
          : archiveScope
            ? "/tasks?archive=all"
            : selectedView
              ? taskPath(searchParams, { view: selectedView }, true)
              : selectedProject
                ? taskPath(
                    searchParams,
                    {
                      list: selectedProject.listId,
                      project: selectedProject.id,
                    },
                    true,
                  )
                : requestedList
                  ? taskPath(
                      searchParams,
                      {
                        list: requestedList.kind === "inbox" ? null : requestedList.id,
                      },
                      true,
                    )
                  : taskPath(searchParams, { list: null }, true);
  const currentPath = `/tasks${searchParams.size > 0 ? `?${searchParams.toString()}` : ""}`;
  useEffect(() => {
    if (lists.isSuccess && projects.isSuccess && canonicalPath !== currentPath) {
      navigate(canonicalPath, { replace: true });
    }
  }, [canonicalPath, currentPath, lists.isSuccess, navigate, projects.isSuccess]);
  const ready =
    archiveScope !== "all" &&
    (selectedView !== null || (lists.isSuccess && projects.isSuccess && selectedListId));
  const query = {
    ...(selectedView ? { view: selectedView } : {}),
    ...(!selectedView && selectedListId && !selectedProject ? { listId: selectedListId } : {}),
    ...(!selectedView && selectedProject ? { projectId: selectedProject.id } : {}),
    ...(archiveScope === "project" ? { includeUnavailableProject: true } : {}),
    ...(!selectedView && archiveScope === null ? { lifecycle: "open" as const } : {}),
    ...taskTimingFiltersFromParams(searchParams),
    ...(!selectedView && lifecycleFilter ? { lifecycle: lifecycleFilter } : {}),
    ...(search ? { query: search } : {}),
  };
  const tasks = useInfiniteQuery<
    TaskPage,
    Error,
    InfiniteData<TaskPage>,
    readonly unknown[],
    string | null
  >({
    enabled: Boolean(ready),
    getNextPageParam: (page) => page.nextCursor,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.listTasks({ ...query, limit: 100, ...(pageParam ? { cursor: pageParam } : {}) }),
    queryKey: ["tasks", query],
  });
  const loadMoreTasks = async () => {
    setLoadMoreError(null);
    try {
      const result = await tasks.fetchNextPage();
      if (result.isFetchNextPageError) setLoadMoreError(result.error);
    } catch (error) {
      setLoadMoreError(error);
    }
  };
  const taskItems = tasks.data?.pages.flatMap((page) => page.items) ?? [];
  useEffect(() => {
    if (!requestedTaskId) {
      openedTaskId.current = null;
      return;
    }
    const requestedTask = taskItems.find((task) => task.id === requestedTaskId);
    if (requestedTask && openedTaskId.current !== requestedTask.id) {
      openedTaskId.current = requestedTask.id;
      onEdit(requestedTask);
    }
  }, [onEdit, requestedTaskId, taskItems]);

  if (lists.isPending || projects.isPending || (archiveScope !== "all" && tasks.isPending)) {
    return <WorkspaceSkeleton kind="tasks" />;
  }
  if (lists.isError) return <InlineError error={lists.error} />;
  if (projects.isError) return <InlineError error={projects.error} />;
  if (archiveScope === "all") {
    const archivedLists = lists.data.items.filter((list) => list.availability === "archived");
    const terminalProjects = projects.data.items.filter(
      (project) => project.availability === "archived" || project.lifecycle !== "open",
    );
    return <TaskArchive lists={archivedLists} projects={terminalProjects} />;
  }
  if (tasks.isError && !tasks.data) {
    return (
      <div className="narrow-page">
        <InlineError error={tasks.error} />
        <Button onClick={() => void tasks.refetch()} size="sm" variant="outline">
          Retry Tasks
        </Button>
      </div>
    );
  }

  const listById = new Map(lists.data.items.map((list) => [list.id, list]));
  const projectById = new Map(projects.data.items.map((project) => [project.id, project]));
  const emptyKey = selectedView ?? "list";
  const scopeName =
    selectedProject?.name ??
    requestedList?.name ??
    (selectedView ? taskViews.find((view) => view.value === selectedView)?.label : null) ??
    inbox?.name ??
    "Tasks";
  const scopeList =
    requestedList ?? (selectedProject ? listById.get(selectedProject.listId) : undefined);

  return (
    <div className="narrow-page flex flex-col gap-4">
      <TaskScopeHeader
        {...(scopeList ? { list: scopeList } : {})}
        {...(archiveScope === null && !selectedView
          ? { taskCount: taskItems.length, taskLifecycle: lifecycleFilter ?? "open" }
          : {})}
        {...(selectedProject ? { project: selectedProject } : {})}
        scopeName={scopeName}
      />
      <TaskFilters searchParams={searchParams} timeZone={timeZone} />
      {taskItems.length === 0 ? (
        search ? (
          <EmptyState icon={<SearchIcon />} title="No matching tasks">
            Try another title or note.
          </EmptyState>
        ) : (
          <EmptyState icon={<ListChecksIcon />} title="Nothing here yet">
            {taskEmptyCopy[emptyKey]}
          </EmptyState>
        )
      ) : (
        <ItemGroup>
          {taskItems.map((task) => {
            const list = listById.get(task.listId);
            const project = task.projectId ? projectById.get(task.projectId) : undefined;
            return (
              <TaskRow
                key={task.id}
                {...(selectedView !== null && list ? { list } : {})}
                onEdit={() => {
                  const params = new URLSearchParams(searchParams);
                  params.set("task", task.id);
                  openedTaskId.current = task.id;
                  onEdit(task);
                  navigate(`/tasks?${params.toString()}`);
                }}
                {...(!selectedProjectId && project ? { project } : {})}
                task={task}
                timeZone={timeZone}
              />
            );
          })}
          {tasks.hasNextPage ? (
            <Button
              disabled={tasks.isFetchingNextPage}
              onClick={() => void loadMoreTasks()}
              variant="outline"
            >
              {tasks.isFetchingNextPage ? "Loading more…" : "Load more Tasks"}
            </Button>
          ) : null}
          {loadMoreError ? (
            <div className="flex flex-col items-start gap-2">
              <InlineError error={loadMoreError} />
              <Button onClick={() => void loadMoreTasks()} size="sm" variant="outline">
                Retry loading more Tasks
              </Button>
            </div>
          ) : null}
        </ItemGroup>
      )}
    </div>
  );
}

function TaskScopeHeader({
  list,
  project,
  scopeName,
  taskCount,
  taskLifecycle,
}: {
  list?: TaskList;
  project?: TaskProject;
  scopeName: string;
  taskCount?: number;
  taskLifecycle?: "cancelled" | "completed" | "open";
}) {
  const targetDate = project?.targetDate
    ? new Date(`${project.targetDate}T12:00:00.000Z`).toLocaleDateString("en-US", {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
        year: "numeric",
      })
    : null;
  return (
    <header className="flex flex-col gap-1 border-b border-border pb-3">
      {project && list ? (
        <p className="text-xs font-medium text-muted-foreground">{list.name}</p>
      ) : null}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-heading text-xl font-medium">{scopeName}</h1>
        {taskCount !== undefined && taskLifecycle ? (
          <span className="text-xs text-muted-foreground">
            {taskCount} {taskLifecycle} {taskCount === 1 ? "task" : "tasks"}
          </span>
        ) : null}
      </div>
      {project?.why ? <p className="text-sm text-muted-foreground">{project.why}</p> : null}
      {targetDate ? <p className="text-xs text-muted-foreground">Target {targetDate}</p> : null}
      {!project && list?.description ? (
        <p className="text-sm text-muted-foreground">{list.description}</p>
      ) : null}
    </header>
  );
}

function DependencyFailure({
  error,
  name,
  retry,
}: {
  error: unknown;
  name: "Lists" | "Projects";
  retry: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-2 px-2">
      <p className="text-xs text-destructive" role="alert">
        {errorMessage(error)}
      </p>
      <Button onClick={retry} size="sm" variant="ghost">
        Retry {name}
      </Button>
    </div>
  );
}

export function TaskRow({
  list,
  onEdit,
  project,
  recommendation,
  task,
  timeZone,
}: {
  list?: TaskList;
  onEdit: () => void;
  project?: TaskProject;
  recommendation?: DailyBrief["recommendedTasks"][number];
  task: Task;
  timeZone: string;
}) {
  const queryClient = useQueryClient();
  const transition = useMutation({
    mutationFn: () =>
      task.lifecycle === "completed"
        ? api.reopenTask(task.id, { expectedRevision: task.revision })
        : api.completeTask(task.id, { expectedRevision: task.revision }),
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: async () => {
      toast.success(task.lifecycle === "completed" ? "Task reopened." : "Task completed.");
      await invalidateMaterial(queryClient);
    },
  });
  const isCompleted = task.lifecycle === "completed";
  const isTrashed = task.deletedAt !== null;
  const timing = taskTiming(task, timeZone);
  const description = taskDescription(task, list, project);
  return (
    <TaskItem data-completed={isCompleted}>
      <TaskItemCompletion>
        {task.lifecycle === "cancelled" || isTrashed ? null : (
          <Checkbox
            aria-label={`${isCompleted ? "Reopen" : "Complete"} ${task.title}`}
            checked={isCompleted}
            disabled={transition.isPending}
            onCheckedChange={() => transition.mutate()}
          />
        )}
      </TaskItemCompletion>
      <TaskItemPrimaryAction aria-label={`Open ${task.title}`} onClick={onEdit}>
        <TaskItemContent>
          <TaskItemTitle>{task.title}</TaskItemTitle>
          {timing ? <TaskItemDue>{timing}</TaskItemDue> : null}
          {description ? <TaskItemDescription>{description}</TaskItemDescription> : null}
          {recommendation ? (
            <TaskItemDescription>{recommendationCopy(recommendation)}</TaskItemDescription>
          ) : null}
          {task.tags.length > 0 || task.priority !== "medium" ? (
            <TaskItemTags aria-label="Task tags" className="mt-1 pl-0">
              {task.priority !== "medium" ? (
                <Badge asChild variant="outline">
                  <li>{task.priority === "high" ? "High priority" : "Low priority"}</li>
                </Badge>
              ) : null}
              {task.tags.map((tag) => (
                <Badge asChild key={tag} variant="outline">
                  <li>{tag}</li>
                </Badge>
              ))}
            </TaskItemTags>
          ) : null}
        </TaskItemContent>
      </TaskItemPrimaryAction>
      {task.lifecycle !== "open" || isTrashed ? (
        <TaskItemMetadata>
          <span className="text-[0.625rem] font-medium tracking-[0.08em] text-muted-foreground uppercase">
            {taskLifecycleLabel(task)}
          </span>
        </TaskItemMetadata>
      ) : null}
    </TaskItem>
  );
}

function taskViewFromParams(searchParams: URLSearchParams): TaskSystemView | null {
  const requestedView = searchParams.get("view");
  return taskViews.some((view) => view.value === requestedView)
    ? (requestedView as TaskSystemView)
    : null;
}

function lifecycleFilterFromParams(
  searchParams: URLSearchParams,
): "cancelled" | "completed" | "open" | null {
  const lifecycle = searchParams.get("lifecycle");
  return lifecycle === "open" || lifecycle === "completed" || lifecycle === "cancelled"
    ? lifecycle
    : null;
}

const taskTimingFilterKeys = [
  "dueAfter",
  "dueBefore",
  "scheduledAfter",
  "scheduledBefore",
] as const;

function taskTimingFiltersFromParams(searchParams: URLSearchParams) {
  return Object.fromEntries(
    taskTimingFilterKeys.flatMap((key) => {
      const value = searchParams.get(key);
      return value ? [[key, value]] : [];
    }),
  );
}

function TaskFilters({
  searchParams,
  timeZone,
}: {
  searchParams: URLSearchParams;
  timeZone: string;
}) {
  const navigate = useNavigate();
  const selectedView = taskViewFromParams(searchParams);
  const activeCount =
    taskTimingFilterKeys.filter((key) => searchParams.has(key)).length +
    (lifecycleFilterFromParams(searchParams) && !selectedView ? 1 : 0);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const next = new URLSearchParams(searchParams);
    next.delete("task");
    for (const key of taskTimingFilterKeys) {
      const value = String(form.get(key) ?? "");
      if (value) next.set(key, dateTimeLocalToIso(value, timeZone));
      else next.delete(key);
    }
    const lifecycle = String(form.get("lifecycle") ?? "");
    if (!selectedView && lifecycle) next.set("lifecycle", lifecycle);
    else next.delete("lifecycle");
    navigate(`/tasks?${next.toString()}`);
  };
  return (
    <details className="rounded-lg border border-border px-3 py-2">
      <summary className="cursor-pointer text-sm font-medium">
        Filters{activeCount > 0 ? ` (${activeCount})` : ""}
      </summary>
      <form className="mt-3 flex flex-col gap-3" onSubmit={submit}>
        {!selectedView ? (
          <Field>
            <FieldLabel htmlFor="task-filter-lifecycle">Lifecycle</FieldLabel>
            <NativeSelect
              defaultValue={lifecycleFilterFromParams(searchParams) ?? "open"}
              id="task-filter-lifecycle"
              name="lifecycle"
            >
              <NativeSelectOption value="open">Open</NativeSelectOption>
              <NativeSelectOption value="completed">Completed</NativeSelectOption>
              <NativeSelectOption value="cancelled">Cancelled</NativeSelectOption>
            </NativeSelect>
          </Field>
        ) : null}
        <FieldGroup className="grid gap-3 sm:grid-cols-2">
          {taskTimingFilterKeys.map((key) => (
            <Field key={key}>
              <FieldLabel htmlFor={`task-filter-${key}`}>{taskTimingFilterLabel(key)}</FieldLabel>
              <Input
                defaultValue={toDateTimeLocal(searchParams.get(key), timeZone)}
                id={`task-filter-${key}`}
                name={key}
                type="datetime-local"
              />
            </Field>
          ))}
        </FieldGroup>
        <div className="flex gap-2">
          <Button size="sm" type="submit">
            Apply filters
          </Button>
          {activeCount > 0 ? (
            <Button
              onClick={() => {
                const next = new URLSearchParams(searchParams);
                for (const key of [...taskTimingFilterKeys, "lifecycle"]) next.delete(key);
                navigate(`/tasks?${next.toString()}`);
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              Clear
            </Button>
          ) : null}
        </div>
      </form>
    </details>
  );
}

function taskTimingFilterLabel(key: (typeof taskTimingFilterKeys)[number]) {
  return {
    dueAfter: "Deadline after",
    dueBefore: "Deadline before",
    scheduledAfter: "Reserved after",
    scheduledBefore: "Reserved before",
  }[key];
}

type TaskArchiveScope = "all" | "list" | "project";

function archiveScopeFromParams(searchParams: URLSearchParams): TaskArchiveScope | null {
  const scope = searchParams.get("archive");
  return scope === "all" || scope === "list" || scope === "project" ? scope : null;
}

function TaskArchive({ lists, projects }: { lists: TaskList[]; projects: TaskProject[] }) {
  return (
    <div className="narrow-page flex flex-col gap-6">
      <header>
        <h1 className="font-heading text-xl font-medium">Archive</h1>
        <p className="text-sm text-muted-foreground">
          Read the Tasks retained in archived Lists and finished Projects.
        </p>
      </header>
      <section aria-labelledby="archived-lists-heading">
        <h2 className="mb-2 font-heading text-base font-medium" id="archived-lists-heading">
          Lists
        </h2>
        {lists.length > 0 ? (
          <nav aria-label="Archived Lists" className="flex flex-col gap-1">
            {lists.map((list) => (
              <Button asChild className="justify-start" key={list.id} variant="ghost">
                <Link to={`/tasks?archive=list&list=${list.id}`}>{list.name}</Link>
              </Button>
            ))}
          </nav>
        ) : (
          <p className="text-sm text-muted-foreground">No archived Lists.</p>
        )}
      </section>
      <section aria-labelledby="finished-projects-heading">
        <h2 className="mb-2 font-heading text-base font-medium" id="finished-projects-heading">
          Projects
        </h2>
        {projects.length > 0 ? (
          <nav aria-label="Finished Projects" className="flex flex-col gap-1">
            {projects.map((project) => (
              <Button asChild className="justify-start" key={project.id} variant="ghost">
                <Link to={`/tasks?archive=project&project=${project.id}`}>{project.name}</Link>
              </Button>
            ))}
          </nav>
        ) : (
          <p className="text-sm text-muted-foreground">No finished Projects.</p>
        )}
      </section>
    </div>
  );
}

function taskPath(
  current: URLSearchParams,
  selection: { list?: string | null; project?: string | null; view?: TaskSystemView },
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
  ]) {
    const value = current.get(key);
    if (value) params.set(key, value);
  }
  if (preserveTask && current.get("task")) params.set("task", current.get("task") as string);
  if (selection.view) params.set("view", selection.view);
  if (selection.list) params.set("list", selection.list);
  if (selection.project) params.set("project", selection.project);
  const query = params.toString();
  return query ? `/tasks?${query}` : "/tasks";
}

function toDateTimeLocal(value: string | null, timeZone: string) {
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

function dateTimeLocalToIso(value: string, timeZone: string) {
  const [dateValue, timeValue] = value.split("T");
  const date = parseLocalDate(dateValue as string);
  const [hour, minute] = (timeValue as string).split(":").map(Number);
  return localDateTimeToUtc(
    date,
    (hour as number) * 60 + (minute as number),
    timeZone,
  ).toISOString();
}

function taskTiming(task: Task, timeZone: string): string | null {
  const timing = [
    task.scheduledAt ? `Reserved ${formatMaterialDateTime(task.scheduledAt, timeZone)}` : null,
    task.dueAt ? `Due ${formatMaterialDateTime(task.dueAt, timeZone)}` : null,
  ].filter((detail): detail is string => detail !== null);
  return timing.length > 0 ? timing.join(" · ") : null;
}

function taskDescription(task: Task, list?: TaskList, project?: TaskProject): string | null {
  const details = [
    project && list ? `${list.name} / ${project.name}` : (project?.name ?? list?.name),
    task.estimateMinutes ? `${task.estimateMinutes} min` : null,
    task.notes || null,
  ].filter((detail): detail is string => Boolean(detail));
  return details.length > 0 ? details.join(" · ") : null;
}

const maximumTaskContainerPages = 100;

export async function loadAllTaskContainerPages<T>(
  loadPage: (query: { cursor?: string; limit: number }) => Promise<{
    items: T[];
    nextCursor: string | null;
  }>,
): Promise<{ items: T[]; nextCursor: null }> {
  const items: T[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  for (let pageNumber = 0; pageNumber < maximumTaskContainerPages; pageNumber += 1) {
    const page = await loadPage({ limit: 100, ...(cursor ? { cursor } : {}) });
    items.push(...page.items);
    if (page.nextCursor === null) return { items, nextCursor: null };
    if (seenCursors.has(page.nextCursor)) {
      throw new Error("Task container pagination returned a repeated cursor.");
    }
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  throw new Error(`Task container pagination exceeded ${maximumTaskContainerPages} pages.`);
}

export async function listAllTaskLists() {
  return loadAllTaskContainerPages<TaskList>(api.listTaskLists);
}

export async function listAllTaskProjects() {
  return loadAllTaskContainerPages<TaskProject>(api.listTaskProjects);
}

function taskLifecycleLabel(task: Task) {
  if (task.deletedAt) return "Trash";
  return { cancelled: "Cancelled", completed: "Completed", open: "Open" }[task.lifecycle];
}

function recommendationCopy(recommendation: DailyBrief["recommendedTasks"][number]) {
  const urgency = {
    due_today: "Due today",
    inbox: "Captured for later",
    next: "Ready next",
    overdue: "Overdue",
  }[recommendation.urgency];
  const capacity = {
    does_not_fit: "does not fit in the remaining planning window",
    fits_remaining_time: "fits in the remaining planning window",
    needs_estimate: "needs an estimate before it can be planned",
  }[recommendation.capacity];
  return `${urgency} · ${capacity}`;
}
