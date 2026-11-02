import type { Reminder, Task } from "@personal-os/domain";
import { describe, expect, it, vi } from "vitest";
import {
  allCommitmentPages,
  commitmentDate,
  commitmentRange,
  scopedCommitments,
} from "./commitment-scope";

const task = (id: string, dueAt: string | null, scheduledAt: string | null = null) =>
  ({ id, dueAt, scheduledAt, lifecycle: "open", deletedAt: null }) as Task;
const reminder = (id: string, dueAt: string | null) =>
  ({ id, dueAt, completedAt: null }) as Reminder;
const now = "2026-10-25T12:00:00Z";
const range = { from: "2026-10-25", through: "2026-10-26" };

describe("Today commitment ranges", () => {
  it("uses the planning timezone and configured week boundary", () => {
    expect(commitmentDate("2026-10-25T02:00:00Z", "America/New_York")).toBe("2026-10-24");
    expect(commitmentRange("week", "2026-10-25", "monday", range)).toEqual({
      from: "2026-10-19",
      through: "2026-10-25",
    });
    expect(commitmentRange("week", "2026-10-25", "sunday", range)).toEqual({
      from: "2026-10-25",
      through: "2026-10-31",
    });
    expect(commitmentRange("month", "2026-12-25", "monday", range)).toEqual({
      from: "2026-12-01",
      through: "2026-12-31",
    });
    expect(commitmentRange("custom", "2026-10-25", "monday", range)).toEqual(range);
  });
  it("includes either task date once, excludes completed/deleted/undated records, and bounds custom dates", () => {
    const tasks = [
      task("due", "2026-10-26T15:00:00Z"),
      task("scheduled", null, "2026-10-25T20:00:00Z"),
      task("both", now, now),
      task("old", "2026-10-20T12:00:00Z"),
      task("future", "2026-10-28T12:00:00Z"),
      task("undated", null),
      { ...task("done", now), lifecycle: "completed" as const },
      { ...task("deleted", now), deletedAt: now },
    ];
    const reminders = [
      reminder("tomorrow", "2026-10-26T22:00:00Z"),
      reminder("undated", null),
      { ...reminder("done", now), completedAt: now },
    ];
    const ids = (includeOverdue: boolean) =>
      scopedCommitments(tasks, reminders, range, "UTC", now, includeOverdue).map((item) =>
        item.kind === "task" ? item.task.id : item.reminder.id,
      );
    expect(ids(false)).toEqual(["due", "scheduled", "both", "tomorrow"]);
    expect(ids(true)).toEqual(["old", "due", "scheduled", "both", "tomorrow"]);
  });
  it("loads every page and propagates failures instead of reporting a partial empty scope", async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce({ items: [1], nextCursor: "next" })
      .mockResolvedValueOnce({ items: [2], nextCursor: null });
    expect(await allCommitmentPages(load)).toEqual([1, 2]);
    expect(load).toHaveBeenLastCalledWith("next");
    await expect(
      allCommitmentPages(vi.fn().mockRejectedValue(new Error("offline"))),
    ).rejects.toThrow("offline");
  });
});
