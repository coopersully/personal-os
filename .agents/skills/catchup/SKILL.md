---
name: catchup
description: Use when updating a nohmi branch from its pull request base, resolving merge conflicts, merging main, or making a published PR current.
---

# Catch up branch

Treat base synchronization as engineering work, not a mechanical Git operation.

## Safety

- Stop when unrelated local changes could be overwritten.
- Never reset hard, clean, discard user changes, or force-push without explicit authorization.
- Use the PR base when one exists; otherwise default to `main`.
- Rebase an unpublished branch before its first PR. For an already published/shared branch, merge
  the base without rewriting history unless the user explicitly authorizes a rebase and force-push.
- Preserve append-only published migrations and branch-specific test coverage.

## Workflow

1. Read `AGENTS.md`, `docs/engineering/pr-rubric.md`, `docs/engineering/work-context.md`,
   `../linear-context/SKILL.md`, and `../linear-work-sync/SKILL.md` for a published PR.
2. Run `git status -sb`; resolve branch, upstream, PR URL, base, draft state, and head SHA.
3. Fetch the base. Inspect incoming commits, paths, and diff before integration.
4. Identify overlap in files, domains, public contracts, helpers, dependencies, migrations, tests,
   current docs, and composition roots.
5. Rebase or merge using the safety rule above.
6. Resolve conflicts by preserving both intents when compatible and adopting newer authoritative
   contracts/helpers where they supersede branch assumptions. Stop for ambiguous product,
   architecture, migration, or security decisions.
7. Search for conflict markers and inspect semantic overlap even in automatically merged files.
8. Update branch code, tests, and current docs when upstream invalidated an assumption.
9. Run focused checks, `git diff --check`, then `pnpm verify`.
10. Commit a merge when Git did not create one automatically; do not create an empty catch-up commit.
11. Push without force, then re-read PR mergeability, head SHA, and checks.
12. For a published PR, use the `create-pr` reconciliation phase to refresh the Work map and invoke
    `linear-work-sync` for structured backlink/status repair. The conflict-resolution request grants
    only those PR-scoped Linear writes unless the user explicitly skips Linear.

## Output

Use the PR workflow output contract. Include source/base, integration strategy, incoming changes,
conflicts and resolutions, branch adaptations, commit/push state, exact verification, Nohmi Linear
issue/backlink state, audit path, and blockers.
