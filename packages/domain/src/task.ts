import { z } from "zod";
import { idSchema, isoDateTimeSchema, paginationSchema, timeZoneSchema } from "./common.js";
import { reminderPrioritySchema } from "./reminder.js";

export const taskStatusSchema = z.enum(["inbox", "next", "scheduled", "completed", "cancelled"]);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

const nullableEstimateMinutesSchema = z
  .number()
  .int()
  .min(5)
  .max(24 * 60)
  .nullable();
const estimateMinutesSchema = nullableEstimateMinutesSchema.default(null);
const tagsSchema = z
  .array(z.string().trim().min(1).max(60))
  .max(20)
  .transform((tags) => [...new Set(tags)]);

const taskFieldsSchema = z.object({
  title: z.string().trim().min(1).max(240),
  notes: z.string().trim().max(10_000).nullable().default(null),
  dueAt: isoDateTimeSchema.nullable().default(null),
  scheduledAt: isoDateTimeSchema.nullable().default(null),
  timezone: timeZoneSchema.nullable().default(null),
  priority: reminderPrioritySchema.default("medium"),
  estimateMinutes: estimateMinutesSchema,
  tags: tagsSchema.default([]),
  status: taskStatusSchema.default("inbox"),
});

function validateTaskScheduling<
  T extends { scheduledAt?: string | null | undefined; status?: TaskStatus | undefined },
>(input: T, context: z.RefinementCtx) {
  if (input.status === "scheduled" && !input.scheduledAt) {
    context.addIssue({
      code: "custom",
      message: "A scheduled task requires a scheduled time.",
      path: ["scheduledAt"],
    });
  }
}

export const createTaskInputSchema = taskFieldsSchema.superRefine(validateTaskScheduling);
export type CreateTaskInput = z.infer<typeof createTaskInputSchema>;

export const updateTaskInputSchema = z
  .object({
    title: z.string().trim().min(1).max(240).optional(),
    notes: z.string().trim().max(10_000).nullable().optional(),
    dueAt: isoDateTimeSchema.nullable().optional(),
    scheduledAt: isoDateTimeSchema.nullable().optional(),
    timezone: timeZoneSchema.nullable().optional(),
    priority: reminderPrioritySchema.optional(),
    estimateMinutes: nullableEstimateMinutesSchema.optional(),
    tags: tagsSchema.optional(),
    status: taskStatusSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "At least one task field is required")
  .superRefine(validateTaskScheduling);
export type UpdateTaskInput = z.infer<typeof updateTaskInputSchema>;

export const taskSchema = taskFieldsSchema.extend({
  id: idSchema,
  completedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Task = z.infer<typeof taskSchema>;

export const taskListQuerySchema = paginationSchema.extend({
  completed: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  dueBefore: isoDateTimeSchema.optional(),
  dueAfter: isoDateTimeSchema.optional(),
  status: taskStatusSchema.optional(),
  scheduledBefore: isoDateTimeSchema.optional(),
  scheduledAfter: isoDateTimeSchema.optional(),
  query: z.string().trim().min(1).max(200).optional(),
});
export type TaskListQuery = z.infer<typeof taskListQuerySchema>;
