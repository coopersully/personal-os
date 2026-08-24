# Finances runbook

## Fixtures and routes

- Populated: `demo+full@ilo.test`
- Empty: `qa+empty@ilo.test`
- Recovery: `qa+recovery@ilo.test`
- Routes: `/finances`, `/finances/transactions`, `/finances/budgets`,
  `/finances/cashflow`, `/finances/subscriptions`, `/finances/health`,
  `/finances/profile`, `/finances/review`, `/finances/accounts`
- Contract: `docs/architecture/0003-finance-intelligence.md`

Never connect a real institution, move money, or submit real financial data
during routine QA.

## Overview

With the populated fixture confirm:

- $3,064.16 spent this month, four accounts, and one item needing judgment;
- net worth $65,227.84, investments $42,850.00, cash $23,625.34;
- stated annual income $145,000 and separately observed income;
- complete budget-pace cells and a plain-language over-pace summary;
- ledger integrity counts for review, pending activity, and balance-only data.

With the empty fixture confirm zero values are honest, the budget explanation
offers setup, and no fake chart activity appears.

## Transactions and review

1. Confirm one row per transaction with sortable Date, Merchant, Category, and
   Amount columns.
2. Confirm signs communicate income, expense, and neutral transfers without
   relying on color.
3. Expand Sq Unknown Popup:
   - category is Uncategorized;
   - amount is −$78.25;
   - direction is Expense;
   - confidence is 42%;
   - raw description is `SQ *UNKNOWN POPUP 8821`;
   - Categorize is the bounded next action.
4. Confirm transfers are not counted as spending.
5. `/finances/review` must show the same unresolved evidence rather than a
   second classification.

## Budgets and supporting workspaces

- July 2026 budget shows $1,550 planned, $135.91 spent, and $1,414.09 left.
- Dining, Groceries, and Subscriptions retain separate limits and progress.
- Month navigation requests the selected month and updates the named period.
- Export, edit, and contribution details remain explicit controls.
- Cash flow separates evidence, obligations, alerts, and safe-to-spend.
- Ledger health explains uncertainty before it affects planning.
- Profile clearly separates declared income from observed income.

## Accounts, recovery, and script hygiene

- The populated fixture has cash, savings, investment, and debt accounts.
- The recovery fixture must visibly mark the affected Plaid account as needing
  reauthentication and offer an actionable repair path.
- Navigating among finance routes must not inject Plaid Link more than once.
  Check browser warnings for “link-initialize.js script was embedded more than
  once.”

## Responsive pass

At 390 × 844:

- metric cards stack without value/action collision;
- there is no document horizontal overflow;
- tables use intentional internal horizontal scrolling rather than wrapping
  monetary context;
- the mobile navigation remains reachable;
- persistent actions do not obscure the last content rows.

Reload fixtures after categorization, account, transaction, budget, profile, or
subscription mutations.
