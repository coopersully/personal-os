import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PersonalOsApiClient } from "@personal-os/api-client";
import { z } from "zod";
import { emptyResult, result } from "../tool-result.js";

const id = z.string().uuid().describe("Personal OS object identifier");
const isoDateTime = z
  .string()
  .datetime({ offset: true })
  .describe("ISO 8601 date-time with offset");
const timeZone = z.string().min(1).describe("IANA time zone, for example America/New_York");

/** Register the calendar discovery tool in the shell's established tool order. */
export function registerCalendarListTools(server: McpServer, api: PersonalOsApiClient) {
  server.registerTool(
    "list_calendars",
    {
      annotations: { openWorldHint: false, readOnlyHint: true },
      description:
        "List local and connected calendars, including their writable and selected state.",
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
      annotations: { openWorldHint: false, readOnlyHint: true },
      description: "List unified events across selected local and connected calendars.",
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
      annotations: { openWorldHint: true },
      description:
        "Create an event on a writable local or connected calendar. Connected calendars write through to their provider.",
      inputSchema: {
        allDay: z.boolean().default(false),
        calendarId: id,
        endsAt: isoDateTime,
        location: z.string().max(1_000).nullable().default(null),
        notes: z.string().max(50_000).nullable().default(null),
        startsAt: isoDateTime,
        timezone: timeZone,
        title: z.string().min(1).max(500),
      },
      title: "Create calendar event",
    },
    async (input) => result(await api.createEvent(input)),
  );
  server.registerTool(
    "update_event",
    {
      annotations: { idempotentHint: true, openWorldHint: true },
      description: "Update an event locally and, when connected, at its calendar provider.",
      inputSchema: {
        allDay: z.boolean().optional(),
        endsAt: isoDateTime.optional(),
        id,
        location: z.string().max(1_000).nullable().optional(),
        notes: z.string().max(50_000).nullable().optional(),
        startsAt: isoDateTime.optional(),
        timezone: timeZone.optional(),
        title: z.string().min(1).max(500).optional(),
      },
      title: "Update calendar event",
    },
    async ({ id: eventId, ...input }) => result(await api.updateEvent(eventId, input)),
  );
  server.registerTool(
    "block_event",
    {
      annotations: { idempotentHint: true, openWorldHint: true },
      description:
        "Link an event to an opaque Busy block or a detailed mirror on another writable calendar. The unified calendar shows the source once while the destination provider remains blocked.",
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
      annotations: { idempotentHint: true, openWorldHint: true },
      description: "Switch a linked calendar block between private Busy and included details.",
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
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
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
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
      description: "Delete an event locally and, when connected, at its calendar provider.",
      inputSchema: { id },
      title: "Delete calendar event",
    },
    async (input) => {
      await api.deleteEvent(input.id);
      return emptyResult("Event moved to trash.");
    },
  );
}
