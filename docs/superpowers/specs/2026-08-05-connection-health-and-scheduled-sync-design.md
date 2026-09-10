# Connection Health and Scheduled Sync Design

## Summary

ilo will treat connector freshness, failure classification, recovery, and user feedback as one
durable lifecycle. Every enabled Google or iCloud Calendar or Mail account will be scheduled at
least every five minutes while healthy. Temporary provider, transport, rate-limit, and ilo
configuration failures will retry automatically with bounded backoff. Only failures that actually
require renewed user authority will ask the person to reconnect.

Provider response bodies and provider-authored messages are untrusted diagnostic material. They
will never be stored in user-visible fields, returned through product APIs, logged verbatim, or
rendered in the application. ilo will retain only a stable internal classification, provider HTTP
status when safe, a redacted operator event, and purpose-written user guidance.

The production Google OAuth client ID already exists as a valid value in Parameter Store. The
running ECS task instead receives an empty Terraform variable. The rollout will make Parameter
Store authoritative for both the client ID and client secret, validate the production runtime at
startup, and refuse a deployment whose required Google configuration is absent.

## Goals

- Keep healthy connected Calendar and Mail projections no more than five minutes behind their
  providers under normal provider availability.
- Recover automatically from transient failures and process restarts without manual intervention.
- Distinguish retryable service trouble from authorization that genuinely requires reconnection.
- Make connection health, last successful synchronization, and the correct next action visible
  where a person uses the affected material.
- Prevent raw provider responses, credentials, private payloads, and low-level exceptions from
  crossing into durable user-facing state or browser-visible errors.
- Make missing required production connector configuration fail before a broken task becomes the
  active release.
- Preserve existing sync-claim fencing, idempotent provider projection, shutdown recovery, and
  provider authority.

## Non-goals

- Google push notifications, Gmail watch renewal, iCloud IMAP IDLE, or CalDAV push.
- Sub-minute synchronization guarantees.
- A general-purpose job queue unrelated to connector synchronization.
- New providers or new Calendar/Mail capabilities.
- Retrying provider mutations whose effect may be indeterminate; this design applies to read and
  reconciliation syncs, not unsafe replay of writes.

## Production findings

The investigation established the following failure chain:

1. The deployed API task has an empty Google client ID even though the corresponding Parameter
   Store value exists and has the expected OAuth-client form.
2. Google sync therefore fails before a provider request begins. `ConnectorError` escapes the
   connector service, so the API converts it to a generic internal error for the manual sync call.
3. Google provider failures currently include the complete response body in `ConnectorError`.
   `syncAccount` persists the exception message directly in `calendar_accounts.sync_error`, and
   Settings renders that field verbatim.
4. `syncStaleAccounts` schedules only idle accounts with Mail enabled, apart from initial or
   interrupted bootstrap. Calendar-only accounts do not receive regular refreshes.
5. Any account in `error` is excluded from scheduled sync, so temporary Google and iCloud failures
   remain terminal until a person manually retries them.
6. iCloud maps every connection exception to an authorization error. A production iCloud account
   labeled as bad credentials completed successfully when retried, proving the displayed diagnosis
   can be false.
7. The background scheduler is running and production endpoints are healthy; the defect is in
   connector configuration and lifecycle policy rather than general service availability.

## Architecture

The change remains inside established ownership boundaries:

- `packages/connectors` owns provider response parsing and emits a provider-neutral, redacted
  `ConnectorError` classification.
- `apps/api` owns durable sync state, retry policy, scheduler selection, structured operator events,
  and conversion to public `AppError` responses.
- `packages/database` stores the durable retry and recovery state required across restarts.
- `packages/domain` and `packages/api-client` expose the stable account-health contract.
- Calendar, Mail, and Settings web features render the shared health contract without inspecting
  provider-specific strings.
- Terraform and production startup validation own required runtime configuration.

No browser, MCP adapter, or feature page will call a provider directly or infer recovery from error
text.

## Provider-neutral failure contract

`ConnectorError` will contain structured, safe fields instead of a provider response body:

```ts
type ConnectorFailureCategory =
  | "authorization"
  | "configuration"
  | "invalid_response"
  | "not_found"
  | "rate_limited"
  | "rejected"
  | "temporary"
  | "transport"
  | "unknown";

type ConnectorFailureDisposition = "operator" | "reconnect" | "retry";
```

The error may also carry a numeric provider status, a bounded retry-after time, and a stable
internal code. Its `message` is always ilo-authored and safe for application logs, durable state,
and API conversion. It never contains response bodies, response headers other than a validated
retry delay, tokens, credentials, provider payload fragments, mailbox names, event contents, or
provider-authored free text.

Classification rules:

| Evidence | Category | Disposition | User consequence |
| --- | --- | --- | --- |
| Missing required ilo provider configuration | `configuration` | `operator` | ilo retries after repair; no user action |
| HTTP 401/403 or positively identified IMAP/CalDAV authentication rejection | `authorization` | `reconnect` | reconnect required |
| HTTP 429 | `rate_limited` | `retry` | automatic retry, respecting bounded `Retry-After` |
| HTTP 408, 5xx, timeout, connection reset, DNS/TLS/socket failure | `temporary` or `transport` | `retry` | automatic retry |
| Provider response violates a required schema | `invalid_response` | `operator` | bounded retries, operator signal, no invented user action |
| Definitive 404 or other request rejection | `not_found` or `rejected` | operation-specific | synchronize/reconnect only when that action is valid |
| Unclassified exception | `unknown` | `retry` initially | safe generic copy and operator signal |

iCloud will classify authentication only from a positive protocol signal. Generic connect,
timeout, socket, TLS, or server errors will remain retryable transport failures.

## Durable account lifecycle

`calendar_accounts` will retain the existing `idle | syncing | error` execution status and sync
claim invariant. It will add:

- `sync_error_code`: nullable stable failure code;
- `sync_recovery`: nullable `automatic | reconnect | operator` recovery owner;
- `sync_failure_count`: consecutive failed attempts, default `0`;
- `last_sync_attempt_at`: nullable timestamp;
- `next_sync_at`: nullable timestamp for either the next healthy refresh or retry.

`sync_error` remains a short ilo-authored user-safe explanation. It is never populated from
`error.message` without first passing through connector failure classification.

State transitions:

1. A new durable account is due immediately.
2. Claiming a due account sets `syncing`, a claim ID, increments the generation, records the attempt
   time, and clears only obsolete presentation fields. Claim fencing remains authoritative.
3. Success clears failure metadata, resets the failure count, records `last_synced_at`, and sets
   `next_sync_at` to five minutes after completion.
4. A retryable failure records a safe error, increments the failure count, sets recovery to
   `automatic`, and schedules the next bounded retry.
5. An authorization failure records a safe reconnect explanation, sets recovery to `reconnect`, and
   leaves `next_sync_at` null so ilo does not repeatedly test rejected credentials.
6. A configuration or invalid-response failure records recovery as `operator`. It receives bounded
   low-frequency retries so a repaired deployment recovers without a person touching the account.
7. Interrupted shutdown returns the account to a due, retryable state. A stale sync claim remains
   recoverable using the existing lease and generation fencing.

Existing rows will migrate conservatively. Idle rows become due immediately. Existing error rows
whose legacy message cannot be trusted are converted to a safe generic automatic-recovery state and
made due once; successful recovery clears them. A known authorization result from a new attempt is
required before ilo presents “Reconnect required.” Legacy raw text is overwritten and no longer
returned.

## Scheduling and retry policy

The API scheduler continues to run once per minute and on startup. Each pass claims only due,
non-local accounts with at least one enabled Calendar or Mail capability. Regular successful syncs
are due every five minutes for both Calendar-only and Mail-enabled accounts.

Retry delays for consecutive retryable failures are one minute, five minutes, fifteen minutes, and
then sixty minutes. A validated provider `Retry-After` may extend, but never shorten, the applicable
delay and is capped to a safe maximum. Deterministic per-account jitter prevents synchronized retry
bursts without making the freshness contract unpredictable.

The scheduler performs bounded selection and concurrency rather than `Promise.all` over every due
account. A pass claims a fixed number of accounts and uses a small worker limit, allowing later
passes to drain additional work. Existing claim fencing makes overlapping API tasks safe during ECS
rollouts. Provider requests retain their existing per-attempt timeouts and shutdown cancellation.

The five-minute target is a healthy-state objective, not a false guarantee during provider or
network outages. The API exposes both `lastSyncedAt` and the current recovery state so stale material
is honest.

## User experience

The public account-health contract will expose a derived state:

- `ready`: last sync succeeded and the next refresh is scheduled;
- `syncing`: a current fenced attempt is running;
- `retrying`: ilo owns recovery and has scheduled another attempt;
- `reconnect`: renewed user authority is required;
- `service_attention`: ilo/operator action is required and the person does not need to reconnect.

Each connection row shows the account identity, enabled capabilities, derived health state, last
successful sync, safe explanation, and exactly one appropriate action:

- Ready — manual “Sync now” remains available.
- Syncing — action is disabled with progress feedback.
- Retrying automatically — show when the next attempt will occur; manual retry remains available.
- Reconnect required — show a provider-specific reconnect action.
- ilo is resolving a connection problem — no misleading credential instruction; manual retry may
  remain available.

The generic page-level “Something needs attention / An unexpected error occurred” alert is removed
from connector sync. A manual sync result uses a short toast and immediately refreshes the durable
row, following Settings feedback standards. The row remains the persistent source of truth.

Mail and Calendar surfaces show a concise connection-health callout when an account they depend on
requires reconnection, with a direct link to Settings → Connections. Retryable outages show stale
freshness without alarming the person or asking them to repair ilo. This makes genuine account
breakage detectable where its missing material matters, without requiring a settings hunt.

The browser never decides whether an error is retryable by matching strings.

## Public API behavior

The account response will add structured health fields and retain existing fields during migration
for compatibility. `syncError` remains safe copy. A manual sync failure becomes a structured
`AppError` whose message matches the durable account guidance and whose details contain only stable
codes, recovery ownership, account ID, provider, request ID, and safe timing metadata.

`ConnectorError` must not escape the connector service. The global API error handler remains a final
defense and will continue returning a generic internal message for unknown errors.

MCP and other API consumers receive the same provider-neutral health contract. No raw provider
error is added to audit snapshots or attention-item metadata.

## Production configuration hardening

Parameter Store becomes authoritative for `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Terraform
will inject both through ECS secret references and remove the empty client-ID task-definition
variable path. Documentation and examples will no longer instruct operators to duplicate the client
ID in an untracked tfvars file.

Production config validation will refuse to boot when either required Google value is empty. The
ECS deployment circuit breaker will therefore keep the previous healthy task rather than promoting
a release that cannot service configured Google accounts. Static infrastructure checks will verify
that required connector parameter names are present in the task definition and that no empty Google
client ID environment entry can be emitted.

The immediate repair uses the existing Parameter Store value; no credential value is copied into
the repository, command output, logs, documentation, GitHub variables, or Terraform state as plain
configuration.

## Observation and privacy

Every failed sync emits one structured `connector_sync_failed` event with:

- account ID and provider;
- safe category, code, disposition, and provider status when present;
- consecutive failure count and next retry time;
- sync claim/request correlation and duration.

It excludes account email, credentials, provider bodies, exception messages from unknown sources,
mail/calendar content, and tokens. Scheduled sync failures will no longer be silently swallowed.

CloudWatch will count connector failures by safe category. Configuration failures and sustained
failure volume will alert operators. Successful recovery emits a correlated recovery event after a
prior failure so incidents can be distinguished from permanent account authorization loss.

## External-boundary record

| Concern | Contract |
| --- | --- |
| Capability and owner | `packages/connectors` contacts Google HTTPS and iCloud CalDAV/IMAP; `apps/api` owns scheduling, claims, projection, and recovery. |
| Configuration and authority | Google client ID and secret come from production Parameter Store; encrypted per-account OAuth refresh tokens or iCloud app-specific passwords provide user authority. |
| Transport | Google and CalDAV use TLS on TCP 443; iCloud IMAP uses TLS on TCP 993. Existing production security-group rules remain required. |
| Time and capacity | Scheduler runs every minute; healthy accounts are due every five minutes; provider attempts stay bounded by connector timeouts; due selection and concurrency are capped. |
| Commit point | Durable account credentials and account row precede sync. A fenced claim marks accepted work; projection transactions and final account transition mark completion. |
| Delivery semantics | Sync may repeat after failure or process loss. Generation/claim fencing, provider identifiers, sync tokens, and idempotent projection make replay safe. Provider mutations retain their separate no-blind-retry rules. |
| Degraded behavior | Retryable failures show stale freshness and automatic recovery. Positive authorization failures show one reconnect action. Raw provider material is never exposed. |
| Recovery and observation | `next_sync_at`, failure count, recovery owner, scheduler startup pass, stale-claim recovery, structured redacted events, metrics, and manual retry provide repair paths. |
| Evidence | Unit classification tests, database lifecycle tests, connector integration tests, API/UI tests, Terraform validation, production task-definition inspection, a least-privileged production sync, and post-deploy freshness observation. |

## Testing strategy

Tests will be written before implementation for each behavior:

1. Google connector tests prove arbitrary JSON, HTML, oversized, and malformed error bodies never
   enter a `ConnectorError` message or serializable safe fields.
2. iCloud connector tests distinguish positive authentication rejection from timeout, socket,
   TLS, and unknown transport failures.
3. Connector-service integration tests cover success, each recovery disposition, retry timing,
   failure-count reset, legacy-row repair, stale claim recovery, Calendar-only scheduling, bounded
   selection, and concurrent scheduler passes.
4. API tests prove manual sync returns a structured safe error and list responses contain no raw
   provider fragments.
5. Web tests cover every derived health state, last-success freshness, the correct single action,
   toast behavior, and Mail/Calendar reconnect callouts.
6. Privacy regression tests inject credential-shaped and provider-body canaries and assert they do
   not appear in database user-facing fields, logs, API responses, audit events, or rendered DOM.
7. Configuration tests prove production startup rejects missing Google settings while development
   may still run with connectors disabled.
8. Terraform/static checks prove both Google values are Parameter Store references and an empty
   client-ID environment value cannot reach an ECS task definition.
9. Existing connector projection, write-through, quiesce, coverage, build, desktop, and mobile
   acceptance tests remain green under `pnpm verify`.

## Rollout and verification

1. Apply the database migration before application code begins returning the extended health
   contract. The migration is additive and backfills safe retry state.
2. Apply the Terraform change using the existing Parameter Store client ID, confirm a new task
   definition references both Google parameters, and verify no raw value is present in the task
   definition.
3. Deploy the API and web through the normal release workflow. Startup validation must pass before
   the new task can become healthy.
4. Perform a non-destructive production sync for one Google and one iCloud account. Confirm
   successful projection, safe status transitions, and updated `lastSyncedAt`.
5. Observe at least two healthy five-minute cycles and verify Calendar-only and Mail-enabled
   accounts advance without manual requests.
6. Exercise a controlled retryable failure in a production-equivalent environment and confirm the
   retry event and recovery event contain only safe metadata.
7. Confirm Settings, Mail, and Calendar contain no legacy raw error text. The migration and first
   scheduled pass must replace existing legacy failures.
8. If rollout fails, ECS retains the prior task. The additive schema remains compatible with the
   prior application, and the Parameter Store wiring can be reverted without deleting account or
   projection data.

## Documentation updates

Implementation will update:

- `docs/engineering/connector-reliability.md` with the durable health and retry contract;
- `docs/engineering/external-boundary-reliability.md` only if the general standard needs a new
  reusable rule discovered during implementation;
- `docs/engineering/settings-ui-standards.md` if the account-health row becomes a reusable Settings
  pattern;
- `docs/deployment.md` and `infra/README.md` with Parameter Store ownership and production evidence;
- the relevant Calendar and Mail design docs with cross-surface health callouts;
- `docs/product/implementation-log.md` because this changes shipped connector freshness and
  recovery capability.

## Acceptance criteria

- A healthy Google or iCloud account with Calendar, Mail, or both enabled receives a successful
  scheduled attempt at least every five minutes under normal provider availability.
- Temporary provider and transport failures retry durably without a person refreshing or pressing
  Sync.
- Only positively identified authority failures produce “Reconnect required.”
- Missing production Google configuration cannot produce a healthy active ECS release.
- Manual connector failures never add the generic unexpected-error alert.
- No provider response body or provider-authored free text appears in durable account guidance,
  API responses, logs, audits, or rendered UI.
- Connection rows display last success, current health, and exactly one correct next action.
- Mail and Calendar link directly to Connections when renewed authority is required.
- Existing stale raw error rows are repaired and no longer returned after rollout.
- Focused tests and the full `pnpm verify` gate pass.
- Production task-definition, endpoint, sync, scheduler-cycle, and redacted-observation evidence are
  recorded before the work is declared complete.
