# Deployment

## Required configuration

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection URL |
| `EMAIL_FROM` | Verified transactional sender, for example `ilo <noreply@example.com>` |
| `APP_BASE_URL` | Canonical browser application URL and OAuth return destination |
| `API_BASE_URL` | Canonical API URL advertised by OpenAPI |
| `API_SHUTDOWN_TIMEOUT_MS` | Bounded API quiesce budget in milliseconds; production uses `105000` inside ECS `stopTimeout = 120` |
| `ALLOWED_ORIGINS` | Comma-separated browser and Tauri origins |
| `APP_ENCRYPTION_KEY` | Base64-encoded 32-byte key for OAuth credentials |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID; required in production and injected from Parameter Store |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret; required in production and injected from Parameter Store |
| `GOOGLE_REDIRECT_URI` | Exact registered Google OAuth callback |
| `RESEND_API_KEY` | Resend API key used only for account verification and password recovery email |
| `AUTH_RATE_LIMIT_MAX_REQUESTS` | Maximum register/login/recovery attempts per source and endpoint window (default: `20`) |
| `AUTH_RATE_LIMIT_WINDOW_SECONDS` | Auth request rate-limit window in seconds (default: `300`) |
| `TRUST_PROXY` | Set only behind a trusted reverse proxy so forwarded client IPs can be used safely |
| `MCP_ALLOWED_ORIGINS` | Optional comma-separated browser origins for the public MCP endpoint; leave blank for native/agent clients |
| `MCP_RATE_LIMIT_MAX_REQUESTS` | Maximum MCP requests per bearer token and source window (default: `120`) |
| `MCP_RATE_LIMIT_WINDOW_SECONDS` | MCP request rate-limit window in seconds (default: `60`) |
| `MCP_TRUST_PROXY` | Set only when the MCP endpoint sits behind your trusted reverse proxy |
| `MCP_PUBLIC_URL` | Canonical public MCP origin, for example `https://mcp.example.com` |
| `MCP_RESOURCE_URL` | Canonical MCP resource URI, normally `https://mcp.example.com/mcp` |
| `MCP_INTERNAL_SECRET` | Random 32+ character secret shared only by the API and MCP containers |
| `AGENT_SKILL_SOURCE_URL` | Optional public source override for the Ilo setup compatibility reference. Blank derives the versioned website URL from `APP_BASE_URL`; an override must contain the configured immutable revision. |
| `AGENT_SKILL_VERSION` | Semantic version advertised for the exact optional setup reference |
| `AGENT_SKILL_REVISION` | Immutable source identifier embedded in `AGENT_SKILL_SOURCE_URL`, such as a Git commit or release digest |
| `REGISTRATION_MODE` | Must be `invite` in production; the API refuses to boot in open mode |
| `OWNER_EMAILS` | Comma-separated email addresses allowed to issue invitations |
| `X_CLIENT_ID` | X OAuth 2.0 client ID |
| `X_CLIENT_SECRET` | X OAuth confidential-client secret (if configured) |
| `X_REDIRECT_URI` | Exact registered X OAuth callback |

Generate the encryption key outside the repository and store it in the deployment platform's secret manager. Rotating it requires reauthorizing currently connected accounts.

Hosted deployments should set both `EMAIL_FROM` and `RESEND_API_KEY`. Without them, development safely suppresses transactional email, but users cannot complete email verification or recover a password.

Production also refuses to start without both Google OAuth values. Store them under the configured
SSM prefix as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`; ECS injects both through task-definition
secret references. Do not duplicate the client ID in Terraform variables or task environment
values. Verify the references without printing either value:

```bash
aws ecs describe-task-definition --task-definition personal-os-prod-api \
  --query 'taskDefinition.containerDefinitions[].secrets[?name==`GOOGLE_CLIENT_ID` || name==`GOOGLE_CLIENT_SECRET`].[name,valueFrom]'
```

Production requires invite-only sign-up and refuses to start in open mode or
without at least one `OWNER_EMAILS` address. An owner signs in, opens Settings →
Invitations, creates a one-time code (optionally bound to a friend's email), and
shares the code privately. Codes are hashed at rest, expire after 14 days by
default, and cannot be reused.

The application has an in-process authentication rate-limit backstop. Configure an equivalent shared rate limit at the public edge before running more than one API replica. Never expose PostgreSQL or container-only ports; place the API behind the same authenticated HTTPS edge used by the web app.

## External dependency readiness

Runtime configuration is necessary but not sufficient evidence that an external capability works.
Boot validation can prove that a value exists and has the expected shape; it cannot prove that the
credential is current, has the required scope or role, names the intended resource, has a
registered callback, or is reachable from the deployed task.

Before enabling a new or changed external capability in production, use the boundary record in
[`engineering/external-boundary-reliability.md`](engineering/external-boundary-reliability.md) and
verify:

1. the intended environment receives the correct secret and non-secret configuration without
   exposing either value;
2. provider consent, scopes, roles, callback/webhook registration, and resource policies authorize
   the exact operation;
3. DNS, TLS, proxy, protocol, ingress, egress, and port rules permit the path from the deployed
   runtime;
4. caller deadlines, downstream timeouts, retries, pagination, payloads, concurrency, and rate
   limits have a bounded end-to-end budget;
5. partial success, process loss, duplicate delivery, stale work, rollback, and manual repair leave
   durable, observable state; and
6. a least-privileged, non-destructive production smoke proves the capability after deployment,
   with a request or operation identifier that can be correlated in redacted logs.

Record “configured,” “authorized,” “reachable,” and “verified” separately in deployment evidence.
Never claim all integrations are healthy from secret inventory or process health alone.

## Images

The root Dockerfile has `api`, `mcp`, and `web` targets. The API image runs migrations before accepting traffic, runs as an unprivileged user, and exposes liveness/readiness endpoints. The web target uses unprivileged Nginx with immutable asset caching and SPA fallback.
The MCP image binds to all container interfaces, requires an ilo bearer token for every protocol request, and exposes only an unauthenticated liveness endpoint. The endpoint is meant to be public: terminate TLS at the edge, rate-limit it there, and keep bearer tokens out of query strings and logs. Browser-originated MCP requests can be restricted with `MCP_ALLOWED_ORIGINS`; native and agent clients do not send an Origin header and remain supported.

## MCP OAuth

The public MCP endpoint publishes protected-resource metadata and directs clients to ilo's OAuth authorization server. A person signs in to ilo once and consents to the MCP client; Google, iCloud, and other connected services remain internal to that ilo account. The consent screen names the registered client and translates every requested scope into a user-facing permission. OAuth clients use dynamic registration, exact redirect-URI matching, S256 PKCE, five-minute one-time authorization codes, one-hour MCP audience-bound access tokens, and rotating refresh tokens. Do not reuse `MCP_INTERNAL_SECRET` outside the API and MCP containers, and use distinct values per environment.

The authenticated connection-guide API derives its MCP URL from
`MCP_RESOURCE_URL` and its optional skill-reference link from
`APP_BASE_URL` plus the checked release path when `AGENT_SKILL_SOURCE_URL` is
blank. It publishes `AGENT_SKILL_VERSION` and `AGENT_SKILL_REVISION` beside that
link and refuses an override that does not contain its revision. The web build
copies the repository-owned skill tree to
`/skills/ilo-setup/v0.2.0/`, with `SKILL.md` as the advertised entrypoint. A
self-contained release path is served read-only and cached as immutable by the
production web edge; publishing changed bytes requires a new release path. A
self-hosted deployment may publish its own public, immutable artifact URL and
matching version/revision as one release unit. Keep the app, MCP, and optional
skill override aligned with the deployed environment so Settings never teaches
a host to use a staging, local, or changing endpoint.

The checked release identity lives in
`packages/domain/src/ilo-setup-release.json`. Runtime defaults read that
manifest, and `pnpm lint` fails if `.env.example` or Compose advertises a
different tuple. Change the manifest and both deployment projections together
for every release.

### Upgrade from an earlier official release

Older local installs may retain either former authoritative GitHub URL in
`.env`: the mutable `main` directory, the first commit-pinned directory, or the
Ilo-hosted v0.1.0 path. Setup and Start recognize only those exact legacy
official values or a blank derived source paired with known legacy metadata.
They remove the override and write the current manifest version/revision so the
URL follows the environment's canonical `APP_BASE_URL`. The migration is
idempotent. The API applies the same narrow compatibility normalization so a
container or production process that does not use the Codex lifecycle can boot
during rollout.

Custom URLs, including custom URLs ending in `/main` or `/latest`, are never
rewritten as an Ilo release. Deployments with a custom source must set all three
values to a matching immutable tuple; invalid or incomplete custom
configuration continues to fail startup. A legacy official URL paired with
explicit, conflicting version metadata is also preserved for validation rather
than silently overwritten.

### Optional setup-reference distribution boundary

Ilo setup is driven by the authenticated `get_ilo_setup` MCP tool. The hosted
skill is an optional compatibility reference, not a prerequisite or completion
signal. Ilo publishes its configured artifact identity but does not fetch or
install it. A host may read the versioned website tree over public HTTPS without
an Ilo credential. A denied, unreachable, rate-limited, or malformed reference
must not block a host that can call `get_ilo_setup`; it cannot grant more Ilo
scope or activate a profile or rule. The host owns its download timeout, cache,
and installation error, while the deployment owner repairs the published
artifact or advances to a new immutable release.

Configuration validation proves that the guide names a source, semantic
version, and revision and that the URL embeds the revision. For the official
release, the versioned website path is an append-only release artifact copied
from the repository skill tree during the web build. A server can still return
different bytes at a version-looking URL, so local tests and API readiness do
not prove immutability, public reachability, or compatible-host installation.
Release evidence must separately record an HTTPS fetch from outside the runtime
and one least-privileged `get_ilo_setup` invocation in a supported host. A skill
install smoke is useful compatibility evidence, but it is not required setup
evidence.

Build with the public API address compiled into the PWA:

```bash
docker build --target web --build-arg VITE_API_BASE_URL=https://api.example.com -t personal-os-web .
docker build --target api -t personal-os-api .
docker build --target mcp -t personal-os-mcp .
```

Run only one migration-capable API instance during a breaking schema rollout.
The stop-and-drain workflow is not itself the bootstrap for this contract. A
prior non-migrating rollout must already have placed every live API task on a
task definition with a 120-second essential-container stop timeout and a binary
whose readiness response carries the hard-coded
`X-Ilo-Drain-Protocol: quiesce-v1` header. Before any scaling mutation,
deployment describes the exact primary task definition and every running task
and proves that their task definition and image agree, every API container has
the same nonempty immutable image digest, and the task definition contains
exactly one `API_SHUTDOWN_TIMEOUT_MS=105000` entry alongside the 120-second stop
timeout. It then calls the live `/health/ready` endpoint and requires that exact
protocol header.
Legacy or mixed task sets fail before drain; lifecycle readiness must be shipped
and verified separately before a migration-required release can use this path.

After that gate, the production workflow scales the API service to zero and waits for the
current tasks to stop before starting the new migration-capable task. It suspends ECS
dynamic and scheduled scaling before the drain and records the exact old task
ARNs. On `SIGTERM`, the API stops accepting new HTTP and detached/background
claims, awaits in-flight requests and tracked provider work, closes its HTTP
server, and only then closes PostgreSQL. The application bound is 105 seconds
and covers database closure; a tracked request/background rejection fails the
drain instead of being treated as idle. The essential ECS API container has a
120-second stop timeout. Deployment reconciles running, pending, already-stopping,
and replacement tasks observed across the transition. ECS desired status uses
only `RUNNING`/`STOPPED`, so the `RUNNING` inventory also contains tasks whose
last status is still `PENDING`; a mismatch with service counts fails closed.
The recent STOPPED baseline is capped at 100 before mutation. Only entries
described with complete STOPPED evidence in that initial snapshot are historical;
incomplete or later observations remain in the drain proof without relying on
cross-system clock comparisons. Post-drain STOPPED inventories reconcile across
a bounded window slightly longer than five minutes and must converge before the
exact at-most-100 task set is accepted. Desired/running/pending service counts must all
reach zero, every exact task is waited to `STOPPED`, and every API container
must report exit code zero with no kill/timeout evidence. Count-only drain or a
fixed sleep is insufficient. This bound follows AWS's
[ECS API eventual-consistency guidance](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_RunTask.html),
which recommends repeated `DescribeTasks` calls with exponential backoff that
grows to about five minutes.

After the old tasks exit successfully, the workflow disables circuit-breaker
rollback before launching the migration-capable task so ECS cannot restore a
pre-migration binary. Rollback remains disabled until the new service is stable
as the sole completed primary deployment on the exact registered task
definition; only then does the workflow restore and verify the declared
rollback-enabled configuration and the scalable target's exact pre-drain
suspension state. Suspension attempt and service-drain attempt are separate
phases: failure before desired-count zero restores the prior scaling state and
preserves the healthy old service; once zeroing may have committed, errors
re-suspend and stop at zero. Every AWS operation after suspension begins, plus
reconciliation delays, runs as an interruptible child process so delivered
cancellation signals can stop the child, then use single-attempt, tightly bounded
re-suspend/zero mutations within the runner grace window.
An abrupt runner/host loss that cannot deliver cleanup signals remains an
external control-plane recovery case. The workflow stores the pre-drain desired
count, exact suspension state, and a bounded set of failed post-drain task
definition ARNs in the immutable release task definition. Zero/all-suspended is
not sufficient recovery authority because it can be an intentional operator
stop and successful definitions retain stale metadata. A handled post-drain
failure therefore registers a separate immutable recovery-marker task-definition
revision tied to the failed release. If marker persistence cannot be verified,
the service remains stopped and deployment reports that operator recovery is
required. A later run requires and consumes that marker, inherits the persisted
intent, and appends the marker's failed release task definition before
registering the retry. Fallible sibling registration runs before API
registration, and the recovery candidate deliberately retains the marker and a
one-run authorization until deployment succeeds. This means a runner or sibling
failure after candidate registration cannot erase recovery authority. After the
exact recovered primary is healthy, rollback and intended capacity are
restored, deployment registers and verifies a marker-cleared normal-metadata
revision before autoscaling resumes. Cleanup failure stops the service and
publishes a new marker. Normal registration resets authorization and history.
Recovery treats its already-proven zero/all-suspended control-plane state as
read-only until the corrected API task is launched. It must not call
`RegisterScalableTarget` again at that boundary: Application Auto Scaling can
enforce the target's minimum capacity even when the same request asks to suspend
all scaling, which would restart the failed primary. It also verifies direct
`desired/running/pending = 0/0/0` counts instead of waiting for generic ECS
service stability; ECS deliberately retains the failed deployment record, so
the generic waiter cannot converge while the service is correctly stopped.
The unique history is
capped at 100 entries. During retry, only stopped tasks on those exact
post-drain definitions are treated as failed rollout evidence; every other
recent stopped task must still pass the old-binary exit-zero/no-kill proof.
Rollback stays disabled until the exact new primary is healthy. Only a successful retry
starts one migration-capable task, proves it as the exact healthy primary,
restores rollback configuration, then scales to the recorded desired count
before restoring the exact suspension state. This keeps migrations serial even
when intended steady-state capacity is greater than one. Missing or malformed
recovery intent fails without starting a task. Operators must still verify
zero/suspended state after an abrupt runner loss; because an unhandled host loss
cannot persist the marker, that path remains manual and cannot auto-restart.
This bounded
downtime is required for migrations that invalidate connector source authority:
an old process already inside provider I/O cannot honor a fence introduced by
the new schema. Drizzle records applied versions transactionally. Follow the
[database migration policy](engineering/database-migrations.md): published
migrations are append-only, and live-data changes use an expand–migrate–contract
rollout rather than a long deploy-time backfill.

Before merging any change that requires this stop-and-drain path, the deploy role
must already have verified `application-autoscaling:RegisterScalableTarget`
authority scoped to the API scalable target, ECS service namespace, and
`ecs:service:DesiredCount` dimension. It must also have `ecs:ListTasks` on `*`,
which AWS requires for enumerating the exact service task ARNs later inspected
with the existing `ecs:DescribeTasks` authority; the declared wildcard statement
is constrained to the production cluster with `ArnEquals ecs:cluster`. Keep that
list action isolated from ECS mutation permissions. The application workflow cannot grant either
prerequisite to its own execution role. The role must additionally have isolated
`application-autoscaling:DescribeScalableTargets` authority on `*` because AWS
does not expose resource-level scoping for that read; workflow filters require
namespace `ecs`, the exact API resource ID, and `ecs:service:DesiredCount`.
Without all three declarations applied and verified, deployment must fail before
drain or migration. The lifecycle-marker bootstrap is an independent deployed
prerequisite, not evidence supplied by the migration release being launched.

## API quiesce prerequisite and drain gate

The API runtime has a versioned `quiesce-v1` shutdown contract. On `SIGTERM` it stops scheduler and
request admission, aborts connector discovery and pagination, waits for accepted HTTP/background
work to settle, and closes PostgreSQL only after the tracked work and HTTP server have drained.
Google HTTP calls retain their 15-second per-request timeout and also receive the quiesce signal.
iCloud CalDAV receives the same signal through its HTTP transport, while iCloud IMAP closes its
live socket on abort. An interrupted account sync returns durably to retryable `idle` state with an
explicit retry marker while preserving, but never advancing, its prior successful-sync timestamp,
so the replacement runtime can reconcile it immediately. Provider network I/O never occurs inside
a database transaction.

Deploy this contract as an independent prerequisite before introducing any workflow that suspends
scaling or drains all API tasks:

1. Merge and deploy the schema-free quiesce binary through the existing ECS rolling update. This
   first deployment must not change the rollout to a serial drain and must not include a migration.
2. Have an authorized operator apply the reviewed infrastructure so ECS registers an API task
   definition whose `api` container has `stopTimeout = 120` and
   `API_SHUTDOWN_TIMEOUT_MS = 105000`. Terraform ignores the service's live task-definition
   pointer, so registration alone does not prove any running task uses that revision.
3. Manually dispatch `Deploy hosted application` with the prerequisite commit as `release_sha`.
   The workflow reuses that exact immutable image pair and registers a task definition combining
   the API image with the shutdown settings. Wait for the rolling service update to complete and
   prove the active tasks actually use that task definition and image digest.
4. Confirm `GET /health/ready` returns
   `X-Ilo-Drain-Protocol: quiesce-v1`. Liveness, a healthy target, a present environment variable,
   or an ECS task-definition plan is not a substitute for this running-binary marker.

A later serial-drain rollout must fail before suspending scaling unless all of the following
production evidence is captured from fresh AWS/API reads:

- the latest API task definition passes the runtime-configuration preflight: both Google credentials
  are unique SSM-backed ECS secret references and no plain `GOOGLE_CLIENT_ID` entry exists;
- `describe-services` reports exactly one deployment, with `status = PRIMARY`,
  `rolloutState = COMPLETED`, and the expected task-definition ARN;
- `list-tasks` followed by `describe-tasks` enumerates every exact active API task, and every task
  uses that task definition and the one expected immutable API image digest;
- `describe-task-definition` proves the active `api` container has `stopTimeout = 120` and
  `API_SHUTDOWN_TIMEOUT_MS = 105000`; and
- the public readiness response from the active service carries `quiesce-v1`.

Record the exact service deployment, task ARNs, task-definition ARN, image digest, configuration,
and marker response together. If any task is unlisted, stale, pending, on another revision/digest,
or missing the marker, keep scaling active and stop. Only after this gate may a later workflow
suspend scaling and begin a drain. This prerequisite supplies the application protocol; it does not
prove production IAM authority, apply infrastructure, or perform a production drain.

When the runtime preflight fails, apply the reviewed Terraform configuration first. The application
deployment intentionally clones the latest task-definition configuration; merging Terraform source
does not apply it. Retry the same full `release_sha` after the task execution role and latest task
definition contain the expected SSM references. The preflight reports only safe configuration names
and never reads or prints parameter values.

## Health and logs

- `GET /health/live` proves the process is running.
- `GET /health/ready` verifies PostgreSQL connectivity and returns
  `X-Ilo-Drain-Protocol: quiesce-v1` from a protocol-bearing binary.
- API request logs are one-line JSON with request ID, method, path, status, and duration.
- Connector account rows expose last sync time, current sync state, and redacted failure text.

The exact public `/health/live` and `/health/ready` paths are excluded from only the AWS managed IP
reputation rule. Deployment and Route 53 health probes can originate from shared infrastructure
that appears on that managed list, so applying the reputation block to those intentionally public,
unauthenticated paths can prevent a healthy release from proving readiness. The shared edge rate
limit and managed bad-input protection still apply. Do not broaden this exception to other paths
or use it as evidence that an authenticated application route is reachable.

Forward `X-Request-Id` from the edge when present. Do not log authorization headers, cookies, OAuth codes, encrypted credentials, or raw provider payloads.

The existence of connector alarms in Terraform is not evidence that they are active in production.
Before publishing images, the production deploy reads the live API log group and fails closed unless
the exact connector failure/configuration metric filters and alarms are present with their expected
patterns, transformations, thresholds, periods, missing-data behavior, and notification actions.
The hourly production-health workflow repeats the same read-only check so later infrastructure drift
uses the existing production-health incident path. If this preflight fails, apply and review the
production Terraform before retrying the application deploy; do not bypass the check or infer
coverage from a successful API health request. Each AWS inventory read has a 30-second deadline,
which tolerates cold GitHub-runner credential and CLI startup while keeping both sequential reads
well inside the hourly health job's five-minute budget. A timeout fails closed with the same safe,
provider-output-free operator message as another AWS read failure.

## Connector configuration

Production's public load balancer has a 60-second idle timeout. Individual provider network calls
are bounded to 15 seconds, and connection routes return before source discovery, pagination,
projection, or initial synchronization. Do not increase the load-balancer timeout to accommodate a
provider bootstrap; preserve the asynchronous boundary described in
[`engineering/connector-reliability.md`](engineering/connector-reliability.md).

The application security group must allow the transports used by enabled connectors:

| Provider transport | Destination port |
| --- | ---: |
| HTTPS APIs, OAuth, CalDAV, and Resend | TCP 443 |
| iCloud Mail IMAP over TLS | TCP 993 |
| iCloud Mail SMTP submission | TCP 587 |

`pnpm lint` checks this timeout and network contract against the Terraform and connector defaults.

### Google

Register the exact public `GOOGLE_REDIRECT_URI` in Google Cloud. Request Calendar read/write and user email scopes. OAuth state is random, user-bound, one-time-use, and expires after ten minutes. Use separate OAuth clients and encryption keys for development and production.

Treat a working client ID and secret as configuration evidence, not proof that Google OAuth is
ready for people outside the development team. Before enabling Google connections in production:

- use a dedicated production Google Cloud project and OAuth client, set the consent screen to
  **In production**, and configure support/developer contacts plus verified application, privacy,
  and terms URLs on owned domains;
- reconcile the consent-screen scope inventory with the exact scopes requested by the API, then
  obtain Google's approval for every sensitive or restricted scope;
- when Gmail restricted-scope data is accessed or stored by ilo's servers, complete Google's
  required security assessment and assign an owner and renewal date for its annual recurrence;
- retain non-secret evidence of the production project, publishing status, approved scopes,
  verification decision, assessment status, owner, and renewal date in the release record; and
- prove with an account that is not a configured test user that the standard Google consent screen
  appears without a **Google hasn't verified this app** warning, the callback returns to ilo, and
  both Mail and Calendar reach **Ready**.

An unverified-app click-through is useful only for explicitly authorized development/test access.
It is a production release blocker, even when the client credentials, callback, and connector sync
all work. Follow Google's current [OAuth app verification
requirements](https://support.google.com/cloud/answer/13464321) and [restricted-scope production
readiness guidance](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification).

The OAuth callback persists the authorized account and returns to the browser before initial
Calendar discovery and provider synchronization complete. Initial sync continues asynchronously;
provider failures remain visible on the connector account and can be retried manually. Keep the
callback itself below the public edge timeout instead of extending the timeout to cover provider
bootstrap work.

### Apple iCloud

iCloud uses the person's Apple Account email and an app-specific password. Calendar traffic uses
CalDAV over HTTPS; Mail reads use IMAP over TLS on port 993 and sends use SMTP submission on port
587. The connect response confirms that the encrypted account was saved, then Calendar discovery
and Mail sync run asynchronously. Invalid credentials or unavailable Apple services leave the
account visible with an error so the person can retry or reconnect without holding the original
request open.

### X Bookmarks

Create an X OAuth 2.0 app, register the exact public `X_REDIRECT_URI`, and set its client ID (plus client secret for a confidential client). The connector requests only `bookmark.read`, `tweet.read`, `users.read`, and `offline.access`. After connecting in **Settings → Connections**, select one bookmark folder. ilo stores the OAuth refresh token encrypted, projects only that folder's posts, and exposes the projection to agents through the `bookmarks:read` scope and the `list_x_bookmarks` MCP tool. It never writes to X.

## Backups and rollback

RDS retains seven days of automated backups and AWS Backup creates a weekly
recovery point retained for 35 days. Application records use soft deletion
where recovery matters, but database backups remain necessary for account or
infrastructure loss. Roll back the application image independently when the
deployed schema remains backward compatible; restore a database only as an
explicit incident action. A failed backup job is routed to the production SNS
operations topic.
