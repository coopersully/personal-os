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
