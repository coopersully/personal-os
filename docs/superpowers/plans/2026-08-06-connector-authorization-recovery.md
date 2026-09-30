# Connector Authorization Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Google and X browser authorization callback finish on ilo with a durable safe outcome, S256 PKCE, verified granted capabilities, and one clear recovery action.

**Architecture:** Extend the existing `oauth_states` row into the provider-neutral authorization-attempt record. A focused API service owns state creation/consumption/outcomes; provider services exchange codes and persist accounts; callback routes always convert results to allowlisted `303` redirects. The authenticated web client reads a closed public outcome and renders it with the Connections account state.

**Tech Stack:** TypeScript, Zod, Hono, Drizzle/PostgreSQL, Vitest, Testing Library, React Query, React Router, shadcn Alert/Button, Playwright.

## Global Constraints

- Provider access/refresh tokens, authorization codes, raw state, PKCE verifiers, provider messages, identities, and raw scope values never cross a user-visible or log boundary.
- OAuth state lifetime is exactly thirty minutes; closed attempts are owner-visible for twenty-four hours and eligible for deletion after seven days.
- Google and X use Authorization Code with S256 PKCE and exact stored redirect URIs.
- Browser callbacks return `303` with `Cache-Control: no-store`, `Pragma: no-cache`, `Referrer-Policy: no-referrer`, and `X-Content-Type-Options: nosniff`.
- Only stored allowlisted return paths are used. Unknown state returns to `/settings?section=connections` with `connection_result=restart_required`.
- Callback work ends after encrypted credentials/account persistence, a closed outcome, and immediate scheduled-sync eligibility. It never waits for discovery or sync.
- Implementation follows strict red-green-refactor. Every production behavior is preceded by a focused failing test.
- Existing migration history is immutable. Add migration `0051_connector_authorization_attempts.sql` and its journal entry.

---

### Task 1: Public authorization outcome contract

**Files:**
- Modify: `packages/domain/src/connection.ts`
- Modify: `packages/domain/src/domain.test.ts`

**Interfaces:**
- Produces: `connectorAuthorizationProviderSchema`, `connectorAuthorizationStatusSchema`, `connectorAuthorizationOutcomeSchema`, `ConnectorAuthorizationOutcome`.
- Public statuses are `pending | connected | cancelled | expired | permission_incomplete | failed`; internal `processing` is serialized as public `pending` only while a callback is inside its bounded window.

- [ ] **Step 1: Write the failing domain test**

Add literal fixtures that prove safe outcomes parse and attempts containing `providerMessage`,
`state`, `code`, `scope`, `email`, or `requestId` are stripped by parsing:

```ts
expect(
  connectorAuthorizationOutcomeSchema.parse({
    accountId: null,
    provider: "google",
    retryable: true,
    status: "failed",
    providerMessage: "CANARY",
  }),
).toEqual({ accountId: null, provider: "google", retryable: true, status: "failed" });
```

- [ ] **Step 2: Run the domain test and verify RED**

Run: `pnpm vitest run packages/domain/src/domain.test.ts`

Expected: FAIL because `connectorAuthorizationOutcomeSchema` is not exported.

- [ ] **Step 3: Add the minimal schemas**

```ts
export const connectorAuthorizationProviderSchema = z.enum(["google", "x"]);
export const connectorAuthorizationStatusSchema = z.enum([
  "pending",
  "connected",
  "cancelled",
  "expired",
  "permission_incomplete",
  "failed",
]);
export type ConnectorAuthorizationStatus = z.infer<
  typeof connectorAuthorizationStatusSchema
>;
export const connectorAuthorizationOutcomeSchema = z.object({
  accountId: z.uuid().nullable(),
  provider: connectorAuthorizationProviderSchema,
  retryable: z.boolean(),
  status: connectorAuthorizationStatusSchema,
});
export type ConnectorAuthorizationOutcome = z.infer<
  typeof connectorAuthorizationOutcomeSchema
>;
```

- [ ] **Step 4: Run the domain test and verify GREEN**

Run: `pnpm vitest run packages/domain/src/domain.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/connection.ts packages/domain/src/domain.test.ts
git commit -m "feat: define safe connector authorization outcomes"
```

### Task 2: Extend OAuth state into a durable attempt

**Files:**
- Modify: `packages/database/src/schema.ts`
- Create: `packages/database/migrations/0051_connector_authorization_attempts.sql`
- Modify: `packages/database/migrations/meta/_journal.json`
- Modify: `packages/database/src/schema.test.ts`
- Modify: `apps/api/src/icloud-uidvalidity-migration.integration.test.ts`

**Interfaces:**
- Produces on `oauthStates`: `status`, `outcomeCode`, `connectedAccountId`, `redirectUri`, `completedAt`, and `requestId`.
- Internal status type: `pending | processing | connected | cancelled | expired | permission_incomplete | failed`.

- [ ] **Step 1: Write failing schema and migration-preservation tests**

Assert the Drizzle table exposes the six new fields and a database initialized through `0050`
upgrades an existing pending `oauth_states` row to `status = 'pending'` without changing its hash,
provider, expiry, verifier, or return path.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `pnpm vitest run packages/database/src/schema.test.ts apps/api/src/icloud-uidvalidity-migration.integration.test.ts`

Expected: FAIL because the attempt fields and migration do not exist.

- [ ] **Step 3: Add the Drizzle columns and constraints**

```ts
status: text("status")
  .$type<
    | "pending"
    | "processing"
    | "connected"
    | "cancelled"
    | "expired"
    | "permission_incomplete"
    | "failed"
  >()
  .notNull()
  .default("pending"),
outcomeCode: text("outcome_code"),
connectedAccountId: uuid("connected_account_id"),
redirectUri: text("redirect_uri"),
completedAt: timestamp("completed_at", { withTimezone: true }),
requestId: text("request_id"),
```

Add indexes on `(user_id, created_at)` and `(status, expires_at)` plus a check that closed statuses
have `consumed_at` and `completed_at` while `pending` has neither.

- [ ] **Step 4: Add the additive SQL migration**

```sql
ALTER TABLE "oauth_states" ADD COLUMN "status" text DEFAULT 'pending' NOT NULL;
ALTER TABLE "oauth_states" ADD COLUMN "outcome_code" text;
ALTER TABLE "oauth_states" ADD COLUMN "connected_account_id" uuid;
ALTER TABLE "oauth_states" ADD COLUMN "redirect_uri" text;
ALTER TABLE "oauth_states" ADD COLUMN "completed_at" timestamptz;
ALTER TABLE "oauth_states" ADD COLUMN "request_id" text;
--> statement-breakpoint
UPDATE "oauth_states"
SET "status" = 'failed',
    "outcome_code" = 'legacy_consumed',
    "completed_at" = "consumed_at"
WHERE "consumed_at" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_status_check" CHECK (
  "status" IN ('pending','processing','connected','cancelled','expired','permission_incomplete','failed')
) NOT VALID;
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_lifecycle_check" CHECK (
  ("status" = 'pending' AND "consumed_at" IS NULL AND "completed_at" IS NULL)
  OR ("status" = 'processing' AND "consumed_at" IS NOT NULL AND "completed_at" IS NULL)
  OR ("status" IN ('connected','cancelled','expired','permission_incomplete','failed')
      AND "consumed_at" IS NOT NULL AND "completed_at" IS NOT NULL)
) NOT VALID;
ALTER TABLE "oauth_states" VALIDATE CONSTRAINT "oauth_states_status_check";
ALTER TABLE "oauth_states" VALIDATE CONSTRAINT "oauth_states_lifecycle_check";
--> statement-breakpoint
CREATE INDEX "oauth_states_status_expiry_idx" ON "oauth_states" ("status", "expires_at");
CREATE INDEX "oauth_states_user_created_idx" ON "oauth_states" ("user_id", "created_at");
```

Append journal index `51` with tag `0051_connector_authorization_attempts`; do not regenerate or
rewrite earlier snapshots.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `pnpm vitest run packages/database/src/schema.test.ts apps/api/src/icloud-uidvalidity-migration.integration.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/database apps/api/src/icloud-uidvalidity-migration.integration.test.ts
git commit -m "feat: persist connector authorization outcomes"
```

### Task 3: Provider-neutral attempt lifecycle service

**Files:**
- Create: `apps/api/src/connector-authorization-service.ts`
- Create: `apps/api/src/connector-authorization-service.integration.test.ts`
- Modify: `apps/api/src/types.ts`

**Interfaces:**
- Produces:

```ts
type AuthorizationAttemptProvider = "google" | "x";
type AuthorizationAttemptRow = typeof oauthStates.$inferSelect;

createConnectorAuthorizationService(options).create(input): Promise<{
  attemptId: string;
  codeChallenge: string;
  codeVerifier: string;
  state: string;
}>;
createConnectorAuthorizationService(options).consume(provider, state, requestId): Promise<
  | { kind: "ready"; attempt: AuthorizationAttemptRow; codeVerifier: string }
  | { kind: "closed"; attempt: AuthorizationAttemptRow }
  | { kind: "expired"; attempt: AuthorizationAttemptRow }
  | { kind: "invalid" }
>;
createConnectorAuthorizationService(options).close(input): Promise<void>;
createConnectorAuthorizationService(options).publicOutcome(userId, id): Promise<ConnectorAuthorizationOutcome>;
createConnectorAuthorizationService(options).purgeExpired(): Promise<number>;
```

- [ ] **Step 1: Write failing integration tests**

Cover independent random state/UUID, SHA-256 state storage, encrypted verifier storage, S256
challenge, exact metadata persistence, atomic one-time consume, concurrent consume, recognized
expiry, closed replay, interrupted-processing replay, owner-only public lookup, twenty-four-hour
visibility, and seven-day purge. Assert no returned or logged object contains the raw state or
verifier except the one start result used to build the provider request.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run apps/api/src/connector-authorization-service.integration.test.ts`

Expected: FAIL because the service module does not exist.

- [ ] **Step 3: Implement creation and S256 PKCE**

Generate `state = generateToken("oauth")`, `codeVerifier = generateToken("pkce")`, and:

```ts
const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
```

Persist only `hashToken(state)` and `encryptJson({ codeVerifier }, encryptionKey)` with a
thirty-minute expiry and validated metadata.

- [ ] **Step 4: Implement atomic consumption and closure**

Use one `UPDATE ... WHERE token_hash = ? AND provider = ? AND status = 'pending' AND consumed_at IS
NULL AND expires_at > now RETURNING` to claim `processing`. If it does not claim, load the matching
row to distinguish expired, closed replay, processing replay, and invalid state. Closure accepts
only stable codes and clears no credential/account data.

- [ ] **Step 5: Implement owner-only public serialization and purge**

Map `processing` to public `pending`; map all closed rows literally; set `retryable` only for the
stable temporary/interrupted codes. Reject attempts completed more than twenty-four hours ago as
not found. Purge rows with `expires_at < now - 7 days`.

- [ ] **Step 6: Run and verify GREEN**

Run: `pnpm vitest run apps/api/src/connector-authorization-service.integration.test.ts`

Expected: PASS with no output containing privacy canaries.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/connector-authorization-service.ts apps/api/src/connector-authorization-service.integration.test.ts apps/api/src/types.ts
git commit -m "feat: add durable connector authorization attempts"
```

### Task 4: Google PKCE and granted-capability enforcement

**Files:**
- Modify: `packages/connectors/src/types.ts`
- Modify: `packages/connectors/src/google.ts`
- Modify: `packages/connectors/src/google.test.ts`
- Modify: `packages/connectors/src/index.ts`

**Interfaces:**
- `GoogleConnector.authorizationUrl(state, codeChallenge, loginHint?, services?)`.
- `GoogleConnector.exchangeCode(code, codeVerifier)`.
- Produces `googleGrantedServices(credentials): GoogleAuthorizationService[]`.

- [ ] **Step 1: Write failing connector tests**

Assert the authorization URL contains `code_challenge_method=S256` and the literal supplied
challenge, never the verifier. Assert token exchange contains `code_verifier`. Table-drive granted
scope fixtures for full Calendar, incomplete CalendarList-only, full Mail, send-only Mail, combined,
and blank scope. The production change each test catches is accidentally enabling a requested but
ungranted capability.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run packages/connectors/src/google.test.ts`

Expected: FAIL because Google does not yet send PKCE or expose granted services.

- [ ] **Step 3: Change the connector interface and URL**

Add `code_challenge` and `code_challenge_method: "S256"` to the Google URL. Add `code_verifier` to
the token exchange request.

- [ ] **Step 4: Implement literal capability checks**

Calendar requires both `calendar.calendarlist.readonly` and `calendar.events` (or a broader
equivalent); Mail requires `gmail.modify` for read/manage and the requested `gmail.send` authority.
Return only `calendar` and/or `mail`; never return raw scope strings to API callers.

- [ ] **Step 5: Run and verify GREEN**

Run: `pnpm vitest run packages/connectors/src/google.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/connectors/src/types.ts packages/connectors/src/google.ts packages/connectors/src/google.test.ts packages/connectors/src/index.ts
git commit -m "feat: protect Google authorization with PKCE"
```

### Task 5: Complete Google attempts atomically and schedule initial sync

**Files:**
- Modify: `apps/api/src/connector-service.ts`
- Modify: `apps/api/src/connector-service.integration.test.ts`
- Modify: `apps/api/src/app.ts`

**Interfaces:**
- `startGoogleAuthorization` uses the attempt service and returns the provider URL.
- Produces `handleGoogleAuthorizationCallback({ code, error, issuer, requestId, state })` returning
  `{ attemptId: string | null; returnPath: string; status: ConnectorAuthorizationStatus }` without
  exposing provider material.

- [ ] **Step 1: Write failing service tests**

Cover success, target-account match, target mismatch, partial Calendar consent, partial Mail
consent, denial, expiry, unknown state, concurrent callback, token failure, profile failure, and
unexpected exception. Prove success resets all sync failure fields and sets `nextSyncAt` to the
current time instead of launching an in-memory initial sync. Inject raw JSON/HTML/email/code/state
canaries and assert none appears in attempt outcomes or logs.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run apps/api/src/connector-service.integration.test.ts`

Expected: FAIL on missing callback handler, PKCE arguments, and granted capability behavior.

- [ ] **Step 3: Start Google through the attempt service**

Persist `redirectUri = config.googleRedirectUri`, target account, selected services, return path,
and encrypted verifier before returning the Google URL.

- [ ] **Step 4: Implement the bounded callback state machine**

Validate `issuer` as `https://accounts.google.com` when present. Consume the attempt, map
`access_denied` to `cancelled`, exchange with the decrypted verifier, inspect granted services, and
persist account plus closed attempt in the existing account transaction. If any selected service is
missing, close `permission_incomplete` without creating, modifying, or downgrading an account.

- [ ] **Step 5: Remove the in-memory initial-sync handoff**

On connection success set `syncStatus = 'idle'`, `nextSyncAt = now()`, clear safe failure metadata,
and increment generation. Do not call `startBackgroundTask` from the callback.

- [ ] **Step 6: Run and verify GREEN**

Run: `pnpm vitest run apps/api/src/connector-service.integration.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/connector-service.ts apps/api/src/connector-service.integration.test.ts apps/api/src/app.ts
git commit -m "feat: make Google authorization recoverable"
```

### Task 6: Migrate X to the same safe attempt contract

**Files:**
- Modify: `apps/api/src/x-bookmarks-service.ts`
- Modify: `apps/api/src/x-bookmarks-service.integration.test.ts`
- Modify: `apps/api/src/app.ts`

**Interfaces:**
- X start stores `/settings?section=connections` and the exact configured redirect URI.
- Produces `handleAuthorizationCallback` with the same safe callback result as Google.

- [ ] **Step 1: Write failing X tests**

Cover denial, expiry, unknown/replayed state, exchange/profile failure, success, safe redirect path,
and privacy canaries. Assert no callback branch exposes provider error text or raw JSON.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run apps/api/src/x-bookmarks-service.integration.test.ts`

Expected: FAIL because X still throws callback errors and does not close durable outcomes.

- [ ] **Step 3: Use the attempt service in X start and callback**

Reuse its generated verifier/challenge, store the exact X redirect URI, atomically close the
attempt with the X account upsert, and return the allowlisted Connections path.

- [ ] **Step 4: Run and verify GREEN**

Run: `pnpm vitest run apps/api/src/x-bookmarks-service.integration.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/x-bookmarks-service.ts apps/api/src/x-bookmarks-service.integration.test.ts apps/api/src/app.ts
git commit -m "feat: make X authorization recoverable"
```

### Task 7: Browser callback redirect and authenticated outcome endpoint

**Files:**
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/app.integration.test.ts`
- Modify: `apps/api/src/openapi.ts`

**Interfaces:**
- `GET /v1/connectors/authorization-attempts/:id` returns `{ attempt }` to the owning human session.
- Google/X callbacks always return a safe `303`.

- [ ] **Step 1: Write failing HTTP integration tests**

For every Google/X callback branch assert status `303`, allowlisted `Location`, the four security
headers, and absence of injected canaries. Assert unknown/malformed state uses the fixed restart
route. Assert attempt lookup requires authentication, enforces ownership, and returns only the
domain union. Assert callback routes never return `application/json`.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run apps/api/src/app.integration.test.ts`

Expected: FAIL because callback errors currently use JSON and `302`.

- [ ] **Step 3: Add a single safe redirect helper**

```ts
function connectorCallbackRedirect(context: Context<AppEnv>, path: string): Response {
  context.header("Cache-Control", "no-store");
  context.header("Pragma", "no-cache");
  context.header("Referrer-Policy", "no-referrer");
  context.header("X-Content-Type-Options", "nosniff");
  return context.redirect(new URL(path, dependencies.config.appBaseUrl).toString(), 303);
}
```

Build attempt/restart query parameters with `URL`/`URLSearchParams`, never string interpolation of
provider input.

- [ ] **Step 4: Register outcome lookup and update OpenAPI**

Document callback `303` responses and the authenticated attempt endpoint.

- [ ] **Step 5: Run and verify GREEN**

Run: `pnpm vitest run apps/api/src/app.integration.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/app.ts apps/api/src/app.integration.test.ts apps/api/src/openapi.ts
git commit -m "fix: redirect connector callbacks safely"
```

### Task 8: Typed client and Connections recovery UI

**Files:**
- Modify: `packages/api-client/src/client.ts`
- Modify: `packages/api-client/src/client.test.ts`
- Create: `apps/web/src/features/connections/authorization-outcome.tsx`
- Create: `apps/web/src/features/connections/authorization-outcome.test.tsx`
- Modify: `apps/web/src/app.tsx`
- Modify: `apps/web/src/app.test.tsx`

**Interfaces:**
- `api.getConnectorAuthorizationAttempt(id): Promise<ConnectorAuthorizationOutcome>`.
- `ConnectionAuthorizationOutcome` reads `connection_attempt` or `connection_result`, renders one
  Alert, and invokes a supplied provider retry callback.

- [ ] **Step 1: Write failing API-client test**

Assert the exact encoded attempt route and domain parsing; inject extra unsafe response keys and
prove they do not survive the schema.

- [ ] **Step 2: Run API-client test and verify RED**

Run: `pnpm vitest run packages/api-client/src/client.test.ts`

Expected: FAIL because the method does not exist.

- [ ] **Step 3: Add the typed API-client method**

Parse the returned `attempt` with `connectorAuthorizationOutcomeSchema`.

- [ ] **Step 4: Write failing component tests**

Table-drive connected, cancelled, expired, incomplete permission, retryable failure,
non-retryable failure, pending, unknown-state restart, owner lookup failure, dismissal, and retry.
Assert exactly one Alert and at most one recovery button. Assert the component removes only
`connection_attempt`/`connection_result` with `setSearchParams(..., { replace: true })` after the
outcome is loaded while preserving `section=connections`.

- [ ] **Step 5: Run component test and verify RED**

Run: `pnpm vitest run apps/web/src/features/connections/authorization-outcome.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 6: Implement with existing shadcn primitives**

Use `Alert`, `AlertTitle`, `AlertDescription`, `AlertAction`, and `Button`; do not add a custom
callout. Keep the account row authoritative and invalidate `connectors`, Mail, Calendar, and
material queries after `connected`.

- [ ] **Step 7: Wire Connections and Setup**

Render the feature component at the top of Connections. Setup uses the same component/copy when its
stored return path is `/setup`. Desktop retry continues to use the system browser; web retry uses a
full-page assignment.

- [ ] **Step 8: Run UI tests and verify GREEN**

Run: `pnpm vitest run packages/api-client/src/client.test.ts apps/web/src/features/connections/authorization-outcome.test.tsx apps/web/src/app.test.tsx`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/api-client apps/web/src/features/connections apps/web/src/app.tsx apps/web/src/app.test.tsx
git commit -m "feat: show safe connection recovery outcomes"
```

### Task 9: Redacted authorization observation and documentation

**Files:**
- Modify: `apps/api/src/types.ts`
- Modify: `apps/api/src/connector-authorization-service.integration.test.ts`
- Modify: `infra/operations.tf`
- Modify: `scripts/check-provider-network-contract.mjs`
- Modify: `scripts/check-connector-observability-contract.mjs`
- Modify: `.github/scripts/check-connector-observability.mjs`
- Modify: `docs/engineering/connector-reliability.md`
- Modify: `docs/engineering/settings-ui-standards.md`
- Modify: `docs/deployment.md`
- Modify: `docs/product/implementation-log.md`

**Interfaces:**
- Adds safe `connector_authorization_started|completed|failed|recovered` RequestLog events.
- Adds failure metric excluding `cancelled`.

- [ ] **Step 1: Write failing event/privacy tests and infrastructure contract cases**

Assert event keys are limited to event, method, path, status, requestId, attemptId, provider,
outcomeCode, requestedServices, and durationMs. Assert injected identities/provider text never
serialize. Add valid and mutated Terraform fixtures proving cancellation is excluded and failed
authorization is measured.

- [ ] **Step 2: Run and verify RED**

Run: `pnpm vitest run apps/api/src/connector-authorization-service.integration.test.ts`

Run: `node scripts/check-provider-network-contract.mjs`

Run: `node scripts/check-connector-observability-contract.mjs`

Expected: at least one command fails on missing authorization observation.

- [ ] **Step 3: Add safe events, metric filter, and alarm policy**

Count `connector_authorization_failed`; alarm on sustained failures, never on `cancelled`. Keep raw
scope URLs and user/account identity out of dimensions.

- [ ] **Step 4: Update durable reliability, UI, deployment, and shipped-capability docs**

Record the callback commit point, thirty-minute/24-hour/seven-day lifecycle, safe redirect
contract, actual-scope rule, provider verification dependency, and production evidence procedure.

- [ ] **Step 5: Run and verify GREEN**

Run the three commands from Step 2. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/types.ts apps/api/src/connector-authorization-service.integration.test.ts infra scripts .github/scripts docs
git commit -m "chore: observe connector authorization safely"
```

### Task 10: Authorization acceptance verification

**Files:**
- Modify as needed only when verification reveals a defect in files already owned by Tasks 1–9.

**Interfaces:**
- No new interface. This task proves the complete design contract.

- [ ] **Step 1: Run focused authorization suites**

Run:

```bash
pnpm vitest run packages/domain/src/domain.test.ts packages/database/src/schema.test.ts packages/connectors/src/google.test.ts apps/api/src/connector-authorization-service.integration.test.ts apps/api/src/connector-service.integration.test.ts apps/api/src/x-bookmarks-service.integration.test.ts apps/api/src/app.integration.test.ts packages/api-client/src/client.test.ts apps/web/src/features/connections/authorization-outcome.test.tsx apps/web/src/app.test.tsx
```

Expected: PASS with zero failures.

- [ ] **Step 2: Run static boundary contracts**

Run: `pnpm lint`

Expected: PASS, including provider-network and connector-observability contract scripts.

- [ ] **Step 3: Run full repository verification**

Run: `pnpm verify`

Expected: PASS for environment checks, lint, typecheck, coverage, builds, and desktop/mobile E2E.

- [ ] **Step 4: Review privacy canaries and callback contract**

Inspect the full diff and test output. Confirm no raw provider material appears in redirects,
attempt APIs, durable safe fields, events, audit records, or rendered DOM; confirm no callback
launches an in-memory initial sync.

- [ ] **Step 5: Route any failure back to its owning task**

Do not patch forward from the acceptance task. Reopen the first failing task, repeat its failing
test/minimal implementation/green cycle, and rerun this acceptance task from Step 1.
