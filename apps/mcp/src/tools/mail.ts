import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PersonalOsApiClient } from "@personal-os/api-client";
import { idSchema, mailRuleActionSchema, mailRuleConditionSchema } from "@personal-os/domain";
import { z } from "zod";
import { result } from "../tool-result.js";

const id = idSchema.describe("ilo object identifier");
const mailRuleCondition = mailRuleConditionSchema;
const mailRuleAction = mailRuleActionSchema;
const mailRuleFields = {
  actions: z.array(mailRuleAction).min(1).max(10),
  condition: mailRuleCondition,
  confidenceThreshold: z.number().min(0).max(1).nullable(),
  description: z.string().max(2_000),
  enabled: z.boolean(),
  name: z.string().min(1).max(120),
  policy: z.enum(["preview", "approve_each", "approved_rule"]),
  profileId: id.nullable(),
  sourceIds: z.array(id).max(50),
} as const;
const createMailRuleFields = {
  ...mailRuleFields,
  confidenceThreshold: mailRuleFields.confidenceThreshold.default(null),
  description: mailRuleFields.description.default(""),
  enabled: mailRuleFields.enabled.default(false),
  policy: mailRuleFields.policy.default("preview"),
  profileId: mailRuleFields.profileId.default(null),
  sourceIds: mailRuleFields.sourceIds.default([]),
} as const;

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
  server.registerTool(
    "list_mail_rules",
    {
      annotations: { openWorldHint: false, readOnlyHint: true },
      description:
        "List the user's versioned mail rules, including exact conditions, actions, source accounts, delays, policy, and enabled state.",
      inputSchema: {},
      title: "List mail rules",
    },
    async () => result(await api.listMailRules()),
  );
  server.registerTool(
    "preview_mail_rule",
    {
      annotations: { openWorldHint: false, readOnlyHint: true },
      description:
        "Preview a proposed mail rule against up to 200 recent conversations. Returns exact matches and whether delayed actions are due without changing mail.",
      inputSchema: {
        actions: mailRuleFields.actions,
        condition: mailRuleFields.condition,
        confidenceThreshold: mailRuleFields.confidenceThreshold.default(null),
        description: mailRuleFields.description.default(""),
        sourceIds: mailRuleFields.sourceIds.default([]),
      },
      title: "Preview mail rule",
    },
    async (input) => result(await api.previewMailRule(input)),
  );
  server.registerTool(
    "create_mail_rule",
    {
      annotations: { openWorldHint: false },
      description:
        "Save a versioned mail rule after previewing its exact candidates. New rules default to disabled and preview policy.",
      inputSchema: createMailRuleFields,
      title: "Create mail rule",
    },
    async (input) => result(await api.createMailRule(input)),
  );
  server.registerTool(
    "update_mail_rule",
    {
      annotations: { idempotentHint: true, openWorldHint: false },
      description:
        "Revise, enable, disable, or change the policy of a mail rule using optimistic version matching.",
      inputSchema: {
        actions: mailRuleFields.actions.optional(),
        condition: mailRuleFields.condition.optional(),
        confidenceThreshold: mailRuleFields.confidenceThreshold.optional(),
        description: mailRuleFields.description.optional(),
        enabled: mailRuleFields.enabled.optional(),
        expectedVersion: z.number().int().positive(),
        id,
        name: mailRuleFields.name.optional(),
        policy: mailRuleFields.policy.optional(),
        profileId: mailRuleFields.profileId.optional(),
        sourceIds: mailRuleFields.sourceIds.optional(),
      },
      title: "Update mail rule",
    },
    async ({ id: ruleId, ...input }) => result(await api.updateMailRule(ruleId, input)),
  );
}
