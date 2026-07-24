# Deployment

## Required configuration

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection URL |
| `EMAIL_FROM` | Verified transactional sender, for example `Personal OS <noreply@example.com>` |
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
| `REGISTRATION_MODE` | Set `invite` for a private beta; `open` only when public registration is intentional |
| `OWNER_EMAILS` | Comma-separated email addresses allowed to issue invitations |
| `X_CLIENT_ID` | X OAuth 2.0 client ID |
| `X_CLIENT_SECRET` | X OAuth confidential-client secret (if configured) |
| `X_REDIRECT_URI` | Exact registered X OAuth callback |

Generate the encryption key outside the repository and store it in the deployment platform's secret manager. Rotating it requires reauthorizing currently connected accounts.

Hosted deployments should set both `EMAIL_FROM` and `RESEND_API_KEY`. Without them, development safely suppresses transactional email, but users cannot complete email verification or recover a password.

Production defaults to invite-only sign-up and refuses to start without at least one `OWNER_EMAILS` address. An owner signs in, opens Settings → Invitations, creates a one-time code (optionally bound to a friend's email), and shares the code privately. Codes are hashed at rest, expire after 14 days by default, and cannot be reused.

The application has an in-process authentication rate-limit backstop. Configure an equivalent shared rate limit at the public edge before running more than one API replica. Never expose PostgreSQL or container-only ports; place the API behind the same authenticated HTTPS edge used by the web app.

## Images

The root Dockerfile has `api`, `mcp`, and `web` targets. The API image runs migrations before accepting traffic, runs as an unprivileged user, and exposes liveness/readiness endpoints. The web target uses unprivileged Nginx with immutable asset caching and SPA fallback.
The MCP image binds to all container interfaces, requires a Personal OS bearer token for every protocol request, and exposes only an unauthenticated liveness endpoint. The endpoint is meant to be public: terminate TLS at the edge, rate-limit it there, and keep bearer tokens out of query strings and logs. Browser-originated MCP requests can be restricted with `MCP_ALLOWED_ORIGINS`; native and agent clients do not send an Origin header and remain supported.

## MCP OAuth

The public MCP endpoint publishes protected-resource metadata and directs clients to Personal OS's OAuth authorization server. A person signs in to Personal OS once and consents to the MCP client; Google, iCloud, and other connected services remain internal to that Personal OS account. OAuth clients use dynamic registration, exact redirect-URI matching, S256 PKCE, five-minute one-time authorization codes, one-hour MCP audience-bound access tokens, and rotating refresh tokens. Do not reuse `MCP_INTERNAL_SECRET` outside the API and MCP containers, and use distinct values per environment.

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

## Google configuration

Register the exact public `GOOGLE_REDIRECT_URI` in Google Cloud. Request Calendar read/write and user email scopes. OAuth state is random, user-bound, one-time-use, and expires after ten minutes. Use separate OAuth clients and encryption keys for development and production.

## X Bookmarks configuration

Create an X OAuth 2.0 app, register the exact public `X_REDIRECT_URI`, and set its client ID (plus client secret for a confidential client). The connector requests only `bookmark.read`, `tweet.read`, `users.read`, and `offline.access`. After connecting in **Settings → Connections**, select one bookmark folder. Personal OS stores the OAuth refresh token encrypted, projects only that folder's posts, and exposes the projection to agents through the `bookmarks:read` scope and the `list_x_bookmarks` MCP tool. It never writes to X.

## Backups and rollback

Back up PostgreSQL before schema releases. Application records use soft deletion where recovery matters, but database backups remain necessary for account or infrastructure loss. Roll back the application image independently when the deployed schema remains backward compatible; restore a database only as an explicit incident action.
