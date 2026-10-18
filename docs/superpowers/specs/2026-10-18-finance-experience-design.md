# Finance experience design

Status: complete design for review; not implemented. October 18, 2026.

This consolidates Cooper's decisions in [discussion notes](../../product/finance-experience-discussion.md).
The explicit defaults below resolve remaining implementation choices; they are reviewable design
choices, not claims that Cooper individually selected every threshold. This document supersedes
conflicting earlier Finance UX targets for setup gates, budget self-approval, chat visibility, and
spending presentation. Existing implementation remains the authority for shipped behavior.

## 1. Outcome and scope

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
saved user timezone and locale week start. Query with inclusive local dates converted to half-open
UTC boundaries. Default to This month. A single-month slice uses that month's whole-month usage for
fill, even if bubble size represents only one day. Label both scopes; historical future dates have
only available recorded evidence and no fabricated forecast.

For month M, resolve the latest human-approved budget version effective for M, excluding proposals,
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

The prompt is a template with the registration ID injected. It directs the agent to authenticate with
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

Deliver sequential independently reviewable slices: authority, contracts/storage, spending, automation,
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
