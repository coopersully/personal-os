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
secondary destinations. Accounts links to transaction import; subscriptions remain available
from Cash flow. Legacy import links open the Transactions import flow, and Ledger health links
redirect to Transactions checks. Existing budget and subscription deep links continue to resolve.

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

## Transaction context questions

For a known manual account, an unresolved, posted, uncategorized expense or income transaction
may expose **Add context** beside its transaction actions. The server checks full eligibility.
Creation opens the exact `?contextualQuestion=` destination, which reads the current typed
question rather than substituting the next Inbox item. A missing or foreign question is unavailable.

Show the source merchant, date and amount, one persistent prompt label and freeform answer field.
Save the server's exact work/action reference and retain the operation key for retries of the same
answer. Disable editing while saving. Loading, read failure, unavailable and stale states are explicit;
stale questions have no answer form. Confirmation says **Context saved. The financial review remains
open.** Source links connect the transaction and distinct financial case. No saved answer implies a
category change, bookkeeping result or scheduled maintenance.

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

Legacy questions and approvals remain under the existing disclosure in Review. Unified Reviews
projects each pending question/approval with its persisted action-review ID and each open/deferred
case with its case ID. Canonical cases use `?item=`, earlier cases use the legacy review destination,
and `?question=` or `?approval=` opens the exact corresponding work in the disclosure. Targeted
reads apply ownership and identity before the list limit. A missing, resolved, or inaccessible
item never substitutes another item; invalid IDs reject at the API boundary. Saved notes remain
open work rather than completed operations.

Finance accounts requiring renewed authorization also appear in Reviews, linking to their existing
account row. Automatic retries and operator-only failures do not become user reconnect requests.
The shared list retains redacted summaries; source evidence and mutation controls stay in Finance.
Historical effects use the authoritative Finance evidence helper and its explicit manual repair.
They remain visible even when a transaction no longer has `needsReview`. Identical repair actions
for the same transaction set appear once; a note or unrelated edit cannot clear them. Only the
helper's exact superseding evidence retires the repair. Operator-only changes retain their explicit
operator repair label rather than offering an invented approval.
If a Finance projection fails, available sibling work remains visible and affected counts are unknown.

## Financial setup contract

`/finances/setup` opens directly into a read-only configuration aggregate. Navigation and reload
never start the setup protocol, prepare a budget, approve anything, or run maintenance.
The **Profile**, **Accounts and records**, and **Budget** sections can be visited independently.
Unavailable reads remain distinguishable from missing information; successful sibling sections
stay editable. The API retains its interview protocol for agent clients.

Setup and Finance Settings share one editor for persisted household, income, debts, obligations,
goals, priorities, reserves, and payroll fields. Valid scalar edits save on blur or selection;
complete collection rows save when leaving the row. Incomplete rows remain local. Blank is unknown,
zero is explicit, and **None** confirms an empty collection. No routine saved message is shown.
Version-checked writes sharing the canonical profile are serialized; later local drafts survive
responses and section navigation. Failed fields preserve edits and offer retry or reload.

The configuration endpoint composes existing authoritative stores rather than copying them into
workspace preferences: versioned financial facts retain provenance and budget references;
payroll retains its effective-dated records and conflict checks; workspace preferences retain their
own revision. An unrelated payroll edit does not recalculate monthly income. Reliable budget
resources remain separate from expected monthly income and per-paycheck amounts.

Only an explicit **Prepare budget** action generates the conservative first proposal; it does not
require answering every field. Record checks are also explicit and can run independently. Existing
budgets remain inspectable. A missing budget opens a prerequisite screen with a setup destination
and return link. Accounts, transactions, recorded goals, and cash-flow records stay accessible;
derived forecasts retain their evidence checks rather than using a global setup-complete flag.

Sidebar groups are **Money** (Overview, Transactions, Accounts), **Planning** (Budget, Cash flow,
Wealth), and **Manage** (Financial setup). Budget retains `/finances/plan`. A prerequisite indicator
routes to the explanatory page; it does not leave a dead disabled link. Finance Settings belongs
in the shared Settings navigation, not as a separate sidebar shortcut.

The first plan uses only stated recurring resources and chosen needs, preserves exact-cent deficits,
and excludes uncertain income, exceptional resources, and reserves from recurring funding. Debt
minimums already represented in obligations are counted once. Planned contributions never update
goal balances. Missing position evidence is reported through the shared unavailable contract;
the generated first plan remains incomplete and cannot be activated. Manual bookkeeping remains
available throughout setup.

Budget approval loads the complete proposal and shows its resources, allocations, assumptions,
rationale, totals, and status. The app submits its exact budget and bound profile revision. The API
requires an authenticated user decision and checks the current profile and latest proposal under the
same lock. A caller-supplied `user_instruction` label is not user authentication; agent activation
is unavailable. Resuming reconciles a proposal revised or approved through Plan with saved setup.
Legacy unbound proposals with a current profile need a new bound revision before approval.

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
financial profile is editable through both Settings and Financial setup. Shared Connected agents and Workspace access continue to own connection
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
- Review work opens in the [shared workspace Reviews flow](reviews.md) from the Finance
  attention alert, Finance Settings header, or workspace search. The flow retains Finance-owned decisions and
  authorization; Finance Views and Today do not advertise separate review pages.
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
- Transactions exposes nonzero ledger checks not guaranteed to appear in Reviews; Accounts owns
  connection freshness, ownership, balances, and account coverage. Legacy Ledger health links
  redirect to Transactions checks rather than a dedicated health page.
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

## Finance review history

Finance review history is a read-only disclosure beside current Inbox work. It loads owned
open, deferred, and resolved cases in bounded pages ordered by first-seen time and stable ID.
Opening one row retrieves that exact case and shows its status, source evidence, and recorded
outcome, including the action, answer, rationale, classification or relationship details, and
transaction destinations when present. Automated consolidation and maintenance dismissal have a
rationale without a human answer; their reason remains visible. An unavailable exact case stays
unavailable; the UI does not substitute another review or imply that a saved note completed
bookkeeping.
History loading and exact-read failures retain a retry action beside the affected material.

## Responsive and accessibility contract

- Use a responsive bento grid for independent overview summaries, financial accounts, and goals.
  Compose existing Card/Item primitives and semantic surfaces; the position summary remains
  the full-width anchor. Tables, ordered activity, and financial evidence stay full-width when
  splitting them would impair comparison. Tiles collapse to one column based on available space.
  The app frame owns the page title.
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
- Open setup directly, edit and reload independent fields, inspect the full
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

## Header and page composition

Finance uses the shared primary header for workspace search and contextual controls. Pages publish
stateful controls through `WorkspaceHeaderControls`; the app frame mounts its destination beside
workspace search. No Finance page adds a secondary navigation row just for actions.

- Transactions has one trailing Add menu for transaction, category, and transaction import actions;
  it has no separate New transaction button. The import dialog links to import history.
- Plan exposes Revise plan in the workspace header when a plan is available. The Budget buckets
  card owns its Add action and category manager.
- Accounts exposes Import records in the workspace header. The Accounts card owns Add account,
  which offers bank connection or manual account creation.
- Wealth owns Create goal in the Financial goals card header and links to account management.
- Overview and Financial profile do not add a workspace-wide creation control. Profile section
  editors retain their own record actions.
- Cash flow uses a compact view dropdown with trailing radio indicators for Outlook, Income,
  Bills & subscriptions, Reimbursements, and Scenarios. The selected view remains URL-backed;
  changing it preserves other query parameters.
- Controls remain end-aligned with consistent spacing. Icon actions retain accessible names
  and tooltips. Narrow/zoomed layouts may wrap within the header without horizontal overflow.
  The shared mobile create placement remains in effect.
- The Transactions Add menu’s transaction action opens the existing transaction form in the shared
  responsive dialog/drawer, using a navigable transaction route and hash. Closing removes that hash while preserving
  transaction filters. Draft fields remain intact while closing/reopening the same mounted page;
  a successful save clears the draft.
- Transaction filtering remains a labelled form beside the ledger because its combined
  account/category/date inputs need more room than the header. Record actions and financial
  evidence stay with the records they affect.

Validation covers header placement on six Finance routes, exclusive Cash flow selection and
reload, single creation entry, dialog/drawer presentation, draft preservation, and viewport
overflow on desktop/mobile. Provider behavior and financial calculation rules are unchanged.

### Contextual information and progressive disclosure

Budget renders totals once from structured budget data. Assumptions remain available as individual
secondary rows under a disclosure; rationale is a separate disclosure. Incomplete budgets retain a
visible next action and do not present absent resource evidence as a confirmed zero. Allocation
progress is shown only when expected resources are positive.

Transactions owns a leading icon-and-label view menu and trailing Export and Add header actions. Add offers transaction, category, and transaction import commands. Import is a responsive dialog/drawer;
legacy import links redirect into that flow. The standalone Ledger health page is retired. Only nonzero diagnostics not guaranteed to appear in Reviews belong on Transactions, while connection freshness, ownership,
balances, and account coverage belong on Accounts. Pending activity and balance-only tracking are
informational, not automatically warnings. Existing health links redirect to Transactions checks.

Financial profile is the durable name for the planning-input surface. Sidebar attention derives
from missing planning facts, proposed budgets awaiting approval, and disconnected or bank accounts
not successfully refreshed for more than 24 hours. Accounts displays the total account count, including manual accounts. Missing balances, unresolved ownership, and possible duplicate accounts also set sidebar attention.
Account warnings name the affected account and provide sync, reconnect, or edit actions.

Accounts use full-width records with type icons, source/status badges beside the title, and tooltip-equipped edit/transaction actions at the top end. Wealth presents current metrics in responsive shared KPI cards and links to Accounts rather than repeating its records. Historical charts are deferred until reliable balance history is available.

Accounts, Budget buckets, and Financial goals each expose a tooltip-equipped Add action at their card header end. The transaction-only Add menu lives at the end of the header; other Finance pages have no
workspace-wide Add menu. Cash flow view selection occupies the shared leading header slot; search
and other utilities remain at the end. Account records are secondary Items within the Accounts
card, with inline attention, source, kind, balance, and recovery actions rather than separate warning
cards. Currency fields use CurrencyInput; absent account currency stays unspecified, with the
source caveat available in a tooltip. Pending posting state has an explicit badge and subdued row;
it is independent of review status. URL `reviewState` filters transactions, while `review` opens a
review flow. Historical review-state links remain readable without opening a review dialog.

### Shared Finance presentation

Overview and Wealth compose the shared `KeyMetrics` container and `KeyMetric` cards. Metrics fit
side by side when space permits and wrap on narrow screens; current data does not imply historical
balances. The Overview does not duplicate the outstanding Reviews inbox.

Transactions begin directly with their compact table or full-width card rows, without an enclosing card, title, description, or body toolbar. The header view menu retains active filters when switching. Income amounts use success, expenses destructive, and transfers neutral foregrounds. Expanded details wrap to available row width. Both views retain the same details, categorization, split, and
pagination behavior. Cash flow reuses the Finance transaction Item with an explicit Expected state;
forecast entries are not posted transactions. Recurring-item actions sit at the top right.

Bento collection add actions use the Settings-standard ghost icon button and accessible tooltip.
All dollar-entry fields compose `CurrencyInput`, including allocations, split amounts, scenarios,
and setup answers. Scenario and split fields must wrap within the available container, retaining
persistent labels. Merchant and category entry search existing names and permit new names; new
records are created by the transaction save. Budget navigation needs attention when prerequisites
are incomplete or no active approved plan exists.

Split allocations use the card surface inside the background-toned dialog so each allocation is distinct. The Transactions Add menu can save a reusable category without creating a transaction; the authenticated human-only endpoint validates the name, scopes storage to the owner, and records an audit event.

KPI amounts use compact currency notation (for example, $23.6k), with exact values available on hover and to assistive technology. Overview labels monthly spending **Spent this month**. Four-metric sets use four columns when space permits and otherwise a balanced 2×2 grid, never three plus one.

Transaction cards place the large signed amount at the inline end, with matching status and category badges inline beside the small date below the merchant. A compact merchant icon spans the title and metadata rows. The Tasks-standard Display menu offers grouping by date, category, merchant, direction, or posting state in card view only; group/view choices preserve filters in the URL and save to Finance workspace settings using revision-checked writes, as in Tasks. Opening Transactions without explicit URL choices restores these defaults; explicit links override them without resaving. Table view retains the saved card grouping without applying it. Grouping applies to the loaded page and is explicitly labelled when pagination is present.

Transaction cards and table rows open details in the shared responsive dialog/drawer on activation; they never expand inline or include a Details button. Right-click/long-press exposes Split purchase, Add/Edit context, and Categorize/Recategorize. The same commands remain in details for touch and keyboard access. Context notes preserve the observed transaction version when saved and retain drafts after failures. Table view ignores retained card-group parameters and uses a dedicated posted/pending icon column with accessible labels and explanatory tooltips.

### Saved account selections

Spending, cash, and investment account selections persist as account-owned workspace preferences.
The account selector distinguishes selecting no accounts from following all eligible accounts;
“Use all eligible accounts” restores the latter. Save errors remain visible and do not claim a
persisted change. These view preferences never modify planning inclusion or account meanings.
Finance notification settings show inherited/effective policy and support resetting an existing
workspace override to global preferences using its current revision.
