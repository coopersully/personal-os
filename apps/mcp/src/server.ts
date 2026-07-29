import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PersonalOsApiClient } from "@personal-os/api-client";
import { localDayRange } from "@personal-os/domain";
import { z } from "zod";
import { emptyResult, result } from "./tool-result.js";
import { registerAssistantTools } from "./tools/assistant.js";
import { registerCalendarEventTools, registerCalendarListTools } from "./tools/calendar.js";
import { registerFinanceTools } from "./tools/finances.js";
import { registerMailTools } from "./tools/mail.js";
import { registerReminderTools } from "./tools/reminders.js";
import { registerXBookmarkTools } from "./tools/x-bookmarks.js";

type ServerOptions = {
  api: PersonalOsApiClient;
  now?: () => Date;
  timeZone: string;
};

const id = z.string().uuid().describe("ilo object identifier");
const isoDateTime = z
  .string()
  .datetime({ offset: true })
  .describe("ISO 8601 date-time with offset");
const timeZone = z.string().min(1).describe("IANA time zone, for example America/New_York");

export function createPersonalOsMcpServer(options: ServerOptions): McpServer {
  const server = new McpServer({ name: "personal-os", version: "0.1.0" });

  registerAssistantTools(server, options.api);
  registerFinanceTools(server, options.api);
  registerReminderTools(server, options.api);
  registerXBookmarkTools(server, options.api);

  server.registerTool(
    "list_tasks",
    {
      annotations: { openWorldHint: false, readOnlyHint: true },
      description:
        "List and search the user's tasks, including their planning status and schedule.",
      inputSchema: {
        completed: z.boolean().optional(),
        dueAfter: isoDateTime.optional(),
        dueBefore: isoDateTime.optional(),
        query: z.string().max(200).optional(),
        scheduledAfter: isoDateTime.optional(),
        scheduledBefore: isoDateTime.optional(),
        status: z.enum(["inbox", "next", "scheduled", "completed", "cancelled"]).optional(),
      },
      title: "List tasks",
    },
    async (input) => result(await options.api.listTasks(input)),
  );

  server.registerTool(
    "create_task",
    {
      annotations: { openWorldHint: false },
      description: "Create a task in the user's ilo planning queue.",
      inputSchema: {
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
      },
      title: "Create task",
    },
    async (input) => result(await options.api.createTask(input)),
  );

  server.registerTool(
    "update_task",
    {
      annotations: { idempotentHint: true, openWorldHint: false },
      description:
        "Change a task's workflow state, schedule, estimate, deadline, notes, or priority.",
      inputSchema: {
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
      },
      title: "Update task",
    },
    async ({ id: taskId, ...input }) => result(await options.api.updateTask(taskId, input)),
  );

  server.registerTool(
    "complete_task",
    {
      annotations: { idempotentHint: true, openWorldHint: false },
      description: "Mark a task complete or reopen it into the Next queue.",
      inputSchema: { completed: z.boolean().default(true), id },
      title: "Complete or reopen task",
    },
    async (input) => result(await options.api.completeTask(input.id, input.completed)),
  );

  server.registerTool(
    "delete_task",
    {
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
      description: "Move a task to the recoverable trash.",
      inputSchema: { id },
      title: "Delete task",
    },
    async (input) => {
      await options.api.deleteTask(input.id);
      return emptyResult("Task moved to trash.");
    },
  );

  registerCalendarListTools(server, options.api);

  registerMailTools(server, options.api);

  registerCalendarEventTools(server, options.api);

  server.registerTool(
    "list_goals",
    {
      annotations: { openWorldHint: false, readOnlyHint: true },
      description: "List the user's outcome goals, progress, targets, and status.",
      inputSchema: {},
      title: "List goals",
    },
    async () => result(await options.api.listGoals()),
  );

  server.registerTool(
    "create_goal",
    {
      annotations: { openWorldHint: false },
      description:
        "Create an outcome goal. Use a concrete desired outcome rather than a task list.",
      inputSchema: {
        description: z.string().max(10_000).nullable().default(null),
        progress: z.number().int().min(0).max(100).default(0),
        targetDate: z.iso.date().nullable().default(null),
        title: z.string().min(1).max(240),
      },
      title: "Create goal",
    },
    async (input) => result(await options.api.createGoal(input)),
  );

  server.registerTool(
    "update_goal",
    {
      annotations: { openWorldHint: false },
      description: "Update a goal's title, context, progress, target date, or lifecycle status.",
      inputSchema: {
        id,
        description: z.string().max(10_000).nullable().optional(),
        progress: z.number().int().min(0).max(100).optional(),
        status: z.enum(["active", "paused", "completed"]).optional(),
        targetDate: z.iso.date().nullable().optional(),
        title: z.string().min(1).max(240).optional(),
      },
      title: "Update goal",
    },
    async ({ id: goalId, ...input }) => result(await options.api.updateGoal(goalId, input)),
  );

  server.registerTool(
    "list_motives",
    {
      annotations: { openWorldHint: false, readOnlyHint: true },
      description: "List active and paused motives that may guide planning recommendations.",
      inputSchema: {},
      title: "List motives",
    },
    async () => result(await options.api.listMotives()),
  );

  server.registerTool(
    "create_motive",
    {
      annotations: { openWorldHint: false },
      description: "Store a value, reason, or identity statement as durable decision context.",
      inputSchema: {
        detail: z.string().max(10_000).nullable().default(null),
        title: z.string().min(1).max(240),
      },
      title: "Create motive",
    },
    async (input) => result(await options.api.createMotive(input)),
  );

  server.registerTool(
    "list_activity",
    {
      annotations: { openWorldHint: false, readOnlyHint: true },
      description: "List recent audited actions by people, agents, and connectors.",
      inputSchema: { limit: z.number().int().min(1).max(100).default(50) },
      title: "List recent activity",
    },
    async (input) => result(await options.api.listActivity(input.limit)),
  );

  server.registerTool(
    "get_daily_brief",
    {
      annotations: { openWorldHint: false, readOnlyHint: true },
      description:
        "Get a time-aware daily brief: events happening now, the next event, later-today commitments, overdue reminders, and tomorrow's outlook.",
      inputSchema: {},
      title: "Get daily brief",
    },
    async () => result(await options.api.getDailyBrief()),
  );

  server.registerTool(
    "list_automations",
    {
      annotations: { openWorldHint: false, readOnlyHint: true },
      description: "List enabled ilo routines that an authorized agent can run.",
      inputSchema: {},
      title: "List automations",
    },
    async () => result(await options.api.listAutomations()),
  );

  server.registerTool(
    "run_automation",
    {
      annotations: { idempotentHint: true, openWorldHint: false },
      description:
        "Run an installed routine. Use dryRun first to inspect the brief without updating the routine's last-run time.",
      inputSchema: { dryRun: z.boolean().default(false), id },
      title: "Run automation",
    },
    async (input) => result(await options.api.runAutomation(input.id, input.dryRun)),
  );

  server.registerResource(
    "today-agenda",
    "personal-os://agenda/today",
    {
      description: "Today's reminders and unified calendar events in the configured time zone.",
      mimeType: "application/json",
      title: "Today's agenda",
    },
    async (uri) => {
      const range = localDayRange(options.now?.() ?? new Date(), options.timeZone);
      const [events, reminders] = await Promise.all([
        options.api.listEvents(range),
        options.api.listReminders({ completed: false, dueBefore: range.to }),
      ]);
      return {
        contents: [
          {
            mimeType: "application/json",
            text: JSON.stringify({ ...range, events, reminders: reminders.items }, null, 2),
            uri: uri.href,
          },
        ],
      };
    },
  );

  server.registerResource(
    "daily-brief",
    "personal-os://brief/daily",
    {
      description:
        "A time-aware daily brief generated from the user's unified calendar and reminders.",
      mimeType: "application/json",
      title: "Daily brief",
    },
    async (uri) => ({
      contents: [
        {
          mimeType: "application/json",
          text: JSON.stringify(await options.api.getDailyBrief(), null, 2),
          uri: uri.href,
        },
      ],
    }),
  );

  return server;
}
