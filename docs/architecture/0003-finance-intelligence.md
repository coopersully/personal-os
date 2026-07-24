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
for mutations. Provider connection, import, profile, and income-stream setup
remain human-only; the bounded recurring-payment and alert decisions exposed to
MCP are available to a scoped agent and always carry the normal audit context.

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

Provider transfer labels and matching amounts alone are insufficient to exclude
a record from spending. A transfer is excluded only after a supported account
movement is matched or confirmed. Unmatched candidates remain visible and enter
the review queue. Pending transactions remain distinct from posted spending.

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

Read tools expose the overview, ledger health, transactions, budgets, merchants,
review queue, wealth, and cash flow. Agents should inspect ledger health and
relevant transactions before offering financial guidance. Categorization uses a
proposal/apply pair; applying is still constrained by the service's adaptive
confidence policy. Merchant merges, names, review decisions, recurring status,
and alerts have explicit bounded mutation tools. Agents must not turn an
ambiguous result into a category, transfer, subscription, or permanent rule on
their own.

## Migration policy

`0016_finance_intelligence.sql` is the final, coherent Finance-intelligence
schema transition. It replaced the private branch-only 0016–0020 chain before
this PR was published and retains the required confidence and transfer-review
backfills. It is now immutable; every Finance schema correction is append-only
and follows the repository-wide [database migration policy](../engineering/database-migrations.md).

## Consequences

- Totals can be traced to source transactions and reconciliation state rather
  than a UI-only calculation.
- Users and agents can distinguish declared income from observed income.
- Future profile changes, uncertain patterns, and missing evidence remain
  explicit rather than silently changing historical explanations.
- New finance behavior must update the domain contract, typed client, and this
  decision when it changes a ledger or planning invariant.
