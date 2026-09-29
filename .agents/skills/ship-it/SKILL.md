---
name: ship-it
description: Use when Cooper asks to ship, land, autonomously merge, or take one nohmi pull request all the way through merge.
---

# Ship It

Take one Nohmi pull request to a verified squash merge. An explicit invocation authorizes in-scope
edits, tests, commits, non-force pushes, thread resolution, PR metadata changes, bounded Nohmi
Linear writes, auto-merge, and the final merge. It does not authorize product-scope expansion,
protection changes, weakened gates, force pushes, or cross-Project Linear writes.

## Required workflows

Read `AGENTS.md`, `docs/engineering/pr-rubric.md`, and `docs/engineering/work-context.md` first.

- **REQUIRED SUB-SKILL:** Use `create-pr` to create or reconcile the PR and two-phase Linear links.
- **REQUIRED SUB-SKILL:** Use `catchup` whenever the head is not proven current with the fetched
  base or has conflicts.
- **REQUIRED SUB-SKILL:** Use `resolve-pr-comments` for every human or verified bot finding.
- **REQUIRED SUB-SKILL:** Use `refine-pr` for fresh independent review passes.
- **REQUIRED SUB-SKILL:** Use `linear-work-sync` for Nohmi coverage and post-merge state.
- Use `pr-shepherd` state collection and maintenance routes where useful. A `NOOP` result is not
  merge authorization.

`create-pr` remains non-merging inside its phase. After it returns, only this skill's explicit
authority may perform the separately gated final merge.

This invocation is human direction for necessary in-scope edits to protected surfaces already in
the PR. Stop when a sound fix requires unrelated behavior, altered branch protection, reviewer
intent override, ambiguous migration/security judgment, or another Linear Project.

## Convergence loop

1. Resolve exactly one open PR, repository, authenticated actor, base, head, and live merge
   capabilities. Preserve unrelated local changes and fail closed on ambiguity.
2. Reconcile the diff, docs, title/body, Nohmi Work map, direct issues, statuses, and structured PR
   backlinks through `create-pr` and `linear-work-sync`.
3. Fetch the base. If its current SHA is not contained in the head, use `catchup`, rerun affected
   checks, push without force, and restart this loop.
4. Collect all review surfaces. Validate CodeRabbit and other bot findings as evidence, address every
   actionable item, resolve only handled threads, and restart after any head change.
5. Run focused tests for changed behavior and `pnpm verify`. Commit and push only a verified,
   intentional diff. Verification evidence expires whenever the head changes.
6. Run `refine-pr`. Fix every verified in-scope finding with the applicable implementation/testing
   workflow, then restart. Continue fresh review passes until `refine-pr` reports no new verified
   findings or a real blocker.
7. Query live branch protection or rulesets to determine the required-check names. Wait for every
   current-head selected CI job and CodeRabbit pass. Missing required checks do not count as green.
8. Build a sanitized state file using [references/readiness-state.md](references/readiness-state.md)
   and run:

   ```bash
   PYTHONDONTWRITEBYTECODE=1 python3 \
     .agents/skills/ship-it/scripts/evaluate_readiness.py \
     --state .context/ship-it/state.json --pretty \
     --output .context/ship-it/decision.json
   ```

9. Follow only the returned decision:
   - `REMEDIATE`: fix the reported in-scope gates, then restart.
   - `WAIT`: use bounded live checks and continue when state changes.
   - `BLOCK`: stop with the exact human decision or missing authority.
   - `MERGE` or `AUTO_MERGE`: perform the final race check below.

Do not impose a pass limit. Continue until verified merge, explicit interruption, or a concrete
out-of-scope blocker. Keep long waits visible with concise progress updates.

## Final race check and merge

Immediately before the mutation, refetch the PR, base SHA, head SHA, rulesets, required checks,
reviews/threads, CodeRabbit, and Linear issues. Rebuild and re-evaluate the state. Proceed only when
the decision and head SHA are unchanged.

- `MERGE` / `normal`: `gh pr merge --squash --delete-branch --match-head-commit <head>`.
- `MERGE` / `admin`: first prove the authenticated actor has administrator bypass authority and
  normal merge is blocked only by the final protection mechanism; then use the same command with
  `--admin`.
- `AUTO_MERGE`: `gh pr merge --auto --squash --delete-branch --match-head-commit <head>`, then
  monitor until merged or a new blocker appears.

Administrator mode never substitutes for a pending/failed check, stale base, conflict, missing
approval, unresolved finding, incomplete review, failed verification, or Linear gap. Never modify
repository settings to create a merge path.

## After merge

Re-read the PR and resulting commit. Confirm the audited head is the merged source. Use
`linear-work-sync` to move an issue to `Done` only when this merge satisfies its acceptance criteria;
otherwise preserve the earliest true status. Add at most one material completion comment and append
sanitized audit rows under `.context/ship-it/` and `.context/linear-work-sync/`.

Use the PR workflow output contract. Report the merge commit or auto-merge state, exact verification,
review and CodeRabbit outcome, Nohmi issues/backlinks/statuses, audit paths, and blockers. Read
[references/pressure-scenarios.md](references/pressure-scenarios.md) when modifying this skill.
