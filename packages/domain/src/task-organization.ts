import { z } from "zod";
import { idSchema, isoDateTimeSchema } from "./common.js";
import { materialSourceReferenceSchema } from "./feature-contracts.js";

export const taskLifecycleSchema = z.enum(["open", "completed", "cancelled"]);
export type TaskLifecycle = z.infer<typeof taskLifecycleSchema>;

export const taskContainerAvailabilitySchema = z.enum(["active", "archived"]);
export type TaskContainerAvailability = z.infer<typeof taskContainerAvailabilitySchema>;

export const taskListKindSchema = z.enum(["inbox", "standard"]);
export type TaskListKind = z.infer<typeof taskListKindSchema>;

export const taskSystemViewSchema = z.enum([
  "today",
  "upcoming",
  "scheduled",
  "completed",
  "cancelled",
  "trash",
]);
export type TaskSystemView = z.infer<typeof taskSystemViewSchema>;

export const reservedTaskListNames = new Set(taskSystemViewSchema.options);

/**
 * v1 task-container normalization. Any Unicode-data upgrade must be versioned
 * and collision-audited before it is applied to stored names.
 */
export function normalizeTaskContainerName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase();
}

const taskContainerNameSchema = z.string().trim().min(1).max(240);
const nullableTaskContainerTextSchema = z.string().trim().max(10_000).nullable();
const nullableTaskContainerColorSchema = z.string().trim().min(1).max(32).nullable();
const nullableSourceSchema = materialSourceReferenceSchema.nullable();
const revisionSchema = z.number().int().positive();
const optionalExpectedRevisionSchema = revisionSchema.optional();
const optionalIdempotencyKeySchema = z.uuid().optional();

const taskListFieldsSchema = z.object({
  description: nullableTaskContainerTextSchema,
  color: nullableTaskContainerColorSchema,
  name: taskContainerNameSchema,
});

export const taskListSchema = taskListFieldsSchema.extend({
  archivedAt: isoDateTimeSchema.nullable(),
  availability: taskContainerAvailabilitySchema,
  createdAt: isoDateTimeSchema,
  id: idSchema,
  kind: taskListKindSchema,
  revision: revisionSchema,
  source: nullableSourceSchema,
  updatedAt: isoDateTimeSchema,
});
export type TaskList = z.infer<typeof taskListSchema>;

export const createTaskListInputSchema = taskListFieldsSchema
  .extend({
    description: nullableTaskContainerTextSchema.default(null),
    color: nullableTaskContainerColorSchema.default(null),
    idempotencyKey: optionalIdempotencyKeySchema,
    source: nullableSourceSchema.default(null),
  })
  .strict();
export type CreateTaskListInput = z.infer<typeof createTaskListInputSchema>;

export const updateTaskListInputSchema = taskListFieldsSchema
  .partial()
  .extend({ expectedRevision: optionalExpectedRevisionSchema })
  .strict()
  .refine(
    (value) => Object.keys(value).some((key) => key !== "expectedRevision"),
    "At least one task List field is required",
  );
export type UpdateTaskListInput = z.infer<typeof updateTaskListInputSchema>;

export const taskListArchiveResolutionSchema = z.enum([
  "move_active_contents",
  "archive_contents_together",
  "cancel",
]);
export type TaskListArchiveResolution = z.infer<typeof taskListArchiveResolutionSchema>;

export const archiveTaskListInputSchema = z
  .object({
    destinationListId: idSchema.optional(),
    expectedRevision: optionalExpectedRevisionSchema,
    resolution: taskListArchiveResolutionSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.resolution === "move_active_contents" && !value.destinationListId) {
      context.addIssue({
        code: "custom",
        message: "Moving active contents requires a destination List.",
        path: ["destinationListId"],
      });
    }
  });
export type ArchiveTaskListInput = z.infer<typeof archiveTaskListInputSchema>;

const taskProjectFieldsSchema = z.object({
  name: taskContainerNameSchema,
  notes: nullableTaskContainerTextSchema,
  targetDate: z.iso.date().nullable(),
  why: nullableTaskContainerTextSchema,
});

export const taskProjectSchema = taskProjectFieldsSchema.extend({
  archivedAt: isoDateTimeSchema.nullable(),
  availability: taskContainerAvailabilitySchema,
  cancelledAt: isoDateTimeSchema.nullable(),
  completedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  id: idSchema,
  lifecycle: taskLifecycleSchema,
  listId: idSchema,
  revision: revisionSchema,
  source: nullableSourceSchema,
  updatedAt: isoDateTimeSchema,
});
export type TaskProject = z.infer<typeof taskProjectSchema>;

export const createTaskProjectInputSchema = taskProjectFieldsSchema
  .extend({
    idempotencyKey: optionalIdempotencyKeySchema,
    listId: idSchema,
    notes: nullableTaskContainerTextSchema.default(null),
    source: nullableSourceSchema.default(null),
    targetDate: z.iso.date().nullable().default(null),
    why: nullableTaskContainerTextSchema.default(null),
  })
  .strict();
export type CreateTaskProjectInput = z.infer<typeof createTaskProjectInputSchema>;

export const updateTaskProjectInputSchema = taskProjectFieldsSchema
  .partial()
  .extend({ expectedRevision: optionalExpectedRevisionSchema })
  .strict()
  .refine(
    (value) => Object.keys(value).some((key) => key !== "expectedRevision"),
    "At least one task Project field is required",
  );
export type UpdateTaskProjectInput = z.infer<typeof updateTaskProjectInputSchema>;

export const taskProjectCompletionResolutionSchema = z.enum([
  "complete_open_tasks",
  "cancel_open_tasks",
  "move_open_tasks",
  "keep_project_open",
]);
export type TaskProjectCompletionResolution = z.infer<typeof taskProjectCompletionResolutionSchema>;

export const completeTaskProjectInputSchema = z
  .object({
    destinationListId: idSchema.optional(),
    destinationProjectId: idSchema.optional(),
    expectedRevision: optionalExpectedRevisionSchema,
    resolution: taskProjectCompletionResolutionSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.resolution === "move_open_tasks" && !value.destinationListId) {
      context.addIssue({
        code: "custom",
        message: "Moving open Tasks requires a destination List.",
        path: ["destinationListId"],
      });
    }
  });
export type CompleteTaskProjectInput = z.infer<typeof completeTaskProjectInputSchema>;

export const cancelTaskProjectInputSchema = z
  .object({ expectedRevision: optionalExpectedRevisionSchema })
  .strict();
export type CancelTaskProjectInput = z.infer<typeof cancelTaskProjectInputSchema>;

export const archiveTaskProjectInputSchema = z
  .object({ expectedRevision: optionalExpectedRevisionSchema })
  .strict();
export type ArchiveTaskProjectInput = z.infer<typeof archiveTaskProjectInputSchema>;

export const taskProjectMovePreviewInputSchema = z
  .object({
    destinationListId: idSchema,
    expectedRevision: optionalExpectedRevisionSchema,
  })
  .strict();
export type TaskProjectMovePreviewInput = z.infer<typeof taskProjectMovePreviewInputSchema>;

export const moveTaskProjectInputSchema = taskProjectMovePreviewInputSchema.extend({
  previewToken: z.string().trim().min(1).max(512),
});
export type MoveTaskProjectInput = z.infer<typeof moveTaskProjectInputSchema>;

export const taskProjectMovePreviewSchema = z.object({
  affectedTaskCount: z.number().int().nonnegative(),
  destinationListId: idSchema,
  destinationListRevision: revisionSchema,
  previewToken: z.string().trim().min(1).max(512),
  sourceListId: idSchema,
  sourceListRevision: revisionSchema,
  taskProjectId: idSchema,
  taskProjectRevision: revisionSchema,
});
export type TaskProjectMovePreview = z.infer<typeof taskProjectMovePreviewSchema>;

export const taskOrganizationConflictSchema = z.object({
  code: z.string().trim().min(1).max(100),
  currentRevisions: z.object({
    destinationList: revisionSchema.nullable(),
    project: revisionSchema.nullable(),
    sourceList: revisionSchema.nullable(),
    task: revisionSchema.nullable(),
  }),
  openContentCounts: z.object({
    projects: z.number().int().nonnegative(),
    tasks: z.number().int().nonnegative(),
  }),
  resolutions: z.array(z.string().trim().min(1).max(100)).min(1),
});
export type TaskOrganizationConflict = z.infer<typeof taskOrganizationConflictSchema>;

export const taskProjectCompletionConflictSchema = taskOrganizationConflictSchema.extend({
  code: z.literal("task_project_has_open_tasks"),
  resolutions: z.array(taskProjectCompletionResolutionSchema).min(1),
});
export type TaskProjectCompletionConflict = z.infer<typeof taskProjectCompletionConflictSchema>;
