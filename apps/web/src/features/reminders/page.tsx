import type { Reminder } from "@personal-os/domain";
import { Badge, Button, EmptyState } from "@personal-os/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import {
  CheckIcon,
  CircleCheckIcon,
  CircleIcon,
  ClockIcon,
  ListTodoIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
} from "@/components/icons";
import { Button as ShadcnButton } from "@/components/ui/button";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { api, errorMessage } from "../../api.js";
import { InlineError, PageLoading } from "../../components/async-state.js";
import {
  WorkspaceSearch,
  workspaceSearchFromParams,
  workspaceViewPath,
} from "../../components/workspace-search.js";
import { formatMaterialDateTime } from "../../lib/date-format.js";
import { invalidateMaterial } from "../../lib/material-queries.js";

export function RemindersCreateButton({ onCreate }: { onCreate: () => void }) {
  return (
    <ShadcnButton onClick={onCreate} size="sm">
      <PlusIcon aria-hidden="true" />
      New reminder
    </ShadcnButton>
  );
}

export function RemindersTopbarControls() {
  return <WorkspaceSearch label="Search reminders" />;
}

export function RemindersSidebar({ onNavigate }: { onNavigate: () => void }) {
  const [searchParams] = useSearchParams();
  const showCompleted = searchParams.get("view") === "completed";
  return (
    <SidebarGroup>
      <SidebarGroupLabel>View</SidebarGroupLabel>
      <SidebarGroupContent>
        <nav aria-label="Reminder views">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={!showCompleted}>
                <Link
                  aria-current={!showCompleted ? "page" : undefined}
                  onClick={onNavigate}
                  to={workspaceViewPath("/reminders", searchParams)}
                >
                  <ListTodoIcon aria-hidden="true" weight={!showCompleted ? "Filled" : "Outline"} />
                  <span>Open</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={showCompleted}>
                <Link
                  aria-current={showCompleted ? "page" : undefined}
                  onClick={onNavigate}
                  to={workspaceViewPath("/reminders", searchParams, "completed")}
                >
                  <CircleCheckIcon
                    aria-hidden="true"
                    weight={showCompleted ? "Filled" : "Outline"}
                  />
                  <span>Completed</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </nav>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

export function RemindersPage({
  onEdit,
  timeZone,
}: {
  onEdit: (reminder: Reminder) => void;
  timeZone: string;
}) {
  const [searchParams] = useSearchParams();
  const showCompleted = searchParams.get("view") === "completed";
  const search = workspaceSearchFromParams(searchParams).trim();
  const reminders = useQuery({
    queryFn: () =>
      api.listReminders({
        completed: showCompleted,
        ...(search ? { query: search } : {}),
      }),
    queryKey: ["reminders", showCompleted, search],
  });
  return (
    <div className="narrow-page">
      {reminders.isPending ? (
        <PageLoading />
      ) : reminders.isError ? (
        <InlineError error={reminders.error} />
      ) : reminders.data.items.length === 0 ? (
        search ? (
          <EmptyState icon={<SearchIcon />} title="No matching reminders">
            Try another title or note.
          </EmptyState>
        ) : (
          <EmptyState
            icon={<ListTodoIcon />}
            title={showCompleted ? "No completed reminders" : "A clear slate"}
          >
            {showCompleted
              ? "Completed items will collect here."
              : "Create the first reminder worth keeping."}
          </EmptyState>
        )
      ) : (
        <div className="reminder-list reminder-list--large">
          {reminders.data.items.map((reminder) => (
            <ReminderRow
              key={reminder.id}
              onEdit={() => onEdit(reminder)}
              reminder={reminder}
              timeZone={timeZone}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function ReminderRow({
  onEdit,
  reminder,
  timeZone,
}: {
  onEdit: () => void;
  reminder: Reminder;
  timeZone: string;
}) {
  const queryClient = useQueryClient();
  const complete = useMutation({
    mutationFn: () => api.completeReminder(reminder.id, !reminder.completedAt),
    onSuccess: () => invalidateMaterial(queryClient),
  });
  const remove = useMutation({
    mutationFn: () => api.deleteReminder(reminder.id),
    onSuccess: () => invalidateMaterial(queryClient),
  });
  const mutationError = complete.error ?? remove.error;
  return (
    <article className={`reminder-row${reminder.completedAt ? " reminder-row--done" : ""}`}>
      <button
        aria-label={
          reminder.completedAt ? `Reopen ${reminder.title}` : `Complete ${reminder.title}`
        }
        className="check-button"
        disabled={complete.isPending}
        onClick={() => complete.mutate()}
        type="button"
      >
        {reminder.completedAt ? (
          <CheckIcon className="size-[15px]" />
        ) : (
          <CircleIcon className="size-[18px]" />
        )}
      </button>
      <button className="reminder-row__material" onClick={onEdit} type="button">
        <strong>{reminder.title}</strong>
        <span>
          {reminder.dueAt ? (
            <>
              <ClockIcon className="size-[13px]" />{" "}
              {formatMaterialDateTime(reminder.dueAt, timeZone)}
            </>
          ) : (
            "No due date"
          )}
        </span>
      </button>
      <Badge className={`priority priority--${reminder.priority}`}>{reminder.priority}</Badge>
      <Button
        aria-label={`Delete ${reminder.title}`}
        disabled={remove.isPending}
        onClick={() => remove.mutate()}
        tone="ghost"
      >
        <TrashIcon className="size-[15px]" />
      </Button>
      {mutationError ? (
        <span className="col-start-2 col-end-[-1] text-xs text-destructive" role="alert">
          {errorMessage(mutationError)}
        </span>
      ) : null}
    </article>
  );
}
