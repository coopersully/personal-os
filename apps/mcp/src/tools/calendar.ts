import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PersonalOsApiClient } from "@personal-os/api-client";
import {
  calendarCommitmentCandidateSchema,
  idSchema,
  isoDateTimeSchema,
} from "@personal-os/domain";
import { z } from "zod";
import { emptyResult, result } from "../tool-result.js";

const id = idSchema.describe("ilo object identifier");
const isoDateTime = isoDateTimeSchema.describe("ISO 8601 date-time with offset");
const timeZone = z.string().min(1).describe("IANA time zone, for example America/New_York");
const visibility = z.enum(["default", "private", "public"]);

/** Register the calendar discovery tool in the shell's established tool order. */
export function registerCalendarListTools(server: McpServer, api: PersonalOsApiClient) {
  server.registerTool(
    "list_calendars",
    {
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
        readOnlyHint: true,
      },
      description:
        "List Calendar destinations and source fidelity: provider/account identity, remote calendar identity, writable/selected state, time zone, sync status, freshness timestamp, and source error. Call this before choosing a destination.",
      inputSchema: {},
      title: "List calendars",
    },
    async () => result(await api.listCalendars()),
  );
}

/** Register Calendar event tools in the shell's established tool order. */
export function registerCalendarEventTools(server: McpServer, api: PersonalOsApiClient) {
  server.registerTool(
    "list_events",
    {
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
        readOnlyHint: true,
      },
      description:
        "List the unified Calendar projection for an explicit time window. Results retain calendar/source identity and provider revision; use list_calendars to interpret capability and freshness.",
      inputSchema: {
        calendarIds: z.array(id).optional(),
        from: isoDateTime,
        query: z.string().max(200).optional(),
        to: isoDateTime,
      },
      title: "List calendar events",
    },
    async (input) => result(await api.listEvents(input)),
  );
  server.registerTool(
    "create_event",
    {
      annotations: {
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
        readOnlyHint: false,
      },
      description:
        "Create one event only from the user's direct instruction on a writable destination. This can write to an external provider; it never authorizes inference from mail or other sourced material. For ticket, booking, registration, or accepted-commitment evidence, use preview_calendar_commitment and leave creation to an interactive user action.",
      inputSchema: {
        allDay: z.boolean().default(false),
        calendarId: id,
        endsAt: isoDateTime,
        location: z.string().max(1_000).nullable().default(null),
        notes: z.string().max(50_000).nullable().default(null),
        startsAt: isoDateTime,
        timezone: timeZone,
        title: z.string().min(1).max(500),
        visibility: visibility
          .default("default")
          .describe("Event visibility at the destination calendar."),
      },
      title: "Create calendar event",
    },
    async (input) => result(await api.createEvent(input)),
  );
  server.registerTool(
    "update_event",
    {
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
        readOnlyHint: false,
      },
      description:
        "Update an event after the user has specified the exact change. Connected writes can update an external provider and may notify existing attendees under provider semantics. Never silently move or resize a hard/non-flexible commitment.",
      inputSchema: {
        allDay: z.boolean().optional(),
        endsAt: isoDateTime.optional(),
        id,
        location: z.string().max(1_000).nullable().optional(),
        notes: z.string().max(50_000).nullable().optional(),
        startsAt: isoDateTime.optional(),
        timezone: timeZone.optional(),
        title: z.string().min(1).max(500).optional(),
        visibility: visibility
          .optional()
          .describe("Replacement visibility; this can change disclosure to calendar viewers."),
      },
      title: "Update calendar event",
    },
    async ({ id: eventId, ...input }) => result(await api.updateEvent(eventId, input)),
  );
  server.registerTool(
    "block_event",
    {
      annotations: {
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
        readOnlyHint: false,
      },
      description:
        "Link an event to an opaque Busy block or a detailed mirror on another writable calendar. This writes to the destination provider. Default to Busy unless the user explicitly permits details; the source event is never moved.",
      inputSchema: {
        calendarId: id.describe("Destination calendar identifier"),
        id: id.describe("Source event identifier"),
        mode: z.enum(["busy", "details"]).default("busy"),
      },
      title: "Block event on another calendar",
    },
    async ({ id: eventId, ...input }) => result(await api.createEventBlock(eventId, input)),
  );
  server.registerTool(
    "set_event_block_privacy",
    {
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
        readOnlyHint: false,
      },
      description:
        "Switch a linked provider block between private Busy and included details. Including details can disclose title, notes, and location to the destination account.",
      inputSchema: {
        blockId: id.describe("Linked block event identifier"),
        id: id.describe("Source event identifier"),
        mode: z.enum(["busy", "details"]),
      },
      title: "Change event block privacy",
    },
    async ({ blockId, id: eventId, mode }) =>
      result(await api.updateEventBlock(eventId, blockId, { mode })),
  );
  server.registerTool(
    "unblock_event",
    {
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
        readOnlyHint: false,
      },
      description: "Remove one linked destination block without deleting the source event.",
      inputSchema: {
        blockId: id.describe("Linked block event identifier"),
        id: id.describe("Source event identifier"),
      },
      title: "Unblock event calendar",
    },
    async ({ blockId, id: eventId }) => result(await api.deleteEventBlock(eventId, blockId)),
  );
  server.registerTool(
    "delete_event",
    {
      annotations: {
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
        readOnlyHint: false,
      },
      description:
        "Delete an event locally and, when connected, at its provider. Provider deletion can cancel an attendee-facing event; inspect the event and source before calling.",
      inputSchema: { id },
      title: "Delete calendar event",
    },
    async (input) => {
      await api.deleteEvent(input.id);
      return emptyResult("Event moved to trash.");
    },
  );

  server.registerTool(
    "preview_calendar_commitment",
    {
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
        readOnlyHint: true,
      },
      description:
        "Preview one exact Calendar candidate from caller-supplied commitment evidence. The API checks destination capability, projection freshness, exact duplicates, profile alignment, and requested policy without writing an event. Caller-supplied evidence remains unverified and can never authorize approved_rule. This is the Calendar-owned intake shape for a later durable integration; do not scan Mail here.",
      inputSchema: {
        candidate: calendarCommitmentCandidateSchema,
        expectedProfileVersion: z.number().int().positive().nullable().default(null),
        profileId: id.nullable().default(null),
        requestedPolicy: z
          .enum(["read_only", "preview", "approve_each", "approved_rule"])
          .default("preview"),
      },
      title: "Preview evidence-based Calendar commitment",
    },
    async (input) => result(await api.previewCalendarCommitment(input)),
  );
}
