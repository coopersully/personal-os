// @vitest-environment jsdom
import type { Task, TaskListQuery } from "@personal-os/domain";
import * as appModule from "./app.js";

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

type AppTaskHelpers = {
  loadAllTaskPages: (
    loadPage: (query: Partial<TaskListQuery>) => Promise<{
      items: Task[];
      nextCursor: string | null;
    }>,
    query: Partial<TaskListQuery>,
  ) => Promise<{ items: Task[]; nextCursor: null }>;
  selectTodayTasks: (
    tasks: Task[],
    current: Date,
    timeZone: string,
  ) => { overdue: Task[]; today: Task[] };
};

const helpers = appModule as typeof appModule & Partial<AppTaskHelpers>;

describe("Task relevance in shared web surfaces", () => {
  it("loads every open Task page for exact badge and workspace counts", async () => {
    expect(helpers.loadAllTaskPages).toBeTypeOf("function");
    const first = Array.from({ length: 100 }, (_, index) => task(index + 1));
    const older = Array.from({ length: 31 }, (_, index) =>
      task(index + 101, {
        dueAt: index === 30 ? "2026-08-10T12:00:00.000Z" : null,
      }),
    );
    const loadPage = vi.fn(async (query: Partial<TaskListQuery>) =>
      query.cursor ? { items: older, nextCursor: null } : { items: first, nextCursor: "page-2" },
    );

    const result = await helpers.loadAllTaskPages?.(loadPage, { lifecycle: "open" });

    expect(result?.items).toHaveLength(131);
    expect(result?.items.filter((candidate) => candidate.dueAt !== null)).toHaveLength(1);
    expect(loadPage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ cursor: "page-2", lifecycle: "open", limit: 100 }),
    );
  });

  it("guards a repeated Task cursor instead of looping or returning a false total", async () => {
    expect(helpers.loadAllTaskPages).toBeTypeOf("function");
    const loadPage = vi.fn(async () => ({ items: [task(1)], nextCursor: "repeat" }));

    await expect(helpers.loadAllTaskPages?.(loadPage, { lifecycle: "open" })).rejects.toThrow(
      "repeated cursor",
    );
    expect(loadPage).toHaveBeenCalledTimes(2);
  });

  it("selects only overdue or locally due/reserved Tasks across a timezone boundary", () => {
    expect(helpers.selectTodayTasks).toBeTypeOf("function");
    const current = new Date("2026-08-12T03:30:00.000Z"); // Aug 11, 11:30 PM in New York.
    const overdue = task(1, { dueAt: "2026-08-12T02:30:00.000Z" });
    const reservedToday = task(2, { scheduledAt: "2026-08-12T02:00:00.000Z" });
    const dueToday = task(3, { dueAt: "2026-08-12T03:45:00.000Z" });
    const dueAfterUtcMidnightButTomorrowLocally = task(4, {
      dueAt: "2026-08-12T04:30:00.000Z",
    });
    const reservedTomorrow = task(5, { scheduledAt: "2026-08-12T05:00:00.000Z" });
    const undated = task(6);

    const selected = helpers.selectTodayTasks?.(
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

    expect(selected?.overdue.map(({ id }) => id)).toEqual([overdue.id]);
    expect(selected?.today.map(({ id }) => id)).toEqual([reservedToday.id, dueToday.id]);
  });

  it("includes a scheduled-today Task even when it has no deadline", () => {
    expect(helpers.selectTodayTasks).toBeTypeOf("function");
    const reserved = task(1, { scheduledAt: "2026-08-12T15:00:00.000Z" });

    expect(
      helpers
        .selectTodayTasks?.([reserved], new Date("2026-08-12T14:00:00.000Z"), "UTC")
        .today.map(({ id }) => id),
    ).toEqual([reserved.id]);
  });
});
