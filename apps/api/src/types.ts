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
  AgentAccessDomain,
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
  authorizationConnectionId?: string;
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
  category?: ConnectorFailureCategory | "timeout" | "overflow" | "unexpected";
  workspace?: AgentAccessDomain;
  source?: string;
  code?: string | undefined;
  disposition?: ConnectorSyncRecovery;
  durationMs: number;
  claimCount?: number;
  hostOutcome?: "accepted" | "uncertain" | "unavailable";
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
    | "desktop_release_unavailable"
    | "finance_sync_health_initialized"
    | "finance_host_handoff"
    | "finance_receipt_mail_search_failed"
    | "mail_rule_work_dispatch_failed"
    | "finance_configuration_section_failed"
    | "workspace_review_search_source_failed"
    | "mail_attachment_download_failed"
    | "request";
  section?: "profile" | "preferences" | "income" | "budget" | "accounts" | "guidance" | "execution";
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
