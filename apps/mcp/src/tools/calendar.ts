import type { McpServer } from "@modelcontextprotocol/server";
import type { PersonalOsApiClient } from "@personal-os/api-client";
import {
  calendarBlockRevisionMapSchema,
  idSchema,
  isoDateTimeSchema,
  previewCalendarCommitmentInputSchema,
  upsertCalendarAttentionItemInputSchema,
} from "@personal-os/domain";
import { z } from "zod";
import { apiResult } from "../tool-result.js";

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
      inputSchema: z.object({}),
      title: "List calendars",
    },
    async () => apiResult(() => api.listCalendars()),
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
      inputSchema: z.object({
        calendarIds: z.array(id).optional(),
        from: isoDateTime,
        query: z.string().max(200).optional(),
        to: isoDateTime,
      }),
      title: "List calendar events",
    },
    async (input) => apiResult(() => api.listEvents(input)),
  );
  server.registerTool(
    "get_event",
    {
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
        readOnlyHint: true,
      },
      description:
        "Read one current Calendar event with its updatedAt mutation revision, provider source revision, and every linked block's independent updatedAt revision. Read immediately before a guarded mutation.",
      inputSchema: z.object({ id }),
      title: "Get calendar event",
    },
    async (input) => apiResult(() => api.getEvent(input.id)),
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
      inputSchema: z.object({
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
      }),
      title: "Create calendar event",
    },
    async (input) => apiResult(() => api.createEvent(input)),
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
      inputSchema: z.object({
        allDay: z.boolean().optional(),
        endsAt: isoDateTime.optional(),
        expectedBlockUpdatedAtById: calendarBlockRevisionMapSchema.describe(
          "Exact eventId-to-updatedAt map for every linked block returned by get_event; pass an empty object only when the event has no blocks.",
        ),
        expectedUpdatedAt: isoDateTime.describe(
          "The source event updatedAt returned by get_event. This is the local mutation CAS; source.revision is provider provenance.",
        ),
        id,
        location: z.string().max(1_000).nullable().optional(),
        notes: z.string().max(50_000).nullable().optional(),
        startsAt: isoDateTime.optional(),
        timezone: timeZone.optional(),
        title: z.string().min(1).max(500).optional(),
        visibility: visibility
          .optional()
          .describe("Replacement visibility; this can change disclosure to calendar viewers."),
      }),
      title: "Update calendar event",
    },
    async ({ id: eventId, ...input }) => apiResult(() => api.updateEvent(eventId, input)),
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
      inputSchema: z.object({
        calendarId: id.describe("Destination calendar identifier"),
        expectedUpdatedAt: isoDateTime.describe(
          "The source event updatedAt returned by get_event.",
        ),
        id: id.describe("Source event identifier"),
        mode: z.enum(["busy", "details"]).default("busy"),
      }),
      title: "Block event on another calendar",
    },
    async ({ id: eventId, ...input }) => apiResult(() => api.createEventBlock(eventId, input)),
  );
  server.registerTool(
    "set_event_block_privacy",
    {
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
        readOnlyHint: false,
      },
      description:
        "Switch a linked provider block between private Busy and included details. Including details can disclose title, notes, and location to the destination account.",
      inputSchema: z.object({
        blockId: id.describe("Linked block event identifier"),
        expectedBlockUpdatedAt: isoDateTime.describe(
          "The linked block updatedAt returned by get_event.",
        ),
        expectedUpdatedAt: isoDateTime.describe(
          "The source event updatedAt returned by get_event.",
        ),
        id: id.describe("Source event identifier"),
        mode: z.enum(["busy", "details"]),
      }),
      title: "Change event block privacy",
    },
    async ({ blockId, id: eventId, ...input }) =>
      apiResult(() => api.updateEventBlock(eventId, blockId, input)),
  );
  server.registerTool(
    "unblock_event",
    {
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
        readOnlyHint: false,
      },
      description: "Remove one linked destination block without deleting the source event.",
      inputSchema: z.object({
        blockId: id.describe("Linked block event identifier"),
        expectedBlockUpdatedAt: isoDateTime.describe(
          "The linked block updatedAt returned by get_event.",
        ),
        expectedUpdatedAt: isoDateTime.describe(
          "The source event updatedAt returned by get_event.",
        ),
        id: id.describe("Source event identifier"),
      }),
      title: "Unblock event calendar",
    },
    async ({ blockId, id: eventId, ...input }) =>
      apiResult(() => api.deleteEventBlock(eventId, blockId, input)),
  );
  server.registerTool(
    "delete_event",
    {
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
        readOnlyHint: false,
      },
      description:
        "Move an event and all linked blocks to recoverable trash locally and at connected providers. Requires the source and exact independent block revisions from get_event, and returns the deleted revisions required by restore_event. Provider deletion can cancel an attendee-facing event.",
      inputSchema: z.object({
        expectedBlockUpdatedAtById: calendarBlockRevisionMapSchema.describe(
          "Exact eventId-to-updatedAt map for every linked block.",
        ),
        expectedUpdatedAt: isoDateTime.describe("The source event updatedAt from get_event."),
        id,
      }),
      title: "Delete calendar event",
    },
    async ({ id: eventId, ...input }) => apiResult(() => api.trashEvent(eventId, input)),
  );
  server.registerTool(
    "restore_event",
    {
      annotations: {
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
        readOnlyHint: false,
      },
      description:
        "Restore one trashed event and its linked blocks using the exact source and block updatedAt revisions returned by delete_event. Connected restoration creates provider events and is not safe to replay blindly.",
      inputSchema: z.object({
        expectedBlockUpdatedAtById: calendarBlockRevisionMapSchema,
        expectedUpdatedAt: isoDateTime,
        id,
      }),
      title: "Restore calendar event",
    },
    async ({ id: eventId, ...input }) => apiResult(() => api.restoreEvent(eventId, input)),
  );
  server.registerTool(
    "create_calendar_attention_item",
    {
      annotations: {
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
        readOnlyHint: false,
      },
      description:
        "Create or refresh one open important, upcoming, or follow-up item for an owned Calendar event. Ilo locks and validates the event, derives provider provenance and current revision, deduplicates the open event/kind pair, and never copies event notes.",
      inputSchema: z.object({
        ...upsertCalendarAttentionItemInputSchema.shape,
        eventId: id,
      }),
      title: "Create Calendar attention item",
    },
    async ({ eventId, ...input }) =>
      apiResult(() => api.upsertCalendarAttentionItem(eventId, input)),
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
      inputSchema: previewCalendarCommitmentInputSchema,
      title: "Preview evidence-based Calendar commitment",
    },
    async (input) => apiResult(() => api.previewCalendarCommitment(input)),
  );
}
