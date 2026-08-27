# AGENTS.md

## Repository Purpose

This repository is the ilo monorepo and also stores personal agent skills and routine definitions. Keep changes small, explicit, and easy to review.

## Codex Local Environment

- The checked-in Codex local environment is `.codex/environments/environment.toml`.
- The environment setup and actions are defined in `.codex/environments/environment.toml` and routed through `.codex/scripts/environment.sh`.
- `.codex/scripts/check.sh` validates the repository-specific Codex environment and lifecycle script syntax.

## Local Runtime

- Use the checked-in lifecycle actions instead of inventing ad hoc background commands.
- `pnpm env:start` runs the current source and remains attached so failures are visible.
- Use `pnpm env:status`, `pnpm env:logs`, `pnpm env:restart`, and `pnpm env:stop` to operate it.
- Each checkout keeps a stable allocation until Purge or confirmed orphan cleanup. The primary checkout owns tier 1 (web `8081`, API `8788`, MCP `8789`, PostgreSQL `55433`); the first linked worktree normally gets tier 2 (`8086`, `8793`, `8794`, `55438`).
- Allocations are shared under `<git-common-dir>/ilo-runtime`; checkout-local logs and generated runtime configuration remain ignored.
- The primary checkout `.env` is authoritative and is copied into linked worktrees. `.env.codex.local` contains only generated, non-secret runtime URLs and ports.
- Run `pnpm env:doctor` for ownership, port, Git, callback, or cleanup diagnostics.
- Automatic orphan cleanup is an explicit macOS opt-in through the Enable/Disable Automatic Cleanup actions. Setup never installs it silently.

## Validation

Run the deterministic verification action before opening a pull request:

```bash
pnpm verify
```

This includes repository mirror checks, lint, type checking, coverage enforcement (95% statements/functions/lines and 94% branches), production builds, and desktop/mobile E2E acceptance tests.
