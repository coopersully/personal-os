import { z } from "zod";
import { idSchema, isoDateTimeSchema, paginationSchema, timeZoneSchema } from "./common.js";

export const reminderPrioritySchema = z.enum(["low", "medium", "high"]);

const reminderFieldsSchema = z.object({
  title: z.string().trim().min(1).max(240),
  notes: z.string().trim().max(10_000).nullable().default(null),
  dueAt: isoDateTimeSchema.nullable().default(null),
  timezone: timeZoneSchema.nullable().default(null),
  priority: reminderPrioritySchema.default("medium"),
});

export const createReminderInputSchema = reminderFieldsSchema;
export type CreateReminderInput = z.infer<typeof createReminderInputSchema>;

export const updateReminderInputSchema = z
  .object({
    title: z.string().trim().min(1).max(240).optional(),
    notes: z.string().trim().max(10_000).nullable().optional(),
    dueAt: isoDateTimeSchema.nullable().optional(),
    timezone: timeZoneSchema.nullable().optional(),
    priority: reminderPrioritySchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "At least one reminder field is required");
export type UpdateReminderInput = z.infer<typeof updateReminderInputSchema>;

export const reminderSchema = reminderFieldsSchema.extend({
  id: idSchema,
  completedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Reminder = z.infer<typeof reminderSchema>;

export const reminderListQuerySchema = paginationSchema.extend({
  completed: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  dueBefore: isoDateTimeSchema.optional(),
  dueAfter: isoDateTimeSchema.optional(),
  query: z.string().trim().min(1).max(200).optional(),
});
export type ReminderListQuery = z.infer<typeof reminderListQuerySchema>;
