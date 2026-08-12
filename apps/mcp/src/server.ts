import { McpServer } from "@modelcontextprotocol/server";
import type { PersonalOsApiClient } from "@personal-os/api-client";
import { type AccessScope, accessScopeSchema, localDayRange } from "@personal-os/domain";
import { registerIloContextTool, registerIloDiscovery } from "./discovery.js";
import { createIloToolSurface } from "./tool-surface.js";
import { registerActivityTools } from "./tools/activity.js";
import { registerAssistantTools } from "./tools/assistant.js";
import { registerCalendarEventTools, registerCalendarListTools } from "./tools/calendar.js";
import { registerFinanceTools } from "./tools/finances.js";
import { registerMailTools } from "./tools/mail.js";
import { registerPlanningTools } from "./tools/planning.js";
import { registerReminderTools } from "./tools/reminders.js";
import { registerXBookmarkTools } from "./tools/x-bookmarks.js";

export type ServerOptions = {
  api: PersonalOsApiClient;
  appBaseUrl?: string;
  includeCompatibilityTools?: boolean;
  now?: () => Date;
  readOnly?: boolean;
  scopes?: ReadonlySet<AccessScope>;
  timeZone: string;
};

/** Thin composition root for Ilo's feature-owned, scope-aware MCP surface. */
export function createPersonalOsMcpServer(options: ServerOptions): McpServer {
  const appBaseUrl = (options.appBaseUrl ?? "http://localhost").replace(/\/$/, "");
  const readOnly = options.readOnly ?? false;
  const includeCompatibility = options.includeCompatibilityTools ?? false;
  const scopes = options.scopes ?? new Set(accessScopeSchema.options);
  const server = new McpServer(
    {
      icons: [{ mimeType: "image/png", src: `${appBaseUrl}/icon-192.png` }],
      name: "ilo",
      title: "ilo",
      version: "0.1.0",
    },
    {
      instructions:
        "Call get_ilo_context first. Inspect authoritative state before proposing changes, use preview tools before consequential commits, and verify mutations from returned state or activity. Ilo's API remains the authority for access and policy.",
    },
  );
  const tools = createIloToolSurface(server, {
    appBaseUrl,
    includeCompatibility,
    readOnly,
    scopes,
  });
  const discovery = {
    api: options.api,
    appBaseUrl,
    includeCompatibility,
    now: options.now ?? (() => new Date()),
    readOnly,
    scopes,
    timeZone: options.timeZone,
  };

  registerIloContextTool(tools, discovery);
  registerAssistantTools(tools, options.api);
  registerPlanningTools(tools, options.api);
  registerCalendarListTools(tools, options.api);
  registerCalendarEventTools(tools, options.api);
  registerReminderTools(tools, options.api);
  registerMailTools(tools, options.api);
  registerFinanceTools(tools, options.api);
  registerXBookmarkTools(tools, options.api);
  registerActivityTools(tools, options.api);

  registerCompatibilityResources(server, options, scopes);
  registerIloDiscovery(server, discovery);
  return server;
}

/** Keep the original URIs readable while clients migrate to Ilo resource templates. */
function registerCompatibilityResources(
  server: McpServer,
  options: ServerOptions,
  scopes: ReadonlySet<AccessScope>,
): void {
  const canReadCalendar = scopes.has("calendar:read");
  const canReadReminders = scopes.has("reminders:read");
  if (canReadCalendar || canReadReminders)
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
          canReadCalendar ? options.api.listEvents(range) : Promise.resolve([]),
          canReadReminders
            ? options.api.listReminders({ completed: false, dueBefore: range.to })
            : Promise.resolve({ items: [] }),
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

  if (scopes.has("automations:read"))
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
}
