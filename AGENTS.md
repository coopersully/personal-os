# AGENTS.md

## Repository Purpose

This repository is the nohmi monorepo and also stores personal agent skills and routine definitions. Keep changes small, explicit, and easy to review.

## Product Spelling

- The current product name is `nohmi`, always lowercase, including at the start of a sentence.
- Never spell the product `nomi`, `Nomi`, or `Nohmi`. Preserve `ilo` only in compatibility identifiers, historical references, and existing tool or protocol names that have not been migrated.

## Linear Routing

- This repository belongs exclusively to the `Nohmi` Project in the Cooper Sullivan Linear workspace.
- Any Linear issue created from this repository, its branches, commits, pull requests, docs, or task history must be created directly in the live `Nohmi` Project. Repository-derived updates may target only issues already assigned to that Project.
- Never route repository work to `Cooper Sullivan Games`, `Notepad++ for Mac`, `Portfolio`, `Upper Thought`, another Project, or no Project.
- Resolve the unique live `Nohmi` Project identifier before every write. If it is missing or ambiguous, fail closed: make no Linear mutation and report the configuration gap.
- Do not use Linear's `{TEAM}-NEW` GitHub magic-word flow from this repository because the shared team key does not encode product identity. Create and validate the Nohmi issue first, then link only that existing issue ID in a branch or pull request.
- Before opening or materially refining a pull request, use the repository `create-pr` workflow. Resolve or create the direct Nohmi issue before PR creation, include the required Work map in the PR body, then add the resulting PR as a structured link on every direct Linear issue.
- An open PR keeps its direct issues `In Progress` unless live Linear metadata exposes a compatible review status. The PR title, body, branch, Linear links, status, and audit record must agree before handoff.
- Workspace-wide read-only portfolio questions are allowed, but repository-scoped skills and automations must filter their issue results to the `Nohmi` Project.

## Codex Local Environment

- The checked-in Codex local environment is `.codex/environments/environment.toml`.
- The environment setup and actions are defined in `.codex/environments/environment.toml` and routed through `.codex/scripts/environment.sh`.
- `.codex/scripts/check.sh` validates the repository-specific Codex environment and lifecycle script syntax.

## Local Runtime

- Use the checked-in lifecycle actions instead of inventing ad hoc background commands.
- `pnpm env:start` runs the current source in a worktree-owned Docker Compose project and remains attached so failures are visible.
- Use `pnpm env:status`, `pnpm env:logs`, `pnpm env:restart`, and `pnpm env:stop` to operate it.
- Compose project names are derived from the repository and canonical worktree path. Docker labels are the runtime registry; there is no shared port-allocation file.
- Each worktree exposes one kernel-selected loopback port. Its browser app, API routes, OAuth callbacks, and MCP endpoint share that origin; PostgreSQL is available only on the project network.
- The primary checkout's ignored `.env` is authoritative. Setup and start synchronize it into Codex worktrees before loading configuration.
- A worktree's ignored `.env.codex.local` stores only its non-secret Compose identity and public origin.
- Start removes projects whose ownership labels belong to this repository but whose roots are no longer in `git worktree list`. `pnpm env:gc` previews that cleanup.
- Stop preserves containers and PostgreSQL data. Purge, or the **Destroy Worktree Runtime** action, deletes the current project's containers, network, and volumes.

## Validation

Run the deterministic verification action before opening a pull request:

```bash
pnpm verify
```

This includes repository mirror checks, lint, type checking, coverage enforcement (95% statements/functions/lines and 94% branches), production builds, and desktop/mobile E2E acceptance tests.

## Frontend Icons

- reicon is the only permitted icon pack. Import every glyph from
  `@/components/icons`; only `apps/web/src/components/icons.ts` may import `reicon-react`.
- Adding a glyph means adding a registry entry under a semantic name, not a local import.
- Third-party brand marks are not icons. Compose `BrandMark` from
  `@/components/brand-marks`, the only module allowed inline `<svg>` or `simple-icons`.
  A brand with no artwork we may ship renders a monogram; never hand-draw a trademark.
- The contract and its rationale live in `docs/design/system.md`; `pnpm lint` enforces it
  through `scripts/check-icon-contract.mjs`.
- Regenerate the application mark with `node scripts/generate-app-mark.mjs` after editing
  `apps/web/public/icon.svg`; never hand-edit a generated PNG.

## External Boundary Reliability

- Before changing any external dependency, callback, webhook, scheduled handoff, network
  requirement, or production configuration, read
  `docs/engineering/external-boundary-reliability.md`.
- Do not treat a present secret, passing mock, healthy process, or valid infrastructure plan as
  proof that an external capability works. Review configuration, authority, transport, time,
  lifecycle, recovery, observation, and production-equivalent evidence separately.
- Work that can outlive its caller must cross a durable handoff and expose honest pending, success,
  and failure states. Record what could still fail in production despite green tests.
- Connector changes also follow `docs/engineering/connector-reliability.md` and keep provider
  timeouts and required ports aligned with the checked production network contract.
