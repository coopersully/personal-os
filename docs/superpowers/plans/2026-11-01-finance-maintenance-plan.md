# Finance Maintenance and Inbox Zero Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Existing owners retain execution; parent is manager-only.

**Goal:** Make daily maintenance progress safely, clear evidenced review cohorts and reconcile a trustworthy monthly budget.

**Architecture:** Select bounded eligible work within existing maintenance/run semantics. Preserve source and allocation evidence in exact review batches, with independent outcome readback.

**Tech Stack:** Existing TypeScript/pnpm API, domain, connectors, typed clients and MCP; current persistence and Texting.

**Spec:** ../specs/2026-11-01-finance-subscription-agent-design.md (approved).

## Global Constraints

Inherit all constraints from 2026-11-01-finance-subscription-agent.md. No paid-model fallback, no duplicate host/writer, no guessed financial decision, no new runtime or unallocated heavy tests. Proposed exports below are new contracts, not claims about shipped APIs. Existing exports/paths were supplied by retained owners at main307fa783; revalidate against accepted current main at execution without duplicating prior reviews.

## Review Focus

- Blocked aggregate run must not be bypassed with duplicate runs (F1).
- One case resolution must not erase splits or sibling reasons (F2).
- Overlapping flag/case entries are not duplicated economic events (F3).
- Duplicate-account cleanup must preserve unique old history (F3).
- Prior approved month and incomplete spending must not produce false current-budget claims (F4).

---
## F1: Adopt legal maintenance recovery and select independent work

**Owner:** existing Finance implementation worker; shared concurrency stays Integration-owned.
**Existing files:** `apps/api/src/finance/automation-prompts.ts`, adjacent test,
`apps/api/src/finance/maintenance-intent-service.ts`,
`packages/domain/src/finance/maintenance.ts`,
`apps/api/src/finance/review-batch-service.ts`.
**Create proposed:** `apps/api/src/finance/maintenance-work-selection.ts`, `.test.ts`.
**Existing interfaces:** strict domain start/resume/continue; maintenance intent
resolveRun/nextAction/host binding; bounded review-batch service.
**Proposed interface:** `selectFinanceMaintenanceWork(items:readonly {id:string;evidenceReady:boolean;approvalReady:boolean;sourceReady:boolean}[]):readonly {id:string;state:'eligible'|'awaiting_evidence'|'awaiting_approval'|'source_blocked'}[]`.

- [ ] Consume accepted PR #330 — Issue valid Finance maintenance recovery commands and PR #331 — Distinguish missing Finance host bindings after accepted shared prerequisite; do not reimplement or repeat unchanged source review. Record actual release/host-adoption status.
- [ ] Add failing selection tests with one eligible item and independent blocked items; all remain represented with exact state. Test compatible open-run reuse and explicit incompatible-scope reporting in the existing maintenance intent service: `resolveRun` owns these checks through `createOrResume` under its per-user transaction lock. Do not add run identity or lease inputs to the pure item selector or create a duplicate run.
- [ ] Run new focused selection test and observe failure; implement selection using current bounded review batch semantics. Any shared concurrency change goes to Integration, not a Finance workaround.
- [ ] Run `pnpm exec vitest run apps/api/src/finance/maintenance-work-selection.test.ts apps/api/src/finance/automation-prompts.test.ts packages/domain/src/finance/maintenance.test.ts apps/api/src/finance/automation-registration.integration.test.ts --maxWorkers=1 --bail=1` in allocated environment. Reuse accepted evidence for unchanged correction tests.
- [ ] Review/commit `feat: select eligible Finance maintenance work`; accept only after a natural run consumes legal commands and makes evidenced independent progress. Host success alone fails acceptance.

## F2: Resolve evidenced reviews while preserving allocations

**Owner:** Finance implementation, with exact Accounts→Memory storage prerequisites
and Speed's migration reservation where needed.
**Existing files:** `apps/api/src/finance/review-batch-service.ts`,
`apps/api/src/finance/review-backlog-service.ts`,
`apps/api/src/mail/finance-receipt-evidence-reader.ts`,
`packages/api-client/src/features/finance-review-backlog.ts`.
**Create proposed:** `apps/api/src/finance/review-existing-allocation-service.ts`
and `.integration.test.ts`. Extend existing domain review-batch action union with
`resolve_existing_allocation`; use the retained dispatch packet for exact domain,
MCP/UI reservation before edits, rather than guessing a replacement contract file.
**Existing interfaces:** review batch preview/get/list/execute; client
getFinanceReviewBacklog/preview/get/execute; receipt reader
`readLocked({tx,principal,sources,expected,signal})`.
**Proposed admission:** immutable versioned evidence binds source versions, parser
version, transaction/case/allocation revisions, currency/direction and full allocation
coverage. Reader observations alone are not immutable admission.

- [ ] Before schema/composition edits, obtain accepted predecessor/API contract and explicit exact migration/journal/app.ts reservation. Do not allocate a timestamp or replay the production watermark. Use saved existing assessment for missing-history explanation.
- [ ] Add failing integration fixture for a49.18 purchase split33.99Apparel+15.19PersonalCare: resolving supported receipt review preserves both allocations and ledger facts; an unrelated sibling case remains open.
- [ ] Add stale source/parser/case/allocation revision, partial receipt coverage, currency mismatch, missing direction, unauthorized host and duplicate execution tests; assert no financial mutation on rejection.
- [ ] Run new test to establish behavioral failure; implement immutable admission and allocation-preserving resolution inside the exact transaction using existing per-item savepoints/outcome recovery.
- [ ] Extend preview/typed client/MCP/leaf UI to expose exact supported effect without flattening splits. Keep shared Mobile layout/navigation outside this slice.
- [ ] Run `pnpm exec vitest run apps/api/src/finance/review-existing-allocation-service.integration.test.ts apps/api/src/finance/review-backlog-service.integration.test.ts apps/api/src/finance/review-batch-service.integration.test.ts packages/api-client/src/features/finance-review-backlog.test.ts apps/mcp/src/tools/finance-review-backlog.test.ts --maxWorkers=1 --bail=1`; require PASS and affected types.
- [ ] Independent review/commit `feat: resolve reviews without replacing allocations`; perform production acceptance only through authorized fresh owner-UI preview/execution and independent readback.

## F3: Cohort cleanup and duplicate-history reconciliation

**Owner:** Finance owns review manifests; existing Plaid recovery owner owns account
identity/history and generic prevention. No new cleanup writer.
**Files:** Existing review-backlog/review-batch modules from F2; owner evidence packet
`.context/coo153-recurring-blockers/backlog-report-20261101.json`; proposed durable
receipt document `docs/engineering/finance-inbox-zero-acceptance.md` (sanitized).
**Interface:** per-item manifest records exact transaction/case/flag identities,
reason, counterpart/receipt/answer evidence, current versions, proposed effect,
preview fingerprint and execution/readback receipt. No aggregate authorizes actions.

- [ ] Retain complete dated baseline:2820entries/1579transactions/1549flags/1271cases; distinguish normalized reasons and transaction dates from case creation dates. Preserve overlap rather than deleting it as duplication.
- [ ] Recovery owner compares provider identity, ownership, freshness and unique history before recommending keeper(s). Complete generic keeper-label/identity fixes through existing review. Present exact comparison for required keeper authorization; no inferred choice or exclusion that hides unique history.
- [ ] Finance builds manifests in order: owned internal counterpart matches and card payments;252roundups after destination/purpose established; receipt-supported categorization including splits; genuine remaining ambiguity questions. Reuse answered Venmo/context facts instead of asking again.
- [ ] For each candidate, verify both-side ownership/amount/currency/direction and no reused counterpart; prove source provenance. Do not classify on merchant label, age or overlap alone. If missing, leave item pending with one concrete next question/action.
- [ ] Preview one bounded eligible batch via supported owner UI with fresh revision and idempotency; execute only the authorized preview; independently read actual per-item outcome and counts. Never replay completed Amazon Health/Instacart batches.
- [ ] Reconcile exceptions, repeat bounded batches, and retain exact receipts. Claim inbox zero only when no genuine unresolved reviews remain; defer/hidden state is not success. Commit sanitized acceptance documentation, not private raw data.

## F4: Reconcile current budget and expose trustworthy projections

**Owner:** Finance implementation; A3 consumes qualified evidence for attention.
**Existing files:** `apps/api/src/finance/budget-plan-projection.ts`,
`profile-budget-service.ts`, `position-service.ts`, `budget-policy-service.ts`,
`planning-evidence-service.ts`, `work-resolver.ts` in the same directory.
**Existing interfaces:** current/previous/upcoming canonical plan projection;
`evaluateMaintenance(userId,position)`; obligation/goal evidence and current-work resolution.
**Produces:** current plan/version plus qualified spending, freshness, payday,
obligation and preference evidence for A3; never claim all-account historical
spending is an approved-period overspend without matching coverage.

- [ ] Add failing tests for month rollover retaining approved October while November is missing; stale/duplicate-affected totals unavailable for confident guidance; expected transfer not counted as spending; confirmed obligations reserved before discretionary room.
- [ ] Run `pnpm exec vitest run apps/api/src/finance/budget-plan-projection.test.ts apps/api/src/finance/profile-budget-service.integration.test.ts apps/api/src/finance/budget-policy-evaluator.test.ts apps/api/src/finance/work-resolver.test.ts --maxWorkers=1 --bail=1`; observe new behavioral failures.
- [ ] Implement qualified projection/evidence boundary, reusing current canonical plan. Do not reapprove October or duplicate its already-shipped status correction.
- [ ] Obtain November net paycheck amount/cadence and deduction treatment from confirmed evidence/user answer. Recent deposits are provisional evidence, not an approved recurring-income assumption. Reconcile current obligations, goals and account ownership; prepare balanced resources/allocations and show unresolved inputs explicitly.
- [ ] Route resulting financial changes through A1/current applicable policy and exact current authorization. Draft is not approved or applied. Independently read back resulting plan and balances after authorized action.
- [ ] Run focused tests and `pnpm --filter @personal-os/domain --filter @personal-os/api typecheck`; review/commit `feat: qualify Finance budget readiness and projections`. Capture actual monthly-budget acceptance separately.

## Memory consumer boundary

Finance's existing `apps/api/src/finance/answer-service.ts` exports answerContextualWork
and answerSmsContextualWork. Accepted answer operation/question/case/transaction refs,
result revision/audit and recordFinanceConversationAcceptedAnswer provide provenance;
they are not a general learning API. A2 consumes an existing record/retrieve/supersession
contract published by the Memory owner. Do not invent Finance knowledge storage.
Relevant regression entrypoint:
`pnpm exec vitest run apps/api/src/finance/contextual-question-service.integration.test.ts apps/api/src/finance/context-service.integration.test.ts apps/api/src/finance/conversation-service.integration.test.ts --maxWorkers=1 --bail=1`.

## Self-review

F1 covers blocked maintenance and independent selection; F2 covers receipt admission,
splits and stale effects; F3 covers evidence-qualified cleanup and duplicate identity;
F4 covers confirmed monthly resources and qualified projections. Storage/concurrency
changes require exact owner contracts, not a generic all-work hold. No new financial
operation is authorized by source tests or the plan itself.
