import type { McpServer } from "@modelcontextprotocol/server";
import type { PersonalOsApiClient } from "@personal-os/api-client";
import { z } from "zod";
import { emptyResult, result } from "../tool-result.js";

const id = z.string().uuid().describe("ilo object identifier");
const isoDateTime = z
  .string()
  .datetime({ offset: true })
  .describe("ISO 8601 date-time with offset");
const timeZone = z.string().min(1).describe("IANA time zone, for example America/New_York");

/** Planning-owned MCP adapters. Planning behavior and authorization remain in the API. */
export function registerPlanningTools(server: McpServer, api: PersonalOsApiClient): void {
  server.registerTool(
    "list_tasks",
    {
      annotations: { openWorldHint: false, readOnlyHint: true },
      description:
        "List and search the user's tasks, including their planning status and schedule.",
      inputSchema: z.object({
        completed: z.boolean().optional(),
        dueAfter: isoDateTime.optional(),
        dueBefore: isoDateTime.optional(),
        query: z.string().max(200).optional(),
        scheduledAfter: isoDateTime.optional(),
        scheduledBefore: isoDateTime.optional(),
        status: z.enum(["inbox", "next", "scheduled", "completed", "cancelled"]).optional(),
      }),
      title: "List tasks",
    },
    async (input) => result(await api.listTasks(input)),
  );

  server.registerTool(
    "create_task",
    {
      annotations: { openWorldHint: false },
      description: "Create a task in the user's ilo planning queue.",
      inputSchema: z.object({
        dueAt: isoDateTime.nullable().default(null),
        estimateMinutes: z
          .number()
          .int()
          .min(5)
          .max(24 * 60)
          .nullable()
          .default(null),
        notes: z.string().max(10_000).nullable().default(null),
        priority: z.enum(["low", "medium", "high"]).default("medium"),
        scheduledAt: isoDateTime.nullable().default(null),
        status: z.enum(["inbox", "next", "scheduled", "completed", "cancelled"]).default("inbox"),
        tags: z.array(z.string().min(1).max(60)).max(20).default([]),
        timezone: timeZone.nullable().default(null),
        title: z.string().min(1).max(240),
      }),
      title: "Create task",
    },
    async (input) => result(await api.createTask(input)),
  );

  server.registerTool(
    "update_task",
    {
      annotations: { idempotentHint: true, openWorldHint: false },
      description:
        "Change a task's workflow state, schedule, estimate, deadline, notes, or priority.",
      inputSchema: z.object({
        dueAt: isoDateTime.nullable().optional(),
        estimateMinutes: z
          .number()
          .int()
          .min(5)
          .max(24 * 60)
          .nullable()
          .optional(),
        id,
        notes: z.string().max(10_000).nullable().optional(),
        priority: z.enum(["low", "medium", "high"]).optional(),
        scheduledAt: isoDateTime.nullable().optional(),
        status: z.enum(["inbox", "next", "scheduled", "completed", "cancelled"]).optional(),
        tags: z.array(z.string().min(1).max(60)).max(20).optional(),
        timezone: timeZone.nullable().optional(),
        title: z.string().min(1).max(240).optional(),
      }),
      title: "Update task",
    },
    async ({ id: taskId, ...input }) => result(await api.updateTask(taskId, input)),
  );

  server.registerTool(
    "complete_task",
    {
      annotations: { idempotentHint: true, openWorldHint: false },
      description: "Mark a task complete or reopen it into the Next queue.",
      inputSchema: z.object({ completed: z.boolean().default(true), id }),
      title: "Complete or reopen task",
    },
    async (input) => result(await api.completeTask(input.id, input.completed)),
  );

  server.registerTool(
    "delete_task",
    {
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
      description: "Move a task to the recoverable trash.",
      inputSchema: z.object({ id }),
      title: "Delete task",
    },
    async (input) => {
      await api.deleteTask(input.id);
      return emptyResult("Task moved to trash.");
    },
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
