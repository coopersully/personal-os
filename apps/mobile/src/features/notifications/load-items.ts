import type { TaskWorkspaceItem, TaskWorkspaceQuery } from "@personal-os/domain";

/** Scan all pages before choosing the nearest deadlines: API date order also includes reservations. */
export async function loadAlertItems(
  list: (
    query: Partial<TaskWorkspaceQuery>,
  ) => Promise<{ items: TaskWorkspaceItem[]; nextCursor: string | null }>,
  active: () => boolean,
  now: () => number = Date.now,
) {
  const started = now();
  const dueAfter = new Date(started).toISOString();
  const items: TaskWorkspaceItem[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 30; page++) {
    if (!active()) return null;
    if (now() - started > 45_000) throw new Error("Refreshing device alerts timed out.");
    const result = await list({
      view: "all",
      status: "open",
      due: "dated",
      dueAfter,
      sort: "date",
      limit: 100,
      cursor,
    });
    if (!active()) return null;
    items.push(...result.items);
    if (!result.nextCursor) return items;
    if (page === 29 || seen.has(result.nextCursor))
      throw new Error("The reminder schedule could not be refreshed completely.");
    seen.add(result.nextCursor);
    cursor = result.nextCursor;
  }
  return items;
}
