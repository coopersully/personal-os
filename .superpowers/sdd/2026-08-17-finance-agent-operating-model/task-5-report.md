# Task 5 Report — Finance reimbursements

**Status: DONE**

Implemented first-class reimbursement records and many-to-many credit matches in migration 0062. Reimbursements are exact-cent, ownership-scoped, revision-guarded, transactionally locked, auditable, and idempotent for an identical already-recorded credit match or cancellation. Cancellation restores only the unmatched allocation remainder to personal-spending projections without changing bank cash; matched income credits are not modeled as personal spending.

Added the reimbursement lifecycle (`expected`, `partially_received`, `received`, `overdue`, `cancelled`, `needs_input`), list/reconcile/cancel API surface, typed client methods, Finance status counts, and a single discriminated `reconcile_finance_reimbursement` MCP mutation. Agent writes are routed through the Finance action disposition service; the MCP tool has no external-payment capability. Added a robust median/MAD anomaly detector that prefers five merchant observations, falls back to category history, respects budget materiality and expected recurring charges, and returns structured source references and reimbursement-aware rationale.

Validation completed:

- API, API-client, MCP, Domain, and Database typechecks.
- Biome checks for all Task 5 implementation files.
- Focused reimbursement/anomaly/domain/schema/status/MCP tests.
- Existing Finance service, action service, route, API-client, and MCP server suites.

The integration suites emit an existing `pg` deprecation warning from concurrent test-client queries; no test failures resulted.

## Batch A hardening

**Status: DONE**

Reimbursement mutation writers now inherit the supplied Task 3 transaction, so reimbursement records, matches, Finance evidence, broad redacted audit events, and review terminalization commit or roll back as one unit. Agent preparation now locks and revalidates the owned allocation, expense and credit transactions/accounts, reimbursement/matches, revisions, amount capacity, posted-credit state, and evidence before bypass or approval. It also locks semantic targets for the reimbursement, allocation, credit, transactions, and accounts.

Broad `audit_events` reimbursement payloads now contain only status, revision, and match-count summaries; amounts, payer, rationale, credit details, and evidence remain in the Finance-scoped reimbursement records. Added migrated-PostgreSQL coverage for partial/cancelled/full and multi-payer combined-credit lifecycles, idempotent create/match/cancel replay, executor rollback, concurrent capacity enforcement, cancellation spending restoration, agent bypass/review behavior, terminalization failure rollback, and broad-audit privacy.

## Batch B accounting and evidence completion

**Status: DONE**

Reimbursement accounting now has one per-allocation projection: active expected amounts are excluded from personal spending, while a cancelled case excludes only its actually received amount and restores the unmatched cents. This projection is used by budget status, Finance status, overview, budget pace, and pending personal-spending calculations. Allocation capacity uses that same lifecycle rule, so cancellation can restore capacity without allowing active expectations to overlap a reimbursable allocation.

Matched reimbursement cents are also projected per credit. Combined credits retain their unmatched fraction in normal observed-income/refund calculations, while matched cents are excluded from Finance status income, overview refunds, personal-budget impact, and observed annual income. Safe-to-spend now reserves all open expected remainder immediately and releases it upon receipt or cancellation. Effective overdue status is derived consistently for lists and status while explicit `needs_input`, received, and cancelled states remain preserved.

Migration 0062, Drizzle schema, and domain contracts now retain bounded rationale plus typed source-reference evidence for create, credit matching, and cancellation. Detailed evidence remains Finance-scoped; broad audit records stay redacted.

Batch B validation completed:

- `pnpm exec vitest run apps/api/src/finance-reimbursement-service.integration.test.ts apps/api/src/finance-action-service.integration.test.ts apps/api/src/finance-status-service.integration.test.ts apps/api/src/finance-service.integration.test.ts` — 120 passing.
- API, API-client, MCP, Database, and Domain typechecks.
- Biome checks for changed API, Domain, and Database implementation files.

## Batch C anomaly and ambiguous-credit intelligence

**Status: DONE**

The robust reimbursement anomaly detector now runs through Finance maintenance question refresh, so it produces durable, bounded `possible_reimbursement` review cases rather than isolated detector output. It uses merchant history only with five comparable observations, otherwise category history; combines median/MAD with category-budget materiality; and suppresses only recurring charges within their configured expected amount and tolerance. Changed recurring charges remain reviewable. Detector source references are now canonical transaction references with the real provider, account, remote ID, and revision.

Maintenance also triages only plausible unmatched reimbursement credits. It excludes pending, transfer, payroll/salary, ordinary income, refund, and fully matched credits; then requires a reimbursement-oriented descriptor plus date/amount or payer evidence against an outstanding case. A plausible combined Venmo-style credit creates a `needs_input` review that explicitly permits partial matching across cases, never an automatic payment or brute-force match. Finance status reports these plausible unmatched credits and reimbursement-anomaly counts, while MCP marks the combined reconciliation/cancellation operation as a review-governed destructive Finance projection mutation.

Batch C validation completed:

- `pnpm exec vitest run apps/api/src/finance-anomaly-service.test.ts apps/api/src/finance-service.integration.test.ts apps/api/src/finance-status-service.integration.test.ts apps/mcp/src/tool-catalog.test.ts apps/mcp/src/server.test.ts` — 88 passing.
- API, API-client, MCP, Database, and Domain typechecks.
- Biome and `git diff --check` for changed Task 5 files.

## Round 2A privacy and lifecycle hardening

**Status: DONE**

Broad maintenance review audits now retain only review identity, reason, status, transaction identity, timestamp, and safe maintenance attribution; private rationale and review details remain solely on Finance review records. The reimbursement core writer rejects pending credits for every caller, not only agent preparation. Exact replay now requires the recorded canonical evidence, rationale, amount, and prior revision; changed cancellation or same-credit-match input returns a conflict.

Safe-to-spend now uses the synchronized cash forecast directly: posted expense cash has already moved, and uncertain reimbursements are not forecast income, so outstanding reimbursement is not subtracted twice. Prepared reimbursement actions replace caller-provided source references with canonical references derived from the locked, owned expense and credit records. The MCP reconciliation operation remains destructive and now advertises per-operation approval rather than an incorrectly broad approved-rule policy.

Round 2A validation completed:

- Focused reimbursement/action/service/MCP suites — 117 passing.
- API, API-client, MCP, Database, and Domain typechecks.

## Round 2B candidates and cadence

**Status: DONE**

Added one conservative shared plausible-credit selector for reimbursement list, Finance status, and maintenance. It reports matched and remaining cents, filters pending/transfer/payroll/refund/fully-matched income, and requires payment-app descriptor plus outstanding-case proximity before surfacing a candidate. Anomaly maintenance now reads a bounded trailing-year history outside the active scope, never future rows, and recurring suppression also requires the configured cadence window.

## Typed maintenance-question resolution

**Status: DONE**

Commit `f1d14ff` changed maintenance reimbursement findings from generic review cases into private, durable Finance questions. Commit `161ed72` resolves those questions through the Task 3 question pipeline without merging answer keys into arbitrary action inputs. Each maintenance question requests one bounded typed `answer` object while candidate IDs, source revisions, and maintenance authority stay private.

The action service locks and revalidates owned accounts, transactions, allocations, categories, reimbursement cases, matches, credit capacity, and source revisions in the terminal transaction. It records entirely-personal expenses as durable person-provided classification evidence; converts a single-allocation $310 expense with a $220 reimbursement into a $90 personal allocation plus $220 reimbursable allocation and case; supports explicit non-reimbursement credits; and applies partial combined-credit matches atomically. Changed sources or revisions return a narrower recoverable question. Exact replay returns the stored outcome; a changed answer conflicts.

Question terminalization, prepared-review disposition, semantic mutation, and redacted audit share one transaction. Bypass controls only whether the prepared answer applies or queues a review. A maintenance question has explicit stored `same_user_finances_write` authority so a same-user scoped agent may answer it, while ordinary agent ownership remains enforced. Public Finance question listing and Finance status expose only public descriptors and counts. The typed API client and `answer_finance_question` MCP tool forward reimbursement answers through the same bounded envelope.

### Verification follow-up

**Status: DONE**

- Fixed the API-client Finance-status fixture to include current reimbursement summary fields.
- Focused client, action-service, route, MCP, and Finance-status tests; API-client/API/MCP typechecks; Biome; and `git diff --check` were run.
- No full `pnpm verify` was run in this follow-up by instruction. The earlier full run advanced through lifecycle and lint contracts but was not used as completion evidence.

### Concerns

- Multi-allocation expense reimbursement questions remain recoverable `needs_input`; the resolver intentionally does not flatten distinct category/order treatments into an unsafe split.

### Blocked

- None.

## Question correctness and provider provenance — Batch A

### DONE

- Maintenance anomaly triage skips any expense with an active expected, partially received, overdue, or needs-input reimbursement case on one of its active allocations. Existing cases remain editable only through explicit reconciliation/cancellation.
- Reimbursement-answer preparation rejects a crafted expense question that points to an active case, including an `entirely_personal` answer, so it cannot silently strand or duplicate a case.
- Revalidation now compares complete canonical transaction provenance (`provider`, account, remote transaction ID, revision, and source type). Plaid, PayPal, Venmo, and Zelle expense and credit questions resolve with their provider IDs; a stale Plaid revision returns `needs_input`.
- The public Finance-question contract intentionally supports a bounded `object` answer descriptor while rejecting private candidate values and unknown descriptor fields.

### CONCERNS

- Multi-allocation expense reimbursement questions still return `needs_input`; preserving their independent category/order treatments requires an explicit breakdown rather than an inferred replacement.

### BLOCKED

- None.

Validation: `pnpm exec vitest run apps/api/src/finance-action-service.integration.test.ts apps/api/src/finance-service.integration.test.ts packages/domain/src/domain.test.ts` (133 passing), workspace typecheck, Biome, and `git diff --check`.

## Reimbursement lifecycle guards and cadence — Batch B

### DONE

- Replacing an allocation breakdown or categorizing a transaction now locks reimbursement cases and matches before it can remove referenced active allocations, returning a recoverable reconciliation-first conflict instead of a database foreign-key failure.
- Account deletion now rejects expense accounts with reimbursement cases and credit accounts with reimbursement matches, while unrelated accounts remain deletable.
- Exact direct credit-match replay now also requires the stored rationale and canonical evidence to match; a later case revision or another match does not invalidate the same request.
- Recurring anomaly suppression now requires a non-null expected date; an undated recurring record no longer suppresses a material anomaly.

### CONCERNS

- None.

### BLOCKED

- None.

Validation: `pnpm exec vitest run apps/api/src/finance-action-service.integration.test.ts apps/api/src/finance-service.integration.test.ts apps/api/src/finance-anomaly-service.test.ts` (106 passing), API and database type checks, Biome, and `git diff --check`.

## Reimbursement lock and replay follow-up

### DONE

- Typed credit-question preparation and direct reimbursement reconciliation share sorted reimbursement-case and match locking helpers. Typed questions lock named cases before account and transaction evidence, then lock the relevant match rows.
- An exact credit-match replay remains idempotent after a later distinct match advances the reimbursement revision; altered rationale or evidence still conflicts.

### CONCERNS

- None.

### BLOCKED

- None.

Validation: `pnpm exec vitest run apps/api/src/finance-action-service.integration.test.ts apps/api/src/finance-service.integration.test.ts` (102 passing), API and database type checks, Biome, and `git diff --check`.

## MCP metadata and handoff — Batch C

### DONE

- `answer_finance_question` now advertises `approve_each` and destructive conditional-mutation metadata: a typed answer can change allocations or create/match an internal reimbursement case, while the API remains the sole owner of the final apply-versus-review disposition.
- MCP and Finance architecture documentation now describe same-user public question listings, authorized maintenance-question answers, bounded evidence, typed reimbursement handling, and the strict absence of external payments.
- Task 5 implementation commits are `f1d14ff`, `161ed72`, `3c11b0d`, `478b0f4`, `03bbef1`, and `0e08c01`; this metadata/documentation completion follows them.

### CONCERNS

- None.

### BLOCKED

- None.

Validation: `pnpm exec vitest run apps/mcp/src/tool-catalog.test.ts` (2 passing), MCP typecheck, Biome, and `git diff --check`.

## Reimbursement contention verification

### DONE

- Added two-session PostgreSQL barrier tests with a five-second server-side `statement_timeout` for typed credit-question resolution versus direct signed-in reconciliation on the same reimbursement case and credit, and typed expense-question resolution versus direct allocation-breakdown replacement on the same expense.
- Both races complete without a deadlock or hang. Credit contention leaves exactly one full-value match and a received reimbursement. Expense contention either applies the typed $220 reimbursement split or accepts the direct replacement and returns a recoverable typed outcome; both terminal states preserve the full $310 allocation, avoid a duplicate/stranded reimbursement case, and record a terminal review audit state.

### CONCERNS

- None.

### BLOCKED

- None.

Validation: `pnpm exec vitest run apps/api/src/finance-action-service.integration.test.ts apps/api/src/finance-reimbursement-service.integration.test.ts apps/api/src/finance-service.integration.test.ts apps/api/src/finance-status-service.integration.test.ts` (130 passing), API and Database typechecks, Biome, and `git diff --check`. No full `pnpm verify` was run by instruction.
