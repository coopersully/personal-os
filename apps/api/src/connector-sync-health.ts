import { ConnectorError } from "@personal-os/connectors";
import type {
  CalendarProvider,
  ConnectedAccountHealth,
  ConnectorFailureCategory,
  ConnectorSyncRecovery,
  ConnectorSyncStatus,
} from "@personal-os/domain";
import { AppError } from "./errors.js";

type ExternalConnectorProvider = Extract<CalendarProvider, "google" | "icloud"> | "plaid";

export type ConnectorSyncFailure = {
  category: ConnectorFailureCategory;
  code: string;
  message: string;
  recovery: ConnectorSyncRecovery;
  retryAfterMs: number | null;
  status: number | null;
};

export function classifyConnectorSyncFailure(
  error: unknown,
  provider: ExternalConnectorProvider,
): ConnectorSyncFailure {
  if (error instanceof ConnectorError) {
    const recovery =
      error.disposition === "reconnect"
        ? "reconnect"
        : error.disposition === "operator"
          ? "operator"
          : "automatic";
    return {
      category: error.category,
      code: error.code,
      message: safeConnectorMessage(provider, error.category, recovery),
      recovery,
      retryAfterMs: error.retryAfterMs,
      status: error.status,
    };
  }
  return {
    category: "unknown",
    code: "connector_unknown_failure",
    message: `${providerLabel(provider)} is temporarily unavailable. nohmi will retry automatically.`,
    recovery: "automatic",
    retryAfterMs: null,
    status: null,
  };
}

export function connectorRetryAt(input: {
  accountId: string;
  failureCount: number;
  now: Date;
  retryAfterMs: number | null;
}): Date {
  const baseDelayMs = retryDelayMs(input.failureCount);
  const jitterMs = Math.floor(
    baseDelayMs * stableRatio(`${input.accountId}:${input.failureCount}`),
  );
  const policyDelayMs = baseDelayMs + jitterMs;
  const providerDelayMs = Math.min(Math.max(input.retryAfterMs ?? 0, 0), 24 * 60 * 60_000);
  return new Date(input.now.getTime() + Math.max(policyDelayMs, providerDelayMs));
}

export function connectionHealthForAccount(account: {
  nextSyncAt: Date | null;
  syncError: string | null;
  syncRecovery: ConnectorSyncRecovery | null;
  syncStatus: ConnectorSyncStatus;
}): ConnectedAccountHealth {
  const state =
    account.syncStatus === "syncing"
      ? "syncing"
      : account.syncRecovery === "reconnect"
        ? "reconnect"
        : account.syncRecovery === "operator"
          ? "service_attention"
          : account.syncRecovery === "automatic"
            ? "retrying"
            : "ready";
  return {
    message:
      state === "ready" || state === "syncing"
        ? null
        : (account.syncError?.replace(/\b(?:ilo|nohmi)\b/gi, "nohmi") ?? null),
    nextSyncAt: account.nextSyncAt?.toISOString() ?? null,
    recovery: account.syncRecovery,
    state,
  };
}

export function connectorSyncAppError(
  failure: ConnectorSyncFailure,
  accountId: string,
  provider: ExternalConnectorProvider,
  nextSyncAt: Date | null,
): AppError {
  return new AppError(
    failure.category === "rate_limited" ? "rate_limited" : "service_unavailable",
    failure.message,
    {
      accountId,
      category: failure.category,
      nextSyncAt: nextSyncAt?.toISOString() ?? null,
      provider,
      recovery: failure.recovery,
    },
  );
}

function safeConnectorMessage(
  provider: ExternalConnectorProvider,
  category: ConnectorFailureCategory,
  recovery: ConnectorSyncRecovery,
): string {
  const label = providerLabel(provider);
  if (recovery === "reconnect") {
    return `${label} authorization is no longer valid. Reconnect to resume syncing.`;
  }
  if (recovery === "operator") {
    if (category === "configuration") {
      return `${label} is not configured correctly. nohmi is resolving this.`;
    }
    if (category === "not_found") {
      return `${label} could not find a connected resource. nohmi is resolving this.`;
    }
    return `${label} returned an unexpected response. nohmi is resolving this.`;
  }
  if (category === "rate_limited") {
    return `${label} is temporarily rate-limiting nohmi. nohmi will retry automatically.`;
  }
  return `${label} is temporarily unavailable. nohmi will retry automatically.`;
}

function providerLabel(provider: ExternalConnectorProvider): string {
  if (provider === "google") return "Google";
  if (provider === "plaid") return "Plaid";
  return "iCloud";
}

function retryDelayMs(failureCount: number): number {
  if (failureCount <= 1) return 60_000;
  if (failureCount === 2) return 5 * 60_000;
  if (failureCount === 3) return 15 * 60_000;
  return 60 * 60_000;
}

function stableRatio(value: string): number {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) / 0x1_0000_0000 / 10;
}
