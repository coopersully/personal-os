# Local development runtimes

Each Git worktree runs as a separate Docker Compose project. The project name is a stable hash of
the repository and canonical worktree path, so worktrees do not share containers, networks, or
PostgreSQL volumes. Docker resource labels are the runtime registry; no repository-wide port lease
file is used.

`pnpm env:start` selects one available loopback port and prints the worktree URL. The web app, API
routes, OAuth callbacks, and MCP endpoint at `/mcp` share that origin through Vite's development
proxy. PostgreSQL is not published to the host. Services inside the project use stable addresses:
the API reaches PostgreSQL at `postgres:5432`, and web reaches API and MCP at `api:8787` and
`mcp:8788`.

Compose Watch synchronizes source changes into the application containers without mounting host
`node_modules`. Changes to package manifests rebuild the development image.

## Lifecycle

- `pnpm env:start` builds and runs this worktree in the foreground.
- `pnpm env:stop` stops its containers while retaining its PostgreSQL volume and port assignment.
- `pnpm env:restart`, `pnpm env:status`, and `pnpm env:logs` operate only this worktree's project.
- `pnpm env:gc` previews projects owned by this repository whose roots no longer appear in
  `git worktree list`.
- `pnpm env:purge` explicitly deletes this worktree's containers, network, and database volume.

Start performs the same confirmed-orphan check with pruning enabled. This is a portable backstop
for worktrees deleted outside the lifecycle script; cleanup occurs on the next Start. The Codex
**Destroy Worktree Runtime** action performs immediate explicit cleanup before removing a worktree.

The primary checkout's ignored `.env` remains authoritative for secrets. Linked worktrees receive
a mode-`0600` copy and generate a mode-`0600` `.env.codex.local` containing only their Compose
identity and public local URLs. Every published port binds to `127.0.0.1`.

## Recovery

If Start reports that its saved port is occupied after the project's containers were removed,
delete `.env.codex.local` and Start again; the kernel will select another port. Use
`pnpm env:purge` when the worktree database should be recreated from scratch.

External OAuth providers must contain the exact callback URL printed for the worktree. Local
container health cannot prove that an external provider dashboard has been configured correctly.

## Environment setup

The Codex environment is named `personal-os`. Setup fetches `origin/main` with an explicit
refspec and advances the checkout to the fetched commit before reloading the lifecycle script
and installing frozen-lockfile dependencies. Detached worktrees stay detached; a checked-out
branch keeps its name and advances only by fast-forward. Setup never resets, stashes, or rebases
work. Tracked changes, untracked files, active Git operations, and commits outside `origin/main`
stop setup with recovery guidance. For an existing feature branch that must retain its commits,
use `bash .codex/scripts/environment.sh setup-dependencies` to install its current revision.
Start and Restart continue to run the current source without fetching or switching revisions.

Fetching requires the configured `origin` and existing Git credentials, using that remote's
HTTPS or OpenSSH transport. Git/askpass prompting is disabled; SSH batch mode and a 15-second
connection timeout are appended to the configured SSH command, along with 15-second keepalives
and a limit of three unanswered probes. Setup rejects commands containing BatchMode, ConnectTimeout,
ServerAliveInterval, or ServerAliveCountMax overrides, because OpenSSH uses the first repeated option. Configured
wrappers must accept OpenSSH options and must not override batch mode. HTTP fetches abort after 60 seconds below one
byte per second. SSH keepalives detect an unresponsive peer; they do not impose an overall deadline
on a responsive server doing slow work. Network/authentication failure stops setup before dependency installation; repair
access and rerun setup. The logged revision
is the commit observed by the successful fetch; remote changes after that fetch require another
setup. Local-remote integration tests prove revision and work-preservation behavior, not hosted
Git access or credential validity.

## Runtime-name cutover

New runtimes use `personal-os-<runtime-id>` projects, `app.personal-os.runtime.*` labels, and
`PERSONAL_OS_*` generated identity variables. The runtime hash is unchanged. Old `ilo-<runtime-id>`
containers and volumes are deliberately not adopted or deleted automatically. Actions stop if
either survives for this worktree, even if the overlay was removed. This prevents silently
switching to an empty database. Garbage collection only manages the new namespace.

Before cutting over a worktree with an existing database:

1. Identify its old project and PostgreSQL container using Docker's Compose project/service labels.
2. Export its database with `pg_dump` and verify the backup. Keep the backup outside the repository.
3. Stop and remove that old project's containers and network. Remove its database volume only
   after verifying the backup and explicitly deciding to retire the old runtime.
4. Run Start to generate the new overlay and create the `personal-os` runtime. Restore the backup
   into its PostgreSQL service, then check the restored data before resuming work.

For disposable fixture databases, explicitly retire the old project and volume, then Start and
Load QA Fixtures. The new Purge action cannot remove resources under the retired namespace.
Do not delete other worktrees' projects. A retained backup is also the rollback path.

Production helper overrides and the production acknowledgement now use `PERSONAL_OS_PRODUCTION_*`.
Update any shell exports from the retired prefix before invoking production actions; there are
no compatibility aliases. This changes local tooling configuration, not deployed AWS resources.
