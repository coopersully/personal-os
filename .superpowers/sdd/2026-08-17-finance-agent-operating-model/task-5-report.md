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
