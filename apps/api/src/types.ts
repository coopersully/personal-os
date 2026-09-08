import type {
  GoogleConnector,
  ICloudConnector,
  PlaidConnector,
  TwilioConnector,
  XConnector,
} from "@personal-os/connectors";
import type { Database } from "@personal-os/database";
import type {
  AccessScope,
  ActorType,
  CalendarProvider,
  ConnectorFailureCategory,
  ConnectorSubscriptionKind,
  ConnectorSyncRecovery,
  ConnectorSyncTriggerReason,
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
  plaid?: PlaidConnector;
  runtimeLifecycle?: RuntimeLifecycle;
  twilio?: TwilioConnector;
  verifyGooglePubSubToken?: (token: string) => Promise<{ subject: string | null }>;
  x?: XConnector;
};

export type CalendarProviderReconciliationLog = {
  actorType: Extract<ActorType, "agent" | "user">;
  code: string;
  operation: string;
};

export type RequestLog = {
  accountId?: string;
  ageMs?: number | undefined;
  calendarProviderReconciliation?: CalendarProviderReconciliationLog;
  category?: ConnectorFailureCategory;
  code?: string | undefined;
  disposition?: ConnectorSyncRecovery;
  durationMs: number;
  eligibleAccountCount?: number;
  event:
    | "calendar_provider_reconciliation"
    | "connector_authorization_callback_failed"
    | "connector_notification_received"
    | "connector_subscription_expired"
    | "connector_subscription_failed"
    | "connector_subscription_renewed"
    | "connector_sync_completed"
    | "connector_sync_failed"
    | "connector_sync_freshness_observed"
    | "connector_sync_recovered"
    | "connector_trigger_dispatched"
    | "connector_recovery_failed"
    | "finance_sync_health_initialized"
    | "finance_receipt_mail_search_failed"
    | "mail_rule_work_dispatch_failed"
    | "request";
  failureCount?: number;
  freshnessAgeMs?: number;
  initializationComplete?: boolean;
  initializedAccountCount?: number;
  initializedManualAccountCount?: number;
  initializedPlaidCurrentAccountCount?: number;
  initializedPlaidDueAccountCount?: number;
  method: string;
  nextSyncAt?: string | null;
  notificationDisposition?: "accepted" | "duplicate" | "rejected" | undefined;
  path: string;
  provider?: Extract<CalendarProvider, "google" | "icloud"> | "plaid" | "x";
  renewalLagMs?: number | undefined;
  requestId: string;
  status: number;
  subscriptionKind?: ConnectorSubscriptionKind | undefined;
  triggerReason?: ConnectorSyncTriggerReason | undefined;
};

export type AppVariables = {
  principal: Principal;
  requestId: string;
};

export type AppEnv = {
  Variables: AppVariables;
};
