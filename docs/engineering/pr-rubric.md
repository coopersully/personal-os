# Pull Request Rubric

Every pull request must be small enough to understand, accurate in its description, and safe to merge.

## Non-negotiable merge gates

Before a pull request is ready for review or merge:

1. CI check **Lint and format** must pass. It runs `pnpm lint`, which runs Biome's formatter, linter, and import-sorting checks plus the frontend flat-theme/token guard without rewriting files.
2. The broader CI checks must pass: repository checks, types, coverage at the configured floor (95% statements/functions/lines and 94% branches), production builds, browser acceptance, and native desktop compilation. New behavior still needs focused tests; a global percentage is not a substitute for exercising failure paths and user-facing workflows.
3. The pull request must describe why the change is needed, what changed, exact validation, documentation impact, and known risks.
4. Behavior, API, authorization, MCP, connector, synchronization, deployment, and operational changes must update the nearest current documentation in the same pull request.
5. The diff must exclude unrelated formatting, refactors, generated output, secrets, and user-owned changes.

## Author checklist

- Read AGENTS.md and the current docs relevant to the changed surface.
- Run `pnpm lint` before pushing; use `pnpm format` only to fix formatting, then review its diff.
- Run `pnpm verify` before requesting review unless a maintainer explicitly approves a narrower check.
- Verify changed behavior with focused tests as well as the required suite.
- State N/A rather than inventing PR context.

## Review checklist

Reviewers should block a pull request when it has a correctness, security, privacy, data-integrity, architecture, test, documentation, or operational gap. Do not approve a PR with failing required checks.

## PR workflow output contract

Any PR-oriented workflow response must make the pull request immediately actionable. Use this structure, omitting only empty non-PR sections:

1. `## Result` — the outcome in one or two sentences.
2. `## Pull request` — always include the primary PR as `[Open PR #<number> — <title>](<url>)`, with draft/open state, base, and head. For a multi-PR operation, use a table whose PR column contains this link for every PR in scope.
3. `## Artifacts` — include an inline Markdown link for every GitHub or Slack artifact created, updated, inspected for a decision, or blocking completion. Use action labels such as `[Open check](<url>)`, `[Open review](<url>)`, `[Open thread](<url>)`, `[Open commit](<url>)`, or `[Open Slack message](<url>)`; do not leave bare URLs or raw IDs. Slack remains optional: do not require a connector, but link a Slack message or thread whenever one was used.
4. `## Actions` and `## Verification` — state what changed and exact commands/check outcomes. Link a relevant CI run or check when applicable.
5. `## Blockers` — state `None` or list the blocker with its actionable link.

Never invent an artifact URL. If a PR cannot be resolved, state that clearly in `## Pull request` and preserve the supplied URL when one exists.

## GitHub enforcement

The intended branch rule for `main` is:

- require a pull request;
- require the `Lint and format` status check;
- require branches to be up to date before merging;
- prohibit bypasses except for explicitly authorized repository administrators.

This repository's current GitHub plan does not support branch protection or rulesets for private repositories, so GitHub cannot currently enforce the rule against merging. The CI workflow still reports the exact required check on every pull request. After the repository is public or on a plan that supports protection, apply the rule above immediately.
