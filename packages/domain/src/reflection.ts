import { z } from "zod";
import { idSchema, isoDateTimeSchema } from "./common.js";

const nullableDetail = z.string().trim().min(1).max(50_000).nullable();
const title = z.string().trim().min(1).max(240);

export const habitSchema = z.object({
  createdAt: isoDateTimeSchema,
  id: idSchema,
  isActive: z.boolean(),
  title,
  updatedAt: isoDateTimeSchema,
});
export type Habit = z.infer<typeof habitSchema>;

export const memorySchema = z.object({
  content: z.string().trim().min(1).max(10_000),
  createdAt: isoDateTimeSchema,
  id: idSchema,
  source: z.enum(["agent", "user"]),
  title,
  updatedAt: isoDateTimeSchema,
});
export type Memory = z.infer<typeof memorySchema>;

export const updateReflectionInputSchema = z
  .object({ content: nullableDetail.optional(), title: title.optional() })
  .refine((value) => Object.keys(value).length > 0, "Provide content or title.");
