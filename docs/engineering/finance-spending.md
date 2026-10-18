# Spending contribution contract

`projectFinanceSpending` in `apps/api/src/finance/spending-contributions.ts` is a pure API-owned
projection. Its schemas live in `packages/domain/src/finance/spending.ts`. The dashboard service and Spending views consume this projection without recomputing recognition.

The caller supplies an owner-scoped, complete recognition evidence snapshot, including identity
relationships outside the requested period. It must exclude deleted/tombstoned records at the
storage boundary. A transaction page cannot substitute for that snapshot. `coverage` is supplied
explicitly by the owning loader and is never inferred from record presence. Unknown or partial
source coverage stays unknown or partial; unresolved recognition downgrades complete coverage to
partial. A future date never represents confirmed zero. The owning loader must establish source
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

The v1 snapshot budget comparison remains explicitly unavailable (`historical_budget_not_resolved`).
The separate dashboard `monthlyBudget` field reads immutable human-qualified monthly baselines. It
never guesses historical approval or account scope. Production observation remains separate work.
The dashboard loader, route, typed client and views are described below.

## Dashboard loader and presentation

The dashboard adds `GET /v1/finances/spending`, backed by a read-only repeatable-read
snapshot of all authenticated-owner recognition evidence. It does not substitute transaction paging
for the ledger. Requested foreign accounts/categories fail closed. The URL adapter preserves all,
explicit no selection, and uncategorized selection; the typed client validates the response.
Provider-removed posted records are deleted by the existing sync owner; removed pending records
bearing the canonical self-reference marker are excluded before recognition. Relationships outside
the selected dates remain available to resolve posted replacement identities.

`buildFinanceSpendingDashboard` groups canonical contributions into current taxonomy buckets or
categories, retaining exact contribution/allocation drill-down and separate positive area/negative
adjustments. Categories outside configured buckets appear in Other spending. Hiding uncategorized
spending discloses its excluded net amount. Unsupported currencies are disclosed by source-history
IDs for selected accounts and never converted or summed into USD.

Sync freshness and historical coverage are separate. Current sync is not proof of complete history;
the current source schema has no certified coverage interval. The dashboard therefore reports unknown
history, or partial history with unavailable/stale source evidence, even though it loads the complete
stored snapshot. It does not claim an empty stored day is confirmed zero.

Spending display contracts extend the existing revisioned workspace preference API, preserving
omitted fields and conflicts. URL overrides do not silently rewrite defaults. View/grouping, pending,
uncategorized, basis, refunds, and period kind have separate fields; custom calendar dates are not
saved as a stale opening period. Durable persistence of these new fields requires the separately
owned additive Finance settings storage migration and readback verification; domain defaults and
UI hooks alone do not establish saved state.

Monthly fills require the separate immutable qualification record described below. The original
budget tables alone do not establish budget account scope or currency; debt targets, opaque resource
IDs, selected display accounts, and all current accounts cannot substitute for explicit qualification.
Full transaction-view integration and production/UI acceptance remain separate open gates.

Trends and Rhythm consume the same dated snapshots. Current named-period comparisons cap the
current period to elapsed local dates and compare the equivalent elapsed previous period, labeling
shorter-month caps. Complete named months compare complete prior months; custom ranges use the
preceding equal-length local-date interval. Daily/weekly/monthly bars and the accessible table
share exact contribution references. Rhythm distinguishes observed positive and net-refund amounts,
unknown/partial coverage, future dates and confirmed zero; it uses the person's saved week start.

Exact transaction navigation uses a bounded `FinanceSpendingReferenceFilter`: the complete query,
a canonical reference revision, optional group identity, and a contained date interval. It never
serializes thousands of source IDs into the URL. The read-only POST
`/v1/finances/spending/transactions` requires `finances:read`, recomputes owner-scoped references,
and rejects stale revisions, mismatched groups and cursors from another filter. It returns full
canonical transaction records plus page-specific contribution portions; the selected spending total
and transaction count summarize the entire exact filter. Native transaction amounts retain their
original meaning and may differ from selected split/personal-cost portions. Canonical row timestamps
and account identities must still match the snapshot or the read fails with a conflict rather than
silently mixing changed records. This endpoint performs no financial mutation or approval.


## Qualified monthly budget usage

For a selection contained in one calendar month, the composition root supplies the budget authority's
owner-scoped qualification reader. The adapter uses its immutable target cents, explicit account
selection, currency, complete calendar month, and timezone. Monthly use is computed from the same
canonical recognition projection over that whole account/month scope, independently of the selected
bubble dates or accounts. Labels disclose the monthly scope, unknown or partial observed coverage,
accounting choices, and later retrospective confirmation. Unresolved historical category identity,
unsupported currency, unavailable accounts, or unresolved recognition withholds comparison. Multi-month
selections do not display fills.

Bubble area continues to represent selected-period spending. Translucent fill uses the inverse
circular-segment area for monthly utilization; negative use clamps to zero and overspend fills the
circle with explicit overspend text. List rows expose precise monthly target/use and utilization.

When the authority reports that qualification is required, a contextual human review flow requires
explicit budget version, accounts, and USD selection. Prepare returns the exact review and fingerprint;
confirmation sends only that evidence and a stable idempotency key. Changing scope or account session
invalidates the preview. This action qualifies historical comparison; it does not infer an original
approval or complete onboarding.


## Group visual identity

The dashboard carries validated assigned category colors and semantic category, bucket, or
uncategorized icon identities. Bubbles use the shared icon registry and neutral foreground text over
a translucent tint. Unassigned categories and buckets use a stable identity-based palette fallback.
The current bucket schema has no persisted color or icon fields; the fallback does not claim user
assignment or persisted bucket color support. Visual metadata does not change contribution totals or
exact transaction references.


Qualified budget categories remain in List when the selected period has no activity, with exact
zero selected-period amounts and empty source references. Monthly usage still covers the qualified
whole month and accounts. Explicit category exclusions remain respected; unavailable qualification
does not add unrelated empty rows. Zero-area groups do not create bubbles.

Fill clip-path transitions use 300 ms and reduced motion uses zero duration. The Spending response
contract can represent an explicit zero target separately from an absent target; defensive rendering
shows positive usage as overspent without an infinite percentage and zero usage as no utilization.
The currently integrated budget qualification authority still rejects zero allocations. Supporting
explicit zero qualification remains an authority-owned contract dependency; consumer handling alone
does not establish that producer capability.
