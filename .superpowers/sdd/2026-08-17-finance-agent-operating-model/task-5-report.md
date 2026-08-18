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
