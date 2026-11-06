import type { TaskWorkspaceItem, TaskWorkspaceQuery } from "@personal-os/domain";
import { expect, it, vi } from "vitest";
import { loadAlertItems } from "./load-items";
import { planAlerts } from "./plan";

const start = Date.parse("2026-11-06T12:00:00Z");
const item = (id: string, dueAt: string) =>
  ({
    kind: "task",
    deletedAt: null,
    readOnly: false,
    record: { id, dueAt, lifecycle: "open" },
  }) as TaskWorkspaceItem;
it("keeps cursor filters stable and finds nearer deadlines beyond the first 50 eligible rows", async () => {
  let tick = start;
  const requests: Partial<TaskWorkspaceQuery>[] = [];
  const list = vi.fn(async (query: Partial<TaskWorkspaceQuery>) => {
    requests.push(query);
    return query.cursor
      ? { items: [item("soon", "2026-11-06T12:05:00Z")], nextCursor: null }
      : {
          items: Array.from({ length: 100 }, (_, i) => item(String(i), "2026-11-10T12:00:00Z")),
          nextCursor: "next",
        };
  });
  const result = await loadAlertItems(
    list,
    () => true,
    () => tick++,
  );
  expect(requests).toHaveLength(2);
  expect(requests[0].dueAfter).toBe(requests[1].dueAfter);
  expect(planAlerts("owner", result ?? [], start)[0].id).toBe("soon");
});
it("abandons results after an account/settings change", async () => {
  const active = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
  expect(await loadAlertItems(async () => ({ items: [], nextCursor: null }), active)).toBeNull();
});
it("fails without replacing the schedule on repeated cursors or a time limit", async () => {
  await expect(
    loadAlertItems(
      async () => ({ items: [], nextCursor: "same" }),
      () => true,
    ),
  ).rejects.toThrow("completely");
  let time = start;
  await expect(
    loadAlertItems(
      async () => ({ items: [], nextCursor: null }),
      () => true,
      () => {
        const value = time;
        time += 46_000;
        return value;
      },
    ),
  ).rejects.toThrow("timed out");
});
it("does not start a queued refresh after its owner or preference changed", async () => {
  const list = vi.fn().mockResolvedValue({ items: [], nextCursor: null });
  expect(await loadAlertItems(list, () => false)).toBeNull();
  expect(list).not.toHaveBeenCalled();
});
it("bounds a provider that keeps returning distinct cursors instead of replacing alerts with a partial schedule", async () => {
  const list = vi.fn(async () => ({ items: [], nextCursor: `page-${list.mock.calls.length}` }));
  await expect(
    loadAlertItems(
      list,
      () => true,
      () => start,
    ),
  ).rejects.toThrow("could not be refreshed completely");
  expect(list).toHaveBeenCalledTimes(30);
});
