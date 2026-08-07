# Connector Authorization Recovery Design

## Summary

ilo will treat every provider authorization as a durable, user-visible attempt rather than a
browser redirect that either succeeds or falls through to a JSON API error. Google and X browser
callbacks will always finish on an allowlisted ilo route with a safe outcome. Provider-authored
messages, OAuth codes, state values, tokens, account identities, and response bodies will never be
placed in a browser-visible error, redirect query, durable user-facing field, or log event.

The authorization callback remains a short durable handoff. It validates and consumes the
transaction, exchanges the one-time code, verifies the capabilities actually granted, persists the
encrypted credentials and account identity, records a closed authorization outcome, makes the
account due for background synchronization, and redirects. Discovery and synchronization never
extend the callback lifetime.

## Goals

- Replace raw callback JSON with a stable, recoverable Connections or Setup experience.
- Bind each authorization response to one user, provider, return path, redirect URI, and PKCE
  transaction.
- Verify actual Google granular consent before enabling Mail or Calendar capabilities.
- Make cancellation, expiry, incomplete permission, provider interruption, and successful
  connection distinguishable without exposing provider material.
- Give users one obvious retry action and support a generic recovery path when the state is unknown.
- Emit redacted authorization lifecycle evidence without alarming on intentional cancellation.
- Keep browser, API, desktop, provider, and database responsibilities inside existing ownership
  boundaries.

## Non-goals

- Provider notification channels or sub-five-minute synchronization; those are defined in the
  companion notification-driven sync design.
- Bypassing Google safety interstitials or automating provider consent.
- Moving provider access or refresh tokens into the browser.
- Changing ilo sign-in or MCP authorization.
- Adding new connector providers.

## Standards and provider constraints

The design follows OAuth 2.0 Authorization Code flow with S256 PKCE, exact redirect URI matching,
one-time state, issuer validation when supplied, and server-side token storage. Web authorization
uses a full-page redirect. The desktop shell launches the system browser and returns through an
app-owned redirect; it never embeds the provider consent page in a WebView.

Google granular consent can grant only a subset of requested scopes. Requested capability is not
authority. ilo derives enabled Mail and Calendar capabilities only from the scopes returned by the
token exchange. A missing required capability closes the attempt as `permission_incomplete` and
does not represent the account as fully connected.

The Google production project must complete sensitive/restricted-scope verification. Product code
will not describe or attempt to circumvent the provider's unverified-app warning.

## Architecture and ownership

- `packages/domain` owns the provider-neutral authorization attempt and safe outcome contract.
- `packages/database` owns durable attempt storage, one-time consumption, expiry, and indexes.
- `packages/connectors` owns provider authorization URL construction, PKCE parameters, token
  exchange, granted-scope parsing, and provider-specific response validation.
- `apps/api` owns attempt creation, callback orchestration, safe outcome classification, redirect
  policy, redacted events, and the authenticated attempt-status endpoint.
- `packages/api-client` exposes the authenticated attempt-status contract.
- `apps/web/src/features/connections` renders the outcome and retry action. The app composition root
  only wires route/query parsing.
- `apps/desktop` opens the system browser using the existing platform bridge.

No web component calls a provider or interprets provider error strings.

## Durable authorization attempt

Extend the existing provider-neutral `oauth_states` table into the authorization-attempt record.
It already owns the user, provider, hashed state, encrypted verifier, expiry, requested services,
target account, return path, and one-time consumption. Reusing that boundary avoids a second source
of truth for the same transaction. An attempt is not a credential and does not store provider
response material.

Required fields:

- existing `id`: opaque public attempt identifier generated independently from OAuth state;
- `user_id`: owning ilo user;
- `provider`: supported provider key;
- `requested_services`: validated provider-neutral service list;
- `return_path`: one of the existing allowlisted application paths;
- `token_hash`: SHA-256 hash of the random state; the raw state is returned to the browser and is
  never stored;
- `encrypted_verifier`: application-encrypted S256 verifier, never returned by an API;
- `redirect_uri`: exact callback URI used for this attempt;
- `status`: `pending | processing | connected | cancelled | expired | permission_incomplete | failed`;
- `outcome_code`: nullable safe stable code;
- `connected_account_id`: nullable connected account reference;
- `created_at`, `expires_at`, `consumed_at`, and `completed_at` timestamps;
- `request_id`: nullable final callback correlation identifier.

The table contains no provider error description, authorization code, access token, refresh token,
email address, mailbox data, or calendar data. Pending-attempt lookup uses a unique state hash and
an expiry index. Closed attempts are visible to their owner for twenty-four hours and are eligible
for deletion after seven days. User deletion cascades immediately. Google and X connector
authorization migrate to the extended provider-neutral model in one release; compatibility is not
required for states created before deployment because OAuth state is deliberately short-lived.

## Attempt lifecycle

### Start

1. Authenticate the ilo user and validate provider, services, and return path.
2. Generate independent random values for public attempt ID and OAuth state.
3. Generate a PKCE verifier and S256 challenge.
4. Persist the pending attempt with a thirty-minute expiry.
5. Construct the provider URL with exact redirect URI, state, PKCE challenge, and the minimum
   scopes needed for the selected services.
6. Return only the provider authorization URL to the authenticated client.

Creating a newer attempt does not invalidate another pending attempt for a different provider or
account. Repeated starts for the same user/provider/services may coexist because browser tabs can
complete out of order; one-time consumption prevents replay.

### Callback

1. Parse the callback using a tolerant boundary schema that accepts either an authorization code
   or a provider denial, but never reflects untrusted fields.
2. Hash and look up state. Unknown state redirects to the fixed Connections route with a generic
   recovery marker and emits only an aggregate safe event.
3. Atomically consume a recognized pending attempt and set it to `processing`. A recognized
   expired attempt is closed as `expired`; replay of a closed attempt returns its existing outcome
   and performs no second token exchange. A replay of an interrupted `processing` attempt closes it
   as retryable `failed`, because the one-time provider code may already have been spent.
4. Verify the callback URI and issuer, when the provider supplies `iss`.
5. For provider denial, map `access_denied` to `cancelled`; map all other values to a stable safe
   failure code without retaining the provider description.
6. Exchange the code with the stored PKCE verifier and the same redirect URI.
7. Inspect granted scopes. Enable only capabilities positively authorized by the provider. If any
   selected capability is missing, close as `permission_incomplete` without creating, modifying, or
   downgrading an account. The person can retry with the same selection or deliberately start a
   narrower service-specific authorization.
8. Resolve the minimum provider identity needed for the account key, encrypt and persist
   credentials, make the account immediately due for sync, close the attempt as `connected`, and
   redirect.

No discovery, pagination, projection, or full synchronization occurs before redirect.

### Browser completion

Every callback response is an HTTP `303` to the stored allowlisted return path. It includes only
`connection_attempt=<opaque-id>`. Unknown-state recovery uses
`connection_result=restart_required` on the fixed Connections route because no stored return path
can be trusted.

Callback responses set:

- `Cache-Control: no-store`;
- `Pragma: no-cache` for defensive compatibility;
- `Referrer-Policy: no-referrer`;
- `X-Content-Type-Options: nosniff`.

The authenticated web client fetches the attempt by opaque ID. Ownership is enforced server-side.
The query parameter is removed from browser history after the outcome is loaded so refresh does not
replay stale feedback.

## Safe public outcome contract

```ts
type ConnectorAuthorizationOutcome =
  | { status: "pending"; provider: ConnectorProvider }
  | { status: "connected"; provider: ConnectorProvider; accountId: string }
  | { status: "cancelled"; provider: ConnectorProvider }
  | { status: "expired"; provider: ConnectorProvider }
  | { status: "permission_incomplete"; provider: ConnectorProvider }
  | { status: "failed"; provider: ConnectorProvider; retryable: boolean };
```

The public response includes a safe `message` selected by ilo from the status and at most a
`retryAfter` timestamp for a known retryable condition. It excludes internal codes, request IDs,
provider status, exception types, granted-scope strings, requested-scope strings, and identities.

User-facing copy:

| Status | Persistent Connections feedback | Action |
| --- | --- | --- |
| `connected` | “Google is connected. Your first sync is starting.” | Dismiss |
| `cancelled` | “Connection cancelled. Nothing was changed.” | Try again |
| `expired` | “This connection request expired.” | Start again |
| `permission_incomplete` | “ilo still needs permission for the services you selected.” | Review access |
| retryable `failed` | “The provider could not finish the connection just now.” | Try again |
| non-retryable `failed` | “ilo could not finish this connection.” | Start again |
| unknown state | “That connection request is no longer valid.” | Start again |

The account row remains the source of truth after successful connection. Page feedback never adds
a second conflicting “Needs attention” state.

## Error classification and privacy

Callback exceptions are classified before reaching the generic API error serializer. A connector
browser callback never returns the normal JSON `AppError` representation. Unknown internal errors
close a recognized attempt as safe `failed`, emit a redacted event, and redirect.

Structured events:

- `connector_authorization_started`;
- `connector_authorization_completed`;
- `connector_authorization_failed`;
- `connector_authorization_recovered` when a later attempt connects after a failed attempt.

Events contain attempt ID, provider, safe status/code, requested service names, duration, and
request correlation. They exclude user identity, account identity, provider values, scope URLs,
tokens, codes, state, PKCE material, and free-form exception text. Cancellation is counted for
product analytics but does not increment the operational failure alarm.

## External-boundary record

| Concern | Contract |
| --- | --- |
| Capability and owner | `apps/api` owns the browser callback and durable attempt; `packages/connectors` owns provider protocol details. |
| Configuration and authority | Production provider client configuration plus encrypted user credentials; actual granted scopes determine capability. |
| Transport | Provider authorization uses a full-featured browser; token/profile exchange uses outbound TLS on TCP 443; callback uses the existing public HTTPS API edge. |
| Time and capacity | Attempt expires after thirty minutes; callback provider calls remain below the public edge budget; discovery and sync are background work. |
| Commit point | Closed attempt plus encrypted credentials/account row for success; closed safe attempt for every recognized failure. |
| Delivery semantics | State and code are one-time; callback replay is idempotent and never repeats token exchange; browser refresh reads stored outcome. |
| Degraded behavior | Every browser callback returns to ilo with safe recovery; unknown state uses a fixed route; no provider response is displayed. |
| Recovery and observation | Retry starts a new attempt; closed outcomes and redacted lifecycle events distinguish cancellation, expiry, permission, and service failure. |
| Evidence | Unit classification tests, migration/repository integration tests, callback HTTP tests, UI tests, privacy canaries, desktop external-browser E2E, and production OAuth completion. |

## Testing strategy

Tests are written before implementation at the narrowest effective layer:

1. Domain tests validate the closed public union and reject unsafe fields.
2. Database integration tests prove one-time consumption, expiry, replay, ownership, and migration
   compatibility.
3. Connector tests prove PKCE S256 construction and actual Google granted-scope parsing.
4. API callback tests cover success, denial, partial consent, expiry, unknown state, replay, token
   exchange failure, profile failure, and unexpected exceptions. Every branch must return a safe
   redirect and security headers.
5. Privacy tests inject JSON, HTML, credential-shaped, email-shaped, code, state, and scope canaries
   and assert they appear in neither redirect, public response, durable outcome, nor structured log.
6. Testing Library covers every outcome, one retry action, dismissal, URL cleanup, refresh, and
   ownership/lookup failure.
7. Desktop/mobile Playwright covers leaving ilo and returning without losing the Connections route.

## Rollout and recovery

1. Deploy the additive attempt table and compatible API code.
2. Existing short-lived connector states may expire naturally; users receive the generic restart
   path if an old callback arrives after deployment.
3. Confirm callback routes emit only redirects and never JSON for malformed or expired requests.
4. Complete one Google authorization in production after provider verification and confirm the
   stored outcome, account capability, initial due sync, UI recovery, and redacted events.
5. If application rollout fails, the additive table is harmless to the previous version. Roll back
   code without deleting attempts or credentials.

## Acceptance criteria

- Google and X connector browser callbacks never render JSON or provider-authored text.
- Authorization Code + S256 PKCE protects each connector attempt.
- State is random, hashed at rest, bound to one user/return path/redirect URI, expiring, and
  one-time-use.
- Google Mail and Calendar are enabled only when their required scopes were actually granted.
- Every recognized callback produces a durable safe outcome and redirects to its allowlisted ilo
  route; unknown state redirects to a fixed safe route.
- Refresh and callback replay never repeat a token exchange or duplicate an account.
- Connections shows an unambiguous outcome and exactly one recovery action.
- Cancellation does not create an operational incident.
- No credential, provider body, authorization code, state, PKCE verifier, identity, or raw scope
  value crosses a user-visible or log boundary.
- Focused tests and the repository verification gate pass.
