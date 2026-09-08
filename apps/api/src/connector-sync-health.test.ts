import { ConnectorError } from "@personal-os/connectors";
import {
  classifyConnectorSyncFailure,
  connectionHealthForAccount,
  connectorRetryAt,
  connectorSyncAppError,
} from "./connector-sync-health.js";

const accountId = "11111111-1111-4111-8111-111111111111";
const now = new Date("2026-08-05T20:00:00.000Z");

describe("connector sync health policy", () => {
  it.each([
    [1, 60_000],
    [2, 5 * 60_000],
    [3, 15 * 60_000],
    [4, 60 * 60_000],
    [9, 60 * 60_000],
  ])("backs off failure %i by %i milliseconds before jitter", (failureCount, baseDelayMs) => {
    const next = connectorRetryAt({
      accountId,
      failureCount,
      now,
      retryAfterMs: null,
    });
    expect(next.getTime()).toBeGreaterThanOrEqual(now.getTime() + baseDelayMs);
    expect(next.getTime()).toBeLessThan(now.getTime() + baseDelayMs * 1.1);
  });

  it("honors bounded provider retry timing without shortening policy backoff", () => {
    expect(
      connectorRetryAt({ accountId, failureCount: 1, now, retryAfterMs: 120_000 }).getTime(),
    ).toBe(now.getTime() + 120_000);
    expect(
      connectorRetryAt({
        accountId,
        failureCount: 1,
        now,
        retryAfterMs: 7 * 24 * 60 * 60_000,
      }).getTime(),
    ).toBe(now.getTime() + 24 * 60 * 60_000);
  });

  it("does not trust unknown exception text", () => {
    const failure = classifyConnectorSyncFailure(
      new Error("private provider body token=secret"),
      "google",
    );
    expect(failure).toMatchObject({ category: "unknown", recovery: "automatic" });
    expect(JSON.stringify(failure)).not.toContain("token=secret");
  });

  it.each([
    ["reconnect", "authorization", "reconnect"],
    ["operator", "configuration", "operator"],
    ["retry", "temporary", "automatic"],
  ] as const)("maps %s disposition to safe recovery", (disposition, category, recovery) => {
    const failure = classifyConnectorSyncFailure(
      new ConnectorError({
        category,
        code: `google_${category}`,
        disposition,
        message: "provider-secret-canary",
        status: disposition === "reconnect" ? 401 : 503,
      }),
      "google",
    );
    expect(failure).toMatchObject({ category, recovery });
    expect(JSON.stringify(failure)).not.toContain("provider-secret-canary");
  });

  it.each([
    ["idle", null, "ready"],
    ["syncing", "automatic", "syncing"],
    ["error", "automatic", "retrying"],
    ["error", "reconnect", "reconnect"],
    ["error", "operator", "service_attention"],
  ] as const)("projects %s/%s as %s", (syncStatus, syncRecovery, state) => {
    expect(
      connectionHealthForAccount({
        nextSyncAt: syncRecovery === "reconnect" ? null : now,
        syncError: syncRecovery ? "Safe nohmi message" : null,
        syncRecovery,
        syncStatus,
      }),
    ).toMatchObject({ state });
  });

  it("normalizes legacy product names in stored health messages", () => {
    expect(
      connectionHealthForAccount({
        nextSyncAt: now,
        syncError: "This connection was interrupted. ilo will retry automatically.",
        syncRecovery: "automatic",
        syncStatus: "error",
      }).message,
    ).toBe("This connection was interrupted. nohmi will retry automatically.");
  });

  it("creates a safe structured application error", () => {
    const failure = classifyConnectorSyncFailure(new Error("raw-provider-canary"), "icloud");
    const error = connectorSyncAppError(failure, accountId, "icloud", now);
    expect(error).toMatchObject({
      code: "service_unavailable",
      details: {
        accountId,
        category: "unknown",
        nextSyncAt: now.toISOString(),
        provider: "icloud",
        recovery: "automatic",
      },
    });
    expect(JSON.stringify(error)).not.toContain("raw-provider-canary");
  });

  it("maps provider-specific operator and rate-limit messages safely", () => {
    const notFound = classifyConnectorSyncFailure(
      new ConnectorError({
        category: "not_found",
        code: "icloud_resource_not_found",
        disposition: "operator",
        message: "raw-provider-canary",
      }),
      "icloud",
    );
    expect(notFound.message).toBe(
      "iCloud could not find a connected resource. nohmi is resolving this.",
    );

    const rejected = classifyConnectorSyncFailure(
      new ConnectorError({
        category: "rejected",
        code: "google_request_rejected",
        disposition: "operator",
        message: "raw-provider-canary",
      }),
      "google",
    );
    expect(rejected.message).toBe(
      "Google returned an unexpected response. nohmi is resolving this.",
    );

    const rateLimited = classifyConnectorSyncFailure(
      new ConnectorError({
        category: "rate_limited",
        code: "google_rate_limited",
        disposition: "retry",
        message: "raw-provider-canary",
      }),
      "google",
    );
    expect(rateLimited.message).toContain("retry automatically");
    expect(connectorSyncAppError(rateLimited, accountId, "google", null)).toMatchObject({
      code: "rate_limited",
      details: { nextSyncAt: null },
    });
  });

  it("classifies Plaid configuration and rate-limit failures without provider text", () => {
    const configuration = classifyConnectorSyncFailure(
      new ConnectorError({
        category: "configuration",
        code: "plaid_configuration_invalid",
        disposition: "operator",
        message: "raw-plaid-configuration-canary",
        status: 400,
      }),
      "plaid",
    );
    expect(configuration).toEqual({
      category: "configuration",
      code: "plaid_configuration_invalid",
      message: "Plaid is not configured correctly. nohmi is resolving this.",
      recovery: "operator",
      retryAfterMs: null,
      status: 400,
    });

    const rateLimited = classifyConnectorSyncFailure(
      new ConnectorError({
        category: "rate_limited",
        code: "plaid_rate_limited",
        disposition: "retry",
        message: "raw-plaid-rate-limit-canary",
        retryAfterMs: 120_000,
        status: 429,
      }),
      "plaid",
    );
    expect(rateLimited).toMatchObject({
      category: "rate_limited",
      message: "Plaid is temporarily rate-limiting nohmi. nohmi will retry automatically.",
      recovery: "automatic",
      retryAfterMs: 120_000,
    });
    expect(JSON.stringify([configuration, rateLimited])).not.toContain("raw-plaid");
  });
});
