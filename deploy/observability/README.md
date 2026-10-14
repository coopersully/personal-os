# Production observability

This optional Grafana Cloud collector targets the current Mac mini / dedicated Colima production
runtime. This directory is the collector template; its presence does not prove activation on a
particular host. Verify ingestion in the target stack after installation or configuration changes.
Existing AWS CloudWatch definitions do not prove monitoring of this runtime.

## What it covers

- Container CPU, working-set memory, memory limits, network traffic, disk I/O, OOMs and start time.
- API request status/duration and connector capability, sync, notification and subscription events.
- Public app, API readiness and MCP liveness probes every minute.
- An importable dashboard (`dashboard.json`) with selectable metrics and logs data sources.
- Local physical-host memory/load/uptime, container resource/restart/OOM state and the last bounded
  connector log window via `node deploy/mac-mini/cli.mjs diagnostics /absolute/private/config.json`.

The collector runs inside Linux: its resource samples cover containers and the VM, not physical
macOS memory. Local diagnostics are snapshots, not historical samples. Neither surface is a full
tracing/APM or user activity audit system. Application activity remains in nohmi's own database.

## Create and activate a free stack

1. Create a [Grafana Cloud Free account](https://grafana.com/products/cloud/) and one stack.
   No open-source sponsorship is needed. The [current free plan](https://grafana.com/pricing/)
   includes 10,000 active metric series, 50 GB logs/month and 14-day retention; recheck limits when
   activating. Set ingestion/usage alerts and stay on Free unless deliberately approving an upgrade.
2. In the stack's connection details, obtain its Prometheus remote-write URL/user and Loki push
   URL/user. Create a stack-scoped access-policy token with only `metrics:write` and `logs:write`.
   Save it directly to an owner-only file on the production Mac (mode 0600). Do not paste it into
   chat, Git, shell command arguments or a dashboard. Endpoints must be the stack's HTTPS endpoints.
3. Copy this directory to a persistent operator directory outside release checkouts on the production
   Mac. Put the four non-secret `GRAFANA_PROMETHEUS_URL`, `GRAFANA_PROMETHEUS_USER`,
   `GRAFANA_LOKI_URL`, `GRAFANA_LOKI_USER` values and `GRAFANA_TOKEN_FILE` (absolute path) in a
   private `grafana.env` file. Use the production operator account and the dedicated Docker socket.
4. Validate and start, substituting the absolute operator directory and socket below:

   ```sh
   export DOCKER_HOST=unix:///Users/nohmi-production/.colima/nohmi-production/docker.sock
   docker compose --env-file /absolute/operator/grafana.env -f /absolute/operator/compose.yaml config --quiet
   docker compose --env-file /absolute/operator/grafana.env -f /absolute/operator/compose.yaml up -d
   ```

   This is a separate `nohmi-observability` project; it does not replace the application Compose
   project or deployment controller. cAdvisor needs a privileged container and host mounts inside
   the dedicated VM. A read-only Docker socket mount still grants Docker API authority. Keep the
   collector isolated, its image pinned, and its HTTP server unpublished. Reserve 512 MiB/0.5 CPU
   and confirm the VM has headroom before activation. Outbound HTTPS to Grafana must work.
5. Import `dashboard.json`, selecting the stack's provisioned Prometheus and Loki sources. Confirm
   all expected services appear, recent request and connector records arrive, and a real manual sync
   produces its capability events. Check collector logs privately for remote-write errors. Seeing
   an empty dashboard or a healthy collector is **not** proof ingestion works.
6. Configure cloud-managed alerts and a contact point, then send a test alert. Suggested initial
   rules: public probe failure for 5 minutes; missing public/container samples for 5 minutes;
   container memory >85% of its nonzero limit for 10 minutes; any OOM; HTTP 5xx bursts; repeated
   `connector_capability_failed`; any new authorization/permission-missing failure (a blocked
   capability may not retry, so do not require repeat events); `connector_sync_freshness_observed`
   freshnessAgeMs >86400000.
   Set missing-data behavior explicitly to Alerting for availability. The probes originate inside
   production, so cloud-side missing-data alerts are essential when the entire host disappears.
   Alerts/contact points are not automatically provisioned by this package.

Rollback: use the same compose/env-file command with `stop`. Application syncing continues without
Grafana. Keep the Alloy volume across restarts for log positions and remote-write buffering; deleting
it can replay logs or lose queued telemetry. Revoke/rotate the stack token when decommissioning.

## Privacy, retention and verification

Only the `nohmi-production` project's container metrics and API log stream are collected. Metric
labels are a fixed allowlist, retaining container identity so replacements/replicas do not collide. Logs are reconstructed from approved enum/numeric fields; malformed
and unrecognized events are dropped. Emails, account IDs, URLs, tokens, original messages, provider
bodies and SQL are never intentionally exported. Log fields are not promoted to indexed labels.
Local Docker logs remain private and rotate independently; cloud retention does not preserve the
local raw logs. This intentionally limits forensic detail in the shared cloud dashboard.

Run `node deploy/observability/validate.mjs` with Docker available. It validates the pinned Alloy
configuration without network access and runs the **real** Loki pipeline against synthetic safe,
unknown, malformed and private-canary records. It creates and removes only its own test container;
no cloud credentials or production runtime are used. Re-run after changing the pipeline/image.

Production acceptance remains: stack/token setup, actual HTTPS ingestion, sustained resource samples,
real connector events, tested alert delivery, missing-data behavior and usage within the free cap.
Those are external boundaries; passing local tests does not establish them.

## External boundary record

| Boundary | Local evidence and remaining production evidence |
| --- | --- |
| Configuration | Pinned Alloy validates; stack endpoints and enabled production wiring still need setup. |
| Authority | Stack-scoped write token stored in an operator-only file; actual token permission is not tested locally. |
| Transport | Outbound HTTPS only, no collector port published; production DNS/TLS/egress must be exercised. |
| Time | One-minute samples, bounded probes, durable buffers and 14-day cloud retention; test ingestion lag. |
| Lifecycle | Separate Compose project and persistent Alloy volume; verify restart and host-reboot recovery. |
| Recovery | Collector can stop independently of nohmi; rotate tokens and retain buffers during repair. |
| Observation | Dashboard, privacy-tested logs and diagnostics; alert delivery requires cloud configuration. |
| Acceptance | Confirm real events, all services, resource history, missing-data alerts and Free usage after activation. |

## Transport incident diagnostics

Connector failures include `transportCode` and `transportPhase` when the exception contains a known
runtime code. Phases are `dns`, `tls`, `socket`, and `timeout`; codes include `ENOTFOUND`,
`EAI_AGAIN`, `CERT_HAS_EXPIRED`, `ERR_TLS_CERT_ALTNAME_INVALID`, `ECONNRESET`, `ECONNREFUSED`,
and the explicitly enumerated Node/Undici timeout codes. Native `TimeoutError` DOMExceptions from
HTTP abort signals and provider deadlines normalize to `ETIMEDOUT`; arbitrary names or exception
messages are not accepted as timeout evidence. Extraction follows at most 16 exception
nodes, including nested causes and aggregate errors, and emits the first recognized code. It does
not preserve the exception itself or infer a cause from its message. Unknown causes remain unknown.
These details do not change retry, reconnect, or authorization decisions.

Calendar/Mail sync events also include `syncSource=scheduled|triggered|manual`. This identifies the
invocation path; a completed capability event proves that capability succeeded on that invocation.
A trigger-driven success alone does not prove the scheduled fallback ran. A manual invocation can
also originate from a user-authorized agent operation.

Example Loki queries (select the incident's time window):

```logql
{job="nohmi-api"} | logfmt | provider="icloud" | event="connector_capability_failed"
{job="nohmi-api"} | logfmt | transportPhase="dns"
{job="nohmi-api"} | logfmt | syncSource="scheduled" | event="connector_capability_completed"
{job="nohmi-api"} | logfmt | provider="plaid" | code="plaid_authorization_failed"
```

Both Alloy and local diagnostics independently allowlist these fields. No hostname, IP, syscall,
URL, error message, stack, or provider body is exported, and none of the new fields becomes an
indexed label. Plaid's safe failure codes are retained alongside Google/iCloud codes. A stale Plaid
alert can indicate a connection awaiting owner reauthorization, including an older connection whose
replacement is healthy; inspect Finance connection status before treating it as an outage or
removing an account. Freshness observations are not themselves evidence of a transport failure.

To activate changes, deploy the application revision and update the operator's persistent
`config.alloy` from this directory, preserving its existing endpoints, secrets, log positions and
host metrics. Validate with the installed Alloy version, then restart only the observability
collector using its existing lifecycle. Older collectors silently omit the new fields. Verify
new `syncSource` fields on real scheduled successes in Explore; transport fields require an actual
recognized failure and must not be claimed verified just because a process restarted. Do not break
production connectivity to manufacture such a failure. The local real-pipeline test supplies
synthetic failure evidence without touching cloud credentials or provider data.
