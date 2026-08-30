# Actionable Production Alerting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ilo page only on actionable, unplanned production failures while continuously detecting stale automatically managed connectors.

**Architecture:** Terraform retains raw diagnostic metric alarms but removes recovery email routes, adds a heartbeat-backed API-deployment alarm, and pages API availability through a composite alarm. The deployment script owns a bounded CloudWatch heartbeat around the serial drain. The API scheduler emits one privacy-bounded aggregate freshness observation per pass, which CloudWatch converts into a sustained current-staleness alarm.

**Tech Stack:** Terraform AWS provider, AWS CloudWatch/SNS/IAM, Bash deployment orchestration, TypeScript, Drizzle ORM, Vitest integration tests, deterministic fake-AWS Node contract tests.

## Global Constraints

- Human-facing CloudWatch alarms publish only through `alarm_actions`; recovery and insufficient-data transitions never email.
- API planned-deployment suppression is fail-open for paging when its heartbeat stops.
- Deployment heartbeat must be proven before the API desired count becomes zero.
- Connector freshness telemetry has no account, email, provider-resource, token, body, or provider-error dimensions.
- Reconnect-required accounts are excluded from operations freshness paging.
- A successful automatically managed connector is scheduled every five minutes; freshness pages only after three breaching one-minute datapoints out of five at ten minutes or more.
- `pnpm verify` is required before handoff.

---

### Task 1: Encode the alert-routing and deployment-suppression contract

**Files:**
- Modify: `scripts/check-connector-observability-contract.mjs`
- Modify: `.github/scripts/check-connector-observability.mjs`
- Modify: `scripts/check-deployment-drain-contract.mjs`
- Modify: `scripts/check-deployment-drain-scenarios.mjs`

**Interfaces:**
- Consumes: fake AWS CLI state already used by the observability and deployment scenario harnesses.
- Produces: deterministic contracts for empty `OKActions`, the `connector_sync_freshness_observed` metric filter, a 3/5 freshness alarm, deployment heartbeat ordering/cleanup, and API availability composite routing.

- [ ] **Step 1: Change the fake-AWS observability fixture to the desired contract**

Replace the completion-gap filter with:

```js
{
  filterName: "personal-os-prod-connector-sync-freshness-age",
  filterPattern:
    '{ $.event = "connector_sync_freshness_observed" && $.freshnessAgeMs = * }',
  metricTransformations: [{
    metricName: "ConnectorSyncFreshnessAgeMs",
    metricNamespace: "ilo/Connectors",
    metricValue: "$.freshnessAgeMs",
  }],
}
```

Require the operations SNS `AlarmActions` route on actionable metric alarms and `aws_cloudwatch_composite_alarm.api_availability_actionable`; diagnostic and implementation-only alarms require empty `AlarmActions`. Require `OKActions: []` and `InsufficientDataActions: []` on every validated alarm. Require the freshness alarm to use comparison `GreaterThanOrEqualToThreshold`, threshold `600000`, period `60`, evaluation periods `5`, datapoints to alarm `3`, and missing data `breaching` in both the fake-AWS contract and production preflight.

- [ ] **Step 2: Add deployment-heartbeat and composite assertions**

Require `.github/scripts/deploy-api.sh` to publish `ApiDeploymentInProgress=1` before the first `--desired-count 0`, maintain a 30-second heartbeat, and publish `0` from success and failure cleanup. Extend the fake AWS command handler so a healthy scenario records `cloudwatch put-metric-data` calls and asserts their order.

Validate the 5xx distinction explicitly: aggregate `HTTPCode_ELB_5XX_Count` (`aws_cloudwatch_metric_alarm.alb_5xx`) is diagnostic with actions disabled, while per-service `HTTPCode_Target_5XX_Count` (`aws_cloudwatch_metric_alarm.target_5xx`) retains its alarm-only operations route. Both have empty recovery and insufficient-data routes.

- [ ] **Step 3: Run the contracts and verify RED**

Run:

```bash
node scripts/check-connector-observability-contract.mjs
node scripts/check-deployment-drain-contract.mjs
node scripts/check-deployment-drain-scenarios.mjs
```

Expected: failures naming the old completion filter/recovery routes and missing deployment heartbeat.

- [ ] **Step 4: Commit the failing contracts**

```bash
git add scripts/check-connector-observability-contract.mjs \
  .github/scripts/check-connector-observability.mjs \
  scripts/check-deployment-drain-contract.mjs \
  scripts/check-deployment-drain-scenarios.mjs
git commit -m "test: define actionable production alerting"
```

### Task 2: Emit current connector freshness from the scheduler

**Files:**
- Modify: `apps/api/src/types.ts`
- Modify: `apps/api/src/connector-service.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/connector-service.integration.test.ts`
- Modify: `apps/api/src/app.integration.test.ts`

**Interfaces:**
- Produces: `ConnectorFreshnessObservation = { eligibleAccountCount: number; freshnessAgeMs: number }` from `observeSyncFreshness()` and the structured request-log event `connector_sync_freshness_observed`.
- Consumes: `calendar_accounts.created_at`, `last_synced_at`, `sync_recovery`, provider, and Calendar/Mail capability flags.

- [ ] **Step 1: Add failing connector-service integration cases**

Create eligible fresh, stale, and never-synced accounts plus a reconnect-required account. At a fixed `now`, assert:

```ts
await expect(service.observeSyncFreshness()).resolves.toEqual({
  eligibleAccountCount: 3,
  freshnessAgeMs: expectedMaximumAge,
});
```

Assert the reconnect-required and local accounts do not affect the count or maximum, and an empty eligible set returns both fields as zero.

- [ ] **Step 2: Add a failing app integration assertion**

Call `app.syncDueConnectors()` and require exactly one log entry matching:

```ts
expect.objectContaining({
  eligibleAccountCount: expect.any(Number),
  event: "connector_sync_freshness_observed",
  freshnessAgeMs: expect.any(Number),
  method: "SCHEDULER",
  path: "/internal/connectors/freshness",
  status: 200,
})
```

Assert serialized logs contain no fixture email, label, provider account ID, or credential canary.

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```bash
pnpm vitest run apps/api/src/connector-service.integration.test.ts apps/api/src/app.integration.test.ts
```

Expected: failures because `observeSyncFreshness` and the event type do not exist.

- [ ] **Step 4: Implement the smallest freshness query and log event**

Add `observeSyncFreshness()` beside `syncDueAccounts()`. Select only enabled non-local accounts whose recovery is null or not `reconnect`; compute each age from `lastSyncedAt ?? createdAt`, clamp at zero, and return the aggregate count/maximum. In `syncDueConnectors()`, call it after triggered and scheduled work and emit one safe log event with a fresh request ID.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the same Vitest command and expect all selected tests to pass.

- [ ] **Step 6: Commit scheduler telemetry**

```bash
git add apps/api/src/types.ts apps/api/src/connector-service.ts apps/api/src/app.ts \
  apps/api/src/connector-service.integration.test.ts apps/api/src/app.integration.test.ts
git commit -m "fix: observe current connector freshness"
```

### Task 3: Implement actionable CloudWatch alarm routing

**Files:**
- Modify: `infra/operations.tf`
- Modify: `infra/iam.tf`
- Modify: `infra/README.md`
- Modify: `.github/scripts/check-connector-observability.mjs`
- Modify: `scripts/check-connector-observability-contract.mjs`

**Interfaces:**
- Produces: metric alarm `<name>-api-deployment-in-progress`, composite alarm `<name>-api-availability-actionable`, and updated connector freshness filter/alarm.
- Consumes: namespace `ilo/Deployments`, metric `ApiDeploymentInProgress`, raw alarm `<name>-api-public-health`, and the existing operations SNS topic.

- [ ] **Step 1: Add Terraform declarations that satisfy the failing contract**

Add a no-action deployment metric alarm with period 60, evaluation periods 1, threshold 1, and `treat_missing_data = "notBreaching"`. Remove direct actions from raw API public health and API target-unhealthy alarms. Add an API availability composite with:

```hcl
alarm_rule = "ALARM(\"${aws_cloudwatch_metric_alarm.public_health[\"api\"].alarm_name}\") AND NOT ALARM(\"${aws_cloudwatch_metric_alarm.api_deployment_in_progress.alarm_name}\")"
alarm_actions = local.alarm_actions
```

Remove every `ok_actions` route. Change ECS CPU, ECS memory, and unhealthy-target missing-data handling to `notBreaching`. Update the connector freshness filter event and use 60-second periods with 3 of 5 datapoints and missing data breaching.

- [ ] **Step 2: Add least-privileged deploy metric authority**

Add `cloudwatch:PutMetricData` on `*` with a `StringEquals` condition for `cloudwatch:namespace = ilo/Deployments` to the GitHub deploy policy. Keep `DescribeAlarms` read authority unchanged.

- [ ] **Step 3: Update production preflight validation**

Teach `.github/scripts/check-connector-observability.mjs` to validate empty recovery routes and the new freshness alarm shape. Query/validate the deployment alarm and composite alarm, including exact rule and operations-topic route.

- [ ] **Step 4: Run focused infrastructure contracts**

Run:

```bash
terraform -chdir=infra fmt -check
terraform -chdir=infra validate
node scripts/check-connector-observability-contract.mjs
```

Expected: pass.

- [ ] **Step 5: Commit alarm infrastructure**

```bash
git add infra/operations.tf infra/iam.tf infra/README.md \
  .github/scripts/check-connector-observability.mjs \
  scripts/check-connector-observability-contract.mjs
git commit -m "fix: page only on actionable production alarms"
```

### Task 4: Implement the deployment heartbeat

**Files:**
- Modify: `.github/scripts/deploy-api.sh`
- Modify: `scripts/check-deployment-drain-contract.mjs`
- Modify: `scripts/check-deployment-drain-scenarios.mjs`
- Modify: `docs/deployment.md`

**Interfaces:**
- Produces: `start_api_deployment_heartbeat`, `stop_api_deployment_heartbeat`, and `publish_api_deployment_state <0|1>` shell functions.
- Consumes: `AWS_REGION`, `ECS_CLUSTER`, AWS CLI `cloudwatch put-metric-data`, existing cancellation and fail-closed traps.

- [ ] **Step 1: Implement heartbeat helpers**

Publish one aggregate metric datum with no dimensions. Before drain, publish `1`, launch a tracked background loop that republishes every 30 seconds, and prove the deployment alarm reaches ALARM with a bounded `cloudwatch wait alarm-exists`/`describe-alarms` poll before scaling to zero.

- [ ] **Step 2: Integrate cleanup into every exit path**

Stop and reap the heartbeat child, publish `0`, and verify the deployment alarm leaves ALARM. Cleanup must run from normal completion, `fail_closed_api_deployment`, and signal cancellation. Pre-drain publication/proof failure must abort before service or scaling mutation.

- [ ] **Step 3: Run deployment contracts and scenarios**

Run:

```bash
bash -n .github/scripts/deploy-api.sh
node scripts/check-deployment-drain-contract.mjs
node scripts/check-deployment-drain-scenarios.mjs
```

Expected: pass for success, pre-drain failure, post-drain failure, cancellation, and runner-loss simulations.

- [ ] **Step 4: Document deployment-aware paging**

Update `docs/deployment.md` to state the heartbeat ordering, fail-open expiry, composite alarm behavior, and operator evidence required after a serial drain.

- [ ] **Step 5: Commit deployment heartbeat**

```bash
git add .github/scripts/deploy-api.sh scripts/check-deployment-drain-contract.mjs \
  scripts/check-deployment-drain-scenarios.mjs docs/deployment.md
git commit -m "fix: suppress planned API drain pages"
```

### Task 5: Verify and release

**Files:**
- Modify if required by generated formatting only: files already listed above.

**Interfaces:**
- Consumes: the complete branch and production AWS read access.
- Produces: a reviewed pull request, exact Terraform plan, deployed release, and post-apply production evidence.

- [ ] **Step 1: Run focused checks together**

```bash
pnpm vitest run apps/api/src/connector-service.integration.test.ts apps/api/src/app.integration.test.ts
node scripts/check-connector-observability-contract.mjs
node scripts/check-deployment-drain-contract.mjs
node scripts/check-deployment-drain-scenarios.mjs
terraform -chdir=infra fmt -check
terraform -chdir=infra validate
```

- [ ] **Step 2: Run full verification**

```bash
pnpm verify
```

Expected: lint, typecheck, coverage, builds, and desktop/mobile E2E all pass without lowered thresholds.

- [ ] **Step 3: Review repository and Terraform diffs**

```bash
git diff origin/main...HEAD --check
git status --short
terraform -chdir=infra plan -out=actionable-alerting.tfplan
terraform -chdir=infra show -no-color actionable-alerting.tfplan
```

Reject unrelated resource changes. If unrelated drift exists, generate an exact targeted plan containing only the IAM policy, affected metric filters/alarms, deployment alarm, and composite alarm.

- [ ] **Step 4: Publish the reviewed PR through the normal workflow**

Use the repository `create-pr` skill, wait for required CI and review, and resolve actionable
feedback. Do not merge yet: the deployment preflight in this commit requires the backward-compatible
Terraform resources to exist first.

- [ ] **Step 5: Apply the reviewed production Terraform scope**

Apply the saved exact plan from the CI-green PR commit. Do not apply a newly generated or broader
plan. Record added/changed/destroyed counts. The filter, alarm, composite, route, and IAM changes are
backward-compatible with the currently deployed application and deployment script.

- [ ] **Step 6: Merge, deploy, and verify production**

Merge only after the production Terraform apply succeeds. Allow the immutable main deployment to run,
then execute:

```bash
ECS_CLUSTER=personal-os-prod node .github/scripts/check-connector-observability.mjs
PYTHONDONTWRITEBYTECODE=1 python3 \
  .agents/skills/ilo-deploy-status/scripts/check_deploy_status.py --pretty
```

Verify all public endpoints return 200; raw API health and deployment alarms are OK; the actionable composite is OK; connector freshness emits current one-minute samples; every notifying metric/composite alarm has empty recovery actions; and no SNS action executed for the planned drain or its recovery.
