import { z } from "zod";
import { calendarEventSchema } from "./calendar.js";
import { idSchema, isoDateTimeSchema, timeZoneSchema } from "./common.js";
import { reminderSchema } from "./reminder.js";
import { taskSchema } from "./task.js";

export const automationTemplateSchema = z.enum(["morning_brief", "nightly_review"]);
export type AutomationTemplate = z.infer<typeof automationTemplateSchema>;

export const automationRunStatusSchema = z.enum(["completed", "dry_run", "failed"]);
export type AutomationRunStatus = z.infer<typeof automationRunStatusSchema>;

export const automationRoutineSchema = z.object({
  createdAt: isoDateTimeSchema,
  enabled: z.boolean(),
  id: idSchema,
  lastRunAt: isoDateTimeSchema.nullable(),
  schedule: z.string(),
  template: automationTemplateSchema,
  timezone: timeZoneSchema,
  title: z.string(),
  updatedAt: isoDateTimeSchema,
});
export type AutomationRoutine = z.infer<typeof automationRoutineSchema>;

export const createAutomationRoutineInputSchema = z.object({
  schedule: z.string().trim().min(1).max(120).default("Weekdays at 8:00 AM"),
  template: automationTemplateSchema,
  timezone: timeZoneSchema,
});
export type CreateAutomationRoutineInput = z.infer<typeof createAutomationRoutineInputSchema>;

export const updateAutomationRoutineInputSchema = z
  .object({
    enabled: z.boolean().optional(),
    schedule: z.string().trim().min(1).max(120).optional(),
    timezone: timeZoneSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Provide at least one automation setting.");
export type UpdateAutomationRoutineInput = z.infer<typeof updateAutomationRoutineInputSchema>;

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

export const automationRunSchema = z.object({
  brief: dailyBriefSchema.nullable(),
  completedAt: isoDateTimeSchema.nullable(),
  id: idSchema,
  routineId: idSchema,
  startedAt: isoDateTimeSchema,
  status: automationRunStatusSchema,
  summary: z.string(),
});
export type AutomationRun = z.infer<typeof automationRunSchema>;
