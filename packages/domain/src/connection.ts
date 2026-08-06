import { z } from "zod";
import { isoDateTimeSchema } from "./common.js";

export const connectorAuthorizationProviderSchema = z.enum(["google", "x"]);
export type ConnectorAuthorizationProvider = z.infer<
  typeof connectorAuthorizationProviderSchema
>;

export const connectorAuthorizationStatusSchema = z.enum([
  "pending",
  "connected",
  "cancelled",
  "expired",
  "permission_incomplete",
  "failed",
]);
export type ConnectorAuthorizationStatus = z.infer<typeof connectorAuthorizationStatusSchema>;

export const connectorAuthorizationOutcomeSchema = z.object({
  accountId: z.uuid().nullable(),
  provider: connectorAuthorizationProviderSchema,
  retryable: z.boolean(),
  status: connectorAuthorizationStatusSchema,
});
export type ConnectorAuthorizationOutcome = z.infer<typeof connectorAuthorizationOutcomeSchema>;

export const connectorSubscriptionKindSchema = z.enum([
  "gmail_mailbox",
  "google_calendar_list",
  "google_calendar_events",
  "icloud_mail_idle",
]);
export type ConnectorSubscriptionKind = z.infer<typeof connectorSubscriptionKindSchema>;

export const connectorSubscriptionStatusSchema = z.enum([
  "pending",
  "active",
  "renewing",
  "expired",
  "failed",
  "stopped",
]);
export type ConnectorSubscriptionStatus = z.infer<typeof connectorSubscriptionStatusSchema>;

export const connectorSyncTriggerReasonSchema = z.enum([
  "initial",
  "notification",
  "reconciliation",
  "manual",
  "retry",
  "recovery",
]);
export type ConnectorSyncTriggerReason = z.infer<typeof connectorSyncTriggerReasonSchema>;

export const connectorSyncStatusSchema = z.enum(["idle", "syncing", "error"]);
export type ConnectorSyncStatus = z.infer<typeof connectorSyncStatusSchema>;

export const connectorSyncRecoverySchema = z.enum(["automatic", "operator", "reconnect"]);
export type ConnectorSyncRecovery = z.infer<typeof connectorSyncRecoverySchema>;

export const connectorFailureCategorySchema = z.enum([
  "authorization",
  "configuration",
  "invalid_response",
  "not_found",
  "rate_limited",
  "rejected",
  "temporary",
  "transport",
  "unknown",
]);
export type ConnectorFailureCategory = z.infer<typeof connectorFailureCategorySchema>;

export const connectionHealthStateSchema = z.enum([
  "ready",
  "syncing",
  "retrying",
  "reconnect",
  "service_attention",
]);
export type ConnectionHealthState = z.infer<typeof connectionHealthStateSchema>;

export const connectedAccountHealthSchema = z.object({
  message: z.string().max(300).nullable(),
  nextSyncAt: isoDateTimeSchema.nullable(),
  recovery: connectorSyncRecoverySchema.nullable(),
  state: connectionHealthStateSchema,
});
export type ConnectedAccountHealth = z.infer<typeof connectedAccountHealthSchema>;
