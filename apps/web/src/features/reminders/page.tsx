import type { Reminder } from "@personal-os/domain";
import { EmptyState } from "@personal-os/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import {
  CircleCheckIcon,
  ClockIcon,
  ListTodoIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
} from "@/components/icons";
import {
  ReminderItem,
  ReminderItemActions,
  ReminderItemCompletion,
  ReminderItemContent,
  ReminderItemDescription,
  ReminderItemDue,
  ReminderItemPrimaryAction,
  ReminderItemTitle,
} from "@/components/reminder-item";
import { Button as ShadcnButton } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ItemGroup } from "@/components/ui/item";
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
import { formatRelativeMaterialDateTime } from "../../lib/date-format.js";
import { invalidateMaterial } from "../../lib/material-queries.js";

export function RemindersCreateButton({ onCreate }: { onCreate: () => void }) {
  return (
    <ShadcnButton aria-label="New reminder" onClick={onCreate} size="sm">
      <PlusIcon aria-hidden="true" data-icon="inline-start" />
      <span>New reminder</span>
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
        <ItemGroup>
          {reminders.data.items.map((reminder) => (
            <ReminderRow
              key={reminder.id}
              onEdit={() => onEdit(reminder)}
              reminder={reminder}
              timeZone={timeZone}
            />
          ))}
        </ItemGroup>
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
  const completeReminder = reminder.completedAt !== null;
  const overdue =
    reminder.dueAt !== null && new Date(reminder.dueAt).getTime() < Date.now() && !completeReminder;
  return (
    <ReminderItem data-completed={completeReminder} data-priority={reminder.priority}>
      <ReminderItemCompletion>
        <Checkbox
          aria-label={
            reminder.completedAt ? `Reopen ${reminder.title}` : `Complete ${reminder.title}`
          }
          checked={completeReminder}
          disabled={complete.isPending}
          onCheckedChange={() => complete.mutate()}
        />
      </ReminderItemCompletion>
      <ReminderItemPrimaryAction aria-label={`Open ${reminder.title}`} onClick={onEdit}>
        <ReminderItemContent>
          <ReminderItemTitle>{reminder.title}</ReminderItemTitle>
          {reminder.dueAt ? (
            <ReminderItemDue className={overdue ? "text-destructive" : undefined}>
              <ClockIcon className="size-3" />
              {formatRelativeMaterialDateTime(reminder.dueAt, timeZone)}
            </ReminderItemDue>
          ) : null}
        </ReminderItemContent>
      </ReminderItemPrimaryAction>
      <ReminderItemActions>
        <ShadcnButton
          aria-label={`Delete ${reminder.title}`}
          disabled={remove.isPending}
          onClick={() => remove.mutate()}
          size="icon-xs"
          variant="ghost"
        >
          <TrashIcon className="size-[15px]" />
        </ShadcnButton>
      </ReminderItemActions>
      {mutationError ? (
        <ReminderItemDescription className="basis-full text-destructive" role="alert">
          {errorMessage(mutationError)}
        </ReminderItemDescription>
      ) : null}
    </ReminderItem>
  );
}
