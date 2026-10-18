# Exact Spending transaction references

Spending can open a transaction view with a bounded `spending` URL descriptor. The descriptor
preserves the complete accounting query, date subset, canonical group and snapshot revision.
Absent descriptors use the ordinary ledger. Present invalid, duplicate, oversized or stale
descriptors show recovery to Spending and never become an unfiltered ledger request.

The consumer sends the validated descriptor and cursor to the dedicated read-only Spending
transaction endpoint. The server owns snapshot matching, group membership, allocations, owner
isolation and cursor validation. The filter grants no authority. Query identity includes the
entire descriptor and cursor; leaving the exact view restarts ordinary-ledger pagination.

The displayed Spending contribution and source count describe the entire selected filter.
Rows retain full native transaction amounts. Page-scoped contribution records describe only
that page; full native amounts must not be presented as a sum of selected Spending cost.
Ordinary filters and sorting are hidden in this view because the exact endpoint owns its scope.
An explicit View ledger action removes the descriptor; Open Spending recovers the source.

Bulk categorization still uses displayed transaction IDs and revisions. Its explicit reload
awaits the active exact query, including its reference and cursor. A stale-reference failure
keeps retry locked; it cannot report that old records were successfully reloaded. Successful
reload still clears selection and requires a fresh selection.

The consumer branch carries exact producer domain/client dependencies from the frozen Spending
contract. It does not implement the endpoint or claim server or browser acceptance. Focused parser,
page and bulk tests cover fail-closed recovery, pagination, totals, all-versus-none account scope
and failed/successful exact reload. Integrated server and live browser verification remain required.
