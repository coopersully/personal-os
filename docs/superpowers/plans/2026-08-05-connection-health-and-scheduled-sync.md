# Connection Health and Scheduled Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every enabled Google and iCloud Mail or Calendar account a durable five-minute sync lifecycle, safe failure classification, automatic recovery, honest cross-surface health, and production configuration that cannot silently deploy empty.

**Architecture:** Provider packages emit a redacted, structured failure contract; the API maps it into a durable account lifecycle and bounded scheduler; domain/API-client types carry a derived health projection; feature-owned React surfaces render the correct recovery action. PostgreSQL persists retry state across restarts, while Terraform and production startup validation make Parameter Store authoritative for Google configuration and emit redacted operational signals.

**Tech Stack:** TypeScript, Zod, Hono, Drizzle/PostgreSQL, React, TanStack Query, Vitest, Testing Library, Terraform, ECS, SSM Parameter Store, CloudWatch.

## Global Constraints

- Healthy Google and iCloud accounts with Calendar, Mail, or both enabled are due every five minutes.
- Retry delays are one minute, five minutes, fifteen minutes, and then sixty minutes, with deterministic per-account jitter and a bounded provider `Retry-After` extension.
- Provider response bodies, provider-authored free text, credentials, tokens, mail, and calendar contents never enter user-facing fields, API errors, logs, audits, or rendered DOM.
- Only positively identified provider authorization rejection may produce `reconnect`; generic transport and unknown failures remain automatic recovery.
- Existing sync-generation and claim fencing, idempotent projection, quiesce behavior, and no-blind-retry provider mutation rules remain intact.
- Production uses SSM Parameter Store for both Google client ID and client secret and refuses to boot when either is absent.
- The scheduler selects a bounded batch and bounded concurrency; it never fans out over every due account with unbounded `Promise.all`.
- The database migration is additive and backward compatible with the prior application during rollout.
- Rebase the committed design and plan onto the latest `origin/main` before code changes; preserve unrelated user changes and do not use the primary checkout's unpushed state.
- Finish with `pnpm verify` and production-equivalent evidence from the deployed task definition, Google/iCloud sync, two five-minute cycles, and redacted logs.

## File map

### New focused units

- `packages/connectors/src/failures.ts` — provider-neutral `ConnectorError`, safe response parsing, iCloud protocol classification, and serialization-safe metadata.
- `packages/connectors/src/failures.test.ts` — raw-body canaries and classification tests independent of a specific provider connector.
- `packages/domain/src/connection.ts` — account execution status, recovery owner, failure category, and derived public health schemas.
- `apps/api/src/connector-sync-health.ts` — retry timing, deterministic jitter, durable failure projection, public health derivation, and safe `AppError` conversion.
- `apps/api/src/connector-sync-health.test.ts` — pure policy tests for timing, classification mapping, and public state.
- `apps/web/src/features/connections/health.tsx` — reusable connection row status and Mail/Calendar reconnect callout.
- `apps/web/src/features/connections/health.test.tsx` — accessible rendering and action tests for every health state.
- `packages/database/migrations/0050_connector_sync_health.sql` — additive lifecycle columns, constraints, indexes, and safe legacy backfill.

### Existing integration points

- `packages/connectors/src/google.ts`, `icloud.ts`, `x.ts`, `index.ts` and their tests — consume the safe failure unit; never concatenate bodies.
- `packages/database/src/schema.ts`, `schema.test.ts`, and migration journal metadata — declare and verify the durable lifecycle.
- `apps/api/src/connector-service.ts` and integration tests — claim, project, settle, schedule, and observe accounts using the health policy.
- `apps/api/src/app.ts`, `main.ts`, `types.ts`, `config.ts`, and tests — inject redacted observation, run bounded scheduled work, and validate production config.
- `packages/api-client/src/client.ts` and tests — parse and expose the typed health contract.
- `apps/web/src/app.tsx`, `app.test.tsx`, `features/mail/mail.tsx`, and Calendar composition/tests — use the shared health presentation without string matching.
- `infra/locals.tf`, `compute.tf`, `variables.tf`, `operations.tf`, Terraform examples, and `scripts/check-provider-network-contract.mjs` — wire and statically enforce SSM configuration and metrics.
- `docs/engineering/connector-reliability.md`, `settings-ui-standards.md`, `deployment.md`, `infra/README.md`, Calendar/Mail design docs, and `docs/product/implementation-log.md` — record the shipped contract and evidence expectations.

---

### Task 1: Provider-safe connector failure contract

**Files:**
- Create: `packages/connectors/src/failures.ts`
- Create: `packages/connectors/src/failures.test.ts`
- Modify: `packages/connectors/src/google.ts`
- Modify: `packages/connectors/src/google.test.ts`
- Modify: `packages/connectors/src/icloud.ts`
- Modify: `packages/connectors/src/icloud.test.ts`
- Modify: `packages/connectors/src/x.ts`
- Modify: `packages/connectors/src/x.test.ts`
- Modify: `packages/connectors/src/index.ts`

**Interfaces:**
- Produces: `ConnectorFailureCategory`, `ConnectorFailureDisposition`, `ConnectorError`, `connectorHttpError(response, provider)`, `classifyICloudError(service, error)`.
- `ConnectorError` constructor accepts `{ category, code, disposition, message, retryAfterMs?, status? }`; every field is safe to serialize except the original cause, which is not exposed.
- Later tasks consume `ConnectorError.category`, `.code`, `.disposition`, `.retryAfterMs`, and `.status` without inspecting `.message` text.

- [ ] **Step 1: Write failing safe-response and iCloud-classification tests**

```ts
it.each([
  '{"error":{"message":"token=raw-secret","status":"UNAVAILABLE"}}',
  '<html>private upstream failure</html>',
  'x'.repeat(100_000),
])("never exposes a provider body", async (body) => {
  const response = new Response(body, { status: 503 });
  const error = await connectorHttpError(response, "google");

  expect(error).toMatchObject({
    category: "temporary",
    disposition: "retry",
    status: 503,
  });
  expect(JSON.stringify(error)).not.toContain(body.slice(0, 20));
  expect(error.message).toBe("Google is temporarily unavailable.");
});

it("classifies only positive iCloud authentication evidence as reconnect", () => {
  expect(classifyICloudError("mail", { authenticationFailed: true })).toMatchObject({
    category: "authorization",
    disposition: "reconnect",
  });
  expect(classifyICloudError("mail", new Error("socket closed"))).toMatchObject({
    category: "transport",
    disposition: "retry",
  });
});
```

- [ ] **Step 2: Run the focused tests and confirm the contract is absent**

Run: `pnpm vitest run packages/connectors/src/failures.test.ts`

Expected: FAIL because `failures.ts`, `connectorHttpError`, and `classifyICloudError` do not exist.

- [ ] **Step 3: Implement the safe failure type and whitelisted classification**

```ts
export type ConnectorFailureCategory =
  | "authorization"
  | "configuration"
  | "invalid_response"
  | "not_found"
  | "rate_limited"
  | "rejected"
  | "temporary"
  | "transport"
  | "unknown";

export type ConnectorFailureDisposition = "operator" | "reconnect" | "retry";

export class ConnectorError extends Error {
  public readonly category: ConnectorFailureCategory;
  public readonly code: string;
  public readonly disposition: ConnectorFailureDisposition;
  public readonly retryAfterMs: number | null;
  public readonly status: number | null;

  public constructor(input: {
    category: ConnectorFailureCategory;
    code: string;
    disposition: ConnectorFailureDisposition;
    message: string;
    retryAfterMs?: number;
    status?: number;
  }) {
    super(input.message);
    this.name = "ConnectorError";
    this.category = input.category;
    this.code = input.code;
    this.disposition = input.disposition;
    this.retryAfterMs = input.retryAfterMs ?? null;
    this.status = input.status ?? null;
  }
}
```

Implement status-only Google/X classification, parse `Retry-After` as either bounded seconds or a
bounded future HTTP date, and discard the body after a capped drain. Implement iCloud detection
from explicit protocol properties/codes rather than exception text; map all unrecognized socket,
TLS, timeout, and connection failures to `transport/retry`.

- [ ] **Step 4: Replace provider body concatenation and legacy constructor calls**

Change Google and X response handling from `response.text()` interpolation to:

```ts
if (!response.ok) throw await connectorHttpError(response, "google");
```

Move `ConnectorError` out of `google.ts`, export it from `index.ts`, and update Google/iCloud/X
call sites to pass explicit safe category, disposition, code, message, and status. Preserve the
existing special 410 incremental-sync reset behavior by checking `error.status === 410`. Update
every numeric status-range check to guard `error.status !== null` before comparison.

- [ ] **Step 5: Prove provider connectors preserve behavior without raw material**

Run:

```bash
pnpm vitest run \
  packages/connectors/src/failures.test.ts \
  packages/connectors/src/google.test.ts \
  packages/connectors/src/icloud.test.ts \
  packages/connectors/src/x.test.ts
```

Expected: PASS, including canaries that never appear in messages or enumerable properties.

- [ ] **Step 6: Commit the provider boundary**

```bash
git add packages/connectors/src
git commit -m "Harden connector failure classification"
```

---

### Task 2: Typed connection health and additive durable schema

**Files:**
- Create: `packages/domain/src/connection.ts`
- Modify: `packages/domain/src/index.ts`
- Modify: `packages/domain/src/calendar.ts`
- Modify: `packages/domain/src/domain.test.ts`
- Modify: `packages/database/src/schema.ts`
- Modify: `packages/database/src/schema.test.ts`
- Create: `packages/database/migrations/0050_connector_sync_health.sql`
- Modify: `packages/database/migrations/meta/_journal.json`
- Modify: the generated latest Drizzle snapshot under `packages/database/migrations/meta/`

**Interfaces:**
- Produces: `connectorSyncStatusSchema`, `connectorSyncRecoverySchema`, `connectorFailureCategorySchema`, `connectionHealthStateSchema`, `connectedAccountHealthSchema`, and their inferred types.
- Adds database fields `syncErrorCode`, `syncErrorCategory`, `syncRecovery`, `syncFailureCount`, `lastSyncAttemptAt`, and `nextSyncAt`.
- Existing `syncStatus` and `syncClaimId` check remains unchanged.

- [ ] **Step 1: Write failing domain and schema tests**

```ts
expect(
  connectedAccountHealthSchema.parse({
    state: "retrying",
    message: "Google is temporarily unavailable. ilo will retry automatically.",
    nextSyncAt: "2026-08-05T20:05:00.000Z",
    recovery: "automatic",
  }),
).toMatchObject({ state: "retrying", recovery: "automatic" });

const account = getTableConfig(calendarAccounts);
expect(account.columns.map((column) => column.name)).toEqual(
  expect.arrayContaining([
    "sync_error_code",
    "sync_error_category",
    "sync_recovery",
    "sync_failure_count",
    "last_sync_attempt_at",
    "next_sync_at",
  ]),
);
```

Add migration assertions that the SQL sets every legacy non-local error row to safe generic copy,
`automatic` recovery, failure count `1`, and an immediately due `next_sync_at`, without copying
legacy `sync_error` into any new column.

- [ ] **Step 2: Run domain/database tests and confirm new types and columns are missing**

Run: `pnpm vitest run packages/domain/src/domain.test.ts packages/database/src/schema.test.ts`

Expected: FAIL on missing schemas and missing columns.

- [ ] **Step 3: Define the shared health schemas**

```ts
export const connectorSyncStatusSchema = z.enum(["idle", "syncing", "error"]);
export const connectorSyncRecoverySchema = z.enum(["automatic", "operator", "reconnect"]);
export const connectorFailureCategorySchema = z.enum([
  "authorization",
  "configuration",
  "invalid_response",
  "not_found",
  "rate_limited",
  "rejected",
  "temporary",
  "transport",
  "unknown",
]);
export const connectionHealthStateSchema = z.enum([
  "ready",
  "syncing",
  "retrying",
  "reconnect",
  "service_attention",
]);
export const connectedAccountHealthSchema = z.object({
  message: z.string().max(300).nullable(),
  nextSyncAt: isoDateTimeSchema.nullable(),
  recovery: connectorSyncRecoverySchema.nullable(),
  state: connectionHealthStateSchema,
});
```

Use these schemas in Calendar source projections instead of repeating the execution-status enum.

- [ ] **Step 4: Add durable fields, constraints, index, and safe backfill**

Declare the fields in `schema.ts`, including `syncFailureCount` default `0` and nonnegative check.
Add an index supporting scheduler selection on `(sync_status, next_sync_at)` and a recovery
consistency check requiring failure metadata to be null after success.

The SQL migration must:

```sql
ALTER TABLE "calendar_accounts" ADD COLUMN "sync_error_code" text;
ALTER TABLE "calendar_accounts" ADD COLUMN "sync_error_category" text;
ALTER TABLE "calendar_accounts" ADD COLUMN "sync_recovery" text;
ALTER TABLE "calendar_accounts" ADD COLUMN "sync_failure_count" integer DEFAULT 0 NOT NULL;
ALTER TABLE "calendar_accounts" ADD COLUMN "last_sync_attempt_at" timestamptz;
ALTER TABLE "calendar_accounts" ADD COLUMN "next_sync_at" timestamptz;

UPDATE "calendar_accounts"
SET "sync_error" = 'This connection was interrupted. ilo will retry automatically.',
    "sync_error_code" = 'legacy_sync_failure',
    "sync_error_category" = 'unknown',
    "sync_recovery" = 'automatic',
    "sync_failure_count" = 1,
    "next_sync_at" = NOW()
WHERE "provider" <> 'local' AND "sync_status" = 'error';

UPDATE "calendar_accounts"
SET "next_sync_at" = NOW()
WHERE "provider" <> 'local' AND "sync_status" = 'idle' AND "next_sync_at" IS NULL;
```

Generate/update Drizzle metadata using the repository's established migration workflow; do not
hand-edit unrelated snapshots or reorder the journal.

- [ ] **Step 5: Run schema, migration, and domain tests**

Run:

```bash
pnpm vitest run packages/domain/src/domain.test.ts packages/database/src/schema.test.ts
pnpm --filter @personal-os/database typecheck
```

Expected: PASS, with the legacy raw error text absent from migration output values.

- [ ] **Step 6: Commit the durable contract**

```bash
git add packages/domain packages/database
git commit -m "Add durable connector health state"
```

---

### Task 3: Retry policy and safe account-state projection

**Files:**
- Create: `apps/api/src/connector-sync-health.ts`
- Create: `apps/api/src/connector-sync-health.test.ts`
- Modify: `apps/api/src/connector-service.ts`
- Modify: `apps/api/src/connector-service.integration.test.ts`

**Interfaces:**
- Consumes: structured `ConnectorError` from Task 1 and database/domain fields from Task 2.
- Produces: `classifyConnectorSyncFailure(error, provider)`, `connectorRetryAt(input)`, `connectionHealthForAccount(account)`, `connectorSyncAppError(failure, accountId, provider)`.
- `classifyConnectorSyncFailure` always returns safe copy and never returns an unknown exception message.

- [ ] **Step 1: Write failing pure policy tests**

```ts
it.each([
  [1, 60_000],
  [2, 5 * 60_000],
  [3, 15 * 60_000],
  [4, 60 * 60_000],
  [9, 60 * 60_000],
])("backs off failure %i by %i milliseconds before jitter", (failureCount, baseDelayMs) => {
  const next = connectorRetryAt({
    accountId: "11111111-1111-4111-8111-111111111111",
    failureCount,
    now: new Date("2026-08-05T20:00:00.000Z"),
    retryAfterMs: null,
  });
  expect(next.getTime()).toBeGreaterThanOrEqual(Date.parse("2026-08-05T20:00:00.000Z") + baseDelayMs);
  expect(next.getTime()).toBeLessThan(Date.parse("2026-08-05T20:00:00.000Z") + baseDelayMs * 1.1);
});

it("does not trust unknown exception text", () => {
  const failure = classifyConnectorSyncFailure(
    new Error("private provider body token=secret"),
    "google",
  );
  expect(failure).toMatchObject({ category: "unknown", recovery: "automatic" });
  expect(JSON.stringify(failure)).not.toContain("token=secret");
});
```

Also test bounded `Retry-After`, configuration/operator mapping, authorization/reconnect mapping,
ready/syncing/retrying/reconnect/service-attention derivation, and safe `AppError` details.

- [ ] **Step 2: Run the health-policy tests and confirm failure**

Run: `pnpm vitest run apps/api/src/connector-sync-health.test.ts`

Expected: FAIL because the policy module does not exist.

- [ ] **Step 3: Implement pure classification, backoff, and health projection**

```ts
export function classifyConnectorSyncFailure(
  error: unknown,
  provider: "google" | "icloud",
): ConnectorSyncFailure {
  if (error instanceof ConnectorError) {
    return {
      category: error.category,
      code: error.code,
      message: safeConnectorMessage(provider, error.category, error.disposition),
      recovery:
        error.disposition === "reconnect"
          ? "reconnect"
          : error.disposition === "operator"
            ? "operator"
            : "automatic",
      retryAfterMs: error.retryAfterMs,
      status: error.status,
    };
  }
  return {
    category: "unknown",
    code: "connector_unknown_failure",
    message: `${providerLabel(provider)} is temporarily unavailable. ilo will retry automatically.`,
    recovery: "automatic",
    retryAfterMs: null,
    status: null,
  };
}
```

Compute deterministic jitter from a stable hash of account ID and failure count. Cap provider retry
extensions at 24 hours and never schedule earlier than the policy delay.

- [ ] **Step 4: Make sync settlement use classified durable state**

In `syncAccount`:

- record `lastSyncAttemptAt` when the fenced claim is acquired;
- on success clear every failure field, reset count to `0`, and set `nextSyncAt` to completion plus
  five minutes;
- on interruption return to `idle`, `automatic`, and due now;
- on failure classify once, persist only the safe projection, and set `nextSyncAt` from policy for
  `automatic`/`operator` or null for `reconnect`;
- rethrow `connectorSyncAppError`, never the provider error;
- preserve the existing special partial-effect exceptions for provider mutations outside read sync.

- [ ] **Step 5: Add integration tests for every settlement path and canary redaction**

Inject a `ConnectorError` with a secret-shaped cause and assert:

```ts
await expect(service.syncAccount(userId, account.id)).rejects.toMatchObject({
  code: "service_unavailable",
  details: expect.objectContaining({ recovery: "automatic" }),
});
const [failed] = await database.db
  .select()
  .from(calendarAccounts)
  .where(eq(calendarAccounts.id, account.id));
expect(failed).toMatchObject({
  syncErrorCategory: "temporary",
  syncRecovery: "automatic",
  syncStatus: "error",
});
expect(JSON.stringify(failed)).not.toContain("secret-shaped-canary");
```

Cover authorization with `nextSyncAt: null`, success reset, unknown error redaction, provider
configuration failure, interrupted shutdown, and superseded claims.

- [ ] **Step 6: Run focused unit and integration tests**

Run:

```bash
pnpm vitest run \
  apps/api/src/connector-sync-health.test.ts \
  apps/api/src/connector-service.integration.test.ts
```

Expected: PASS with existing sync-generation and quiesce cases unchanged.

- [ ] **Step 7: Commit the lifecycle policy**

```bash
git add apps/api/src/connector-sync-health.ts apps/api/src/connector-sync-health.test.ts \
  apps/api/src/connector-service.ts apps/api/src/connector-service.integration.test.ts
git commit -m "Classify and recover connector sync failures"
```

---

### Task 4: Bounded five-minute scheduler and redacted observation

**Files:**
- Modify: `apps/api/src/connector-service.ts`
- Modify: `apps/api/src/connector-service.integration.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/app.integration.test.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/src/runtime-lifecycle.test.ts`
- Modify: `apps/api/src/types.ts`

**Interfaces:**
- Consumes: `nextSyncAt`, durable claim fields, and failure projection from Tasks 2–3.
- Produces: `syncDueAccounts({ limit?: number, concurrency?: number })` returning `{ attempted, failed, recovered, skipped, succeeded }`.
- Emits only `connector_sync_failed` and `connector_sync_recovered` safe structured records through the injected application logger.

- [ ] **Step 1: Write failing due-selection and concurrency tests**

Create fixtures for a Calendar-only account, Mail-only account, healthy not-yet-due account,
automatic-retry account, reconnect account, and stale claim. Assert the due method:

```ts
await expect(service.syncDueAccounts({ concurrency: 2, limit: 3 })).resolves.toMatchObject({
  attempted: 3,
});
expect(google.syncCalendar).toHaveBeenCalled();
expect(syncMail).toHaveBeenCalled();
expect(reconnectAccountAttempted).toBe(false);
expect(maxObservedConcurrency).toBeLessThanOrEqual(2);
```

Add a second concurrent scheduler invocation and assert claim fencing prevents duplicate provider
work. Add a structured logger spy and assert injected raw canaries are absent from serialized
entries.

- [ ] **Step 2: Run scheduler tests and confirm current selection is wrong**

Run:

```bash
pnpm vitest run \
  apps/api/src/connector-service.integration.test.ts \
  apps/api/src/app.integration.test.ts \
  apps/api/src/runtime-lifecycle.test.ts
```

Expected: FAIL because current scheduling excludes Calendar-only/error accounts and uses unbounded
`Promise.all`.

- [ ] **Step 3: Implement bounded selection and worker execution**

Select non-local accounts where:

```ts
and(
  or(eq(calendarAccounts.calendarEnabled, true), eq(calendarAccounts.mailEnabled, true)),
  or(
    and(ne(calendarAccounts.syncStatus, "syncing"), lte(calendarAccounts.nextSyncAt, now())),
    and(eq(calendarAccounts.syncStatus, "syncing"), lt(calendarAccounts.updatedAt, staleLease)),
  ),
  or(isNull(calendarAccounts.syncRecovery), ne(calendarAccounts.syncRecovery, "reconnect")),
)
```

Order by `nextSyncAt`, cap the query, and run a fixed worker pool. Treat a lost claim as skipped,
settle each account through `syncAccount`, and aggregate results without exposing error messages.

- [ ] **Step 4: Inject observation and separate connector dispatch from automation naming**

Pass an observer/logger dependency into `createConnectorService`. Emit:

```ts
log({
  accountId,
  category: failure.category,
  code: failure.code,
  disposition: failure.recovery,
  durationMs,
  event: "connector_sync_failed",
  failureCount,
  nextSyncAt,
  provider,
  requestId,
  status: failure.status,
});
```

Expose `syncDueConnectors` on `PersonalOsApp`. Invoke it as its own labeled startup and one-minute
background task rather than hiding connector scheduling inside `dispatchDueAutomations`. Preserve
runtime lifecycle drain and stop-order behavior.

- [ ] **Step 5: Prove startup, interval, recovery, and quiesce behavior**

Use fake timers to verify startup invocation, one-minute polling, no work after scheduler stop, and
recovery event emission only when a previously failed account succeeds. Run the focused tests from
Step 2 until all pass.

- [ ] **Step 6: Commit scheduler and observation**

```bash
git add apps/api/src
git commit -m "Schedule bounded connector recovery"
```

---

### Task 5: Safe public API account-health contract

**Files:**
- Modify: `apps/api/src/connector-service.ts`
- Modify: `apps/api/src/app.integration.test.ts`
- Modify: `packages/api-client/src/client.ts`
- Modify: `packages/api-client/src/client.test.ts`
- Modify: `apps/api/src/calendar-service.ts`
- Modify: `apps/api/src/calendar-service.integration.test.ts`
- Modify: `apps/api/src/mail-service.ts`
- Modify: `apps/api/src/mail-service.integration.test.ts`

**Interfaces:**
- Consumes: `connectedAccountHealthSchema` and `connectionHealthForAccount`.
- Produces: `CalendarAccount.health`, safe `syncError`, `lastSyncAttemptAt`, and `nextSyncAt` in API-client responses.
- Calendar and Mail source projections expose the same derived health object.

- [ ] **Step 1: Write failing API and client parsing tests**

```ts
expect(await api.listConnectors()).toEqual([
  expect.objectContaining({
    health: {
      message: "Google is temporarily unavailable. ilo will retry automatically.",
      nextSyncAt: "2026-08-05T20:05:00.000Z",
      recovery: "automatic",
      state: "retrying",
    },
  }),
]);
expect(JSON.stringify(await api.listConnectors())).not.toContain("raw-provider-canary");
```

For manual sync, assert the API returns a non-500 structured service error with safe details and a
request ID, while a subsequent account list returns the matching durable health projection.

- [ ] **Step 2: Run API/client tests and confirm missing health shape**

Run:

```bash
pnpm vitest run \
  apps/api/src/app.integration.test.ts \
  packages/api-client/src/client.test.ts \
  apps/api/src/calendar-service.integration.test.ts \
  apps/api/src/mail-service.integration.test.ts
```

Expected: FAIL because responses contain only raw `syncError`/`syncStatus` fields.

- [ ] **Step 3: Return and parse the provider-neutral health projection**

Add typed response parsing in the API client rather than a hand-written string status:

```ts
export type CalendarAccount = {
  // existing identity and capability fields
  health: ConnectedAccountHealth;
  lastSyncAttemptAt: string | null;
  nextSyncAt: string | null;
  syncError: string | null;
  syncStatus: ConnectorSyncStatus;
};
```

Map account rows once in the connector service, reuse the helper in Calendar and Mail source
projections, and keep legacy safe fields for compatibility. Do not expose internal failure counts or
provider response details.

- [ ] **Step 4: Make manual sync errors structured and safe**

Ensure `POST /v1/connectors/:id/sync` receives only `AppError` from `syncAccount`. Return the
appropriate public service status and stable details `{ accountId, category, provider, recovery,
nextSyncAt }`. Add a canary to the original provider cause and assert it is absent from the response
body and test logger.

- [ ] **Step 5: Run API, client, Calendar, and Mail integration tests**

Run the command from Step 2. Expected: PASS with shared health semantics across every consumer.

- [ ] **Step 6: Commit the public contract**

```bash
git add apps/api/src packages/api-client/src
git commit -m "Expose safe connection health"
```

---

### Task 6: Connection health UI and direct recovery paths

**Files:**
- Create: `apps/web/src/features/connections/health.tsx`
- Create: `apps/web/src/features/connections/health.test.tsx`
- Modify: `apps/web/src/app.tsx`
- Modify: `apps/web/src/app.test.tsx`
- Modify: `apps/web/src/features/mail/mail.tsx`
- Modify: `apps/web/src/features/mail/mail.test.ts`
- Modify: `apps/web/src/app.tsx` (`CalendarPage` composition)
- Modify: `apps/web/src/app.test.tsx` (Calendar connection-health acceptance)
- Modify: `apps/web/src/styles.css` only for connection-health layout not expressible with existing primitives

**Interfaces:**
- Consumes: `CalendarAccount.health`, `lastSyncedAt`, `nextSyncAt`, enabled capabilities, and provider.
- Produces: `ConnectionHealthBadge`, `ConnectionHealthDescription`, and `ConnectionRecoveryAlert`.
- `ConnectionRecoveryAlert` accepts filtered affected accounts and a direct `/settings?section=connections` link; it never receives an exception.

- [ ] **Step 1: Write failing accessible component tests for all five states**

```tsx
it.each([
  ["ready", "Ready"],
  ["syncing", "Syncing"],
  ["retrying", "Retrying automatically"],
  ["reconnect", "Reconnect required"],
  ["service_attention", "ilo is resolving this"],
])("renders %s as %s", (state, label) => {
  render(<ConnectionHealthBadge health={{ ...baseHealth, state }} />);
  expect(screen.getByText(label)).toBeInTheDocument();
});
```

Assert only reconnect state renders a “Reconnect” action, retrying announces the next attempt,
ready shows relative last success, service attention does not blame credentials, and no raw canary
appears in the DOM.

- [ ] **Step 2: Run component tests and confirm components are absent**

Run: `pnpm vitest run apps/web/src/features/connections/health.test.tsx`

Expected: FAIL because the health components do not exist.

- [ ] **Step 3: Implement reusable health presentation using existing UI primitives**

Use Badge, Alert, AlertAction, semantic status/alert roles, existing relative-time formatting, and
plain copy. `ConnectionHealthDescription` derives presentation only from structured health and
timestamps:

```tsx
if (health.state === "retrying") {
  return <>{health.message} Next attempt {formatRelativeTime(health.nextSyncAt)}.</>;
}
if (health.state === "reconnect") return <>{health.message}</>;
return lastSyncedAt ? <>Synced {formatRelativeTime(lastSyncedAt)}</> : <>Ready to sync</>;
```

- [ ] **Step 4: Replace Settings connector error rendering and mutation feedback**

Replace `ConnectorSyncBadge` and direct `account.syncError` rendering with the shared components.
For sync mutation:

```ts
const sync = useMutation({
  mutationFn: api.syncConnector,
  onError: (error) => toast.error(errorMessage(error)),
  onSettled: () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["connectors"] }),
    invalidateMaterial(queryClient),
  ]),
  onSuccess: () => toast.success("Connection synced."),
});
```

Remove the page-level `SettingsError` for connector sync so the durable row is the persistent
truth. Add provider-specific reconnect callbacks: Google begins incremental OAuth for that account;
iCloud opens the credential form with account context instead of requiring disconnect/recreate.

- [ ] **Step 5: Add Mail and Calendar recovery callouts**

Filter only accounts relevant to each feature and render `ConnectionRecoveryAlert` for
`health.state === "reconnect"`. For `retrying`/`service_attention`, show stale freshness in the
feature's existing source summary without a destructive alert. The callout action links directly to
Connections and names the affected account safely.

- [ ] **Step 6: Add query refresh behavior without browser polling storms**

Use a thirty-second connector query refresh while Settings, Mail, or Calendar is mounted, relying on
TanStack Query deduplication and disabling interval work when the document is hidden. Do not trigger
provider sync from the browser.

- [ ] **Step 7: Run component and integrated web tests**

Run:

```bash
pnpm vitest run \
  apps/web/src/features/connections/health.test.tsx \
  apps/web/src/features/mail/mail.test.ts \
  apps/web/src/app.test.tsx
```

Expected: PASS for status copy, single correct action, direct recovery links, toasts, and raw-canary
absence.

- [ ] **Step 8: Commit the product experience**

```bash
git add apps/web/src
git commit -m "Surface actionable connection health"
```

---

### Task 7: Production Google configuration and deployment fail-closed behavior

**Files:**
- Modify: `infra/locals.tf`
- Modify: `infra/compute.tf`
- Modify: `infra/variables.tf`
- Modify: `infra/terraform.tfvars.example`
- Modify: `scripts/check-provider-network-contract.mjs`
- Modify: `apps/api/src/config.ts`
- Modify: `apps/api/src/config.test.ts`
- Modify: `docs/deployment.md`
- Modify: `infra/README.md`

**Interfaces:**
- Consumes: existing SSM parameters `/personal-os/prod/GOOGLE_CLIENT_ID` and `/personal-os/prod/GOOGLE_CLIENT_SECRET` without reading their values into repository state.
- Produces: ECS secret references for both keys and production startup validation.

- [ ] **Step 1: Write failing config and static-contract tests**

```ts
expect(() =>
  loadConfig({
    ...validEnvironment,
    GOOGLE_CLIENT_ID: "",
    GOOGLE_CLIENT_SECRET: "secret",
    NODE_ENV: "production",
  }),
).toThrow("GOOGLE_CLIENT_ID");
```

Extend `check-provider-network-contract.mjs` to assert:

```js
requireSsmRuntimeKey("GOOGLE_CLIENT_ID");
requireSsmRuntimeKey("GOOGLE_CLIENT_SECRET");
if (/name\s*=\s*"GOOGLE_CLIENT_ID"\s*,\s*value\s*=/.test(compute)) {
  throw new Error("Production Google client ID must not be emitted as a plain ECS environment value.");
}
```

- [ ] **Step 2: Run tests and confirm the empty production configuration currently passes**

Run:

```bash
pnpm vitest run apps/api/src/config.test.ts
node scripts/check-provider-network-contract.mjs
```

Expected: FAIL because the current task definition uses `var.google_client_id` and production config
accepts an empty value.

- [ ] **Step 3: Make Parameter Store authoritative for both Google values**

Add `GOOGLE_CLIENT_ID` to `local.runtime_parameter_names`, remove the `google_client_id` Terraform
variable and tfvars example entry, remove the plain environment entry, and add the client ID beside
the secret in ECS `secrets`. Preserve the exact callback environment variable.

- [ ] **Step 4: Add production-only boot validation**

After Zod parsing, validate required hosted capabilities:

```ts
if (value.NODE_ENV === "production") {
  for (const key of ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"] as const) {
    if (!value[key].trim()) throw new Error(`Production requires ${key}.`);
  }
}
```

Development remains allowed to run with Google disabled and continues returning a safe
configuration error from the connector.

- [ ] **Step 5: Update infrastructure and deployment documentation**

State that both values live under the configured SSM prefix, are injected as ECS secret references,
and must be present before a task starts. Remove instructions to duplicate the client ID in untracked
tfvars. Document the least-privileged task-definition inspection that proves references without
printing values.

- [ ] **Step 6: Validate TypeScript and Terraform contracts**

Run:

```bash
pnpm vitest run apps/api/src/config.test.ts
node scripts/check-provider-network-contract.mjs
terraform -chdir=infra fmt -check -recursive
terraform -chdir=infra init -backend=false
terraform -chdir=infra validate
```

Expected: PASS. Inspect `terraform plan` only with the authorized production backend later in the
rollout step; never pass the client ID on a command line or write it into a plan artifact.

- [ ] **Step 7: Commit production configuration hardening**

```bash
git add infra scripts/check-provider-network-contract.mjs apps/api/src/config.ts \
  apps/api/src/config.test.ts docs/deployment.md
git commit -m "Fail closed on Google production config"
```

---

### Task 8: Connector failure metrics and alarms

**Files:**
- Modify: `infra/operations.tf`
- Modify: `scripts/check-provider-network-contract.mjs`
- Modify: `docs/engineering/connector-reliability.md`
- Test: Terraform validation and static contract script

**Interfaces:**
- Consumes: `connector_sync_failed` and `connector_sync_recovered` structured events from Task 4.
- Produces: CloudWatch `ConnectorSyncFailureCount` and `ConnectorConfigurationFailureCount` metrics and alarms.

- [ ] **Step 1: Add failing static assertions for observability resources**

Require log metric patterns that match only safe structured fields:

```js
requireTerraformContract(
  operations,
  /pattern\s*=\s*"\{ \$\.event = \\"connector_sync_failed\\" \}"/,
  "connector sync failure metric",
);
requireTerraformContract(
  operations,
  /\$\.category = \\"configuration\\"/,
  "connector configuration failure metric",
);
```

Run `node scripts/check-provider-network-contract.mjs` and expect failure before resources exist.

- [ ] **Step 2: Add metrics and bounded alarms**

Add log metric filters for all connector failures and configuration failures. Add:

- an immediate alarm for any configuration failure in five minutes;
- a sustained-volume alarm for at least five connector failures in fifteen minutes;
- existing operations-topic alarm and OK actions;
- explicit `treat_missing_data = "notBreaching"`.

Do not add account email, provider body, or message dimensions. CloudWatch dimensions must remain
low-cardinality.

- [ ] **Step 3: Validate observability infrastructure**

Run:

```bash
node scripts/check-provider-network-contract.mjs
terraform -chdir=infra fmt -check -recursive
terraform -chdir=infra validate
```

Expected: PASS with metric filters referencing only event/category keys.

- [ ] **Step 4: Commit operations hardening**

```bash
git add infra/operations.tf scripts/check-provider-network-contract.mjs \
  docs/engineering/connector-reliability.md
git commit -m "Observe connector sync recovery"
```

---

### Task 9: Durable documentation, regression audit, and full local verification

**Files:**
- Modify: `docs/engineering/connector-reliability.md`
- Modify: `docs/engineering/settings-ui-standards.md`
- Modify: `docs/design/pages/calendar.md`
- Create: `docs/design/pages/mail.md`
- Modify: `docs/product/implementation-log.md`
- Modify: `docs/deployment.md` and `infra/README.md` if implementation details changed from Task 7
- Modify: any tests needed to close gaps found by the completion audit

**Interfaces:**
- Consumes: every implemented contract from Tasks 1–8.
- Produces: current durable documentation and a requirement-by-requirement evidence record suitable for the PR work map.

- [ ] **Step 1: Update current docs to match code and remove stale claims**

Document:

- five-minute healthy freshness for Calendar and Mail;
- one/five/fifteen/sixty-minute retry policy;
- reconnect only on positive authorization evidence;
- safe failure-field and structured-log allowlists;
- bounded scheduler selection/concurrency and claim recovery;
- Settings row and Mail/Calendar callout behavior;
- SSM ownership and production boot failure;
- post-deploy evidence and rollback.

Search current docs for text that says error accounts are not retried or that only Mail accounts are
scheduled and replace it with the implemented contract.

- [ ] **Step 2: Run an explicit raw-response and string-inference audit**

Run:

```bash
rg -n 'response\.text\(\).*message|API request failed.*body|syncError\s*\?|includes\(.*syncError|match\(.*syncError' \
  apps packages
rg -n 'Google API request failed|Authentication backend unavailable|Unknown Error\\.' \
  apps packages docs --glob '!docs/superpowers/specs/**'
```

Expected: no connector path concatenates provider bodies and no browser path derives recovery from
error strings. Any legitimate test fixture match must assert redaction and be named accordingly.

- [ ] **Step 3: Run focused connector, API, web, config, and infrastructure suites**

Run:

```bash
pnpm vitest run \
  packages/connectors/src/failures.test.ts \
  packages/connectors/src/google.test.ts \
  packages/connectors/src/icloud.test.ts \
  apps/api/src/connector-sync-health.test.ts \
  apps/api/src/connector-service.integration.test.ts \
  apps/api/src/app.integration.test.ts \
  packages/api-client/src/client.test.ts \
  apps/web/src/features/connections/health.test.tsx \
  apps/web/src/app.test.tsx
node scripts/check-provider-network-contract.mjs
terraform -chdir=infra validate
```

Expected: PASS.

- [ ] **Step 4: Run the repository gate**

Run: `pnpm verify`

Expected: repository mirror checks, lint, type checking, coverage thresholds, production builds, and
desktop/mobile E2E acceptance all pass.

- [ ] **Step 5: Perform the completion audit against every acceptance criterion**

Record evidence for:

```text
[ ] five-minute scheduling covers Calendar-only and Mail-enabled accounts
[ ] retryable errors recover durably without browser action
[ ] only positive authorization evidence produces reconnect
[ ] empty Google production config cannot become a healthy task
[ ] manual sync never adds the generic unexpected-error alert
[ ] raw provider canaries are absent from DB/API/log/audit/DOM tests
[ ] each row has last success, health, and one correct action
[ ] Mail and Calendar link authority failures directly to Connections
[ ] legacy raw error rows are safely replaced
[ ] pnpm verify passes
```

If any item lacks direct evidence, add the missing test or implementation before committing.

- [ ] **Step 6: Commit documentation and verification fixes**

```bash
git add docs apps packages infra scripts
git commit -m "Document reliable connection health"
```

---

### Task 10: Production rollout and post-deploy proof

**Files:**
- No source changes unless production evidence exposes a defect; any repair returns to the relevant prior task with a failing test.
- External evidence: Terraform plan/apply output summary, ECS task definition, deploy run, public endpoints, structured logs, and account freshness timestamps.

**Interfaces:**
- Consumes: merged, verified implementation and existing SSM Google parameters.
- Produces: a healthy deployed task, repaired legacy accounts, two observed scheduler cycles, and safe operational evidence.

- [ ] **Step 1: Inspect the production Terraform plan without exposing values**

Use the authorized backend/profile and review the plan for only intended task-definition,
log-metric, and alarm changes. Summarize resource addresses and actions; do not save or print
parameter values. Abort if the plan contains database deletion, security-group removal, or unrelated
resource replacement.

- [ ] **Step 2: Apply infrastructure and verify ECS references before application deployment**

Apply through the normal authorized Terraform workflow. Inspect the resulting task definition as
booleans/key names only:

```bash
aws --profile default --region us-east-1 ecs describe-task-definition \
  --task-definition personal-os-prod-api \
  --output json |
jq '{
  googleClientIdWired: any(.taskDefinition.containerDefinitions[].secrets[]?; .name == "GOOGLE_CLIENT_ID"),
  googleClientSecretWired: any(.taskDefinition.containerDefinitions[].secrets[]?; .name == "GOOGLE_CLIENT_SECRET"),
  plainGoogleClientId: any(.taskDefinition.containerDefinitions[].environment[]?; .name == "GOOGLE_CLIENT_ID")
}'
```

Expected: both wired booleans true and plain value false.

- [ ] **Step 3: Deploy through the normal release workflow and verify provenance**

Confirm the deployed immutable image SHA matches the merged commit, ECS rollout is complete, and
app/API/MCP public health endpoints pass. Do not treat endpoint health alone as connector proof.

- [ ] **Step 4: Run least-privileged Google and iCloud sync smoke tests**

From the signed-in production UI, trigger one Google and one iCloud sync. Confirm each account
transitions through Syncing to Ready, updates last success, and returns no generic page alert. Do
not alter provider content.

- [ ] **Step 5: Observe two healthy scheduled cycles**

Wait for two five-minute windows while the production task stays running. Refresh account health
after each window and confirm both Calendar-only and Mail-enabled account timestamps advance without
manual sync. Use compact database/log evidence that does not print account email or provider
payloads.

- [ ] **Step 6: Verify redacted failure/recovery observation**

Use a controlled production-equivalent retryable failure, or the safe deployment/config test path
if production fault injection is not authorized. Confirm `connector_sync_failed` and
`connector_sync_recovered` contain only the documented allowlist. Confirm CloudWatch metrics receive
the event without high-cardinality dimensions.

- [ ] **Step 7: Inspect the user experience for legacy cleanup**

Open Settings → Connections, Mail, and Calendar. Confirm no legacy raw Google response or stale
iCloud credential warning remains, each account shows the correct status/action, and reconnect
callouts appear only for positively rejected authority.

- [ ] **Step 8: Record final evidence and close the work**

Attach deploy run, deployed SHA, endpoint results, task-definition boolean inspection, focused sync
results, two-cycle freshness evidence, and redacted log/metric evidence to the PR or implementation
record. If production contradicts a green test, reopen the relevant task and fix the missing
contract before declaring completion.
