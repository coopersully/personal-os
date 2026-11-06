import type { createApiClient } from "@personal-os/api-client";
import type { TaskWorkspaceItem } from "@personal-os/domain";
import { describe, expect, it, vi } from "vitest";
import { actOnItem, allPages, uniqueItems } from "./logic";

const task = {
  kind: "task",
  readOnly: false,
  record: { id: "same", revision: 7, lifecycle: "open" },
} as TaskWorkspaceItem;
const reminder = {
  kind: "reminder",
  readOnly: false,
  record: { id: "same", updatedAt: "2026-11-05T12:00:00Z" },
} as TaskWorkspaceItem;
describe("mobile task boundaries", () => {
  it("keeps task and reminder identities separate and replaces stale page records", () => {
    const updated = { ...task, record: { ...task.record, revision: 8 } } as TaskWorkspaceItem;
    expect(uniqueItems([task, reminder, updated])).toEqual([reminder, updated]);
  });
  it("loads each page and rejects a looping cursor", async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce({ items: [1], nextCursor: "next" })
      .mockResolvedValueOnce({ items: [2], nextCursor: null });
    expect(await allPages(load)).toEqual([1, 2]);
    expect(load).toHaveBeenLastCalledWith("next");
    await expect(allPages(async () => ({ items: [], nextCursor: "loop" }))).rejects.toThrow(
      "Repeated",
    );
  });
  it("bounds unexpectedly endless pagination", async () => {
    let page = 0;
    await expect(allPages(async () => ({ items: [], nextCursor: String(++page) }))).rejects.toThrow(
      "Too many",
    );
    expect(page).toBe(30);
  });
  it("sends the correct optimistic concurrency guards for both record kinds", async () => {
    const api = {
      completeTask: vi.fn(),
      completeReminder: vi.fn(),
      trashReminder: vi.fn(),
      restoreTask: vi.fn(),
    };
    const client = api as unknown as ReturnType<typeof createApiClient>;
    await actOnItem(client, task, "complete");
    await actOnItem(client, task, "restore");
    await actOnItem(client, reminder, "reopen");
    await actOnItem(client, reminder, "trash");
    expect(api.completeTask).toHaveBeenCalledWith("same", { expectedRevision: 7 });
    expect(api.restoreTask).toHaveBeenCalledWith("same", { expectedRevision: 7 });
    expect(api.completeReminder).toHaveBeenCalledWith("same", false, reminder.record.updatedAt);
    expect(api.trashReminder).toHaveBeenCalledWith("same", reminder.record.updatedAt);
  });
  it("rejects read-only writes and invalid reminder cancellation before contacting the API", async () => {
    const client = {} as ReturnType<typeof createApiClient>;
    await expect(actOnItem(client, { ...task, readOnly: true }, "trash")).rejects.toThrow(
      "read-only",
    );
    await expect(actOnItem(client, reminder, "cancel")).rejects.toThrow("cancelled");
  });
});
