# Finance experience design

Status: complete design for review; not implemented. October 18, 2026.

Subsequent approval: Cooper explicitly approved the missed-run grace period, repeated-run candidate
threshold, and session-only bubble-position persistence documented below.

This consolidates Cooper's decisions in [discussion notes](../../product/finance-experience-discussion.md).
The explicit defaults below resolve remaining implementation choices; they are reviewable design
choices, not claims that Cooper individually selected every threshold. This document supersedes
conflicting earlier Finance UX targets for setup gates, budget self-approval, chat visibility, and
spending presentation. Existing implementation remains the authority for shipped behavior.

## 1. Outcome and scope

This design implements the canonical [Finance intelligence and visual exploration principles](../../product/finance-workspace-plan.md#finance-intelligence-and-visual-exploration): automated maintenance turns authorized context into visual understanding, explanatory analysis, transparent forecasts, and hypothetical choices. Every view must name the user understanding it serves, its evidence needs, and its correction path. Extra data collection is purpose-bound and optional unless necessary for the requested capability.

Finances is designed for automated maintenance with an agent. People inspect spending, answer
irreducible questions, approve financial plans, and understand what changed. Manual mode remains
supported with usable equivalents for user-facing agent actions. Do not advertise speculative bugs
or imply that manual users may be given unreliable bookkeeping.

Add Spending, Chat, Automations, and Activity as Finance sidebar destinations. Preserve Overview,
Transactions, Accounts, Budget, Cash flow, Wealth, existing review links, and Financial profile.
Spending does not replace Overview. Keep existing records and deep links. No money movement,
bill payment, trading, new notification system, or always-on first-party model runtime is introduced.
Chat initially serves questions, financial context, and follow-through; general advisory chat is
not a separate launch requirement.

## 2. Setup and prerequisites

New users enter a resumable setup gate before ordinary Finance routes. The gate is a UI readiness
boundary, not permission to block the API/MCP operations that complete setup. Preserve the requested
route and return to it afterward. Setup, agent connection settings, Plaid callbacks, account repair,
and required approval destinations remain reachable inside the setup journey.

Start with two choices: **Set up with your agent** (recommended) and **Enter information yourself**.
The first provides a one-time copyable prompt telling a connected agent to read the Finance playbook,
inspect current state, use `setup_finances`, save answers, and propose rather than approve a budget.
This prompt is separate from the recurring automation prompt. Both paths use the same canonical
profile and progress; switching paths or refreshing loses no saved answers.

Stages: sources and ownership; financial context; display preferences; automation or explicit later
choice; summary and finish. Stages can resume and reuse known information. Finishing requires:

- At least one user-owned, non-disconnected source with explicit inclusion and personal/shared meaning.
  Plaid is recommended; manual mode may create a manual account or import into an owned account.
  Confirm the user's share for a shared account or explicitly exclude it from personal spending.
- Review of essential context questions, accepting answers, explicit none, or explicit unknown.
  Unknown is not zero. Income, obligations, debt minimums, reserves, household, goals, and location
  do not block spending inspection. Missing evidence blocks only the planning result that needs it.
- Review of display defaults and an explicit automation choice. For automation now, require the
  authorized Finance connection, registration, and expected cadence; first verification may wait.
  For later, finish in manual mode with Chat visible and locked.

A fresh Plaid source still syncing may finish setup: show loading/freshness, not zero spending.
A failed account connection without any usable source remains a setup prerequisite. A budget is not
required to finish. Activating any budget requires a complete valid proposal and exact human approval.

Existing users receive a prefilled completion review, not a new interview. Backfill readiness from
verifiable source/profile state, preserve explicit unknowns, and ask only for missing requirements
or the automation/later choice. Do not auto-enroll users into new agent authority. Once completed,
later connector failure or deleted sources produce local recovery, not a workspace-wide re-lock.

## 3. Mode and preferences

Persist account-owned Finance preferences with existing revision/conflict behavior:

| Preference | Default |
| --- | --- |
| Spending grouping | Auto: buckets when configured, otherwise categories |
| Include pending | On |
| Include uncategorized | On |
| Spending basis | Personal cost; optional full outflow |
| Subtract matched refunds | On |
| Include transfers | Off; optional outflow context only |
| Manual creation controls | Auto: visible in manual mode; hidden after automation registration |
| Opening period | This month; remember selected period kind, not stale calendar dates |

Explicit grouping choices override Auto and are remembered. If the selected bucket grouping becomes
unavailable, fall back to categories and explain it without erasing the preference. Setup checkboxes,
view controls, Finance settings, and agent-led setup save through one preference API. URL deep links
override saved display choices without silently overwriting them.

Manual visibility supports Auto/Show/Hide. Auto is based on registration, not every missed run;
automation failure never makes creation buttons flicker back. If all registrations are removed,
Auto returns to visible. Manual creation means transactions, disconnected account entry, and imports.
Corrections, category/bucket management, questions, plan edits/proposals, and human approvals remain
available in either mode. Explicit Show/Hide survives mode changes.

## 4. Spending data and historical budgets

Spending has equal, discoverable Bubbles and List view options in the initial delivery. Remember the
chosen presentation independently of bucket/category grouping. Both use exactly the same period,
scope, accounting settings, totals, monthly comparison, and drill-down links. List is a first-class
precise comparison view, not only an accessibility fallback: sortable name/spent/budget-used columns,
exact amounts, pending breakdown, explicit no-budget state, and bucket expansion into categories.
On narrow screens render readable labeled rows instead of forcing a wide table. Trends is a third approved Spending presentation, specified below.

One API-owned aggregate powers bubbles, accessible list, totals, and transaction drill-down. Never
aggregate only a loaded transaction page. Use exact cents, canonical recognition/allocation helpers,
ownership shares, split allocations, and pending-replacement identities. Exclude tombstoned/duplicate
records. Filters apply consistently to totals and drill-down destinations.

Personal cost deducts explicitly recorded reimbursable portions, labeling amounts still owed;
expected reimbursement is not a received credit. Full outflow shows the purchase outflow, without
subtracting expected reimbursement. Received reimbursements must not be deducted a second time from
personal cost. Matched refunds reduce the supported expense amount once under canonical recognition
rules; unclassified credits are not guessed to be refunds. Expose gross, adjustments, and net amounts
in detail. Transfers, debt principal, savings contributions, and income are not ordinary spending.
An optional transfer display is a separate outflow group, with no budget fill and an explicit total
label; it never changes the canonical budget-consumption numerator.

Include pending by default but distinguish provisional amounts in details and totals. The fill uses
the same pending/personal-cost/refund settings where applicable, for the entire budget month, labeled
**Monthly budget used · includes pending** when enabled. Hiding uncategorized creates an explicit
excluded-amount disclosure. A single visible category filter does not reduce the budget numerator
for the remaining category. Unsupported currencies appear separately and never silently sum as USD;
initial budget comparison follows the existing US/USD plan scope, with no invented exchange rates.

Periods: Today, This week, This month, Custom; previous/next navigation for named periods. Use the
saved user timezone and locale week start. Treat provider date-only transactions as local calendar dates, never fabricated UTC-midnight
instants. Use half-open UTC boundaries only for genuinely timestamped events. Default to This month. A single-month slice uses that month's whole-month usage for
fill, even if bubble size represents only one day. Label both scopes; historical future dates have
only available recorded evidence and no fabricated forecast.

For month M, resolve the latest human-approved budget version whose effective month equals M, excluding proposals; do not carry a prior month forward implicitly,
and disclose version/approval date. Historical display means the latest approved plan for that month,
not a reconstruction of what the user knew on each day. Keep the original monthly baseline inspectable
in detail; do not rewrite it. If legacy data cannot establish human approval or applicable month,
withhold fill and explain why. A selection spanning months has no fill. No applicable budget means
no fill, not a zero limit. Bucket grouping remains available in both cases.

A bucket limit is its distinct spending allocations, never a sum of both bucket and child allocations.
Exclude savings/debt/goal allocations. Where coverage or historical membership is ambiguous, withhold
the aggregate bucket fill and expose covered category details. Zero limit with positive spending means
overspent, with no infinite percentage; zero limit and zero spend means no utilization. Negative net
spending and zero-spend groups remain in the equivalent list/detail, not negative or invented bubble
areas. Initial chart uses current grouping membership and labels this in historical detail; historical
budget allocation identities must still resolve or comparison is withheld.

## 5. Elastic bubble interaction

Bubble area represents positive selected-period spending. Scale the whole layout uniformly to fit;
do not inflate tiny bubbles and claim proportionality. Provide an always-available equivalent list
with names, exact amounts, budget status, and actions. Very small bubbles use pointer/focus detail and
list access instead of unreadable embedded controls. No spending has a meaningful empty state.

Use assigned category/bucket color and registry icon, with a subtle base tint and translucent tonal
fill rising from bottom to top. Fill percentage is circle area, calculated from the circular segment,
clamped at 100%; it is not a simple height percentage. Foreground text and controls remain legible.
Overspending uses a contrasting warning outline and exact overage text in detail (and inside when
space permits). Exactly 100% has no overspending warning. No pulsing or continuous decorative waves.
Fill and period transitions settle within 350 ms; reduced motion removes springs and liquid transitions.

A deterministic collision layout attracts bubbles gently toward the center. Drag changes their local
resting position; release keeps approximate placement while resolving collisions and avoiding stranded
bubbles. Stop simulation when settled or off-screen. Store normalized positions per grouping within
the current page session, including when returning from detail; do not promise permanent geometry
across devices. Preserve relative positions across periods where nodes survive. Provide Reset layout.

A click on a bucket opens categories with a breadcrumb and View transactions action. A category click
opens its transactions. Both preserve range, basis, pending/refund filters, and account scope. Drag
begins after 6 CSS pixels of pointer movement; release after dragging never navigates. Touch uses an
explicit Arrange toggle to allow dragging without trapping ordinary vertical page scroll. Keyboard
users can select/drill down via semantic buttons and use the equivalent list; arranging is optional
and never required to access financial content. Avoid nested buttons inside bubble buttons.

## 6. Registered automation lifecycle

Reuse the existing host schedule registry and authenticated connection binding. One comprehensive
Finance maintenance automation is recommended; multiple registrations remain supported. Each has
stable ID, label, connection, expected cadence/time/timezone, issued prompt version/text, verification,
last start, last successful completion, next expectation, and active/paused/removed state.

The prompt is a template with the internal schedule ID injected for every automation, always.
Creating, editing, and recopying an automation must preserve the correct ID in its generated prompt;
it is never an optional token or a new authentication credential. An optional separate copy-ID button
is convenience only. The one-time profile interview prompt remains separate. It directs the agent to authenticate with
its bound connection, report the real host schedule when available, fetch all pages of messages and
continuations, maintain finances using the ID, and persist outcomes/replies with evidence. Explicitly
forbid budget self-approval. IDs confer no authorization. Store what nohmi issued, not a claim that the
host has unchanged instructions. Recopy from details/edit at any time; template updates are versioned.

Creation registers expected scheduling; it does not create or edit the external job. Offer daily at
09:00 in the user's timezone as an editable setup suggestion, never an already scheduled promise.
Support daily, selected weekdays, weekly, and existing interval/event host contracts. Event-only hosts
have no invented next-run countdown. Editing local cadence warns that the external schedule must be
changed separately. Removal disables future local dispatch/acceptance under that ID and retains history;
explain that the external job must be removed separately. Existing active work settles or cancels through
existing durable lifecycle rules, never by erasing records.

A verified check-in proves the bound authorized agent can fetch and respond to saved messages under
the protocol. It does not prove successful finance maintenance. Chat unlocks on this capability check;
show last successful maintenance separately. Derive overdue after the expected start plus a grace
period: min(60 minutes, max(5 minutes, 10% of recurrence interval)); daily/weekly therefore use 60 minutes.
Notify once per overdue episode through existing preferences and immediately update Automations
attention when observed. Use durable existing background scheduling/notification mechanisms, not a
browser-only timer. Resume clears overdue based on observed evidence, not visiting the page.
Timezone changes recompute future slots; spring-forward uses next valid local instant, fall-back one
slot at the first matching instant. A started run can still fail; execution health remains separate.

Passive recognition inspects authenticated root maintenance starts, excluding retries/resumes. A
candidate requires at least four starts with three matching daily/weekly local-time intervals within
30 minutes, same owner/connection/intent, and no existing matching registration. The candidate is not
active automation and grants nothing. On the next eligible agent invocation, request confirmation of
schedule and message capability. Register only after an authenticated confirmation under existing
user-granted Finance scope; deduplicate against manual registration. Other patterns use explicit setup.
Use estimated labels unless host schedule evidence is available. False candidates can be dismissed.

## 7. Conversation, receipts, and cases

One Finance conversation per owner, rendered with shadcn message/composer patterns adapted to the
existing React stack and icon registry. Do not adopt a synchronous model backend merely for the UI.
Show questions with linked transactions/budgets and accept natural language replies across messages.
The agent first uses authorized evidence and previous answers; it asks only irreducible questions.
A message alone cannot activate a reusable rule or approve an unspecified budget revision.

Messages are durably appended with idempotency keys, server sequence, actor/connection, timestamps,
and typed record/case references. No in-place rewriting of evidence: corrections are new messages.
Retain separate user-visible read cursor and per-connection/per-schedule delivered/acknowledged cursors.
After a successful fetch, client acknowledgment marks precisely the delivered message IDs; do not mark
unreturned pages read. UI says Seen by agent for acknowledgment, not for guessed schedule execution.
User unread counts include new agent replies/questions, not their own outgoing messages; mark read
when rendered in the visible conversation, not merely prefetched. Cross-device read cursors are monotonic.

Sidebar Chat remains visible and locked before verification or in manual mode. Preserve existing
history when automation is removed/revoked. When a verified active automation is merely overdue,
accept durable messages with an explicit unknown-response-time notice; do not mark them seen. When
all capable registrations are paused/revoked/removed, preserve history but disable new chat sending
and keep ordinary question answering/corrections available.

Composer timing describes expected next run, never guaranteed reply: reported schedule or labeled
estimate, current running state, overdue, or unknown. This is persistent scheduling state; action save
failures and discrete feedback use Sonner. No fake typing until actual execution is observed. No
assumption that sending triggers an immediate run. Existing answer continuation behavior must be
reconciled so this chat path queues for next run and does not accidentally invoke a second job.

For multiple schedules, use the earliest-next verified eligible schedule by default, then stable ID
as tie-breaker; event-only candidates follow those with known slots. Persist the selection and claim
messages/cases under the durable maintenance lease. A paused/revoked target can reassign unclaimed
work to another eligible registration; claimed work resumes by run ID and never duplicates effects.

Use existing case/question identities when available, with a conversation-case envelope only for
user-initiated context not yet attached to a case. Links are many-to-many: question message, all answer
messages, specific supporting excerpts, affected records, run, action, audit event, and approval evidence.
Activity must show the original messages in context plus the agent's concise decision explanation.
Store excerpt offsets plus immutable message revision/hash; excerpts cannot replace source messages.
Three transactions answered across two user replies retain the question and both replies under one
case; individual changes can cite the appropriate excerpt. Partial/failed actions remain explicit;
case resolution occurs only after required actions succeed, not after messages are fetched.

Owner isolation applies at every read, reference validation, cursor, notification, and mutation. Do not
return another connection's private credentials or unrelated workspace context. Retention follows
existing owner deletion/privacy policy; audit history is not permission to retain deleted personal data.

## 8. Activity, authority, and manual parity

Activity is a paginated Finance-only projection of authoritative audit/change records. Routine
bookkeeping groups by maintenance run and action family, with expandable individual changes;
significant budget decisions get individual entries. Show actor, human approver where applicable,
time, status, exact before/after change, reason, record links, and supporting messages. Separate
proposed, approved, applied, failed, and partial outcomes. Never fabricate missing historical excerpts.
Filter by event type, actor, record, and date. Notifications follow existing preferences, with batching
for routine questions and no new channel grants.

All activation or changes to an active budget require exact human approval. Remove conditional agent
self-approval in domain services, setup protocol, legacy category-plan routes, MCP tool descriptions,
review bypass paths, and any SMS pathway that could impersonate human approval. Agents may create or
revise proposals. Human authentication and bound proposal/profile versions establish approval;
caller-supplied labels, natural-language summaries, and legacy adjustment policies do not. Financial
mutation and required audit evidence commit atomically. Historical approvals keep their truthful actor.

Manual parity is by user outcome, not a UI button for each internal protocol step:

| Agent work | Manual surface and acceptance |
| --- | --- |
| Inspect/sync sources, ownership, inclusion | Accounts, reconnect/sync actions and accurate freshness |
| Classify uncategorized or reviewed transactions | Transactions filters, single/bulk categorization |
| Split a mixed purchase | Exact-cent breakdown with reimbursement treatment |
| Link transfer/refund/reimbursement; repair supported reconciliation | Transaction details and related-record chooser; preserve ambiguity |
| Merchant/category/bucket/rule management | Contextual editors; rules require preview and explicit approval |
| Recurring items, subscriptions, obligations, income | Cash flow and Financial profile editors |
| Goals and scenarios | Wealth and Cash flow; hypothetical results never alter actual records |
| Prepare/revise/approve complete budget | Budget; exact human approval and visible provenance |
| Answer/defer/dismiss/correct reviews | Existing domain review UI plus chat when enabled |
| Inspect history and changes | Activity with record/case/message links |
| Create/import manual records | Contextual controls governed by manual visibility preference |

Inventory every currently registered Finance tool in all Finance tool modules. Each must map to an
existing verified UI flow, a gap fixed in this delivery, or a documented internal-only/non-executable
capability. Do not make unsupported API actions look available. This inventory is an implementation
acceptance artifact, not a claim that the table above already works.

## 9. Architecture and contracts

### Mode behavior matrix

| State | Workspace behavior |
| --- | --- |
| Setup incomplete | Resumable setup gate; keep setup, connection, repair, and approval paths usable |
| Manual / automation later | All financial pages available; Chat visible/locked; Auto manual creation/import visible; prominent uncategorized-review entry and recommended automation setup |
| Registered, verification pending | Financial pages available; Chat visible/locked with verification state; Auto creation/import hidden; explicit Show remains available |
| Verified active automation | Chat enabled; expected next run and unresolved questions clear; creation/import follows preference |
| Verified but overdue | Automations needs attention; pages stay available; durable messages may queue with unknown timing; no automatic creation-control flip |
| All capable automations paused/revoked/disconnected | Chat history readable, sending locked with recovery; corrections and ordinary review answers remain available; no workspace re-lock |
| All registrations removed | Chat history readable/locked; Auto creation/import returns to visible; explicit preference retained |
| Missing financial evidence | Restrict only dependent calculations/actions; do not turn missing forecasts into a disabled Cash flow page |

Connect/reconnect, inspection, corrections, categorization, profile edits, and exact human budget
approval remain available regardless of automation mode. Account connection loss and agent connection
loss are separate conditions. Activity records financial effects; automation run history records
execution health. Chat and Reviews project the same case identities and resolutions. Do not introduce
a second queue or independently counted copy of outstanding work. Any focused input experience must
be another presentation of the canonical Reviews flow, not a new sidebar destination by default.

Domain owns schemas/semantics; API owns aggregation, state, authority, and durable side effects;
MCP is a thin authenticated adapter; the web consumes typed API data. Reuse schedule registry,
profile/budget stores, canonical Inbox, maintenance lifecycle, audit events, and notification policy.
Add scoped modules for spending, onboarding readiness, conversation/evidence, and activity projection.

Proposed shared contracts (names fixed for plan handoff):

- `FinanceSpendingQuery`: from/to local ISO dates, timezone, groupBy, optional bucketId/categoryId,
  accountIds, includePending/includeUncategorized/subtractRefunds/includeTransfers, basis.
- `FinanceSpendingView`: query, currencyGroups, totals/breakdown, nodes, budgetMonth/version/evidence,
  source freshness, exclusions and availability. Monetary values use established exact-money types.
- `FinanceOnboardingState`: revision, completedAt, stages, blockers, automationChoice, chatCapability.
- `FinanceConversationPage`: ordered messages, nextCursor, userReadSequence, agentReceipts, chatCapability.
- `FinanceConversationEvidence`: case reference, message IDs and excerpts, typed record refs,
  run/action/audit IDs, decision explanation, and approval reference when required.
- `FinanceActivityPage`: cursor, entries with grouped child changes and evidence references.

Existing shared schemas remain authoritative for principals, IDs, money, reviews, host schedules, and
results. New tables use owner-bound foreign keys and indexes for owner/sequence, case/action links,
and pending deliveries. Additive migrations preserve existing data; no rewriting published migrations.
New route/tool scopes cannot broaden the current grant just because a message cites a record.

## 10. Verification and rollout

Deliver maximally parallel independently reviewable slices with only actual dependency gates: authority, contracts/storage, spending, automation,
conversation/evidence, activity, setup/manual parity, integration acceptance. User-facing features stay
unexposed until their API and readiness contracts exist. Do not deploy a setup gate ahead of working
manual completion and automation-later paths. No destructive backfill or removal of old records.

Unit tests cover selectors, accounting filters, history, fill math, layout, and health/time semantics.
Database/API tests cover tenancy, idempotency, concurrency, exact approval, durable messages, audit
atomicity, and recovery. UI/E2E tests cover fresh/manual/agent setup, locked chat, bubbles/drill-down,
unread receipts, missed runs, and conversation-to-activity lineage on desktop and mobile.

Use `pnpm verify` before PR publication, subject to repository delivery-verification policy. Required
coverage remains 95% statements/functions/lines and 94% branches. Read relevant architecture,
database, frontend, MCP, testing, connector, and external-boundary guidance during implementation.
Sonner handles action feedback; reicon registry supplies glyphs. Check production-equivalent Plaid
and external-host journeys separately: mocks cannot establish host execution, consent, notification
delivery, or polling reliability. If live evidence is unavailable, report that limitation explicitly.

Success means someone can finish setup manually or with an external agent, inspect accurate spending,
understand monthly fills, answer naturally on the next registered run, and trace every resulting
important action back to the evidence and human approval where required.


## 11. Cash flow timeline and Spending Trends — accepted extension

Cash flow Outlook becomes an upcoming-money timeline, defaulting to Agenda with Calendar available.
Retain Income, Bills & subscriptions, Reimbursements, and Scenarios for underlying record management.
Remember Agenda/Calendar choice. Default to the next 30 days; support range navigation and account
scope. Agenda groups items by date; Calendar shows dated items and an accessible day detail list.
Undated items appear in a separate Date unknown section in either presentation. Selecting an event
opens its existing domain-owned detail/editor, not a copied calendar record.

Compose expected income, obligations/subscriptions, and reimbursements with confirmed/estimated date
and amount labels, account, source, and freshness. A matched actual transaction links to the expected
occurrence and replaces its outstanding projection without double counting. Distinguish overdue,
received/paid, estimated, and canceled occurrences. Unknown amounts never become zero. A missing or
unsupported forecast does not hide known scheduled items. Manual users edit the same underlying
records maintained by agents. Calendar is a Finance view, not a new Calendar-workspace integration.

Credit-card payments are cash movements here, not new spending. Transfers affect individual accounts
but net to zero across both included sides; one-sided scope shows its real movement. Do not subtract
card purchases and their later payment twice from the same projected cash balance. Any projected
balance is labeled Projected balance after known activity, includes its scope/as-of assumptions,
and is withheld where account ownership, balances, or event evidence cannot support it. Never label
this safe-to-spend. Keep uncertain reimbursements distinguishable from confirmed income.

Spending Trends shares the exact accounting preferences, account scope, timezone, and drill-down
semantics of Bubbles/List. Offer spending-over-time bars and a previous-period comparison, with
bucket/category focus and a contribution breakdown explaining the overall difference. Grain defaults:
daily through 31 days, weekly through 180 days, monthly thereafter; expose the selected grain.
Partial bins and the current provisional day are labeled; do not claim time-of-day precision for date-only records. Zero denominators produce dollar changes with percentage unavailable.

Compare complete named weeks/months with the previous equivalent period. For the current incomplete
month/week, compare equal elapsed local calendar days with the preceding equivalent period, capped
at that period's end and labeled when month lengths differ. Custom ranges compare the immediately
preceding equal-length local-date interval. Never compare a partial current month to a full prior
month silently. Flag missing source coverage and pending portions; partial data is not confirmed zero.
Clicking a bar opens its transactions with all filters preserved. No trend forecast or advisory
model is required. Provide an equivalent accessible data table and reduced-motion rendering.

The focused Reviews reply interaction is accepted below. Its non-negotiable boundary is one canonical
case identity, status, and resolution across Reviews and Chat; no independent queue or duplicate count.

Accepted reply interaction: Reply in Chat on a review navigates to the ongoing Finance conversation
and attaches the exact case/question and relevant records to the draft. Show removable context
chips/cards above the composer, with links to inspect the source and clear labels. The user can see
what the draft will reference before sending. Removing a chip detaches draft context only; it does
not dismiss a case, resolve work, or rewrite previous activity evidence. Do not silently persist an
inferred relationship as an explicit user selection. Manual corrections and exact approval actions
can remain in Reviews; conversational answers are composed in Chat.

## 12. Financial exploration views — approved follow-on scope

Cooper approved all five views below as part of the larger delivery, implemented as soon as their
specific prerequisites allow. They are not a prerequisite for shipping the core experience. Add
views within existing destinations, avoiding five additional top-level sidebar items. They share
owner scope, freshness, exact monetary semantics, accessible tabular equivalents, and record links.
Optional context is requested when needed by the feature, reusing canonical profile/knowledge data;
no new mandatory setup fields or speculative sensitive-data collection.

### Spending rhythm — Spending

Add Rhythm alongside Bubbles/List/Trends: a calendar heatmap of daily spending, defaulting to the last
three calendar months including the current partial month. Share spending basis, pending/refund,
account, currency, and category/bucket filters. Color intensity represents the magnitude of positive
spending using a labeled scale; net refund days get a separate labeled treatment rather than a
misleading zero. Missing coverage, future dates, and confirmed zero are distinguishable. Day focus
shows exact amount and breakdown; selection opens matching transactions. Provide keyboard day
navigation and a list alternative. This is descriptive pattern discovery, not a causal explanation
of behavior or an inferred claim about the user's habits.

### Recurring-cost ladder — Cash flow, Bills & subscriptions

Show recurring commitments ranked by monthly equivalent, with a stacked total and annualized view.
Keep original amount/cadence visible. Fixed weekly amounts annualize by 52, biweekly by 26,
semimonthly by 24, monthly by 12, quarterly by 4, yearly by 1; monthly equivalent is annualized/12.
Label these normalization estimates, not actual scheduled totals for a leap year or chosen calendar
period. Irregular or variable commitments show ranges only when supported; otherwise exclude them
from a precise total with a clear coverage count. Separate confirmed from suspected recurring items.
Compare observed price changes only for comparable service/currency/cadence. Link to source charges
and existing recurring-item editors. Do not infer usage, waste, or cancellation from payment data;
changing a local recurring record does not cancel a provider subscription.

### Payday-to-payday — Cash flow

Show a selected reliable income stream's cycle from one payday to the next: received/expected income,
actual cash movements, remaining dated commitments, and projected low balance where evidence permits.
Let the user select a stream when there are several; do not invent one combined payroll cadence.
Variable/unknown next paydays produce a dated-range view with unavailable cycle prediction. Future
income remains expected until matched. Reuse the timeline's account scope, ownership, transfer/card
payment handling, and expected-to-actual deduplication.

Offer an optional user-confirmed protected cash floor and highlight when projected balance after
known activity falls below it. Without a floor, show the projection without implying an agreed safety
threshold. Missing balances or dates withhold precise projections while leaving known movements
inspectable. Annual/irregular expenses can be entered as expected dated obligations in the existing
profile/recurring models, not a separate private forecasting ledger. No safe-to-spend guarantee.

### Reimbursement journey — Cash flow, Reimbursements

Visualize each reimbursement case from original expense to expected recovery, partial receipts,
remaining amount, overdue condition when a due date exists, and settlement. Show gross outlay,
personal cost, reimbursable amount, and received amount distinctly. Multiple expenses/credits may
belong to one case; render exact source links and preserve partial receipts, disputes/corrections,
and historical changes. Unknown recovery date is unknown, not overdue. Expected recovery never
becomes cash until received. Existing manual reconcile controls and agent actions update the same
ledger and case; no new parallel reimbursement identity or second review queue.

### Goal scenarios — Wealth, with links from Cash flow Scenarios

Add an explicit hypothetical view for an existing goal: compare current recorded progress with
alternative regular contributions and an optional target date. A slider and exact amount input
update estimated completion and cumulative contribution curves without saving a budget change.
For the initial model, use zero assumed investment growth/interest and fixed stated contributions,
clearly labeled. Where a dated contribution schedule is known, use it; otherwise label the monthly
assumption. A zero contribution with remaining target has no completion date; an achieved goal is
already achieved; unknown current progress has no precise forecast.

Allow at most three visible alternatives and a baseline to keep comparison understandable. Show
remaining target, contribution assumption, estimated completion, and what would need to change to
reach the selected date. Saving a scenario saves a hypothetical artifact only; Apply means prepare
an exact budget proposal for human approval, never execute funding or update actual goal progress.
Do not reuse simplified debt-payoff arithmetic as an interest-aware promise. Predictions beyond these
transparent assumptions require a separately specified model and evidence.


## 13. Independent plan review refinements

These refinements resolve implementation ambiguity without changing the agreed product direction.

### Spending recognition and budget comparison scope

Compute a shared recognized-contribution snapshot before grouping into days/categories/buckets.
Resolve pending-to-posted replacement using the same snapshot for aggregate, bins, and drill-down;
never call a period-sensitive recognition function once per bin and sum results. Personal-cost view
must explicitly project recorded expected reimbursements, while preserving existing received-only
cash-exposure semantics for other consumers. Test expected, partial, canceled, and refunded claims.

Return selected-account spending and whole-budget-account monthly utilization as separate measures.
An account filter must not make a globally overspent category appear under budget. When account scope
is narrower, label fill Monthly budget used · all budget accounts. Withhold comparison if the approved
budget's account scope cannot be established; do not guess a numerator. All spending-basis preferences
otherwise retain their documented semantics. Expose the positive bubble-area total and net adjustment
explanation when negative groups make the headline net amount differ from summed positive bubbles.

Historical selection uses exact effective month, then latest verified human approval timestamp,
version, and stable ID as deterministic tie-breakers. Preserve original monthly baseline and immutable
allocation references; renamed/deleted current categories do not erase historical evidence. If history
cannot be resolved, no fill rather than invented carry-forward or fabricated approval provenance.

### Timeline occurrences and projection basis

Recurring records currently expose a next date, not a complete occurrence ledger. Add a shared dated
occurrence contract before promising expected-to-actual matching: stable owner/source/schedule-version
identity, original scheduled date, date certainty, matched transaction portions, and cancellation or
supersession history. Monthly recurrence preserves anchor day with month-end clamping; semimonthly
requires two anchor days. Generated dates are estimates unless actually confirmed; never infer holiday
adjustments. Schedule edits cannot rewrite already matched occurrences. Partial/multiple payments
must match allocated portions once, with duplicate refresh idempotency.

A cash projection starts from explicit cash-account balance observations: balance basis (current or
available), as-of timestamp, and which posted/pending movements are already reflected. Do not replay
movements already included in starting balances, or subtract a pending debit again from an available
balance that includes it. Unknown inclusion, missing snapshots, or incompatible ownership withholds
precise projection while preserving events. Credit liabilities are not liquid cash. For same-day events
without known order, use a labeled conservative order (outflows before inflows). A protected cash floor
is scoped to account selection and currency; changing scope does not silently reuse the same floor.

### Recurring, reimbursement, and goal model refinements

Recurring cost currency must resolve from authoritative account/source evidence; unknown currency
stays outside precise totals. Separate savings transfers from actual costs, exclude paused/canceled
items, and keep suspected versus confirmed totals distinct. Price comparison requires service identity,
not only merchant identity. Multiple services at one merchant and missing service identity must not
produce a false price-change claim. Semimonthly support requires the shared cadence extension.

Keep existing allocation-owned reimbursement identities. Build the journey per reimbursement with
multiple matched receipts; related reimbursements may be visually grouped with distinct underlying
case/expense links and reconciled totals. This fulfills the multi-expense view without inventing a
second financial case. Shared credit allocations cannot exceed the credit amount. Add a guarded
correction/unmatch or compensating-history operation for erroneous receipts, preserving previous
matches and audit history. Canceling an expected remainder never erases actual receipts. Any future
true multi-expense single-ledger identity requires an explicit migration, not a UI read-only shortcut.

Legacy goal progress defaults to zero and is not automatically confirmed. Require progress provenance
and as-of confirmation before projecting an unknown legacy zero; preserve confirmed zero as valid.
Goal scenarios store assumptions, source revisions, and first-contribution date. Limit projections to
1,200 monthly periods and return beyond-horizon rather than overflow or invent a completion date.
Recompute against current goal/budget revisions before preparing a proposal from a saved scenario.
Hypothetical viewing may ship before save/proposal handoff; those are separate verified capabilities.

### External-host and conversation contracts

Accepted after explicit discussion: Cooper approved generic-host enrollment, the automatic message
capability test, and guarded interrupted-run recovery. Message timing is also settled: one fixed
batch per run, later messages always follow up.

Add a generic polling-host registration variant alongside existing Codex interval and Claude event
variants. It records expected local cadence independent of actual scheduler authority. First check-in
must prove the registration's original authenticated connection binding; the unique ID is not a secret
or a bearer grant. Preserve existing host semantics and explicit host support/verification evidence.

Chat verification uses a harmless server-issued exchange bound to registration, connection, and
message protocol version: fetch the challenge, acknowledge exactly it, and persist a response.
Self-reported capability alone cannot unlock chat. Keep handshake traffic out of unread conversation
counts and financial Activity. An incompatible protocol upgrade requires new verification without
rewriting old prompts or claiming old jobs adopted them.

Unclaimed message work may reassign under the documented schedule policy. Claimed financial work
freezes on loss of authority; revocation does not permit further effects merely to finish a run.
Use the existing explicit guarded host-recovery operation (extended to supported polling hosts as
needed) with no active lease, expected bindings/revision, live replacement grant, and audited host
confirmation. Never silently resume a run under a different connection. Recovery after a committed
effect but before its reply must verify the recorded effect and publish the missing reply, not repeat it.

Accepted message timing: at the start of a run, capture a fixed server-side message-sequence cutoff
and fetch the complete pending queue through that cutoff. Pagination retrieves that same snapshot;
it does not admit later arrivals. Persist the cutoff across retries/resumes. The agent processes that
batch and persists any replies/outcomes, then stops; it does not poll or re-fetch for new messages
mid-run. Later messages always remain unread follow-up for the next run, even when the current action
has not yet committed. They do not cancel or revise the current batch automatically.

Keep expected financial-record revisions as a separate concurrency guard: an actual manual record
correction may invalidate a stale mutation, but a new chat message alone does not. Current-batch
completion resolves only its covered work; newly queued follow-up remains outstanding and cannot be
marked read or resolved by that completion. Preserve its case/source linkage without inventing a
second review queue. Compatible case claims use the existing owner-level maintenance lifecycle.
An earlier action cannot cite a later message. UI copy explains that new messages will be picked up
on the next run; it never implies immediate interruption or cancellation.

Focused Reviews retains one canonical case with separate projections: actionable by user, waiting
for agent, unavailable/failed, and resolved. A contextual Chat send moves work to waiting only after
durable acceptance; waiting work remains inspectable. If no eligible automation can deliver it,
return the case to attention with manual recovery. A missed run alone does not fabricate read state.
F owns the evidence envelope; each mutation owner commits financial effects and required evidence
atomically. Failed attempts may log separate truthful failure events, never applied-change events.

### Onboarding compatibility and release independence

Workspace onboarding completion is independent of budget-setup protocol completion. A later
`setup_finances` call must not re-lock the workspace or repeatedly require an optional budget merely
because the older protocol expects approval/maintenance. Persist explicit unknown context independently
of version-scoped interview skip mechanics; unrelated profile edits do not restart onboarding questions.
Capability readiness uses stable reasons and recovery actions shared by UI/MCP for spending reads,
proposal preparation, activation, cash-flow projection, and chat sending.

Existing users retain read/correction access even if all sources are disconnected at rollout. Present
a prefilled completion review non-destructively and gate only source-dependent operations; do not
strand historical records behind the new-source prerequisite intended for first-time setup.

Setup release requires tested onboarding-critical manual paths (account creation/import, ownership,
profile answers, completion and recovery) and a correct locked/verified chat capability projection,
not all of Chat implementation or every manual-parity enhancement. Full manual parity remains a
whole-program acceptance requirement. Trends/Rhythm require contribution/bin contracts and a route
shell, not completed bubble rendering. Contract-family releases are independent, not sequential waves.


### Maintenance-owned message intake — clarified integration

`maintain_finances` owns conversation intake as part of its durable start/resume protocol. Starting
new maintenance captures and persists the message cutoff and batch reference before reasoning work;
resuming uses the same batch. Its typed result returns the batch or an explicit next action to page
through that run-bound batch, then existing financial work and reply persistence. A message-read tool
is only a bounded adapter for that batch, not an independent chat job, pre-start live queue scan, or
mid-run polling loop. Compatible coalesced starts reuse the existing run/batch; later messages remain
for a subsequent run. Legacy answer continuations and new message intake must share the canonical
work identity and owner-level execution contract, so the same answer cannot execute twice. Test a
retry of start, a coalesced start with newer messages, and a resumed run retaining its original cutoff.
This is planned integration; the existing tool does not yet implement the new conversation batch.
