// @vitest-environment jsdom
import type { TaskWorkspaceItem } from "@personal-os/domain";
import { availableActions, runWorkspaceBatch } from "./workspace-actions";

const task = {
  kind: "task",
  record: { id: "t", title: "Task", lifecycle: "open", revision: 3 },
  readOnly: false,
  deletedAt: null,
} as TaskWorkspaceItem;
const reminder = {
  kind: "reminder",
  record: { id: "r", title: "Reminder", completedAt: null, updatedAt: "2026-09-03T00:00:00.000Z" },
  readOnly: false,
  deletedAt: null,
} as TaskWorkspaceItem;

it("offers only actions compatible with the whole selection", () => {
  expect(availableActions([task, reminder])).toEqual(["complete", "trash"]);
  expect(availableActions([task, { ...reminder, readOnly: true }])).toEqual([]);
  expect(availableActions([{ ...task, deletedAt: "2026-09-03T00:00:00.000Z" }])).toEqual([
    "restore",
  ]);
  expect(availableActions([])).toEqual([]);
  expect(availableActions([{ ...task, deletedAt: "2026-09-03T00:00:00.000Z" }, reminder])).toEqual(
    [],
  );
  expect(
    availableActions([
      { ...task, record: { ...task.record, lifecycle: "completed" } } as TaskWorkspaceItem,
      {
        ...reminder,
        record: { ...reminder.record, completedAt: "2026-09-03T00:00:00.000Z" },
      } as TaskWorkspaceItem,
    ]),
  ).toEqual(["reopen", "trash"]);
});

it("dispatches every task and reminder action through its revision-guarded transport", async () => {
  const calls: string[] = [];
  const transport = {
    completeTask: async (id: string) => void calls.push(`complete-task:${id}`),
    reopenTask: async (id: string) => void calls.push(`reopen-task:${id}`),
    trashTask: async (id: string) => void calls.push(`trash-task:${id}`),
    restoreTask: async (id: string) => void calls.push(`restore-task:${id}`),
    completeReminder: async (id: string, complete: boolean) =>
      void calls.push(`complete-reminder:${id}:${complete}`),
    trashReminder: async (id: string) => void calls.push(`trash-reminder:${id}`),
    restoreReminder: async (id: string) => void calls.push(`restore-reminder:${id}`),
  };

  await runWorkspaceBatch([task, reminder], "complete", transport as never);
  await runWorkspaceBatch(
    [
      { ...task, record: { ...task.record, lifecycle: "completed" } } as TaskWorkspaceItem,
      {
        ...reminder,
        record: { ...reminder.record, completedAt: "2026-09-03T00:00:00.000Z" },
      } as TaskWorkspaceItem,
    ],
    "reopen",
    transport as never,
  );
  await runWorkspaceBatch([task, reminder], "trash", transport as never);
  await runWorkspaceBatch(
    [
      { ...task, deletedAt: "2026-09-03T00:00:00.000Z" },
      { ...reminder, deletedAt: "2026-09-03T00:00:00.000Z" },
    ],
    "restore",
    transport as never,
  );

  expect(calls).toEqual([
    "complete-task:t",
    "complete-reminder:r:true",
    "reopen-task:t",
    "complete-reminder:r:false",
    "trash-task:t",
    "trash-reminder:r",
    "restore-task:t",
    "restore-reminder:r",
  ]);
});

it("rejects batches above the explicit safety bound", async () => {
  await expect(
    runWorkspaceBatch(
      Array.from({ length: 101 }, () => task),
      "complete",
      {} as never,
    ),
  ).rejects.toThrow("not available");
});

it("preserves per-record revisions and reports partial failure explicitly", async () => {
  const applied: string[] = [];
  const transport = {
    completeTask: async (id: string, input: { expectedRevision?: number }) => {
      applied.push(`${id}:${input.expectedRevision}`);
    },
    completeReminder: async () => {
      throw new Error("Changed elsewhere");
    },
  };
  const result = await runWorkspaceBatch([task, reminder], "complete", transport as never);
  expect(applied).toEqual(["t:3"]);
  expect(result.succeeded).toEqual(["task:t"]);
  expect(result.failed).toEqual([
    { key: "reminder:r", title: "Reminder", message: "Changed elsewhere" },
  ]);
});

it("rejects incompatible actions before sending any mutation", async () => {
  await expect(
    runWorkspaceBatch([task, { ...reminder, readOnly: true }], "trash", {} as never),
  ).rejects.toThrow("not available");
});
