import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PersonalOsApiClient } from "@personal-os/api-client";
import { z } from "zod";
import { result } from "../tool-result.js";

const id = z.string().uuid().describe("ilo object identifier");

/** Mail-owned MCP surface; the API remains the authorization boundary. */
export function registerMailTools(server: McpServer, api: PersonalOsApiClient) {
  server.registerTool(
    "list_mailboxes",
    {
      annotations: { openWorldHint: false, readOnlyHint: true },
      description:
        "List the user's connected Google and iCloud mailboxes with unread and total counts.",
      inputSchema: {},
      title: "List mailboxes",
    },
    async () => result(await api.listMailboxes()),
  );
  server.registerTool(
    "list_mail",
    {
      annotations: { openWorldHint: false, readOnlyHint: true },
      description: "List or search read-only conversations across connected mail accounts.",
      inputSchema: {
        accountIds: z.array(id).optional(),
        limit: z.number().int().min(1).max(200).default(100),
        mailboxId: id.optional(),
        query: z.string().max(200).optional(),
        unread: z.boolean().optional(),
      },
      title: "List mail",
    },
    async (input) => result(await api.listMailThreads(input)),
  );
  server.registerTool(
    "read_mail",
    {
      annotations: { openWorldHint: false, readOnlyHint: true },
      description: "Read one cached mail conversation, including its plain-text body.",
      inputSchema: { id },
      title: "Read mail",
    },
    async (input) => {
      const [thread, messages] = await Promise.all([
        api.getMailThread(input.id),
        api.listMailMessages(input.id),
      ]);
      return result({ ...thread, messages });
    },
  );
  server.registerTool(
    "update_mail",
    {
      annotations: { idempotentHint: true, openWorldHint: true },
      description:
        "Update a cached mail conversation's read or starred state. Requires the mail:write scope.",
      inputSchema: { id, starred: z.boolean().optional(), unread: z.boolean().optional() },
      title: "Update mail",
    },
    async ({ id: threadId, ...input }) => result(await api.updateMailThread(threadId, input)),
  );
  server.registerTool(
    "bulk_update_mail",
    {
      annotations: { idempotentHint: true, openWorldHint: true },
      description:
        "Apply the same read or starred state to multiple conversations. Requires the mail:write scope.",
      inputSchema: {
        ids: z.array(id).min(1).max(100),
        starred: z.boolean().optional(),
        unread: z.boolean().optional(),
      },
      title: "Bulk update mail",
    },
    async ({ ids, ...input }) => {
      await Promise.all(ids.map((threadId) => api.updateMailThread(threadId, input)));
      return result({ updated: ids.length });
    },
  );
  server.registerTool(
    "snooze_mail",
    {
      annotations: { idempotentHint: true, openWorldHint: true },
      description: "Hide a conversation until a specified time. Requires the mail:write scope.",
      inputSchema: { id, until: z.string().datetime({ offset: true }) },
      title: "Snooze mail",
    },
    async ({ id: threadId, until }) => {
      await api.snoozeMailThread(threadId, until);
      return result({ snoozed: true });
    },
  );
  server.registerTool(
    "send_mail",
    {
      annotations: { openWorldHint: true },
      description: "Send an email through a connected account. Requires the mail:write scope.",
      inputSchema: {
        accountId: id,
        body: z.string().max(100_000),
        cc: z.array(z.object({ address: z.email(), name: z.string().nullable() })).default([]),
        subject: z.string().max(998),
        threadId: id.optional(),
        to: z.array(z.object({ address: z.email(), name: z.string().nullable() })).min(1),
      },
      title: "Send mail",
    },
    async (input) => {
      await api.sendMail(input);
      return result({ sent: true });
    },
  );
}
