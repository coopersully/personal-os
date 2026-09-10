import { z } from "zod";
import { idSchema, isoDateTimeSchema, paginationSchema } from "./common.js";
import { reminderPrioritySchema, reminderSchema } from "./reminder.js";
import { taskSchema } from "./task.js";

/** A read projection; Tasks and Reminders retain their own ownership and mutations. */
export const taskWorkspaceQuerySchema = paginationSchema
  .extend({
    cursor: z.string().min(1).max(4096).optional(),
    view: z.enum(["all", "today", "upcoming", "history", "trash"]).default("all"),
    kind: z.enum(["all", "task", "reminder"]).default("all"),
    // Omission means open in active views, all in History/Trash.
    status: z.enum(["all", "open", "completed", "cancelled", "archived"]).optional(),
    listId: idSchema.optional(),
    projectId: idSchema.optional(),
    query: z.string().trim().min(1).max(200).optional(),
    priority: reminderPrioritySchema.optional(),
    tag: z.string().trim().min(1).max(60).optional(),
    due: z.enum(["any", "overdue", "none", "dated"]).default("any"),
    reserved: z.enum(["any", "none", "scheduled"]).default("any"),
    dueAfter: isoDateTimeSchema.optional(),
    dueBefore: isoDateTimeSchema.optional(),
    scheduledAfter: isoDateTimeSchema.optional(),
    scheduledBefore: isoDateTimeSchema.optional(),
    sort: z
      .enum(["default", "date", "reserved", "priority", "newest", "oldest", "title", "estimate"])
      .default("default"),
    group: z.enum(["none", "date", "list", "project"]).default("none"),
  })
  .superRefine((query, context) => {
    for (const [after, before] of [
      ["dueAfter", "dueBefore"],
      ["scheduledAfter", "scheduledBefore"],
    ] as const) {
      if (query[after] && query[before] && Date.parse(query[after]) > Date.parse(query[before])) {
        context.addIssue({
          code: "custom",
          message: `${after} must not be later than ${before}.`,
          path: [after],
        });
      }
    }
  });
export type TaskWorkspaceQuery = z.infer<typeof taskWorkspaceQuerySchema>;

const projectionFields = {
  deletedAt: isoDateTimeSchema.nullable(),
  readOnly: z
    .boolean()
    .describe(
      "Unavailable task containers are read-only outside Trash. Trash permits guarded restore, including Inbox fallback.",
    ),
  relevantAt: isoDateTimeSchema.nullable(),
  // Date: YYYY-MM-DD in the planning timezone. List/project: ID. Missing/ungrouped: none.
  groupKey: z.string(),
};
export const taskWorkspaceItemSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("task"), record: taskSchema, ...projectionFields }),
  z.object({ kind: z.literal("reminder"), record: reminderSchema, ...projectionFields }),
]);
export type TaskWorkspaceItem = z.infer<typeof taskWorkspaceItemSchema>;
export const taskWorkspacePageSchema = z.object({
  items: z.array(taskWorkspaceItemSchema),
  nextCursor: z.string().nullable(),
  total: z.number().int().nonnegative(),
});
export type TaskWorkspacePage = z.infer<typeof taskWorkspacePageSchema>;
