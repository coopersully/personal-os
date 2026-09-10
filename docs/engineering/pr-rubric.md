# Pull Request Rubric

Every pull request must be small enough to understand, accurate in its description, and safe to
merge. Read the diff and infer intent; never invent context that the request, Linear issue, docs, or
code do not support.

## Work identity

Every repository PR must be traceable to concrete work in the live `Nohmi` Linear Project. Resolve
or create every direct issue before opening the PR, then add the returned PR URL as a structured
Linear link on each issue. Never use `{TEAM}-NEW`, route repository work to another Project, or
silently leave it unprojected.

Use one primary issue key in a new branch name when possible:
`cooper/coo-123-short-description`. One PR may advance multiple independently shippable issues, but
its Work map must link all of them and explain each contribution. Do not add issue keys to the PR
title merely as decoration.

## Non-negotiable merge gates

Before a PR is ready for review or merge:

1. **PR Work map** must validate the submitted PR body against the live Nohmi Project URL and at
   least one concrete, internally consistent `COO-*` issue link.
2. **CI required** and every selected scoped job must pass. This includes repository contracts,
   lint and formatting, types, coverage at the configured floor, production builds, browser
   acceptance, native desktop compilation, and infrastructure checks when affected.
3. New behavior has focused tests for its success, failure, and user-facing paths; a global coverage
   percentage is not a substitute.
4. The PR accurately describes why the change is needed, what changed, exact validation,
   documentation impact, linked Linear work, and known risks.
5. Behavior, API, authorization, MCP, connector, synchronization, deployment, and operational
   changes update the nearest current documentation in the same PR.
6. The diff excludes unrelated formatting, refactors, generated output, secrets, and user-owned
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

## Work map

- Project: [Nohmi](<live-project-url>) — how this PR advances it.
- Milestone: [Milestone](<live-milestone-url>) — contribution. <!-- omit when absent -->
- Task: [COO-123](<live-issue-url>) — how this PR advances or completes it.
- Reference: [Current doc](<path-or-url>) — the rule, contract, or behavior needed for review.
- Related: prior PR, discussion, design, incident, or source artifact — only when it changes review.

## Why this change

- **Problem:** the user, product, engineering, or operational problem
- **Safety rules:** compatibility, security, privacy, source-of-truth, rollout, or scope constraints
- **Approach:** the important choice or tradeoff that is not obvious from the diff

## What changed

- Group independently verifiable facts by concern.
- Omit formatting noise and minor renames.

## Documentation

- Updated: [current doc](<path-or-url>) — what durable behavior or rule it now records
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

Omit optional rows and subsections when empty. Add one `Task` row per direct Linear issue and one to
three current references. **Boundary analysis** is conditionally required for the changes it names.
Use `N/A` only for a required statement with no supported content.

If Linear was explicitly skipped, unavailable, or ambiguous, record the blocker in the Work map,
keep the PR draft, and never fabricate a link. The merge-gate check remains intentionally red until
real Nohmi coverage exists.

## Linear work map

Linear owns delivery work; current repository docs own durable product and engineering truth; the
PR is a reviewer snapshot. GitHub issues may supply historical or source evidence but do not replace
Nohmi Linear coverage.

- Search active and completed Nohmi issues before creating one.
- Prefer a confident existing issue over a duplicate.
- Create one issue only for concrete, durable, independently shippable work.
- Link the live Nohmi Project, milestone when present, and every direct issue in the PR body.
- After the PR URL exists, add it through Linear's structured link or attachment field on every
  direct issue. A URL only in a comment or description is incomplete.
- Keep draft and open PR work `In Progress` while the live workspace has no review-specific status.
- Add at most one concise Linear comment for a material scope, progress, verification, or blocker
  event; metadata-only linking belongs in the audit ledger.
- Re-read both systems before handoff and confirm project, milestone, task coverage, branch,
  backlinks, and status agree.
- Link one to three current docs needed for review, not a reading list.
- Never copy private conversations, secrets, PII, local-only URLs, or restricted payloads into
  Linear or GitHub.

See [work-context.md](work-context.md) for the ownership and two-phase synchronization model.

## Author checklist

- Read `AGENTS.md` and current docs relevant to the changed surface.
- Start from current `main` in a dedicated `cooper/` branch or worktree; never push to `main`.
- Use the repository catch-up workflow for a published branch; do not rewrite shared history merely
  to become current.
- Use `create-pr` so Linear is resolved before PR creation and linked afterward.
- Run `pnpm lint` before pushing; use `pnpm format` only to fix formatting, then review its diff.
- Run `pnpm verify` before requesting review unless a maintainer explicitly approves a narrower
  check.
- Verify changed behavior with focused tests as well as the required suite.
- For UI work, state the immediate user job and apply
  [`docs/design/governance.md`](../design/governance.md): diagnose before editing, change the
  responsible layer, and verify realistic states, responsive priority, keyboard, focus, and
  applicable assistive-technology behavior.
- For every changed external dependency, complete the boundary reasoning in
  [`external-boundary-reliability.md`](external-boundary-reliability.md). Separate configuration,
  authority, reachability, bounded execution, recovery, observation, and actual verification.
- Re-read the pushed PR, checks, and direct Linear issues; do not report local intent as live state.

## Review checklist

Block a PR when it has a correctness, security, privacy, data-integrity, architecture,
accessibility, design-system contract, test, documentation, tracking, or operational gap. Do not
approve with failing required checks or unresolved actionable review threads.

For external boundaries, use the
[external boundary reliability standard](external-boundary-reliability.md). Trace the complete
caller-to-dependency-to-recovery path and ask what could still fail in production while current
tests remain green. Connector changes additionally follow the
[connector reliability contract](connector-reliability.md).

## PR workflow output contract

Any PR-oriented workflow response must make the PR immediately actionable. Use this structure,
omitting only empty non-PR sections:

1. `## Result` — the outcome in one or two sentences.
2. `## Pull request` — include `[Open PR #<number> — <title>](<url>)`, with draft/open state, base,
   and head. For multiple PRs, use a table whose PR column links every PR.
3. `## Linear` — list the Nohmi Project, milestone when present, every direct issue, final status,
   structured backlink result, audit path, skipped ambiguity, and unavailable tool.
4. `## Artifacts` — link every GitHub artifact created, updated, inspected for a decision, or
   blocking completion. Use action labels such as `[Open check](<url>)`, `[Open review](<url>)`,
   `[Open thread](<url>)`, or `[Open commit](<url>)`; never leave bare URLs or raw IDs.
5. `## Actions` and `## Verification` — state what changed and exact command/check outcomes. Link a
   relevant CI run or check when applicable.
6. `## Blockers` — state `None` or list each blocker with an actionable link.

Never invent an artifact URL. If a PR cannot be resolved, say so clearly and preserve a supplied
URL when one exists.

## GitHub enforcement

`main` is intended to require:

- a PR with all conversations resolved;
- strict, up-to-date branches and linear history;
- **PR Work map**, **CI required**, and the selected scoped checks;
- no force pushes or deletion; and
- enforcement for administrators.

Treat live branch protection as authoritative if it differs from this snapshot.
