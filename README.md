<p align="center"><img src="apps/web/public/icon-192.png" width="80" height="80" alt="nohmi app mark"></p>

# nohmi

nohmi is a personal harness for mail, tasks, calendar, and finances. You can work in each workspace yourself or give an external agent scoped access to help. The Today view brings upcoming commitments and items that need a decision into one place.

The hosted app is in **invite-only alpha**. You can also run nohmi yourself under the [GNU Affero General Public License v3.0](LICENSE).

## Workspaces

| Workspace | What you can do |
| --- | --- |
| Mail | Read and search conversations across connected Google and iCloud accounts. |
| Tasks | Capture tasks and reminders, organize projects, and track commitments. |
| Calendar | View connected calendars together and manage events. |
| Finances | Review transactions, reconcile accounts, and maintain a budget. |

The [implementation log](docs/product/implementation-log.md) records delivered capabilities. The [product design](docs/product/master-design.md) describes the longer-term direction for the workspaces and the agents that help maintain them.

## Run locally

Install Node.js 22 or later and the pnpm version pinned in [package.json](package.json). Start Docker with Compose support. From a clean checkout, run:

```sh
bash ./.codex/scripts/environment.sh setup
pnpm env:start
```

Setup fetches `origin/main`, brings the checkout to that revision, installs locked dependencies, and prepares the local environment. If Codex already ran setup, just run `pnpm env:start`.

Open the loopback URL printed by Start. The web app, API, and MCP endpoint share that origin. Start stays attached to its terminal. From another terminal in the same worktree, run `pnpm env:stop` to stop the services and keep your database. See [local development](docs/local-development.md) for logs and recovery.

## Clients and integrations

- **Web** — Install the web app as a PWA or use it in a browser.
- **Desktop** — The native macOS shell uses the web renderer and adds Keychain session storage, notifications, and menu-bar controls. See the [desktop guide](apps/desktop/README.md).
- **Mobile** — The Expo app includes native iPhone workflows. See the [mobile guide](apps/mobile/README.md) for supported features and build instructions.
- **Agents** — Connect over Streamable HTTP at the worktree URL followed by `/mcp`, or use the stdio adapter. See [MCP integration](docs/mcp.md) for authentication and client setup.

## Development and operations

Personal OS is the internal application name. Repository and package identifiers use `personal-os`. See the [naming contract](docs/product/naming.md) for other surfaces.

| If you want to… | Start here |
| --- | --- |
| Make a change | [Contributing](CONTRIBUTING.md) · [Code of conduct](CODE_OF_CONDUCT.md) |
| Work on the repository with an agent | [Agent instructions](AGENTS.md) · [Engineering guide](docs/engineering/agent-context.md) |
| Understand the architecture | [System shape](docs/architecture/0001-system-shape.md) |
| Deploy or package a release | [Deployment](docs/deployment.md) · [Releases](docs/releasing.md) |
| Report a vulnerability privately | [Security policy](SECURITY.md) |
| Distribute or license a fork | [License](LICENSE) · [Commercial licensing](COMMERCIAL.md) · [Trademark policy](TRADEMARKS.md) |
