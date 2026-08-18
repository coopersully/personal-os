# Task 4 — Mixed merchants and transaction breakdowns

## Status

DONE_WITH_CONCERNS

## Completed behavior

- Merchant evidence is explicitly `unknown`, `consistent`, or `mixed`. CVS, Amazon, Target, Walmart, and Costco receive a conservative mixed prior; category diversity, corrections, and an explicit mixed state prevent merchant-only application. Ordinary history remains transaction-specific evidence unless uncorrected consistent evidence meets the minimum observation threshold.
- `finance_transaction_allocations` preserves owned exact-cent category splits, treatment, rationale, revision, and order. Migration `0061` adds the merchant behavior field, preserves the immutable `0059 -> 0060 -> 0061` journal chain, and backfills one personal allocation for each existing posted categorized transaction.
- `setTransactionBreakdown` locks the owned transaction and current allocations, checks the displayed revision and exact-cent sum, atomically replaces allocations, maintains a single category allocation for ordinary categorization, updates merchant behavior evidence, and writes a redacted audit event. A breakdown is one-off by default; reusable merchant behavior requires the separate explicit `futureRule` field and supporting allocation.
- Budget category totals select allocations first and use a legacy-category fallback only for rows without allocations, avoiding double counting. Transaction export includes allocations; total cashflow remains based on the original bank amount, which the exact-sum invariant preserves.
- `PUT /v1/finances/transactions/:id/breakdown`, API client, and `set_finance_transaction_breakdown` MCP tool use the same input and preserve Task 3's `applied`, `pending_review`, and `needs_input` action disposition. Stale revisions and foreign categories become recoverable `needs_input` for agents; no external financial execution is invoked.

## Verification

- RED: merchant evaluator test initially failed because the module did not exist; domain and schema contract tests initially failed because the allocation contract/table did not exist.
- `pnpm exec vitest run apps/api/src/finance-service.integration.test.ts apps/api/src/finance-merchant-evidence.test.ts packages/domain/src/domain.test.ts packages/database/src/schema.test.ts packages/api-client/src/client.test.ts apps/mcp/src/server.test.ts --reporter=dot` — 116 tests passed.
- `pnpm exec vitest run apps/api/src/finance-action-service.integration.test.ts --reporter=dot` — 42 tests passed.
- API, domain, database, API-client, and MCP type checks passed.
- Scoped Biome checks and `git diff --check` passed.
- The brief's exact package-filtered test commands exited successfully but are no-ops because API and MCP packages define no `test` script; the direct Vitest commands above executed the requested suites.

## Self-review and concerns

- Confirmed transaction and allocation rows are locked in the same database transaction before replacement; allocation insert failure rolls back the delete, transaction update, evidence update, and audit.
- Confirmed the backfill is limited to already-posted, categorized transactions and is idempotent by the transaction/order unique index.
- `apps/mcp/src/tool-catalog.ts` was added to the task scope because the new MCP tool cannot register without the repository's central safety/discovery entry.
- `pnpm verify` was not run; focused integration tests, type checks, format checks, and diff validation were run instead.
