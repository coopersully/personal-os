import type { TaskList, TaskProject } from "@personal-os/domain";

export type ContainerMode = "lists" | "projects" | "archive";
export type ProjectStatus = "active" | "completed" | "cancelled" | "all";
export type ContainerRow =
  | { kind: "list"; record: TaskList }
  | { kind: "project"; record: TaskProject };

export const projectStatuses: readonly { value: ProjectStatus; label: string; empty: string }[] = [
  {
    value: "active",
    label: "Active",
    empty: "No matching projects. Add a project to organize your tasks.",
  },
  { value: "completed", label: "Completed", empty: "No completed projects." },
  { value: "cancelled", label: "Cancelled", empty: "No cancelled projects." },
  { value: "all", label: "All", empty: "No projects yet." },
];

/** "Completed" or "Cancelled" for a finished project; null while it is open. */
export const finishedProjectLabel = (project: Pick<TaskProject, "lifecycle">) =>
  project.lifecycle === "completed"
    ? "Completed"
    : project.lifecycle === "cancelled"
      ? "Cancelled"
      : null;

/**
 * The server rejects new work in a finished or archived project, and in a project whose owning
 * list is archived or deleted, so capture is not offered there.
 */
export const projectAcceptsNewWork = (
  project: Pick<TaskProject, "lifecycle" | "availability">,
  list: Pick<TaskList, "availability" | "deletedAt">,
) =>
  project.lifecycle === "open" &&
  project.availability === "active" &&
  list.availability === "active" &&
  !list.deletedAt;

/** A search that hides every project says so, whatever status is selected. */
export const projectEmptyMessage = (status: ProjectStatus, search: string) =>
  status !== "active" && search.trim()
    ? "No matching projects."
    : (projectStatuses.find(({ value }) => value === status)?.empty ?? "No matching projects.");

const matchesStatus = (project: TaskProject, status: ProjectStatus) =>
  status === "all" || project.lifecycle === (status === "active" ? "open" : status);

/** Projects outside Archive and Trash: their own record and owning List are both available. */
function availableProjects(lists: TaskList[], projects: TaskProject[]) {
  const active = new Set(
    lists.filter((row) => !row.deletedAt && row.availability === "active").map((row) => row.id),
  );
  return projects.filter(
    (row) => !row.deletedAt && row.availability === "active" && active.has(row.listId),
  );
}

export function projectStatusCounts(lists: TaskList[], projects: TaskProject[]) {
  const available = availableProjects(lists, projects);
  return Object.fromEntries(
    projectStatuses.map(({ value }) => [
      value,
      available.filter((row) => matchesStatus(row, value)).length,
    ]),
  ) as Record<ProjectStatus, number>;
}

/**
 * Finished projects stay in Projects under their status until archived; Archive holds only
 * archived containers and projects inherited from an archived List.
 */
export function containerDirectory({
  mode,
  status = "active",
  search,
  sort,
  lists,
  projects,
}: {
  mode: ContainerMode;
  status?: ProjectStatus;
  search: string;
  sort?: string;
  lists: TaskList[];
  projects: TaskProject[];
}): ContainerRow[] {
  const asList = (record: TaskList): ContainerRow => ({ kind: "list", record });
  const asProject = (record: TaskProject): ContainerRow => ({ kind: "project", record });
  const rows: ContainerRow[] =
    mode === "lists"
      ? lists.filter((row) => !row.deletedAt && row.availability === "active").map(asList)
      : mode === "projects"
        ? availableProjects(lists, projects)
            .filter((row) => matchesStatus(row, status))
            .map(asProject)
        : [
            ...lists.filter((row) => !row.deletedAt && row.availability === "archived").map(asList),
            ...projects
              .filter(
                (row) =>
                  !row.deletedAt &&
                  (row.availability === "archived" ||
                    lists.some(
                      (owner) => owner.id === row.listId && owner.availability === "archived",
                    )),
              )
              .map(asProject),
          ];
  const term = search.trim().toLocaleLowerCase();
  const target = (row: ContainerRow) =>
    (row.kind === "project" ? row.record.targetDate : null) ?? "9999";
  return rows
    .filter((row) =>
      (row.kind === "project"
        ? [row.record.name, row.record.why, row.record.notes]
        : [row.record.name, row.record.description]
      )
        .join(" ")
        .toLocaleLowerCase()
        .includes(term),
    )
    .sort(
      (a, b) =>
        (sort === "updated"
          ? b.record.updatedAt.localeCompare(a.record.updatedAt)
          : sort === "newest"
            ? b.record.createdAt.localeCompare(a.record.createdAt)
            : sort === "target"
              ? target(a).localeCompare(target(b))
              : 0) ||
        a.record.name.localeCompare(b.record.name) ||
        a.record.id.localeCompare(b.record.id),
    );
}
