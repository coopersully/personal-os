# Notification-Driven Connector Sync Design

## Summary

ilo will add provider notifications as a low-latency signal into the existing durable connector
sync lifecycle. Notifications never project provider data directly and never replace scheduled
reconciliation. A verified notification coalesces an account into durable due work; the existing
fenced incremental sync engine remains the sole projection path.

Google Gmail and Calendar can normally converge within seconds of provider change. iCloud Mail can
use an IMAP IDLE listener as a change signal when runtime capacity permits, and iCloud Calendar can
use advertised WebDAV collection synchronization tokens. Every provider retains the existing
five-minute healthy reconciliation schedule because notification delivery, subscriptions, and
persistent connections can fail silently.

## Goals

- Reduce normal Google Mail and Calendar propagation latency from minutes to seconds.
- Preserve the five-minute healthy freshness objective as a correctness backstop.
- Make notification registration, renewal, expiry, delivery, coalescing, and recovery durable and
  observable.
- Reuse the existing sync claims, generation fencing, incremental tokens, retry policy, and safe
  account health contract.
- Ensure webhook responses are short, authenticated, idempotent, and independent of provider sync
  latency.
- Detect revoked authority quickly without misclassifying transport or notification failures as a
  reconnect requirement.

## Non-goals

- A strict real-time delivery guarantee; providers explicitly allow dropped or delayed signals.
- Performing sync work inside a webhook request.
- Replacing the scheduler or adding unsafe automatic retries to provider mutations.
- Streaming provider content through the webhook payload.
- Guaranteeing IMAP IDLE for every iCloud account in the first rollout; polling remains correct.
- Adding notification support for X or unrelated providers.

## Architecture and ownership

- `packages/domain` owns provider-neutral subscription state and webhook trigger contracts.
- `packages/database` stores subscriptions and durable coalesced sync triggers.
- `packages/connectors` owns Gmail watch, Calendar channel, IMAP IDLE, and WebDAV sync protocol
  details behind capability-specific interfaces.
- `apps/api` owns public webhook ingress, verification, durable acknowledgement, renewal scheduling,
  trigger dispatch, sync claims, and structured events.
- `infra` owns public webhook reachability, Cloud Pub/Sub resources and policy, runtime egress,
  secrets, alarms, and deployment configuration.
- Web and MCP continue reading the existing provider-neutral account health; they do not consume
  webhook state directly.

## Durable subscription model

Create `connector_subscriptions` with one row per provider resource watch:

- `id`, `account_id`, `provider`, and `kind` (`gmail_mailbox`, `google_calendar_list`,
  `google_calendar_events`, or future supported kind);
- opaque `remote_resource_id` and application-generated `channel_id` where required;
- `verification_token_hash` for Calendar notification verification;
- `cursor` for the provider history/sync position when subscription establishment returns one;
- `status`: `pending | active | renewing | expired | failed | stopped`;
- `expires_at`, `renew_after`, `last_notification_at`, `last_verified_at`, `failure_count`,
  `next_attempt_at`, `created_at`, and `updated_at`;
- a stable safe failure code and recovery owner, never a provider response body.

Create `connector_sync_triggers` as a coalescing durable handoff:

- `account_id` primary key;
- `reason`: `initial | notification | reconciliation | manual | retry | recovery`;
- `first_triggered_at`, `last_triggered_at`, and bounded `notification_count`;
- `available_at`, optional current claim ID/expiry, and timestamps.

Multiple notifications for an account update the same trigger row. The reason retains the
highest-priority explanation while the count saturates at a safe bound. No notification payload is
stored. Claim completion deletes the trigger only after the account sync lifecycle durably records
its next state; concurrent triggers arriving during a sync leave or recreate due work.

## Google Gmail flow

### Registration and renewal

After a Google account with Mail capability is durably connected:

1. Create or renew `users.watch` using the production Cloud Pub/Sub topic.
2. Persist the returned `historyId` and provider expiration.
3. Set `renew_after` to a jittered time safely before expiration and at most twenty-four hours after
   successful registration.
4. Renewal creates or updates the same logical mailbox subscription. A failed renewal follows the
   connector retry policy while scheduled reconciliation remains active.

### Delivery

1. Cloud Pub/Sub pushes to an authenticated HTTPS endpoint.
2. Infrastructure and the handler validate the expected Pub/Sub identity/audience before parsing.
3. Decode the bounded message and validate the mailbox identity against the stored account without
   logging it.
4. Compare the provider history cursor only as an opaque monotonic token; duplicate or stale
   notifications are acknowledged safely.
5. Upsert a notification sync trigger and return `204` after the durable write.
6. The scheduler claims the trigger and uses Gmail history-based incremental sync. An invalid or
   unavailable history cursor falls back to a bounded full mailbox reconciliation.

The webhook payload is a signal, not source data. Mail content is fetched through the normal
connector with the account credential and projected through existing transactions.

## Google Calendar flow

### Registration and renewal

1. Watch the user's CalendarList so additions/removals of calendars trigger discovery.
2. Create an Events watch for every enabled remote calendar.
3. Use independent random channel IDs and a random verification token whose hash is stored. Do not
   include account identity, credentials, or sensitive routing data in the channel token.
4. Persist the returned resource ID and expiration.
5. Before expiration, create a replacement channel with a new ID/token, verify its initial `sync`
   notification, then stop the old channel. A bounded overlap is expected and deduplicated.

### Delivery

1. Validate HTTPS request size, required `X-Goog-*` headers, channel ID, resource ID, and
   verification token using constant-time comparison.
2. Reject unknown channels without revealing whether an account exists.
3. Treat message numbers as diagnostic ordering hints, not a gap-free cursor.
4. Upsert a durable account trigger and acknowledge quickly.
5. Run the existing Calendar incremental sync using its stored sync token. A provider `410 Gone`
   clears only the affected cursor and performs a controlled full resync.

Calendar notifications can be dropped, so five-minute reconciliation and renewal monitoring remain
mandatory.

## iCloud flow

Apple's current public service boundary uses standard IMAP/SMTP and CalDAV for ilo's existing
connector. The first notification-driven rollout does not invent an unavailable iCloud webhook.

- Mail: a bounded runtime listener may hold IMAP IDLE for healthy Mail-enabled accounts. Any
  unsolicited change only upserts a durable trigger. The listener periodically exits IDLE,
  reconnects with jitter, and yields under shutdown. Connection loss is a retryable listener fault,
  not an account authorization failure unless the protocol positively rejects credentials.
- Calendar: use `DAV:sync-collection` with opaque sync tokens when the server advertises support.
  When unsupported or invalid, retain the existing bounded CalDAV discovery/ETag reconciliation.
- Capacity: listener concurrency is explicitly capped. Accounts without an active listener remain
  fully supported by the five-minute scheduler.

Apple Account authorization should replace app-specific passwords when Apple exposes a supported
integration path available to ilo. Until then, encrypted app-specific passwords remain the
documented fallback and their revocation produces a clear reconnect state.

## Scheduler integration and delivery semantics

The scheduler runs every minute and processes durable triggers before ordinary due reconciliation,
subject to the same global and per-provider concurrency limits. Webhook handling does not wait for
the minute tick: after committing a trigger, it may send a non-authoritative in-process wake signal
to an already-running dispatcher. Process loss can lose the wake signal but not the trigger.

Sync remains at-least-once and idempotent:

- claim fencing prevents concurrent projection for one account;
- provider IDs, revisions, history IDs, sync tokens, and projection transactions deduplicate work;
- notification bursts coalesce into one account trigger;
- a trigger arriving during sync guarantees another due pass unless the completed sync cursor is
  demonstrably at or beyond it;
- retryable sync failure retains or recreates due work using existing backoff;
- reconnect-required accounts stop provider watches/listeners where authority permits and do not
  consume repeated sync attempts.

## Health, observation, and user experience

The existing account health contract remains authoritative. Notification infrastructure is not
shown as a separate user setting because scheduled reconciliation preserves correctness. A healthy
account may expose `lastSyncedAt` and “Updates automatically”; it must not promise instant delivery.

Operator events:

- `connector_subscription_started`, `renewed`, `expired`, `failed`, and `recovered`;
- `connector_notification_received`, `rejected`, and `coalesced`;
- existing sync failed/recovered events include the safe trigger reason.

Metrics and alarms cover active subscriptions by kind, renewal lag, subscriptions expiring within
the safety window, verified delivery age, rejected webhook volume, durable trigger age, scheduler
lag, and sync freshness. Logs contain account/subscription opaque IDs, provider, safe kind/code,
duration, and correlation only. They exclude mailbox identity, calendar identity, channel token,
Pub/Sub body, headers containing secrets, provider payloads, credentials, and content.

A subscription failure alone does not place the user account in “Needs attention” while scheduled
sync remains fresh. If both notification and reconciliation paths fail, the existing account health
state presents retry, service attention, or reconnect according to the actual sync failure.

## Infrastructure contract

Google Gmail push requires a production Cloud Pub/Sub topic, a subscription or authenticated push
delivery configuration, permission for Google's Gmail publishing service account, and a stable
public HTTPS endpoint. Calendar requires a separate stable public HTTPS webhook route and does not
use Pub/Sub.

Infrastructure must provide:

- least-privileged topic publish and API receive identities;
- exact push audience and service-account validation;
- WAF rules that permit verified provider delivery without broadly exempting unrelated traffic;
- request size and rate bounds appropriate to empty Calendar bodies and small Pub/Sub envelopes;
- outbound Google/IMAP/CalDAV network policy aligned with the connector reliability contract;
- secrets and runtime values through the established parameter path, never Terraform plaintext;
- deployment checks that fail closed when notification mode is enabled without its required
  resource identifiers or authority.

Notification support is feature-gated per provider. Deployment may enable Calendar, Gmail, and
iCloud listener modes independently. Disabled notification mode always leaves five-minute
reconciliation operational.

## External-boundary record

| Concern | Contract |
| --- | --- |
| Capability and owner | Providers signal change; API webhook/listener ingress durably coalesces work; connector sync remains the projection owner. |
| Configuration and authority | Google project/topic/push identity and per-account scopes authorize watches; iCloud credentials authorize IMAP/CalDAV; webhook tokens authenticate Calendar channels. |
| Transport | Google HTTPS on TCP 443, Pub/Sub authenticated push, iCloud IMAPS on TCP 993, and CalDAV HTTPS on TCP 443. |
| Time and capacity | Webhooks only validate and commit; provider sync is background; subscriptions renew before expiry; listener, trigger, page, and worker concurrency are bounded. |
| Commit point | Upserted `connector_sync_triggers` row. Provider acknowledgement occurs only after that write. |
| Delivery semantics | Signals can duplicate, reorder, expire, or disappear. Coalescing, fenced incremental sync, full-sync fallback, and five-minute reconciliation guarantee convergence. |
| Degraded behavior | Subscription failure is operator-visible while reconciliation stays healthy; account health changes only from actual freshness/authority failure. |
| Recovery and observation | Durable renewal attempts, startup recovery, expiry alarms, trigger-age alarms, scheduled reconciliation, safe events, and manual sync provide repair. |
| Evidence | Protocol unit tests, repository/API integration tests, webhook authentication tests, infrastructure contract checks, production watch registration, controlled provider changes, and fallback observation. |

## Testing strategy

1. Repository integration tests cover subscription lifecycle, renewal claims, trigger coalescing,
   triggers arriving during sync, stale claims, and process restart.
2. Gmail connector tests cover watch registration/renewal, history cursor use, duplicate
   notification, invalid cursor fallback, revocation, rate limit, and safe provider errors.
3. Calendar connector tests cover CalendarList and per-calendar watch lifecycle, verification
   tokens, renewal overlap, duplicate messages, invalid sync token, and channel stop.
4. Webhook tests exercise authentication, audience, headers, payload bounds, unknown channel,
   spoofing, replay, burst coalescing, durable acknowledgement, and provider retry status behavior.
5. iCloud tests cover IDLE change signals, reconnect/shutdown, positive authentication rejection,
   listener-cap fallback, WebDAV sync-token support, and ETag fallback.
6. Privacy canaries prove webhook payloads, mailbox/calendar identities, verification tokens,
   credentials, and provider response material never enter logs, account errors, metrics, API
   responses, or rendered UI.
7. Infrastructure checks prove topic policy, authenticated push audience, endpoint reachability,
   WAF scope, runtime feature-gate completeness, egress, metrics, and alarms.
8. Existing scheduler tests continue proving every enabled account is reconciled at least every
   five minutes when healthy, including with notifications disabled.

## Phased rollout

1. Land additive subscription/trigger storage and disabled feature gates.
2. Enable Calendar webhook ingress and renewal for one production Google account. Verify a calendar
   change converges through the durable trigger and a dropped-signal simulation converges through
   reconciliation.
3. Enable Gmail Pub/Sub for one account. Verify mailbox history convergence, daily renewal, and
   revocation recovery before expanding.
4. Expand Google notification mode account-by-account while monitoring renewal and trigger age.
5. Add bounded iCloud IMAP IDLE only after Google paths are stable; keep polling-only accounts as a
   supported operating mode.
6. Enable WebDAV sync-token optimization only where capability discovery proves support.

Each feature gate can be disabled without data migration or loss of scheduled synchronization.

## Acceptance criteria

- Verified Google notifications durably enqueue account work and return before provider sync runs.
- Google Mail and Calendar normally converge within seconds while preserving the existing
  five-minute healthy reconciliation objective.
- Gmail and Calendar subscriptions renew before expiration and alert before the safety window is
  exhausted.
- Duplicate, reordered, spoofed, malformed, expired, and burst notifications cannot duplicate
  projections, reveal account existence, or lose the need to sync.
- Dropped notifications, disabled notification mode, process restart, and subscription failure all
  converge through durable scheduled reconciliation.
- iCloud listener failure never disables polling or falsely requests reconnect.
- Raw webhook/provider material and account identities do not enter logs, metrics, durable safe
  errors, APIs, or UI.
- Focused tests, infrastructure contract checks, production-equivalent webhook evidence, and the
  repository verification gate pass.

