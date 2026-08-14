# Local Production Runtime Design

**Date:** 2026-08-14
**Status:** Approved by explicit user direction

## Goal

Run the API, MCP server, and web application from any registered ilo worktree while connecting the
local API directly to the live production PostgreSQL database. The local product must retain normal
read, write, authentication, MCP, connector, and provider behavior.

This is an operator development mode, not a test environment. Actions taken through it are real
production actions.

## Chosen approach

Use a dedicated EC2 tunnel host managed by AWS Systems Manager Session Manager. The host has no SSH
key and no inbound security-group rules. It can reach only production PostgreSQL, DNS, and the HTTPS
services needed by SSM. The production database remains private and receives one additional ingress
rule from the tunnel host's security group.

The alternatives are rejected:

- Making RDS public would expand the database attack surface and still require brittle source-IP
  rules.
- A client VPN would add certificate lifecycle and materially higher fixed cost for one operator.
- A production-derived clone would not satisfy the requirement to operate on live production state.

## Operator authority

Terraform creates a dedicated local-production-runtime IAM role. The role can:

- discover, start, and stop only the tagged tunnel instance;
- start, resume, and terminate Session Manager sessions only for that instance;
- read only the exact ilo runtime parameters under `/personal-os/prod`;
- decrypt those parameters through Parameter Store; and
- inspect the production RDS instance needed to validate the target.

The local command assumes this role. Long-lived production values are never printed, written to an
environment file, placed in command arguments, or committed. The currently configured root identity
is only an assumption source; runtime AWS and SSM operations use the scoped role session.

## Runtime interface

Add these package commands:

```text
pnpm env:prod:start
pnpm env:prod:stop
pnpm env:prod:status
```

`env:prod:start` requires the exact acknowledgement
`ILO_PRODUCTION_RUNTIME=I_UNDERSTAND_THIS_IS_PRODUCTION`. It then:

1. verifies the worktree's stable runtime tier and loopback ports;
2. assumes the scoped AWS role and validates the live RDS identifier, private state, endpoint, and
   tunnel instance tags;
3. starts the tunnel instance when necessary and waits for SSM online state;
4. starts an SSM port-forwarding session from the worktree's local PostgreSQL port to production RDS;
5. reads the production runtime parameters into process memory and rewrites only the database URL
   host and port to the local tunnel;
6. starts the current worktree API, MCP server, and web app on the worktree's normal local ports; and
7. supervises the source processes and tunnel as one attached lifecycle.

The local API uses `NODE_ENV=development` so localhost sessions and HTTP work. Production connector,
encryption, MCP-internal, mail, Plaid, and X values are supplied when configured. Local URLs override
the production app/API/MCP origins. Provider webhooks continue arriving at the hosted production API
and updating the same database. Manual provider operations initiated locally use production account
credentials and have real external effects.

Database migrations remain enabled because the requirement is for the current worktree to work as
the product, including branches whose API contract requires a migration. Starting this mode can
therefore migrate production. The acknowledgement and attached lifecycle make that consequence
explicit; this command is never invoked by setup, normal Start, tests, CI, or verification.

`env:prod:stop` stops only processes whose ownership metadata identifies the current worktree,
terminates its Session Manager session, and optionally stops the shared tunnel instance when no
other tagged local production sessions remain. It never stops hosted API or MCP tasks.

## Worktree isolation

Every worktree keeps its assigned API, MCP, web, and PostgreSQL-forward port. Multiple worktrees can
connect concurrently through separate SSM sessions. Each local runtime owns only its PIDs and session
metadata under ignored `.codex/run/`; a worktree cannot stop another worktree's processes or session.

Normal `pnpm env:start` remains unchanged and always uses that worktree's Docker PostgreSQL instance.
Production mode never starts, imports into, or replaces the Docker database.

## Failure handling

The command fails before starting source services when:

- the acknowledgement is absent;
- AWS identity assumption fails;
- the resolved RDS instance is not `personal-os-prod-postgres`, is public, or is unavailable;
- the tunnel instance or security groups do not match their production tags;
- SSM does not report the instance online;
- a required runtime parameter is missing;
- the tunnel exits or PostgreSQL cannot be reached; or
- any local port belongs to an unowned process.

If a source service or tunnel exits after startup, the supervisor stops the other locally owned
processes and leaves hosted production services untouched. Secret-bearing JSON and database URLs are
redacted from all logs and errors.

## External-boundary record

| Concern | Contract |
| --- | --- |
| Capability and owner | The local API owns product behavior; the lifecycle script owns the worktree-to-production transport. |
| Configuration and authority | A scoped assumed role reads exact SSM parameters and opens a session to one tagged tunnel instance. Database authority remains the existing production application role in `DATABASE_URL`. |
| Transport | Loopback PostgreSQL → SSM encrypted session → no-ingress EC2 host → private RDS TCP 5432. The rewritten URL uses the pinned RDS CA with `sslmode=verify-ca`; SSM target validation replaces hostname verification after the connection host becomes loopback. |
| Time and capacity | Instance readiness and SSM registration are bounded; tunnel and service readiness have explicit timeouts; each worktree uses one PostgreSQL forward. |
| Commit point | Database and provider mutations use existing product commit points. Starting the tunnel creates no application data. |
| Delivery semantics | The local API is an additional production writer and scheduler; existing database claims, optimistic concurrency, audit records, and connector reconciliation remain authoritative. |
| Degraded behavior | Startup fails closed before the UI is advertised; a lost tunnel tears down the local runtime. Hosted production remains independent. |
| Recovery and observation | Local PID/session metadata supports targeted cleanup; CloudTrail records role assumption, instance lifecycle, parameter reads, and SSM sessions; application audit and provider observations remain unchanged. |
| Evidence | Script behavior tests use fake AWS/SSM commands; Terraform validation covers infrastructure; a live smoke test proves role assumption, SSM reachability, database readiness, API/MCP/web health, and an authenticated read plus reversible write. |

## Testing and rollout

- Add lifecycle tests proving acknowledgement, target validation, secret redaction, worktree port
  isolation, tunnel loss cleanup, and normal-local-mode separation.
- Run shell syntax checks, focused lifecycle tests, Terraform formatting and validation, then
  `pnpm verify`.
- Apply the reviewed Terraform plan with a named non-root production administrator identity.
- Stop the tunnel instance after provisioning.
- Run one live production-mode smoke test from this worktree. Verify login, an MCP read, a reversible
  local product mutation and reversal, connector inspection, and audit evidence.
- Record the remaining production risks: branch migrations and duplicate scheduled work can still
  cause live impact despite green tests. Those behaviors are included because full product behavior
  was explicitly required.
