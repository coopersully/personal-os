# Actionable Production Alerting Design

**Status:** Approved

**Date:** 2026-08-10

## Problem

ilo's production alert channel pages on expected deployment behavior and sends a second email when
an alarm recovers. Between July 27 and August 8, CloudWatch published 95 messages to the operations
topic. The serial API deployment intentionally drains the only API task, so external health, target,
CPU, and memory alarms report the planned gap as an incident. CPU, memory, and target alarms also
treat absent metrics as breaching. Connector freshness is derived from the gap preceding a completed
sync, so a successful repair can itself raise an alarm.

The result is alert fatigue: the operator cannot distinguish a real unattended outage from a
planned deployment, a recovery, alarm creation, or a connector that just recovered.

## Goals

- Email only actionable transitions into an unhealthy state; recovery remains visible in CloudWatch.
- Preserve a page when an API deployment fails to restore public health.
- Keep raw diagnostic alarms and dashboard signals without duplicating pages.
- Measure current connector staleness continuously instead of measuring the historical gap reported
  by a successful sync.
- Keep connector telemetry aggregate and privacy bounded.
- Make production drift fail the deploy and hourly health preflights.

## Non-goals

- Removing the serial drain required by the current migration/lifecycle contract.
- Building a general incident-management or on-call platform.
- Adding account, email, mailbox, calendar, token, or provider-response dimensions to metrics.
- Suppressing app or MCP outages during an API deployment.
- Sending recovery email through a separate topic or digest in this change.

## Approaches considered

### Minimal noise reduction

Remove `ok_actions`, treat missing utilization data as non-breaching, and disable the broken
freshness alarm. This is small but still pages during every expected API drain and loses freshness
coverage.

### Deployment-aware actionable paging (selected)

Keep diagnostic alarms, add a bounded API-deployment heartbeat, and page through an API availability
composite that requires both public-health failure and no active deployment. Replace the completion
gap with a scheduler freshness observation. This retains real incident detection without expected
deployment pages.

### Dashboard-only operations

Disable email actions broadly and depend on GitHub health checks. This minimizes interruption but
delays detection between hourly checks and weakens independent AWS evidence.

## Design

### Notification policy

All human-facing CloudWatch alarms publish only through `alarm_actions`. `ok_actions` and
`insufficient_data_actions` are empty. Alarm creation and recovery therefore remain queryable in
CloudWatch history without emailing the operator.

The following raw alarms remain diagnostic and do not publish directly:

- API Route 53 public health;
- API unhealthy targets;
- aggregate ALB-generated 5xx responses.

App and MCP public-health alarms continue to page directly because an API deployment cannot explain
their failure. API/MCP CPU and memory alarms page only on real samples above threshold; absent samples
are non-breaching. Target 5xx, latency, RDS, NAT, CloudFront, connector failure, and connector
subscription alarms retain their existing actionable thresholds and alarm-only routes.

### Deployment heartbeat and API availability composite

The deployment script emits an aggregate `ilo/Deployments` metric named `ApiDeploymentInProgress`
with value `1` before it scales the API service to zero. A background heartbeat republishes `1` every
30 seconds while the serial drain and rollout are active. Cleanup stops the heartbeat and publishes
`0` on success and every handled failure path.

A metric alarm named `<environment>-api-deployment-in-progress` evaluates the heartbeat every minute,
treats missing data as non-breaching, and has no notification actions. A composite alarm named
`<environment>-api-availability-actionable` enters ALARM only when the raw API public-health alarm is
ALARM and the deployment heartbeat alarm is not ALARM. It is the sole human-facing API availability
page.

This is fail-open for incident detection. If the workflow runner dies and cleanup cannot publish
`0`, the heartbeat stops. Within one evaluation period the deployment alarm becomes OK; if public
health remains down, the composite pages. A successful rollout restores public health before the
heartbeat clears, so the composite never pages.

Deployment heartbeat failures before drain fail the release without touching the healthy service.
After drain begins, heartbeat publication failures enter the existing fail-closed recovery path and
restore human paging before the workflow exits.

### Current connector freshness

Each scheduled connector pass emits one structured `connector_sync_freshness_observed` event after
durable trigger and due-account processing. The event contains only:

- `event`;
- `freshnessAgeMs`;
- aggregate `eligibleAccountCount`;
- request/method/path/status timing fields already allowed by the request logger.

The observed age is the maximum current time since the last successful sync across non-local
Calendar/Mail accounts that are automatically recoverable. Accounts requiring user reconnection are
excluded because operations cannot repair their authority. For an eligible account with no success,
age begins at account creation. With no eligible accounts the scheduler emits zero age and zero
count.

The log metric filter consumes `connector_sync_freshness_observed`, not
`connector_sync_completed`. The alarm requires three breaching one-minute datapoints out of five at
or above ten minutes. The scheduler emits a datapoint every minute, so missing data means scheduler
observation itself is absent and is treated as breaching. This detects a stalled scheduler as well
as stale automatically managed accounts without leaking identity dimensions.

### Durable behavior and failure handling

The heartbeat does not change the deployment commit point: the API service drain remains the first
availability-changing mutation. The heartbeat must be proven active before that mutation.

Freshness observation is read-only and occurs after the scheduler's durable work. Failure to emit a
log line cannot corrupt connector state. Existing scheduled-task lifecycle handling still reports a
failed scheduler pass through the runtime background-task boundary.

## External boundary record

| Concern | Decision |
| --- | --- |
| Capability and owner | Integration owns CloudWatch/SNS routing and the deploy heartbeat; the API connector scheduler owns freshness observation. |
| Configuration and authority | The GitHub deployment role receives least-privileged `cloudwatch:PutMetricData` authority scoped by namespace condition. CloudWatch and SNS resources remain Terraform-owned. |
| Transport | Deployment uses the AWS CloudWatch API over HTTPS/TCP 443; application telemetry remains structured stdout collected by CloudWatch Logs. |
| Time and capacity | Heartbeat publishes every 30 seconds; alarm period is 60 seconds. Freshness emits once per one-minute scheduler pass. No per-account dimensions are created. |
| Commit point | Deployment heartbeat must be ALARM before desired count becomes zero. Connector sync persistence completes before freshness is observed. |
| Delivery semantics | Heartbeats and observations are duplicate-safe gauges. Missing heartbeat restores paging. Repeated freshness samples are aggregate and idempotent. |
| Degraded behavior | Pre-drain heartbeat failure aborts without outage. Post-drain failure uses existing recovery and restores paging. Missing freshness observations breach after the configured sustained window. |
| Recovery and observation | Raw alarms remain visible; the composite identifies actionable API downtime. CloudWatch history and hourly production health verify the deployed contract. |
| Evidence | Deterministic fake-AWS contract tests, deployment-drain scenarios, API integration tests, Terraform validation/plan, production observability preflight, and post-apply alarm inspection. |

## Testing

- Extend the operations contract to reject any human-facing `ok_actions` and to require non-breaching
  missing-data policy for utilization alarms.
- Extend deployment-drain fake-AWS scenarios to prove heartbeat-before-drain ordering, periodic
  heartbeat, cleanup, and runner-loss fail-open behavior.
- Add connector scheduler integration tests for fresh, stale, never-synced, reconnect-required, and
  empty eligible account sets.
- Update the production observability checker and its fake-AWS contract to require the new filter,
  sustained freshness alarm, empty recovery routes, deployment metric alarm, and availability
  composite.
- Run focused tests, `terraform validate`, provider-network/observability checks, then `pnpm verify`.

## Rollout and verification

1. Deploy application/deployment-script support and Terraform declarations together.
2. Review a production Terraform plan and reject unrelated drift.
3. Apply only the approved alerting/IAM/filter/alarm scope if the full plan contains unrelated
   changes.
4. Run the connector and alerting production preflights.
5. Verify all raw alarms, the deployment heartbeat alarm, and the API composite have exact routes and
   missing-data policies.
6. Perform a normal deployment smoke: the raw API health alarm may transition during drain, the
   deployment alarm must suppress the composite, and every public endpoint must be healthy afterward.
7. Confirm no SNS action executed for raw deployment health or an OK transition.

## Remaining risk

A deployment that loses both AWS metric publication and GitHub control before the heartbeat has been
proven never begins the drain. After drain, runner loss stops the heartbeat and restores paging. A
CloudWatch regional failure can still delay both suppression and paging; hourly GitHub health checks
remain an independent signal.
