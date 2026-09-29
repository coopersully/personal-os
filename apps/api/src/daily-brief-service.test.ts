import type { Task, TaskListQuery } from "@personal-os/domain";
import { createDailyBriefService } from "./daily-brief-service.js";

const taskBase: Task = {
  cancelledAt: null,
  completedAt: null,
  createdAt: "2026-08-12T12:00:00.000Z",
  deletedAt: null,
  dueAt: null,
  estimateMinutes: 15,
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
  timezone: "UTC",
  title: "Task",
  updatedAt: "2026-08-12T12:00:00.000Z",
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

function planningDatabase() {
  return {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => [{ end: 17 * 60, start: 9 * 60 }] }),
      }),
    }),
  } as never;
}

describe("daily brief task material", () => {
  it("includes older relevant open and completed Tasks beyond the first page", async () => {
    const newestOpen = Array.from({ length: 100 }, (_, index) => task(index + 1));
    const olderOverdue = task(101, {
      createdAt: "2026-01-01T12:00:00.000Z",
      dueAt: "2026-08-11T15:00:00.000Z",
      priority: "high",
      title: "Older overdue priority",
    });
    const newestCompleted = Array.from({ length: 100 }, (_, index) =>
      task(index + 201, {
        completedAt: "2026-08-12T12:30:00.000Z",
        lifecycle: "completed",
        legacyStatus: "completed",
      }),
    );
    const olderCompleted = task(301, {
      completedAt: "2026-08-12T13:00:00.000Z",
      lifecycle: "completed",
      legacyStatus: "completed",
      title: "Older completed Task",
    });
    const listTasks = vi.fn(async (_userId: string, query: TaskListQuery) => {
      if (query.lifecycle === "open") {
        return query.cursor
          ? { items: [olderOverdue], nextCursor: null }
          : { items: newestOpen, nextCursor: "open-page-2" };
      }
      return query.cursor
        ? { items: [olderCompleted], nextCursor: null }
        : { items: newestCompleted, nextCursor: "completed-page-2" };
    });
    const dailyBrief = createDailyBriefService({
      db: planningDatabase(),
      listEvents: async () => [],
      listReminders: async () => [],
      listTasks,
      now: () => new Date("2026-08-12T14:00:00.000Z"),
    });

    const brief = await dailyBrief.dailyBrief(
      "20000000-0000-4000-8000-000000000001",
      "America/New_York",
    );

    expect(brief.tasks).toHaveLength(101);
    expect(brief.completedTasks).toHaveLength(101);
    expect(brief.recommendedTasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          task: expect.objectContaining({ id: olderOverdue.id }),
          urgency: "overdue",
        }),
      ]),
    );
    expect(brief.completedTasks.map(({ id }) => id)).toContain(olderCompleted.id);
    expect(listTasks).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ cursor: "open-page-2", lifecycle: "open" }),
    );
    expect(listTasks).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ cursor: "completed-page-2", lifecycle: "completed" }),
    );
  });

  it("fails instead of publishing a partial brief when a Task cursor repeats", async () => {
    const dailyBrief = createDailyBriefService({
      db: planningDatabase(),
      listEvents: async () => [],
      listReminders: async () => [],
      listTasks: async () => ({ items: [task(1)], nextCursor: "same-cursor" }),
      now: () => new Date("2026-08-12T14:00:00.000Z"),
    });

    await expect(
      dailyBrief.dailyBrief("20000000-0000-4000-8000-000000000001", "UTC"),
    ).rejects.toThrow("repeated cursor");
  });
});
