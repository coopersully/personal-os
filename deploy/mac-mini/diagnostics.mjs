import { freemem, loadavg, totalmem, uptime } from "node:os";

const events = new Set([
  "connector_sync_failed",
  "connector_sync_completed",
  "connector_sync_recovered",
  "connector_sync_freshness_observed",
  "connector_capability_failed",
  "connector_capability_completed",
  "connector_subscription_failed",
  "connector_subscription_expired",
  "connector_subscription_renewed",
  "connector_trigger_dispatched",
  "connector_notification_received",
  "connector_recovery_failed",
]);
const codePattern =
  /^((google|icloud_calendar|icloud_mail|plaid|connector)_(authorization_failed|permission_missing|permission_denied|configuration_invalid|rate_limited|temporary_failure|transport_failure|unknown_failure|credentials_missing|sync_interrupted|request_rejected|resource_not_found)|plaid_(invalid_response|invalid_cursor|transactions_cursor_invalid|invalid_cursor_replay_in_progress|invalid_cursor_replay_failed|account_missing_from_item|configuration_missing|sync_page_limit_exceeded|sync_cursor_not_advancing)|finance_(encryption_configuration_missing|provider_item_identity_mismatch|provider_item_identity_conflict))$/;
const transportCodePattern =
  /^(ENOTFOUND|EAI_AGAIN|EAI_FAIL|CERT_HAS_EXPIRED|CERT_NOT_YET_VALID|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER_CERT_LOCALLY|ERR_TLS_CERT_ALTNAME_INVALID|ERR_SSL_WRONG_VERSION_NUMBER|ECONNRESET|ECONNREFUSED|EPIPE|ENETUNREACH|EHOSTUNREACH|UND_ERR_SOCKET|ETIMEDOUT|ESOCKETTIMEDOUT|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT)$/;
const servicePattern = /^nohmi-production-(api|mcp|web|postgres|gateway|tunnel)-[0-9]+$/;
const quantityPattern = /^[0-9.]+(?:%|[kMGT]?i?B)(?: \/ [0-9.]+[kMGT]?i?B)?$/;

export function summarizeConnectorLogs(logs) {
  const result = [];
  let ignoredLines = 0;
  for (const line of logs.split("\n").slice(-5000)) {
    if (!line) continue;
    try {
      const value = JSON.parse(line);
      if (!events.has(value?.event)) {
        ignoredLines++;
        continue;
      }
      const safe = { event: value.event };
      for (const key of [
        "status",
        "durationMs",
        "failureCount",
        "freshnessAgeMs",
        "ageMs",
        "eligibleAccountCount",
      ]) {
        if (typeof value[key] === "number" && Number.isFinite(value[key]) && value[key] >= 0)
          safe[key] = value[key];
      }
      if (["google", "icloud", "plaid", "x"].includes(value.provider))
        safe.provider = value.provider;
      if (["calendar", "mail"].includes(value.capability)) safe.capability = value.capability;
      if (["automatic", "operator", "reconnect"].includes(value.disposition))
        safe.disposition = value.disposition;
      if (typeof value.code === "string" && codePattern.test(value.code)) safe.code = value.code;
      if (typeof value.transportCode === "string" && transportCodePattern.test(value.transportCode))
        safe.transportCode = value.transportCode;
      if (["dns", "tls", "socket", "timeout"].includes(value.transportPhase))
        safe.transportPhase = value.transportPhase;
      if (["scheduled", "triggered", "manual"].includes(value.syncSource))
        safe.syncSource = value.syncSource;
      if (typeof value.requestId === "string" && /^sync:[a-f0-9-]{36}$/.test(value.requestId))
        safe.requestId = value.requestId;
      result.push(safe);
    } catch {
      ignoredLines++;
    }
  }
  return {
    events: result,
    ignoredLines,
    boundedWindow: "Last 5000 API log lines within 24 hours; rotated logs may be unavailable.",
  };
}

function jsonLines(value) {
  return value
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export async function collectDiagnostics(runtime) {
  const unavailable = [];
  const read = async (name, work, fallback) => {
    try {
      return await work();
    } catch {
      unavailable.push(name);
      return fallback;
    }
  };
  const ids = await read("containers", async () => {
    const result = (await runtime.compose(["ps", "--all", "--quiet"], { timeout: 15_000 }))
      .split(/\s+/)
      .filter(Boolean);
    if (result.length > 12 || result.some((id) => !/^[a-f0-9]{12,64}$/.test(id)))
      throw new Error("Invalid container identities");
    return result;
  }, []);
  const [containers, states, connectors] = await Promise.all([
    read(
      "container_resources",
      async () =>
        ids.length
          ? jsonLines(
              await runtime.docker(["stats", "--no-stream", "--format", "{{json .}}", ...ids], {
                timeout: 15_000,
              }),
            ).map((row) => ({
              service: servicePattern.test(row.Name) ? row.Name : "unknown",
              cpu: quantityPattern.test(row.CPUPerc) ? row.CPUPerc : null,
              memory: quantityPattern.test(row.MemUsage) ? row.MemUsage : null,
              memoryPercent: quantityPattern.test(row.MemPerc) ? row.MemPerc : null,
            }))
          : [],
      [],
    ),
    read(
      "container_state",
      async () =>
        ids.length
          ? jsonLines(
              await runtime.docker(
                [
                  "inspect",
                  "--format",
                  '{"name":{{json .Name}},"running":{{.State.Running}},"oomKilled":{{.State.OOMKilled}},"restartCount":{{.RestartCount}}}',
                  ...ids,
                ],
                { timeout: 15_000 },
              ),
            ).map((row) => ({
              service: servicePattern.test(row.name?.replace(/^\//, ""))
                ? row.name.replace(/^\//, "")
                : "unknown",
              running: row.running === true,
              oomKilled: row.oomKilled === true,
              restartCount: Number.isSafeInteger(row.restartCount) ? row.restartCount : null,
            }))
          : [],
      [],
    ),
    read(
      "connector_logs",
      async () =>
        summarizeConnectorLogs(
          await runtime.compose(
            ["logs", "--no-color", "--no-log-prefix", "--since", "24h", "--tail", "5000", "api"],
            { timeout: 15_000 },
          ),
        ),
      null,
    ),
  ]);
  return {
    observedAt: new Date().toISOString(),
    configuredRevision: runtime.config.revision,
    host: {
      totalMemoryBytes: totalmem(),
      freeMemoryBytes: freemem(),
      loadAverage: loadavg(),
      uptimeSeconds: uptime(),
    },
    containers,
    states,
    connectors,
    unavailable,
    scope:
      "Read-only snapshot. Configured revision does not prove the deployed revision. Host memory is not VM or container memory; no historical resource samples are implied.",
  };
}
