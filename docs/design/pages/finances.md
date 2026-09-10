# Finances specification

## Overview user job

**Understand my current financial position and handle the next decision that
needs me.**

The portal and Finance MCP operate on the same accounts, transactions, versioned
financial profile, complete budget, Inbox cases, and goals. Agent-created
proposals are inspectable and actionable in the portal.

Seven primary destinations serve distinct jobs:

| Destination | Immediate job |
| --- | --- |
| Overview | Understand the ownership-qualified position and next material decision. |
| Review | Select an outstanding Inbox item and supply context or apply a correction. |
| Transactions | Inspect exact records with URL-backed filters and server pagination. |
| Plan | Inspect, create, revise, and approve the complete versioned budget. |
| Cash flow | Distinguish current evidence, dated forecasts, recurring items, subscriptions, and reimbursements. |
| Wealth | Inspect the qualified snapshot and manage actual financial goals. |
| Accounts | Check freshness and ownership, correct planning inclusion, and connect, import, or enter records. |

The default route uses one primary position block and an open sequence of
supporting material. Unavailable amounts remain unavailable; partial ownership
or stale sources remain visible. Financial setup and Finance settings are
secondary destinations. Imports and Ledger health remain available from
Accounts; subscriptions remain available from Cash flow. Existing budget and
subscription deep links continue to resolve.

Navigation uses the shared shadcn sidebar group, menu, button, and badge
components. The workspace picker already names Finances, so the navigation
does not repeat that heading. Review counts use the canonical Inbox collection
in the menu badge; legacy approvals and overlapping diagnostic checks are not added to that count. The
active destination retains its accessible current-page state.

An unconfigured plan renders one explanatory empty state and a setup action.
Ledger diagnostics disclose their individual evidence and recovery paths.
Record counts from different checks are never added into a synthetic issue total because the
underlying records may overlap.

## Complete Plan contract

Plan displays the latest complete budget version, including proposed or active
state, effective month, every resource and allocation, recorded assumptions,
rationale, and API-owned totals. Categories, resource kinds, allocation kinds,
budget buckets, and goal/account relationships retain their identities when
edited. Client arithmetic provides form feedback; persisted totals are the
server's result. The complete plan must balance to the cent.

Approval names the displayed budget version ID and its expected version, with
`approvalSource: user_instruction` and an idempotency key. A changed version,
failed request, or pending request keeps an explicit recovery state. Proposals
remain visible before approval; a category-only budget view is not a substitute
for the complete plan shared with MCP.

## Canonical Review contract

Overview includes one compact outstanding list from the canonical Inbox, including
open and deferred cases. Show five rows initially with an explicit expansion for the rest;
do not duplicate its first question in a second next-step block. Each row identifies
the merchant, transaction date, account, amount, direction, posting state, and review reason.
Amounts from distinct review reasons are not summed into a synthetic financial loss.

Selecting a row opens the shared review editor. Review also allows choosing any outstanding
case. The API supplies each case's prompt and transaction context. Exact transaction links
and same-account activity within seven days are inspectable; nearby activity is not proof of
a transfer, refund, or reimbursement. Loading, unavailable source context, failed reads,
and truncated activity remain explicit.

A freeform note is the default action. It stays attached to the case, survives refreshed
findings, and appears as “Note saved · awaiting maintenance” until a supported resolution is
applied. Saving it does not start or schedule an agent. The next maintenance response includes
those saved notes. A user may instead choose a category, link a related transaction, or dismiss
with a reason immediately using the same authenticated, idempotent answer API as MCP.
Failed saves preserve input and the retry key; resolved cases disappear only after success.

Legacy questions and approvals remain under the existing disclosure in Review.

## Financial setup contract

`/finances/setup` starts or resumes the server-owned setup protocol only after
an explicit click. A remounted page discovers interrupted progress through
`start`; the active session uses `resume`. Each answer sends the session ID,
current question ID, exact session version, and an idempotency key. Conflicts
preserve entered text and offer a resume action.

Budget approval loads the complete proposal and shows its resources,
allocations, assumptions, rationale, and totals before enabling approval. The
loaded budget must match the session's `budgetVersionId`. Setup approval sends
that exact ID and the setup session version; the API guards the budget revision
as part of the same operation. Resuming reconciles a proposal revised or approved
through Plan or MCP with the saved setup session.

Saving a profile or approving a budget does not imply maintained finances.
Initial maintenance starts on request and displays the returned run stage.
Reasoning and audit stages require a capable caller to inspect evidence and
submit judgments or findings. This page does not fabricate those inputs, run
an agent in the background, schedule future work, or label pending maintenance
complete. Plan, Accounts, Review, and connected-agent recovery links remain
available at their relevant steps.

## Agent guidance user job

**See whether my Finance context is ready for a scoped agent and understand
which decisions still require me.**

Compatibility domain guidance belongs in Finance settings. The canonical
financial profile and one-question interview are available through Financial
setup. Shared Connected agents and Workspace access continue to own connection
and authorization; Finance routes there without duplicating those controls.

Finance settings provides the canonical financial profile and planning preferences, plus
separate payroll details. The **Let agents apply confident Finance changes** switch
is off by default, controls agent self-approval and the legacy Finance
apply-or-review boundary, and remains a signed-in-user control. Enabling it does not turn
uncertainty into permission: questions and ambiguous activity still come to
Review.

## Content contract

- The overview distinguishes current balances and posted activity from
  forecasts or pending transactions.
- Review work is visible in both the primary overview block and Finance
  navigation.
- Canonical Review leads with its current bounded question. Older maintenance
  approvals disclose their individual prepared changes inside the labelled
  compatibility queue.
- Cash flow withholds legacy forecasts when shared or excluded accounts cannot be
  represented accurately. Scenario comparisons are explicit, hypothetical inputs and
  never change a saved plan.
- Cash flow shows reimbursements as their own expected/received/remaining
  ledger, including overdue state and linked credits.
- A mixed purchase is edited in one exact-cent breakdown dialog. Every cent
  must be assigned, reimbursement treatment is explicit, and a future merchant
  rule is unavailable for mixed allocations.
- Position, actual activity, forecasts, reimbursements, and immutable period
  reviews remain in their owning destinations with source and availability
  labels; the UI does not synthesize wealth history or an unsupported forecast.
- Summary metrics live within their owning position block instead of separate,
  equally weighted metric cards.
- Detailed ledger checks use progressive disclosure on the overview and remain
  fully visible on the dedicated Ledger health route.
- Empty budget pace does not render an inactive time-range control or an empty
  visualization.
- Compatibility domain-guidance state is explicit: not configured, draft, or active.
- Source readiness counts only current Finance accounts owned by the user.
- Source meanings are labeled as interpretation guidance, not token/account
  authorization.
- Suggested-workflow readiness comes from the Finance API, not UI inference.
- The review-bypass switch reflects the persisted API setting, saves
  optimistically, rolls back on failure, and stays disabled while loading or
  saving.
- Portal controls render every typed compatibility `humanOnlyActions` value
  through an exhaustive label map. They describe available portal actions;
  canonical scoped MCP operations have their own authorization contract.
- Loading and failure remain local to the affected source or guidance section.
- An agent-authored compatibility domain-guidance profile remains a draft. The
  signed-in activation control appears only for a draft and stays disabled until the draft contains at
  least one owned account source; activation submits the exact profile version.

## Responsive and accessibility contract

- Use at most one raised primary block per page; supporting material is an open
  sequence, table, or labelled disclosure. The app frame owns the page title.
- Financial context, agent guidance, and payroll details remain separately labelled;
  connection and access controls remain in shared Settings.
- Status is text as well as color. Every route to agent controls is a labelled
  link with a standard keyboard target.
- Compact rows wrap at narrow widths; no count or policy meaning is conveyed by
  an icon alone.

## Verification

The approved workspace journeys extend the compatibility checks below:

- Inspect an agent-created complete proposal, revise it without losing resource
  or allocation identities, and approve only the displayed exact version.
- Confirm unknown balances and ownership shares never become zero or an
  unqualified net-worth total.
- Answer one canonical Inbox question, fail and retry a request, and verify
  progression follows the response while older approvals remain accessible.
- Start or resume setup, answer at the saved session version, inspect the full
  proposal, and confirm reasoning or audit work remains visibly pending.
- Open all seven destinations and legacy deep links at desktop and narrow
  widths; verify keyboard controls, wrapping, filters, and local read failures.

1. Open Finances and confirm the current position and review action are first,
   the route-directory cards are absent, and ledger detail is closed.
2. Open an account without a configured budget and confirm one setup action
   replaces the budget graph and period controls.
3. Open Finance settings → Profile with no domain profile and confirm “Not configured.”
4. Save a draft through an agent, confirm agent activation is forbidden, then
   activate it in Finance settings → Profile and confirm the state changes without
   editing shared Settings UI.
5. Confirm source and workflow counts match the guided-context API.
6. Fail either readiness request and confirm an actionable local error while
   the financial profile remains usable.
7. Verify keyboard operation and narrow/mobile wrapping.
