# Spending contribution contract

`projectFinanceSpending` in `apps/api/src/finance/spending-contributions.ts` is a pure API-owned
projection. Its schemas live in `packages/domain/src/finance/spending.ts`. It is groundwork for
Spending, Trends and Rhythm; this module does not expose a live aggregate endpoint or render a view.

The caller supplies an owner-scoped, complete recognition evidence snapshot, including identity
relationships outside the requested period. It must exclude deleted/tombstoned records at the
storage boundary. A transaction page cannot substitute for that snapshot. `coverage` is supplied
explicitly by the owning loader and is never inferred from record presence. Unknown or partial
source coverage stays unknown or partial; unresolved recognition downgrades complete coverage to
partial. A future date never represents confirmed zero. An eventual loader must establish source
coverage and freshness before claiming completeness.

The existing recognition pass resolves pending replacement, trusted duplicate/split/transfer/refund
relationships and reimbursement matches once over that snapshot. Spending then applies period,
account, category, pending and refund filters. `null` account/category selection means all; an empty
array means none. A null category identifies uncategorized spending. Typed drill-down scopes retain
all filters and exact contribution/transaction references. Allocation IDs and category IDs are
canonical references, not category display labels.

Date-only transactions already represent local calendar days. Timestamp evidence is converted to
the requested IANA timezone. Daily bins advance by calendar date, including DST transitions, and the
current local day is provisional. The bounded query supports up to 3,660 calendar days. No time-of-day
precision is implied for date-only records.

Only supported USD activity with known ownership and a recorded ownership share contributes to
precise totals. Invalidated or non-reconciling splits are withheld with qualifications rather than
silently reassigned. Unknown ownership/currency remains inspectable through qualification source IDs.
Transfers and unclassified income do not become ordinary spending.

Personal cost deducts recorded expected reimbursements; canceled claims deduct only amounts already
received. Matched reimbursement credits are not subtracted again as refunds. Full outflow preserves
the purchase outflow without the reimbursement deduction. This projection does not change existing
position/cash-exposure recognition, which continues to use received reimbursement and gross pending
exposure. Contribution records retain reimbursement IDs and outstanding amounts, so expected recovery
can be distinguished from received cash. Refunds require canonical relationship evidence.

All outputs use exact integer cents. Ownership is rounded once per transaction total, distributed
across stable allocation-ID order using largest remainders. Personal amounts and outstanding recovery
are constrained by each allocation's owned gross capacity; ties are deterministic and input order
does not affect results. Filters run after residual assignment, so category drill-down cannot reround
a transaction differently. Qualification means the recognized amount is not a complete total.

The snapshot headline is net spending. `positiveAreaCents` sums positive category nets and
`negativeAdjustmentCents` explains the negative category amounts that reconcile area to the headline.
Daily-bin area instead represents the positive daily net; negative-net days retain an explicit
negative adjustment. Consumers that regroup categories into buckets must recompute area from bucket
nets while preserving the same contributions. No negative bubble area is implied.

Historical monthly budget comparison is explicitly unavailable (`historical_budget_not_resolved`).
This slice does not guess historical approvals, budget account scope, carry-forward limits or fills.
The future budget adapter, complete authenticated loader, route, typed client, accessible views,
and production observation remain separate delivery work.
