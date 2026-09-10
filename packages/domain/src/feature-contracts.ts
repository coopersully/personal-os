/**
 * Shared contracts for feature modules. These types deliberately describe the
 * seams between product domains without collapsing domain records into a
 * generic mutable object.
 */

import { z } from "zod";
import type { AccessScope } from "./auth.js";
import { idSchema } from "./common.js";

export const featureIds = [
  "automations",
  "bookmarks",
  "calendar",
  "finances",
  "goals",
  "mail",
  "pinterest",
  "reminders",
  "settings",
  "tasks",
  "texting",
] as const;

export type FeatureId = (typeof featureIds)[number];

export const agentMutationPolicies = [
  "read_only",
  "preview",
  "approve_each",
  "approved_rule",
] as const;

export type AgentMutationPolicy = (typeof agentMutationPolicies)[number];

export const connectorCapabilities = [
  "calendar_read",
  "calendar_write",
  "mail_read",
  "mail_manage",
  "mail_send",
  "finance_read",
  "finance_write",
  "bookmarks_read",
] as const;

export type ConnectorCapability = (typeof connectorCapabilities)[number];

export const googleConnectionServiceSchema = z.enum(["calendar", "mail"]);
export type GoogleConnectionService = z.infer<typeof googleConnectionServiceSchema>;

export const startGoogleAuthorizationInputSchema = z.object({
  accountId: idSchema.optional(),
  returnTo: z
    .enum(["/setup", "/settings?section=connections"])
    .default("/settings?section=connections"),
  services: z.array(googleConnectionServiceSchema).min(1).default(["calendar", "mail"]),
});
export type StartGoogleAuthorizationInput = z.infer<typeof startGoogleAuthorizationInputSchema>;

/**
 * A durable attribution record for a projection, recommendation, or proposed
 * mutation. The source provider remains authoritative for connected material.
 */
export const materialSourceReferenceSchema = z.object({
  accountId: z.uuid().nullable(),
  provider: z.enum([
    "google",
    "icloud",
    "local",
    "paypal",
    "plaid",
    "twilio",
    "venmo",
    "x",
    "zelle",
  ]),
  remoteId: z.string().nullable(),
  revision: z.string().nullable(),
  sourceType: z.enum([
    "calendar_event",
    "finance_account",
    "finance_income_stream",
    "finance_recurring_obligation",
    "finance_transaction",
    "mail_thread",
    "text_message",
    "reminder",
    "task",
    "task_list",
    "task_project",
    "goal",
    "bookmark",
    "local",
  ]),
});
export type MaterialSourceReference = z.infer<typeof materialSourceReferenceSchema>;

/**
 * Feature modules use this shape when exposing a provider action to the API,
 * MCP, or UI. The policy must be evaluated by the API before any mutation.
 */
export type AgentActionContract = {
  feature: FeatureId;
  mutationPolicy: AgentMutationPolicy;
  requiredCapabilities: ConnectorCapability[];
  source: MaterialSourceReference | null;
};

/**
 * Shared HTTP authorization for domains that an agent can access. A scoped
 * token is the bounded user-approved rule for these mutations; stricter
 * actions retain their route-level human-session guard.
 */
export const featureAccessPolicies = {
  automations: {
    readScope: "automations:read",
    mutationPolicy: "approved_rule",
    writeScope: "automations:write",
  },
  bookmarks: {
    readScope: "bookmarks:read",
    mutationPolicy: "approved_rule",
    writeScope: "bookmarks:read",
  },
  calendar: {
    readScope: "calendar:read",
    mutationPolicy: "approved_rule",
    writeScope: "calendar:write",
  },
  finances: {
    readScope: "finances:read",
    mutationPolicy: "approved_rule",
    writeScope: "finances:write",
  },
  goals: {
    readScope: "goals:read",
    mutationPolicy: "approved_rule",
    writeScope: "goals:write",
  },
  mail: {
    readScope: "mail:read",
    mutationPolicy: "approved_rule",
    writeScope: "mail:write",
  },
  reminders: {
    readScope: "reminders:read",
    mutationPolicy: "approved_rule",
    writeScope: "reminders:write",
  },
  tasks: {
    readScope: "tasks:read",
    mutationPolicy: "approved_rule",
    writeScope: "tasks:write",
  },
  texting: {
    readScope: "texting:read",
    mutationPolicy: "approved_rule",
    writeScope: "texting:write",
  },
} as const satisfies Record<
  string,
  { mutationPolicy: AgentMutationPolicy; readScope: AccessScope; writeScope: AccessScope }
>;

export type FeatureAccessPolicyId = keyof typeof featureAccessPolicies;
