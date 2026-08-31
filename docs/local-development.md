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
