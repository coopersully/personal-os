import type { DailyBrief } from "@personal-os/domain";
import { ritualCommitments, ritualEvents } from "./ritual-today.js";

const now = Date.parse("2026-11-20T15:00:00Z");
const task = (id: string, value: Record<string, unknown>) => ({
  id,
  title: id,
  lifecycle: "open",
  deletedAt: null,
  dueAt: null,
  scheduledAt: null,
  ...value,
});
const brief = (value: Record<string, unknown>) =>
  ({
    timeZone: "America/New_York",
    allDay: [],
    now: [],
    laterToday: [],
    tasks: [],
    today: [],
    overdue: [],
    ...value,
  }) as unknown as DailyBrief;

it("lists open commitments that are overdue, due today, or scheduled today, overdue first", () => {
  const result = ritualCommitments(
    brief({
      tasks: [
        task("due-today", { dueAt: "2026-11-20T22:00:00Z" }),
        task("overdue", { dueAt: "2026-11-19T12:00:00Z" }),
        task("scheduled-today", { scheduledAt: "2026-11-20T18:00:00Z" }),
        // 03:30 UTC on the 21st is still the 20th in New York; 05:30 UTC is not.
        task("late-tonight", { dueAt: "2026-11-21T03:30:00Z" }),
        task("tomorrow", { dueAt: "2026-11-21T05:30:00Z" }),
        task("someday", {}),
        task("done", { lifecycle: "completed", dueAt: "2026-11-20T22:00:00Z" }),
        task("trashed", { deletedAt: "2026-11-20T01:00:00Z", dueAt: "2026-11-20T22:00:00Z" }),
      ],
      overdue: [
        { id: "late-reminder", title: "late-reminder", completedAt: null, dueAt: null },
        { id: "finished", title: "finished", completedAt: "2026-11-20T01:00:00Z", dueAt: null },
      ],
      today: [{ id: "reminder", title: "reminder", completedAt: null, dueAt: null }],
    }),
    now,
  );
  expect(result.map((item) => `${item.kind}:${item.id}:${item.overdue}`)).toEqual([
    "task:overdue:true",
    "reminder:late-reminder:true",
    "reminder:reminder:false",
    "task:due-today:false",
    "task:scheduled-today:false",
    "task:late-tonight:false",
  ]);
});
it("orders the remaining schedule and never repeats an event listed twice", () => {
  const event = (id: string) => ({ id, title: id });
  expect(
    ritualEvents(
      brief({
        allDay: [event("trip")],
        now: [event("standup")],
        laterToday: [event("standup"), event("review")],
      }),
    ).map((item) => item.id),
  ).toEqual(["trip", "standup", "review"]);
});
