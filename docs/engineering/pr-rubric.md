# Pull Request Rubric

Every pull request must be small enough to understand, accurate in its description, and safe to
merge. Read the diff and infer intent; never invent context that the request, issue, docs, or code do
not support.

## Non-negotiable merge gates

Before a pull request is ready for review or merge:

1. CI check **Lint and format** must pass. It runs `pnpm lint`, which runs Biome's formatter,
   linter, and import-sorting checks plus the frontend flat-theme/token guard without rewriting
   files.
2. **Quality and browser acceptance**, **Desktop (macos-14)**, and
   **Desktop (windows-latest)** must pass. New behavior still needs focused tests; a global coverage
   percentage is not a substitute for exercising failure paths and user-facing workflows.
3. The pull request must describe why the change is needed, what changed, exact validation,
   documentation impact, linked delivery work, and known risks.
4. Behavior, API, authorization, MCP, connector, synchronization, deployment, and operational
   changes must update the nearest current documentation in the same pull request.
5. The diff must exclude unrelated formatting, refactors, generated output, secrets, and user-owned
   changes.

## Title

Name the change at the highest useful level of abstraction:

| Change | Pattern | Example |
| --- | --- | --- |
| New concept or large feature | concise noun phrase | `Workspace switching` |
| Targeted capability | short imperative phrase | `Add rate limits to agent tokens` |
| Bug fix | shortest clear statement | `Fix expired session refresh` |
| Refactor or maintenance | name the result | `Simplify connector retry policy` |
| Tooling or configuration | name what changed | `Add desktop builds to CI` |

Do not use conventional-commit prefixes or trailing punctuation. Keep enough specificity that a
reviewer unfamiliar with the branch can understand it.

## Description

Use these required top-level sections. Include **Scope and limitations** only when it adds a real
non-goal, risk, breaking change, migration concern, or follow-up.

```markdown
## Overview

One or two sentences that stand alone: what changed and why it matters.

### Work map

- **Issue:** [#123 Title](url) — how this PR advances or completes it.
- **Reference:** [Current doc](path-or-url) — the rule, contract, or behavior needed for review.
- **Related:** prior PR, discussion, design, incident, or source artifact — only when it changes how
  the PR should be assessed.

If no GitHub issue is warranted after a duplicate and coverage audit, say
`Issue: No tracking issue needed — <concise reason>` instead of creating ceremony.

## Why this change

- **Problem:** the user, product, engineering, or operational problem
- **Safety rules:** compatibility, security, privacy, source-of-truth, rollout, or scope constraints
- **Approach:** the important choice or tradeoff that is not obvious from the diff

## What changed

- Group independently verifiable facts by concern.
- Omit formatting noise and minor renames.

## Documentation

- Updated: [current doc](path-or-url) — what durable behavior or rule it now records
- Reviewed — no update required: <why the change does not alter durable behavior or operations>

## Verification

| Check | What it proves |
| --- | --- |
| `pnpm verify` | Repository checks, lint, types, coverage, builds, and acceptance tests pass |

## Boundary analysis

Include this section whenever the change adds or alters an external dependency, credential,
callback/webhook, network path, scheduled handoff, or production-only capability.

- **Durable commit point:** what state is accepted before later work can fail
- **Production disconfirming case:** what could still fail in production while current tests pass
- **Evidence:** which configured, authorized, reachable, bounded, recoverable, observable, and
  verified states this PR actually proves
- **Remaining proof:** the owner and safe action for evidence available only after deployment

### Manual checks

- Step: expected result

### Not covered locally

- Reason, remaining risk, and follow-up

## Scope and limitations

- Intentional non-goals, breaking changes, migration/rollout risks, or deferred work
```

Omit optional subsections when empty. **Boundary analysis** is conditionally required for the
changes it names. Use `N/A` only for a required statement with no supported content.

## GitHub work map

GitHub Issues own delivery work; current repository docs own durable product and engineering truth;
the pull request is a reviewer snapshot.

- Search open and recently closed issues before creating one.
- Prefer a confident existing issue over a duplicate.
- Create an issue only for concrete, durable, independently shippable work. Tiny chores,
  dependency-only updates, and self-contained docs changes do not require an issue unless they need
  follow-up or coordination.
- Use `Closes #123` only when merging this PR fully satisfies the issue. Use `Refs #123` for partial
  progress, parent work, or context that must remain open.
- Link one to three current docs needed for review, not a reading list.
- Do not copy private conversation, secrets, PII, or restricted source payloads into an issue or PR.

## Author checklist

- Read `AGENTS.md` and the current docs relevant to the changed surface.
- Start from current `main` in a dedicated `cooper/` branch or worktree; never push directly to
  `main`.
- Rebase on current `main` before publishing. Resolve append-only migration ordering during that
  rebase.
- Audit GitHub issue coverage and use the correct closing or reference relationship.
- Run `pnpm lint` before pushing; use `pnpm format` only to fix formatting, then review its diff.
- Run `pnpm verify` before requesting review unless a maintainer explicitly approves a narrower
  check.
- Verify changed behavior with focused tests as well as the required suite.
- For UI work, state the immediate user job and apply
  [`docs/design/governance.md`](../design/governance.md): diagnose feedback before editing, change
  the responsible shared/page layer, and verify realistic states, responsive priority, keyboard,
  focus, and applicable assistive-technology behavior.
- For every changed external dependency, complete the boundary reasoning in
  [`external-boundary-reliability.md`](external-boundary-reliability.md). Separate configuration,
  authority, reachability, bounded execution, recovery, observation, and actual verification; list
  production-only evidence under **Not covered locally**.
- Re-read the pushed PR and checks; do not report local intent as GitHub state.

## Review checklist

Block a pull request when it has a correctness, security, privacy, data-integrity, architecture,
accessibility, design-system contract, test, documentation, or operational gap. Do not approve
with failing required checks or unresolved actionable review threads.

For changes that cross an external boundary, reviewers must use the
[external boundary reliability standard](external-boundary-reliability.md). Trace the complete
caller-to-dependency-to-recovery path and ask what could still fail in production while every
current test remains green. Block when the PR conflates a present secret with valid authority, a
mock with reachability, a process health check with capability health, or an infrastructure plan
with runtime verification.

Connector changes additionally follow the
[connector reliability contract](connector-reliability.md). A passing provider mock is not evidence
that callback registration, consent, production credentials, network policy, time budgets, or the
repair path work together.

## PR workflow output contract

Any PR-oriented workflow response must make the pull request immediately actionable. Use this
structure, omitting only empty non-PR sections:

1. `## Result` — the outcome in one or two sentences.
2. `## Pull request` — always include the primary PR as
   `[Open PR #<number> — <title>](<url>)`, with draft/open state, base, and head. For a multi-PR
   operation, use a table whose PR column contains this link for every PR in scope.
3. `## Artifacts` — link every GitHub artifact created, updated, inspected for a decision, or
   blocking completion. Use action labels such as `[Open issue](<url>)`, `[Open check](<url>)`,
   `[Open review](<url>)`, `[Open thread](<url>)`, or `[Open commit](<url>)`; do not leave bare URLs
   or raw IDs.
4. `## Actions` and `## Verification` — state what changed and exact command/check outcomes. Link a
   relevant CI run or check when applicable.
5. `## Blockers` — state `None` or list each blocker with its actionable link.

Never invent an artifact URL. If a PR cannot be resolved, state that clearly in
`## Pull request` and preserve a supplied URL when one exists.

## GitHub enforcement

`main` currently requires:

- a pull request with all conversations resolved;
- strict, up-to-date branches;
- linear history;
- **Lint and format**, **Quality and browser acceptance**, **Desktop (macos-14)**, and
  **Desktop (windows-latest)**;
- no force pushes or deletion; and
- enforcement for administrators.

Treat the live branch-protection response as authoritative if it later differs from this snapshot.
