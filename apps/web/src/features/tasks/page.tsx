import type { DailyBrief, Task, TaskList, TaskProject, TaskSystemView } from "@personal-os/domain";
import { EmptyState } from "@personal-os/ui";
import {
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useState } from "react";
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
import { ItemGroup } from "@/components/ui/item";
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
  const [loadMoreError, setLoadMoreError] = useState<unknown>(null);
  const selectedView = taskViewFromParams(searchParams);
  const selectedProjectId = searchParams.get("project");
  const requestedListId = searchParams.get("list");
  const search = workspaceSearchFromParams(searchParams).trim();
  const lists = useQuery({ queryFn: listAllTaskLists, queryKey: ["task-lists"] });
  const projects = useQuery({
    queryFn: listAllTaskProjects,
    queryKey: ["task-projects"],
  });
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
  const requestedList = lists.data?.items.find(
    (list) => list.id === requestedListId && list.availability === "active",
  );
  const selectedListId = selectedView
    ? null
    : (selectedProject?.listId ?? requestedList?.id ?? inbox?.id ?? null);
  const canonicalPath = selectedView
    ? taskPath(searchParams, { view: selectedView })
    : selectedProject
      ? taskPath(searchParams, { list: selectedProject.listId, project: selectedProject.id })
      : requestedList
        ? taskPath(searchParams, { list: requestedList.kind === "inbox" ? null : requestedList.id })
        : taskPath(searchParams, { list: null });
  const currentPath = `/tasks${searchParams.size > 0 ? `?${searchParams.toString()}` : ""}`;
  useEffect(() => {
    if (lists.isSuccess && projects.isSuccess && canonicalPath !== currentPath) {
      navigate(canonicalPath, { replace: true });
    }
  }, [canonicalPath, currentPath, lists.isSuccess, navigate, projects.isSuccess]);
  const ready = selectedView !== null || (lists.isSuccess && projects.isSuccess && selectedListId);
  const query = {
    ...(selectedView ? { view: selectedView } : {}),
    ...(!selectedView && selectedListId ? { listId: selectedListId } : {}),
    ...(!selectedView && selectedProject ? { projectId: selectedProject.id } : {}),
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

  if (lists.isPending || projects.isPending || tasks.isPending) {
    return <WorkspaceSkeleton kind="tasks" />;
  }
  if (lists.isError) return <InlineError error={lists.error} />;
  if (projects.isError) return <InlineError error={projects.error} />;
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
  const taskItems = tasks.data.pages.flatMap((page) => page.items);

  return (
    <div className="narrow-page">
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
                onEdit={() => onEdit(task)}
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
          {task.tags.length > 0 ? (
            <TaskItemTags aria-label="Task tags" className="mt-1 pl-0">
              {task.tags.map((tag) => (
                <Badge asChild key={tag} variant="outline">
                  <li>{tag}</li>
                </Badge>
              ))}
            </TaskItemTags>
          ) : null}
        </TaskItemContent>
      </TaskItemPrimaryAction>
      <TaskItemMetadata>
        <span className="text-[0.625rem] font-medium tracking-[0.08em] text-muted-foreground uppercase">
          {taskLifecycleLabel(task)}
        </span>
      </TaskItemMetadata>
      <TaskItemActions>
        <Button aria-label={`Edit ${task.title}`} onClick={onEdit} size="icon-xs" variant="ghost">
          <EditIcon aria-hidden="true" />
        </Button>
      </TaskItemActions>
    </TaskItem>
  );
}

function taskViewFromParams(searchParams: URLSearchParams): TaskSystemView | null {
  const requestedView = searchParams.get("view");
  return taskViews.some((view) => view.value === requestedView)
    ? (requestedView as TaskSystemView)
    : null;
}

function taskPath(
  current: URLSearchParams,
  selection: { list?: string | null; project?: string | null; view?: TaskSystemView },
) {
  const params = new URLSearchParams();
  const search = current.get("q");
  if (search) params.set("q", search);
  if (selection.view) params.set("view", selection.view);
  if (selection.list) params.set("list", selection.list);
  if (selection.project) params.set("project", selection.project);
  const query = params.toString();
  return query ? `/tasks?${query}` : "/tasks";
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

export async function listAllTaskLists() {
  const items: TaskList[] = [];
  let cursor: string | null = null;
  do {
    const page = await api.listTaskLists({ limit: 100, ...(cursor ? { cursor } : {}) });
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return { items, nextCursor: null };
}

export async function listAllTaskProjects() {
  const items: TaskProject[] = [];
  let cursor: string | null = null;
  do {
    const page = await api.listTaskProjects({ limit: 100, ...(cursor ? { cursor } : {}) });
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return { items, nextCursor: null };
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
