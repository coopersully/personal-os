# Task 6 — Finance maintenance candidates

## DONE

- Added durable, private Finance maintenance candidates and candidate items in migration 0063 with ownership, run cascade, active-run, ordinal, fingerprint, state, and disposition fences.
- Added strict domain contracts for candidate state, prepared/question/removed/committed item disposition, private prepared payloads, safe projections, and paged candidate records.
- Changed candidate-aware maintenance to prepare supported categorizations as durable candidate items and ambiguous transactions as candidate questions. It preserves deterministic transfer reconciliation, but performs no pre-challenge categorization, question-review creation, or cash-flow semantic refresh.
- Added a 47-item integration scenario: 41 prepared actions, six questions, zero pre-challenge categorization calls, and stable item fingerprints across retry.
- Added a read-only candidate projection at creation time for gross cash spending, personal spending, outstanding reimbursements, budget variance, and questions. Prepared categorization overlays do not alter canonical rows.

## CONCERNS

- The connected-agent challenge lifecycle and post-challenge commit-or-one-review batch are deliberately left for Task 7, which adds the required `awaiting_agent_challenge` run status and durable challenge authority. Task 6 does not prematurely settle semantic candidate items.
- The initial projection is conservative: prepared categorization changes do not change cash or personal-spending totals. Reimbursement-aware overlay refinement belongs with the challenge/settlement work.

## BLOCKED

- None.

## Verification

- `pnpm exec vitest run apps/api/src/finance-maintenance-service.integration.test.ts apps/api/src/finance-action-service.integration.test.ts packages/domain/src/domain.test.ts packages/database/src/schema.test.ts` — 126 passed.
- API, Domain, and Database typechecks passed.
- Scoped Biome and `git diff --check` passed.
