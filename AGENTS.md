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
- The registered local runtime uses web `8081`, API `8788`, MCP `8789`, and PostgreSQL `55433`.
- The primary checkout's ignored `.env` is authoritative. Setup and start synchronize it into Codex worktrees before loading configuration.
- A linked worktree receives an ignored `.env.codex.local` containing a deterministic whole-set port shift and an isolated Compose project name.
- Runtime PID and log files live under ignored `.codex/run/`.

## Validation

Run the deterministic verification action before opening a pull request:

```bash
pnpm verify
```

This includes repository mirror checks, lint, type checking, coverage enforcement (95% statements/functions/lines and 94% branches), production builds, and desktop/mobile E2E acceptance tests.
