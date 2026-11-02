# Finance position evidence producer

The lane-owned API producer in `apps/api/src/finance/position-service.ts` reads one tenant-owned,
repeatable-read, read-only database snapshot and validates its result with F0b's
`financePositionEvidenceSchema`. The authenticated `/v1/finances/position` route, typed client and
Finance workflow manifest register the bounded `readPosition` port. Existing legacy Cashflow,
Wealth, and budget responses have not been switched to this producer.

Finance maintenance is the first internal workflow consumer. A window run reads that exact date
window. An all-outstanding run reads the exact calendar month named by the run's current Finance
status. Target scopes remain unsupported because a transaction, account or other target cannot be
silently widened into a tenant-wide financial position. Unsupported targets settle blocked without
calling the producer.

The maintenance projection step persists a safe checkpoint containing only the producer revision,
exact account/date scope, and each fact's quality and public reason codes. It does not persist
amounts, observation time, source references, provider detail or merchant text. Before verification,
maintenance rereads the checkpoint's exact scope and requires the same canonical revision and scope;
changed or newly unavailable evidence blocks the run. Verification then carries the durable
checkpoint, and a newly published immutable period review embeds that same identity.
Older stored reviews remain readable without the field. Maintenance settles blocked when any
required position fact is unavailable, so it cannot claim the period is maintained from partial
position evidence. A requested retry supersedes that blocked run with a fresh run, preserving the
blocked evidence record while allowing the canonical reader to observe recovered facts. Direct
replays still validate the durable checkpoint before challenge or verification work. Historical
placeholder projection records fail closed as missing canonical evidence, then a requested retry
preserves that run and starts a fresh canonical read. Immutable period reviews derive their period
from the validated checkpoint scope rather than the publication date. An
all-outstanding review also fails closed when current Finance status has advanced to a different
month, preventing an older period label from carrying newer status figures.

## Scope and evidence identity

The caller supplies posting-date bounds and an optional account selection. Dates are inclusive,
ordered ISO dates. Omitted account IDs select all tenant accounts only when there are at most 100;
explicit empty IDs select none. An explicit selection preserves all requested IDs, rejects another
tenant's or deleted account, and never silently truncates. Excluded planning accounts remain in the
requested scope but contribute no amount. More than 100 IDs, or omitted-all with more than 100
accounts, returns an input error requiring a bounded selection.

The producer keeps off-period transaction evidence available to resolve related transfer legs and
pending replacements, while aggregating postings only within the requested period. All dates are
posting dates; service-period attribution requires separate confirmed allocation evidence.

Account source references hash their balance, ownership, currency, inclusion, update revision,
provider Item update revision, sync cutoff, and public freshness reasons. The tenant snapshot's
activity reference hashes the selected account references, ordered transaction projections,
allocations, relationships, reimbursements, matches, and scope. No credentials, provider messages,
rationale, or merchant text are included in the source references. The position revision hashes the
ordered scope and validated facts, including the coverage records and owner-local coverage horizon.
Advancing observation time does not change the revision unless it changes freshness, admitted
coverage, or the observed local date.
Persisted reviews must retain their original evidence identity; rereading the current producer does
not reproduce historical bank or correction state.

Account balance facts retain up to 100 individual account references. Spendable uses one aggregate
tenant-snapshot reference whose revision hashes all four validated dependencies, including every
underlying reference. This preserves the shared MoneyFact cap without discarding a dependency or
truncating the requested account scope. The reference identifies this producer's tenant snapshot,
not a financial permission or bearer capability.

## Qualified facts

Cash, investments, other assets and debt derive from the same account snapshot; debt is represented
as a positive liability and subtracted once from net worth. Unknown ownership keeps a reported
amount qualified, rather than labeling it verified owned wealth. Missing balances or unsupported
currency leave the affected balance fact unavailable. A stale or failed source qualifies the
related fact while unaffected account kinds remain independently useful.

Posted spend and pending exposure use the canonical recognition oracle. Detailed internal
qualifications map to F0b's stable codes: unresolved allocation, unresolved reimbursement,
incomplete evidence, and unsupported account type. Expected repayments do not reduce posted spend
or pending exposure. A pending relationship credit is not a received reimbursement.

Observed transactions do not establish complete period history. Posted spend and pending exposure
retain their observed cents but carry `incomplete_evidence` until explicit coverage spans every
selected planning account and date, including accounts with no observed transactions. Coverage
must match the owner, account, currency and planning timezone, retain a nonempty evidence reference,
and have been recorded by the snapshot time. Adjacent intervals may jointly cover the period;
an interior gap remains incomplete. The observed horizon ends at the earlier of the requested end
and today's date in the owner's planning timezone, so future days are not claimed as observed
history. Recognition uses that same observed posting window while retaining the full transaction
set for transfer and pending-replacement evidence. This qualification does not degrade an
independently verified cash balance or grant
financial authority. Coverage changes participate in the position revision and invalidate an older
position-dependent decision.

Commitment and protection completeness are not established by an empty recurring-obligation list,
a stated reserve target, or a missing record. The persistence producer therefore returns
`missing_commitments` and `missing_protection_policy` with null cents, and keeps spendable null.
The calculation adapter can consume verified upstream reservation facts only when each has source
references; overlapping commitment/protection references block spendable with `incomplete_evidence`
instead of subtracting the same reservation twice. Stale, unavailable or qualified funding also
keeps spendable unavailable. This evidence does not grant execution authority.


## Agent Cash flow window reads

The existing `get_finance_cashflow` MCP read accepts an optional explicit `window` using the canonical Cash flow projection query: `from`, `to`, optional `accountIds`, and nullable `selectedIncomeStreamId`. The date window is one through 366 calendar dates; account scope is at most 100 IDs. Omitted scope and an explicit empty account list remain distinct. Calling with `{}` retains the existing legacy alerts, forecast, income and obligations response and performs no additional canonical reads. Those legacy fields retain their existing owner-wide scope even when a separate qualified window is requested.

An explicit window adds `qualifiedCashflow`, the canonical occurrence/match view and qualified payday projection. Unavailable reasons remain unavailable, including missing balance statements or schedule evidence. Legacy forecast values never substitute for an unavailable qualified projection.

`rawCashflowContext` carries separate current schedules, balance bases, dated source snapshots and balance-statement source snapshots. Schedules are restricted to the explicit account set when provided. Balance-statement source evidence covers capped all-known account history, not just the requested date window; preserve its `complete`/`truncated` coverage and server transaction limit. Other source caps and unavailable responses remain canonical. These independent reads do not claim to form one atomic projection snapshot, and raw context does not establish confirmation or qualified arithmetic.

All calls retain the current owner's `finances:read` authority. This intent introduces no new mutation grant or confirmation tool. Explicit schedule statements, occurrence matching/reversal and balance-basis confirmation remain authenticated-human consent boundaries in the canonical services, as do recurring-cost and saved-goal progress confirmations. The occurrence-list API is represented by the exact `qualifiedCashflow.schedule` result rather than a second MCP intent.

## Private category room in canonical budget status

`createProfileBudgetService.getFinanceBudgetStatus`, served by the existing Finance budget-status
read, consumes the private `readFinanceBudgetRoom` reader and `projectFinanceBudgetRoom` calculation.
The existing approved-plan data and observed Spending presentation remain unchanged. Room context
uses the existing communication details and evidence disclosures; it adds no public DTO, route,
notification sender, financial operation or authority.

The status transaction supplies its authenticated owner, exact current approved plan/version and
one observation instant. Baseline qualification, personal-cost Spending, position and canonical
cashflow readers accept that caller-owned transaction rather than opening independent snapshots.
The reader validates persisted budget ownership and version before projection. Its private scoped
ledger reader seeds the qualified accounts and observed local posting days, then follows complete
recognition dependencies: economic-event relationship history and supersession, pending/posted
provider identities, reconciled transfer groups, allocations, reimbursements and matched credits.
Relevant peers remain included across account and period boundaries. Every query and closure set
uses the unchanged 1,000-row per-source ceiling plus one overflow row; overflow, malformed or
missing required owned evidence withholds the new room context. No truncated graph is admitted as
complete. Unrelated lifetime transaction history does not by itself suppress a small observed scope.
Non-ledger metadata still uses its existing bounded complete-owner reads; this change does not
remove those separate limits.

Spending and Position consume that graph only through private caller-transaction inputs bound to
the exact owner, period and account set. Their private source revisions include the closed rows,
including native revisions and relevant external edges, while standalone reader contracts remain
unchanged. Cashflow uses the same bounded graph mechanism for recognition, but retains all known
selected-funding-account history for opening-balance reflection checks. Historical funding overflow
therefore keeps payday evidence unavailable instead of dropping unreviewed actuals. Closure
completeness certifies only that these dependencies were read, not statement coverage, trustworthy
financial facts, obligation completeness or authority. Spending covers the
qualified budget accounts from the month's first day through the owner's current local date;
future dates are not observed usage. Cashflow funding uses the owned cash-account subset, not debt
or excluded accounts. A payday income identity must be explicitly attached to all income resources
in the approved plan and unambiguous; deposits and legacy forecasts never substitute for it.

Each category's current approved allocation is compared with canonical recognized contributions,
not a displayed bucket total or an older immutable comparison target. Known observed amounts remain
visible when history is incomplete, clearly labeled as observed budget remainder rather than usable
cash. Missing current scope, coverage, freshness, recognition, producer revisions, commitments,
protected floor or payday evidence withholds usable room. In particular, the current persistence
position producer's missing commitment/protection facts remain unknown; an empty list cannot make
them verified zero. This source change does not supply those missing confirmations.

When compatible upstream funding and reservation facts are actually verified, the calculation caps
an **estimated** category amount by both the remaining category allocation and qualified cash after
reservations, and by the canonical before-payday protected-floor margin. These are intersecting
constraints, not repeated subtraction of the same bill. Future cashflow never becomes verified room
or spending permission. Category estimates share funding and cannot be added together; negative
shortfalls stay negative. Unknown income and unconfirmed bills remain explicit.

The private snapshot retains the actual budget/version, qualification ID/revision, Spending and
position revisions, and canonical payday evidence. Its derived revision binds the owner, exact
scope, observation, qualifications and producer values. It is a read identity, not a bearer token,
a financial approval or proof of deployment. The read creates no review, mutation, SMS, schedule or
provider operation. Runtime and personalized-attention acceptance remain separate.
