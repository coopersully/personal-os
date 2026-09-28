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
ordered scope and validated facts; changing only the observation time does not change that revision.
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

Commitment and protection completeness are not established by an empty recurring-obligation list,
a stated reserve target, or a missing record. The persistence producer therefore returns
`missing_commitments` and `missing_protection_policy` with null cents, and keeps spendable null.
The calculation adapter can consume verified upstream reservation facts only when each has source
references; overlapping commitment/protection references block spendable with `incomplete_evidence`
instead of subtracting the same reservation twice. Stale, unavailable or qualified funding also
keeps spendable unavailable. This evidence does not grant execution authority.
