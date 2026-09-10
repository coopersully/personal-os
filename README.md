# nohmi

> **Status:** invite-only hosted beta. nohmi is self-hostable under the
> [GNU Affero General Public License v3.0](LICENSE); commercial licensing and
> trademark terms are available in [COMMERCIAL.md](COMMERCIAL.md) and
> [TRADEMARKS.md](TRADEMARKS.md).

nohmi is an autonomous exoskeleton for power users in an increasingly agentic and online world. It
gives the person ownership of their data, workflows, and agent authority, learns how their life
works, and helps authorized agents act as capable copilots rather than disconnected chat sessions.

The internal repository and infrastructure name is `personal-os`; `nohmi` is the user-facing product
name and is always lowercase.

## Product model

nohmi unifies four core workspaces and makes each available through a simple, familiar application,
the public API, and MCP:

| Workspace | User interface | Agent outcome |
| --- | --- | --- |
| Mail | A complete unified mail client across accounts | Triage communication, resolve safe work, and leave only genuine decisions |
| Tasks | An authoritative task manager fed by local capture and external imports | Keep commitments clarified, intentional, feasible, and connected to priorities |
| Calendar | A unified calendar across accounts | Protect time, reconcile conflicts, and make schedules reflect the person's reality |
| Finances | A budget, cash-flow, balance, transaction, and net-worth application | Keep financial activity understood and plans aligned with current evidence and goals |

Today is the calm cross-workspace operating surface. It shows what matters now, what requires a
decision, and what nohmi completed without replacing the native models owned by each workspace.

Texting is the shared general inbox rather than a fifth workspace. A person can send a free-form
request that nohmi routes to the owning workspaces, answer exact questions or reversible reviews,
and receive concise maintenance results and first-party links according to global and per-workspace
settings.

Every workspace provides narrow surgical tools plus a domain-owned setup, status, and maintenance
workflow. External platforms such as ChatGPT, Codex, Claude, Gemini, or an operating-system
scheduler may choose when to invoke maintenance; nohmi owns the expertise, User Knowledge retrieval,
policy, durable execution, questions, audit, recovery, and verified outcome.

User Knowledge is the shared, typed, semantically searchable model of the person's goals,
priorities, motives, relationships, circumstances, preferences, constraints, routines, and learned
patterns. Reinforced low-risk inferences may become active safely, but knowledge never grants action
authority; the person can always inspect, correct, promote, restrict, export, or delete it.

The complete target is documented in:

- [Master product and experience design](docs/product/master-design.md)
- [Naming contract](docs/product/naming.md)
- [Workspace purposes and interfaces](docs/product/workspaces.md)
- [Workspace stewardship](docs/product/workspace-stewardship.md)
- [Per-workspace settings](docs/product/workspace-settings.md)
- [User Knowledge](docs/product/user-knowledge.md)
- [Texting and SMS](docs/product/texting-operations.md)
- [External automation hosts](docs/product/automation-hosts.md)
- [Master delivery plan](docs/product/master-plan.md)
- [MCP integration](docs/mcp.md)

## Current implementation

The current product slice is complete enough to run end to end, but it does not yet implement the
entire target described above:

- responsive installable React PWA;
- installable macOS desktop app plus the shared desktop renderer and Windows build path;
- organized Tasks workspace with Inbox, Lists, Projects, lifecycle, planning fields, Trash, and
  revision-safe MCP operations;
- reminder, unified-calendar, event-management, cross-provider deduplication, and selected-calendar
  workflows;
- unified Google and iCloud mailboxes with search, conversation reading, drafts, sending,
  provider-backed actions, and reviewed retention rules;
- multi-account Google Calendar/Gmail OAuth, discovery, synchronization, and calendar write-through CRUD;
- one iCloud app-specific-password connection for IMAP Mail, CalDAV Calendar, or both;
- Finance accounts, imports, transactions, ownership semantics, review inbox, budgets, playbook,
  setup, maintenance, and review workflows;
- opaque human sessions and separately scoped, revocable agent tokens;
- MCP over stdio and Streamable HTTP;
- agent texting through a hardened Twilio lifecycle;
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

Start prints the worktree's loopback URL. API routes and the MCP endpoint (`/mcp`) use the same origin. Every worktree receives a separate Compose project, network, and PostgreSQL volume. See [local development](docs/local-development.md) for lifecycle and recovery details.

For a foreground-only web/API development session, `pnpm dev` remains available on Vite's default `:5173`; use the environment actions for the repeatable full-stack path.

## Codex environment actions

The checked-in Codex environment exposes deterministic actions backed by one lifecycle controller:

- **Start** derives an isolated Compose project from the worktree, assigns one available loopback port, and runs PostgreSQL plus the current API, MCP, and web source with Compose Watch. Multiple Codex worktrees can remain running concurrently.
- **Stop** shuts down the runtime without deleting PostgreSQL data.
- **Restart**, **Status**, **Logs**, and **GC Dry Run** provide predictable operational controls without hunting for processes.
- **Destroy Worktree Runtime** removes only this worktree's labeled containers, network, and PostgreSQL volume.
- **Load QA Fixtures** recreates the repository-owned demo, onboarding, empty, and recovery personas.
- **Test** enforces the repository's coverage floor: 95% statements/functions/lines and 94% branches.
- **E2E** runs the desktop and mobile Playwright acceptance suite.
- **Verify** runs mirror checks, lint, types, coverage, every production build, and E2E acceptance tests.
- **Build** builds all applications and packages, including the native desktop bundles.

Playwright uses local web `5174` and API `8797` by default. See
[local development](docs/local-development.md) for supported port overrides and isolated test
servers.

The first environment setup installs the lockfile exactly and creates `.env` with a valid local encryption key only when the file is missing. Start remains attached to its action terminal so crashes are immediately visible; use Stop from another action to shut it down.

Linked worktrees copy the primary `.env` on setup and start, then generate an ignored `.env.codex.local` containing only non-secret runtime configuration. Docker labels record ownership, and Start removes confirmed orphan projects that no longer appear in `git worktree list`.

The same controls are available outside Codex:

```bash
pnpm env:start
pnpm env:status
pnpm env:logs
pnpm env:gc
pnpm env:restart
pnpm env:stop
pnpm fixtures:list
pnpm fixtures:load
pnpm verify
```

Fixture credentials and scenario coverage are documented in
[docs/engineering/qa-fixtures.md](docs/engineering/qa-fixtures.md).

## Desktop app

The macOS app connects to the hosted nohmi service by default and supports a validated custom HTTPS
server or loopback development origin. Credentials live in Keychain; account-scoped settings cover
resident lifecycle, menu-bar and Dock behavior, launch at login, notifications, WidgetKit widgets,
the optional desktop pet, and wallpapers. See [desktop operations](apps/desktop/README.md) for local
development, provisioning, signing, release, recovery, and installed-app acceptance.

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
export MCP_INTERNAL_SECRET="$(openssl rand -hex 32)"
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
