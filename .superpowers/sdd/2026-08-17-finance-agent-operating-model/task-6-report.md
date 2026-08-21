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

## CONCERNS

- The connected-agent challenge lifecycle and post-challenge commit-or-one-review batch are deliberately left for Task 7, which adds the required `awaiting_agent_challenge` run status and durable challenge authority. Task 6 does not prematurely settle semantic candidate items.
- The initial projection is conservative: prepared categorization changes do not change cash or personal-spending totals. Reimbursement-aware overlay refinement belongs with the challenge/settlement work.

## BLOCKED

- None.

## Verification

- `pnpm exec vitest run apps/api/src/finance-maintenance-service.integration.test.ts apps/api/src/finance-action-service.integration.test.ts packages/domain/src/domain.test.ts packages/database/src/schema.test.ts` — 126 passed.
- API, Domain, and Database typechecks passed.
- Scoped Biome and `git diff --check` passed.
