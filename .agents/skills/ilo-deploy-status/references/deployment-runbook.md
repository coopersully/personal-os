# ilo deployment status runbook

## Evidence order

1. Public endpoints show current availability.
2. ECS service/task-definition state shows the running API and MCP release when AWS access exists.
3. The `production/ilo` commit status shows which commit the deploy workflow reported.
4. `Deploy hosted application` explains build, scan, migration, ECS, CloudFront, and health failures.
5. `Production health` and its incident issue show hourly external monitoring.

Do not equate a failed deployment with an outage; ECS circuit breakers can leave the previous
release healthy.

## GitHub drilldown

```bash
gh run list --workflow deploy.yml --limit 10
gh run view <run-id> --log-failed
gh run list --workflow production-health.yml --limit 10
gh api repos/coopersully/personal-os/commits/<sha>/status
```

The deploy workflow publishes immutable `sha-<commit>` API/MCP images, deploys the migration-capable
API serially, waits for stability, deploys MCP, publishes CloudFront assets, then verifies all public
surfaces.

## Public health

```bash
curl --fail --location https://app.ilo.coopersully.me
curl --fail https://api.ilo.coopersully.me/health/ready
curl --fail https://mcp.ilo.coopersully.me/health/live
```

API readiness includes PostgreSQL connectivity. MCP liveness proves the process responds; protocol
requests still require authorization.

## AWS drilldown

Use an authorized read-only profile and region `us-east-1`:

```bash
aws --profile <profile> --region us-east-1 ecs describe-services \
  --cluster personal-os-prod \
  --services personal-os-prod-api personal-os-prod-mcp
aws --profile <profile> --region us-east-1 ecs describe-task-definition \
  --task-definition <task-definition-arn>
```

Compare desired/running/pending counts, deployment `rolloutState`, task definition, and container
image. Do not read task-definition secret values, SSM parameters, RDS credentials, or application
payloads.

## Incidents and next actions

- Failed CI: fix CI; production was not attempted.
- Image scan failure: inspect the failed job and dependency/image findings.
- API rollout failure: inspect ECS events and API logs; preserve one migration-capable replica.
- MCP rollout failure: verify API health first, then MCP task events/logs.
- Web publish/invalidation failure: inspect S3/CloudFront job output; APIs may still be healthy.
- Endpoint failure with green deploy: inspect health workflow, ECS target health, CloudWatch alarms,
  and the deduplicated GitHub incident.
- Main ahead of deployed SHA: wait for/run the normal workflow; do not manually retag mutable images.

Production mutations, workflow reruns, rollback, task scaling, or incident closure require explicit
user authorization and the relevant operational procedure.
