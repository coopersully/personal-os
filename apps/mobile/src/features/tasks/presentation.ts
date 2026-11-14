import type { TaskWorkspaceItem, TaskWorkspaceQuery } from "@personal-os/domain";
/** Keep the scan line about urgency. Full notes, tags and estimates stay in details. */
export function taskMetadata(item: TaskWorkspaceItem, timezone = "UTC") {
  return [
    item.readOnly ? "Read-only" : null,
    item.kind === "reminder" ? "Reminder" : null,
    item.record.priority === "high" ? "High priority" : null,
    item.record.dueAt
      ? `Due ${new Date(item.record.dueAt).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: timezone })}`
      : null,
  ].filter((value): value is string => !!value);
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
