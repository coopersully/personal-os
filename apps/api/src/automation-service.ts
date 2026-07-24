import {
  auditEvents,
  automationRoutines,
  automationRuns,
  type Database,
  users,
} from "@personal-os/database";
import type {
  AccessScope,
  AutomationRoutine,
  AutomationRun,
  CreateAutomationRoutineInput,
  DailyBrief,
  UpdateAutomationRoutineInput,
} from "@personal-os/domain";
import {
  addLocalDays,
  localDateAt,
  localDateRange,
  localDateTimeToUtc,
  localDayRange,
} from "@personal-os/domain";
import { and, desc, eq } from "drizzle-orm";
import { auditValues } from "./audit.js";
import { requireDatabaseRecord } from "./database.js";
import { AppError } from "./errors.js";
import type { Principal } from "./types.js";

type MutationContext = {
  principal: Principal;
  requestId: string;
};

type AutomationServiceOptions = {
  db: Database;
  listEvents: (userId: string, range: { from: string; to: string }) => Promise<DailyBrief["now"]>;
  listReminders: (userId: string) => Promise<DailyBrief["today"]>;
  listTasks: (userId: string, completed: boolean) => Promise<DailyBrief["tasks"]>;
  now: () => Date;
};

const automationTitles = {
  morning_brief: "Morning Brief",
  nightly_review: "Nightly Review",
} as const;

export function createAutomationService(options: AutomationServiceOptions) {
  const { db, now } = options;

  async function findRoutine(userId: string, id: string) {
    const [routine] = await db
      .select()
      .from(automationRoutines)
      .where(and(eq(automationRoutines.id, id), eq(automationRoutines.userId, userId)))
      .limit(1);
    if (!routine) throw new AppError("not_found", "The automation routine was not found.");
    return routine;
  }

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
      canReadTasks ? options.listTasks(userId, false) : Promise.resolve([]),
      canReadTasks ? options.listTasks(userId, true) : Promise.resolve([]),
      options.db
        .select({ end: users.workdayEndMinute, start: users.workdayStartMinute })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1),
    ]);
    const openReminders = reminders.filter((reminder) => reminder.completedAt === null);
    const currentTime = current.getTime();
    const endOfToday = new Date(todayRange.to).getTime();
    const openTasks = tasks.filter(
      (task) => task.completedAt === null && task.status !== "cancelled",
    );
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
      completedTasks: completedTasks.filter((task) => task.completedAt !== null),
      today: openReminders.filter(
        (reminder) =>
          reminder.dueAt !== null &&
          new Date(reminder.dueAt).getTime() >= currentTime &&
          new Date(reminder.dueAt).getTime() < endOfToday,
      ),
      tomorrow,
    };
  }

  return {
    dailyBrief,

    async dispatchDue(): Promise<AutomationRun[]> {
      const current = now();
      const routines = await db
        .select()
        .from(automationRoutines)
        .where(eq(automationRoutines.enabled, true));
      const runs: AutomationRun[] = [];
      for (const routine of routines) {
        if (!scheduleIsDue(routine.schedule, routine.lastRunAt, current, routine.timezone))
          continue;
        const brief = await dailyBrief(routine.userId, routine.timezone);
        const completedAt = now();
        const run = await db.transaction(async (transaction) => {
          const created = requireDatabaseRecord(
            (
              await transaction
                .insert(automationRuns)
                .values({
                  brief,
                  completedAt,
                  routineId: routine.id,
                  startedAt: current,
                  status: "completed",
                  summary: "Prepared a scheduled time-aware daily brief without changing material.",
                  userId: routine.userId,
                })
                .returning()
            )[0],
            "The scheduled automation run could not be recorded.",
          );
          await transaction
            .update(automationRoutines)
            .set({ lastRunAt: completedAt, updatedAt: completedAt })
            .where(eq(automationRoutines.id, routine.id));
          await transaction.insert(auditEvents).values(
            auditValues({
              action: "automation.dispatch",
              after: { runId: created.id, status: "completed" },
              before: null,
              entityId: routine.id,
              entityType: "automation_routine",
              principal: { actorId: routine.id, actorType: "system", userId: routine.userId },
              requestId: `scheduler:${routine.id}:${current.toISOString()}`,
            }),
          );
          return created;
        });
        runs.push(serializeRun(run));
      }
      return runs;
    },

    async create(userId: string, input: CreateAutomationRoutineInput): Promise<AutomationRoutine> {
      try {
        const routine = requireDatabaseRecord(
          (
            await db
              .insert(automationRoutines)
              .values({
                schedule: input.schedule,
                template: input.template,
                timezone: input.timezone,
                title: automationTitles[input.template],
                userId,
              })
              .returning()
          )[0],
          "The automation routine could not be created.",
        );
        return serializeRoutine(routine);
      } catch (error) {
        if (isUniqueRoutineError(error)) {
          throw new AppError("conflict", "This automation is already installed.");
        }
        throw error;
      }
    },

    async list(userId: string): Promise<AutomationRoutine[]> {
      const routines = await db
        .select()
        .from(automationRoutines)
        .where(eq(automationRoutines.userId, userId))
        .orderBy(desc(automationRoutines.createdAt));
      return routines.map(serializeRoutine);
    },

    async update(
      id: string,
      input: UpdateAutomationRoutineInput,
      context: MutationContext,
    ): Promise<AutomationRoutine> {
      const routine = await findRoutine(context.principal.userId, id);
      const updatedAt = now();
      const result = await db.transaction(async (transaction) => {
        const updated = requireDatabaseRecord(
          (
            await transaction
              .update(automationRoutines)
              .set({ ...input, updatedAt })
              .where(eq(automationRoutines.id, routine.id))
              .returning()
          )[0],
          "The automation routine could not be updated.",
        );
        await transaction.insert(auditEvents).values(
          auditValues({
            action: "automation.update",
            after: input,
            before: {
              enabled: routine.enabled,
              schedule: routine.schedule,
              timezone: routine.timezone,
            },
            entityId: routine.id,
            entityType: "automation_routine",
            ...context,
          }),
        );
        return updated;
      });
      return serializeRoutine(result);
    },

    async listRuns(userId: string, routineId?: string): Promise<AutomationRun[]> {
      const conditions = [eq(automationRuns.userId, userId)];
      if (routineId) conditions.push(eq(automationRuns.routineId, routineId));
      const runs = await db
        .select()
        .from(automationRuns)
        .where(and(...conditions))
        .orderBy(desc(automationRuns.startedAt))
        .limit(50);
      return runs.map(serializeRun);
    },

    async run(id: string, dryRun: boolean, context: MutationContext): Promise<AutomationRun> {
      const routine = await findRoutine(context.principal.userId, id);
      const startedAt = now();
      const brief = await dailyBrief(
        context.principal.userId,
        routine.timezone,
        context.principal.scopes,
      );
      const completedAt = now();
      const status = dryRun ? "dry_run" : "completed";
      const result = await db.transaction(async (transaction) => {
        const run = requireDatabaseRecord(
          (
            await transaction
              .insert(automationRuns)
              .values({
                brief,
                completedAt,
                routineId: routine.id,
                startedAt,
                status,
                summary: "Prepared a time-aware daily brief without changing your material.",
                userId: context.principal.userId,
              })
              .returning()
          )[0],
          "The automation run could not be recorded.",
        );
        if (!dryRun) {
          await transaction
            .update(automationRoutines)
            .set({ lastRunAt: completedAt, updatedAt: completedAt })
            .where(eq(automationRoutines.id, routine.id));
        }
        await transaction.insert(auditEvents).values(
          auditValues({
            action: "automation.run",
            after: { dryRun, runId: run.id, status },
            before: null,
            entityId: routine.id,
            entityType: "automation_routine",
            ...context,
          }),
        );
        return run;
      });
      return serializeRun(result);
    },
  };
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
    .filter((task) => task.status === "inbox" || task.status === "next")
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
  return task.status === "next" ? "next" : "inbox";
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
    .filter(
      (task) =>
        task.status === "scheduled" && task.scheduledAt !== null && task.estimateMinutes !== null,
    )
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
    .filter((task) => task.status === "inbox" || task.status === "next")
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

export function scheduleIsDue(
  schedule: string,
  lastRunAt: Date | null,
  current: Date,
  timeZone: string,
): boolean {
  const match = /^(Daily|Weekdays) at (\d{1,2}):(\d{2}) (AM|PM)$/.exec(schedule);
  if (!match) return false;
  const [, frequency, rawHour, rawMinute, meridiem] = match;
  const hour = Number(rawHour);
  const minute = Number(rawMinute);
  if (hour < 1 || hour > 12 || minute > 59) return false;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      hour12: false,
      minute: "2-digit",
      day: "2-digit",
      month: "2-digit",
      timeZone,
      weekday: "short",
      year: "numeric",
    })
      .formatToParts(current)
      .map((part) => [part.type, part.value]),
  );
  if (frequency === "Weekdays" && (parts.weekday === "Sat" || parts.weekday === "Sun"))
    return false;
  const scheduledHour = (hour % 12) + (meridiem === "PM" ? 12 : 0);
  if (Number(parts.hour) * 60 + Number(parts.minute) < scheduledHour * 60 + minute) return false;
  if (lastRunAt === null) return true;
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  const lastParts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      day: "2-digit",
      month: "2-digit",
      timeZone,
      year: "numeric",
    })
      .formatToParts(lastRunAt)
      .map((part) => [part.type, part.value]),
  );
  return day !== `${lastParts.year}-${lastParts.month}-${lastParts.day}`;
}

function isUniqueRoutineError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const value = error as { cause?: unknown; code?: string };
  return (
    value.code === "23505" ||
    (typeof value.cause === "object" &&
      value.cause !== null &&
      (value.cause as { code?: string }).code === "23505")
  );
}

function serializeRoutine(row: typeof automationRoutines.$inferSelect): AutomationRoutine {
  return {
    createdAt: row.createdAt.toISOString(),
    enabled: row.enabled,
    id: row.id,
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    schedule: row.schedule,
    template: row.template,
    timezone: row.timezone,
    title: row.title,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeRun(row: typeof automationRuns.$inferSelect): AutomationRun {
  const storedBrief = row.brief as Partial<DailyBrief> | null;
  return {
    brief: storedBrief
      ? ({
          ...storedBrief,
          capacity: storedBrief.capacity ?? {
            availableMinutes: 0,
            busyMinutes: 0,
            flexibleTaskMinutes: 0,
            overcommitted: false,
            scheduledTaskMinutes: 0,
            workdayEndsAt: storedBrief.generatedAt ?? row.startedAt.toISOString(),
            workdayStartsAt: storedBrief.generatedAt ?? row.startedAt.toISOString(),
          },
          completedTasks: storedBrief.completedTasks ?? [],
          recommendedTasks: storedBrief.recommendedTasks ?? [],
          tasks: storedBrief.tasks ?? [],
        } as DailyBrief)
      : null,
    completedAt: row.completedAt?.toISOString() ?? null,
    id: row.id,
    routineId: row.routineId,
    startedAt: row.startedAt.toISOString(),
    status: row.status,
    summary: row.summary,
  };
}
