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

## Fix round 3 — Batch A (partial)

- Future-rule preparation and terminal validation now require the proposed split itself to be single-category and to match the requested rule category. Mixed post-change splits stay one-off and cannot queue or bypass a reusable rule.
- A saved multi-category split now conservatively sets merchant behavior to mixed regardless of actor outcome, and explicit mixed behavior remains mixed on later single-category replacements.
- Replacement evidence now compares the complete locked ACTIVE allocation category set with the proposed set. Every removed category is recorded as `corrected`; every proposed category is retained as the user-confirmed or agent-applied allocation evidence. Thus `{A,B} -> {B,C}` records `A` corrected and `C` applied/confirmed, while an `A` personal-to-personal/reimbursable treatment-only edit creates no category correction or artificial category diversity.
- Coverage now proves an otherwise eligible future rule is rejected for a proposed mixed split in both bypass and review-disabled paths, and that an approved agent one-off mixed split leaves the merchant mixed. It also verifies active-set replacement and treatment-only behavior directly against durable classification evidence.

### Fix round 3 Batch A verification

- `pnpm exec vitest run apps/api/src/finance-action-service.integration.test.ts apps/api/src/finance-service.integration.test.ts apps/api/src/finance-merchant-evidence.test.ts --reporter=dot` — 95 tests passed.
- API and domain type checks passed; scoped Biome passed.
- `pnpm verify` was not run; the focused Finance suites cover this bounded follow-up.

## Fix round 3 — Batch B

- Shared allocation projections now preserve the distinction between a transaction with no allocation history and one whose allocations are all invalidated after provider amount drift. The former retains the legacy gross/category fallback; the latter contributes zero personal spending until its review is resolved.
- Budget status, overview, budget pace, and Finance status now query allocation existence across both active and invalidated rows. They consume active personal shares only, and an invalidated-only transaction cannot double count through the legacy transaction category fallback. Gross cash flow and export remain bank-amount/evidence based: the bank amount appears once in cashflow while archived invalidated allocations remain exported.
- The provider-drift integration fixture now verifies active single allocation spending, invalidated mixed split exclusion from budget/overview/pace/status personal totals, an outstanding review, unchanged gross cashflow, and exported archived allocation state.

### Fix round 3 Batch B verification

- RED: the provider amount-drift overview assertion observed `$50` personal spending instead of the required `$19`; active-only allocation queries had erased the distinction between never-allocated and invalidated-only transactions.
- `pnpm exec vitest run apps/api/src/finance-service.integration.test.ts apps/api/src/finance-status-service.integration.test.ts --reporter=dot` — 64 tests passed.
- API and domain type checks passed; scoped Biome and `git diff --check` passed.
- `pnpm verify` was not run; focused service/status coverage was used for this bounded follow-up.

## Fix round 3 — Batch C

- The allocation backfill now takes the global checkpoint and the bounded UUID-ordered candidate rows with ordinary row locks. It no longer skip-locks either boundary, so a provider writer holding an earlier row makes the batch wait rather than allowing the cursor to pass that row and strand it permanently. Sequential workers now each claim the checkpoint after the prior batch commits, preserving convergence without duplicates.
- Categorized zero-dollar legacy rows are deliberately marked processed by cursor advancement without creating an allocation, because the allocation integrity check remains strictly positive. A later batch completes instead of retrying the zero row forever.
- Category-name legacy materialization now uses a deterministic user/name-hashed canonical slug. It first resolves an owned case-insensitive name, otherwise inserts idempotently and re-reads the exact canonical slug after conflict. Failure to materialize a categorized positive row aborts the batch so the checkpoint cannot advance without its allocation. This avoids punctuation-derived slug collisions such as `Foo Bar` versus `Foo/Bar`.
- Drizzle’s composite allocation ownership FKs now use the exact `0061` constraint names and delete actions: owned transactions cascade their allocations and owned categories are restricted while referenced. The unshipped `0061` SQL already had these actions, so this is schema parity rather than a migration rewrite.

### Fix round 3 Batch C verification

- RED: a locked first candidate allowed the old skip-locked scan to finish early; a categorized zero-dollar row violated the positive amount check; a punctuation slug collision skipped the allocation; and the schema contract showed composite FKs with generated names and `NO ACTION`.
- `pnpm exec vitest run apps/api/src/finance-service.integration.test.ts packages/database/src/schema.test.ts --reporter=dot` — 62 tests passed.
- API and database type checks passed; scoped Biome and `git diff --check` passed.
- `pnpm verify` was not run; focused service/schema coverage was used for this bounded follow-up.

## Fix round 4 — Final rollout edges

- Breakdown replacement evidence now uses the locked ACTIVE allocation category set whenever active allocations exist. Only a transaction with no allocation rows at all falls back to its locked legacy `categoryId`, so unbackfilled legacy rows record that old category as corrected when replaced. Invalidated allocation rows are treated as durable prior-breakdown history and explicitly suppress the legacy fallback, avoiding duplicate or misleading corrections.
- Both the direct user path and the Task 3 review/approval path now cover legacy replacement evidence; the latter retains the requesting agent actor and records the new category as `applied` alongside the old category correction.
- Legacy category materialization verifies the case-insensitive intended name after every slug conflict. A different-name occupant of the canonical hashed slug causes deterministic hash-suffixed retries; only a matching owned category can receive the backfill allocation. Failure to obtain one aborts the transaction before the global checkpoint advances. Concurrent backfill calls converge on one intended category and allocations for both rows.

### Fix round 4 verification

- RED: an unbackfilled transaction category was not corrected on replacement, and an occupied canonical slug supplied the wrong category name to the allocation.
- `pnpm exec vitest run apps/api/src/finance-service.integration.test.ts apps/api/src/finance-action-service.integration.test.ts --reporter=dot` — 94 tests passed.
- API and database type checks passed; scoped Biome and `git diff --check` passed.
- `pnpm verify` was not run; focused service/action coverage was used for this bounded follow-up.
