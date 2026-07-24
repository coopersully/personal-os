---
name: personal-os-database
description: Safely evolve Personal OS PostgreSQL storage with Drizzle. Use when modifying `packages/database/src/schema.ts`, adding SQL migrations, changing repositories or persistence models, or reviewing migration safety.
---

# Personal OS database

Follow `docs/engineering/database-migrations.md`. The Drizzle schema,
generated SQL, and migration journal must describe the same release transition.

## Make a safe change

1. Model the invariant in `packages/domain` when it is shared beyond storage.
2. Update `packages/database/src/schema.ts` and create one atomic migration for
   the independently deployable integrity change.
3. Review generated SQL for locking, casts, defaults, foreign-key order,
   indexes, and preservation of existing values.
4. Add repository/service behavior and tests against a database initialized by
   the repository migrations.
5. Run the focused tests, then `pnpm verify` before handoff.

## Preserve migration history

- A migration may be rewritten only in a private, disposable worktree.
- Once shared, in a PR, or applied outside that worktree, it is immutable.
  Correct it with a new migration; never edit, delete, reorder, or renumber it
  or its journal entry.
- Coordinate migration-number and journal conflicts with the Integration owner.
- Keep schema and migration changes in the same pull request.

## Roll out live-data changes deliberately

Use expand–migrate–contract for incompatible data changes. Add compatible
schema/read paths first; run large backfills as resumable, observable jobs; and
enforce constraints or remove obsolete fields only after callers converge. Do
not put an unbounded backfill in a deploy-time migration. Treat restore as an
incident operation, not a normal rollback path.
