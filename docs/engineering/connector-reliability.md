# Connector Reliability

Provider integration code crosses three independent failure boundaries: the public HTTP edge, the
provider's network and API, and ilo's durable projection. A connector is complete only when those
boundaries agree in application code, infrastructure, tests, and operations.

This document specializes the repository-wide
[`external-boundary-reliability.md`](external-boundary-reliability.md) standard. Complete that
standard's boundary record first; the rules below add connector-specific lifecycle, transport, and
test requirements.

## Interactive boundary

Production's application load balancer closes an idle request after 60 seconds. Every provider HTTP
request and initial socket connection uses a 15-second timeout so the API retains time to persist a
result and send a structured response.

A connection endpoint or OAuth callback may:

1. validate user input or one-time OAuth state;
2. exchange an authorization code;
3. load only the minimum profile needed for a stable provider account identity;
4. encrypt and persist credentials and the account; and
5. respond or redirect.

It must not wait for source discovery, provider pagination, an initial full sync, projection, a
backfill, or retries. Those operations start only after the account and its initial durable sync
trigger commit together. Connector callbacks do not launch in-memory fire-and-forget sync work.

## Browser authorization outcomes

Google and X authorization starts use a random hashed state and S256 PKCE. The encrypted verifier,
exact redirect URI, selected capabilities, safe return path, and thirty-minute expiry live in one
durable attempt row before the browser leaves ilo. A callback claims that attempt atomically and is
idempotent under provider or browser replay. An authenticated outcome read atomically closes a
processing claim that outlives its two-minute provider window, so process loss becomes a retryable
failure instead of leaving the browser pending indefinitely.

Token exchange uses the redirect URI stored with that authorization attempt. An in-flight callback
therefore remains valid while a rolling deployment changes the configured URI for new attempts.

Every callback branch returns a `303` to an allowlisted ilo path with cache disabled, a no-referrer
policy, and either an opaque attempt UUID or the fixed `restart_required` result. Provider error
text, response bodies, codes, scopes, identities, state, and PKCE material never enter a redirect,
public response, account description, or log. Authenticated clients can read only the provider,
status, retryability, and connected account UUID for their own attempt for twenty-four hours.

Google enables a selected capability only when the token response contains every authority needed
for that capability. Partial consent closes as `permission_incomplete` without creating, changing,
or downgrading an account. Successful account persistence, cleared health, immediate sync
eligibility, closed authorization outcome, and initial trigger share one transaction.

Enabled notification configuration fails startup unless Gmail's OIDC audience and Calendar's
webhook URL are the exact HTTPS notification routes on the configured API origin.

An app-password connector can only validate credentials by contacting the provider. It therefore
persists a pending account first and performs verification as the first asynchronous sync. A failed
verification keeps the account available for scheduled repair. Only positive provider
authentication evidence becomes `reconnect`; socket, TLS, timeout, and unknown Apple failures stay
automatic retries.

## Durable health and scheduling

Every non-local Calendar/Mail account stores a safe failure code/category, recovery owner,
consecutive failure count, last attempt, and next due time. `sync_error` is short ilo-authored copy;
provider response bodies and unknown exception messages never populate it.

- A successful account is scheduled again five minutes after completion.
- Automatic and operator-owned failures retry after one, five, fifteen, then sixty minutes with
  deterministic jitter. Provider `Retry-After` can lengthen that delay up to 24 hours.
- Reconnect failures have no next due time and resume only after authorization is repaired.
- Shutdown interruption becomes due immediately. A claim older than the thirty-minute lease can be
  recovered by another scheduler pass.
- Each one-minute scheduler pass selects Calendar-only and/or Mail-enabled due accounts, caps the
  batch, and uses a fixed worker pool. Claim generation and claim ID fencing prevent duplicate
  projection when scheduler passes overlap.
- Initial connections and low-latency change signals coalesce by account in
  `connector_sync_triggers`. The scheduler drains claimed triggers through the same fenced sync
  engine before ordinary due-account reconciliation. A trigger arriving during a sync survives
  completion; failed work is released for retry. The five-minute schedule remains authoritative if
  every change signal is delayed or absent.

Google Mail uses Gmail history IDs and Google Calendar uses opaque sync tokens. iCloud Calendar
uses WebDAV `sync-collection` only when the collection advertises it; an invalid opaque token
restarts one bounded tokenless collection sync so the replacement token remains incremental, while
unsupported or malformed reports fall back to a controlled full reconciliation. Provider cursors
are opaque, bounded, and committed inside the same fenced projection transaction as their changes.
Gmail and Calendar watches renew durably before expiry. iCloud IMAP IDLE sessions are bounded
change signals only; they never replace the authoritative five-minute reconciliation.

## Provider transport inventory

| Capability | Host or class | Protocol | Production egress |
| --- | --- | --- | ---: |
| OAuth and provider APIs | Google, X, Plaid, Pinterest, weather, Resend | HTTPS | TCP 443 |
| iCloud Calendar | `caldav.icloud.com` | HTTPS/CalDAV | TCP 443 |
| iCloud Mail read and projection | `imap.mail.me.com` | IMAP over TLS | TCP 993 |
| iCloud Mail human-confirmed delivery | `smtp.mail.me.com` | SMTP submission with STARTTLS | TCP 587 |

The signed-in Mail workspace may submit a durable, human-confirmed plain-text draft. Google uses
Gmail HTTPS with explicit `gmail.send`; iCloud uses bounded authenticated SMTP submission. MCP and
autonomous maintenance cannot invoke either delivery path. An ambiguous provider result is never
automatically retried and must become a visible human reconciliation state.

Adding or changing a non-HTTPS transport requires the infrastructure change in the same pull
request. `scripts/check-provider-network-contract.mjs`, run by `pnpm lint`, checks that connector
timeouts remain below the edge timeout and that iCloud's declared ports exist in the application
security group.

Production injects both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` from SSM Parameter Store as
ECS secret references, and API boot validation rejects an empty value. Gmail push, Calendar push,
and iCloud IDLE have independent disabled-by-default Terraform gates; a disabled gate emits none of
its incomplete runtime values. WAF applies a separate rate boundary to only the two exact Google
webhook paths and does not bypass managed rules by provider IP.

CloudWatch converts only allowlisted structured fields into aggregate connector metrics. It covers
sync/configuration failures, active subscription failures and expiry, renewal lag, rejected (not
duplicate) notifications, durable trigger age, and successful-sync freshness. Stopped
subscriptions and duplicate deliveries do not alert. Metrics have no account, email, remote
resource, token, notification-body, or provider-error dimensions.

## Implementation rules

- Use `providerFetch` for outbound HTTP unless a provider SDK exposes no fetch hook. Configure that
  SDK's connection, greeting, and socket timeouts explicitly instead.
- Keep one provider request bounded even when a later background workflow paginates over many
  requests.
- Persist refreshed OAuth credentials after provider calls that may rotate them.
- Classify provider failures before persistence or public response. Google/X HTTP handling may use
  status and bounded `Retry-After`, but must discard the response body.
- Record only the safe classified failure on the durable account before returning a structured
  `AppError` from sync.
- Do not log authorization codes, tokens, app-specific passwords, encrypted credentials, or raw
  provider payloads.
- Emit connector sync/subscription/notification/trigger events through the allowlisted request-log
  shape with safe category/code, timing, and status only. Never add account email, mailbox identity,
  channel/resource ID, provider token/message/body, or provider text dimensions.
- Treat local mocks as behavior tests, not production-connectivity evidence.

## Required tests and review

For a changed connection flow, test that provider discovery and sync have not run when the
connection method returns, then invoke the sync path explicitly and verify its projection. Exercise
a provider failure and verify that the durable account remains with `syncStatus = error`, typed
recovery, and no raw canary. For a
callback that needs an unavoidable provider exchange, use a deferred bootstrap provider response
to prove the browser redirect does not wait for discovery.

Before approval, answer all of these from the boundary record and diff:

- Does the connect or callback path stop after durable identity and credential persistence?
- Can every provider request or socket fail before the edge timeout?
- Does production egress allow every protocol and port referenced by the connector?
- Does asynchronous work report success or failure durably and have a retry path?
- Do focused tests cover the response boundary and the degraded provider path?
- Do Calendar-only, Mail-only, automatic retry, reconnect, and stale-claim fixtures prove bounded
  due selection and overlapping scheduler safety?
- Which non-destructive production-equivalent check proves the exact granted capability, rather
  than only the presence of a credential?
- Do deployment and architecture docs describe any changed durable behavior?
