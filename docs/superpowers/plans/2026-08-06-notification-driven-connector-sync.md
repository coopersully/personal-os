# Notification-Driven Connector Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add low-latency Google Mail/Calendar and bounded iCloud Mail change signals that durably coalesce into the existing fenced incremental sync engine while five-minute reconciliation remains authoritative.

**Architecture:** Provider notifications only create one durable trigger per account; they never project data. A subscription repository owns watch/lease lifecycle, webhook routes authenticate and acknowledge only after trigger commit, and the existing scheduler drains triggers before ordinary due accounts. Google uses Gmail Pub/Sub and Calendar channels; iCloud uses a leased IMAP IDLE listener when enabled. All modes are independently feature-gated and polling remains fully functional.

**Tech Stack:** TypeScript, Zod, Hono, Drizzle/PostgreSQL, Google Gmail/Calendar REST APIs, Cloud Pub/Sub authenticated push, `jose`, ImapFlow, AWS ECS/ALB/WAF/CloudWatch Terraform, Vitest, Playwright.

## Global Constraints

- Notification delivery is a latency hint, never the source of truth and never a strict real-time guarantee.
- The durable commit point is an upserted `connector_sync_triggers` row; webhook/provider acknowledgement occurs only after it commits.
- Healthy accounts remain due at least every five minutes with notifications disabled, expired, dropped, or unavailable.
- Webhook handlers do not refresh tokens, call provider sync APIs, discover sources, or project content.
- Subscription and trigger work is bounded, idempotent, restart-safe, and safe with two overlapping ECS tasks.
- Gmail push requires authenticated Pub/Sub OIDC with exact audience and service-account email; Calendar requires channel ID/resource ID plus constant-time verification-token comparison.
- No webhook body, mailbox/calendar identity, channel token, authorization header, provider response, or credential enters logs, metrics, public APIs, account errors, or UI.
- Notification feature gates fail closed when enabled without complete configuration and do not affect reconciliation when disabled.
- Existing migration history is immutable. This plan adds `0052_connector_notifications.sql` after the authorization plan's `0051` migration.
- Strict red-green-refactor applies to every production behavior.

---

### Task 1: Subscription and trigger domain/storage contracts

**Files:**
- Modify: `packages/domain/src/connection.ts`
- Modify: `packages/domain/src/domain.test.ts`
- Modify: `packages/database/src/schema.ts`
- Create: `packages/database/migrations/0052_connector_notifications.sql`
- Modify: `packages/database/migrations/meta/_journal.json`
- Modify: `packages/database/src/schema.test.ts`
- Modify: `apps/api/src/icloud-uidvalidity-migration.integration.test.ts`

**Interfaces:**
- Produces `ConnectorSubscriptionKind`, `ConnectorSubscriptionStatus`, and `ConnectorSyncTriggerReason`.
- Produces Drizzle tables `connectorSubscriptions` and `connectorSyncTriggers` plus
  `calendarAccounts.mailSyncToken`.

- [x] **Step 1: Write failing domain/schema/migration tests**

Assert literal enum members and migration preservation from `0051`. Insert duplicate trigger rows
for one account and prove the primary key prevents two durable work records. Assert account deletion
cascades subscriptions/triggers and user deletion still cascades through the account.

- [x] **Step 2: Run and verify RED**

Run: `pnpm vitest run packages/domain/src/domain.test.ts packages/database/src/schema.test.ts apps/api/src/icloud-uidvalidity-migration.integration.test.ts`

Expected: FAIL because the contracts, tables, column, and migration are absent.

- [x] **Step 3: Add exact domain enums**

```ts
export const connectorSubscriptionKindSchema = z.enum([
  "gmail_mailbox",
  "google_calendar_list",
  "google_calendar_events",
  "icloud_mail_idle",
]);
export const connectorSubscriptionStatusSchema = z.enum([
  "pending",
  "active",
  "renewing",
  "expired",
  "failed",
  "stopped",
]);
export const connectorSyncTriggerReasonSchema = z.enum([
  "initial",
  "notification",
  "reconciliation",
  "manual",
  "retry",
  "recovery",
]);
```

- [x] **Step 4: Add exact Drizzle storage**

`connectorSubscriptions` has these exact fields:

```ts
id: uuid("id").primaryKey().defaultRandom(),
accountId: uuid("account_id").notNull().references(() => calendarAccounts.id, { onDelete: "cascade" }),
provider: text("provider").$type<"google" | "icloud">().notNull(),
kind: text("kind").$type<ConnectorSubscriptionKind>().notNull(),
calendarId: uuid("calendar_id").references(() => calendars.id, { onDelete: "cascade" }),
channelId: text("channel_id"),
remoteResourceId: text("remote_resource_id"),
remoteIdentityHash: text("remote_identity_hash"),
verificationTokenHash: text("verification_token_hash"),
providerCursor: text("provider_cursor"),
status: text("status").$type<ConnectorSubscriptionStatus>().notNull().default("pending"),
expiresAt: timestamp("expires_at", { withTimezone: true }),
renewAfter: timestamp("renew_after", { withTimezone: true }),
lastNotificationAt: timestamp("last_notification_at", { withTimezone: true }),
lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
failureCount: integer("failure_count").notNull().default(0),
safeFailureCode: text("safe_failure_code"),
nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
leaseClaimId: uuid("lease_claim_id"),
leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
```

Unique indexes cover `(account_id, kind, calendar_id)` with `NULLS NOT DISTINCT` and nullable
`channel_id`. Checks enforce nonnegative failure count and claim-ID/expiry pairing.

`connectorSyncTriggers` has these exact fields:

```ts
accountId: uuid("account_id").primaryKey().references(() => calendarAccounts.id, { onDelete: "cascade" }),
reason: text("reason").$type<ConnectorSyncTriggerReason>().notNull(),
firstTriggeredAt: timestamp("first_triggered_at", { withTimezone: true }).notNull(),
lastTriggeredAt: timestamp("last_triggered_at", { withTimezone: true }).notNull(),
notificationCount: integer("notification_count").notNull().default(1),
availableAt: timestamp("available_at", { withTimezone: true }).notNull(),
claimId: uuid("claim_id"),
claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }),
createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
```

Checks enforce `1 <= notification_count <= 1000000`, `first_triggered_at <= last_triggered_at`, and
claim-ID/expiry pairing.

- [x] **Step 5: Add additive migration `0052`**

Use explicit `CREATE TABLE`, check constraints for every enum/count/claim invariant, FKs with
`ON DELETE CASCADE`, unique indexes described in Step 4, and:

```sql
ALTER TABLE "calendar_accounts" ADD COLUMN "mail_sync_token" text;
```

Append journal index `52`; do not rewrite snapshots or older migrations.

- [x] **Step 6: Run and verify GREEN**

Run the command from Step 2. Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add packages/domain packages/database apps/api/src/icloud-uidvalidity-migration.integration.test.ts
git commit -m "feat: persist connector notification lifecycle"
```

### Task 2: Durable trigger coalescing and fenced dispatch

**Files:**
- Create: `apps/api/src/connector-notification-service.ts`
- Create: `apps/api/src/connector-notification-service.integration.test.ts`
- Modify: `apps/api/src/connector-service.ts`
- Modify: `apps/api/src/connector-service.integration.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/main.ts`

**Interfaces:**
- Produces:

```ts
enqueue(accountId, reason, at?): Promise<void>;
claimDueTriggers(options?): Promise<ClaimedConnectorTrigger[]>;
completeTrigger(claim, observedAt): Promise<void>;
releaseTrigger(claim, availableAt): Promise<void>;
dispatchTriggeredSyncs(options?): Promise<{ attempted: number; failed: number; succeeded: number }>;
```

- [x] **Step 1: Write failing repository integration tests**

Cover first insert, burst coalescing, saturating count, reason priority, concurrent enqueue, bounded
claim with `SKIP LOCKED`, stale claim recovery, trigger arriving during a sync, success deletion,
failure release, reconnect account suppression, and process restart. The key mutation each test
catches is deleting a newer trigger with an older sync claim.

- [x] **Step 2: Run and verify RED**

Run: `pnpm vitest run apps/api/src/connector-notification-service.integration.test.ts`

Expected: FAIL because the notification service does not exist.

- [x] **Step 3: Implement atomic coalescing**

Use one `INSERT ... ON CONFLICT(account_id) DO UPDATE` that preserves earliest first-trigger,
advances last-trigger, chooses reason by the literal priority
`notification > initial > manual > recovery > retry > reconciliation`, and caps count at `1000000`.

- [x] **Step 4: Implement claim/complete semantics**

Claims use a UUID and five-minute lease. Completion deletes only when `last_triggered_at <=` the
claim's observed timestamp; otherwise it clears the claim and leaves the newer work available now.
Release clears the claim and sets bounded retry availability.

- [x] **Step 5: Dispatch triggers before ordinary reconciliation**

Call existing `syncAccount`; never duplicate projection logic. `syncDueConnectors` first drains a
bounded trigger batch, then calls the existing due-account scheduler with the remaining capacity.
Keep the one-minute durable scheduler. An in-process wake signal may invoke the dispatcher early,
but it is an optimization and has no durability role.

- [x] **Step 6: Run service and scheduler tests and verify GREEN**

Run: `pnpm vitest run apps/api/src/connector-notification-service.integration.test.ts apps/api/src/connector-service.integration.test.ts`

Expected: PASS, including the existing five-minute reconciliation tests.

- [x] **Step 7: Commit**

```bash
git add apps/api/src/connector-notification-service.ts apps/api/src/connector-notification-service.integration.test.ts apps/api/src/connector-service.ts apps/api/src/connector-service.integration.test.ts apps/api/src/app.ts apps/api/src/main.ts
git commit -m "feat: coalesce connector sync triggers durably"
```

### Task 3: Incremental Gmail synchronization

**Files:**
- Modify: `packages/connectors/src/types.ts`
- Modify: `packages/connectors/src/google.ts`
- Modify: `packages/connectors/src/google.test.ts`
- Modify: `packages/connectors/src/icloud.ts`
- Modify: `packages/connectors/src/icloud.test.ts`
- Modify: `apps/api/src/connector-service.ts`
- Modify: `apps/api/src/connector-service.integration.test.ts`

**Interfaces:**
- `syncMail(credentials, syncToken, operation)` returns:

```ts
type MailSyncResult = CredentialResult<{
  deletedThreadIds: string[];
  mailboxes: RemoteMailbox[];
  nextSyncToken: string | null;
  reset: boolean;
  threads: NormalizedRemoteMailThread[];
}>;
```

- [x] **Step 1: Write failing Google connector tests**

Cover full sync obtaining a Gmail profile `historyId`, incremental `users.history.list`
pagination, message-added/deleted/label-added/label-removed histories, deduplicated affected thread
fetch, disappeared thread deletion, malformed history, provider `404` invalid cursor full-reset
fallback, and bounded pages/threads. Derive expected thread IDs literally.

- [x] **Step 2: Run Google test and verify RED**

Run: `pnpm vitest run packages/connectors/src/google.test.ts`

Expected: FAIL on the old `syncMail` contract.

- [x] **Step 3: Implement bounded Gmail full and incremental paths**

Full sync retains the current 100-thread bound and returns the profile history ID. Incremental sync
uses the stored history token, accumulates affected thread IDs across bounded pages, fetches each
current thread once, emits explicit deleted thread IDs for definitive `404`, and returns the latest
history ID. Provider cursor invalidation calls the full path with `reset = true`.

- [x] **Step 4: Adapt iCloud to the provider-neutral result**

iCloud ignores the incoming token in this task and returns its existing mailboxes/threads with
`deletedThreadIds: []`, `nextSyncToken: null`, and `reset: true`. This preserves current behavior
without inventing IMAP history semantics.

- [x] **Step 5: Write failing projection tests**

Assert `calendar_accounts.mail_sync_token` advances only in the same fenced transaction that
projects mail; explicit deleted thread IDs set `deletedAt`; invalid cursor reset never deletes
unobserved older threads from the bounded full window; a superseded claim cannot advance the token.

- [x] **Step 6: Run projection tests and verify RED**

Run: `pnpm vitest run apps/api/src/connector-service.integration.test.ts packages/connectors/src/icloud.test.ts`

Expected: FAIL on missing token/deletion behavior.

- [x] **Step 7: Implement fenced projection changes**

Pass `account.mailSyncToken` into the connector. Within `projectMail`, mark only explicit
`deletedThreadIds`, then update `mailSyncToken` under the existing generation/claim guard. Never
infer deletion from absence in a bounded result.

- [x] **Step 8: Run all focused tests and verify GREEN**

Run: `pnpm vitest run packages/connectors/src/google.test.ts packages/connectors/src/icloud.test.ts apps/api/src/connector-service.integration.test.ts`

Expected: PASS.

- [x] **Step 9: Commit**

```bash
git add packages/connectors apps/api/src/connector-service.ts apps/api/src/connector-service.integration.test.ts
git commit -m "feat: synchronize Gmail incrementally"
```

### Task 4: Google watch connector methods and subscription renewal

**Files:**
- Modify: `packages/connectors/src/types.ts`
- Modify: `packages/connectors/src/google.ts`
- Modify: `packages/connectors/src/google.test.ts`
- Modify: `apps/api/src/connector-notification-service.ts`
- Modify: `apps/api/src/connector-notification-service.integration.test.ts`

**Interfaces:**
- Produces `watchGmail`, `watchCalendarList`, `watchCalendarEvents`, and `stopCalendarWatch` on
  `GoogleConnector`.
- Produces `renewDueSubscriptions({ concurrency, limit })`.

- [x] **Step 1: Write failing provider tests**

Assert exact Gmail topic request and parsed history/expiration; Calendar watch request channel ID,
webhook URL, token, expiration; channel stop request; token refresh persistence; bounded provider
errors; and absence of raw response bodies. Include malformed/missing expiration fixtures.

- [x] **Step 2: Run and verify RED**

Run: `pnpm vitest run packages/connectors/src/google.test.ts`

Expected: FAIL because watch methods do not exist.

- [x] **Step 3: Implement provider watch methods**

All methods use the existing authenticated request/timeout/error boundary and return rotated
credentials. Gmail requires `gmail.modify`; Calendar watches require their existing Calendar
scopes. Calendar tokens are caller-generated and never logged.

- [x] **Step 4: Write failing renewal lifecycle tests**

Cover initial registration after connection, Gmail renewal at most twenty-four hours after success
and before provider expiry, Calendar replacement overlap, verified new-channel activation before old
stop, failed renewal backoff, expired subscription recovery, reconnect suppression, bounded
concurrency, and two schedulers claiming once.

- [x] **Step 5: Run renewal tests and verify RED**

Run: `pnpm vitest run apps/api/src/connector-notification-service.integration.test.ts`

Expected: FAIL on missing renewal behavior.

- [x] **Step 6: Implement durable renewal claims**

Use subscription lease ID/expiry and the connector retry schedule. Store remote IDs/cursors and
expiration, hash Calendar verification tokens, encrypt the raw token needed only for replacement
validation, and persist rotated Google credentials under an account generation-safe update.

- [x] **Step 7: Run and verify GREEN**

Run both commands from Steps 2 and 5. Expected: PASS.

- [x] **Step 8: Commit**

```bash
git add packages/connectors apps/api/src/connector-notification-service.ts apps/api/src/connector-notification-service.integration.test.ts
git commit -m "feat: renew Google connector watches"
```

### Task 5: Authenticated Gmail Pub/Sub webhook

**Files:**
- Modify: `apps/api/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `apps/api/src/google-pubsub-auth.ts`
- Create: `apps/api/src/google-pubsub-auth.test.ts`
- Modify: `apps/api/src/config.ts`
- Modify: `apps/api/src/config.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/app.integration.test.ts`
- Modify: `apps/api/src/openapi.ts`

**Interfaces:**
- Adds optional config: `googleGmailPushEnabled`, `googleGmailPubsubTopic`,
  `googleGmailPushAudience`, `googleGmailPushServiceAccount`.
- `POST /v1/connectors/google/gmail/notifications` returns `204` only after durable trigger commit.

- [x] **Step 1: Write failing OIDC verification tests**

Using local ES256 test keys/JWKS, cover valid signature, exact `aud`, exact service-account email,
`email_verified`, issuer, expiry, missing bearer token, algorithm confusion, and remote-JWKS timeout.
Assert authentication errors reveal no account/subscription existence.

- [x] **Step 2: Run and verify RED**

Run: `pnpm vitest run apps/api/src/google-pubsub-auth.test.ts`

Expected: FAIL because verifier and `jose` dependency are absent.

- [x] **Step 3: Add `jose` and implement verifier**

Use `createRemoteJWKSet` with Google's documented JWKS, `jwtVerify`, exact issuer/audience, and
constant expected service-account email. Inject the JWKS verifier in tests; do not call the network.

- [x] **Step 4: Write failing config and webhook tests**

Config must fail closed in production when Gmail push is enabled with any missing value. Webhook
tests cover bounded JSON/base64 decoding, expected Pub/Sub subscription, mailbox-identity hash,
unknown account, duplicate/stale history ID, burst coalescing, malformed payload, durable-write
failure, and privacy canaries. Provider retryable server failure returns `503`; invalid/spoofed
delivery returns generic `404` or `401` without account detail.

- [x] **Step 5: Run and verify RED**

Run: `pnpm vitest run apps/api/src/config.test.ts apps/api/src/app.integration.test.ts`

Expected: FAIL on missing config/route.

- [x] **Step 6: Implement bounded webhook route**

Authenticate before body processing, cap request bytes, parse the Pub/Sub envelope with Zod, HMAC
the normalized mailbox identity using the application privacy key, find the active subscription,
advance only safe cursor metadata, enqueue one notification trigger, then return `204`.

- [x] **Step 7: Update OpenAPI and run GREEN**

Run the commands from Steps 2 and 5. Expected: PASS.

- [x] **Step 8: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml apps/api/src/google-pubsub-auth.ts apps/api/src/google-pubsub-auth.test.ts apps/api/src/config.ts apps/api/src/config.test.ts apps/api/src/app.ts apps/api/src/app.integration.test.ts apps/api/src/openapi.ts
git commit -m "feat: receive authenticated Gmail notifications"
```

### Task 6: Verified Google Calendar webhook

**Files:**
- Modify: `apps/api/src/config.ts`
- Modify: `apps/api/src/config.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/app.integration.test.ts`
- Modify: `apps/api/src/openapi.ts`

**Interfaces:**
- Adds `googleCalendarPushEnabled` and `googleCalendarWebhookUrl`.
- `POST /v1/connectors/google/calendar/notifications` returns `204` after trigger commit.

- [x] **Step 1: Write failing config/webhook tests**

Cover exact webhook HTTPS URL validation, required `X-Goog-Channel-ID`, resource ID/state/message
number, constant-time token comparison, unknown/stopped/expired channel, initial `sync`, duplicate
message, renewal overlap, malformed/oversized headers, durable-write failure, and privacy canaries.

- [x] **Step 2: Run and verify RED**

Run: `pnpm vitest run apps/api/src/config.test.ts apps/api/src/app.integration.test.ts`

Expected: FAIL because Calendar notification ingress is absent.

- [x] **Step 3: Implement verified header-only ingress**

Load subscription by opaque channel ID, compare resource ID and hashed token, update verification
and delivery timestamps, enqueue account work for `exists`/`not_exists`, activate a renewing channel
on `sync`, and acknowledge. Never parse provider content because Calendar notifications have no
resource body.

- [x] **Step 4: Update OpenAPI and run GREEN**

Run the command from Step 2. Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add apps/api/src/config.ts apps/api/src/config.test.ts apps/api/src/app.ts apps/api/src/app.integration.test.ts apps/api/src/openapi.ts
git commit -m "feat: receive verified Calendar notifications"
```

### Task 7: Bounded iCloud IMAP IDLE listener

**Files:**
- Modify: `packages/connectors/src/types.ts`
- Modify: `packages/connectors/src/icloud.ts`
- Modify: `packages/connectors/src/icloud.test.ts`
- Modify: `apps/api/src/config.ts`
- Modify: `apps/api/src/config.test.ts`
- Modify: `apps/api/src/connector-notification-service.ts`
- Modify: `apps/api/src/connector-notification-service.integration.test.ts`
- Modify: `apps/api/src/main.ts`

**Interfaces:**
- `ICloudConnector.listenForMailChanges(credentials, onChange, operation): Promise<void>`.
- Adds `icloudMailIdleEnabled` and `icloudMailIdleConcurrency` (default disabled and `5`).

- [x] **Step 1: Write failing connector tests**

With a faithful ImapFlow double, cover connect, INBOX select, exists/expunge/flags change signal,
notification coalescing, periodic IDLE exit/re-entry, abort, server close, reconnect classification,
and positive authentication rejection. Assert transport loss is retryable and never reconnect-owned.

- [x] **Step 2: Run and verify RED**

Run: `pnpm vitest run packages/connectors/src/icloud.test.ts`

Expected: FAIL because the listener interface is absent.

- [x] **Step 3: Implement the bounded connector listener**

Use ImapFlow events only as signals. Never normalize/project inside the listener. Close on abort,
bound each session to twenty-five minutes, and let the supervisor reconnect with jitter.

- [x] **Step 4: Write failing supervisor/lease tests**

Cover disabled mode, concurrency cap, per-account database lease, two ECS supervisors, stale lease,
graceful shutdown, trigger enqueue, listener failure backoff, reconnect-required suppression, and
polling continuation while no listener slot is available.

- [x] **Step 5: Run and verify RED**

Run: `pnpm vitest run apps/api/src/connector-notification-service.integration.test.ts apps/api/src/config.test.ts`

Expected: FAIL on missing supervisor/config behavior.

- [x] **Step 6: Implement supervisor and main lifecycle**

Claim at most configured active subscriptions with five-minute renewable leases. Start listeners
under the API shutdown signal; each change calls only `enqueue`. Never alter `nextSyncAt` or account
health because a listener failed.

- [x] **Step 7: Run and verify GREEN**

Run both commands from Steps 2 and 5. Expected: PASS.

- [x] **Step 8: Commit**

```bash
git add packages/connectors apps/api/src/config.ts apps/api/src/config.test.ts apps/api/src/connector-notification-service.ts apps/api/src/connector-notification-service.integration.test.ts apps/api/src/main.ts
git commit -m "feat: add bounded iCloud Mail change signals"
```

### Task 8: iCloud CalDAV collection synchronization

**Files:**
- Modify: `packages/connectors/src/icloud.ts`
- Modify: `packages/connectors/src/icloud.test.ts`
- Modify: `packages/connectors/src/types.ts`
- Modify: `apps/api/src/connector-service.integration.test.ts`

**Interfaces:**
- `syncCalendar` keeps its provider-neutral signature and returns incremental changes with an opaque
  WebDAV sync token when the calendar advertises `syncCollection`; unsupported servers retain the
  current bounded ctag/ETag full reconciliation.

- [x] **Step 1: Write failing connector tests**

Cover advertised `syncCollection`, initial empty-token report, subsequent opaque token, changed
object fetch, removed resource mapping to delete, truncated response continuation, invalid token
full fallback, unsupported-report ctag fallback, and provider timeout/authorization classification.
Assert the client never interprets or logs token contents.

- [x] **Step 2: Run and verify RED**

Run: `pnpm vitest run packages/connectors/src/icloud.test.ts`

Expected: FAIL because iCloud currently ignores `syncToken` and always performs full fetch.

- [x] **Step 3: Implement capability-discovered incremental sync**

Use the existing tsdav client's `supportedReportSet` and `syncCollection` methods. Request only
resource href and ETag metadata, fetch changed objects through bounded multiget/object calls,
translate definitive removed hrefs to `RemoteEventChange` deletes, and return the server's new
opaque sync token. When the report is unsupported or the token is invalid, run the current bounded
full path with `reset = true` and its ctag fallback token.

- [x] **Step 4: Add claim/projection regression coverage**

Prove the existing Calendar projection stores the new token only under its fenced claim, replays
duplicate changes idempotently, and performs a controlled reset without deleting a calendar or
account.

- [x] **Step 5: Run and verify GREEN**

Run: `pnpm vitest run packages/connectors/src/icloud.test.ts apps/api/src/connector-service.integration.test.ts`

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add packages/connectors/src/icloud.ts packages/connectors/src/icloud.test.ts packages/connectors/src/types.ts apps/api/src/connector-service.integration.test.ts
git commit -m "feat: synchronize iCloud calendars incrementally"
```

### Task 9: Runtime infrastructure, feature gates, and observation

**Files:**
- Modify: `infra/variables.tf`
- Modify: `infra/compute.tf`
- Modify: `infra/iam.tf`
- Modify: `infra/waf.tf`
- Modify: `infra/operations.tf`
- Modify: `infra/outputs.tf`
- Modify: `infra/README.md`
- Modify: `scripts/check-provider-network-contract.mjs`
- Modify: `scripts/check-connector-observability-contract.mjs`
- Modify: `.github/scripts/check-connector-observability.mjs`
- Modify: `apps/api/src/types.ts`
- Modify: `docs/engineering/connector-reliability.md`
- Modify: `docs/deployment.md`
- Modify: `docs/product/implementation-log.md`

**Interfaces:**
- Adds independent Terraform/config gates for Gmail push, Calendar push, and iCloud IDLE.
- Adds structured subscription/notification events and CloudWatch renewal/trigger alarms.

- [x] **Step 1: Write failing static contract fixtures**

Mutate each enabled gate to remove one required runtime value, audience, WAF route, ingress policy,
metric, or alarm. The checker must fail every mutation. Add event privacy tests proving the allowed
key set and rejecting identity/token/body canaries.

- [x] **Step 2: Run and verify RED**

Run: `node scripts/check-provider-network-contract.mjs`

Run: `node scripts/check-connector-observability-contract.mjs`

Expected: at least one command fails because notification infrastructure is not declared.

- [x] **Step 3: Add independent runtime gates**

Disabled gates emit no incomplete variables. Enabled Gmail injects topic/audience/service account;
Calendar injects exact public webhook URL; iCloud injects listener enable/concurrency. Keep provider
credentials in Parameter Store and non-secret identifiers in plain environment values.

- [x] **Step 4: Add narrowly scoped ingress and observation**

WAF permits the two exact webhook paths under their authentication/rate bounds, not a provider-wide
IP bypass. Metrics cover subscription failure/expiry, renewal lag, rejected notifications, trigger
age, and sync freshness. Alerts exclude duplicates and expected stopped subscriptions.

- [x] **Step 5: Document the GCP provisioning evidence gap honestly**

Record the required Pub/Sub topic, Gmail publisher grant, push subscription OIDC identity/audience,
Google project verification, and production validation commands. Do not mark Gmail push configured
until the external Google Cloud resources and authority are actually evidenced.

- [x] **Step 6: Run and verify GREEN**

Run the commands from Step 2 plus `terraform -chdir=infra validate`. Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add infra scripts .github/scripts apps/api/src/types.ts docs
git commit -m "chore: harden connector notification operations"
```

### Task 10: Notification acceptance verification

**Files:**
- Modify only owned files when verification exposes a defect.

**Interfaces:**
- No new interface; this task proves delivery, fallback, privacy, and capacity contracts.

- [x] **Step 1: Run focused notification suites**

Run:

```bash
pnpm vitest run packages/connectors/src/google.test.ts packages/connectors/src/icloud.test.ts apps/api/src/connector-notification-service.integration.test.ts apps/api/src/connector-service.integration.test.ts apps/api/src/google-pubsub-auth.test.ts apps/api/src/config.test.ts apps/api/src/app.integration.test.ts
```

Expected: PASS with zero failures.

- [x] **Step 2: Run infrastructure contracts**

Run: `pnpm lint`

Expected: PASS, including provider-network and connector-observability mutation fixtures.

- [x] **Step 3: Run full verification**

Run: `pnpm verify`

Expected: PASS for environment checks, lint, typecheck, coverage, builds, and desktop/mobile E2E.

- [x] **Step 4: Review the boundary matrix and privacy canaries**

Confirm every webhook acknowledges after durable enqueue; no provider sync occurs in ingress; every
notification mode can be disabled without affecting five-minute sync; no raw identity/token/body
appears in logs, metrics, safe errors, API, audit, or UI.

- [x] **Step 5: Record production-equivalent evidence before enabling gates**

For each provider mode, record configured authority, TLS reachability, watch/listener registration,
one controlled change converging through a trigger, one dropped/disabled signal converging through
reconciliation, renewal before expiry, and redacted observation. Leave any gate disabled when its
external evidence is incomplete.

Acceptance result: Google Pub/Sub publisher authority, push OIDC delivery, Calendar channel
delivery, and live renewal remain externally unevidenced, so both Google push gates remain disabled.
Five-minute reconciliation remains authoritative. The independent iCloud IDLE gate also remains
disabled until its production listener lifecycle is evidenced.

- [x] **Step 6: Route any failure back to its owning task**

Do not patch forward from the acceptance task. Reopen the first failing task, repeat its failing
test/minimal implementation/green cycle, and rerun this acceptance task from Step 1.
