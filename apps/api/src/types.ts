import type { GoogleConnector, ICloudConnector, XConnector } from "@personal-os/connectors";
import type { Database } from "@personal-os/database";
import type {
  AccessScope,
  ActorType,
  CalendarProvider,
  ConnectorFailureCategory,
  ConnectorSyncRecovery,
} from "@personal-os/domain";
import type { AppConfig } from "./config.js";
import type { EmailDelivery } from "./email-delivery.js";
import type { RuntimeLifecycle } from "./runtime-lifecycle.js";

export type Principal = {
  actorId: string;
  actorType: Extract<ActorType, "agent" | "user">;
  scopes: ReadonlySet<AccessScope>;
  userId: string;
};

export type AppDependencies = {
  config: AppConfig;
  db: Database;
  fetch?: typeof globalThis.fetch;
  email?: EmailDelivery;
  google?: GoogleConnector;
  icloud?: ICloudConnector;
  log?: (entry: RequestLog) => void;
  now?: () => Date;
  runtimeLifecycle?: RuntimeLifecycle;
  x?: XConnector;
};

export type CalendarProviderReconciliationLog = {
  actorType: Extract<ActorType, "agent" | "user">;
  code: string;
  operation: string;
};

export type RequestLog = {
  accountId?: string;
  calendarProviderReconciliation?: CalendarProviderReconciliationLog;
  category?: ConnectorFailureCategory;
  code?: string;
  disposition?: ConnectorSyncRecovery;
  durationMs: number;
  event:
    | "calendar_provider_reconciliation"
    | "connector_sync_failed"
    | "connector_sync_recovered"
    | "connector_recovery_failed"
    | "mail_rule_work_dispatch_failed"
    | "request";
  failureCount?: number;
  method: string;
  nextSyncAt?: string | null;
  path: string;
  provider?: Extract<CalendarProvider, "google" | "icloud">;
  requestId: string;
  status: number;
};

export type AppVariables = {
  principal: Principal;
  requestId: string;
};

export type AppEnv = {
  Variables: AppVariables;
};
