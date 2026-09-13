# Finance workspace plan and parallel delivery charter

- Status: Working plan for discussion; agreed constraints are distinguished from proposed design.
- As of: 2026-09-13
- Current implementation branch: `cooper/finance-review-context`
- Delivery state and issue links: Linear; this document owns product and architecture decisions.

## Purpose and relationship to the product vision

Finance implements nohmi's promise of an autonomous exoskeleton for the person's money: understand
what changed, what is committed, what remains possible, and what needs a decision without requiring
routine visits to every provider. It must remain a useful direct financial application even when
no external agent is running. The objective is financial resilience and progress toward the
person's goals and quality-of-life priorities; maximizing net worth or minimizing spending alone
is not a sufficient objective.

Governing documents are [master design](master-design.md), [master plan, Epic 9](master-plan.md),
[Finance interfaces](workspaces.md#finances), [workspace stewardship](workspace-stewardship.md),
[Finance invariants](../architecture/0003-finance-intelligence.md),
[stewardship architecture](../architecture/0004-workspace-stewardship.md),
[User Knowledge](../architecture/0005-user-knowledge.md), and
[path ownership](../engineering/feature-ownership.md). This charter specializes them rather than
replacing their shared policy, scheduling, knowledge, Reviews, or Texting contracts.

## Agreed constraints

- Automatic bookkeeping is the default direction within granted authority and sufficient evidence.
  Budget changes are governed by explicit user-defined boundaries. This agreement does not activate
  any production rule, choose numerical limits, approve a budget, or authorize money movement.
- Users can inspect and correct the same records manually, leave context before or after an event,
  and answer concise, contextual questions. Corrections survive later maintenance.
- Financial facts, estimates, intentions, policy, and advice remain distinguishable and traceable.
- A Venmo-specific connection is worth building only if account connection enables automatic ongoing
  access to individual activity. No upload-based Venmo feature or CSV fallback is in this plan.
  Generic manual/import paths elsewhere in the master plan are not removed by this constraint.
- No money movement, trading, bill payment, tax filing, or professional credential claims.
- All behavior is multi-user with structural tenant isolation. One user's preferences are examples,
  never platform-wide rules. Joint ownership is not permission to disclose another user's data.

## Current slice and its limits

The branch implements a compact canonical Finance Inbox list with contextual case selection,
transaction date/account/direction/posting state, nearby activity, durable clarification notes,
manual category/link/dismiss actions, and notes included in maintenance responses. Exact merchant
rules defer to unresolved user notes, duplicate case resolution is guarded, and settlement no longer
claims that the budget is balanced. API, MCP, component and browser tests accompany it.

This is branch implementation, not deployed capability. The list covers canonical Finance cases,
not all legacy questions, approvals, recovery or shared Reviews. Notes still require an existing
case. It does not implement prospective expectations, complete User Knowledge, automatic Venmo
access, policy-bound budget reallocation, or the broader accounting fixes below.

The previous September 10 verification log records 199 passing test files, branch coverage 94.05%,
and 26 passing browser tests. That evidence predates the September 13 main merge and does not
establish verification of the current head. Every release still requires fresh `pnpm verify` and
the appropriate production evidence.

## Proposed domain model and responsibilities

| Concept | Canonical owner and meaning | Boundary |
| --- | --- | --- |
| Source activity | Finance provider projection with source ID, raw facts, revision, freshness and coverage | A provider label is evidence, not final economic meaning |
| Economic event and allocation | Finance ledger: purchase, transfer, refund, reimbursement, income, investment contribution | Recognize once across accounts, pending/posted replacements and imports |
| Operational context | Finance note or expectation linked to zero or more records, with dates and optional participants/amount | Unknown amount stays unknown; intent does not create cash or reduce spending |
| Personal knowledge | Shared typed User Knowledge with provenance, temporal validity, sensitivity and revisions | Finance requests purpose-bound context; it does not build a parallel global memory store |
| Action authority | Finance policy with explicit approved rules and immutable preview/activation versions | Knowledge, repetition, setup completion and global review bypass cannot activate rules |
| Plan | Versioned approved baseline, authorized revisions, proposals and forecasts | Reallocation never erases original targets or historical variance |
| Human-required work | Finance-owned cases projected to unified Reviews by stable identity | Workspace and central views resolve the same operation; no second queue of copies |
| Advice and period review | Finance-derived evidence-backed findings, decisions and review artifact | A completed run is not evidence of healthy finances |

Keep schemas and invariants in `packages/domain`, persistence in `packages/database`, behavior in
Finance API modules, provider adapters in `packages/connectors`, and typed calls in the API client.
Web and MCP consume these contracts. MCP does not calculate totals, assemble unrestricted context,
or decide completion. Use additive feature modules and narrow adapters rather than a wholesale
rewrite of `finance-service.ts`.

There are currently multiple maintenance surfaces: `/v1/finances/maintenance/protocol` and the
older prepare/challenge/settle path. ADR 0004 describes the latter while this branch changes the
former. Before new streams modify orchestration, the integration owner must trace live callers,
agree the canonical lifecycle and compatibility adapters, and test equivalent policy and terminal
truth. Do not delete or silently substitute one path from documentation alone.

### Contract handshake before parallel implementation

These are proposed payload responsibilities, not new published API names. Prefer extending an
existing typed contract when it already expresses the same meaning. Each consumer and owner must
agree the schema, error cases and revision behavior before either implements a competing shape.

| Contract | Producer → consumer | Minimum content |
| --- | --- | --- |
| Financial position evidence | B → A/C/review | Scope and cutoff, source coverage, currency, reconciliation status, gross/net components, available-versus-protected cash, ownership and unresolved exposure; unavailable values are explicit |
| Context candidate | A → B/maintenance | Note identity/revision, optional time window and expected amount, referenced owned records, user-authored evidence, expiry, candidate relationships and unmatched remainder |
| Accounting match decision | B → A | Input revisions, exact allocations and relationship, evidence/reason, amount/period consequences, applied/proposed/unresolved state and reversal reference |
| Budget decision | C → maintenance/review | Baseline and active plan revisions, policy/preview revision, proposed moves, cumulative limit usage, source-evidence revision, consequences, authorization result and rollback |
| Human-work projection | A/Finance → shared Reviews | Stable domain case identity, semantic revision, required action, consequence, safe context, authenticated deep link, lifecycle and exact resolution operation |
| Context pack | User Knowledge → Finance | Purpose/owner scope, immutable fact/preference/inference revisions, temporal validity, evidence and missing requirements; policy remains separately owned |

Every mutation carries an idempotency key bound to its payload, expected relevant revisions and
authenticated actor. Reads return bounded pages with coverage; a truncated result is not complete
evidence. Avoid one global revision that would make unrelated edits contend. Cross-currency totals
require explicit valuation evidence; never silently add unlike currencies. Migrate producers and
consumers additively with compatibility tests before removing old shapes.

## Bookkeeping, planning and authority

The proposed Finance policy evaluator takes the actor's scopes, active policy revision, plan
revision, evidence cutoff and a typed proposed operation. It returns applied, proposed-for-review,
needs-evidence, or denied with reasons; exact wire vocabulary will follow the existing contracts.

Budget policy must specify eligible source/destination categories, protected allocations, time
window, cumulative monetary/percentage limits, reserve floors, and treatment of irregular income.
Per-operation limits alone are insufficient: several small moves must not evade a period limit.
Evaluate competing edits against the same revision and enforce limits atomically. A correction or
reversal remains auditable. If no rule permits a budget change, propose it rather than infer consent.

Always preserve original plan, revised plan, actuals and forecast separately. Otherwise automatic
rebalancing can make persistent overspending disappear. Explain over- and under-plan behavior in
terms of obligations, goals and user priorities. Distinguish a mistaken charge, an unsustainable
pattern, and an intentional tradeoff; do not describe every discretionary purchase as harmful.

Ledger calculations must distinguish gross/net income, transfers, household reimbursements,
service period versus posting date, reserve earmarks, liabilities, owned versus reported assets,
employee contributions, employer contributions, investment returns and seeded capital. Show gross
spending, received reimbursements and unresolved allocations separately. Balance-only investment
feeds cannot prove contributions; expected reimbursement cannot fund safe-to-spend.

## Context, questions and learning

Capture a freeform heads-up even before an expense exists. Proposed states are watching,
needs clarification, matched, expired and dismissed; final lifecycle contracts require review.
Optional amounts, dates and participants must remain optional. Several payments can relate to
several expenses, with partial matches and explicit unmatched remainder.

Maintenance reads the note's exact revision and offers evidence-backed candidates. Manual edits
invalidate stale judgments. Saving context is not accounting recognition. A category-known but
expense-unallocated reimbursement is a valid intermediate condition, not a reason to invent a link.
An expectation should have a review/expiry policy so old notes cannot match unrelated future money.

Only work explicitly requiring the person enters unified Reviews. Watching and automatic recovery
stay visible in workspace status without creating repeated questions. Questions include enough
transaction and consequence context to answer directly; question priority reflects decision impact,
not just amount or number of uncertain rows. Resolution may propose reusable knowledge, separately
from any action-rule preview and approval.

Required context depends on purpose: bookkeeping needs source/account meaning and exact corrections;
budget advice additionally needs obligations, income stability, reserves, goals and approved policy.
Jurisdiction/risk/ownership facts are required only for advice that depends on them. Missing context
limits the claim rather than preventing unrelated useful work. Unrelated mail, calendar details,
other tenants' data and credentials must not enter a Finance context pack.

## Setup, maintenance and surfaces

Guided setup progressively establishes accounts and ownership, source coverage, income/obligations,
goals and protected priorities, proposed budget, authority boundaries, review preferences and
external scheduling handoff. Review and bookkeeping must work without a completed budget. No
large mandatory questionnaire should precede the first useful result.

The domain-owned maintenance loop establishes scope/cutoff, reads source health and bounded context,
reconciles, applies authorized corrections, evaluates budget changes, persists questions, updates
projections, publishes advice and verifies a period review. Runs retain source/knowledge/policy
revisions, durable checkpoints, idempotency, leases/fences and recovery. Compatible overlapping
invocations resume/coalesce; incompatible scopes stay separate without duplicated effects.

External hosts alone originate recurring maintenance. nohmi records declared schedule identity,
connection binding, expected cadence and observed health; internal retries only continue accepted
work. Provider synchronization follows its separate connector lifecycle. Do not create a second
Finance scheduling authority while adding automatic source access.

Finance owns its settings editor, source health, overview, ledger, plan, cash flow, wealth and
review inspection. Integration owns composition into Today and unified Reviews. Finance emits
typed notification intents; Texting/channel policy owns delivery, quiet hours, privacy, deduplication
and reply routing. Stale note revisions cannot be acted on through an old message.

## Maintained-state and acceptance contract

- Maintained: scoped source coverage and reconciliation meet declared requirements, derived totals
  use current revisions, policy-compliant actions are verified, and no material required work remains.
- Maintained with questions: supported work is complete but explicit uncertainties remain; affected
  totals/advice are qualified. A silent queue or zero new changes does not imply maintained.
- Blocked: missing authority/evidence/provider capability prevents a required outcome; identify the
  repair owner and allow independent supported work to continue.
- Failed: an operation failed with durable recovery state; preserve verified earlier successes.

Every period review records scope/cutoff and freshness, completed changes, plan versus actuals,
cash/wealth assumptions, unresolved exposure, recommendations/tradeoffs, knowledge/rule proposals,
and recovery or next check-in links. Expert playbooks are versioned server-owned data; bookkeeping,
planning, investment analysis and coaching claims need primary-source research and applicability
dates before implementation. This charter supplies no unresearched numerical financial advice.

Acceptance spans tenant isolation, balance/event invariants, partial reimbursements, pending/posting
replacement, unknown ownership, stale sources, repeated imports, concurrent note edits, cumulative
budget limits, retries after partial completion, cross-host overlap, manual/agent parity, and
responsive accessible review flows. Measure unresolved financial exposure, reconciliation coverage,
repeat-question rate, correction reversals, maintenance latency and user effort—not classification
percentage or amount saved alone.

## Proposed parallel delivery map

These are workstream boundaries, not authorization to implement all proposed details immediately.

- [COO-45 — Consolidated plan and contract decisions](https://linear.app/coopersully/issue/COO-45/consolidate-the-finance-stewardship-plan-and-parallel-contracts)
- [COO-46 — Deliver contextual Finance reviews and durable maintenance notes](https://linear.app/coopersully/issue/COO-46/deliver-contextual-finance-reviews-and-durable-maintenance-notes)
- [COO-47 — Capture prospective Finance context and reimbursement expectations](https://linear.app/coopersully/issue/COO-47/capture-prospective-finance-context-and-reimbursement-expectations)
- [COO-48 — Make Finance position and reimbursement totals evidence-qualified](https://linear.app/coopersully/issue/COO-48/make-finance-position-and-reimbursement-totals-evidence-qualified)
- [COO-49 — Govern automatic budget revisions with explicit user boundaries](https://linear.app/coopersully/issue/COO-49/govern-automatic-budget-revisions-with-explicit-user-boundaries)
- [COO-50 — Determine whether automatic personal Venmo activity access is viable](https://linear.app/coopersully/issue/COO-50/determine-whether-automatic-personal-venmo-activity-access-is-viable)

| Lane | Outcome and owned paths | Dependencies and exclusions |
| --- | --- | --- |
| A — Context and reviews (this chat) | Existing `finance/inbox-service*`, Finance `inbox-list*`/`review-page*`, domain `finance/inbox.ts`; new Finance context/expectation modules after contract agreement | Preserve current branch; consume ledger matching and shared knowledge interfaces; do not own the global knowledge store, budget calculations or provider sync |
| B — Ledger and financial position | Finance economic-event, reconciliation, cashflow and wealth calculators/tests; proposed narrow position/evidence contract | Own recognition and cents/period/ownership semantics; supply qualified totals to A/C; do not own review UI or policy editor |
| C — Budget policy and planning | Finance budget/policy modules, plan UI and policy tests | Design and pure rules can proceed alongside B; applying changes depends on B's qualified position and agreed plan/policy revisions |
| D — Automatic source feasibility | Read-only Venmo capability investigation and boundary record; connector modules only after supported access is demonstrated | No uploads, scraping or invented API; no dependency for A/B/C; account consent and production-equivalent read proof are release gates |
| Integration coordination (this chat initially) | Charter, interface agreements, maintenance compatibility decision, shared adapters and composition-root handoffs | Coordinate with User Knowledge/Reviews/Texting owners; merge small contract changes before dependent feature branches |

Do not give several chats simultaneous ownership of `finance-service.ts`, `routes/finances.ts`,
`packages/domain/src/finance.ts`, `packages/api-client/src/features/finances.ts`, or
`apps/mcp/src/tools/finances.ts`. Agree additions through one integration owner. Database schema and
migration journal changes use a single sequencing owner; published migrations remain append-only.

Start with charter and shared interface decisions; land the existing review slice independently.
Then A context capture, B ledger work and C policy design can proceed concurrently using explicit
contracts. C's production application and A's automatic matching wait for the required B evidence.
D remains a bounded research lane until it proves worthwhile. Each future chat gets one issue,
owned/non-owned paths, a baseline commit, dependency links, acceptance evidence and a handoff owner;
each uses an isolated worktree. Do not copy this entire branch into every stream by default.

## Decisions still to make together

1. Budget policy presets and granularity: what can move, what stays protected, and cumulative limits.
2. Time model: calendar month, paycheck cycle, rollover and service-period views; maintain one ledger
   while supporting distinct explainable views.
3. When uncertainty warrants interruption versus a qualified estimate; choose impact-based defaults.
4. Expiry and follow-up for expected reimbursements, including uncertain amount or event date.
5. Investment/wealth scope for the first release and evidence needed for each claim.
6. Whether occasional provider-required reauthentication is acceptable for an automatic Venmo feed.

The agreed bookkeeping/authority principle is settled. These choices remain open and must not be
silently converted into enabled rules, implementation commitments or user-specific production data.
