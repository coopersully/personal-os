# Database migration policy

Database migrations are production history. The database schema in
`packages/database/src/schema.ts`, the generated SQL in
`packages/database/migrations`, and the migration journal must describe the
same release transition.

## Scope migrations by change, not by entity

Use one migration for one atomic, independently deployable database change. A
migration may span several tables when a foreign key, constraint, index, or
backfill makes those tables one integrity boundary. Do not create a migration
per entity by rote, and do not bundle unrelated product work into a large
"feature migration." The question is whether the schema can safely be deployed
and reasoned about as one change.

For example, a merchant table, its aliases, and the transaction foreign key may
belong together. An unrelated profile preference or a later reporting index
should be its own migration, even when it is part of the same product area.

## Immutability and branch workflow

While a migration exists only in a private, disposable worktree, its author may
squash or rewrite the branch-local chain into a final coherent migration. Once
it is pushed to a shared branch, included in a pull request, or applied to any
shared, preview, staging, or production database, it is immutable. Add a new
migration for every correction; never edit, delete, reorder, or renumber an
applied/published migration or its journal entry.

Feature branches resolve numbering while catching up with `main`. The migration
journal is integration-owned, so coordinate conflicts rather than independently
rewriting its history.

## Safe rollout shape

Prefer expand–migrate–contract for a change that touches live data:

1. **Expand:** add nullable columns, new tables, indexes, or compatible reads.
2. **Migrate:** deploy code that dual-reads/writes when needed and run a
   resumable, observable data backfill outside the schema migration for large
   tables.
3. **Contract:** after the data and callers have converged, enforce constraints
   or remove obsolete fields in a later release.

Keep a migration transaction short. Do not put a long-running or unbounded data
backfill in a deploy-time migration; it can hold locks and prevent recovery.
Use an operational job with progress and retry semantics instead. If an index
must be built concurrently, use the deployment procedure required by PostgreSQL
rather than assuming it can run inside Drizzle's transactional migration runner.

## Required checks

- Update the Drizzle schema and migration together in the same pull request.
- Review generated SQL for locks, defaults, data casts, foreign-key order, and
  preservation of existing values.
- Exercise migrations against a fresh database in an integration test; add a
  targeted data-preservation test whenever a migration transforms existing rows.
- Keep deployment backward compatible until all migration-capable instances have
  completed. Run only one migration-capable API instance during a breaking
  rollout, take the required backup, and treat database restoration as an
  incident operation.

This policy applies to every domain. A product-specific architecture decision
may explain a particular migration's invariants, but it does not override the
append-only history rule.

## Parallel 0112 lineage reconciliation

The Today branch and connector-health release independently published `0112_today_preferences`
and `0112_connector_capability_health` with ordinal 117 and different timestamps. Both SQL files
and complete journal entries remain immutable, including that historical ordinal collision.
Drizzle's runtime migrator consumes tag, timestamp and SQL hash; it does not use the ordinal.
The merged journal retains both branch histories and appends
`0113_connector_capability_health_reconciliation` at the next array ordinal.

A database that already applied the later Today timestamp would skip the earlier connector
migration, so the reconciliation adds the nullable capability column with `IF NOT EXISTS`.
Fresh and current-main databases retain both capabilities, while earlier Today databases preserve
their saved preferences. Integration coverage initializes each lineage, applies the merged chain
and repeats it to verify idempotency and data preservation. Do not renumber either published 0112
entry to make the historical metadata look cleaner.
