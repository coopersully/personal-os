import type { createApiClient } from "@personal-os/api-client";
import type { TaskWorkspaceItem } from "@personal-os/domain";
import { describe, expect, it, vi } from "vitest";
import { actOnItem, actWithUndo, allPages, loadTrashedRecord, uniqueItems } from "./logic";

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

describe("confirmed action undo", () => {
  it("uses the completed task revision and preserves conflict rejection", async () => {
    const api = {
      completeTask: vi.fn().mockResolvedValue({ ...task.record, revision: 8 }),
      reopenTask: vi.fn().mockRejectedValue(new Error("conflict")),
    };
    const receipt = await actWithUndo(
      api as unknown as ReturnType<typeof createApiClient>,
      task,
      "complete",
    );
    await expect(receipt.undo()).rejects.toThrow("conflict");
    expect(api.reopenTask).toHaveBeenCalledWith("same", { expectedRevision: 8 });
  });
  it("restores trashed reminders with the returned timestamp", async () => {
    const api = {
      trashReminder: vi.fn().mockResolvedValue({ ...reminder.record, updatedAt: "new-version" }),
      restoreReminder: vi.fn(),
    };
    const receipt = await actWithUndo(
      api as unknown as ReturnType<typeof createApiClient>,
      reminder,
      "trash",
    );
    await receipt.undo();
    expect(api.restoreReminder).toHaveBeenCalledWith("same", "new-version");
  });
  it("does not offer an undo receipt for a failed write", async () => {
    const api = { trashTask: vi.fn().mockRejectedValue(new Error("offline")) };
    await expect(
      actWithUndo(api as unknown as ReturnType<typeof createApiClient>, task, "trash"),
    ).rejects.toThrow("offline");
  });
  it("restores the cancelled lifecycle when undoing reopen", async () => {
    const api = {
      reopenTask: vi.fn().mockResolvedValue({ ...task.record, revision: 8 }),
      cancelTask: vi.fn(),
    };
    const cancelled = {
      ...task,
      record: { ...task.record, lifecycle: "cancelled" },
    } as TaskWorkspaceItem;
    const receipt = await actWithUndo(
      api as unknown as ReturnType<typeof createApiClient>,
      cancelled,
      "reopen",
    );
    await receipt.undo();
    expect(api.cancelTask).toHaveBeenCalledWith("same", { expectedRevision: 8 });
  });
});

it("stops Trash lookup at the matching page and rejects looping or excessive pagination", async () => {
  const listTaskWorkspace = vi
    .fn()
    .mockResolvedValue({ items: [reminder, task], nextCursor: "more" });
  await expect(loadTrashedRecord({ listTaskWorkspace }, "task", "same")).resolves.toEqual(
    task.record,
  );
  expect(listTaskWorkspace).toHaveBeenCalledOnce();
  listTaskWorkspace.mockResolvedValue({ items: [], nextCursor: "loop" });
  await expect(loadTrashedRecord({ listTaskWorkspace }, "task", "missing")).rejects.toThrow(
    "Repeated pagination cursor",
  );
  let cursor = 0;
  listTaskWorkspace.mockImplementation(async () => ({ items: [], nextCursor: String(++cursor) }));
  await expect(loadTrashedRecord({ listTaskWorkspace }, "task", "missing")).rejects.toThrow(
    "Trash is too large",
  );
  expect(cursor).toBe(30);
});
