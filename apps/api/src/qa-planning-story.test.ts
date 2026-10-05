import { describe, expect, it } from "vitest";
import { demoPlanningStory } from "./qa-planning-story.js";

const userId = "f1000000-0000-4000-8000-000000000001";
const inboxId = "f1000000-0000-4000-8000-000000009999";

describe("demo planning story", () => {
  it("provides consistent lifecycle states and valid project/list relationships", () => {
    const story = demoPlanningStory(userId, inboxId, new Date("2026-10-02T16:00:00Z"));
    const all = [...story.goals, ...story.motives, ...story.reminders, ...story.taskProjects];
    expect(new Set(all.map((row) => row.id)).size).toBe(all.length);
    expect(all.every((row) => row.userId === userId)).toBe(true);
    expect(new Set(story.goals.map((row) => row.status))).toEqual(
      new Set(["active", "paused", "completed"]),
    );
    expect(
      story.goals.filter((row) => row.status === "completed").every((row) => row.progress === 100),
    ).toBe(true);
    expect(new Set(story.motives.map((row) => row.isActive))).toEqual(new Set([true, false]));
    for (const task of story.reminders.filter((row) => row.kind === "task")) {
      if (task.taskProjectId) {
        const project = story.taskProjects.find((row) => row.id === task.taskProjectId);
        expect(project?.listId).toBe(task.taskListId);
        if (project?.lifecycle === "completed") expect(task.taskLifecycle).toBe("completed");
      }
      expect(Boolean(task.completedAt)).toBe(task.taskLifecycle === "completed");
      expect(Boolean(task.taskCancelledAt)).toBe(task.taskLifecycle === "cancelled");
      expect(task.notes).toBeTruthy();
      expect(task.taskWhy).toBeTruthy();
    }
    expect(story.reminders.some((row) => row.deletedAt)).toBe(true);
    expect(story.reminders.some((row) => row.scheduledAt)).toBe(true);
    expect(story.reminders.some((row) => row.dueAt === null)).toBe(true);
    expect(
      story.reminders
        .filter((row) => row.kind === "reminder")
        .every((row) => !row.taskLifecycle && !row.taskListId),
    ).toBe(true);
  });

  it("keeps identities stable while refreshing local dates across daylight saving", () => {
    const before = demoPlanningStory(userId, inboxId, new Date("2026-10-31T16:00:00Z"));
    const after = demoPlanningStory(userId, inboxId, new Date("2026-11-02T16:00:00Z"));
    expect(before.reminders.map((row) => row.id)).toEqual(after.reminders.map((row) => row.id));
    const callMom = after.reminders.find((row) => row.title === "Call Mom");
    expect(callMom?.dueAt?.toISOString()).toBe("2026-11-02T23:00:00.000Z");
    expect(after.goals.find((row) => row.status === "paused")?.targetDate).toBeNull();
  });
});
