---
name: personal-os-deploy-status
description: Check whether personal-os main is live and nohmi is healthy in production by correlating exact-main CI, the Mac production controller, and public app/API/MCP endpoints. Use for deploy progress, failure diagnosis, production health, release provenance, or live-version questions.
---

# nohmi deploy status

Prefer live evidence because deployment state changes quickly. This skill is read-only.

## Quick check

```bash
PYTHONDONTWRITEBYTECODE=1 python3 \
  <skill-dir>/scripts/check_deploy_status.py --pretty
```

The checker correlates:

- current default-branch SHA;
- its exact `push` run from the `CI` workflow;
- the read-only Mac continuous-controller status when run from an authorized production operator;
- app, API readiness, and MCP liveness endpoints.

## Interpret

- `live`: the controller reports main as deployed, exact-main push CI passed, and all public endpoints respond.
- `in_progress`: exact-main CI or a controller deployment of main is active; endpoints may still serve the prior release.
- `not_live`: healthy endpoints exist and exact-main CI passed, but the controller still reports an older revision.
- `ci_failed`: exact-main push CI failed, so the controller must not deploy it.
- `controller_blocked`: the local controller reports a blocked deployment transaction.
- `controller_locked`: an operation lock exists; it may be live or orphaned and requires owner
  inspection before another operation.
- `controller_retrying`: the controller records a recoverable idle/backoff error and will retry.
- `maintenance`: the local production maintenance marker is active.
- `healthy_revision_unknown`: public endpoints respond, but this host cannot read the private controller state.
- `unhealthy`: one or more public surfaces fail, regardless of workflow state.
- `unknown`: required evidence was unavailable or contradictory.

Public health proves availability, not the deployed revision. Only the private controller state can
prove which SHA is live; exact-main CI proves eligibility, not deployment. The checker never treats
a retained lock as proof of progress because owner liveness is not exposed by the installed
controller. A failed CI run does not prove production is down.

Read [references/deployment-runbook.md](references/deployment-runbook.md) for controller and CI
drilldown, failure handling, and safe next actions.

## Output

Report verdict, target and deployed SHA evidence, exact-main CI link, controller phase/maintenance
state, endpoint results, contradictions, and the next operational step. Never expose GitHub tokens,
controller configuration, task secrets, environment files, database URLs, or provider payloads.
