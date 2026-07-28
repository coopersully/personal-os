# ilo — Implementation Log

This log records delivered vertical slices against the master plan. It does not imply that an epic is complete until all of its listed completion criteria are met.

## 2026-07-27 — Immediate, resumable account setup

- New accounts enter a persistent guided setup immediately after registration,
  while established accounts remain uninterrupted.
- Added workspace-driven progressive disclosure for Google, Apple, and Finance
  connections, with a durable Exit setup action available throughout.
- Reused the production iCloud and Plaid connection paths and limited Google
  OAuth scopes to the Calendar and Mail services selected by the person.
- Preserved setup progress and the safe return destination through provider
  OAuth, then rendered the real connected account data on return.
- Documented setup as progressive configuration rather than a product-tour
  carousel in the design system and page contract.

## 2026-07-20 — Finance wealth and budget grounding

- Added a typed wealth summary to the API, client, and MCP: net worth splits cash, investments, debt, and other assets; annual income excludes transfers.
- Added account-kind persistence and a budget setup context that presents monthly income, planned limits, and remaining capacity instead of guessing from transfers.

## 2026-07-21 — Finance intelligence, cash flow, and accountable automation

- Added effective-dated financial profiles, stated-versus-observed income provenance, inferred income streams and recurring obligations, in-app alerts, and conservative cash-flow forecasts.
- Kept categorization, recurring detection, and transfer reconciliation evidence-led: uncertain candidates are visible in the review queue, and repeated user confirmation—not a single agent guess—builds automation confidence.
- Added the shared finance API-client and MCP surfaces for ledger health, transactions, categories, budgets, merchants, review decisions, wealth, cash flow, recurring payments, and alerts. The MCP adapter contains no independent finance policy.
- Added budget pace data and the overview contribution-style graph with complete calendar cells, muted blanks, week/month/year views, and restrained ahead/behind colors.
- Consolidated the branch-only Finance migrations 0016–0020 into `0016_finance_intelligence.sql`, retaining the confidence and transfer-review backfills before the migration chain reaches a shared branch.
- Documented the feature boundaries, ledger invariants, income provenance, forecast ordering, agent limits, and migration rule in [ADR 0003](../architecture/0003-finance-intelligence.md).

## 2026-07-20 — Finance transaction ledger clarity

- Replaced transaction cards with a sortable TanStack table: one transaction per row, localized dates, readable direction and amount labels, and an inline review action.
- Established server-side ledger sorting and opaque cursor pagination across the typed API and web client. The default is newest first, sorting resets the page, and table rows stay single-line until their details are explicitly opened.
- Added unambiguous signed amount treatment: income is green with a plus sign, expenses are red with a minus sign, and transfers remain neutral.
- Added a visible merchant-entity cue: a check means the transaction is linked to a canonical merchant, and a question mark means it still needs an entity match.
- Translated provider category codes to human labels in the ledger; raw values such as `TRANSFER_OUT` no longer reach the user-facing table.
- Corrected confidence storage to basis points, added a migration for the prior percentage-point rows, and kept the typed client contract at a safe 0–1 value. A 9,500-basis-point provider signal now appears as 95%.
- Recorded these ledger behaviors in the experience standards and added API/UI coverage for the conversion and the new table cues.
- Verification includes lint, type checks, focused Finance/API/UI coverage, and desktop/mobile E2E. The repository uses its documented 95% statements/functions/lines and 94% branch coverage floor, supplemented by targeted tests for Finance safety paths.

## 2026-07-18 — Today clarity and completed-work integrity

- Reworked Today around a single glanceable flow: current activity, immediate next event, remaining commitments, then later schedule details.
- Moved completed reminders into a collapsed **Done today** history and kept the open-work count limited to actionable reminders.
- Enforced the same rule in the Daily Brief service: completed reminders cannot appear in `overdue`, `today`, or `anytime` automation output.
- Added API integration coverage for the completion exclusion and UI coverage for expanding completed history/reopening an item.
- Verified with the local runtime and the focused API/web regression suite. Generated shadcn primitives are excluded from product coverage; shared product compositions remain covered by the repository floor and focused behavior tests.
