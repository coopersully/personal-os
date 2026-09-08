import type { Reminder, Task, TaskWorkspaceItem } from "@personal-os/domain";
import { EmptyState } from "@personal-os/ui";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { ListChecksIcon } from "@/components/icons";
import {
  ResponsiveDialog,
  ResponsiveDialogBody,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ItemGroup } from "@/components/ui/item";
import {
  WorkspaceSecondaryAppBar,
  WorkspaceSecondaryAppBarActions,
  WorkspaceSecondaryAppBarContent,
} from "@/components/workspace-secondary-app-bar";
import { WorkspaceSkeleton } from "@/components/workspace-skeleton";
import { api, errorMessage } from "../../api";
import { InlineError } from "../../components/async-state";
import { formatMaterialDateTime } from "../../lib/date-format";
import { invalidateMaterial } from "../../lib/material-queries";
import { TasksPage as LegacyTasksPage, listAllTaskLists, listAllTaskProjects } from "./page";
import { TaskContainerActions } from "./task-navigation";
import {
  availableActions,
  itemKey,
  runWorkspaceBatch,
  type WorkspaceAction,
  workspaceActionLabels,
} from "./workspace-actions";
import {
  WorkspaceDisplay,
  WorkspaceFilterChips,
  WorkspaceFilters,
  WorkspaceSort,
} from "./workspace-controls";
import {
  canonicalWorkspaceParams,
  workspaceFilterKeys,
  workspacePath,
  workspaceQuery,
} from "./workspace-query";
import { WorkspaceRow } from "./workspace-row";

type WorkspacePageProps = {
  onEdit: (task: Task) => void;
  onEditReminder: (reminder: Reminder) => void;
  timeZone: string;
};

/** Legacy links retain their meaning; unavailable containers keep their existing recovery surface. */
export function TasksWorkspacePage(props: WorkspacePageProps) {
  const [params] = useSearchParams();
  const location = useLocation();
  if (params.has("archive"))
    return <LegacyTasksPage onEdit={props.onEdit} timeZone={props.timeZone} />;
  const canonical = canonicalWorkspaceParams(params, location.pathname === "/reminders");
  if (location.pathname !== "/tasks" || canonical.toString() !== params.toString())
    return <Navigate replace to={workspacePath(canonical)} />;
  return <WorkspaceContent {...props} />;
}

function WorkspaceContent({ onEdit, onEditReminder, timeZone }: WorkspacePageProps) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const lists = useQuery({ queryKey: ["task-lists"], queryFn: listAllTaskLists });
  const projects = useQuery({ queryKey: ["task-projects"], queryFn: listAllTaskProjects });
  const inbox = lists.data?.items.find((list) => list.kind === "inbox");
  const global = Boolean(params.get("view"));
  const project = projects.data?.items.find(
    (record) =>
      record.id === params.get("project") &&
      (global ||
        (record.availability === "active" &&
          record.lifecycle === "open" &&
          (!lists.isSuccess ||
            lists.data.items.some(
              (owner) => owner.id === record.listId && owner.availability === "active",
            )))),
  );
  const list = lists.data?.items.find(
    (record) =>
      record.id === (project?.listId ?? params.get("list") ?? (!global ? inbox?.id : null)) &&
      (global || record.availability === "active"),
  );
  const query = workspaceQuery(params, inbox?.id);
  // A project's canonical owning list wins over a stale list URL.
  if (project) query.listId = project.listId;
  useEffect(() => {
    if (!lists.isSuccess || !projects.isSuccess || global) return;
    const next = new URLSearchParams(params);
    if (project) next.set("list", project.listId);
    else if (params.has("project")) next.delete("project");
    if (!project && (!list || list.kind === "inbox")) next.delete("list");
    if (next.toString() !== params.toString()) navigate(workspacePath(next), { replace: true });
  }, [global, list, lists.isSuccess, navigate, params, project, projects.isSuccess]);
  const queryIdentity = JSON.stringify(query);
  // Container metadata enriches rows; it must not block independently readable scopes.
  // Only Inbox needs a list lookup to avoid accidentally requesting the global queue.
  const canReadItems = Boolean(global || query.listId || query.projectId);
  const itemsQuery = useInfiniteQuery({
    enabled: canReadItems,
    queryKey: ["tasks", "workspace", query],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.listTaskWorkspace({ ...query, limit: 50, ...(pageParam ? { cursor: pageParam } : {}) }),
    getNextPageParam: (page) => page.nextCursor,
  });
  // Cursors are not historical snapshots: an edited row can reappear on a later page.
  // Keep its latest representation once, including its current revision and group position.
  const uniqueItems = new Map<string, TaskWorkspaceItem>();
  for (const item of itemsQuery.data?.pages.flatMap((page) => page.items) ?? []) {
    uniqueItems.delete(itemKey(item));
    uniqueItems.set(itemKey(item), item);
  }
  const items = [...uniqueItems.values()];
  const total = itemsQuery.data?.pages[0]?.total;
  const [selection, setSelection] = useState<{ query: string; keys: string[] }>({
    query: queryIdentity,
    keys: [],
  });
  const [selecting, setSelecting] = useState(false);
  const selectedKeys = selection.query === queryIdentity ? selection.keys : [];
  const selectedItems = items.filter((item) => selectedKeys.includes(itemKey(item)));
  const [confirmation, setConfirmation] = useState<TaskWorkspaceItem[] | null>(null);
  const [preview, setPreview] = useState<TaskWorkspaceItem | null>(null);
  const [result, setResult] = useState<Awaited<ReturnType<typeof runWorkspaceBatch>> | null>(null);
  const batch = useMutation({
    mutationFn: ({
      items: selected,
      action,
    }: {
      items: TaskWorkspaceItem[];
      action: WorkspaceAction;
    }) => runWorkspaceBatch(selected, action),
    onError: (error) => toast.error(errorMessage(error)),
    onSuccess: async (outcome) => {
      setResult(outcome);
      setSelection((old) => ({
        ...old,
        keys: old.keys.filter((key) => !outcome.succeeded.includes(key)),
      }));
      if (!outcome.failed.length)
        toast.success(
          `${outcome.succeeded.length === 1 ? "Item" : `${outcome.succeeded.length} items`} updated.`,
        );
      await invalidateMaterial(queryClient);
    },
  });
  const act = (selected: TaskWorkspaceItem[], action: WorkspaceAction) => {
    if (action === "trash") {
      setConfirmation(selected);
      return;
    }
    setResult(null);
    batch.mutate({ items: selected, action });
  };
  const select = (item: TaskWorkspaceItem) => {
    setSelecting(true);
    setSelection({
      query: queryIdentity,
      keys: selectedKeys.includes(itemKey(item))
        ? selectedKeys.filter((key) => key !== itemKey(item))
        : [...selectedKeys, itemKey(item)].slice(0, 100),
    });
  };
  const opened = useRef<string | null>(null);
  const requestedTaskId = params.get("task");
  const requestedReminderId = params.get("reminder");
  const requestedItem = items.find(
    (item) => item.record.id === (item.kind === "task" ? requestedTaskId : requestedReminderId),
  );
  const requestedTask = useQuery({
    queryKey: ["tasks", "inspect", requestedTaskId],
    queryFn: () => api.getTask(requestedTaskId as string),
    enabled: Boolean(requestedTaskId && itemsQuery.isSuccess && !requestedItem),
  });
  const requestedReminder = useQuery({
    queryKey: ["reminders", "inspect", requestedReminderId],
    queryFn: () => api.getReminder(requestedReminderId as string),
    enabled: Boolean(requestedReminderId && itemsQuery.isSuccess && !requestedItem),
  });
  useEffect(() => {
    const key = requestedTaskId
      ? `task:${requestedTaskId}`
      : requestedReminderId
        ? `reminder:${requestedReminderId}`
        : null;
    if (!key) {
      opened.current = null;
      return;
    }
    if (opened.current === key) return;
    if (requestedItem) {
      opened.current = key;
      if (requestedItem.deletedAt || requestedItem.readOnly) setPreview(requestedItem);
      else if (requestedItem.kind === "task") onEdit(requestedItem.record);
      else onEditReminder(requestedItem.record);
    } else if (requestedTask.data && lists.isSuccess && projects.isSuccess) {
      opened.current = key;
      const task = requestedTask.data;
      const owner = lists.data.items.find((record) => record.id === task.listId);
      const project = projects.data.items.find((record) => record.id === task.projectId);
      const readOnly =
        owner?.availability !== "active" ||
        Boolean(
          task.projectId && (project?.availability !== "active" || project?.lifecycle !== "open"),
        );
      if (task.deletedAt || readOnly) {
        setPreview({
          kind: "task",
          record: task,
          deletedAt: task.deletedAt ?? null,
          readOnly: task.deletedAt ? false : readOnly,
          relevantAt: task.dueAt,
          groupKey: "none",
        });
      } else onEdit(task);
    } else if (requestedReminder.data) {
      opened.current = key;
      onEditReminder(requestedReminder.data);
    }
  }, [
    requestedItem,
    requestedTaskId,
    requestedReminderId,
    requestedTask.data,
    requestedReminder.data,
    onEdit,
    onEditReminder,
    lists.data,
    lists.isSuccess,
    projects.data,
    projects.isSuccess,
  ]);
  const open = (item: TaskWorkspaceItem) => {
    opened.current = itemKey(item);
    if (item.deletedAt || item.readOnly) {
      setPreview(item);
      return;
    }
    if (item.kind === "task") onEdit(item.record);
    else onEditReminder(item.record);
    const next = new URLSearchParams(params);
    next.delete("task");
    next.delete("reminder");
    next.set(item.kind, item.record.id);
    navigate(workspacePath(next));
  };
  const activeLists = lists.data?.items.filter((entry) => entry.availability === "active") ?? [];
  const activeProjects =
    projects.data?.items.filter(
      (entry) =>
        entry.availability === "active" &&
        entry.lifecycle === "open" &&
        activeLists.some((candidate) => candidate.id === entry.listId),
    ) ?? [];
  const scopeName = global
    ? ({ all: "All", today: "Today", upcoming: "Upcoming", history: "History", trash: "Trash" }[
        params.get("view") as "all"
      ] ?? "All")
    : (project?.name ?? list?.name ?? "Inbox");
  const details = (params.get("details") ?? "estimate").split(",");
  const filtered = workspaceFilterKeys.some((key) => params.has(key)) || Boolean(params.get("q"));
  const mutable = items.filter((item) => !item.readOnly).slice(0, 100);
  const groupLabel = (item: TaskWorkspaceItem) => {
    const group = params.get("group");
    if (item.groupKey === "none")
      return group === "date" ? "No date" : group === "project" ? "No project" : "Reminders";
    if (group === "list")
      return lists.data?.items.find((entry) => entry.id === item.groupKey)?.name ?? "List";
    if (group === "project")
      return projects.data?.items.find((entry) => entry.id === item.groupKey)?.name ?? "Project";
    return new Date(`${item.groupKey}T12:00:00Z`).toLocaleDateString("en-US", {
      timeZone: "UTC",
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  };
  return (
    <>
      <WorkspaceSecondaryAppBar aria-label="Tasks page controls">
        <WorkspaceSecondaryAppBarContent className="flex-wrap gap-2">
          <h1 className="font-heading text-sm font-medium">{scopeName}</h1>
          {total !== undefined ? (
            <span className="text-xs text-muted-foreground">
              {total} {total === 1 ? "item" : "items"}
            </span>
          ) : null}
          <WorkspaceFilterChips
            params={params}
            timeZone={timeZone}
            lists={lists.data?.items ?? []}
            projects={projects.data?.items ?? []}
          />
        </WorkspaceSecondaryAppBarContent>
        <WorkspaceSecondaryAppBarActions>
          <WorkspaceFilters
            params={params}
            timeZone={timeZone}
            lists={activeLists}
            projects={activeProjects}
          />
          <WorkspaceSort params={params} />
          <WorkspaceDisplay params={params} />
          {!global && list ? (
            <TaskContainerActions
              list={list}
              {...(project ? { project } : {})}
              lists={activeLists}
              projects={projects.data?.items ?? []}
            />
          ) : null}
        </WorkspaceSecondaryAppBarActions>
      </WorkspaceSecondaryAppBar>
      <div className="narrow-page flex min-w-0 flex-col gap-3">
        {!global && project && (project.why || project.targetDate) ? (
          <div className="flex flex-col gap-1 text-xs text-muted-foreground">
            {project.why ? <p className="line-clamp-2">{project.why}</p> : null}
            {project.targetDate ? (
              <p>
                Target{" "}
                {new Date(`${project.targetDate}T12:00:00Z`).toLocaleDateString("en-US", {
                  timeZone: "UTC",
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </p>
            ) : null}
          </div>
        ) : null}
        {params.get("view") === "history" ? (
          <div className="flex justify-end">
            <Button asChild size="sm" variant="ghost">
              <Link to="/tasks?archive=all">Archived lists & projects</Link>
            </Button>
          </div>
        ) : null}
        {(!canReadItems && lists.isPending) || (canReadItems && itemsQuery.isPending) ? (
          <WorkspaceSkeleton kind="tasks" />
        ) : null}
        {(!canReadItems && lists.isError) ||
        (itemsQuery.isError && !itemsQuery.isFetchNextPageError) ? (
          <div className="flex flex-col items-start gap-2">
            <InlineError error={canReadItems ? itemsQuery.error : lists.error} />
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void lists.refetch();
                if (canReadItems) void itemsQuery.refetch();
              }}
            >
              Retry Tasks
            </Button>
          </div>
        ) : null}
        {requestedTask.isError || requestedReminder.isError ? (
          <InlineError error={requestedTask.error ?? requestedReminder.error} />
        ) : null}
        {requestedTask.data && !requestedItem && (lists.isError || projects.isError) ? (
          <div className="flex flex-col items-start gap-2">
            <InlineError error={lists.error ?? projects.error} />
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void lists.refetch();
                void projects.refetch();
              }}
            >
              Retry task details
            </Button>
          </div>
        ) : null}
        {result?.failed.length ? (
          <Alert variant="destructive">
            <AlertTitle>
              {result.succeeded.length} updated, {result.failed.length} not changed.
            </AlertTitle>
            <AlertDescription>
              <ul>
                {result.failed.map((failure) => (
                  <li key={failure.key}>
                    {failure.title}: {failure.message}
                  </li>
                ))}
              </ul>
              <p>Refresh and reselect changed items before retrying.</p>
              <Button size="sm" variant="ghost" onClick={() => setResult(null)}>
                Dismiss
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        {items.length ? (
          <>
            <div className="flex min-h-8 flex-wrap items-center justify-between gap-2">
              {selecting ? (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="workspace-select-visible"
                    aria-label="Select visible items"
                    checked={
                      mutable.length > 0 &&
                      mutable.every((item) => selectedKeys.includes(itemKey(item)))
                        ? true
                        : selectedKeys.length
                          ? "indeterminate"
                          : false
                    }
                    disabled={batch.isPending || !mutable.length}
                    onCheckedChange={(checked) =>
                      setSelection({
                        query: queryIdentity,
                        keys: checked ? mutable.map(itemKey) : [],
                      })
                    }
                  />
                  <label
                    className="text-xs text-muted-foreground"
                    htmlFor="workspace-select-visible"
                  >
                    {selectedKeys.length
                      ? `${selectedKeys.length} selected`
                      : `Select visible${items.length > 100 ? " (first 100)" : ""}`}
                  </label>
                </div>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {items.length < (total ?? 0) ? `${items.length} of ${total} shown` : ""}
                </span>
              )}
              <Button
                size="sm"
                variant="ghost"
                disabled={batch.isPending}
                onClick={() => {
                  setSelecting(!selecting);
                  setSelection({ query: queryIdentity, keys: [] });
                }}
              >
                {selecting ? "Done selecting" : "Select items"}
              </Button>
            </div>
            {selectedItems.length ? (
              <fieldset
                aria-label="Selected item actions"
                className="flex flex-wrap items-center gap-2 rounded-md bg-muted p-2"
              >
                <span className="text-xs text-muted-foreground">
                  {selectedItems.length} selected
                </span>
                {availableActions(selectedItems).map((action) => (
                  <Button
                    key={action}
                    size="sm"
                    variant="outline"
                    disabled={batch.isPending}
                    onClick={() => act(selectedItems, action)}
                  >
                    {workspaceActionLabels[action]}
                  </Button>
                ))}
                {!availableActions(selectedItems).length ? (
                  <span className="text-xs text-muted-foreground">
                    No shared actions for this selection.
                  </span>
                ) : null}
                {batch.isPending ? (
                  <span role="status" className="text-xs text-muted-foreground">
                    Updating…
                  </span>
                ) : null}
              </fieldset>
            ) : null}
            <ItemGroup className="gap-1">
              {items.map((item, index) => (
                <div key={itemKey(item)}>
                  {params.get("group") &&
                  params.get("group") !== "none" &&
                  (index === 0 || items[index - 1]?.groupKey !== item.groupKey) ? (
                    <h2 className="px-2 pb-2 pt-4 text-xs font-medium text-muted-foreground">
                      {groupLabel(item)}
                    </h2>
                  ) : null}
                  <WorkspaceRow
                    item={item}
                    {...(item.kind === "task" &&
                    global &&
                    lists.data?.items.find((entry) => entry.id === item.record.listId)
                      ? {
                          list: lists.data.items.find(
                            (entry) => item.kind === "task" && entry.id === item.record.listId,
                          ) as NonNullable<typeof list>,
                        }
                      : {})}
                    {...(item.kind === "task" &&
                    item.record.projectId &&
                    projects.data?.items.find((entry) => entry.id === item.record.projectId)
                      ? {
                          project: projects.data.items.find(
                            (entry) => item.kind === "task" && entry.id === item.record.projectId,
                          ) as NonNullable<typeof project>,
                        }
                      : {})}
                    timeZone={timeZone}
                    details={details}
                    selectionMode={selecting}
                    selected={selectedKeys.includes(itemKey(item))}
                    disabled={batch.isPending}
                    onOpen={() => open(item)}
                    onSelect={() => select(item)}
                    onAction={(action) => act([item], action)}
                  />
                </div>
              ))}
            </ItemGroup>
            {itemsQuery.isFetchNextPageError ? <InlineError error={itemsQuery.error} /> : null}
            {itemsQuery.hasNextPage || itemsQuery.isFetchNextPageError ? (
              <Button
                disabled={itemsQuery.isFetchingNextPage}
                onClick={() => void itemsQuery.fetchNextPage()}
                variant="outline"
              >
                {itemsQuery.isFetchingNextPage
                  ? "Loading more…"
                  : itemsQuery.isFetchNextPageError
                    ? "Retry loading more items"
                    : "Load more items"}
              </Button>
            ) : null}
          </>
        ) : itemsQuery.isSuccess ? (
          <EmptyState
            icon={<ListChecksIcon />}
            title={filtered ? "No matching items" : "Nothing here yet"}
          >
            {filtered
              ? "Try another filter or search."
              : scopeName === "Today"
                ? "Nothing is due or reserved for today."
                : scopeName === "History"
                  ? "Completed items and archived context will appear here."
                  : scopeName === "Trash"
                    ? "Removed items stay here until you restore them."
                    : "Capture something worth keeping."}
          </EmptyState>
        ) : null}
      </div>
      <ResponsiveDialog
        open={confirmation !== null}
        onOpenChange={(value) => {
          if (!value) setConfirmation(null);
        }}
      >
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>
              Move {confirmation?.length === 1 ? "item" : `${confirmation?.length ?? 0} items`} to
              Trash?
            </ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <ResponsiveDialogBody>
            <p className="text-sm text-muted-foreground">You can restore these items from Trash.</p>
          </ResponsiveDialogBody>
          <ResponsiveDialogFooter>
            <Button
              onClick={() => {
                const selected = confirmation;
                setConfirmation(null);
                if (selected) {
                  setResult(null);
                  batch.mutate({ items: selected, action: "trash" });
                }
              }}
            >
              Move to Trash
            </Button>
            <Button variant="outline" onClick={() => setConfirmation(null)}>
              Cancel
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
      <ResponsiveDialog
        open={preview !== null}
        onOpenChange={(value) => {
          if (!value) setPreview(null);
        }}
      >
        <ResponsiveDialogContent>
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>{preview?.record.title ?? "Item"}</ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <ResponsiveDialogBody>
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                {preview?.deletedAt
                  ? "In Trash · Restore to make changes."
                  : "Read only · Restore the list or project before making changes."}
              </p>
              {preview?.record.dueAt ? (
                <p>Due {formatMaterialDateTime(preview.record.dueAt, timeZone)}</p>
              ) : null}
              {preview?.record.notes ? (
                <p className="whitespace-pre-wrap text-sm">{preview.record.notes}</p>
              ) : null}
            </div>
          </ResponsiveDialogBody>
          <ResponsiveDialogFooter>
            {preview?.readOnly ? (
              <Button asChild variant="outline">
                <Link to="/tasks?archive=all">View archived context</Link>
              </Button>
            ) : null}
            {preview && availableActions([preview]).includes("restore") ? (
              <Button
                onClick={() => {
                  act([preview], "restore");
                  setPreview(null);
                }}
              >
                Restore
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => setPreview(null)}>
              Close
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  );
}
