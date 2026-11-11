# External Boundary Reliability

An external dependency is any system whose availability, authority, timing, or state ilo does not
fully control. This includes provider APIs, databases, queues, object stores, mail protocols,
webhooks, model hosts, operating-system bridges, deployment services, and browser redirects.

The engineering mistake to avoid is proving only that the application code is plausible.
Production behavior crosses several independent contracts, and every one must be reasoned about
and evidenced.

## Readiness is a sequence, not a boolean

Use these terms precisely:

| State | What has been established |
| --- | --- |
| Declared | The dependency, capability, owner, and required configuration are documented. |
| Configured | A value is present in the intended runtime. This does not prove that a secret is valid. |
| Authorized | The credential, consent, scopes, role, callback, and resource policy permit the operation. |
| Reachable | DNS, routing, proxy, TLS, protocol, port, firewall, and security-group rules permit the path. |
| Bounded | Deadlines, per-attempt timeouts, payload limits, pagination, concurrency, and rate behavior fit the caller's budget. |
| Recoverable | Partial success, duplicate delivery, process loss, retry, cancellation, and repair have explicit semantics. |
| Observable | Progress, freshness, failure, correlation, and operator or user recovery are visible without exposing secrets. |
| Verified | Production-equivalent evidence has exercised the real path at the appropriate risk level. |

Do not describe an integration as “working,” “healthy,” or “fully configured” when only an
environment variable or API key is present. Secret values must never be printed merely to inspect
them; validate them through the least-privileged, non-destructive operation that proves the required
capability.

## Required boundary record

Before implementing or reviewing a changed external boundary, answer this matrix. Put stable
answers in the nearest architecture, engineering, or deployment document and change-specific
evidence in the pull request.

| Concern | Required question |
| --- | --- |
| Capability and owner | What exact operation crosses the boundary, and which component owns it? |
| Configuration and authority | Which runtime value, identity, scope, consent, role, callback, or resource policy authorizes it? |
| Transport | Which host class, protocol, port, TLS mode, proxy, ingress, and egress path does it require? |
| Time and capacity | What is the caller deadline, per-attempt timeout, retry allowance, page or payload bound, concurrency limit, and rate-limit behavior? |
| Commit point | What durable state means the request was accepted, and what work may continue afterward? |
| Delivery semantics | Can work be duplicated, reordered, partially applied, cancelled, or replayed; what makes it idempotent or reversible? |
| Degraded behavior | What does the user or caller see when the dependency is slow, denied, unavailable, or only partly successful? |
| Recovery and observation | Who retries or repairs it, where are progress and redacted errors stored, and which signal identifies a production failure? |
| Evidence | Which checks prove code behavior, runtime policy, production-equivalent reachability, and post-deploy operation? |

If an answer is unknown, record it as an evidence gap or blocker. Do not silently replace it with
an assumption from a local mock, SDK default, remembered cloud policy, or the presence of a secret.

## Required reasoning method

Review the complete path, not only the function changed in the diff:

1. Trace the request from caller and public edge through the handler, persistence, asynchronous
   work, external dependency, projection, and user/operator feedback.
2. Inventory every network hop, SDK-created socket, callback or webhook, credential boundary,
   timeout, queue or scheduler handoff, and durable write on that path.
3. Compare application assumptions with deployed configuration and infrastructure as code. A
   port in a client, callback in a dashboard, or permission in code is not automatically present in
   the runtime environment.
4. Identify the commit point. Work that can outlive the caller's deadline must cross a durable
   handoff before the response and must not depend on an in-memory promise for eventual recovery.
5. Challenge the happy path with at least: invalid authority, unreachable or hanging transport,
   rate limiting, malformed response, partial persistence, duplicate or replayed delivery, and
   process loss after the commit point.
6. State the disconfirming case explicitly: **What could make all current tests green while this
   still fails in production?** Add evidence or expose the remaining risk.

This reasoning is required even when the code change is small. External failures usually live in
the negative space between application, infrastructure, provider configuration, and operations.

## Time and lifecycle rules

- Each downstream timeout must leave budget for the caller to persist state and return a controlled
  result before its own deadline.
- Retries consume the same end-to-end budget; multiplying a per-attempt timeout by retries must not
  exceed it.
- Paginated, bulk, backfill, discovery, and reconciliation work is background work unless it has a
  proven small bound.
- Acceptance and completion are distinct states. Return success only for the state durably achieved
  so far, and name pending work honestly.
- Background work needs a durable identity, idempotency or reconciliation rule, progress state,
  bounded retry, stale-work recovery, and a terminal error or repair path.
- Increasing an edge timeout is a capacity decision, not a substitute for a missing lifecycle
  boundary.

## Evidence ladder

Use evidence proportional to the failure cost. No single layer proves the whole boundary.

1. **Static contract:** schema/config validation, lint rules, and consistency checks catch declared
   drift.
2. **Behavior tests:** unit tests cover parsing, timeout, cancellation, idempotency, and degraded
   states.
3. **Integration tests:** the real persistence and lifecycle path covers partial success, retry,
   replay, and process-boundary behavior using a simulator or controlled dependency.
4. **Runtime-policy evidence:** infrastructure validation or plan proves required secrets,
   routes, protocols, ports, roles, callbacks, and resource policies are wired.
5. **Production-equivalent smoke:** a least-privileged non-destructive operation proves authority
   and reachability from the deployed runtime.
6. **Post-deploy evidence:** health, structured logs, metrics, alerts, and a repair action prove the
   boundary remains operable.

A mocked success response proves application behavior only. A successful infrastructure plan proves
declared policy only. A healthy process proves neither that credentials work nor that the required
external capability is reachable.

## Change and review gate

A change to an external dependency is incomplete until:

- code, runtime configuration, infrastructure, deployment order, and current docs agree;
- the boundary record has no hidden unknowns;
- failure and recovery behavior is tested at the layer that owns it;
- the pull request separates what is implemented from what is actually evidenced;
- any production-only verification is listed with its owner and safe post-deploy action; and
- rollback does not strand accepted work or destroy the evidence needed to reconcile it.

Specialized standards may add stricter rules. Connector work additionally follows
[`connector-reliability.md`](connector-reliability.md), and database changes follow
[`database-migrations.md`](database-migrations.md).

## Finance provider authorization handoff

The Finance account-connection boundary creates a Plaid Link authorization handoff; the API owns
the attempt record and the Plaid connector owns the provider request. The configured Plaid client
identity, allowed products, country, redirect/callback settings, and the user's consent authorize
the operation. Connector transport must use the shared HTTPS timeout policy and the request must
fit within the API deadline without retrying an unbounded provider workflow.

The durable commit point is a `finance_account_connections` row in `pending` state, created before
the provider request. A successful provider response stores the short-lived handoff artifact and
its expiry before returning it. Provider rejection or transport failure changes the attempt to
`failed` with a redacted error requiring a new attempt. Replay of the same key never repeats
the provider request. Completed exchange changes it to `connected`; expired
artifacts remain observable as pending-but-expired and require a new connection attempt. Process
loss after the pending commit is therefore visible and recoverable rather than indistinguishable
from a request that never started.

Only execution-authorized start/completion responses may expose the short-lived authorization
artifact, provider and expiry. Ordinary connection-status reads redact the bearer artifact. It must never contain Plaid access tokens, refresh tokens, encrypted credentials, or
raw provider errors. Idempotency is scoped to the user and requested attempt; a failed attempt is
retried with a new key, while replay of a completed key returns the original result.

Behavior coverage must prove pending persistence, success metadata, expiry, redacted failure, and
idempotent replay. Production-equivalent evidence must separately prove runtime authority,
outbound HTTPS reachability, Link configuration, callback correctness, and successful transition
from a handoff to connected accounts. Green mock tests do not prove any of those runtime facts.

## Ritual optional-step follow-ups

The ritual API owns acceptance of optional follow-ups. A human-session completion action authorizes
up to 20 owner-scoped native Reminder rows in the same PostgreSQL transaction as ritual completion
and its idempotency receipt. No new provider, port, credential, or recurring scheduler is introduced.
The desktop coordinator fetches these reminders over the existing authenticated HTTPS API and uses
the existing OS reminder scheduling path, preferences, quiet hours, and permission checks.

The database commit is the acceptance point. Failure before commit rolls back completion and every
reminder; replay returns the stored outcome without creating duplicates. The encrypted desktop
queue holds offline intent, labels it pending sync, and uses existing conflict/export/discard
recovery when a ritual expires or changes before synchronization. An accepted late reminder is
moved to at least one minute after API acceptance so it remains eligible for scheduling. Requests
are bounded to a time within 26 hours of the observed completion (including a DST fall-back day).
Redacted reminder audit events link the occurrence without copying answers or step labels.

Unit, database integration, and native tests establish acceptance and replay behavior. OS delivery
can still fail with green tests if notifications are disabled, the Mac is asleep, the coordinator
cannot refresh, or the OS refuses presentation. A rebuilt desktop app and an authorized real-device
notification smoke are required before claiming production notification delivery for this change.


## Browser ritual presentation

The authenticated ritual API remains the authority for browser and desktop occurrences, revisions,
responses, and actions. The browser uses its existing session transport and the configured app/API
origin; it introduces no provider, port, permission, or screen-capture dependency. Read the current
state every ten seconds while visible and on focus/reconnection. Browser timers may be throttled
or suspended, so anchor snooze/expiry to server time plus monotonic elapsed time and refresh on
return. A closed tab cannot deliver a ritual.

A successful mutation response is the commit evidence; browser writes do not cross the native
queue and cannot claim offline acceptance. Cancel old reads before accepting mutation state and
scope caches to the authenticated owner. Existing denial handling clears private ritual state on read 401/403 and expired-session mutations;
late writes cannot populate a replacement account's cache. Read failures retain the last known
window only until expiry, expose Sonner retry feedback without repeated polling toasts, and never
claim completion. Mutation failures preserve the shared checklist's correction/retry behavior.
Shared revisions resolve races with other tabs and desktop; refresh settles the other view.
Actual browser background scheduling and native macOS window delivery still require runtime checks.


## Finance institution branding

The Plaid connector owns read-only `/institutions/get_by_id` with optional metadata. Existing
Plaid client/secret, environment and US institution coverage authorize it; existing HTTPS/443
provider egress applies. The response is bounded to 96 KB and a request uses the shared 15-second
transport deadline without inline retries. Only bounded PNG data, strict six-digit hex colors and
HTTPS website metadata enter the domain. No browser logo-service request or new external service
is introduced. Official account names already feed display names; the provider-reported account
mask is preserved through the shared bounded (32-character) identity contract. This work does
not request full account/card numbers.

The existing owner-scoped Provider Item sync lease owns branding acceptance. Its PostgreSQL row
stores institution identity, safe metadata, next refresh and a fixed redacted failure code. One
lookup serves the Item's linked accounts. Cache successes, including unavailable artwork, for
seven days; retry failures after one hour during the next eligible ordinary sync. A crash before
commit leaves the existing due work recoverable; a lost/replaced sync or maintenance claim cannot
commit metadata. Account/transaction synchronization proceeds after optional branding failures.
Preserve last-good metadata only for the same institution; a verified identity change clears old
branding. No callback waits for branding, separate scheduler or migration-time provider backfill
is introduced. Existing connected Items fill the cache through normal sync without reconnecting.

Public account serializers expose branding through the existing owner-checked Item relation and
`accountMask` through the shared `provider_account_mask` account field. Bitmap artwork is omitted
by default from service and agent/context projections; authenticated human account/status/setup
routes explicitly request it for display. Other institution metadata remains available without
copying decorative base64 into agent prompts. List, status and connection completion use the same cached
source; metadata is not an independent ledger. The additive nullable migration preserves existing
accounts and requires no synchronous data rewrite. A failed logo decode uses the shared mark or
monogram. Branding failure does not change financial freshness or claim that sync failed.

Connector and database tests prove sanitization, cache timing, failure isolation, owner separation,
and fencing. They do not prove production credential authority or deployed reachability. After
release, the deployment owner must observe one ordinary Item sync, confirm safe cached metadata
and logo display, and inspect `branding_failure_code` / `branding_next_refresh_at` on failures.
Green local tests can still coexist with missing bank artwork, Plaid configuration rejection,
provider downtime or browser image-decoder failures. These retain honest fallbacks.

## Expo human session boundary

The native client consumes the existing API's expiring, revocable human sessions using
its shared typed client. The user submits credentials to the configured HTTPS API origin
(defaulting to the desktop hosted API); native requests omit cookies and send the session
in the Authorization header. Redirects are rejected and requests are bounded to 15 seconds.
SecureStore contains only the session token in an origin-scoped v1 key; passwords and user
records are never persisted. Login acceptance is the server-issued session plus successful
secure storage. If storage fails, the client attempts revocation and does not unlock UI;
a failed compensation can leave a server session until its existing expiry, without a local
credential. Startup and foreground `/v1/me` validate authority. A 401 purges local identity;
network failures retain the token for retry and never imply successful restore. Logout waits
for confirmed server revocation (or an already-invalid session) before clearing local state.
Keychain deletion failure after revocation cannot restore access because `/v1/me` rejects it.
There is no new refresh token, permission grant, offline write queue or cached domain data.

Unit tests cover session restore, expiry, transport failure, revocation, persistence failure,
and concurrent session actions. Hosted unauthenticated `/v1/me` returned 401; iOS/web exports
and simulator sign-in rendering are separate evidence. These do not prove a successful
physical-device sign-in, Keychain restore, or haptic quality. Web preview authentication also
requires its origin to be allowed by existing CORS policy; native requests have no browser CORS.

## General Texting routine handoff

The Texting coordinator reuses the owner's registered Claude routine and encrypted fire credential,
but requires separate human opt-in, active verified SMS consent and a live original connection with
Texting read/write/execute and standing execution policy. The credential authorizes only a wake-up;
workspace API permissions still govern every effect. The connector posts only a local run ID to
`api.anthropic.com` over HTTPS/443, without redirects, within 15 seconds and a 16 KiB response cap.
No API-key model call or paid fallback exists. Account billing configuration must be checked in Claude.

The message/queue commit acknowledges inbound acceptance. A separate submitting commit freezes the
batch before transport; an uncertain provider response remains fenced against automatic replay.
A successful response proves session creation only. The agent must claim through nohmi and record
checkpoints and a reply; the reply row and run completion commit before one SMS submission.
Provider timeout retains that message with unconfirmed delivery. Recovery reads and idempotent
same-body replies do not resend it. Consent epochs, live grants and schedule identity are rechecked
under locks; pre-handoff quiescence releases work, while crash after the submitting commit requires
inspection. Human closure requires confirming the Claude session stopped and never replays work.

PostgreSQL tests cover durable batching, competing claims, revoked consent/grants, tenant isolation,
explicit Finance routing, uncertain host/send behavior and recovery. Browser tests use synthetic
history and prove rendering only. Green tests can coexist with absent routine entitlement, missing
MCP permission, stale host instructions, provider rate limits or carrier rejection. The deployment
owner must verify those live boundaries before describing the feature as operational.

### Texting fallback notices, workspace metadata and reply proof

Fallbacks reuse the configured Twilio connector and consent/quotas of `sendNotification`; no new
host, port, model API or credential is introduced. A bounded rotating scan considers 25 failed or
stalled runs per pass. Under the existing owner/connection serialization, it rechecks current run,
phone epoch and routine identity, reserves one system message and its run notice ID, and commits
before provider submission. Each owner has a fifteen-minute notice cooldown. A lost result retains
the reserved message; it never triggers an automatic second send. Revocation, quota or provider
unavailability can still prevent the notice. Redacted background errors retain recovery observation.

The setup gate requires a delivered, provider-submitted, authenticated agent message linked to a
real incoming batch and current configuration. Human-visible metadata is not proof of a workspace
effect. Tags and reply references are owner-bound conversation metadata; workspace filtering occurs
before pagination and does not produce a full-context send receipt. Loopback-only development
previews contain fictional records, make no provider call and cannot update verification state.
PostgreSQL tests establish concurrency, cooldown, isolation and proof transitions; local browser
checks establish layout and gating only. Real routine and carrier acceptance remain rollout evidence.

## iOS Finance push delivery

The API owns direct APNs notification delivery; the native app opts in explicitly and obtains an
APNs device token with Expo's `getDevicePushTokenAsync`. This path uses neither Expo's relay nor
SMS consent. `NATIVE_PUSH_ENABLED` defaults off. Deployment supplies `APNS_TEAM_ID`, `APNS_KEY_ID`,
`APNS_PRIVATE_KEY_BASE64` (an encoded P-256 PEM), `APNS_TOPIC` and `APNS_ENVIRONMENT`; production
allows only production APNs and the `app.personal-os.mobile` topic. The Mac Mini Compose allowlist
forwards these values. The deployment owner provisions secrets separately; never commit them.

HTTP/2 over TLS/443 to `api.push.apple.com` (or explicitly selected development sandbox) is bounded
to ten seconds, one request at a time and 25 delivery claims per pass. ES256 provider JWTs are cached
for 30 minutes. Notification payloads contain only generic text and opaque event/audience IDs, never
financial records, transcripts, tokens or provider error bodies. APNs may retain a generic alert for up to one hour for an offline phone; expiry prevents
indefinite delayed presentation. A delivered alert remains generic and its tap must pass current authorization. APNs acceptance proves provider acceptance, not phone presentation.

The reply transaction commits a deduplicated native event and device-specific delivery outbox.
Bounded rotating canonical discovery repairs actionable-work publication without holding financial
execution. Enrollment never backfills historical events. Stable source revisions prevent repeated
unchanged blockers. Events expire for delivery after 24 hours; current source state, owner, actual
unexpired session, installation audience/revision, token environment, opt-in, preferences and quiet
hours are checked before submission. Session/device locks serialize submission with logout and token
rebinding. Notification taps resolve through the authenticated API using the installation ID; stale
or switched audiences cannot reveal a destination.

A committed `submitting` delivery precedes transport. A timeout, process loss, malformed/oversized
response or network error leaves `uncertain`, with no automatic replay. Explicit APNs 429/500/503
rejections allow at most three total attempts; invalid device responses disable the registration.
Quiet hours defer without consuming provider attempts. Lease recovery converts interrupted submits
to uncertain. Redacted outcome codes and persisted state support operator inspection. Revoking a
session cascades its device registrations and pending deliveries. Disabling the feature stops
provider submission while preserving event evidence.

Official contracts: [Expo direct APNs delivery](https://docs.expo.dev/push-notifications/sending-notifications-custom/),
[Apple request protocol](https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns),
and [Apple response handling](https://developer.apple.com/documentation/usernotifications/handling-notification-responses-from-apns).
Behavior tests prove application and persistence semantics only. The deployment owner must separately
verify APNs key authority, host HTTP/2 reachability, signed entitlement/environment, and a TestFlight
phone's token registration and visible notification. Missing permission, Focus, device offline state,
revoked credentials or wrong entitlements can still prevent presentation despite green tests.

## Finance host instruction delivery

The API owns current Finance workflow instructions; external hosts retain their existing cadence and
connection grants. A stable setup bootstrap loads instructions through authenticated HTTPS each
invocation and stops on load or acknowledgment failure. There is no outbound provider request, new
port or background execution in this path. Ordinary API ingress bounds apply; receipt text is capped
at 20,000 characters and history pages at 100 rows.

The commit point is an immutable served receipt containing exact code-controlled text, independent
instruction version, schedule version, original connection and credential. Owner execution guards
serialize delivery and acknowledgment with authority changes. Load operation UUIDs make exact
retries return the original receipt. Explicit host acknowledgment is separate, and requires the
same credential, current instruction version, unchanged schedule version and live authority. It is
a report of adoption, not evidence that the host followed instructions. Revocation that commits
first prevents delivery or acknowledgment; a changed schedule/version requires a fresh load.

Latest served and acknowledged receipts are distinct from issued bootstrap prompts and Chat
verification. The owner can inspect current delivery summaries, and the original host can page exact
receipt history. Actual unattended permission, external bootstrap adoption, next scheduled
invocation and successful causal Chat reply remain post-deploy evidence requirements. API tests and
an issued prompt alone cannot establish them.
