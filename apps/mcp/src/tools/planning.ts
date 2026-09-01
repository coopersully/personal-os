import type { McpServer } from "@modelcontextprotocol/server";
import type { PersonalOsApiClient } from "@personal-os/api-client";
import {
  archiveTaskListInputSchema,
  completeTaskProjectInputSchema,
  createTaskInputSchema,
  createTaskListInputSchema,
  createTaskProjectInputSchema,
  idSchema,
  moveTaskInputSchema,
  moveTaskProjectInputSchema,
  paginationSchema,
  taskListQuerySchema,
  taskMovePreviewInputSchema,
  taskProjectMovePreviewInputSchema,
  updateTaskInputSchema,
  updateTaskListInputSchema,
  updateTaskProjectInputSchema,
} from "@personal-os/domain";
import { z } from "zod";
import { apiResult, result } from "../tool-result.js";

const id = idSchema.describe("ilo object identifier");
const expectedRevision = z
  .number()
  .int()
  .positive()
  .describe("Revision returned by the latest source-by-ID read or move preview");
const idempotencyKey = z
  .uuid()
  .describe("Stable UUID for safely replaying this exact create request");
const containerListInput = z.object(paginationSchema.shape).strict();
const createTaskListInput = createTaskListInputSchema.extend({ idempotencyKey });
const updateTaskListInput = z
  .object({ ...updateTaskListInputSchema.shape, expectedRevision, id })
  .strict()
  .refine(
    (value) => Object.keys(value).some((key) => key !== "expectedRevision" && key !== "id"),
    "At least one task List field is required",
  );
const archiveTaskListInput = z
  .object({ ...archiveTaskListInputSchema.shape, expectedRevision, id })
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
const createTaskProjectInput = createTaskProjectInputSchema.extend({ idempotencyKey });
const updateTaskProjectInput = z
  .object({ ...updateTaskProjectInputSchema.shape, expectedRevision, id })
  .strict()
  .refine(
    (value) => Object.keys(value).some((key) => key !== "expectedRevision" && key !== "id"),
    "At least one task Project field is required",
  );
const completeTaskProjectInput = z
  .object({ ...completeTaskProjectInputSchema.shape, expectedRevision, id })
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
const taskProjectTransitionInput = z.object({ expectedRevision, id }).strict();
const previewTaskProjectMoveInput = z
  .object({ ...taskProjectMovePreviewInputSchema.shape, expectedRevision, id })
  .strict();
const moveTaskProjectInput = z
  .object({ ...moveTaskProjectInputSchema.shape, expectedRevision, id })
  .strict();
const createTaskInput = createTaskInputSchema.extend({ idempotencyKey });
const updateTaskInput = z
  .object({ ...updateTaskInputSchema.shape, expectedRevision, id })
  .strict()
  .refine(
    (value) => Object.keys(value).some((key) => key !== "expectedRevision" && key !== "id"),
    "At least one task field is required",
  );
const taskTransitionInput = z.object({ expectedRevision, id }).strict();
const previewTaskMoveInput = z
  .object({ ...taskMovePreviewInputSchema.shape, expectedRevision, id })
  .strict();
const moveTaskInput = z.object({ ...moveTaskInputSchema.shape, expectedRevision, id }).strict();

/** Planning-owned MCP adapters. Planning behavior and authorization remain in the API. */
export function registerPlanningTools(server: McpServer, api: PersonalOsApiClient): void {
  server.registerTool(
    "list_task_lists",
    {
      description:
        "List a bounded page of organizational Lists. Lists group Projects and executable Tasks; system Views such as Today and Scheduled are not Lists.",
      inputSchema: containerListInput,
      title: "List task Lists",
    },
    async (input) => apiResult(() => api.listTaskLists(input)),
  );

  server.registerTool(
    "get_task_list",
    {
      description:
        "Read one List by ID, including availability and revision. Read the source List before a revision-safe update or archive.",
      inputSchema: z.object({ id }),
      title: "Get task List",
    },
    async (input) => apiResult(() => api.getTaskList(input.id)),
  );

  server.registerTool(
    "create_task_list",
    {
      description:
        "Create one organizational List. Reuse the same idempotencyKey only for an exact replay of this create payload; a mismatched replay remains an API conflict.",
      inputSchema: createTaskListInput,
      title: "Create task List",
    },
    async (input) => apiResult(() => api.createTaskList(input)),
  );

  server.registerTool(
    "update_task_list",
    {
      description:
        "Update one loaded List's organization fields. Pass its current expectedRevision so concurrent organization changes remain visible as API conflicts.",
      inputSchema: updateTaskListInput,
      title: "Update task List",
    },
    async ({ id: listId, ...input }) => apiResult(() => api.updateTaskList(listId, input)),
  );

  server.registerTool(
    "archive_task_list",
    {
      description:
        "Archive one loaded List. This is destructive organization lifecycle behavior; the API reports active-content conflicts and accepted resolutions without MCP performing a cascade.",
      inputSchema: archiveTaskListInput,
      title: "Archive task List",
    },
    async ({ id: listId, ...input }) => apiResult(() => api.archiveTaskList(listId, input)),
  );

  server.registerTool(
    "list_task_projects",
    {
      description:
        "List a bounded page of Projects. A Project is a finite outcome within a List, not an executable action or a system View.",
      inputSchema: containerListInput,
      title: "List task Projects",
    },
    async (input) => apiResult(() => api.listTaskProjects(input)),
  );

  server.registerTool(
    "get_task_project",
    {
      description:
        "Read one Project by ID, including its finite-outcome lifecycle, containing List, timing, and revision. Read it before a guarded mutation.",
      inputSchema: z.object({ id }),
      title: "Get task Project",
    },
    async (input) => apiResult(() => api.getTaskProject(input.id)),
  );

  server.registerTool(
    "create_task_project",
    {
      description:
        "Create one finite-outcome Project inside a List. Reuse its idempotencyKey only for an exact replay of the same create payload.",
      inputSchema: createTaskProjectInput,
      title: "Create task Project",
    },
    async (input) => apiResult(() => api.createTaskProject(input)),
  );

  server.registerTool(
    "update_task_project",
    {
      description:
        "Update one loaded Project's outcome, context, or target timing. Lifecycle transitions use complete_task_project or cancel_task_project.",
      inputSchema: updateTaskProjectInput,
      title: "Update task Project",
    },
    async ({ id: taskProjectId, ...input }) =>
      apiResult(() => api.updateTaskProject(taskProjectId, input)),
  );

  server.registerTool(
    "complete_task_project",
    {
      description:
        "Complete one loaded finite-outcome Project. The API reports open-Task conflicts and accepted resolutions; MCP does not complete, cancel, or move Tasks locally.",
      inputSchema: completeTaskProjectInput,
      title: "Complete task Project",
    },
    async ({ id: taskProjectId, ...input }) =>
      apiResult(() => api.completeTaskProject(taskProjectId, input)),
  );

  server.registerTool(
    "cancel_task_project",
    {
      description:
        "Cancel one loaded Project as an explicit finite-outcome lifecycle decision. Pass the current revision so concurrent changes fail safely.",
      inputSchema: taskProjectTransitionInput,
      title: "Cancel task Project",
    },
    async ({ id: taskProjectId, ...input }) =>
      apiResult(() => api.cancelTaskProject(taskProjectId, input)),
  );

  server.registerTool(
    "archive_task_project",
    {
      description:
        "Archive one loaded Project. Archive is destructive visibility and organization lifecycle behavior, distinct from completing or cancelling its outcome.",
      inputSchema: taskProjectTransitionInput,
      title: "Archive task Project",
    },
    async ({ id: taskProjectId, ...input }) =>
      apiResult(() => api.archiveTaskProject(taskProjectId, input)),
  );

  server.registerTool(
    "preview_task_project_move",
    {
      description:
        "Prepare a read-only preview of moving one loaded Project to another List. The preview returns the exact affected count, revisions, and token required by move_task_project.",
      inputSchema: previewTaskProjectMoveInput,
      title: "Preview task Project move",
    },
    async ({ id: taskProjectId, ...input }) =>
      apiResult(() => api.previewTaskProjectMove(taskProjectId, input)),
  );

  server.registerTool(
    "move_task_project",
    {
      description:
        "Commit a previously previewed Project move using its preview token and current expectedRevision. Re-preview after any structured revision conflict.",
      inputSchema: moveTaskProjectInput,
      title: "Move task Project",
    },
    async ({ id: taskProjectId, ...input }) =>
      apiResult(() => api.moveTaskProject(taskProjectId, input)),
  );

  server.registerTool(
    "list_tasks",
    {
      description:
        "List and search executable Tasks by List, Project, lifecycle, timing, or system View. Views such as Today, Upcoming, Scheduled, Completed, Cancelled, and Trash are derived filters, not stored Lists.",
      inputSchema: taskListQuerySchema,
      title: "List tasks",
    },
    async (input) => apiResult(() => api.listTasks(input)),
  );

  server.registerTool(
    "get_task",
    {
      description:
        "Read one executable Task by ID, including lifecycle, List and Project organization, timing, source, and revision. Read it before a guarded mutation.",
      inputSchema: z.object({ id }),
      title: "Get task",
    },
    async (input) => apiResult(() => api.getTask(input.id)),
  );

  server.registerTool(
    "create_task",
    {
      description:
        "Create one executable Task, optionally organized in a List and Project with due or scheduled timing. Reuse the idempotencyKey only for an exact replay of this create payload.",
      inputSchema: createTaskInput,
      title: "Create task",
    },
    async (input) => apiResult(() => api.createTask(input)),
  );

  server.registerTool(
    "update_task",
    {
      description:
        "Update one loaded Task's executable content or timing. Lifecycle changes use complete_task, reopen_task, or cancel_task; organization moves use preview_task_move then move_task.",
      inputSchema: updateTaskInput,
      title: "Update task",
    },
    async ({ id: taskId, ...input }) => apiResult(() => api.updateTask(taskId, input)),
  );

  server.registerTool(
    "complete_task",
    {
      description:
        "Complete one loaded Task as an explicit lifecycle transition. To undo completion, call reopen_task; reopening returns lifecycle to open and does not invent a queue state.",
      inputSchema: taskTransitionInput,
      title: "Complete task",
    },
    async ({ id: taskId, ...input }) => apiResult(() => api.completeTask(taskId, input)),
  );

  server.registerTool(
    "reopen_task",
    {
      description:
        "Reopen one loaded completed or cancelled Task. This canonical transition returns lifecycle to open; it does not assign a legacy queue status.",
      inputSchema: taskTransitionInput,
      title: "Reopen task",
    },
    async ({ id: taskId, ...input }) => apiResult(() => api.reopenTask(taskId, input)),
  );

  server.registerTool(
    "cancel_task",
    {
      description:
        "Cancel one loaded Task as an explicit lifecycle outcome. Use reopen_task if the executable action later becomes open again.",
      inputSchema: taskTransitionInput,
      title: "Cancel task",
    },
    async ({ id: taskId, ...input }) => apiResult(() => api.cancelTask(taskId, input)),
  );

  server.registerTool(
    "trash_task",
    {
      description:
        "Move one loaded Task to recoverable Trash. This is destructive host UX behavior, not permanent deletion; use the returned revision with restore_task.",
      inputSchema: taskTransitionInput,
      title: "Move task to Trash",
    },
    async ({ id: taskId, ...input }) => apiResult(() => api.trashTask(taskId, input)),
  );

  server.registerTool(
    "restore_task",
    {
      description:
        "Restore one Task from recoverable Trash using its current deleted revision. Concurrent changes remain structured API conflicts.",
      inputSchema: taskTransitionInput,
      title: "Restore task",
    },
    async ({ id: taskId, ...input }) => apiResult(() => api.restoreTask(taskId, input)),
  );

  server.registerTool(
    "preview_task_move",
    {
      description:
        "Prepare a read-only preview of moving one loaded executable Task to a List and optional Project. The API validates organization and returns exact revisions plus a preview token.",
      inputSchema: previewTaskMoveInput,
      title: "Preview task move",
    },
    async ({ id: taskId, ...input }) => apiResult(() => api.previewTaskMove(taskId, input)),
  );

  server.registerTool(
    "move_task",
    {
      description:
        "Commit a previously previewed Task move using the preview token and current expectedRevision. Re-preview after any structured organization conflict.",
      inputSchema: moveTaskInput,
      title: "Move task",
    },
    async ({ id: taskId, ...input }) => apiResult(() => api.moveTask(taskId, input)),
  );

  server.registerTool(
    "list_goals",
    {
      annotations: { openWorldHint: false, readOnlyHint: true },
      description: "List the user's outcome goals, progress, targets, and status.",
      inputSchema: z.object({}),
      title: "List goals",
    },
    async () => result(await api.listGoals()),
  );

  server.registerTool(
    "create_goal",
    {
      annotations: { openWorldHint: false },
      description:
        "Create an outcome goal. Use a concrete desired outcome rather than a task list.",
      inputSchema: z.object({
        description: z.string().max(10_000).nullable().default(null),
        progress: z.number().int().min(0).max(100).default(0),
        targetDate: z.iso.date().nullable().default(null),
        title: z.string().min(1).max(240),
      }),
      title: "Create goal",
    },
    async (input) => result(await api.createGoal(input)),
  );

  server.registerTool(
    "update_goal",
    {
      annotations: { openWorldHint: false },
      description: "Update a goal's title, context, progress, target date, or lifecycle status.",
      inputSchema: z.object({
        id,
        description: z.string().max(10_000).nullable().optional(),
        progress: z.number().int().min(0).max(100).optional(),
        status: z.enum(["active", "paused", "completed"]).optional(),
        targetDate: z.iso.date().nullable().optional(),
        title: z.string().min(1).max(240).optional(),
      }),
      title: "Update goal",
    },
    async ({ id: goalId, ...input }) => result(await api.updateGoal(goalId, input)),
  );

  server.registerTool(
    "list_motives",
    {
      annotations: { openWorldHint: false, readOnlyHint: true },
      description: "List active and paused motives that may guide planning recommendations.",
      inputSchema: z.object({}),
      title: "List motives",
    },
    async () => result(await api.listMotives()),
  );

  server.registerTool(
    "create_motive",
    {
      annotations: { openWorldHint: false },
      description: "Store a value, reason, or identity statement as durable decision context.",
      inputSchema: z.object({
        detail: z.string().max(10_000).nullable().default(null),
        title: z.string().min(1).max(240),
      }),
      title: "Create motive",
    },
    async (input) => result(await api.createMotive(input)),
  );
}
