---
name: ilo-deploy-status
description: Check whether ilo main is live and healthy in production by correlating GitHub CI/deploy runs, production commit status, health workflow, incident issues, and public app/API/MCP endpoints, with optional manual AWS ECS drilldown. Use for deploy progress, failure diagnosis, production health, release provenance, or live-version questions.
---

# ilo deploy status

Prefer live evidence because deployment state changes quickly. This skill is read-only.

## Quick check

```bash
PYTHONDONTWRITEBYTECODE=1 python3 \
  <skill-dir>/scripts/check_deploy_status.py --pretty
```

The checker correlates:

- current default-branch SHA;
- latest `Deploy hosted application` run and `production/ilo` commit status;
- latest `Production health` run;
- open deployment/health incident issues;
- app, API readiness, and MCP liveness endpoints.

## Interpret

- `live`: main has a successful `production/ilo` status and all public endpoints respond.
- `in_progress`: the main deployment is queued/running; endpoints may still serve the prior release.
- `not_live`: healthy endpoints exist, but the successful deployed SHA trails main.
- `deploy_failed`: the latest main deployment failed; the previous release may remain healthy.
- `unhealthy`: one or more public surfaces fail, regardless of workflow state.
- `unknown`: required evidence was unavailable or contradictory.

Treat running ECS task-definition images and healthy public endpoints as runtime truth. Treat
GitHub workflow/status as release provenance. A failed deployment does not prove production is down.

Read [references/deployment-runbook.md](references/deployment-runbook.md) for drilldown, AWS commands,
incident handling, and safe next actions.

## Output

Report verdict, target and deployed SHA evidence, workflow and incident links, endpoint results,
optional manual ECS findings, contradictions, and the next operational step. Never expose GitHub/AWS
tokens, task secrets, SSM values, database URLs, or raw provider payloads.
