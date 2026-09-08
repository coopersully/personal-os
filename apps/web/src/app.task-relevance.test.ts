// @vitest-environment jsdom
import type { Task } from "@personal-os/domain";
import {
  dateTimeLocalToIso,
  formatEventRange,
  formatMinutes,
  formatTimelineTimeRange,
  initials,
  minuteToTime,
  normalizeShellPathname,
  nullable,
  selectTodayTasks,
  toDateTimeLocal,
  weatherSkyPeriod,
  workspaceOwnerName,
} from "./app.js";
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
    const completed = task(7, { lifecycle: "completed" });
    const deleted = task(8, { deletedAt: "2026-08-12T03:00:00.000Z" });

    const selected = selectTodayTasks(
      [
        overdue,
        reservedToday,
        dueToday,
        dueAfterUtcMidnightButTomorrowLocally,
        reservedTomorrow,
        undated,
        completed,
        deleted,
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

  it("keeps shell identity and local date-time helpers deterministic at their boundaries", () => {
    expect(initials("Alex Morgan Cooper")).toBe("AM");
    expect(initials("  alex  ")).toBe("A");
    expect(
      workspaceOwnerName({ displayName: " Alex Morgan ", email: "alex@example.com" } as never),
    ).toBe("Alex");
    expect(workspaceOwnerName({ displayName: " ", email: "cooper@example.com" } as never)).toBe(
      "cooper",
    );
    expect(workspaceOwnerName({ displayName: " ", email: "@example.com" } as never)).toBe("Your");
    expect(nullable("  value  ")).toBe("value");
    expect(nullable("   ")).toBeNull();
    expect(nullable(null)).toBeNull();
    expect(normalizeShellPathname("/today/")).toBe("/today");
    expect(normalizeShellPathname("")).toBe("/");
    expect(toDateTimeLocal(null, "UTC")).toBe("");
    expect(toDateTimeLocal("2026-09-07T13:05:00.000Z", "UTC")).toBe("2026-09-07T13:05");
    expect(toDateTimeLocal(undefined, "UTC", 0)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(dateTimeLocalToIso("2026-09-07T13:05", "UTC")).toBe("2026-09-07T13:05:00.000Z");
    expect(minuteToTime(0)).toBe("00:00");
    expect(minuteToTime(13 * 60 + 5)).toBe("13:05");
  });

  it("formats every timeline duration, sky period, and event-range shape", () => {
    expect(formatMinutes(0)).toBe("No time");
    expect(formatMinutes(15)).toBe("15 min");
    expect(formatMinutes(60)).toBe("1 hr");
    expect(formatMinutes(75)).toBe("1 hr 15 min");
    expect(weatherSkyPeriod("2026-09-07T06:00:00.000Z", "UTC")).toBe("morning");
    expect(weatherSkyPeriod("2026-09-07T12:00:00.000Z", "UTC")).toBe("day");
    expect(weatherSkyPeriod("2026-09-07T18:00:00.000Z", "UTC")).toBe("evening");
    expect(weatherSkyPeriod("2026-09-07T23:00:00.000Z", "UTC")).toBe("night");
    const event = (startsAt: string, endsAt: string, allDay = false) =>
      ({ allDay, startsAt, endsAt }) as never;
    expect(
      formatEventRange(event("2026-09-07T10:00:00Z", "2026-09-07T11:00:00Z"), "UTC"),
    ).toContain("10:00 AM–11:00 AM");
    expect(
      formatEventRange(event("2026-09-07T10:00:00Z", "2026-09-08T11:00:00Z"), "UTC"),
    ).toContain("Sep 8");
    expect(
      formatEventRange(event("2026-12-31T10:00:00Z", "2027-01-01T11:00:00Z"), "UTC"),
    ).toContain("2027");
    expect(
      formatEventRange(event("2026-09-07T00:00:00Z", "2026-09-08T00:00:00Z", true), "UTC"),
    ).toContain("All day");
    expect(
      formatEventRange(event("2026-09-07T00:00:00Z", "2026-09-10T00:00:00Z", true), "UTC"),
    ).toContain("–");
    expect(
      formatTimelineTimeRange(event("2026-09-07T10:00:00Z", "2026-09-07T11:00:00Z"), "UTC"),
    ).toBe("10:00 AM–11:00 AM");
    expect(
      formatTimelineTimeRange(event("2026-09-07T10:00:00Z", "2026-09-07T10:00:30Z"), "UTC"),
    ).toContain("UTC");
  });
});
