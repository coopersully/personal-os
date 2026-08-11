import type { DailyBrief, Task } from "@personal-os/domain";
import { EmptyState } from "@personal-os/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Clock3,
  Edit3,
  Inbox,
  ListChecks,
  ListTodo,
  type LucideIcon,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { api, errorMessage } from "../../api.js";
import { InlineError } from "../../components/async-state.js";
import {
  WorkspaceSearch,
  workspaceSearchFromParams,
  workspaceViewPath,
} from "../../components/workspace-search.js";
import { WorkspaceSkeleton } from "../../components/workspace-skeleton.js";
import { formatMaterialDateTime } from "../../lib/date-format.js";
import { invalidateMaterial } from "../../lib/material-queries.js";
import { RemindersSidebar } from "../reminders/page.js";

type TaskView = "completed" | "inbox" | "next" | "scheduled";

const taskViews: Array<{ icon: LucideIcon; label: string; value: TaskView }> = [
  { icon: Inbox, label: "Inbox", value: "inbox" },
  { icon: ListChecks, label: "Next", value: "next" },
  { icon: Clock3, label: "Scheduled", value: "scheduled" },
  { icon: CheckCircle2, label: "Completed", value: "completed" },
];

/**
 * Tasks owns both commitment surfaces, so the sidebar names them as siblings.
 * Keeping both visible marks which one is current without duplicating the
 * other's view rows.
 */
const relatedCommitments: Array<{ icon: LucideIcon; label: string; path: string }> = [
  { icon: ListChecks, label: "Tasks", path: "/tasks" },
  { icon: ListTodo, label: "Reminders", path: "/reminders" },
];

const taskEmptyCopy: Record<TaskView, string> = {
  completed: "Completed tasks will collect here.",
  inbox: "Capture the first task worth keeping.",
  next: "Move a task here when it is ready for attention.",
  scheduled: "Schedule a task when it needs a specific time block.",
};

export function TasksCreateButton({ onCreate }: { onCreate: () => void }) {
  return (
    <Button aria-label="New task" onClick={onCreate} size="sm">
      <Plus aria-hidden="true" data-icon="inline-start" />
      <span>New task</span>
    </Button>
  );
}

export function TasksTopbarControls() {
  return <WorkspaceSearch label="Search tasks" />;
}

export function TasksSidebar({ onNavigate }: { onNavigate: () => void }) {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const view = taskViewFromParams(searchParams);
  const remindersActive = location.pathname === "/reminders";
  // Tasks owns Reminders, so one sidebar serves both. The View group always
  // describes the destination in front of the person: showing task views while
  // reading reminders offered two different "Completed" rows and silently
  // navigated away from Reminders.
  return (
    <>
      {remindersActive ? (
        <RemindersSidebar onNavigate={onNavigate} />
      ) : (
        <SidebarGroup>
          <SidebarGroupLabel>View</SidebarGroupLabel>
          <SidebarGroupContent>
            <nav aria-label="Task views">
              <SidebarMenu>
                {taskViews.map(({ icon: Icon, label, value }) => {
                  const selected = view === value;
                  return (
                    <SidebarMenuItem key={value}>
                      <SidebarMenuButton asChild isActive={selected}>
                        <Link
                          aria-current={selected ? "page" : undefined}
                          onClick={onNavigate}
                          to={workspaceViewPath(
                            "/tasks",
                            searchParams,
                            value === "inbox" ? undefined : value,
                          )}
                        >
                          <Icon aria-hidden="true" />
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
      )}
      <SidebarGroup>
        <SidebarGroupLabel>Related</SidebarGroupLabel>
        <SidebarGroupContent>
          <nav aria-label="Related commitments">
            <SidebarMenu>
              {relatedCommitments.map(({ icon: Icon, label, path }) => {
                const selected = path === (remindersActive ? "/reminders" : "/tasks");
                return (
                  <SidebarMenuItem key={path}>
                    <SidebarMenuButton asChild isActive={selected}>
                      <Link
                        aria-current={selected ? "page" : undefined}
                        onClick={onNavigate}
                        to={path}
                      >
                        <Icon aria-hidden="true" />
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
  const view = taskViewFromParams(searchParams);
  const search = workspaceSearchFromParams(searchParams).trim();
  const tasks = useQuery({
    queryFn: () =>
      api.listTasks({
        ...(view === "completed" ? { completed: true } : { completed: false, status: view }),
        ...(search ? { query: search } : {}),
      }),
    queryKey: ["tasks", view, search],
  });

  if (tasks.isPending) return <WorkspaceSkeleton kind="tasks" />;
  if (tasks.isError) return <InlineError error={tasks.error} />;

  return (
    <div className="narrow-page">
      {tasks.data.items.length === 0 ? (
        search ? (
          <EmptyState icon={<Search />} title="No matching tasks">
            Try another title or note.
          </EmptyState>
        ) : (
          <EmptyState icon={<ListChecks />} title="Nothing here yet">
            {taskEmptyCopy[view]}
          </EmptyState>
        )
      ) : (
        <ItemGroup>
          {tasks.data.items.map((task) => (
            <TaskRow key={task.id} onEdit={() => onEdit(task)} task={task} timeZone={timeZone} />
          ))}
        </ItemGroup>
      )}
    </div>
  );
}

export function TaskRow({
  onEdit,
  recommendation,
  task,
  timeZone,
}: {
  onEdit: () => void;
  recommendation?: DailyBrief["recommendedTasks"][number];
  task: Task;
  timeZone: string;
}) {
  const queryClient = useQueryClient();
  const complete = useMutation({
    mutationFn: (completed: boolean) => api.completeTask(task.id, completed),
    onSuccess: () => invalidateMaterial(queryClient),
  });
  const remove = useMutation({
    mutationFn: () => api.deleteTask(task.id),
    onSuccess: () => invalidateMaterial(queryClient),
  });
  const completeTask = task.completedAt !== null;
  return (
    <Item variant="outline">
      <ItemMedia>
        <Checkbox
          aria-label={`${completeTask ? "Reopen" : "Complete"} ${task.title}`}
          checked={completeTask}
          disabled={complete.isPending}
          onCheckedChange={(checked) => complete.mutate(checked === true)}
        />
      </ItemMedia>
      <ItemContent>
        <ItemTitle className={completeTask ? "line-through text-muted-foreground" : undefined}>
          {task.title}
        </ItemTitle>
        <ItemDescription>{taskDescription(task, timeZone)}</ItemDescription>
        {recommendation ? (
          <ItemDescription>{recommendationCopy(recommendation)}</ItemDescription>
        ) : null}
        {task.tags.length > 0 ? (
          <ul aria-label="Task tags" className="flex flex-wrap gap-1">
            {task.tags.map((tag) => (
              <Badge asChild key={tag} variant="outline">
                <li>{tag}</li>
              </Badge>
            ))}
          </ul>
        ) : null}
      </ItemContent>
      <ItemActions>
        <Badge variant="secondary">{task.status}</Badge>
        <Button aria-label={`Edit ${task.title}`} onClick={onEdit} size="icon-sm" variant="ghost">
          <Edit3 />
        </Button>
        <Button
          aria-label={`Remove ${task.title}`}
          disabled={remove.isPending}
          onClick={() => remove.mutate()}
          size="icon-sm"
          variant="ghost"
        >
          <Trash2 />
        </Button>
      </ItemActions>
      {complete.isError || remove.isError ? (
        <ItemDescription className="basis-full text-destructive" role="alert">
          {errorMessage(complete.error ?? remove.error)}
        </ItemDescription>
      ) : null}
    </Item>
  );
}

function taskViewFromParams(searchParams: URLSearchParams): TaskView {
  const requestedView = searchParams.get("view");
  return requestedView === "next" || requestedView === "scheduled" || requestedView === "completed"
    ? requestedView
    : "inbox";
}

function taskDescription(task: Task, timeZone: string): string {
  const details = [
    task.scheduledAt ? `Reserved ${formatMaterialDateTime(task.scheduledAt, timeZone)}` : null,
    task.dueAt ? `Due ${formatMaterialDateTime(task.dueAt, timeZone)}` : null,
    task.estimateMinutes ? `${task.estimateMinutes} min` : null,
  ].filter((detail): detail is string => detail !== null);
  return details.length > 0 ? details.join(" · ") : task.notes || "No date or estimate yet";
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
