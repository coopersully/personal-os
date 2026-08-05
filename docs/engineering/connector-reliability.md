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
backfill, or retries. Those operations start only after the account is durable. Fire-and-forget work
must catch its rejection; the sync service records an execution status plus typed, safe recovery
state before returning an error.

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

## Provider transport inventory

| Capability | Host or class | Protocol | Production egress |
| --- | --- | --- | ---: |
| OAuth and provider APIs | Google, X, Plaid, Pinterest, weather, Resend | HTTPS | TCP 443 |
| iCloud Calendar | `caldav.icloud.com` | HTTPS/CalDAV | TCP 443 |
| iCloud Mail read and projection | `imap.mail.me.com` | IMAP over TLS | TCP 993 |
| iCloud Mail send | `smtp.mail.me.com` | SMTP submission | TCP 587 |

Adding or changing a non-HTTPS transport requires the infrastructure change in the same pull
request. `scripts/check-provider-network-contract.mjs`, run by `pnpm lint`, checks that connector
timeouts remain below the edge timeout and that iCloud's declared ports exist in the application
security group.

Production injects both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` from SSM Parameter Store as
ECS secret references, and API boot validation rejects an empty value. CloudWatch converts only the
safe `connector_sync_failed` event/category fields into aggregate failure and configuration-failure
metrics. Configuration failures alarm immediately; five failures within fifteen minutes trigger a
sustained-volume alarm. Neither metric uses account identity, email, or provider text.

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
- Emit `connector_sync_failed` and `connector_sync_recovered` with stable IDs, category, recovery,
  timing, and status only. Never add account email or provider message dimensions.
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
