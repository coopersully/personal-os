import type { Reminder, Task } from "@personal-os/domain";

export type CommitmentPeriod = "today" | "week" | "month" | "custom";
export type Commitment =
  | { kind: "task"; overdue: boolean; task: Task }
  | { kind: "reminder"; overdue: boolean; reminder: Reminder };

export function commitmentDate(value: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  return ["year", "month", "day"]
    .map((key) => parts.find((part) => part.type === key)?.value)
    .join("-");
}

export function commitmentRange(
  period: CommitmentPeriod,
  today: string,
  weekStartsOn: "monday" | "sunday",
  custom: { from: string; through: string },
) {
  if (period === "custom") return custom;
  if (period === "today") return { from: today, through: today };
  const start = new Date(`${today}T12:00:00Z`);
  if (period === "week")
    start.setUTCDate(
      start.getUTCDate() - ((start.getUTCDay() - (weekStartsOn === "monday" ? 1 : 0) + 7) % 7),
    );
  else start.setUTCDate(1);
  const end = new Date(start);
  if (period === "week") end.setUTCDate(end.getUTCDate() + 6);
  else {
    end.setUTCMonth(end.getUTCMonth() + 1);
    end.setUTCDate(0);
  }
  return { from: start.toISOString().slice(0, 10), through: end.toISOString().slice(0, 10) };
}

/** Due and scheduled dates are alternatives, so a task appears once if either matches. */
export function scopedCommitments(
  tasks: Task[],
  reminders: Reminder[],
  range: { from: string; through: string },
  timeZone: string,
  now: string,
  includeOverdue: boolean,
): Commitment[] {
  const contains = (value: string | null) =>
    value !== null &&
    (() => {
      const day = commitmentDate(value, timeZone);
      return day >= range.from && day <= range.through;
    })();
  const overdue = (due: string | null) =>
    due !== null && new Date(due).getTime() < new Date(now).getTime();
  return [
    ...tasks
      .filter(
        (task) =>
          task.lifecycle === "open" &&
          task.deletedAt === null &&
          (contains(task.dueAt) ||
            contains(task.scheduledAt) ||
            (includeOverdue && overdue(task.dueAt))),
      )
      .map((task): Commitment => ({ kind: "task", task, overdue: overdue(task.dueAt) })),
    ...reminders
      .filter(
        (reminder) =>
          reminder.completedAt === null &&
          (contains(reminder.dueAt) || (includeOverdue && overdue(reminder.dueAt))),
      )
      .map(
        (reminder): Commitment => ({
          kind: "reminder",
          reminder,
          overdue: overdue(reminder.dueAt),
        }),
      ),
  ].sort((a, b) => Number(b.overdue) - Number(a.overdue));
}

export async function allCommitmentPages<T>(
  load: (cursor?: string) => Promise<{ items: T[]; nextCursor: string | null }>,
) {
  const items: T[] = [];
  let cursor: string | undefined;
  do {
    const page = await load(cursor);
    items.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return items;
}
