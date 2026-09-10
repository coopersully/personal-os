# Finance reliability follow-ups

These findings came from a real maintenance workflow. They describe reusable product requirements;
personal account data and merchant judgments belong in the user's ledger, not in this document.

## Addressed in the outstanding-review workflow

- Canonical Inbox cases are selectable from the dashboard and Review, with dated account context.
- A user can leave a note or apply an exact category/relationship correction immediately.
- Notes survive refreshed findings and are included in maintenance responses outside the current batch.
- Exact merchant rules defer when a note awaits judgment. A settled run does not claim budget balance.
- Concurrent resolutions use a conditional write; an already resolved case cannot be resolved twice.

## Highest-priority remaining work

| Priority | Gap | Acceptance evidence |
| --- | --- | --- |
| P0 | Spendable cash can resemble all cash when obligations or earmarks are missing. | Return unavailable/qualified guidance with coverage and reasons until protected reserves, earmarks, obligations, and freshness are reconciled. Never silently count reserves as spending capacity. |
| P0 | Stated profile income, observed deposits, payroll deductions, and proposed/active budget state diverge across surfaces. | One provenance-aware contract exposes each meaning separately; only approved active allocations govern budget maintenance. |
| P1 | Audit input requires economic-event IDs while recent activity exposes transaction IDs. | Supply the eligible event IDs, their source transactions, scope, and pagination; invalid IDs produce a typed validation error, never a server error. |
| P1 | Payment date, service period, pending replacement, reimbursement, and account supersession need consistent economic treatment. | Transfers do not create income/spending; reimbursements offset the correct cost; pending replacements do not duplicate spending; service-period allocation and duplicate-account exclusion are explicit and reversible. |
| P1 | Missing receipt matches can hide stale or disconnected mail sources. | Search reports source coverage/freshness, bounded relevant excerpts, and reconnect paths alongside matches or no-match results. |
| P1 | Investment balances are insufficient evidence of contributions or ownership. | Structured employee deferrals, employer match, deliberate contributions, ownership shares, and family-seeded capital support separately qualified progress measures. |
| P1 | Classification and review lifecycle can diverge outside the answer endpoint. | A split is recognized as classified; relevant cases close atomically after a supported correction, while unrelated concerns remain open. |
| P2 | Generic spending alerts do not reflect a user's protected needs and goals. | Configurable priorities distinguish necessary/protected spending, discretionary pace, recurring-cost changes, and goal shortfalls; present actionable amounts and evidence without moralizing. |

Further hardening should cover note revisions versus concurrent agent judgments, bounded/paginated
Inbox payloads for large histories, and whole-workspace questions or approvals that currently live
in legacy surfaces. The current list intentionally counts canonical Inbox cases, not every overlapping
diagnostic or approval as a separate issue.

## Ahead-of-time notes and wallet reimbursements

This is a proposed extension, not shipped functionality. The existing reimbursement create contract
requires an active expense allocation and a known expected amount. It cannot represent an outing
before a charge exists, or a reimbursement whose amount is not yet known.

- Add a durable Finance note, available from the dashboard even with an empty Inbox. Accept freeform
  context before or after an event, with optional dates, participants, category, payment channel,
  expected amount and related transactions. Unknown values remain null; do not invent an expense.
- Separate note states (watching, needs clarification, matched, dismissed) from accounting entries.
  An expectation does not increase cash, reduce spending, or become a receivable automatically.
- Maintenance consumes outstanding notes with their revisions and source provenance. Candidate
  matches show evidence and uncertainty. A repeated pass must not duplicate cases or receipts.
  A manual edit wins over a judgment based on an older revision.
- A concise dashboard row should distinguish “Watching for repayment” from “Needs your answer”.
  Users can edit context, select several expenses/payments, assign partial amounts, or dismiss.
  Preserve the original note and applied decisions; do not learn a merchant-wide rule from one outing.
- Support category-known, expense-unallocated reimbursements without requiring a fictional single
  purchase link. Report gross spending, received reimbursements and unresolved allocation separately;
  unknown expense periods must not silently reduce the current period's spending.

## Venmo connection path

As researched on 2026-09-09, Venmo documents personal-account CSV statements in Settings → Statements
and on the website. PayPal's published API catalog describes Transaction Search for PayPal accounts
and Venmo payouts; it does not establish a personal Venmo history API. A live connector therefore
remains unverified. Start with the supported statement path, preserving a future connector boundary.

Sources: [Venmo transaction history](https://help.venmo.com/cs/articles/transaction-history-vhel281)
and [PayPal API catalog](https://developer.paypal.com/api/rest/current-resources/).

The existing `apps/api/src/finance-csv.ts` supports a Venmo provider identifier, but currently assumes
the first nonempty row is the header, uses a generic amount-sign direction rule, and selects From
before To regardless of direction. It does not explicitly model wallet cash-outs, fees, status or
balance reconciliation. Validate against an actual exported statement before importing live data.

Required integration behavior:

1. Maintain a separate Venmo wallet account. Individual incoming payments can be reimbursements;
   a cash-out to a bank is a transfer. Never count both as income or reimbursements.
2. Preview parsed rows, currency, signs, counterparties, payment notes, status and fees. Reject
   unsupported formats visibly. Preserve provider IDs and raw evidence; retry imports idempotently.
3. Reconcile wallet opening balance plus inflows minus outflows to closing balance. A cash-out may
   draw on earlier balances, so do not force its amount to equal a nearby group of payments.
4. Match the two cash-out legs independently from payment-to-expense reimbursement allocations.
   Handle many-to-many and partial matches, reversals, duplicates and any separately evidenced fee.
5. Display connection mode and statement coverage/freshness. Email receipts can supplement evidence
   but do not establish a complete wallet ledger. Require verified provider access before promising
   continuous sync.

Verification should include pre-event notes with unknown amounts, edits racing maintenance, multiple
payers and expenses, cash-outs spanning statement periods, repeated imports and tenant isolation.

An additional MCP inconsistency surfaced: `update_finance_transaction` advertises note correction to
agents, but production rejects it as requiring an interactive user session. The supported review
answer endpoint accepts clarification. Align tool discovery/documentation with actual actor policy;
provide an authorized annotation contract rather than making agents discover this through failures.
