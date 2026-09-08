# Finance budget buckets

**Status:** Approved for implementation from the delegated Finance request

## Decision

Finance keeps transaction categories granular and unchanged. A user-owned active
budget taxonomy contains named buckets; each category can appear in at most one
bucket within that taxonomy. Buckets have optional concise descriptions. Monthly
category budget rows optionally snapshot their bucket assignment, so historical
budgets remain stable when the active taxonomy changes. Existing category-only
budgets remain valid and are reported as unmapped.

The API owns membership validation, rollups, concurrency, agent policy, and
audit events. MCP calls the API. The web budgets view manages buckets and shows
category-level rows plus bucket totals; no provider or ledger data is rewritten.

## Persistence and compatibility

Add `finance_budget_taxonomies`, `finance_budget_buckets`, and
`finance_budget_bucket_categories`. Enforce one active taxonomy per user and
one category membership per taxonomy with partial/unique indexes. Add nullable
`bucket_id` to `finance_budgets` with a foreign key that preserves archived
buckets. Existing rows are untouched and therefore remain unmapped.

Bucket mutations use a transaction-scoped advisory lock per user/taxonomy,
optimistic `expectedVersion`, and append-only redacted audit records. Categories
may be deleted only after membership is removed (restricting the FK); archived
buckets remain readable for historical rows. A taxonomy update atomically
replaces membership rows. Budget rows snapshot a bucket only when that budget is
created with an explicit `bucketId`; changing membership does not rewrite budgets.

## Surfaces and verification

Domain schemas, Drizzle schema/migration, API service/routes, typed client, MCP
tools, and the Finance budgets UI share the same contract. Agent mutations use
the existing Finance `budget_plan` policy boundary and are replay-safe through
the supplied idempotency key. Tests cover exclusive membership, descriptions,
unmapped/history rollups, stale concurrency, audit behavior, typed URLs, MCP
forwarding, and accessible UI interaction. Run focused Finance tests and
`pnpm verify` before handoff.
