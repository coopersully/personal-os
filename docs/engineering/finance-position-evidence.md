# Finance position evidence producer

The lane-owned API producer in `apps/api/src/finance/position-service.ts` reads one tenant-owned,
repeatable-read, read-only database snapshot and validates its result with F0b's
`financePositionEvidenceSchema`. The module is an internal producer until the Integration owner
registers and verifies the authenticated `readPosition` port. Existing legacy Cashflow, Wealth,
and budget responses have not been switched to this producer.

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
allocations, relationships, reimbursements, matches, and scope. No credentials, provider messages, rationale, or merchant text
are included in the source references. The position revision hashes the ordered scope and validated
facts; changing only the observation time does not change that revision. Persisted reviews must
retain their original evidence packet; rereading the current producer does not reproduce historical
bank or correction state.

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
