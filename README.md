# ilo

> **Status:** invite-only hosted beta. ilo is self-hostable under the
> [GNU Affero General Public License v3.0](LICENSE); commercial licensing and
> trademark terms are available in [COMMERCIAL.md](COMMERCIAL.md) and
> [TRADEMARKS.md](TRADEMARKS.md).

ilo is a transparent coordination layer shared by people and agents. It combines reminders, calendars, and read-only mail in one directly editable surface and exposes the same material through HTTP and MCP.

The first slice is complete enough to run end to end:

- responsive installable React PWA;
- compact Tauri overlay for macOS and Windows with always-on-top mode;
- reminder, local-calendar, and event workflows;
- unified read-only Google and iCloud mailboxes with search and conversation reading;
- multi-account Google Calendar/Gmail OAuth, discovery, synchronization, and calendar write-through CRUD;
- one iCloud app-specific-password connection for IMAP Mail, CalDAV Calendar, or both;
- opaque human sessions and separately scoped, revocable agent tokens;
- MCP over stdio and Streamable HTTP;
- actor-aware, append-only activity history;
- PostgreSQL migrations and production containers.

Product scope and acceptance criteria live in [docs/product/mvp.md](docs/product/mvp.md). Architecture decisions live in [docs/architecture](docs/architecture). Before publishing a fork or deploying a hosted instance, read [SECURITY.md](SECURITY.md), [CONTRIBUTING.md](CONTRIBUTING.md), and [docs/deployment.md](docs/deployment.md).

Release and installer requirements are documented in [docs/releasing.md](docs/releasing.md).

## Start locally

Requirements: Node 22+, pnpm 11, Docker, and Rust stable for desktop builds.

```bash
pnpm env:start
```

The Codex environment setup installs dependencies and creates `.env` with a local encryption key when needed. For a manual first-time setup, run:

```bash
bash ./.codex/scripts/environment.sh setup
pnpm env:start
```

Open `http://localhost:8081`. The API serves health checks at `http://localhost:8788/health/ready` and its OpenAPI document at `http://localhost:8788/openapi.json`.

For a foreground-only web/API development session, `pnpm dev` remains available on Vite's default `:5173`; use the environment actions for the repeatable full-stack path.

## Codex environment actions

The checked-in Codex environment exposes deterministic actions backed by one lifecycle controller:

- **Start** runs PostgreSQL plus the current API, MCP, and web source on `:55433`, `:8788`, `:8789`, and `:8081`.
- **Stop** shuts down the runtime without deleting PostgreSQL data.
- **Restart**, **Status**, and **Logs** provide predictable operational controls without hunting for processes.
- **Test** enforces the repository's coverage floor: 95% statements/functions/lines and 94% branches.
- **E2E** runs the desktop and mobile Playwright acceptance suite.
- **Verify** runs mirror checks, lint, types, coverage, every production build, and E2E acceptance tests.
- **Build** builds all applications and packages, including the native desktop bundles.

The first environment setup installs the lockfile exactly and creates `.env` with a valid local encryption key only when the file is missing. Start remains attached to its action terminal so crashes are immediately visible; use Stop from another action to shut it down. All runtime state is kept under ignored `.codex/run/` PID and log directories.

The same controls are available outside Codex:

```bash
pnpm env:start
pnpm env:status
pnpm env:logs
pnpm env:restart
pnpm env:stop
pnpm verify
```

## Desktop overlay

The packaged desktop app is the native overlay client; it does not bundle PostgreSQL or the API.
Start the local services before opening an installed copy:

```bash
docker compose up --detach
open -a "ilo" # macOS
```

The services keep running after the window closes. Stop them with `docker compose down`; local data
is preserved unless you explicitly add `--volumes`.

For desktop development and packaging:

```bash
pnpm --filter @personal-os/desktop dev
pnpm --filter @personal-os/desktop build
```

The renderer is the same PWA. In the desktop shell, human sessions are kept locally and sent through the API's distinct `Session` authorization scheme. Agent tokens never gain human-only account or connector permissions.

## MCP

Create an agent token in **Settings → Agent access**, then configure a stdio client:

```json
{
  "command": "node",
    "args": ["/absolute/path/to/personal-os/apps/mcp/dist/stdio.js"],
  "env": {
    "PERSONAL_OS_API_URL": "http://localhost:8788",
    "PERSONAL_OS_TOKEN": "pos_…",
    "PERSONAL_OS_TIMEZONE": "America/New_York"
  }
}
```

For remote hosts, POST Streamable HTTP requests to `http://localhost:8789/mcp` with the agent token as `Authorization: Bearer pos_…`. See [docs/mcp.md](docs/mcp.md).

## Production containers

```bash
export APP_ENCRYPTION_KEY="$(openssl rand -base64 32)"
docker compose up --build
```

This starts PostgreSQL, the API on `:8788`, MCP on `:8789`, and the web app on `:8081`. Set the public URLs plus Google or X credentials in the environment for a hosted deployment. See [docs/deployment.md](docs/deployment.md).

## Repository layout

```text
apps/api       HTTP data plane and Google OAuth callback
apps/mcp       MCP adapter over the public API
apps/web       React PWA and shared desktop renderer
apps/desktop   Tauri native shell
packages/*     domain, database, connectors, API client, and UI primitives
```

## Verify

```bash
pnpm check
pnpm test:e2e
```

`pnpm check` runs repository mirror checks, lint, type checking, coverage enforcement (95% statements/functions/lines and 94% branches), and all production builds.
