# AGENTS.md

## Repository Purpose

This repository is the ilo monorepo and also stores personal agent skills and routine definitions. Keep changes small, explicit, and easy to review.

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
- `pnpm env:start` runs the current source and remains attached so failures are visible.
- Use `pnpm env:status`, `pnpm env:logs`, `pnpm env:restart`, and `pnpm env:stop` to operate it.
- The local runtime uses stable ports: web `8080`, API `8787`, MCP `8788`, and PostgreSQL `55432`.
- Runtime PID and log files live under ignored `.codex/run/`.

## Validation

Run the deterministic verification action before opening a pull request:

```bash
pnpm verify
```

This includes repository mirror checks, lint, type checking, coverage enforcement (95% statements/functions/lines and 94% branches), production builds, and desktop/mobile E2E acceptance tests.
