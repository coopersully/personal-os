# Task 6 — Finance maintenance candidates

## DONE

- Added durable, private Finance maintenance candidates and candidate items in migration 0063 with ownership, run cascade, active-run, ordinal, fingerprint, state, and disposition fences.
- Added strict domain contracts for candidate state, prepared/question/removed/committed item disposition, private prepared payloads, safe projections, and paged candidate records.
- Changed candidate-aware maintenance to prepare supported categorizations as durable candidate items and ambiguous transactions as candidate questions. It preserves deterministic transfer reconciliation, but performs no pre-challenge categorization, question-review creation, or cash-flow semantic refresh.
- Added a 47-item integration scenario: 41 prepared actions, six questions, zero pre-challenge categorization calls, and stable item fingerprints across retry.
- Added a read-only candidate projection at creation time for gross cash spending, personal spending, outstanding reimbursements, budget variance, and questions. Prepared categorization overlays do not alter canonical rows.

## Batch A hardening

- Candidate-first maintenance is now the authoritative production graph through `challenge_prepare`. It releases the same run at an open queued challenge checkpoint; it does not settle, refresh health, verify, or publish a period review before challenge authority exists.
- Candidate preparation now locks the owned run and atomically persists `preparing → items/projection → ready_for_challenge`. Exact replay returns stored items/counts; changed fingerprints supersede and rebuild the candidate in the same transaction.
- Candidate maintenance calls an exact-pair-only transfer reconciler. The existing public reconciler retains legacy review/rent behavior, while candidate preparation leaves uncertain transfer and categorization work as private candidate items/questions.
- Migration 0063 now has a composite `(run_id, user_id)` ownership foreign key to the maintenance run and a matching unique run-owner key.

## Batch B typed preparation and pages

- Candidate item drafts are parsed before persistence. Prepared payloads are a closed, action-specific union for every supported Finance action family; question drafts carry a bounded typed answer contract, underlying action, evidence, and as-of revision. Mismatched action/payload kinds and arbitrary payload records are rejected.
- Finance action preparation exposes `prepareMaintenanceCandidateDraft`, which reuses the Task 3 read/prepare path for all supported action families without applying a semantic write.
- Candidate-aware categorization discovery follows opaque proposal cursors (rather than rejecting a second page) and persists a single typed candidate batch. The public owner-scoped candidate reader pages stable ordinals and omits every private payload field.
- Candidate preparation follows opaque proposal pages before it persists the challenge batch; the real 47-item fixture verifies the persisted ordinal order through public candidate-item pages.
- Replaced the former mocked 47-item candidate scenario with a migrated-Postgres production fixture: 41 rule-backed categorization proposals, four genuinely ambiguous merchant questions, one reimbursement-context question, and one possible-transfer question. It asserts ordinal/fingerprint stability, typed underlying actions and source references, same-run retry, and no canonical writes to transactions, allocations, reimbursements, category rules, review cases, alerts, profile, or budget plans.

## Batch B paging durability

- Migration 0063 and the Drizzle schema now retain the private preparation cursor, next ordinal, cumulative discovery revision, and last-page checkpoint metadata.
- Candidate preparation creates an unpublished `preparing` candidate, then appends each source page in a short owned-run transaction. The page fingerprint, cursor, and ordinal fence make an exact replay a no-op; a mismatched replay supersedes the incomplete candidate and rebuilds it on the same run.
- Finalization requires a terminal cursor, verifies contiguous persisted ordinals, computes the complete revision/projection, then transitions the candidate to `ready_for_challenge`. Public candidate/item readers reject incomplete candidates by default.
- Added a real database integration case covering 101 prepared items across three pages, post-page-one recovery, exact replay, drift supersession/restart, and stable final fingerprints.

## Batch C scoped candidate overlay

- Candidate finalization now reads a repeatable-read scope snapshot and projects prepared categorization, transaction-breakdown, and reimbursement create/cancel actions in ordinal order without updating canonical Finance records.
- The projection uses allocation/reimbursement helpers for gross cash, personal allocation shares, invalidated allocations, outstanding reimbursements, and scoped budget actual/total/variance. Candidate revisions include scope, source revisions, ordered fingerprints, and projection assumptions.
- Prepared reimbursement credit matches now reduce outstanding reimbursement amounts in the overlay, while prepared budget plans replace or extend scoped budget limits without changing canonical budget rows. Prepared transaction category updates affect only projected budget classification.
- The candidate payload union is now exhaustive for every supported action kind and retains internal entity IDs where normal route inputs carry the ID outside the body. This permits safe projection of transaction creates/updates and ID-addressed income, recurring, merchant, and alert work.
- Projection now separates financially truthful overlays: gross bank expense, personal allocation expense, reimbursement receivable/matched income, budget plan totals, expected income, recurring committed outflow, and monthly capacity. Merchant and alert work contributes only to projected work count.
- The existing migration-0063 JSONB projection column remains storage-compatible: new projection fields have neutral domain defaults, so no destructive schema rewrite or backfill is needed for already-prepared candidates.
- Added migrated-Postgres projection coverage for a scoped $310 split ($90 personal/$220 reimbursement), partial credit matching, budget variance, profile/income/recurring capacity, month exclusion, invalidated allocations, retry-safe candidate preparation, source-revision drift, and canonical-record immutability.

## Batch D settlement foundation

- Added `settleFinanceMaintenanceCandidate(candidateId, expectedRevision, context)`. It locks the owned challenged candidate and ordered items, rejects unresolved questions, fences exact revisions, queues one bounded `maintenance_turn` review while bypass is off, and applies revalidated prepared actions transactionally when bypass is enabled.
- Drift supersedes the candidate before semantic application; successful settlement marks items/candidate committed and requeues the same maintenance run at `health_refresh`.
- Human approval now recognizes `maintenance_turn` reviews, locks the candidate/run/items, validates the private candidate fingerprint set, applies each prepared item in the review transaction, terminalizes the review, and requeues the same run. Agents remain denied by the existing interactive-user approval guard.

## Batch E settlement verification

- Direct bypass settlement and `maintenance_turn` approval now use one executor-aware settlement helper. It locks candidate, run, and ordered items; validates every prepared item before any writer runs; then commits the batch and requeues the same run at `health_refresh`.
- Bypass-off settlement reuses one bounded review (100 safe public changes) while retaining all private item fingerprints. A stale prepared item supersedes the candidate, supersedes its review, and requeues the same run at `prepare` without partial canonical writes.
- Added migrated-Postgres coverage for 101-item public bounds, human-only approval/idempotency, bypass-on direct commit, unresolved questions, revision drift, and rollback/retry after an injected later audit failure using real categorization, profile, budget, and Task 3 writers.

## Batch F identity and public-contract hardening

- Extracted one canonical Finance action identity helper. Direct action reviews use its unprefixed digest and maintenance candidates use the same digest with the durable `sha256:` prefix; preparation, candidate discovery/persistence, and settlement now agree on the exact normalized action identity.
- Completed strict private candidate payload variants for alert refresh/resolve, merchant rename/merge, full and simple budget actions, transaction create/update, and existing ID-addressed actions. A migrated-Postgres table-driven preparation test verifies representative action-service output stays candidate-parseable.
- Candidate readers now serialize only the exact public domain contracts: candidate preparation internals and item private payloads cannot escape, timestamps are ISO strings, and every outgoing object is schema-parsed.
- Corrected the unshipped migration-0063 projection default and the Drizzle default to a complete neutral projection. Migrated-Postgres settlement fixtures parse the default against the domain contract.

## Batch G durable parked checkpoints

- Added the nonclaimable `awaiting_agent_challenge` maintenance-run state to the domain contract, database schema, and fresh migration. Challenge preparation now atomically releases its lease into that parked state with the candidate ID and revision checkpoint; due scheduling leaves it untouched.
- Bypass-off candidate settlement atomically parks both candidate and same run in `awaiting_approval`, with one reusable review and no remaining lease. Human approval or bypass commit returns the same run to queued `health_refresh` work.
- Candidate dispatch is checkpoint-first after commit: it resumes `health_refresh → verify → period_review` and only settles once those post-commit steps complete, never re-entering an earlier challenge phase.
- Drift supersession now clears the same run's stale step records before requeueing `prepare`, preventing old prepare/challenge receipts from blocking a rebuild.

## Batch H projection source completeness

- Candidate source revisions now include scoped transaction allocations (including invalidations), reimbursements, reimbursement matches, categories, budget rows and plan parents, effective profiles, income/recurring records, accounts, and provider synchronization cutoffs. The stable revision records only IDs, revisions, statuses, dates, and financial values—not rationale text.
- Profile selection is bounded by the projection as-of date, and window projections enumerate every included month. Budget projection keys now include month plus category, so multi-month totals do not silently overwrite same-named categories.

## CONCERNS

- The connected-agent challenge lifecycle and post-challenge commit-or-one-review batch are deliberately left for Task 7, which adds the required `awaiting_agent_challenge` run status and durable challenge authority. Task 6 does not prematurely settle semantic candidate items.
- Prepared categorization remains intentionally cash-neutral; it affects only projected budget classification.

## BLOCKED

- None.

## Verification

- `pnpm exec vitest run apps/api/src/finance-maintenance-service.integration.test.ts` — 19 passed.
- `pnpm exec vitest run apps/api/src/finance-action-service.integration.test.ts` — 63 passed.
- `pnpm exec vitest run packages/domain/src/domain.test.ts packages/database/src/schema.test.ts` — 52 passed.
- `pnpm exec vitest run apps/api/src/finance-maintenance-service.integration.test.ts packages/domain/src/domain.test.ts packages/database/src/schema.test.ts` — 73 passed.
- `pnpm exec vitest run apps/api/src/finance-action-identity.test.ts apps/api/src/finance-action-service.integration.test.ts apps/api/src/finance-maintenance-service.integration.test.ts packages/domain/src/domain.test.ts packages/database/src/schema.test.ts` — 138 passed.
- `pnpm exec vitest run apps/api/src/finance-maintenance-service.integration.test.ts apps/api/src/finance-action-service.integration.test.ts packages/domain/src/domain.test.ts packages/database/src/schema.test.ts` — 137 passed.
- API, Domain, and Database typechecks passed.
- Scoped Biome and `git diff --check` passed.
