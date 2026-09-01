import { z } from "zod";
import { idSchema, isoDateTimeSchema, paginationSchema, timeZoneSchema } from "./common.js";
import { reminderPrioritySchema } from "./reminder.js";
import {
  localTaskMaterialSourceSchema,
  taskLifecycleSchema,
  taskSystemViewSchema,
} from "./task-organization.js";

/** Compatibility-only metadata retained while legacy Task rows are reviewed. */
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
const nullableTaskTextSchema = z.string().trim().max(10_000).nullable();
const revisionSchema = z.number().int().positive();
const taskSourceSchema = localTaskMaterialSourceSchema("task");

const taskContentFieldsSchema = z.object({
  dueAt: isoDateTimeSchema.nullable(),
  estimateMinutes: nullableEstimateMinutesSchema,
  notes: nullableTaskTextSchema,
  priority: reminderPrioritySchema,
  scheduledAt: isoDateTimeSchema.nullable(),
  tags: tagsSchema,
  timezone: timeZoneSchema.nullable(),
  title: z.string().trim().min(1).max(240),
  why: nullableTaskTextSchema,
});

export const createTaskInputSchema = taskContentFieldsSchema
  .extend({
    dueAt: isoDateTimeSchema.nullable().default(null),
    estimateMinutes: estimateMinutesSchema,
    idempotencyKey: z.uuid().optional(),
    lifecycle: taskLifecycleSchema.default("open"),
    listId: idSchema.optional(),
    notes: nullableTaskTextSchema.default(null),
    priority: reminderPrioritySchema.default("medium"),
    projectId: idSchema.optional(),
    scheduledAt: isoDateTimeSchema.nullable().default(null),
    tags: tagsSchema.default([]),
    timezone: timeZoneSchema.nullable().default(null),
    why: nullableTaskTextSchema.default(null),
  })
  .strict();
export type CreateTaskInput = z.infer<typeof createTaskInputSchema>;

export const updateTaskInputSchema = taskContentFieldsSchema
  .partial()
  .extend({ expectedRevision: revisionSchema.optional() })
  .strict()
  .refine(
    (value) =>
      Object.entries(value).some(
        ([key, fieldValue]) => key !== "expectedRevision" && fieldValue !== undefined,
      ),
    "At least one task field is required",
  );
export type UpdateTaskInput = z.infer<typeof updateTaskInputSchema>;

export const taskSchema = taskContentFieldsSchema.extend({
  cancelledAt: isoDateTimeSchema.nullable(),
  completedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  deletedAt: isoDateTimeSchema.nullable(),
  id: idSchema,
  legacyStatus: taskStatusSchema.nullable(),
  lifecycle: taskLifecycleSchema,
  listId: idSchema,
  projectId: idSchema.nullable(),
  revision: revisionSchema,
  source: taskSourceSchema,
  updatedAt: isoDateTimeSchema,
});
export type Task = z.infer<typeof taskSchema>;

const taskTransitionInputSchema = z
  .object({ expectedRevision: revisionSchema.optional() })
  .strict();

export const completeTaskInputSchema = taskTransitionInputSchema;
export type CompleteTaskInput = z.infer<typeof completeTaskInputSchema>;

export const cancelTaskInputSchema = taskTransitionInputSchema;
export type CancelTaskInput = z.infer<typeof cancelTaskInputSchema>;

export const reopenTaskInputSchema = taskTransitionInputSchema;
export type ReopenTaskInput = z.infer<typeof reopenTaskInputSchema>;

export const trashTaskInputSchema = taskTransitionInputSchema;
export type TrashTaskInput = z.infer<typeof trashTaskInputSchema>;

export const restoreTaskInputSchema = taskTransitionInputSchema;
export type RestoreTaskInput = z.infer<typeof restoreTaskInputSchema>;

export const taskMovePreviewInputSchema = z
  .object({
    destinationListId: idSchema,
    destinationProjectId: idSchema.nullable().optional(),
    expectedRevision: revisionSchema.optional(),
  })
  .strict();
export type TaskMovePreviewInput = z.infer<typeof taskMovePreviewInputSchema>;

export const moveTaskInputSchema = taskMovePreviewInputSchema.extend({
  previewToken: z.string().trim().min(1).max(512),
});
export type MoveTaskInput = z.infer<typeof moveTaskInputSchema>;

const taskMovePreviewFieldsSchema = z.object({
  destinationListId: idSchema,
  destinationListRevision: revisionSchema,
  detachedProjectId: idSchema.nullable(),
  previewToken: z.string().trim().min(1).max(512),
  sourceListId: idSchema,
  sourceListRevision: revisionSchema,
  sourceProjectId: idSchema.nullable(),
  taskId: idSchema,
  taskRevision: revisionSchema,
});
export const taskMovePreviewSchema = z.union([
  taskMovePreviewFieldsSchema.extend({
    destinationProjectId: z.null(),
    destinationProjectRevision: z.null(),
  }),
  taskMovePreviewFieldsSchema.extend({
    destinationProjectId: idSchema,
    destinationProjectRevision: revisionSchema,
  }),
]);
export type TaskMovePreview = z.infer<typeof taskMovePreviewSchema>;

export const taskListQuerySchema = paginationSchema.extend({
  dueAfter: isoDateTimeSchema.optional(),
  dueBefore: isoDateTimeSchema.optional(),
  includeUnavailableProject: z
    .union([z.boolean(), z.enum(["true", "false"]).transform((value) => value === "true")])
    .optional(),
  lifecycle: taskLifecycleSchema.optional(),
  listId: idSchema.optional(),
  projectId: idSchema.optional(),
  query: z.string().trim().min(1).max(200).optional(),
  scheduledAfter: isoDateTimeSchema.optional(),
  scheduledBefore: isoDateTimeSchema.optional(),
  view: taskSystemViewSchema.optional(),
});
export type TaskListQuery = z.infer<typeof taskListQuerySchema>;
