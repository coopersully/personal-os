import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PersonalOsApiClient } from "@personal-os/api-client";
import {
  idSchema,
  isoDateTimeSchema,
  reminderPrioritySchema,
  timeZoneSchema,
} from "@personal-os/domain";
import { z } from "zod";
import { apiResult } from "../tool-result.js";

const id = idSchema.describe("ilo reminder identifier");
const isoDateTime = isoDateTimeSchema.describe("ISO 8601 date-time with offset");
const timeZone = timeZoneSchema.describe("IANA time zone, for example America/New_York");
const directMutation =
  "This is a direct, audited mutation. Ilo's API scopes and scoped-agent policy decision are authoritative; profile preferences and MCP annotations do not grant access.";

const annotations = {
  create: {
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
    readOnlyHint: false,
  },
  delete: {
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
    readOnlyHint: false,
  },
  read: {
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
    readOnlyHint: true,
  },
  update: {
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
    readOnlyHint: false,
  },
} as const;

/** Reminder-only MCP adapters. Business rules and authorization stay in the API. */
export function registerReminderTools(server: McpServer, api: PersonalOsApiClient) {
  server.registerTool(
    "list_reminders",
    {
      annotations: annotations.read,
      description:
        "List a bounded page of the user's reminders. Pass a returned nextCursor as cursor to continue. Use dueAfter/dueBefore as exact instant bounds; dueAt is the reminder's due or attention time, not proof that a notification will be delivered.",
      inputSchema: {
        completed: z.boolean().optional(),
        cursor: z.string().min(1).optional(),
        dueAfter: isoDateTime.optional(),
        dueBefore: isoDateTime.optional(),
        limit: z.number().int().min(1).max(100).default(50),
        query: z.string().max(200).optional(),
      },
      title: "List reminders",
    },
    async (input) => apiResult(() => api.listReminders(input)),
  );

  server.registerTool(
    "get_reminder",
    {
      annotations: annotations.read,
      description:
        "Read one current reminder, including its local source reference and updatedAt revision. Read it before a guarded update.",
      inputSchema: { id },
      title: "Get reminder",
    },
    async (input) => apiResult(() => api.getReminder(input.id)),
  );

  server.registerTool(
    "preview_overdue_reminder_deferral",
    {
      annotations: annotations.read,
      description:
        "Preview, without mutation, the exact open Reminder set due before a cutoff and the proposed replacement due time. The API returns preview policy and source references. If the set exceeds limit, narrow the cutoff or priority; never infer omitted candidates.",
      inputSchema: {
        limit: z.number().int().min(1).max(100).default(100),
        overdueBefore: isoDateTime,
        priority: reminderPrioritySchema.optional(),
        proposedDueAt: isoDateTime,
        timezone: timeZone.nullable().default(null),
      },
      title: "Preview overdue reminder deferral",
    },
    async (input) => apiResult(() => api.previewOverdueReminderDeferral(input)),
  );

  server.registerTool(
    "create_reminder",
    {
      annotations: annotations.create,
      description: `Create one reminder immediately. dueAt is a due or attention time; it does not schedule a separate notification. Include an IANA timezone when local-time meaning matters. ${directMutation}`,
      inputSchema: {
        dueAt: isoDateTime.nullable().default(null),
        notes: z.string().max(10_000).nullable().default(null),
        priority: reminderPrioritySchema.default("medium"),
        timezone: timeZone.nullable().default(null),
        title: z.string().min(1).max(240),
      },
      title: "Create reminder",
    },
    async (input) => apiResult(() => api.createReminder(input)),
  );

  server.registerTool(
    "update_reminder",
    {
      annotations: annotations.update,
      description: `Change one reminder after reading it. Pass expectedUpdatedAt from get_reminder so a concurrent change returns a structured conflict instead of being overwritten. ${directMutation}`,
      inputSchema: {
        dueAt: isoDateTime.nullable().optional(),
        expectedUpdatedAt: isoDateTime,
        id,
        notes: z.string().max(10_000).nullable().optional(),
        priority: reminderPrioritySchema.optional(),
        timezone: timeZone.nullable().optional(),
        title: z.string().min(1).max(240).optional(),
      },
      title: "Update reminder",
    },
    async ({ id: reminderId, ...input }) => apiResult(() => api.updateReminder(reminderId, input)),
  );

  server.registerTool(
    "complete_reminder",
    {
      annotations: annotations.update,
      description: `Mark one loaded reminder complete or reopen it. Pass expectedUpdatedAt from get_reminder so a concurrent change fails safely. This records an audit event even when the requested state matches the current state, so it is not idempotent. ${directMutation}`,
      inputSchema: { completed: z.boolean().default(true), expectedUpdatedAt: isoDateTime, id },
      title: "Complete or reopen reminder",
    },
    async (input) =>
      apiResult(() => api.completeReminder(input.id, input.completed, input.expectedUpdatedAt)),
  );

  server.registerTool(
    "delete_reminder",
    {
      annotations: annotations.delete,
      description: `Move one loaded reminder to recoverable trash; this is not permanent deletion. Pass expectedUpdatedAt so a concurrent change fails safely. The result contains the deleted revision needed for guarded restore; audit history retains source, before/after state, actor, and policy. ${directMutation}`,
      inputSchema: { expectedUpdatedAt: isoDateTime, id },
      title: "Move reminder to trash",
    },
    async (input) => apiResult(() => api.trashReminder(input.id, input.expectedUpdatedAt)),
  );

  server.registerTool(
    "restore_reminder",
    {
      annotations: annotations.update,
      description: `Restore one reminder from recoverable trash using the updatedAt revision returned by delete_reminder. A concurrent change fails safely, and restoration is recorded in audit history. ${directMutation}`,
      inputSchema: { expectedUpdatedAt: isoDateTime, id },
      title: "Restore reminder",
    },
    async (input) => apiResult(() => api.restoreReminder(input.id, input.expectedUpdatedAt)),
  );
}
