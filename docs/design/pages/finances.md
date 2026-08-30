# Finances specification

## Overview user job

**Understand my current financial position and handle the next decision that
needs me.**

The default Finance route leads with one financial-position block containing
cash tracked, posted spending for the current month, and net worth. When work
needs review, that same block provides the primary action into the review
queue. Review and Accounts are first-class sidebar destinations; the overview
does not repeat every Finance destination as a grid of cards.

An unconfigured budget renders one explanatory empty state and one setup
action. Ledger diagnostics remain summarized by the number of affected check
types and disclose their detailed counts on request. Record counts from
different checks are never added into a synthetic issue total because the
underlying records may overlap.

## Agent guidance user job

**See whether my Finance context is ready for a scoped agent and understand
which decisions still require me.**

Agent guidance belongs in the Finance feature's Profile section. The shared
Connected agents and Workspace access continue to own connection and authorization; this surface
explains Finance readiness and routes there without duplicating its controls.

Finance settings begins with one standard switch: **Let agents apply confident
Finance changes**. It is off by default, changes only the Finance ledger review
boundary, and remains a signed-in-user control. Enabling it does not turn
uncertainty into permission: questions and ambiguous activity still come to
Review.

## Content contract

- The overview distinguishes current balances and posted activity from
  forecasts or pending transactions.
- Review work is visible in both the primary overview block and Finance
  navigation.
- Review lists bounded questions before approvals. A maintenance turn appears
  as one approval, while its individual prepared changes remain available by
  progressive disclosure.
- Cash flow shows reimbursements as their own expected/received/remaining
  ledger, including overdue state and linked credits.
- A mixed purchase is edited in one exact-cent breakdown dialog. Every cent
  must be assigned, reimbursement treatment is explicit, and a future merchant
  rule is unavailable for mixed allocations.
- The overview keeps four high-value facts visible: personal spending,
  projected low balance, outstanding reimbursements, and the latest immutable
  period review.
- Summary metrics live within their owning position block instead of separate,
  equally weighted metric cards.
- Detailed ledger checks use progressive disclosure on the overview and remain
  fully visible on the dedicated Ledger health route.
- Empty budget pace does not render an inactive time-range control or an empty
  visualization.
- Profile state is explicit: not configured, draft, or active.
- Source readiness counts only current Finance accounts owned by the user.
- Source meanings are labeled as interpretation guidance, not token/account
  authorization.
- Suggested-workflow readiness comes from the Finance API, not UI inference.
- The review-bypass switch reflects the persisted API setting, saves
  optimistically, rolls back on failure, and stays disabled while loading or
  saving.
- The safety summary renders every typed `humanOnlyActions` value returned by
  the Finance API through an exhaustive label map; the UI does not duplicate
  or infer that policy.
- Loading and failure remain local to the guidance card and do not hide the
  human-managed financial profile.
- An agent-authored profile remains a draft. The signed-in activation control
  appears only for a draft and stays disabled until the draft contains at
  least one owned account source; activation submits the exact profile version.

## Responsive and accessibility contract

- Guidance precedes the financial profile so readiness and boundaries are read
  before administrative fields.
- Status is text as well as color. Every route to agent controls is a labelled
  link with a standard keyboard target.
- Compact rows wrap at narrow widths; no count or policy meaning is conveyed by
  an icon alone.

## Verification

1. Open Finances and confirm the current position and review action are first,
   the route-directory cards are absent, and ledger detail is closed.
2. Open an account without a configured budget and confirm one setup action
   replaces the budget graph and period controls.
3. Open Finances → Profile with no domain profile and confirm “Not configured.”
4. Save a draft through an agent, confirm agent activation is forbidden, then
   activate it in Finances → Profile and confirm the state changes without
   editing shared Settings UI.
5. Confirm source and workflow counts match the guided-context API.
6. Fail either readiness request and confirm an actionable local error while
   the financial profile remains usable.
7. Verify keyboard operation and narrow/mobile wrapping.
