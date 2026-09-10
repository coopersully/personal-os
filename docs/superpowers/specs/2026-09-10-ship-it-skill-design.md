# Ship It Skill Design

## Purpose

Add a repository-local `ship-it` skill that can take one Nohmi pull request from its current state
through verified merge without relaxing the repository's engineering or tracking standards. An
explicit invocation authorizes PR-scoped edits, commits, non-force pushes, review-thread resolution,
Nohmi Linear synchronization, and the final merge or auto-merge operation.

The skill composes the repository's existing workflows instead of duplicating them. `create-pr`
owns PR construction and metadata, `catchup` owns base synchronization, `linear-work-sync` owns
Nohmi issue coverage and reciprocal links, `resolve-pr-comments` owns review feedback,
`pr-shepherd` owns live maintenance decisions, and `refine-pr` supplies independent review passes.

## Scope and authority

`ship-it` operates on exactly one open pull request in this repository. It may:

- create or refine the PR through `create-pr` when necessary;
- make in-scope fixes supported by code, tests, review evidence, or CI failure evidence;
- commit and push those fixes without rewriting published history;
- create, link, and update direct issues only in the unique live Nohmi Linear Project;
- resolve review threads only after a verified pushed fix or evidence-backed disposition;
- squash-merge the pull request, use an administrator merge operation when permitted, or enable
  squash auto-merge; and
- verify and record the resulting GitHub and Linear state.

It may not force-push, alter branch protection, weaken tests or CI, dismiss valid feedback, route
work outside Nohmi, merge a different pull request, or use administrator authority to skip a failed,
pending, stale, ambiguous, or unverified gate.

## Components

### Skill entrypoint

`.agents/skills/ship-it/SKILL.md` defines the authority, orchestration loop, failure boundaries,
merge strategy, and final reporting contract. Its discovery text targets explicit requests to ship,
land, merge autonomously, or take a PR all the way through merge.

### Deterministic readiness evaluator

`.agents/skills/ship-it/scripts/evaluate_readiness.py` consumes a sanitized JSON snapshot rather
than making remote writes. It returns one decision with machine-readable reasons:

- `REMEDIATE` when an in-scope gate needs a fix or reconciliation;
- `WAIT` while external checks or reviews are genuinely pending;
- `MERGE` when every merge gate is satisfied;
- `AUTO_MERGE` when every gate is satisfied but the authenticated actor cannot merge immediately;
  or
- `BLOCK` when safe autonomous progress requires new authority or human judgment.

The evaluator fails closed on missing or ambiguous evidence. Unit tests cover stale bases, dirty or
unpushed work, conflicts, failing and pending checks, CodeRabbit state, unresolved feedback,
incomplete self-review, missing verification, wrong Linear projects, missing structured backlinks,
and merge-strategy selection.

### Skill metadata and pressure scenarios

`agents/openai.yaml` makes the workflow discoverable without changing the default invocation
policy. A focused pressure-scenarios reference tests the irreversible boundaries, especially
requests to merge while a check is pending, treat a comment-only Linear URL as a backlink, or use
administrator authority as a substitute for readiness.

## Orchestration loop

1. Resolve the repository, PR, base, head, worktree, authenticated GitHub actor, and live repository
   merge capabilities. Refuse an ambiguous target.
2. Use `create-pr` and `linear-work-sync` to make the PR body, direct Nohmi issues, statuses, and
   structured backlinks agree.
3. Use `catchup` whenever the branch is behind or GitHub cannot prove it is current with the base.
   Re-run affected verification after integration.
4. Run focused tests while fixing work and run `pnpm verify` on the exact pushed head before merge.
5. Collect every current-head review surface, including human reviews, unresolved threads,
   CodeRabbit checks and findings, and required GitHub Actions checks. Validate findings before
   changing code and resolve supported issues at the correct scope.
6. Run `refine-pr` with fresh independent review passes. Fix every verified in-scope finding, push,
   and restart the readiness loop because the head changed. Escalate findings whose safe fix would
   materially broaden product, architecture, migration, or security scope.
7. Evaluate a freshly collected sanitized snapshot. Never carry readiness evidence across a head
   change. Wait with bounded live-state checks when the only remaining condition is external work.
8. When the evaluator returns `MERGE`, attempt the repository-supported squash merge normally. If
   GitHub still blocks only the final merge operation and confirms the actor has administrator
   bypass authority, retry with the administrator merge option. This bypass changes only the merge
   mechanism; all readiness gates remain mandatory.
9. When the evaluator returns `AUTO_MERGE`, enable squash auto-merge and continue monitoring until
   GitHub reports the PR merged or a new blocker appears.
10. Re-read the merged PR and resulting commit. Update a direct Nohmi issue to `Done` only when this
    merge satisfies that issue's acceptance criteria; otherwise preserve the least advanced true
    status. Add at most one material completion comment and append sanitized audit records.

The loop stops only after verified merge, an explicit user interruption, or a concrete blocker that
cannot be resolved within the granted PR scope. It does not poll indefinitely without reporting;
long external waits use bounded status checks and concise progress updates.

## Readiness contract

A merge decision requires fresh evidence tied to the exact head SHA:

- the PR is open, ready for review, and targets the intended base;
- the worktree is clean, the head is pushed, and the base is an ancestor of the head;
- GitHub reports no merge conflict and strict base freshness is satisfied;
- the PR Work map names the unique live Nohmi Project and every direct issue;
- each direct issue belongs to Nohmi, has a structured backlink to this PR, and has a compatible
  status;
- focused verification and `pnpm verify` succeeded on the current head;
- every required CI and CodeRabbit check succeeded on the current head;
- no actionable unresolved feedback remains;
- the independent review loop has no new verified findings on the current head; and
- the title, body, diff, documentation, and Linear records still agree.

Unknown, absent, stale, neutral-when-required, skipped-when-required, or pagination-incomplete
evidence does not satisfy a gate.

## Merge strategy

The repository currently supports squash merges and auto-merge, while merge commits and rebase
merges are disabled. `ship-it` therefore uses squash consistently and reads these capabilities live
before acting.

Normal squash merge is preferred. Administrator merge is allowed only after the readiness contract
passes and only when GitHub confirms that the authenticated actor can perform it. If immediate merge
is unavailable without administrator authority, the skill enables squash auto-merge. It never
changes repository settings to manufacture a merge path.

## Verification

Implementation follows skill TDD:

1. Run independent baseline pressure scenarios without `ship-it` and record concrete unsafe or
   incomplete behavior.
2. Add failing evaluator tests for each readiness and merge-strategy invariant.
3. Implement the minimum evaluator and skill guidance that makes those tests pass.
4. Re-run independent scenarios with the skill and close only demonstrated loopholes.
5. Run the evaluator unit suite, skill-package validation, repository contract checks, diff checks,
   and `pnpm verify` before publishing the final branch head.

The final handoff reports the PR, exact merged commit or auto-merge state, direct Nohmi issues,
structured backlinks, verification evidence, review outcome, audit paths, and any blocker without
claiming remote state that was not re-read.
