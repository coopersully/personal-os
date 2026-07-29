# ADR 0003: Finance intelligence and trustworthy totals

- Status: Accepted
- Date: 2026-07-21

## Context

Finance data comes from providers, manual entry, and user review. A provider's
category or transfer label can be incomplete or wrong; a transaction can be
pending, duplicated, or represent movement between accounts rather than a new
purchase. The product also needs to surface pay, subscriptions, bills, and
cash-flow guidance without an agent silently changing a user's financial record.

## Decision

The Finance vertical slice owns its data model, API route module, typed client,
MCP tools, and web feature module. The API service is the only place that
persists finance policy; the web application and MCP server call its typed HTTP
surface and do not reimplement categorization, reconciliation, or forecasting.

The canonical domain contract is `packages/domain/src/finance.ts`. The feature
seams are:

- `apps/api/src/routes/finances.ts` for authenticated HTTP endpoints;
- `apps/api/src/finance-service.ts` and `finance-cashflow.ts` for persistence,
  reconciliation, inference, and pure cash-flow calculations;
- `packages/api-client/src/features/finances.ts` for the shared typed client;
- `apps/mcp/src/tools/finances.ts` for agent-facing descriptions and input
  validation; and
- `apps/web/src/features/finances` for the user interface.

All finance endpoints require `finances:read` for reads and `finances:write`
for mutations. Provider connection, import, account, budget, financial-profile,
and income-stream administration remain human-only. Permanent merchant rules
and ambiguous-transfer confirmation also require an interactive human session.
Finance MCP is proposal/read-only for ledger and review work: categorization
application, recurring and alert state, merchant changes, manual transactions,
and review resolution all require a signed-in Ilo user at the API route. A
scoped agent may create or refresh shared attention for one owned transaction
through the Finance-owned endpoint. That endpoint locks the transaction,
derives its material source from the account and current transaction revision,
deduplicates the open transaction/kind pair, and audits atomically; generic
attention cannot supply Finance provenance.

Finance guided setup reuses the shared versioned domain-profile envelope. The
agent-editable object is the durable Finance domain profile saved through
`save_domain_profile("finances")`; it is distinct from the human-managed
financial profile. Its `sourceContexts` are canonical Finance account IDs, not
arbitrary labels, and the API rejects duplicates, stale accounts, and accounts
owned by another user. They are interpretation guidance, not account-level
authorization; token scopes determine access. Source-empty Finance domain
profiles may remain drafts. An agent may save a draft, but activation requires
a signed-in user, an exact profile version, and at least one owned account
source. Guided setup exposes active guidance separately from an unapproved
draft proposal; draft text is untrusted and non-operative until signed-in
activation. A durable approval snapshot preserves the last signed-in approved
version when an agent later saves a revised draft, so pending text cannot erase
or masquerade as operative guidance. Finance preference keys use explicit units: confidence is a 0–1
fraction, scalar currency thresholds require the current USD planning
currency, and `recurringAmountChangePercent` is percentage points (`20` means
20%). These preferences do not schedule reviews or reconfigure alert
generation.

## Ledger and learning model

`finance_transactions` retains the original transaction alongside normalized
merchant, category, provider evidence, pending state, and reconciliation state.
Canonical merchants hold a readable display name plus raw aliases. Categories,
classification decisions, and review cases are separate records so the system
can explain how a result was reached and learn only from an explicit outcome.

An automated proposal is not a durable rule. The system starts with a high
confidence threshold, records the rationale and confidence for every decision,
and only broadens a merchant rule when the user explicitly chooses that intent
or confirms consistent results. Ambiguous merchants, low confidence, possible
duplicates, transfers, reversals, and one-off behavior remain reviewable.

Every categorization proposal includes the transaction's `updatedAt` revision.
Apply requires that exact revision and performs the transaction update,
classification evidence, review resolution, optional human-approved merchant
rule, and audit insert in one database transaction. A batch can succeed for
some decisions and fail for others, but a single decision never reports failure
after committing only part of itself. The defensive agent-attributed service
path also recomputes the current server proposal and rejects substituted
categories or confidence. Proposal
revalidation runs after locking the transaction and the user's categorization
policy rows; every merchant-rule and classification-evidence writer takes the
same policy lock. A concurrent policy change therefore commits before
revalidation or waits until the accepted decision is durable. Work is bounded
to four concurrent decisions so a large batch does not exhaust the database
pool. A below-threshold decision records its review case, evidence, and a
minimal deferred audit event in the same transaction. Finance audit metadata
omits transaction amounts, merchants, notes, and rationales so an `audit:read`
grant does not imply `finances:read`. Transfer confirmation uses the same
transactional path.

The pre-existing synchronous batch endpoint still has no durable batch entity:
process loss or request abandonment can occur between individually committed
decisions. This PR does not widen that risk—the route is now human-only,
workers are bounded, and each returned decision is atomic—but durable
lost-response recovery remains a bounded follow-up. Only exact per-decision
replays are idempotent today; the synchronous batch itself is not advertised as
idempotent or exposed through MCP. Durable batch work should add a client
idempotency key, a `finance_categorization_batches` record, per-decision terminal
state, an endpoint to query or resume unfinished work, and abort-aware scheduling
with a process-loss integration test.

The defensive service path for an agent-attributed category review requires the
accepted proposal confidence and transaction `updatedAt`, then applies the same
proposal, policy, and stale-revision checks as batch categorization. Public
agent routes do not expose review resolution. Interactive users may resolve a
current review directly, but must submit its displayed transaction revision;
the apply transaction locks the open review so concurrent signed-in decisions
cannot both commit. Ambiguous transfer confirmation remains human-only.

An exact retry of an unchanged below-threshold decision reuses the existing
open review and deferred evidence. The result reports `replayed: true` and does
not update timestamps or append classification/audit rows; a changed revision,
category, confidence, source, or rationale is not treated as that replay.
Structured per-item API errors include the request ID so unexpected
infrastructure failures remain correlatable without exposing internal details.

Provider transfer labels and matching amounts alone are insufficient to exclude
a record from spending. A transfer is excluded only after a supported account
movement is matched or confirmed. Unmatched candidates remain visible and enter
the review queue. Plaid's signed source direction is retained separately while
a transaction is a candidate, allowing recategorization to restore income
versus expense correctly; leaving candidate state clears any transfer group.
Pending transactions remain distinct from posted spending.
They may be organized provisionally, but cannot create classification evidence
or permanent merchant learning before posting.

## Income, recurring activity, and cash flow

Profiles are effective-dated. Reads select the latest profile whose effective
date is not later than the calculation date, so future job or pay changes never
rewrite historical planning.

Wealth returns three separate income concepts:

- `statedAnnualIncome`: the effective profile's declared gross annual income;
- `observedAnnualIncome`: trailing-twelve-month posted income, excluding
  transfers; and
- `annualIncome` with `incomeBasis`: the planning baseline, preferring stated
  income when present and otherwise observed income.

Income streams and recurring obligations retain cadence, expected amount,
tolerance, confidence, source, status, and next expected date. Automatic
discovery requires repeated regular history; uncertain patterns begin in review.
The refresh pass creates price/change/missing alerts from evidence and resolves
previous missing alerts once their active schedule is no longer overdue.

Forecasts simulate dated cash-flow events in chronological order. On the same
date, obligations are reserved before income is assumed to clear. The forecast
reports the minimum projected balance and date, and `safeToSpend` is never below
zero. A forecast is guidance, not a bank balance or a guarantee.

## Budget pace and presentation

Budget totals include posted expense activity only after the ledger rules above
have classified a record as spending. They exclude confirmed internal transfers
and matched debt payments, while unresolved candidates remain visible for
review. Planned, spent, and remaining values therefore use the same ledger
selection rules across overview, budget, export, and MCP surfaces.

The budget-pace endpoint returns every cell in the selected calendar period and
an `asOf` day. A `blank` cell deliberately represents future, missing,
unbudgeted, or no-activity time; the UI renders all of those with the same
muted rounded square so the graph remains structurally complete without
inventing financial activity. `ahead` and `behind` use restrained success and
destructive colors, while neutral activity is muted.

## MCP tool policy

Read tools expose guided-setup readiness, the durable shared profile, overview,
ledger health, transactions, budgets, merchants, review queue, wealth, and cash
flow. Agents should inspect guided context, ledger health, and relevant
transactions before offering financial guidance. Categorization exposes only a
read-scoped proposal tool; a signed-in person applies the current decision in
Finance. Proposal pages use the ledger's opaque cursor and read paths never
materialize merchant/category enrichment. Direct category edits, merchant
changes, review decisions, recurring state, alerts, and manual transactions are
absent from MCP and guarded as human-only API routes. Agents must not turn an
ambiguous result into a category, transfer, subscription, or permanent rule on
their own.

Every account-onboarding path, including Plaid exchange, provisions the stable
default category taxonomy inside the account transaction. Category reads remain
side-effect free for a new Plaid-only user. During an upgrade, missing defaults
are exposed with stable per-user IDs, and the first mutation that uses one
materializes it before persistence.

MCP annotations describe expected host UX only. All Finance read tools declare
the four risk hints, while the API's scopes, human-session guards, adaptive
policy, revision checks, transactions, and audit trail remain the security and
integrity boundary. The Finance attention mutation declares all four hints with
`readOnlyHint: false`; these hints do not replace the API's ownership checks.
The shared result helper preserves structured API errors
and structured content. Output schemas and an internal access-token exchange
remain shared MCP transport follow-ups rather than Finance-local contracts.
An account referenced by the durable Finance profile cannot be deleted until
the human removes that source context. Profile saves and account deletion lock
the account before the profile so a concurrent save/delete cannot create a
dangling JSON source reference.

## Migration policy

`0016_finance_intelligence.sql` is the final, coherent Finance-intelligence
schema transition. It replaced the private branch-only 0016–0020 chain before
this PR was published and retains the required confidence and transfer-review
backfills. It is now immutable; every Finance schema correction is append-only
and follows the repository-wide [database migration policy](../engineering/database-migrations.md).
The approval, provider-direction, and setup-repair checkpoint migrations are
expand-only. A bounded, idempotent startup repair uses a durable keyset
checkpoint and database row claim so only one API instance scans each batch.
It demotes legacy active Finance domain profiles that lack signed approval and
seeds missing per-owner categories, reporting actual mutations and retrying on
the scheduler. After both keysets converge, each pass performs only the
constant-time checkpoint read. Until repair completes, shared and Finance
readers treat an unapproved active row as an untrusted draft and category reads
serve the stable taxonomy without writing.

## Consequences

- Totals can be traced to source transactions and reconciliation state rather
  than a UI-only calculation.
- Users and agents can distinguish declared income from observed income.
- Future profile changes, uncertain patterns, and missing evidence remain
  explicit rather than silently changing historical explanations.
- New finance behavior must update the domain contract, typed client, and this
  decision when it changes a ledger or planning invariant.
