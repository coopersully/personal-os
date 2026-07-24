import { z } from "zod";
import { idSchema, isoDateTimeSchema } from "./common.js";

const title = z.string().trim().min(1).max(240);
const nullableDescription = z.string().trim().min(1).max(10_000).nullable();
const nullableTargetDate = z.iso.date().nullable();
const description = nullableDescription.default(null);
const targetDate = nullableTargetDate.default(null);

export const goalStatusSchema = z.enum(["active", "paused", "completed"]);
export type GoalStatus = z.infer<typeof goalStatusSchema>;

export const goalSchema = z.object({
  createdAt: isoDateTimeSchema,
  description,
  id: idSchema,
  progress: z.int().min(0).max(100),
  status: goalStatusSchema,
  targetDate,
  title,
  updatedAt: isoDateTimeSchema,
});
export type Goal = z.infer<typeof goalSchema>;

export const createGoalInputSchema = z.object({
  description,
  progress: z.int().min(0).max(100).default(0),
  targetDate,
  title,
});
export type CreateGoalInput = z.infer<typeof createGoalInputSchema>;

export const updateGoalInputSchema = z
  .object({
    description: nullableDescription.optional(),
    progress: z.int().min(0).max(100).optional(),
    status: goalStatusSchema.optional(),
    targetDate: nullableTargetDate.optional(),
    title: title.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Provide at least one goal change.");
export type UpdateGoalInput = z.infer<typeof updateGoalInputSchema>;

export const motiveSchema = z.object({
  createdAt: isoDateTimeSchema,
  detail: description,
  id: idSchema,
  isActive: z.boolean(),
  title,
  updatedAt: isoDateTimeSchema,
});
export type Motive = z.infer<typeof motiveSchema>;

export const createMotiveInputSchema = z.object({ detail: description, title });
export type CreateMotiveInput = z.infer<typeof createMotiveInputSchema>;

export const updateMotiveInputSchema = z
  .object({
    detail: nullableDescription.optional(),
    isActive: z.boolean().optional(),
    title: title.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Provide at least one motive change.");
export type UpdateMotiveInput = z.infer<typeof updateMotiveInputSchema>;
