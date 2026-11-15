import type { TaskWorkspaceItem, TaskWorkspaceQuery } from "@personal-os/domain";

const formatMoment = (value: string, timezone: string) =>
  new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
  });
/** Keep the scan line about urgency. Context and the saved row details sit on their own lines. */
export function taskMetadata(item: TaskWorkspaceItem, timezone = "UTC") {
  return [
    item.readOnly ? "Read-only" : null,
    item.kind === "reminder" ? "Reminder" : null,
    item.record.priority === "high" ? "High priority" : null,
    item.record.dueAt ? `Due ${formatMoment(item.record.dueAt, timezone)}` : null,
  ].filter((value): value is string => !!value);
}
export type TaskRowDetail = "estimate" | "tags" | "notes";
/** Rows show at most this many tags; the rest are counted, never dropped silently. */
export const visibleRowTags = 5;
export function formatEstimate(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${minutes} min`;
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
}
/**
 * What a row shows under its urgency line. Reserved time and the owning List or Project always
 * show when the task has them; estimate, notes and tags follow the saved row-detail preference.
 * An absent value yields nothing, never a placeholder.
 */
export function taskRowDetails(
  item: TaskWorkspaceItem,
  {
    details = [],
    timezone = "UTC",
    list,
    project,
  }: {
    details?: readonly TaskRowDetail[];
    timezone?: string;
    /** Names of the owning containers; omit one the screen is already scoped to. */
    list?: string;
    project?: string;
  } = {},
) {
  const task = item.kind === "task" ? item.record : null;
  const container = task ? [list, project].filter(Boolean).join(" / ") : "";
  const notes = details.includes("notes") ? item.record.notes?.trim() : "";
  return {
    context: [
      task?.scheduledAt ? `Reserved ${formatMoment(task.scheduledAt, timezone)}` : null,
      task?.estimateMinutes && details.includes("estimate")
        ? formatEstimate(task.estimateMinutes)
        : null,
      container || null,
    ].filter((value): value is string => !!value),
    notes: notes || null,
    tags: task && details.includes("tags") ? task.tags : [],
  };
}
/** Everything a row shows besides its title, in reading order, for assistive technology. */
export function taskRowSummary(
  metadata: string[],
  { context, notes, tags }: ReturnType<typeof taskRowDetails>,
  overdue = false,
) {
  return [
    ...metadata.map((part) =>
      overdue && part.startsWith("Due ") ? part.replace("Due ", "Overdue ") : part,
    ),
    ...context,
    notes,
    tags.length ? `Tags: ${tags.join(", ")}` : null,
  ]
    .filter((value): value is string => !!value)
    .join(", ");
}
/** A project target is a calendar date, so it reads the same in every timezone. */
export function formatTargetDate(date: string) {
  const parsed = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(parsed.getTime())
    ? date
    : new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      }).format(parsed);
}
export function activeFilters(filters: Partial<TaskWorkspaceQuery>) {
  return Object.entries(filters).filter(
    ([, value]) => value !== undefined && value !== "" && value !== "any",
  );
}
export function matchingOptions<T extends { label: string }>(
  options: readonly T[],
  search: string,
) {
  const term = search.trim().toLocaleLowerCase();
  return options.filter((option) => option.label.toLocaleLowerCase().includes(term));
}

export function partitionPinned<T extends { kind: "list" | "project"; record: { id: string } }>(
  rows: T[],
  preferences?: { pinnedListIds: string[]; pinnedProjectIds: string[] },
) {
  const pinned = rows.filter(({ kind, record }) =>
    (kind === "list" ? preferences?.pinnedListIds : preferences?.pinnedProjectIds)?.includes(
      record.id,
    ),
  );
  return { pinned, directory: rows.filter((row) => !pinned.includes(row)) };
}
