# Pull Request Rubric

Every pull request must be small enough to understand, accurate in its description, and safe to merge.

## Work identity

Every repository pull request must be traceable to concrete work in the live `Nohmi` Linear Project.
Resolve or create the direct issue before opening the PR, then use the PR URL to create a structured
Linear link on every direct issue after GitHub returns it. Never use `{TEAM}-NEW`, route work to a
different Project, or silently leave repository work unprojected.

Use one primary issue key in a new branch name when possible:
`cooper/coo-123-short-description`. A pull request may advance multiple independently shippable
issues, but its body must link all of them and explain each contribution. Do not put issue keys in
the PR title merely as decoration.

The PR body must begin with this reviewable context:

```markdown
## Overview
<One or two sentences describing the outcome.>

## Work map
- Project: [Nohmi](<live-project-url>) — <how this PR advances it>
- Milestone: [<milestone>](<live-milestone-url>) — <contribution> <!-- omit when absent -->
- Task: [COO-123](<live-issue-url>) — <how this PR advances the issue>
- Reference: [<current source of truth>](<repository URL or path>)
```

Add one `Task` row per direct Linear issue and one to three current references. If Linear was
explicitly skipped, unavailable, or ambiguous, say so in the Work map, keep the PR in draft, and
report the blocker instead of fabricating a link.

See [work-context.md](work-context.md) for ownership and synchronization rules.

## Non-negotiable merge gates

Before a pull request is ready for review or merge:

1. CI check **Lint and format** must pass. It validates the submitted PR body's Work map, then runs
   `pnpm lint`, which runs Biome's formatter, linter, and import-sorting checks plus the frontend
   flat-theme/token guard without rewriting files.
2. The broader CI checks must pass: repository checks, types, coverage at the configured floor (95% statements/functions/lines and 94% branches), production builds, browser acceptance, and native desktop compilation. New behavior still needs focused tests; a global percentage is not a substitute for exercising failure paths and user-facing workflows.
3. The pull request must include the Work map and describe why the change is needed, what changed,
   exact validation, documentation impact, and known risks.
4. Behavior, API, authorization, MCP, connector, synchronization, deployment, and operational changes must update the nearest current documentation in the same pull request.
5. The diff must exclude unrelated formatting, refactors, generated output, secrets, and user-owned changes.

## Author checklist

- Read AGENTS.md and the current docs relevant to the changed surface.
- Use the repository `create-pr` workflow so Linear is resolved before PR creation and linked after
  the PR URL exists.
- Run `pnpm lint` before pushing; use `pnpm format` only to fix formatting, then review its diff.
- Run `pnpm verify` before requesting review unless a maintainer explicitly approves a narrower check.
- Verify changed behavior with focused tests as well as the required suite.
- State N/A rather than inventing PR context.
- Re-read the published PR body and direct Linear issues before handoff. Confirm that the Nohmi
  Project, task links, milestone when present, branch, PR backlink, and status agree.

## Recommended body sections

After `Overview` and `Work map`, use:

```markdown
## Why
<Problem, constraint, or user value.>

## What changed
- <Material behavior or implementation change.>

## Documentation
- <Updated current docs, or N/A with a reason.>

## Verification
- `<exact command>` — <result>

## Scope
- Known risks: <risk or None>
- Follow-up: <linked issue or None>
```

## Review checklist

Reviewers should block a pull request when it has a correctness, security, privacy, data-integrity, architecture, test, documentation, or operational gap. Do not approve a PR with failing required checks.

## PR workflow output contract

Any PR-oriented workflow response must make the pull request immediately actionable. Use this structure, omitting only empty non-PR sections:

1. `## Result` — the outcome in one or two sentences.
2. `## Pull request` — always include the primary PR as `[Open PR #<number> — <title>](<url>)`, with draft/open state, base, and head. For a multi-PR operation, use a table whose PR column contains this link for every PR in scope.
3. `## Linear` — list the Nohmi Project, milestone when present, every direct issue, final status,
   structured PR-link result, and audit path. State any skipped ambiguity or unavailable tool.
4. `## Artifacts` — include an inline Markdown link for every GitHub or Slack artifact created,
   updated, inspected for a decision, or blocking completion. Use action labels such as
   `[Open check](<url>)`, `[Open review](<url>)`, `[Open thread](<url>)`, `[Open commit](<url>)`, or
   `[Open Slack message](<url>)`; do not leave bare URLs or raw IDs. Slack remains optional: do not
   require a connector, but link a Slack message or thread whenever one was used.
5. `## Actions` and `## Verification` — state what changed and exact commands/check outcomes. Link
   a relevant CI run or check when applicable.
6. `## Blockers` — state `None` or list the blocker with its actionable link.

Never invent an artifact URL. If a PR cannot be resolved, state that clearly in `## Pull request` and preserve the supplied URL when one exists.

## GitHub enforcement

The intended branch rule for `main` is:

- require a pull request;
- require the `Lint and format` status check;
- require branches to be up to date before merging;
- prohibit bypasses except for explicitly authorized repository administrators.

This repository's current GitHub plan does not support branch protection or rulesets for private repositories, so GitHub cannot currently enforce the rule against merging. The CI workflow still reports the exact required check on every pull request. After the repository is public or on a plan that supports protection, apply the rule above immediately.
