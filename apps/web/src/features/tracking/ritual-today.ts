import {
  type CalendarEvent,
  type DailyBrief,
  localDateAt,
  localDateToIso,
} from "@personal-os/domain";

export type RitualCommitment = {
  id: string;
  kind: "task" | "reminder";
  title: string;
  overdue: boolean;
  dueAt: string | null;
};

/** Open tasks and reminders that are overdue, due today, or scheduled today — the Today page's rule. */
export function ritualCommitments(brief: DailyBrief, now: number): RitualCommitment[] {
  const today = localDateToIso(localDateAt(new Date(now), brief.timeZone));
  const onToday = (instant: string | null) =>
    instant !== null && localDateToIso(localDateAt(new Date(instant), brief.timeZone)) === today;
  const reminders = (list: DailyBrief["today"], overdue: boolean) =>
    list
      .filter((reminder) => reminder.completedAt === null)
      .map((reminder) => ({
        id: reminder.id,
        kind: "reminder" as const,
        title: reminder.title,
        overdue,
        dueAt: reminder.dueAt,
      }));
  const tasks: RitualCommitment[] = [];
  for (const task of brief.tasks) {
    if (task.lifecycle !== "open" || task.deletedAt !== null) continue;
    const overdue = task.dueAt !== null && Date.parse(task.dueAt) < now;
    if (!overdue && !onToday(task.dueAt) && !onToday(task.scheduledAt)) continue;
    tasks.push({ id: task.id, kind: "task", title: task.title, overdue, dueAt: task.dueAt });
  }
  return [
    ...tasks.filter((task) => task.overdue),
    ...reminders(brief.overdue, true),
    ...reminders(brief.today, false),
    ...tasks.filter((task) => !task.overdue),
  ];
}

/** Today's remaining schedule: all-day first, then what is happening now and later. */
export function ritualEvents(brief: DailyBrief): CalendarEvent[] {
  const seen = new Set<string>();
  return [...brief.allDay, ...brief.now, ...brief.laterToday].filter((event) => {
    if (seen.has(event.id)) return false;
    seen.add(event.id);
    return true;
  });
}
