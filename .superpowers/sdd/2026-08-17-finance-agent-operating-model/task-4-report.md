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

## Fix round 1 — Batch A

- `transaction_breakdown` now separates the route/client/MCP transaction ID from the strict breakdown body before parsing. Preparation and terminal revalidation resolve the owned account first, lock the transaction snapshot, reject pending rows, verify the exact-cent allocation sum, revision, and category ownership, and emit provider-aware transaction evidence. Invalid actions produce recoverable `needs_input` before review queueing or bypass application.
- Breakdown action coverage now exercises review-disabled queueing, enabled bypass/approval, pending transactions, stale revisions, invalid sums, and one-step allocation answer recovery without a repeated question.
- Merchant evidence exposes a single documented `minimumMerchantOnlyConfirmations` threshold. The proposal keeps ineligible evidence explainable, but requires `merchantOnlyEligible` before an agent can apply it. Explicit learned merchant rules and deterministic classifications remain independent. Broad retailers, corrections, category diversity, and explicit mixed history stay non-actionable regardless of confirmation count.

### Fix round 1 verification

- RED: combined breakdown input was rejected as `needs_input`; threshold-driven evaluator cases failed until the eligibility constant and gate were implemented.
- `pnpm exec vitest run apps/api/src/finance-merchant-evidence.test.ts apps/api/src/finance-action-service.integration.test.ts apps/api/src/finance-service.integration.test.ts packages/domain/src/domain.test.ts --reporter=verbose` — 119 tests passed.
- Domain, database, API, API-client, and MCP type checks passed. (The attempted `@personal-os/client` filter matched no package; the repository package is `@personal-os/api-client`.)
- Scoped Biome and `git diff --check` passed.

## Fix round 1 — Batch B

- `futureRule` remains null and one-off by default. When requested, the action preparation and terminal service transaction lock the transaction, merchant, supporting classification history, and existing normalized-merchant rule before accepting it. Only consistent, merchant-only-eligible history supporting the requested category can create or replace the rule; ambiguous, mixed, corrected, broad-retailer, or mismatched history returns recoverable `needs_input` before bypass or review queueing.
- A reusable-rule review now separately describes the permanent normalized-merchant rule, its category and scope, sourced merchant evidence, and the rule's before-to-after state. The rule stores its stated rationale and a durable evidence snapshot; the transaction audit records a redacted rule summary. MCP documentation calls the optional future rule consequential rather than an ordinary one-off split.
- `0061` now gives allocations an `active` or `invalidated` state and invalidation timestamp, retaining the `0059 -> 0060 -> 0061` journal chain. On a provider amount change, a single active allocation follows the exact new amount; a multi-allocation split is locked, invalidated in place, and given an `amount_changed` review case. Pending-to-posted replacements with the same amount remain active.
- Budget status reads active allocations only, while transaction and export projections retain invalidated allocations as evidence. The allocation-order uniqueness constraint is active-only and ordinary recategorization/breakdown writes replace active rows only, so an explicit corrected breakdown can coexist with its archived provider-drift evidence without double counting.

### Fix round 1 Batch B verification

- RED: the initial new future-rule review disclosure test lacked the separate permanent-rule safe change; the allocation-state schema test and provider-drift integration test failed before state/invalidated handling was added.
- `pnpm exec vitest run apps/api/src/finance-action-service.integration.test.ts apps/api/src/finance-service.integration.test.ts packages/database/src/schema.test.ts packages/domain/src/domain.test.ts apps/mcp/src/server.test.ts --reporter=dot` — 143 tests passed.
- Domain, database, API, API-client, and MCP type checks passed.
- Scoped Biome and `git diff --check` passed.

### Fix round 1 Batch B concerns

- `0061` is still the branch-local, unshipped final migration, so it was extended rather than adding a fourth migration; the checked migration journal remains ordered through `0061`.
- `pnpm verify` was not run; focused integration tests, type checks, scoped formatting, and diff validation were run instead.

## Fix round 2 — Batch A

- Shared active-allocation projections now distinguish gross cash from personal spending. Gross bank transactions remain intact for cash-flow netting and exports, while overview, budget pace, budget categories, and Finance status personal spending consume only active `personal` shares. A legacy transaction category is used only when no active allocations exist; reimbursable shares are excluded pending Task 5 receivable tracking.
- `toCents` provides one tolerant shared conversion path for normal decimal values such as `19.99`, `1.15`, and `0.29`, rejects fractions of a cent and unsafe magnitudes, and replaces Finance mutation-path multiplication/rounding. Signed account balances remain supported; money inputs remain nonnegative through their domain schemas.
- Breakdowns permit a category once per treatment, allowing a $310 Dining receipt to record $90 personal and $220 reimbursable under the same category. Category ownership validation now deduplicates category IDs before querying.
- Saving a breakdown records durable category evidence, records a correction when it replaces an existing category, and recalculates merchant behavior from the current locked merchant state plus the new evidence. A multi-category split therefore marks a non-broad merchant mixed, and explicit mixed behavior cannot be downgraded by a later single-category correction.

### Fix round 2 Batch A verification

- RED: the same-category/different-treatment input was rejected by the old category-only uniqueness constraint; personal-care budget spending incorrectly included the reimbursable allocation; a non-broad multi-category split left merchant behavior `unknown`.
- `pnpm exec vitest run packages/domain/src/domain.test.ts apps/api/src/finance-service.integration.test.ts apps/api/src/finance-status-service.integration.test.ts apps/api/src/finance-action-service.integration.test.ts --reporter=dot` — 136 tests passed.
- Domain, database, API, API-client, and MCP type checks passed.
- Scoped Biome and `git diff --check` passed.

## Fix round 2 — Batch B (partial)

- With explicit integration-owner confirmation that `0061` is unshipped and has no upstream or PR, its deploy-time bulk allocation `INSERT … SELECT` was removed. A durable bounded allocation backfill checkpoint and composite transaction/category ownership foreign keys were added instead. The initial service pass is checkpoint-locked, bounded to 500 rows, skip-locked, and idempotently materializes one personal allocation only for posted legacy transactions without an active allocation.
- Breakdown audit now derives before and after allocation/treatment counts from locked active allocation rows, without exposing amounts or rationales.
- Regression coverage verifies PostgreSQL rejects an allocation whose user does not own both referenced transaction and category, and verifies a category-name-only legacy transaction receives an exact personal allocation and a newly materialized owned category.
- A high-cursor regression fixture verifies resume across one-row batches, idempotent completion, and two concurrent workers: one claims the skip-locked checkpoint and inserts the final allocation while the other reports unclaimed, leaving exactly one allocation per legacy transaction.
- Breakdown audit regression coverage verifies active before/after allocation and reimbursable counts with a null future-rule state, omits private rationale text, and proves an injected audit write failure rolls allocation replacement back atomically.
