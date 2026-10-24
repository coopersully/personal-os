# Finances specification

> October 18 Finance experience revision: the consolidated [design](../../superpowers/specs/2026-10-18-finance-experience-design.md)
> and [implementation plan](../../superpowers/plans/2026-10-18-finance-experience.md) define the target for setup,
> Spending, Chat, Automations, Activity, and manual workflow coverage. They supersede conflicting
> earlier setup targets below. The review-bypass policy below supersedes their budget approval exception. This is not a
> declaration that the redesigned experience has shipped.
> The implementation merged in [PR #270 — Complete the Finance workspace and guarded agent workflows](https://github.com/coopersully/personal-os/pull/270).
> The [implementation log](../../product/implementation-log.md) distinguishes this source checkpoint
> from production and external-host acceptance.

## Latest accepted setup and history decisions

Spending defaults to personal cost, with a setting for full outflow. Reimbursable and received
amounts remain distinct in supporting evidence. Finance uses one ongoing conversation and existing
notification preferences.

Conversation-driven Finance actions retain durable links between the handled case/question, the
agent question when present, all relevant user replies, resulting activity/audit events, and affected
financial records. Activity exposes the supporting excerpts and decision explanation with links back
to source messages and records. A question covering three transactions answered in two user messages
retains all three messages and all three transactions under the case, with specific evidence for each
change where applicable. User-initiated instructions may create a case without an agent question.
Keep original evidence and later corrections inspectable. Read receipts, answers, and successful
financial actions are distinct states; conversational provenance never replaces exact budget approval.

Users may defer automation and complete setup in manual mode with Chat visible but locked.
Automated maintenance is the intended experience; manual mode is secondary but supported. Ensure
usable UI equivalents for user-facing Finance agent workflows, including reviewing uncategorized
transactions, categorization, splits, supported matching/reconciliation, questions, budget operations,
and source/profile management. Audit actual tool/UI coverage before claiming completeness. Internal
execution machinery does not require user controls; human budget approval remains mandatory.

Single-month spending selections use the applicable approved budget for that month, including past
months. Missing budgets and multi-month selections omit fill with an explanation while retaining
bucket/category grouping. Never silently substitute today's budget. The [spending contract](../../engineering/finance-spending.md) defines revision selection and coverage;
design §§4 and 13 retain the accepted direction.

## Overview user job

### Daily summary

Overview leads with an At a glance heading and compact linked balance metrics. A small ghost info button opposite the heading opens the About these totals disclosure, then upcoming expected money and planning context. The disclosure replaces the Financial position card and retains freshness, reconciliation, required evidence gaps and Accounts navigation. Reviews remain available through the shared sidebar entry; Overview
does not duplicate the decision summary or its action links. Overview makes no all-clear review claim and does not fetch a second decision summary.

Recorded reviews and maintenance link to Activity evidence rather than implying a new completed
action. Upcoming money uses the shared table with expected date, linked item and signed expected amount. Income uses success color and +;
outflows use destructive color and −, matching Transactions, without a trailing currency code.
Rows open the corresponding income/bill source in Cash flow; item links also support keyboard navigation. Show ten canonical occurrences per page across 30 owner-local dates, with
standard previous/next icon buttons, page count, visible range and a 10/25/50 rows-per-page selector below the table surface.
The shared Card uses the same settings-panel treatment and subtle dividers as shared DataTable,
with aligned 16px horizontal cell padding, compact 8px vertical padding and wrapping item names.
Pagination sits outside the Card; it does not form an extra table row or padded panel. Six demo items fit
on one page. Do not repeat the date-range/timezone explanatory line above it. Preserve remaining
amounts for partial occurrences, explicit currencies and incomplete-source caveats. Its Cash flow
link sits opposite the Coming next heading and retains the exact agenda range.
Unavailable recurring records appear in the Coming next header description as items not included yet, with dates/amounts to confirm in Cash flow. Open upcoming money and Open Activity use small ghost arrow icon links opposite their section headings, with accessible names and tooltips. Expected movements are not booked money or a safe-to-spend
total. Complete plan is a single status/allocation/unassigned summary linking to Budget; rationale and allocation details stay on Budget. Remove the duplicate forecast, wealth-priority and generic next-step/navigation prompts. Show a reimbursement summary only for a positive outstanding amount. What changed shows only the latest recorded period review and maintenance status with Activity navigation; use one empty-state line when neither exists.

### Spending dashboard

Spending is a new sidebar destination; retain Overview and existing destinations in this scope.
Automations and Activity each have their own sidebar page. Reassess redundancy after the redesign
is visible rather than replacing Overview now.

The display toolbar groups the single selected view, period navigation, and grouping selector.
Use shared checked menus for period/grouping and the shared single-select toggle for views.
Spending options open a bounded dialog with the shared Settings row context: labels at the start,
controls at the end, active-filter count on its trigger, and immediate revisioned preference saves.
Keep the selected-period amount, basis, pending inclusion and coverage caveat visible. Detailed
scope, monthly-budget confirmation, source qualifications and technical references live in
**About these totals**. Bubble arrangement is always available with a reset icon in its heading.
Do not add a repeated list or explanatory footer beneath the canvas. Preserve exact contributions,
recovery links and accounting queries.

The spending bubble view defaults to configured budget buckets, or categories when no buckets are
configured, and remembers the user's explicit grouping choice. Buckets support category drill-down.
Both bucket and category contexts offer Transactions links preserving the selected group and period.
Bubbles are always draggable, including when reduced motion is enabled. Keep bodies rigid:
no drag elasticity or inertial throw. Resolve collisions while dragging with the active body pinned;
on release, use a damped spring and center the aggregate bounds in the canvas. Preserve relative
session positions across data changes. The heading is Breakdown and the sole layout action is an
accessible reset icon button. Icons sit at each circle's center, with labels below. Settle geometry and measure before first paint;
newly mounted circles start at their settled positions. Coincident circles separate in two dimensions,
with a final collision-only cleanup after the centering attraction stops.

Bubble backgrounds and budget fills use clean category colors, without dithering or filter effects.
Keep the circular background separate from crisp foreground labels/icons. Reduced motion disables
spring/fill animation while manual dragging and keyboard detail/reset controls remain available.

Use the assigned bucket/category color with a translucent tonal overlay filling upward inside the
bubble; do not use a perimeter progress ring. Labels, icons, and controls remain legible above it.
Bubble size represents spending for the selected period; fill represents monthly budget usage and
is labeled as monthly in each circle's accessible name and tooltip even on shorter views. Animate fill changes and distinguish
overspending from exactly using the budget. Missing limits never become invented percentages.
Single-month selections resolve the applicable approved budget; multi-month selections omit fill.
Positive circles retain true area and remain keyboard focusable, including tiny circles. Full names,
exact amounts, monthly usage and coverage are available through accessible names/tooltips and the
existing detail dialog. Zero and negative groups remain in List. Reduced motion disables automatic
animation while preserving manual arrangement. Do not repeat the List below Bubbles.

Trends uses the shared Card composition and a responsive net-spending line chart with Finance accent,
quiet grid/axes and formatted dates. Focus lives in the primary navigation. The comparison stays in
the chart header; detailed period rows, source/coverage and group changes live in its info dialog.
Signed points preserve net refunds; exact selections remain available by pointer and keyboard.
Rhythm uses compact month Cards with square date cells, a shared green intensity scale, neutral
confirmed-zero days and muted future days. Dashed cells indicate incomplete evidence; hover/focus
opens the shared tooltip with exact amount and status. Keep keyboard date navigation and exact
drilldown, without a duplicate daily list or prose block below the calendar.
See the [spending contract](../../engineering/finance-spending.md) for coverage and disclosure rules.


Include pending spending by default, with a configurable inclusion option in the view and Finance
settings. Expose grouping defaults and granular display choices during setup using simple controls;
agent-led setup discusses and saves the same preferences. These display settings must not redefine
canonical ledger meaning or count a pending charge and its posted replacement twice.

**Understand my current financial position and handle the next decision that
needs me.**

The portal and Finance MCP operate on the same accounts, transactions, versioned
financial profile, complete budget, Inbox cases, and goals. Agent-created
proposals are inspectable and actionable in the portal.

The sidebar groups destinations by job, matching the [navigation registry](../../../apps/web/src/features/finances/navigation.tsx):

| Group | Destination | Immediate job |
| --- | --- | --- |
| Money | Overview | Understand the ownership-qualified position and next material decision. |
| Money | Transactions | Inspect exact records with URL-backed filters and server pagination. |
| Money | Spending | Explore personal cost or full outflow by bucket/category and open the matching transactions. |
| Money | Accounts | Check freshness and ownership, correct planning inclusion, and connect, import, or enter records. |
| Planning | Budget | Inspect, create, revise, and approve the complete versioned budget on the Plan route. |
| Planning | Cash flow | Distinguish current evidence, dated forecasts, recurring items, subscriptions, and reimbursements. |
| Planning | Wealth | Inspect the qualified snapshot and manage actual financial goals. |
| Manage | Chat | Continue the Finance conversation, with unread state and explicit sending readiness. |
| Manage | Automations | Inspect registered schedules and their capability and health. |
| Manage | Activity | Trace actions to supporting messages, decisions, and records. |
| Manage | Financial profile | Review and edit setup and canonical planning inputs. |

Review is no longer a sidebar destination; review work retains its canonical records and contextual
entry points. Chat, Activity, and financial records keep conversation and action evidence connected.

The default route uses one primary position block and an open sequence of
supporting material. Unavailable amounts remain unavailable; partial ownership
or stale sources remain visible. Financial profile is available in the sidebar; Finance settings remain a
secondary destination. Accounts links to transaction import; subscriptions remain available
from Cash flow. Legacy import links open the Transactions import flow, and Ledger health links
redirect to Transactions checks. Existing budget and subscription deep links continue to resolve.

Navigation uses the shared shadcn sidebar group, menu, button, and badge
components. The workspace picker already names Finances, so the navigation
does not repeat that heading. Chat displays its canonical unread count and sending-readiness state; Accounts counts tracked
accounts. Attention indicators use the owning account/profile/budget projections, not a sum of
overlapping diagnostic checks. The active destination retains its accessible current-page state.

An unconfigured plan renders one explanatory empty state and a setup action.
Ledger diagnostics disclose their individual evidence and recovery paths.
Record counts from different checks are never added into a synthetic issue total because the
underlying records may overlap.

## Reimbursement receipt evidence

Cash flow Reimbursements keeps one row per allocation-owned claim. Receipt history and evidence
opens a labelled disclosure containing each recorded match's amount, rationale, recording time,
and canonical credit transaction link. Claim, allocation and source references remain inspectable;
provider remote identifiers are provenance rather than local transaction links. Local transaction
source references link only when they contain a valid canonical transaction ID.

Unknown due dates remain unknown, and cancelling an expected remainder retains its recorded
receipts and cancellation evidence. Match recording time is not a settlement date. Receipt detail
amounts carry no assumed currency because the current reimbursement read does not supply one;
the existing summary totals are preserved. Original expense amounts and dates, currency-qualified
journey totals, and receipt correction/unmatch remain outside this read-only disclosure.

## Complete Plan contract

Plan displays the latest complete budget version, including proposed or active
state, effective month, every resource and allocation, recorded assumptions,
rationale, and API-owned totals. Categories, resource kinds, allocation kinds,
budget buckets, and goal/account relationships retain their identities when
edited. Client arithmetic provides form feedback; persisted totals are the
server's result. The complete plan must balance to the cent.

Approval names the displayed budget version ID and its expected version, with
`approvalSource: user_instruction` for the owner or `agent_self_approval` for an execution agent under enabled review bypass, and an idempotency key. A changed version,
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

Overview links to the canonical shared Reviews destination using the Finance decision summary;
it does not reproduce the outstanding queue. The review surface retains open and deferred cases
with their merchant, transaction date, account, amount, direction, posting state, and reason.
Questions, approvals and cases remain distinct decision types. Amounts from distinct review
reasons are not summed into a synthetic financial loss.

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

October 18 target revision: introduce an explicit, resumable setup flow gating the normal Finance
workspace, covering connected accounts/Plaid, financial context, and recommended automation setup.
Design §§2 and 13 define completion, manual-later paths, and preserved access for existing users.
Setup may finish with automation verification pending. Show automation-dependent destinations such
as Chat in a locked state until the agent checks in and confirms the required capability; do not
hide them. Lead setup with a copyable one-time external-agent interview prompt using the existing
setup protocol, alongside manual entry of the same canonical profile answers. This interview prompt
is separate from the recurring automation prompt. Manual profile answers are not manual bookkeeping
and remain available regardless of the manual creation setting.
Explicit unknown answers may complete deferrable context questions; agents follow up later. Missing
prerequisites block only the capability that needs them, as defined in design §§2 and 13.
This does not override permitted pending automation verification or locked Chat.
This direction supersedes the independent-access target below where it conflicts; the following
configuration behavior remains the pre-redesign contract, not evidence that the new gate is shipped.

Automation setup creates a registration and a reusable template prompt containing its unique ID.
The external agent uses that ID for Finance maintenance/run attribution under its existing
authenticated connection. Save the issued prompt/version and expose it again in automation detail
and edit views. Expected cadence, time, and timezone are editable tracking metadata; they do not
change external schedules. List registrations, support editing/removal, and expose missed-run/stale
attention based on expected versus observed runs. Registration time alone establishes no cadence.
The recorded prompt is what nohmi supplied, not proof of the external host's current instructions.
Use shadcn chat patterns. Detect recurring external maintenance, obtain agent confirmation of
schedule and answer-consumption capability, then register it before enabling automated-mode chat.

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

### Accepted direction: comprehensive automation

Finance setup leads with one comprehensive automation, with customization inside it. People should
not need separate automations for transaction cleanup, budget monitoring, and periodic reviews.
The agent handles as much as available evidence and granted authority allow, consulting relevant
context before asking questions that require human input. This is a target UX direction; it does
not expand financial action authority or remove support for multiple external schedules. Exact
defaults and action boundaries remain in the Finance experience discussion.

### Accepted direction: approvals and Finance activity

Persisted review bypass supplies standing approval for all Finance application approval gates,
including budget activation, category allocations, maintenance budgets, and planning confirmations.
With bypass off, exact changes retain their owner review boundary. Agents require the applicable
write/execute scopes and keep their actual approval identity; bypass never replaces evidence,
ownership, source revisions, credential checks, or provider consent. This policy supersedes the
October 18 budget-specific human approval exception.

Finance Activity exposes canonical human decisions and validated committed candidate-effect
receipts, with links to supporting messages, audit evidence, and affected records. Proposed,
failed, or no-change actions are not presented as completed financial effects. Routine actions may
group by one run and action family; budget decisions remain individually inspectable with their
actual approval provenance, including bypassed agent execution. Coverage is partial: historical actions without the required receipt
are not inferred from conversation text. The [conversation contract](../../engineering/finance-conversation.md#activity-financial-scope)
defines the implemented evidence boundary; design §8 retains the broader target.

### Accepted direction: asynchronous question chat

The Chat sidebar item shows an unread-message count and a needs-attention indicator for unread
messages. Persist user and agent receipt/acknowledgment separately; fetching a message is not proof
of a reply or completed bookkeeping. Missed expected runs promptly surface needs-attention on the
Automations destination and a recovery path. Schedule health and message receipts remain separate.

Present outstanding questions as casual agent conversations, with transaction context and natural
language answers. A registered Finance automation establishes the automated-mode default for manual
controls. Show Chat locked while verification is pending; enable it after a check-in confirms the
required capability. Show expected next-run timing near the composer;
label inferred timing as estimated and never equate a scheduled start with a guaranteed reply.
Messages must persist for consumption and response by the authorized automation. Corrections and
existing question-answering remain available without chat. Explore automatic recognition of regular
external maintenance runs using the accepted thresholds and authenticated confirmation in design §6.
The capability handshake in design §13 is implemented and required before Chat unlocks.
The [conversation contract](../../engineering/finance-conversation.md) defines fixed-batch delivery,
separate receipts, and current authority checks. This merged implementation does not establish
that an external host is configured, verified, or successfully running maintenance for a person.

### Accepted direction: manual control visibility

Once Finance automation is set up, manual transaction and manual account creation controls default
to hidden. A Finance setting lets the person show or hide these controls; the capabilities remain
supported. Corrections to existing records and answering questions always remain available.
The implemented Auto preference shows manual tools until an agent is registered; explicit Show
and Hide preferences override that display default. Account linking and corrections remain available.
Registration is a display input, not proof of Chat capability or successful maintenance. Design §§3
and 8 retain the accepted setup and recovery direction.

**See whether my Finance context is ready for a scoped agent and understand
which decisions still require me.**

Compatibility domain guidance belongs in Finance settings. The canonical
financial profile is editable through both Settings and Financial setup. Shared Connected agents and Workspace access continue to own connection
and authorization; Finance routes there without duplicating those controls.

Finance settings provides the canonical financial profile and planning preferences, plus
separate payroll details. The **Let agents apply confident Finance changes** switch
is off by default and remains a signed-in-user control. When enabled it supplies standing approval
for all Finance application actions, including changes to the active budget. Enabling it does not turn uncertainty into permission; questions and ambiguous
activity still come to Review.

## Content contract

- The overview distinguishes current balances and posted activity from
  forecasts or pending transactions.
- Review work opens in the [shared workspace Reviews flow](reviews.md) from the Finance
  attention alert, Finance Settings header, or workspace search. The flow retains Finance-owned decisions and
  authorization; Finance Views and Today do not advertise separate review pages.
- Canonical Review leads with its current bounded question. Older maintenance
  approvals disclose their individual prepared changes inside the labelled
  compatibility queue.
- Cash flow Outlook presents Upcoming money as a shared agenda or calendar. Human-confirmed,
  versioned schedules supply durable occurrence identities and explicit expected, matched and
  remaining amounts. Unconfirmed sources retain only their next expected date; they never expand
  recurrence. A confirmed schedule with no occurrence in the selected range does not invent one.
  Occurrence dates use each source's stated timezone; today uses the owner's planning timezone.
  Undated sources remain visible. Range, presentation and account selection are URL-backed;
  omitted account scope includes unassigned sources, while an explicit empty selection includes none.
- Schedule statements bind the current source revision and immutable predecessor. Receipt inspection
  supports explicit partial matches and full reversal against current canonical transaction facts.
  Earlier schedule history stays inspectable. Actual payments, expected residuals and recorded match
  times remain distinct. Source links open the exact Income or Bills & subscriptions record.
- Payday projections require a selected confirmed income schedule and qualified balance statements.
  Each statement names current or available balance, validity, optional floor and explicit inclusion
  of every known movement from a dedicated complete history read. Incomplete, stale or ambiguous
  evidence leaves the projection unavailable. Estimates are end-of-day values, not intraday minima.
  Currency never falls back to USD and unknown floors are distinct from zero.
- Occurrence lists and calendar-day details are bounded and paginated without dropping counts or
  access to later items. Authoritative access denial hides cached private evidence and dismisses
  statements; changing owners remounts facts and drafts together. A transient read failure keeps
  existing context with an honest retry state. These are implementation contracts; database,
  browser and integrated acceptance evidence is recorded separately from production claims.
- Scenario comparisons are explicit hypothetical inputs and never change a saved plan.
- Cash flow reimbursement journeys keep the original expense, active allocation, expectation,
  received cash and remaining claim distinct. Human corrections revise the existing claim;
  receipt removal retains immutable audit evidence and releases actual credit capacity. Unknown
  retries retain the exact request and key. A correction denied with 401/403 hides the entire
  cached reimbursement list and dismisses dialogs; transient failures retain context.
- Personal cost to date subtracts received reimbursements only. It is shown only for a posted,
  fully allocated expense with complete owned-source, receipt, currency and capacity evidence.
  Pending, shared or ambiguous evidence remains unavailable. The result covers the whole expense,
  can repeat across its claim cards and must never be added across those cards. Original outlay,
  expectation and received amounts remain separately labelled.
- Match and balance confirmations bind both transaction content and reimbursement relationship
  generations. Match, unmatch and rematch cannot revive old evidence. Legacy statements without a
  relationship generation remain unknown until reviewed again.
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
- Ordinary agent saves leave a compatibility domain-guidance profile as a draft.
  Explicit agent activation requires `finances:write`, `finances:execute`, owner-enabled
  review bypass, the exact profile version, and at least one owned account source. Its
  approval snapshot records agent provenance (`agent_self_approval`). The signed-in
  activation control appears only for a draft and stays disabled until the draft contains
  at least one owned account source; activation submits the exact profile version.

## Finance review history

Finance review history is a read-only disclosure in the shared Finance Reviews flow, including
when no Inbox work remains or an exact decision link is unavailable. It loads owned
open, deferred, and resolved cases in bounded pages ordered by first-seen time and stable ID.
Opening one row retrieves that exact case and shows its status, source evidence, and recorded
outcome, including the action, answer, rationale, classification or relationship details, and
transaction destinations when present. Automated consolidation and maintenance dismissal have a
rationale without a human answer; their reason remains visible. An unavailable exact case stays
unavailable; the UI does not substitute another review or imply that a saved note completed
bookkeeping.
History loading and exact-read failures retain a retry action beside the affected material.
Failure to load current review work does not hide independently available history.

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

Accounts use compact full-width records with type icons, institution/type below the title, end-aligned balances, and a shared Popover for source details and edit/transaction actions. Debt uses destructive text and an Amount owed label. Wealth presents current metrics in responsive shared KPI cards and links to Accounts rather than repeating its records. Historical charts are deferred until reliable balance history is available.

Accounts, Budget buckets, and Financial goals expose their management actions in the shared workspace header. The transaction-only Add menu lives at the end of the header; other Finance pages have no
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

Split allocations use the card surface inside the background-toned dialog so each allocation is distinct. The Transactions Add menu can save a reusable category without creating a transaction; the authenticated endpoint enforces current execution policy, validates the name, scopes storage to the owner, and records an audit event.

KPI amounts use compact currency notation (for example, $23.6k), with exact values available on hover and to assistive technology. Overview labels monthly spending **Spent this month**, explicitly described as posted personal expenses with no pending transactions or transfers, and links to Spending for the current month with pending excluded. Compact Overview metrics link Cash to Accounts and Net worth to Wealth; smaller icons and values keep context close to each total. Their descriptions state recorded planning-account balances and ownership share, or posted personal expenses excluding pending/transfers. Adjacent context explains that Spending can differ through date/account filters, pending inclusion, and refund adjustments. Four-metric sets use four columns when space permits and otherwise a balanced 2×2 grid, never three plus one.

Transaction cards place the large signed amount at the inline end, with matching status and category badges inline beside the small date below the merchant. A compact merchant icon spans the title and metadata rows. The Tasks-standard Display menu offers grouping by date, category, merchant, direction, or posting state in card view only; group/view choices preserve filters in the URL and save to Finance workspace settings using revision-checked writes, as in Tasks. Opening Transactions without explicit URL choices restores these defaults; explicit links override them without resaving. Table view retains the saved card grouping without applying it. Grouping applies to the loaded page and is explicitly labelled when pagination is present.

Transaction cards and table rows open details in the shared responsive dialog/drawer on activation; they never expand inline or include a Details button. Right-click/long-press exposes Split purchase, Add/Edit context, and Categorize/Recategorize. The same commands remain in details for touch and keyboard access. Context notes preserve the observed transaction version when saved and retain drafts after failures. Table view ignores retained card-group parameters and uses a dedicated posted/pending icon column with accessible labels and explanatory tooltips.

### Saved account selections

Spending, cash, and investment account selections persist as account-owned workspace preferences.
The account selector distinguishes selecting no accounts from following all eligible accounts;
“Use all eligible accounts” restores the latter. Save errors remain visible and do not claim a
persisted change. These view preferences never modify planning inclusion or account meanings.
Finance notification settings show inherited/effective policy and support resetting an existing
workspace override to global preferences using its current revision.

## Manual account currency

Manual account creation accepts an optional explicit three-letter uppercase currency code.
The field starts blank: omitted or blank currency remains unknown (`null`), never a guessed USD.
The canonical account writer stores the stated code and includes it in the creation audit and
readback. The balance input displays the selected currency only after a valid code is present.
Existing account presentation uses its source currency; unknown currency and unsupported accounting
scope remain unavailable rather than becoming USD. This does not add conversion or qualify a
non-USD source for USD-only planning.

The existing account-update contract has no currency correction field. Correcting a previously
created account's currency requires a separately reviewed canonical update contract; this creation
change does not reinterpret historical accounts or transactions.

The manual account form uses the same Sonner identifier from loading through the confirmed
creation result or error. Field corrections stay with their controls; action-result notifications
are not duplicated inline. This repairs the form's inherited feedback behavior while extending
currency capture; it is not a currency regression.
### Forecast explanation hierarchy

Cash flow leads with the useful result and keeps its limits visible. A qualified payday cycle shows
its estimated ending balance with currency and as-of context, expected income, and the warning that
this is not a safe-to-spend amount. Daily movements, opening and lowest balances, balance evidence,
and intraday assumptions remain in labelled disclosures. Expected income is not a confirmed receipt.
Schedule details retain the record's timezone and observed provenance; planning-date metadata uses
the person's planning timezone rather than silently substituting the schedule's timezone.

Recurring costs show the currency-separated eligible monthly subset before individual sources.
Annual equivalents, calculation assumptions, and source dates are disclosed on demand; exclusion
and stale-evidence reasons stay visible. Reimbursements keep received amounts, expected remainder,
and pending-credit status visible while explaining the original expense and personal-cost basis
under Expense basis. Receipts and corrections remain inspectable.

Goal comparisons appear before their input form and receive keyboard focus after an explicit
comparison. Hypothetical, not-saved, and zero-growth limits stay visible; dates, anchors and horizon
assumptions use a disclosure. Saved progress retains its exact goal version and evidence. Goal
input errors use Sonner once, while static amount-format guidance stays beside the field. These
presentation choices do not alter formulas, financial records, source qualification, or confirmation under the current review policy.

### Recurring cost comparison

Bills & subscriptions compares each original recurring source with its expected amount, cadence,
source status, source-account currency and observation date. Matching merchants remain separate
records. Savings movements stay outside recurring-cost comparisons and retain their management
controls. Each payment retains its existing exact-record pause, confirm or resume action.

Monthly and annual equivalents require a demonstrated fixed amount and supported currency units.
Legacy recurring records do not establish fixedness. Confirm cost records a person's fixed/variable
statement, currency and as-of date against the exact current obligation revision, amount, cadence
and account. Only applicable owner-scoped evidence qualifies a fixed equivalent; stale, variable,
unknown-currency and unsupported-unit records remain excluded with an explicit reason. Annual
factors are 52/26/24/12/4/1; monthly equivalents show their rounding assumption. Currency-separated
confirmed and suspected totals describe only their disclosed eligible subset. Missing currency
never becomes USD. Service identity and price history remain unknown; merchant names prove neither.

### Goal progress and hypothetical scenarios

Wealth distinguishes legacy progress from a person's confirmed progress, including an explicitly
confirmed zero. Confirmation records currency and as-of date against the current goal version;
a changed version requires reconfirmation before precise saved-goal projections. Owner identity
and planning timezone come from the authenticated read. Authoritative access denials hide cached
private cost/goal evidence and dismiss its confirmation state; transient read failures retain data.

The saved-goal explorer and separate session-only hypothetical explorer compare a baseline with up
to three alternatives, anchored monthly contributions and zero assumed growth. Curves are bounded
at 1,200 periods and paginated. Achieved goals, nonpositive contributions, missing evidence and
beyond-horizon estimates stay explicit. Exploring changes never saves a budget or actual progress.
Confirmation writes retain their exact request/key on uncertain results, refresh canonical reads,
and use Sonner for loading and outcomes; field correction guidance stays beside the relevant input.

### Consistent planning controls

Budget places category management in the shared workspace header and uses shared Cards for
its monthly totals, resources and allocations. Assumptions and rationale use the shared Finance
disclosure; revising and approving a version keep their existing explicit authority and recovery.
Cash flow and Spending place view, period and scope controls in the shared workspace header. Timeline options
open a bounded settings-row dialog for dates and account scope; account menus retain checked
multi-selection and an explicit empty selection. Reset clears only timeline parameters. Schedule,
date-scope and payday evidence use consistent labelled disclosures, and the payday income selector
uses the shared checked/searchable Settings control. Selection never certifies a schedule or balance.
Wealth leads with the shared metrics and goal rows before supporting position evidence. Show goal
progress only when current applicable confirmation evidence and a positive target support it.
Keep progress confirmation and exploration direct; place pause/resume, completion and removal in
the goal's contextual menu. Completion/removal retain their confirmation dialogs. Goal editing uses
shared Settings rows and checked priority choices without changing save, version or error behavior.

Account rows align institution and account identity at the start, with type and recorded current balance at the end. Institution and type sit below the name. A shared Popover behind the account options button contains ownership, source observation details and edit/transaction actions. Debt uses destructive text and an Amount owed label; attention and recovery actions stay visible. Cash flow occurrences use distinct shared card surfaces, end-aligned expected amounts, and explicit money-in/money-out labels.

The shared top navigation starts with the current Finance page name on desktop and mobile. The root Finance route is labelled Overview; page controls follow this identity.

Spending keeps its route utilities on the primary navigation baseline. The small muted range label directly beside the page title is the date picker (for example, “this month”, a historical month, single date, or formatted range). Its popover contains period navigation and custom date fields at every viewport size. Other controls align at the end of the primary row; the view picker is an accessible icon button. At phone widths, grouping moves into Spending options while date selection remains beside the title.


Spending summary uses compact Cards for selected-scope spending, recorded daily average,
and the largest positive spending group. The average divides recorded spending through today
by elapsed calendar days in the selection (including zero-spend days), never future days;
future-only selections show no average. The largest group opens its existing drill-down.
The Total spending card opens a standard dialog with a daily net-spending chart, posted/pending
split, group breakdown, and progressively disclosed coverage/accounting details. No asterisk
or separate About button is shown. Daily average says Through today for a range containing today;
historical ranges retain elapsed-day context. Card fills show whole-month observed usage over
qualified monthly budgets for the displayed groups and budget accounts, independent of the selected
range. Total and average share total usage; Top group uses its own budget. Count parent groups
only, include unbudgeted usage in the numerator, clamp visual fills at 100% while retaining the
actual percentage, and omit fills when no positive qualified budget exists.
Summary titles and footer rows stay compact and single-line.
View selection pairs Bubbles, List, Trends, and Rhythm with bubble, list, line-chart,
and calendar-grid glyphs consistently in the trigger and menu.


Spending summary amounts roll their digits in the direction of value changes, and budget fills
transition smoothly between widths. Preserve the prior same-owner query result during ordinary
scope refreshes, with the page marked busy; recovered references continue to require a fresh read.
Reduced-motion preferences suppress digit and fill animations. The total footer is budget amount
· usage percentage; daily average includes its elapsed day count and Through today when applicable.


List is the default Spending view for new or unset preferences; saved explicit view choices and
URL overrides remain authoritative. List uses a single shared Card with compact Item rows, selected-
range amounts, category-colored full-row monthly-budget fills and concise remaining/over amounts. Preserve
exact monthly usage/coverage in accessible descriptions and hover details. Show pending amounts
only when nonzero. Bucket categories remain progressively disclosed. Missing/zero limits, negative
adjustments and budget sorting retain their distinct accounting meanings.


The title range picker opens presets, the range calendar, and date inputs directly; no nested
Period menu is needed. Calendar ranges accept either click direction and single-day selections.
Spending List rows use the same category/bucket tint as Bubbles, with a KPI-style background fill
for monthly usage instead of a separate thin bar. Remove decorative row dividers and bubble
borders; over-budget copy remains explicit. Keep base and budget fill clean, clipped inside the original circular silhouette.

Category/bucket glyphs are inferred by the shared domain appearance resolver from their meaning
(home, groceries, dining, travel, and so on), with safe generic fallbacks. API Spending metadata,
List, Bubbles, legends, and detail headings use that vocabulary and the shared reicon registry.
This applies automatically to existing records and every creation path, including MCP. Agents
must not ask users to select cosmetic icons or narrate these automatic choices unless requested.


Spending List is a sequence of standalone colored card rows, without a shared table surface or
column headings. Show the group title and “z% ($used) of $budget used, $remaining left” beneath it;
put the selected-period amount prominently at the end. Use “over” for negative remaining amounts;
zero and missing budgets keep explicit bounded states. Omit row-level pending notices because
pending inclusion is controlled in the filter. Preserve sorting in the Breakdown icon menu and
progressive category disclosure. Background fills continue to represent monthly budget usage.

Spending list glyphs sit in padded square frames with a subtle contrasting surface.

The Trends focus picker uses the same quiet muted value treatment as the date range. Its all-option
follows the effective grouping (All buckets or All categories), and its catalog retains the full
unfiltered group choices after selection. Today uses a 24-hour local-time Rhythm grid. Only source
purchase timestamps establish an hour; date-only transactions remain in Time not provided, never
midnight or the record-update hour. The current transaction source supplies dates only. Hourly zero
requires complete evidence and no untimed contributions; future and unknown hours remain distinct.
