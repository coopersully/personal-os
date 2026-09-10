import { z } from "zod";
import { calendarEventSchema } from "./calendar.js";
import { isoDateTimeSchema, timeZoneSchema } from "./common.js";
import { reminderSchema } from "./reminder.js";
import { taskSchema } from "./task.js";

export const dailyBriefSchema = z.object({
  allDay: z.array(calendarEventSchema),
  anytime: z.array(reminderSchema),
  capacity: z.object({
    availableMinutes: z.int().nonnegative(),
    busyMinutes: z.int().nonnegative(),
    flexibleTaskMinutes: z.int().nonnegative(),
    overcommitted: z.boolean(),
    scheduledTaskMinutes: z.int().nonnegative(),
    workdayEndsAt: isoDateTimeSchema,
    workdayStartsAt: isoDateTimeSchema,
  }),
  generatedAt: isoDateTimeSchema,
  laterToday: z.array(calendarEventSchema),
  next: calendarEventSchema.nullable(),
  now: z.array(calendarEventSchema),
  overdue: z.array(reminderSchema),
  recommendedTasks: z
    .array(
      z.object({
        capacity: z.enum(["does_not_fit", "fits_remaining_time", "needs_estimate"]),
        task: taskSchema,
        urgency: z.enum(["due_today", "inbox", "next", "overdue"]),
      }),
    )
    .default([]),
  timeZone: timeZoneSchema,
  tasks: z.array(taskSchema),
  completedTasks: z.array(taskSchema),
  today: z.array(reminderSchema),
  tomorrow: z.array(calendarEventSchema),
});
export type DailyBrief = z.infer<typeof dailyBriefSchema>;
