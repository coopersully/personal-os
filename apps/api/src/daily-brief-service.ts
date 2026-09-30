import { type Database, users } from "@personal-os/database";
import type { AccessScope, DailyBrief, TaskListQuery } from "@personal-os/domain";
import {
  addLocalDays,
  localDateAt,
  localDateRange,
  localDateTimeToUtc,
  localDayRange,
} from "@personal-os/domain";
import { eq } from "drizzle-orm";
import { AppError } from "./errors.js";

type DailyBriefServiceOptions = {
  db: Database;
  listEvents: (userId: string, range: { from: string; to: string }) => Promise<DailyBrief["now"]>;
  listReminders: (userId: string) => Promise<DailyBrief["today"]>;
  listTasks: (
    userId: string,
    query: TaskListQuery,
  ) => Promise<DailyBrief["tasks"] | { items: DailyBrief["tasks"]; nextCursor: string | null }>;
  now: () => Date;
};

const maximumTaskPagesPerBrief = 100;

async function listAllTasks(
  options: DailyBriefServiceOptions,
  userId: string,
  query: TaskListQuery,
): Promise<DailyBrief["tasks"]> {
  const items: DailyBrief["tasks"] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  for (let pageNumber = 0; pageNumber < maximumTaskPagesPerBrief; pageNumber += 1) {
    const page = await options.listTasks(userId, { ...query, ...(cursor ? { cursor } : {}) });
    if (Array.isArray(page)) return [...items, ...page];
    items.push(...page.items);
    if (page.nextCursor === null) return items;
    if (seenCursors.has(page.nextCursor)) {
      throw new AppError("internal_error", "Task pagination returned a repeated cursor.");
    }
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  throw new AppError(
    "internal_error",
    `Task pagination exceeded ${maximumTaskPagesPerBrief} pages.`,
  );
}

export function createDailyBriefService(options: DailyBriefServiceOptions) {
  const { now } = options;

  async function dailyBrief(
    userId: string,
    timeZone: string,
    scopes?: ReadonlySet<AccessScope>,
  ): Promise<DailyBrief> {
    const current = now();
    const todayRange = localDayRange(current, timeZone);
    const localTomorrow = addLocalDays(localDateAt(current, timeZone), 1);
    const tomorrowRange = localDateRange(localTomorrow, addLocalDays(localTomorrow, 1), timeZone);
    const canReadTasks = scopes?.has("tasks:read") ?? true;
    const [todayEvents, tomorrow, reminders, tasks, completedTasks, planning] = await Promise.all([
      options.listEvents(userId, todayRange),
      options.listEvents(userId, tomorrowRange),
      options.listReminders(userId),
      canReadTasks
        ? listAllTasks(options, userId, { lifecycle: "open", limit: 100 })
        : Promise.resolve([]),
      canReadTasks
        ? listAllTasks(options, userId, { lifecycle: "completed", limit: 100 })
        : Promise.resolve([]),
      options.db
        .select({ end: users.workdayEndMinute, start: users.workdayStartMinute })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1),
    ]);
    const openReminders = reminders.filter((reminder) => reminder.completedAt === null);
    const currentTime = current.getTime();
    const endOfToday = new Date(todayRange.to).getTime();
    const openTasks = tasks.filter((task) => task.lifecycle === "open" && task.deletedAt === null);
    const capacity = calculateCapacity({
      current,
      events: todayEvents,
      planningWindow: planning[0] ?? { end: 17 * 60, start: 9 * 60 },
      tasks: openTasks,
      timeZone,
    });
    const recommendedTasks = recommendTasks({
      availableMinutes: capacity.availableMinutes,
      current,
      endOfToday,
      tasks: openTasks,
    });
    return {
      allDay: todayEvents.filter((event) => event.allDay),
      anytime: openReminders.filter((reminder) => reminder.dueAt === null),
      capacity,
      generatedAt: current.toISOString(),
      laterToday: todayEvents.filter(
        (event) => !event.allDay && new Date(event.startsAt).getTime() > currentTime,
      ),
      next:
        todayEvents.find(
          (event) => !event.allDay && new Date(event.startsAt).getTime() > currentTime,
        ) ?? null,
      now: todayEvents.filter(
        (event) =>
          !event.allDay &&
          new Date(event.startsAt).getTime() <= currentTime &&
          new Date(event.endsAt).getTime() > currentTime,
      ),
      overdue: openReminders.filter(
        (reminder) => reminder.dueAt !== null && new Date(reminder.dueAt).getTime() < currentTime,
      ),
      recommendedTasks,
      timeZone,
      tasks: openTasks,
      completedTasks: completedTasks.filter(
        (task) =>
          task.lifecycle === "completed" && task.completedAt !== null && task.deletedAt === null,
      ),
      today: openReminders.filter(
        (reminder) =>
          reminder.dueAt !== null &&
          new Date(reminder.dueAt).getTime() >= currentTime &&
          new Date(reminder.dueAt).getTime() < endOfToday,
      ),
      tomorrow,
    };
  }

  return { dailyBrief };
}

function recommendTasks({
  availableMinutes,
  current,
  endOfToday,
  tasks,
}: {
  availableMinutes: number;
  current: Date;
  endOfToday: number;
  tasks: DailyBrief["tasks"];
}): DailyBrief["recommendedTasks"] {
  let remainingMinutes = availableMinutes;
  return tasks
    .filter(
      (task) => task.lifecycle === "open" && task.deletedAt === null && task.scheduledAt === null,
    )
    .sort((left, right) => {
      const urgencyDifference =
        taskUrgencyRank(left, current, endOfToday) - taskUrgencyRank(right, current, endOfToday);
      if (urgencyDifference !== 0) return urgencyDifference;
      const priorityDifference = priorityRank(right.priority) - priorityRank(left.priority);
      if (priorityDifference !== 0) return priorityDifference;
      return left.createdAt.localeCompare(right.createdAt);
    })
    .map((task) => {
      const estimate = task.estimateMinutes;
      if (estimate === null) {
        return {
          capacity: "needs_estimate",
          task,
          urgency: taskUrgency(task, current, endOfToday),
        };
      }
      const fits = estimate <= remainingMinutes;
      if (fits) remainingMinutes -= estimate;
      return {
        capacity: fits ? "fits_remaining_time" : "does_not_fit",
        task,
        urgency: taskUrgency(task, current, endOfToday),
      };
    });
}

function taskUrgency(
  task: DailyBrief["tasks"][number],
  current: Date,
  endOfToday: number,
): DailyBrief["recommendedTasks"][number]["urgency"] {
  if (task.dueAt !== null && new Date(task.dueAt).getTime() < current.getTime()) return "overdue";
  if (task.dueAt !== null && new Date(task.dueAt).getTime() < endOfToday) return "due_today";
  return task.dueAt !== null || task.scheduledAt !== null ? "next" : "inbox";
}

function taskUrgencyRank(task: DailyBrief["tasks"][number], current: Date, endOfToday: number) {
  return { overdue: 0, due_today: 1, next: 2, inbox: 3 }[taskUrgency(task, current, endOfToday)];
}

function priorityRank(priority: DailyBrief["tasks"][number]["priority"]) {
  return { high: 3, low: 1, medium: 2 }[priority];
}

function calculateCapacity({
  current,
  events,
  planningWindow,
  tasks,
  timeZone,
}: {
  current: Date;
  events: DailyBrief["now"];
  planningWindow: { end: number; start: number };
  tasks: DailyBrief["tasks"];
  timeZone: string;
}): DailyBrief["capacity"] {
  const localDate = localDateAt(current, timeZone);
  const workdayStartsAt = localDateTimeToUtc(localDate, planningWindow.start, timeZone);
  const workdayEndsAt = localDateTimeToUtc(localDate, planningWindow.end, timeZone);
  const workStart = workdayStartsAt.getTime();
  const workEnd = workdayEndsAt.getTime();
  const occupied = mergeIntervals(
    events
      .filter((event) => !event.allDay)
      .map((event) => ({
        end: new Date(event.endsAt).getTime(),
        start: new Date(event.startsAt).getTime(),
      })),
  );
  const busyMinutes = events.some((event) => event.allDay)
    ? Math.max(0, Math.round((workEnd - Math.max(workStart, current.getTime())) / 60_000))
    : occupied.reduce(
        (total, interval) =>
          total +
          Math.max(
            0,
            Math.round(
              (Math.min(workEnd, interval.end) -
                Math.max(workStart, current.getTime(), interval.start)) /
                60_000,
            ),
          ),
        0,
      );
  const remainingWindowMinutes = Math.max(
    0,
    Math.round((workEnd - Math.max(workStart, current.getTime())) / 60_000),
  );
  const scheduledTaskIntervals = tasks
    .filter((task) => task.scheduledAt !== null && task.estimateMinutes !== null)
    .map((task) => {
      const start = new Date(task.scheduledAt as string).getTime();
      return { end: start + (task.estimateMinutes as number) * 60_000, start };
    });
  const scheduledTaskMinutes = scheduledTaskIntervals.reduce(
    (total, interval) =>
      total +
      Math.max(
        0,
        Math.round(
          (Math.min(workEnd, interval.end) -
            Math.max(workStart, current.getTime(), interval.start)) /
            60_000,
        ),
      ),
    0,
  );
  const flexibleTaskMinutes = tasks
    .filter((task) => task.scheduledAt === null)
    .reduce((total, task) => total + (task.estimateMinutes ?? 0), 0);
  const occupiedMinutes = events.some((event) => event.allDay)
    ? remainingWindowMinutes
    : mergeIntervals([...occupied, ...scheduledTaskIntervals]).reduce(
        (total, interval) =>
          total +
          Math.max(
            0,
            Math.round(
              (Math.min(workEnd, interval.end) -
                Math.max(workStart, current.getTime(), interval.start)) /
                60_000,
            ),
          ),
        0,
      );
  const availableMinutes = Math.max(0, remainingWindowMinutes - occupiedMinutes);
  return {
    availableMinutes,
    busyMinutes,
    flexibleTaskMinutes,
    overcommitted: scheduledTaskMinutes > Math.max(0, remainingWindowMinutes - busyMinutes),
    scheduledTaskMinutes,
    workdayEndsAt: workdayEndsAt.toISOString(),
    workdayStartsAt: workdayStartsAt.toISOString(),
  };
}

function mergeIntervals(intervals: Array<{ end: number; start: number }>) {
  const sorted = [...intervals].sort((left, right) => left.start - right.start);
  return sorted.reduce<Array<{ end: number; start: number }>>((merged, interval) => {
    const previous = merged.at(-1);
    if (previous && interval.start <= previous.end) {
      previous.end = Math.max(previous.end, interval.end);
    } else {
      merged.push({ ...interval });
    }
    return merged;
  }, []);
}
