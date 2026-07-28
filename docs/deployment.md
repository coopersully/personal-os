# Deployment

## Required configuration

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection URL |
| `EMAIL_FROM` | Verified transactional sender, for example `ilo <noreply@example.com>` |
| `APP_BASE_URL` | Canonical browser application URL and OAuth return destination |
| `API_BASE_URL` | Canonical API URL advertised by OpenAPI |
| `ALLOWED_ORIGINS` | Comma-separated browser and Tauri origins |
| `APP_ENCRYPTION_KEY` | Base64-encoded 32-byte key for OAuth credentials |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
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
| `AGENT_SKILL_SOURCE_URL` | Public install source for the versioned Ilo guided-setup skill; defaults to the official repository skill directory |
| `REGISTRATION_MODE` | Must be `invite` in production; the API refuses to boot in open mode |
| `OWNER_EMAILS` | Comma-separated email addresses allowed to issue invitations |
| `X_CLIENT_ID` | X OAuth 2.0 client ID |
| `X_CLIENT_SECRET` | X OAuth confidential-client secret (if configured) |
| `X_REDIRECT_URI` | Exact registered X OAuth callback |

Generate the encryption key outside the repository and store it in the deployment platform's secret manager. Rotating it requires reauthorizing currently connected accounts.

Hosted deployments should set both `EMAIL_FROM` and `RESEND_API_KEY`. Without them, development safely suppresses transactional email, but users cannot complete email verification or recover a password.

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
`MCP_RESOURCE_URL` and its skill install link from
`AGENT_SKILL_SOURCE_URL`. Keep both public addresses aligned with the deployed
environment so Settings never teaches a host to use a staging or local
endpoint.

Build with the public API address compiled into the PWA:

```bash
docker build --target web --build-arg VITE_API_BASE_URL=https://api.example.com -t personal-os-web .
docker build --target api -t personal-os-api .
docker build --target mcp -t personal-os-mcp .
```

Run only one migration-capable API instance during a breaking schema rollout.
Drizzle records applied versions transactionally. Follow the
[database migration policy](engineering/database-migrations.md): published
migrations are append-only, and live-data changes use an expand–migrate–contract
rollout rather than a long deploy-time backfill.

## Health and logs

- `GET /health/live` proves the process is running.
- `GET /health/ready` verifies PostgreSQL connectivity.
- API request logs are one-line JSON with request ID, method, path, status, and duration.
- Connector account rows expose last sync time, current sync state, and redacted failure text.

Forward `X-Request-Id` from the edge when present. Do not log authorization headers, cookies, OAuth codes, encrypted credentials, or raw provider payloads.

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
