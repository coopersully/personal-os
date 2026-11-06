import type { TaskWorkspaceItem } from "@personal-os/domain";
export const notificationPrefix = "personal-os.due.";
export type DueAlert = {
  identifier: string;
  owner: string;
  id: string;
  kind: "task" | "reminder";
  dueAt: string;
};
/** Reserve capacity for other app notifications. Never replay overdue items. */
export function planAlerts(
  owner: string,
  items: TaskWorkspaceItem[],
  now: number,
  limit = 50,
): DueAlert[] {
  const unique = new Map<string, DueAlert>();
  for (const item of items) {
    const record = item.record;
    if (
      item.deletedAt ||
      item.readOnly ||
      !record.dueAt ||
      Date.parse(record.dueAt) <= now ||
      !Number.isFinite(Date.parse(record.dueAt))
    )
      continue;
    if (item.kind === "task" ? item.record.lifecycle !== "open" : !!item.record.completedAt)
      continue;
    const identifier = `${notificationPrefix}${owner}.${item.kind}.${record.id}`;
    unique.set(identifier, {
      identifier,
      owner,
      id: record.id,
      kind: item.kind,
      dueAt: record.dueAt,
    });
  }
  return [...unique.values()]
    .sort(
      (a, b) =>
        Date.parse(a.dueAt) - Date.parse(b.dueAt) || a.identifier.localeCompare(b.identifier),
    )
    .slice(0, limit);
}
export function alertTarget(data: Record<string, unknown>, owner: string | null) {
  if (
    !owner ||
    data.owner !== owner ||
    (data.kind !== "task" && data.kind !== "reminder") ||
    typeof data.id !== "string" ||
    !/^[a-zA-Z0-9-]{1,100}$/.test(data.id)
  )
    return null;
  return { id: data.id, kind: data.kind };
}
export function notificationChanges(
  desired: DueAlert[],
  existing: { identifier: string; dueAt?: unknown }[],
) {
  return {
    cancel: existing
      .filter(
        (request) =>
          request.identifier.startsWith(notificationPrefix) &&
          !desired.some(
            (alert) => alert.identifier === request.identifier && alert.dueAt === request.dueAt,
          ),
      )
      .map((request) => request.identifier),
    schedule: desired.filter(
      (alert) =>
        !existing.some(
          (request) => request.identifier === alert.identifier && request.dueAt === alert.dueAt,
        ),
    ),
  };
}
