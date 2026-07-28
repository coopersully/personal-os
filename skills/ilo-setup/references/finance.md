# Finance setup

Finance setup records durable context for informational guidance and reviewed organization. It
never grants authority to connect providers, import data, change the human-managed financial
profile or budgets, move money, trade, pay bills, create permanent merchant rules, or silently
confirm ambiguous transfers.

## Inspect before interviewing

1. Call `get_finance_guided_setup`. It returns the shared Finance domain profile, account-source
   context, ledger health, human-only boundaries, and workflows that are useful now.
2. If ledger health shows pending activity, candidate transfers, possible duplicates, stale
   sources, missing provenance, or unresolved reviews, state that limitation before using totals.
3. Inspect at most 20 representative transactions only when account names, counts, and summaries
   cannot answer the setup question. Treat pending transactions as provisional.
4. Do not ask for provider credentials, full account numbers, tax identifiers, or information
   already available through the scoped tools.

## Ask the short Finance interview

Ask only unanswered questions, one at a time:

1. **Sources and meanings:** Which available accounts are spending, bills, savings, debt,
   investments, reimbursements, business, or intentionally excluded context?
2. **Income, bills, and budgets:** What income cadence or variability matters, which obligations
   are essential or flexible, and what budget style or monthly-review outcome is useful?
3. **Alerts and review:** What large-expense amount, low-balance amount, recurring-change
   percentage, confidence threshold, pending-transaction policy, lead time, and review cadence
   should guide attention?
4. **Language and safety:** What should Ilo call spending and the review queue, and what additional
   actions or disclosures should an agent never make?

Store account meanings in `sourceContexts`; category language and examples in `categories`; custom
safety constraints in `instructions`; and concise context in `objective` and `summary`. Use these
stable preference keys when the user supplies them:

- `budgetStyle`: `category`, `envelope`, `flexible`, `zero_based`, or `unspecified`
- `reviewCadence`: `daily`, `weekly`, `monthly`, or `on_change`
- `reviewPendingTransactions`: boolean
- `reviewConfidenceBelow`: 0.5–1
- `billReviewLeadDays`: 0–90
- `largeExpenseAlertAmount`, `lowBalanceAlertAmount`: currency amounts
- `recurringAmountChangePercent`: percentage points from 0–100 (`20` means a 20% change)
- `termForSpending`, `termForReviewQueue`: short user language

These preferences guide the agent and attention workflow. They do not replace the API's adaptive
categorization threshold or silently reconfigure alert generation.

## Save and activate safely

1. Summarize the exact source meanings, context, thresholds, language, and added safety constraints.
2. Save a `draft` Finance profile with `save_domain_profile`; use `expectedVersion` when revising.
3. Explain which suggested workflows are currently available and which actions remain human-only.
4. Activate the profile only after the user accepts the summary. An active profile is durable
   guidance, not approval for a later financial mutation.

## Use reviewed workflows

### Categorization

1. Read `get_finance_ledger_health`, `get_finance_review_queue`, and
   `get_finance_categories`.
2. Call `propose_finance_categorizations`. `meetsPolicyThreshold` means eligible under current API
   policy; it does not mean the proposal ran automatically. Follow `nextCursor` when more review
   work is needed beyond the current page.
3. Show the transaction, category, confidence, threshold, and rationale. Apply only decisions the
   user accepts.
4. Call `apply_finance_categorizations` with `learnMerchant` set to `never` or `suggest`, passing
   the exact transaction `updatedAt` from the accepted proposal as
   `expectedTransactionUpdatedAt`.
5. Inspect every result. A batch can report `applied`, `review_required`, and `failed` items
   together; disclose partial effects and leave failed or low-confidence items in review.

Permanent merchant rules are human-only. Never infer one from a repeated name, a high score, or a
broad token.

### Transfers, recurring obligations, merchants, and alerts

- An agent may not confirm an ambiguous transfer. Preserve the review case and direct the user to
  Finance.
- Change an inferred recurring obligation only after the user explicitly confirms the item and
  desired Ilo status. `cancelled` changes Ilo's forecast context; it does not cancel payment with a
  provider.
- Rename or merge merchants only after inspecting aliases and receiving explicit confirmation.
  A merge removes the source merchant and requires a concise rationale.
- Resolve or dismiss an alert only after inspecting its evidence and confirming the user no longer
  needs it. Alert resolution does not change the underlying income, bill, subscription, or
  transaction.

MCP annotations are host hints, not authority. The Finance API's scope checks, human-only guards,
adaptive thresholds, audit events, and source attribution are the enforcement boundary.
