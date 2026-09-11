# nohmi deployment status runbook

## Evidence order

1. Public endpoints show current availability.
2. The private continuous-controller status shows the deployed revision, phase, candidate,
   maintenance marker, operation lock, and sanitized failure state.
3. The exact-main `push` run of `.github/workflows/ci.yml` shows whether that SHA is eligible for the
   controller to deploy.

Do not equate failed CI or a controller error with an outage; the previous release may remain
healthy. Conversely, green CI does not prove that the controller deployed its SHA.

## GitHub drilldown

```bash
gh run list --workflow ci.yml --branch main --event push --limit 20
gh run view <run-id> --log-failed
```

The Mac controller accepts only a successful exact-SHA `push` run on `main`. Pull-request CI,
workflow runs for another SHA, and successful historical runs do not make current main eligible.

## Controller drilldown

On the production Mac, use only the read-only status action:

```bash
sudo -n -H -u nohmi-production node \
  /Users/nohmi-production/controller/deploy/mac-mini/continuous-cli.mjs \
  status /Users/nohmi-production/nohmi-production/config.json
```

`deployed` is the live revision claim. `candidate` and `phase` describe an active or failed
transaction; `maintenance` and `locked` must be interpreted before any recovery. The checker returns
`healthy_revision_unknown` off-host because public endpoints and GitHub cannot prove the private
deployed SHA.

## Public health

```bash
curl --fail --location https://nohmi.coopersully.me
curl --fail https://nohmi-api.coopersully.me/health/ready
curl --fail https://nohmi-mcp.coopersully.me/health/live
```

API readiness includes PostgreSQL connectivity. MCP liveness proves the process responds; protocol
requests still require authorization.

## Failure states and next actions

- Failed exact-main CI: fix CI; the controller correctly refuses the candidate.
- Healthy endpoints with unknown revision: run the checker on the production Mac before claiming main
  is live.
- Controller building or switching: wait and re-read status; do not start a second deployment.
- Maintenance active: preserve it until the operator intentionally completes maintenance.
- Controller blocked or locked: preserve state, inspect the recorded phase and owned processes, and
  follow `deploy/mac-mini/continuous.md`; never clear state or a lock to force a retry.
- Endpoint failure: inspect controller status and the dedicated Colima/Compose/tunnel services on the
  production Mac before changing anything.
- Main ahead of deployed SHA after successful CI: wait for the normal five-minute poll/backoff cycle,
  then inspect controller status if it remains behind.

Controller `once`, restart, maintenance changes, lock/state changes, rollback, and configuration or
gateway edits are production mutations requiring explicit user authorization and the relevant
operational procedure.
