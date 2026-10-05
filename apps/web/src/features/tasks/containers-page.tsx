import type { TaskList, TaskProject } from "@personal-os/domain";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { PageLoading, QueryFeedback } from "@/components/async-state";
import { ListTodoIcon, ProjectIcon, SliderHorizontalIcon, SortIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { WorkspaceSearch } from "@/components/workspace-search";
import { formatCalendarDate } from "@/lib/date-format";
import { TaskContainerPin } from "./container-pins";
import { listAllTaskLists, listAllTaskProjects } from "./page";
import { useSaveTaskPresentation, useTaskPresentationParams } from "./presentation-preferences";
import { getTaskListIcon } from "./task-list-icons";
import { TaskContainerActions, taskPath } from "./task-navigation";

type ContainerKind = "lists" | "projects" | "archive";
const sorts = [
  ["updated", "Recently updated"],
  ["name", "Name A–Z"],
  ["newest", "Newest first"],
  ["target", "Target date"],
] as const;

export function selectTaskContainers(
  kind: ContainerKind,
  lists: TaskList[],
  projects: TaskProject[],
  params: URLSearchParams,
) {
  const query = (params.get("q") ?? "").trim().toLocaleLowerCase();
  const state = params.get("containerStatus") ?? (kind === "archive" ? "all" : "active");
  const records: Array<TaskList | TaskProject> =
    kind === "archive" ? [...lists, ...projects] : kind === "lists" ? lists : projects;
  return records
    .filter((record) => {
      if (record.deletedAt) return false;
      const project = "listId" in record ? record : undefined;
      const owner = project ? lists.find((list) => list.id === project.listId) : undefined;
      const archived = record.availability === "archived" || owner?.availability === "archived";
      if (owner?.deletedAt) return false;
      if (kind === "archive" && !archived && (!project || project.lifecycle === "open"))
        return false;
      if (state === "active" && (archived || (project && project.lifecycle !== "open")))
        return false;
      if (state === "archived" && !archived) return false;
      if (
        (state === "completed" || state === "cancelled") &&
        (!project || project.lifecycle !== state)
      )
        return false;
      const text = project
        ? [project.name, project.why, project.notes, owner?.name]
        : [record.name, "description" in record ? record.description : ""];
      return text.join(" ").toLocaleLowerCase().includes(query);
    })
    .sort((a, b) => {
      const sort = params.get("containerSort") ?? "updated";
      const order =
        sort === "updated"
          ? b.updatedAt.localeCompare(a.updatedAt)
          : sort === "newest"
            ? b.createdAt.localeCompare(a.createdAt)
            : sort === "target"
              ? (("targetDate" in a ? a.targetDate : null) ?? "9999").localeCompare(
                  ("targetDate" in b ? b.targetDate : null) ?? "9999",
                )
              : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
      return order || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    });
}

export function TaskContainerControls({ kind }: { kind: ContainerKind }) {
  const [, setParams] = useSearchParams();
  const params = useTaskPresentationParams();
  const save = useSaveTaskPresentation();
  const update = (key: string, value: string) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set(key, value);
      return next;
    });
  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            aria-label={`Filter ${kind}`}
            title={`Filter ${kind}`}
          >
            <SliderHorizontalIcon />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end">
          <FieldGroup>
            <Field>
              <FieldLabel>Search {kind}</FieldLabel>
              <WorkspaceSearch label={`Search ${kind}`} />
            </Field>
            <Field>
              <FieldLabel htmlFor="container-status">Status</FieldLabel>
              <NativeSelect
                id="container-status"
                value={params.get("containerStatus") ?? (kind === "archive" ? "all" : "active")}
                onChange={(event) => update("containerStatus", event.target.value)}
              >
                {kind !== "archive" ? (
                  <NativeSelectOption value="active">Active</NativeSelectOption>
                ) : null}
                <NativeSelectOption value="all">All statuses</NativeSelectOption>
                {kind !== "lists" ? (
                  <>
                    <NativeSelectOption value="completed">Completed</NativeSelectOption>
                    <NativeSelectOption value="cancelled">Cancelled</NativeSelectOption>
                  </>
                ) : null}
                <NativeSelectOption value="archived">Archived</NativeSelectOption>
              </NativeSelect>
            </Field>
          </FieldGroup>
        </PopoverContent>
      </Popover>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost" aria-label={`Sort ${kind}`} title={`Sort ${kind}`}>
            <SortIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuRadioGroup
            value={params.get("containerSort") ?? "updated"}
            onValueChange={(value) => {
              update("containerSort", value);
              save.mutate({ taskContainerSort: value as "updated" | "name" | "newest" | "target" });
            }}
          >
            {sorts
              .filter(([key]) => kind !== "lists" || key !== "target")
              .map(([key, label]) => (
                <DropdownMenuRadioItem key={key} value={key}>
                  {label}
                </DropdownMenuRadioItem>
              ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

export function TaskContainersPage({ kind }: { kind: ContainerKind }) {
  const [, setParams] = useSearchParams();
  const params = useTaskPresentationParams();
  const lists = useQuery({ queryKey: ["task-lists"], queryFn: listAllTaskLists });
  const projects = useQuery({ queryKey: ["task-projects"], queryFn: listAllTaskProjects });
  const records = selectTaskContainers(
    kind,
    lists.data?.items ?? [],
    projects.data?.items ?? [],
    params,
  );
  const filtered = Boolean(
    params.get("q") ||
      (params.get("containerStatus") &&
        params.get("containerStatus") !== (kind === "archive" ? "all" : "active")),
  );
  return (
    <div className="narrow-page flex min-w-0 flex-col gap-3">
      <QueryFeedback query={lists} title="Couldn’t load lists." />
      <QueryFeedback query={projects} title="Couldn’t load projects." />
      {lists.isPending || projects.isPending ? (
        <PageLoading />
      ) : !lists.data || !projects.data ? null : (
        <>
          <div className="flex min-h-9 items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              {records.length.toLocaleString()}{" "}
              {kind === "archive"
                ? records.length === 1
                  ? "item"
                  : "items"
                : records.length === 1
                  ? kind.slice(0, -1)
                  : kind}
              {params.get("q") ? ` matching “${params.get("q")}”` : ""}
            </span>
            {filtered ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setParams((current) => {
                    const next = new URLSearchParams(current);
                    next.delete("q");
                    next.delete("containerStatus");
                    return next;
                  })
                }
              >
                Clear filters
              </Button>
            ) : null}
          </div>
          <ItemGroup
            className="grid grid-cols-1 items-stretch md:grid-cols-2 xl:grid-cols-3"
            aria-label={kind === "archive" ? "Archive" : kind === "lists" ? "Lists" : "Projects"}
          >
            {records.map((record) => {
              const project = "listId" in record ? record : undefined;
              const list = project
                ? lists.data.items.find((item) => item.id === project.listId)
                : (record as TaskList);
              const Icon = project ? ProjectIcon : getTaskListIcon(list?.icon);
              const archived =
                record.availability === "archived" || list?.availability === "archived";
              const href = archived
                ? `/tasks?archive=${project ? "project" : "list"}&${project ? "project" : "list"}=${record.id}`
                : project && project.lifecycle !== "open"
                  ? `/tasks?view=history&project=${project.id}&status=${project.lifecycle}`
                  : taskPath(
                      new URLSearchParams(),
                      project
                        ? { list: project.listId, project: project.id }
                        : list?.kind === "inbox"
                          ? {}
                          : { list: record.id },
                    );
              const description = project ? project.why : list?.description;
              return (
                <Item
                  key={record.id}
                  variant="outline"
                  role="listitem"
                  className="h-full flex-col items-stretch p-4"
                >
                  <div className="flex w-full min-w-0 items-start gap-2">
                    <Link to={href} className="flex min-w-0 flex-1 items-center gap-2">
                      <ItemMedia variant="icon">
                        <Icon aria-hidden="true" />
                      </ItemMedia>
                      <ItemTitle className="break-words">{record.name}</ItemTitle>
                    </Link>
                    {kind !== "archive" ? (
                      <TaskContainerPin
                        id={record.id}
                        kind={project ? "project" : "list"}
                        name={record.name}
                      />
                    ) : null}
                    {list && !archived ? (
                      <TaskContainerActions
                        list={list}
                        {...(project ? { project } : {})}
                        lists={lists.data.items}
                        projects={projects.data.items}
                      />
                    ) : null}
                  </div>
                  <ItemContent>
                    <Link
                      to={href}
                      className="flex min-w-0 flex-col gap-2 rounded-md focus-visible:outline focus-visible:outline-2"
                    >
                      {description ? <ItemDescription>{description}</ItemDescription> : null}
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        {project ? (
                          <span>{list?.name ?? "List unavailable"}</span>
                        ) : (
                          <span>
                            {
                              projects.data.items.filter(
                                (item) =>
                                  item.listId === record.id &&
                                  item.availability === "active" &&
                                  item.lifecycle === "open",
                              ).length
                            }{" "}
                            active projects
                          </span>
                        )}
                        {project?.targetDate ? (
                          <span>Target {formatCalendarDate(project.targetDate)}</span>
                        ) : null}
                        {archived ? (
                          <Badge variant="secondary">Archived</Badge>
                        ) : project && project.lifecycle !== "open" ? (
                          <Badge variant="secondary">
                            {project.lifecycle === "completed" ? "Completed" : "Cancelled"}
                          </Badge>
                        ) : null}
                      </div>
                    </Link>
                  </ItemContent>
                </Item>
              );
            })}
          </ItemGroup>
          {!records.length ? (
            <Item variant="outline">
              <ItemMedia variant="icon">
                {kind !== "lists" ? <ProjectIcon /> : <ListTodoIcon />}
              </ItemMedia>
              <ItemContent>
                <ItemTitle>
                  {filtered
                    ? "No matches"
                    : kind === "archive"
                      ? "Archive is empty"
                      : `No active ${kind}`}
                </ItemTitle>
                <ItemDescription>
                  {filtered
                    ? "Try another search or status."
                    : kind === "archive"
                      ? "Archived lists and finished projects will appear here."
                      : "Use the plus button to create one."}
                </ItemDescription>
              </ItemContent>
            </Item>
          ) : null}
        </>
      )}
    </div>
  );
}
