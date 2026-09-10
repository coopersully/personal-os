import type { TaskWorkspaceQuery } from "@personal-os/domain";

export const workspaceFilterKeys = [
  "kind",
  "status",
  "priority",
  "tag",
  "due",
  "reserved",
  "dueAfter",
  "dueBefore",
  "scheduledAfter",
  "scheduledBefore",
] as const;
export const workspaceViews = ["all", "today", "upcoming", "history", "trash"] as const;

export function canonicalWorkspaceParams(current: URLSearchParams, reminders = false) {
  const params = new URLSearchParams(current);
  const view = params.get("view");
  if (view === "scheduled") {
    params.set("view", "all");
    params.set("reserved", "scheduled");
    if (!params.has("sort")) params.set("sort", "reserved");
  }
  if (view === "completed" || view === "cancelled") {
    params.set("view", "history");
    params.set("status", view);
  }
  if (params.has("lifecycle")) {
    params.set("status", params.get("lifecycle") as string);
    params.delete("lifecycle");
  }
  if (reminders) {
    if (!params.has("view")) params.set("view", "all");
    params.set("kind", "reminder");
  }
  return params;
}

export function workspaceQuery(
  params: URLSearchParams,
  inboxId?: string,
): Partial<TaskWorkspaceQuery> {
  const view = workspaceViews.find((value) => value === params.get("view"));
  const projectId = params.get("project");
  const listId = params.get("list") ?? (!view && !projectId ? inboxId : undefined);
  const values: Record<string, unknown> = { view: view ?? "all" };
  for (const key of [...workspaceFilterKeys, "sort", "group"] as const) {
    const value = params.get(key);
    if (value) values[key] = value;
  }
  if (params.get("q")?.trim()) values.query = params.get("q")?.trim();
  if (listId) values.listId = listId;
  if (projectId) values.projectId = projectId;
  // Lists and projects only own tasks. Changing presentation never converts reminders.
  if (listId || projectId) values.kind = "task";
  return values as Partial<TaskWorkspaceQuery>;
}

export function workspacePath(params: URLSearchParams) {
  return params.size ? `/tasks?${params}` : "/tasks";
}

export function withWorkspaceOption(
  params: URLSearchParams,
  key: string,
  value: string,
  defaultValue = "",
) {
  const next = new URLSearchParams(params);
  next.delete("task");
  next.delete("reminder");
  if (!value || value === defaultValue) next.delete(key);
  else next.set(key, value);
  return workspacePath(next);
}
