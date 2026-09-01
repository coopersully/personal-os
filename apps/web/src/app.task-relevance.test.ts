// @vitest-environment jsdom
import type { Task } from "@personal-os/domain";
import { selectTodayTasks } from "./app.js";
import { loadAllTaskContainerPages } from "./features/tasks/page.js";

const taskBase: Task = {
  cancelledAt: null,
  completedAt: null,
  createdAt: "2026-08-12T03:00:00.000Z",
  deletedAt: null,
  dueAt: null,
  estimateMinutes: null,
  id: "00000000-0000-4000-8000-000000000001",
  legacyStatus: "inbox",
  lifecycle: "open",
  listId: "10000000-0000-4000-8000-000000000001",
  notes: null,
  priority: "medium",
  projectId: null,
  revision: 1,
  scheduledAt: null,
  source: {
    accountId: null,
    provider: "local",
    remoteId: "00000000-0000-4000-8000-000000000001",
    revision: "1",
    sourceType: "task",
  },
  tags: [],
  timezone: "America/New_York",
  title: "Task",
  updatedAt: "2026-08-12T03:00:00.000Z",
  why: null,
};

function task(sequence: number, values: Partial<Task> = {}): Task {
  const id = `00000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`;
  return {
    ...taskBase,
    ...values,
    id,
    source: { ...taskBase.source, remoteId: id },
    title: values.title ?? `Task ${sequence}`,
  };
}

describe("Task relevance in shared web surfaces", () => {
  it("selects only overdue or locally due/reserved Tasks across a timezone boundary", () => {
    const current = new Date("2026-08-12T03:30:00.000Z"); // Aug 11, 11:30 PM in New York.
    const overdue = task(1, { dueAt: "2026-08-12T02:30:00.000Z" });
    const reservedToday = task(2, { scheduledAt: "2026-08-12T02:00:00.000Z" });
    const dueToday = task(3, { dueAt: "2026-08-12T03:45:00.000Z" });
    const dueAfterUtcMidnightButTomorrowLocally = task(4, {
      dueAt: "2026-08-12T04:30:00.000Z",
    });
    const reservedTomorrow = task(5, { scheduledAt: "2026-08-12T05:00:00.000Z" });
    const undated = task(6);

    const selected = selectTodayTasks(
      [
        overdue,
        reservedToday,
        dueToday,
        dueAfterUtcMidnightButTomorrowLocally,
        reservedTomorrow,
        undated,
      ],
      current,
      "America/New_York",
    );

    expect(selected.overdue.map(({ id }) => id)).toEqual([overdue.id]);
    expect(selected.today.map(({ id }) => id)).toEqual([reservedToday.id, dueToday.id]);
  });

  it("includes a scheduled-today Task even when it has no deadline", () => {
    const reserved = task(1, { scheduledAt: "2026-08-12T15:00:00.000Z" });

    expect(
      selectTodayTasks([reserved], new Date("2026-08-12T14:00:00.000Z"), "UTC").today.map(
        ({ id }) => id,
      ),
    ).toEqual([reserved.id]);
  });

  it("guards repeated Task container cursors instead of looping forever", async () => {
    const loadPage = vi.fn(async () => ({ items: ["container"], nextCursor: "repeat" }));

    await expect(loadAllTaskContainerPages(loadPage)).rejects.toThrow("repeated cursor");
    expect(loadPage).toHaveBeenCalledTimes(2);
  });
});
