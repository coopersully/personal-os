# Shared Finance workspace

Status: Approved in conversation on 2026-09-03.

## User outcome

An individual and their scoped agents work on the same financial records. The portal answers
where the person stands, what needs judgment, how resources are allocated, and what changes next.
Agent-created proposals must be inspectable and actionable in the portal.

## Experience

Seven primary destinations: Overview, Review, Transactions, Plan, Cash flow, Wealth, Accounts.
Subscriptions live under Cash flow. Imports and evidence health are secondary Accounts destinations.
Financial setup, personal context, rules, and permissions remain discoverable through Finance
settings and a resumeable setup route. Existing deep links continue to work.

Overview uses one primary financial-position block, explicit unavailable/partial evidence, one
material next step, a complete-plan summary, and recent review/work. It never coerces unknown
amounts to zero or renders unqualified wealth from the compatibility overview.

Plan reads the complete versioned budget used by MCP. It exposes proposed/active state, resources,
all allocations, assumptions, rationale, and balanced totals. A user can create or revise a complete
plan and approve the displayed exact version. Mutations use canonical API ownership, revision,
idempotency, and audit paths. Client arithmetic is limited to form feedback; persisted results are
authoritative. Preserve categories, budget buckets, resource kinds, and allocation relationships.

Review leads with one transaction-backed canonical question and its evidence, allows a bounded
typed resolution, and refreshes from the resulting API state. Existing legacy questions/approvals
remain available under labelled disclosure until their records have been migrated. Counts must
describe the actual collection, not a sum of overlapping backlog checks.

Cash flow distinguishes actual balances, forecasts, and unconfirmed patterns; groups income,
bills/subscriptions, and reimbursements. Wealth uses ownership-qualified snapshot values and
real goals, never inventing performance history. Accounts exposes source freshness, ownership,
planning inclusion, duplicates, and corrective controls alongside connect/import/manual entry.

Transactions retains canonical server pagination/sorting and adds useful search/filter controls
and deep links to exact evidence without client-side whole-ledger calculations.

Setup resumes the server-owned protocol, renders one question at a time, saves each answer with
the session version, shows the budget before approval, and exposes honest maintenance progress.
No agent or scheduled work is implied to run merely because access or preferences were saved.

## Boundaries

- Reuse existing React, React Query, router, domain/API contracts, and shadcn components.
- No provider credentials, financial mutations, or connections against a real user during QA.
- No money movement, bill payment, trading, or provider subscription cancellation.
- No new dependencies, migrations, or invented investment/forecast data.
- Finance owns modules; shell edits are limited to route labels, navigation count, and actions.
- One raised primary block per page; secondary material is a quiet sequence or table.
- Loading, empty, stale, error, pending, conflict, and unavailable values are explicit.
- Keep unrelated worktree changes intact.

## Acceptance journeys

1. A proposed complete budget appears in Plan, can be revised, and can be approved at its exact version.
2. An unavailable position stays unavailable and leads to the affected account's correction controls.
3. An Inbox answer applies through the same API as MCP and advances only after the response.
4. A person can start/resume financial setup without copying instructions into another app.
5. All seven destinations and legacy deep links work at desktop and narrow widths.

Historical performance charts and forecast scenarios may only render supported API evidence.
The interface must explain absent evidence instead of synthesizing a financial conclusion.
