import { z } from "zod";
import { isoDateTimeSchema } from "./common.js";

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
