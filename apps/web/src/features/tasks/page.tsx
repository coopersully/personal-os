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
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  ChevronRightIcon,
  ListChecksIcon,
  MoreHorizontalIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
  XIcon,
} from "@/components/icons";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from "@/components/responsive-dialog";
import {
  TaskItem,
  TaskItemActions,
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ItemGroup } from "@/components/ui/item";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  WorkspaceSecondaryAppBar,
  WorkspaceSecondaryAppBarActions,
  WorkspaceSecondaryAppBarContent,
} from "@/components/workspace-secondary-app-bar";
import { cn } from "@/lib/utils";
import { api, errorMessage } from "../../api.js";
import { InlineError } from "../../components/async-state.js";
import { WorkspaceSearch, workspaceSearchFromParams } from "../../components/workspace-search.js";
import { WorkspaceSkeleton } from "../../components/workspace-skeleton.js";
import { formatMaterialDateTime, formatRelativeMaterialDateTime } from "../../lib/date-format.js";
import { invalidateMaterial } from "../../lib/material-queries.js";
import { type DatePreset, datePresets, identifyPreset, presetBounds } from "./task-filter-presets";
import {
  archiveScopeFromParams,
  TaskContainerActions,
  TaskNavigation,
  taskPath,
  taskViewFromParams,
  taskViews,
} from "./task-navigation";

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

export function TasksCreateButton({
  onCreate,
  onCreateReminder,
}: {
  onCreate: () => void;
  onCreateReminder?: () => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <Button onClick={onCreate} size="sm">
        <PlusIcon aria-hidden="true" data-icon="inline-start" />
        New task
      </Button>
      {onCreateReminder ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button aria-label="More create options" size="icon-sm" variant="ghost">
              <MoreHorizontalIcon aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={onCreateReminder}>New reminder</DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

export function TasksTopbarControls() {
  return <WorkspaceSearch label="Search tasks and reminders" />;
}

export function TasksSidebar({ onNavigate }: { onNavigate: () => void }) {
  const lists = useQuery({ queryFn: listAllTaskLists, queryKey: ["task-lists"] });
  const projects = useQuery({ queryFn: listAllTaskProjects, queryKey: ["task-projects"] });
  const activeLists = lists.data?.items.filter((list) => list.availability === "active") ?? [];
  const activeListIds = new Set(activeLists.map((list) => list.id));
  return (
    <TaskNavigation
      lists={activeLists}
      projects={
        projects.data?.items.filter(
          (project) =>
            project.availability === "active" &&
            project.lifecycle === "open" &&
            activeListIds.has(project.listId),
        ) ?? []
      }
      onNavigate={onNavigate}
      status={
        <>
          {lists.isPending ? (
            <Skeleton aria-label="Loading Lists" className="h-8 w-full" role="status" />
          ) : null}
          {lists.isError ? (
            <DependencyFailure
              error={lists.error}
              name="Lists"
              retry={() => void lists.refetch()}
            />
          ) : null}
          {projects.isPending ? (
            <Skeleton aria-label="Loading Projects" className="h-8 w-full" role="status" />
          ) : null}
          {projects.isError ? (
            <DependencyFailure
              error={projects.error}
              name="Projects"
              retry={() => void projects.refetch()}
            />
          ) : null}
        </>
      }
    />
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

  const listById = new Map(lists.data?.items.map((list) => [list.id, list]) ?? []);
  const projectById = new Map(projects.data?.items.map((project) => [project.id, project]) ?? []);
  const emptyKey = selectedView ?? "list";
  const scopeName =
    archiveScope === "all"
      ? "Archive"
      : (selectedProject?.name ??
        requestedList?.name ??
        (selectedView ? taskViews.find((view) => view.value === selectedView)?.label : null) ??
        inbox?.name ??
        "Tasks");
  const scopeList =
    requestedList ??
    (selectedProject
      ? listById.get(selectedProject.listId)
      : selectedListId
        ? listById.get(selectedListId)
        : undefined);

  const renderContent = () => {
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

    return (
      <div className="narrow-page flex flex-col gap-4">
        {taskItems.length === 0 ? (
          search ||
          Object.keys(taskTimingFiltersFromParams(searchParams)).length > 0 ||
          lifecycleFilter ? (
            <EmptyState icon={<SearchIcon />} title="No matching tasks">
              {search
                ? "Try another title or note."
                : "Try a different filter or clear the current filters."}
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
                  dense
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
  };
  return (
    <>
      <WorkspaceSecondaryAppBar aria-label="Tasks page controls">
        <WorkspaceSecondaryAppBarContent className="flex-wrap gap-x-3 gap-y-2">
          <TaskScopeHeader
            {...(scopeList ? { list: scopeList } : {})}
            {...(archiveScope === null && tasks.data
              ? {
                  taskCount: taskItems.length,
                  hasMore: tasks.hasNextPage,
                  ...(!selectedView ? { taskLifecycle: lifecycleFilter ?? "open" } : {}),
                }
              : {})}
            {...(selectedProject ? { project: selectedProject } : {})}
            scopeName={scopeName}
          />
          {archiveScope === null ? (
            <TaskFilterChips searchParams={searchParams} timeZone={timeZone} />
          ) : null}
        </WorkspaceSecondaryAppBarContent>
        {archiveScope === null ? (
          <WorkspaceSecondaryAppBarActions>
            <TaskFilters searchParams={searchParams} timeZone={timeZone} />
            {!selectedView && scopeList && lists.data && projects.data ? (
              <TaskContainerActions
                list={scopeList}
                {...(selectedProject ? { project: selectedProject } : {})}
                lists={lists.data.items.filter((list) => list.availability === "active")}
                projects={projects.data.items}
              />
            ) : null}
          </WorkspaceSecondaryAppBarActions>
        ) : null}
      </WorkspaceSecondaryAppBar>
      {renderContent()}
    </>
  );
}

export function TaskScopeHeader({
  list,
  project,
  scopeName,
  taskCount,
  taskLifecycle,
  hasMore = false,
}: {
  list?: TaskList;
  project?: TaskProject;
  scopeName: string;
  taskCount?: number;
  hasMore?: boolean;
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
    <header className="flex min-w-0 flex-col gap-1">
      {project && list ? (
        <p className="text-xs font-medium text-muted-foreground">{list.name}</p>
      ) : null}
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="min-w-0 break-words font-heading text-sm font-medium">{scopeName}</h1>
        {taskCount !== undefined ? (
          <span className="text-xs text-muted-foreground">
            {taskCount}
            {hasMore ? "+" : ""} {taskLifecycle ? `${taskLifecycle} ` : ""}
            {taskCount === 1 && !hasMore ? "task" : "tasks"}
          </span>
        ) : null}
      </div>
      {project?.why ? (
        <p className="line-clamp-1 text-xs text-muted-foreground" title={project.why}>
          {project.why}
        </p>
      ) : null}
      {targetDate ? <p className="text-xs text-muted-foreground">Target {targetDate}</p> : null}
      {!project && list?.description ? (
        <p className="line-clamp-1 text-xs text-muted-foreground" title={list.description}>
          {list.description}
        </p>
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
  className,
  compact = false,
  dense = false,
  onEdit,
  project,
  recommendation,
  task,
  timeZone,
}: {
  list?: TaskList;
  className?: string;
  compact?: boolean;
  dense?: boolean;
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
  const remove = useMutation({
    mutationFn: () => api.trashTask(task.id, { expectedRevision: task.revision }),
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: async (trashed) => {
      toast.success("Task moved to Trash.", {
        action: {
          label: "Undo",
          onClick: async () => {
            try {
              await api.restoreTask(trashed.id, { expectedRevision: trashed.revision });
              await invalidateMaterial(queryClient);
            } catch (error) {
              toast.error(errorMessage(error));
            }
          },
        },
      });
      await invalidateMaterial(queryClient);
    },
  });
  const overdue =
    task.lifecycle === "open" &&
    !isTrashed &&
    task.dueAt !== null &&
    new Date(task.dueAt).getTime() < Date.now();
  const timing = taskTiming(task, timeZone);
  const description = taskDescription(task, list, project, !dense);
  return (
    <TaskItem
      className={cn(className, dense && "task-workspace-row min-h-0 items-center")}
      data-completed={isCompleted}
      data-status={recommendation?.urgency === "next" ? "next" : undefined}
      data-priority={task.priority}
      size={dense ? "xs" : "default"}
    >
      <TaskItemCompletion className={dense ? "self-center pt-0" : undefined}>
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
          <TaskItemTitle className={dense && !timing && !description ? "pr-6" : undefined}>
            {task.title}
          </TaskItemTitle>
          {dense ? (
            <>
              {task.priority !== "medium" ? (
                <span className="sr-only">
                  {task.priority === "high" ? "High priority" : "Low priority"}
                </span>
              ) : null}
              {timing || description ? (
                <TaskItemDescription
                  className="line-clamp-1 pr-7"
                  title={[timing, description].filter(Boolean).join(" · ")}
                >
                  {timing ? (
                    <span className={overdue ? "text-destructive" : undefined}>{timing}</span>
                  ) : null}
                  {description && timing ? " · " : ""}
                  {description ? <span>{description}</span> : null}
                </TaskItemDescription>
              ) : null}
            </>
          ) : null}
          {!dense && timing ? (
            <TaskItemDue className={overdue ? "text-destructive" : undefined}>{timing}</TaskItemDue>
          ) : null}
          {!dense && !compact && description ? (
            <TaskItemDescription>{description}</TaskItemDescription>
          ) : null}
          {!dense && !compact && recommendation ? (
            <TaskItemDescription>{recommendationCopy(recommendation)}</TaskItemDescription>
          ) : null}
          {!dense && !compact && (task.tags.length > 0 || task.priority !== "medium") ? (
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
      {!isTrashed ? (
        <TaskItemActions>
          {dense ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label={`${task.title} options`}
                  title="Task options"
                  size="icon-xs"
                  variant="ghost"
                >
                  <MoreHorizontalIcon aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  <DropdownMenuItem onSelect={onEdit}>Open task</DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={remove.isPending}
                    onSelect={() => remove.mutate()}
                    variant="destructive"
                  >
                    <TrashIcon aria-hidden="true" />
                    Move to Trash
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button
              aria-label={`Remove ${task.title}`}
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
              size="icon-xs"
              variant="ghost"
            >
              <TrashIcon />
            </Button>
          )}
        </TaskItemActions>
      ) : null}
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

function TaskFilterChips({
  searchParams,
  timeZone,
}: {
  searchParams: URLSearchParams;
  timeZone: string;
}) {
  const navigate = useNavigate();
  const active = taskTimingFilterKeys.filter((key) => searchParams.get(key));
  const lifecycle = !taskViewFromParams(searchParams) && lifecycleFilterFromParams(searchParams);
  if (!active.length && !lifecycle) return null;
  const remove = (key: string) => {
    const next = new URLSearchParams(searchParams);
    next.delete(key);
    next.delete("task");
    navigate(next.size ? `/tasks?${next}` : "/tasks");
  };
  return (
    <fieldset aria-label="Active task filters" className="flex min-w-0 flex-wrap gap-1">
      {active.map((key) => {
        const label = `${taskTimingFilterLabel(key)} ${formatMaterialDateTime(searchParams.get(key) as string, timeZone)}`;
        return (
          <Button
            key={key}
            aria-label={`Remove ${label}`}
            onClick={() => remove(key)}
            size="xs"
            variant="secondary"
            className="max-w-full"
          >
            <span className="truncate">{label}</span>
            <XIcon aria-hidden="true" data-icon="inline-end" />
          </Button>
        );
      })}
      {lifecycle ? (
        <Button
          aria-label={`Remove ${lifecycle} filter`}
          onClick={() => remove("lifecycle")}
          size="xs"
          variant="secondary"
        >
          {lifecycle === "completed"
            ? "Completed"
            : lifecycle === "cancelled"
              ? "Cancelled"
              : "Open"}
          <XIcon aria-hidden="true" data-icon="inline-end" />
        </Button>
      ) : null}
    </fieldset>
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
  const [open, setOpen] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [customRanges, setCustomRanges] = useState({ due: false, scheduled: false });
  const initialValues = () =>
    Object.fromEntries(
      taskTimingFilterKeys.map((key) => [key, searchParams.get(key) ?? ""]),
    ) as Record<(typeof taskTimingFilterKeys)[number], string>;
  const [values, setValues] = useState(initialValues);
  const selectedView = taskViewFromParams(searchParams);
  const activeCount =
    taskTimingFilterKeys.filter((key) => searchParams.get(key)).length +
    (lifecycleFilterFromParams(searchParams) && !selectedView ? 1 : 0);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const next = new URLSearchParams(searchParams);
    next.delete("task");
    for (const key of taskTimingFilterKeys) {
      if (values[key]) next.set(key, values[key]);
      else next.delete(key);
    }
    const lifecycle = String(form.get("lifecycle") ?? "");
    if (!selectedView && lifecycle && lifecycle !== "open") next.set("lifecycle", lifecycle);
    else next.delete("lifecycle");
    navigate(next.size ? `/tasks?${next}` : "/tasks");
    setOpen(false);
  };
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(value) => {
        if (value) {
          setValues(initialValues());
          setAdvanced(false);
          setCustomRanges({ due: false, scheduled: false });
        }
        setOpen(value);
      }}
    >
      <ResponsiveDialogTrigger asChild>
        <Button size="sm" variant="outline">
          Filters{activeCount > 0 ? ` (${activeCount})` : ""}
        </Button>
      </ResponsiveDialogTrigger>
      <ResponsiveDialogContent aria-describedby={undefined}>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Task filters</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>
        <ResponsiveDialogBody>
          <form id="task-filters-form" onSubmit={submit}>
            <FieldGroup>
              {!selectedView ? (
                <Field>
                  <FieldLabel htmlFor="task-filter-lifecycle">Show</FieldLabel>
                  <NativeSelect
                    defaultValue={lifecycleFilterFromParams(searchParams) ?? "open"}
                    id="task-filter-lifecycle"
                    name="lifecycle"
                  >
                    <NativeSelectOption value="open">Open tasks</NativeSelectOption>
                    <NativeSelectOption value="completed">Completed tasks</NativeSelectOption>
                    <NativeSelectOption value="cancelled">Cancelled tasks</NativeSelectOption>
                  </NativeSelect>
                </Field>
              ) : null}
              {(["due", "scheduled"] as const).map((kind) => {
                const after = kind === "due" ? "dueAfter" : "scheduledAfter";
                const before = kind === "due" ? "dueBefore" : "scheduledBefore";
                return (
                  <Field key={kind}>
                    <FieldLabel htmlFor={`task-filter-${kind}-preset`}>
                      {kind === "due" ? "Deadline" : "Reserved time"}
                    </FieldLabel>
                    <NativeSelect
                      id={`task-filter-${kind}-preset`}
                      value={
                        customRanges[kind]
                          ? "custom"
                          : identifyPreset(
                              { after: values[after], before: values[before] },
                              timeZone,
                            )
                      }
                      onChange={(event) => {
                        const preset = event.target.value as DatePreset;
                        setCustomRanges((previous) => ({
                          ...previous,
                          [kind]: preset === "custom",
                        }));
                        if (preset === "custom") {
                          setAdvanced(true);
                          return;
                        }
                        const bounds = presetBounds(preset, timeZone);
                        setValues((previous) => ({
                          ...previous,
                          [after]: bounds.after,
                          [before]: bounds.before,
                        }));
                      }}
                    >
                      {datePresets.map((preset) => (
                        <NativeSelectOption key={preset.value} value={preset.value}>
                          {preset.label}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </Field>
                );
              })}
              <Collapsible open={advanced} onOpenChange={setAdvanced}>
                <CollapsibleTrigger asChild>
                  <Button size="sm" variant="ghost" type="button">
                    <ChevronRightIcon
                      aria-hidden="true"
                      data-icon="inline-start"
                      className={advanced ? "rotate-90" : undefined}
                    />
                    Advanced
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-3">
                  <FieldGroup className="grid gap-3 sm:grid-cols-2">
                    {taskTimingFilterKeys.map((key) => (
                      <Field key={key}>
                        <FieldLabel htmlFor={`task-filter-${key}`}>
                          {taskTimingFilterLabel(key)}
                        </FieldLabel>
                        <Input
                          id={`task-filter-${key}`}
                          type="datetime-local"
                          value={toDateTimeLocal(values[key], timeZone)}
                          onChange={(event) =>
                            setValues((previous) => ({
                              ...previous,
                              [key]: event.target.value
                                ? dateTimeLocalToIso(event.target.value, timeZone)
                                : "",
                            }))
                          }
                        />
                      </Field>
                    ))}
                  </FieldGroup>
                </CollapsibleContent>
              </Collapsible>
            </FieldGroup>
          </form>
        </ResponsiveDialogBody>
        <ResponsiveDialogFooter>
          <Button form="task-filters-form" size="sm" type="submit">
            Apply filters
          </Button>
          {activeCount > 0 ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const next = new URLSearchParams(searchParams);
                for (const key of [...taskTimingFilterKeys, "lifecycle", "task"]) next.delete(key);
                navigate(next.size ? `/tasks?${next}` : "/tasks");
                setOpen(false);
              }}
            >
              Clear
            </Button>
          ) : null}
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
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

function TaskArchive({ lists, projects }: { lists: TaskList[]; projects: TaskProject[] }) {
  return (
    <div className="narrow-page flex flex-col gap-6">
      <header>
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

export function toDateTimeLocal(value: string | null, timeZone: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return "";
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

export function dateTimeLocalToIso(value: string, timeZone: string) {
  const [dateValue, timeValue] = value.split("T");
  const date = parseLocalDate(dateValue as string);
  const [hour, minute] = (timeValue as string).split(":").map(Number);
  return localDateTimeToUtc(
    date,
    (hour as number) * 60 + (minute as number),
    timeZone,
  ).toISOString();
}

export function taskTiming(task: Task, timeZone: string): string | null {
  const timing = [
    task.scheduledAt ? `Reserved ${formatMaterialDateTime(task.scheduledAt, timeZone)}` : null,
    task.dueAt ? `Due ${formatRelativeMaterialDateTime(task.dueAt, timeZone)}` : null,
  ].filter((detail): detail is string => detail !== null);
  return timing.length > 0 ? timing.join(" · ") : null;
}

export function taskDescription(
  task: Task,
  list?: TaskList,
  project?: TaskProject,
  includeNotes = true,
): string | null {
  const details = [
    project && list ? `${list.name} / ${project.name}` : (project?.name ?? list?.name),
    task.estimateMinutes ? `${task.estimateMinutes} min` : null,
    includeNotes ? task.notes || null : null,
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
