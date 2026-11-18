import type { McpServer } from "@modelcontextprotocol/server";
import type { PersonalOsApiClient } from "@personal-os/api-client";
import {
  createCalendarReviewInputSchema,
  createLocalCalendarInputSchema,
  idSchema,
  updateLocalCalendarInputSchema,
} from "@personal-os/domain";
import { z } from "zod";
import { apiResult } from "../tool-result.js";

/** Calendar-owned management; provider and writeability checks remain in the API. */
export function registerCalendarManagementTools(server: McpServer, api: PersonalOsApiClient) {
  server.registerTool(
    "create_calendar",
    {
      title: "Create calendar",
      description:
        "Create a local calendar with a name, optional color, and IANA timezone. Returns its canonical ID for event creation. Requires calendar:write; this direct scoped operation does not require review bypass.",
      inputSchema: createLocalCalendarInputSchema,
    },
    async (input) => apiResult(() => api.createCalendar(input)),
  );
  server.registerTool(
    "update_calendar",
    {
      title: "Update calendar",
      description:
        "Update a local calendar's name, color, or IANA timezone. Omitted fields are unchanged; null clears color. Provider calendars retain their provider's authority. Requires calendar:write.",
      inputSchema: updateLocalCalendarInputSchema.safeExtend({ calendarId: idSchema }),
    },
    async ({ calendarId, ...input }) => apiResult(() => api.updateCalendar(calendarId, input)),
  );
  server.registerTool(
    "delete_calendar",
    {
      title: "Delete local calendar",
      description:
        "Delete an owned local calendar and its events. Inspect list_calendars and list_events first; deletion is not recoverable through this tool. Provider calendars cannot be deleted here. Requires calendar:write.",
      inputSchema: { calendarId: idSchema },
    },
    async ({ calendarId }) =>
      apiResult(async () => {
        await api.deleteCalendar(calendarId);
        return { deleted: true, calendarId };
      }),
  );
  server.registerTool(
    "set_calendar_selection",
    {
      title: "Set calendar selection",
      description:
        "Include or exclude an owned calendar in selected-calendar views without deleting its events. Requires calendar:write; return the updated calendar for verification.",
      inputSchema: { calendarId: idSchema, selected: z.boolean() },
    },
    async ({ calendarId, selected }) =>
      apiResult(() => api.setCalendarSelected(calendarId, selected)),
  );
  server.registerTool(
    "get_calendar_status",
    {
      title: "Get Calendar status",
      description:
        "Read Calendar readiness, source health, outstanding work and recovery. Requires calendar:read; does not change calendar material.",
      inputSchema: {},
    },
    async () => apiResult(() => api.getCalendarStatus()),
  );
  server.registerTool(
    "get_calendar_review",
    {
      title: "Get Calendar review",
      description:
        "Read a bounded Calendar review for the supplied maintenance scope. This computes a review without changing events. Requires calendar:read.",
      inputSchema: createCalendarReviewInputSchema,
    },
    async (input) => apiResult(() => api.createCalendarReview(input)),
  );
}
