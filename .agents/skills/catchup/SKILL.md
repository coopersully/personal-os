---
name: catchup
description: Update an ilo branch from its pull request base, make a PR current, inspect upstream changes, resolve conflicts, adapt branch assumptions, verify, commit, and push safely. Use for catch-up, stale-branch, base-sync, rebase, merge-main, or conflict-resolution requests.
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

1. Run `git status -sb`; resolve branch, upstream, PR URL, base, draft state, and head SHA.
2. Fetch the base. Inspect incoming commits, paths, and diff before integration.
3. Identify overlap in files, domains, public contracts, helpers, dependencies, migrations, tests,
   current docs, and composition roots.
4. Rebase or merge using the safety rule above.
5. Resolve conflicts by preserving both intents when compatible and adopting newer authoritative
   contracts/helpers where they supersede branch assumptions. Stop for ambiguous product,
   architecture, migration, or security decisions.
6. Search for conflict markers and inspect semantic overlap even in automatically merged files.
7. Update branch code, tests, and current docs when upstream invalidated an assumption.
8. Run focused checks, `git diff --check`, then `pnpm verify`.
9. Commit a merge when Git did not create one automatically; do not create an empty catch-up commit.
10. Push without force, then re-read PR mergeability, head SHA, and checks.

## Output

Use the PR workflow output contract. Include source/base, integration strategy, incoming changes,
conflicts and resolutions, branch adaptations, commit/push state, exact verification, and blockers.
