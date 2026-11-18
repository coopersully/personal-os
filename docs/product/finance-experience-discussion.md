# Finance experience discussion

Discussion notes started October 18, 2026. This is a chronological discussion record, including
superseded proposals. The consolidated [design](../superpowers/specs/2026-10-18-finance-experience-design.md)
and [implementation plan](../superpowers/plans/2026-10-18-finance-experience.md) resolve the final
direction and explicit design defaults. Neither document is a claim of shipped behavior.

## Intended outcome

Make Finances useful for daily inspection: understand spending, where money goes, and how finances
are doing. Agent automation should be the encouraged way to maintain financial understanding,
budget context, and categorization. Discuss every topic below before implementation.

## Direction supplied by Cooper

- Build a spacious spending visualization with centrally packed bubbles, category or bucket icons,
  and bubble sizes based on spending. Animate changes between views.
- Provide standard period controls for today, this week, this month, and other useful periods.
- Make spending grouping customizable: buckets, categories, and possibly categories within buckets.
- Make Finance automations easy to discover, set up, and understand in the workspace.
- Offer one comprehensive Finance automation with customization inside it, rather than requiring
  separate setup for cleanup, monitoring, and reviews. Cooper confirmed this direction October 18.
  It should handle as much work as its evidence and granted authority allow and ask questions only
  when the person's input is genuinely needed. Exact automatic-action boundaries are under discussion.
- Keep manual transaction/account creation behind a Finance setting. Hide these controls by default
  once automation is set up; retain the ability to show them. Corrections and answering questions
  always remain available. This direction was confirmed by Cooper on October 18.
- Discuss easier reviews and question answering. Automated runs should use the agent's intelligence
  and available evidence to resolve more work before asking the user. A chat interface is an option
  to explore. Cooper subsequently selected casual outstanding-question conversations with an agent
  chat appearance; general-purpose financial chat remains undecided.
- Budget changes and budget approval/activation always require human approval. Cooper rejected an
  optional automatic budget-adjustment allowance. Agents may propose changes, not self-approve them.
- Add a Finance page for important agent decisions/actions and approved financial changes. Ensure
  important events are audit logged; investigate existing coverage rather than assuming it is complete.
- Group routine bookkeeping into expandable Activity entries, such as “12 transactions categorized.”
  Budget changes and other significant decisions receive individual entries. Cooper confirmed this
  presentation direction on October 18. Grouped entries must preserve access to individual changes.
- Provide an agent-style chat destination in the Finance sidebar only when an automation is
  registered. Use a visible composer/action bar to explain when the agent is expected to respond
  on a future run, distinguishing known schedule timing from an estimate.
- Recognize external automation: prefer explicit schedule registration/reporting; also investigate
  repeated Finance maintenance calls from the same authenticated agent/connection at regular times.
  Cooper wants recognized automation to enable chat and default manual controls to hidden. The
  evidence threshold and promotion from observed pattern to registered automation need definition.
  Registration must include a usable answer-consumption path, not just timestamps of tool calls.

## October 18 follow-up: setup and registered automation

- Cooper approved automatic detection followed by agent confirmation of schedule and answer-consumption
  capability before registration enables chat. Use shadcn chat components/patterns.
- New requested direction: an explicit, resumable Finance setup flow gates the normal workspace
  until setup is complete. It should establish reliable personal financial context and customize
  the workspace. Exact completion requirements and skip/optional paths are not yet settled.
- Setup includes connected accounts/Plaid, an automation recommendation, and creating an automation
  registration. The user copies a generated prompt into their external agent's scheduled automation.
- The prompt is a maintained template with the unique registration ID injected, directing the agent
  to the Finance maintenance flow and requiring that ID when starting/reporting runs. It is an
  attribution identifier, not an authentication secret or new authority grant.
- Preserve the generated prompt/template version for each registration and allow copying it again
  from its detail/edit screen. This records the prompt nohmi supplied; it cannot prove that the user
  pasted it unchanged or that the external host still uses that exact prompt.
- Let users configure expected cadence, local time, and timezone in nohmi. These are tracking
  expectations and do not edit the external scheduler. Registration time is not evidence of cadence;
  actual run timestamps establish observed execution times.
- Provide an automation list with edit/remove and prompt access. Flag missed expected runs and stale
  registrations, with timing tolerance, paused state, and schedule-change behavior still to settle.
- One comprehensive automation is the recommended setup; multiple registrations remain inspectable.
- Reconcile the new gate with prior independent configuration/access contracts before implementation.
- Setup may finish with automation verification pending. Show Chat and other dependent features
  locked until a check-in confirms capability, superseding earlier hidden-Chat wording. Whether
  setup can finish without registering any automation remains undecided.
- Lead with a copyable prompt for a one-time external-agent setup conversation; retain manual entry
  of the same canonical profile answers. This is distinct from the recurring maintenance prompt and
  remains available regardless of manual bookkeeping visibility.
- Verified `setup_finances` MCP and the API setup interview: it reads existing context, asks missing
  questions, persists answers, supports explicit skips, and prepares a first budget. Questions cover
  household/location, take-home/income reliability, reserves, debt minimums, buffer, recurring and
  uncertain income, exceptional resources, obligations, contributions, and priorities. This exists
  in source; the redesigned gated setup and its completion criteria do not yet exist.
- Existing MCP setup instructions also advertise conditional agent budget self-approval; include
  those instructions when implementing the newly accepted always-ask requirement.
- Allow explicit “I don't know yet” answers and setup completion for deferrable financial context;
  the agent can follow up later. Missing prerequisites necessary for the agent's required work remain
  blocking. Identify those prerequisites by capability rather than treating every profile field as
  mandatory. Automation verification may still remain pending under the already accepted locked-chat
  behavior. Exact required prerequisites remain to be specified.

## Spending dashboard discussion

- Confirmed: default to buckets when configured, categories otherwise; remember the user's choice.
- Confirmed: selecting a bucket supports drilling into its categories. Both buckets and categories
  also provide navigation to Transactions filtered to that group and the selected time period.
  Distinct drill-down versus transaction-navigation gestures/actions still need to be designed.
- Requested visual direction: an elastic bubble field attracted toward the center, with draggable
  bubbles so the user can move them and feel in control. Release behavior, motion intensity,
  click-versus-drag handling, and whether positions persist remain under discussion.
- Confirmed release behavior: bubbles remain roughly where placed, with a gentle pull toward the
  center. Persistence across visits and period changes remains to be decided.
- Confirmed budget display: use the bucket/category's assigned color, with a translucent tonal fill
  rising bottom to top inside the bubble, not a perimeter progress ring. Text, icons, and controls
  render above the fill with readable contrast. Animate fill changes and clearly distinguish
  overspending from exactly reaching the limit.
- Confirmed: bubble size represents spending in the selected period; fill represents monthly budget
  usage, explicitly labeled so the two time scopes cannot be confused. Do not prorate the monthly
  limit for Today/This week. For historical and multi-month ranges, still settle which month's budget
  and actuals to show. No budget means no invented usage percentage.
- Proposed detail treatment: area-correct fill percentage; full fill plus warning outline and exact
  overage text when overspent; smooth transitions that settle. Define bucket rollups, partial budget
  coverage, zero limits, and negative/net-refund totals before implementation.

- Proposed starting design, not yet approved: spending anchors Overview; default to this month;
  switch Today / This week / This month with historical navigation; choose Buckets or Categories;
  select a bucket to explore its categories, then transactions. Bubble area represents spending,
  with stable positions, brief transitions, exact amounts, and equivalent accessible list access.
- Settle grouping and drill-down first, then period controls, sizing/labels, budget comparison,
  spending accounting rules, empty states, and responsive/reduced-motion behavior.

## Remaining product decisions — prioritized

### Latest decisions from Cooper

- Add the complete mode behavior matrix and first-class Spending List view to the design/plan.
  Bubbles/List share filters and totals; List is part of the initial build. User anticipates separate
  implementation workstreams; no agents or implementation workstreams have been launched here.
- Next design discussion: upcoming money timeline within Cash flow and Trends within Spending.
  Neither is yet approved as a fully specified implementation slice. A focused input experience
  must reuse canonical Reviews cases and must not create a duplicate queue.

- Confirmed: default spending to personal cost, with a setting to show full outflow. Preserve the
  distinction between reimbursable amounts and reimbursement actually received; use canonical
  ledger evidence and expose the breakdown rather than inventing receipt or recovery.
- Confirmed: one ongoing Finance conversation, with notifications governed by existing notification
  preferences rather than a separate notification policy.
- Conversation-driven actions must retain durable case/question linkage across the agent question,
  every relevant user reply (including replies sent separately), resulting activity/audit events,
  and affected transactions, budgets, or other Finance records. User-initiated instructions can start
  a case without a preceding agent question. Preserve relevant message excerpts and the decision's
  explanation so Activity shows what evidence the agent used and what it decided.
- Example: one question lists three transactions; the user answers in two messages. The handled
  case and categorization activity link all three messages and all three transactions. Where useful,
  each transaction's individual change links the specific answer excerpt that supports it. Keep
  source messages inspectable in conversation context rather than storing only an agent summary.
- Case status, message receipts, and financial completion remain separate: a fetched or answered
  message does not establish that categorization succeeded. Multiple actions may follow one case;
  preserve failed/partial outcomes and subsequent corrections without rewriting original evidence.
- Conversation context does not confer budget approval. Any budget action still needs the exact
  human-approved proposal, and its approval evidence belongs alongside conversation provenance.

- Confirmed: allow setup completion with automation deferred and Chat locked. Automated maintenance
  is the intended experience; manual mode is secondary but supported. Audit all user-facing Finance
  agent workflows for usable UI equivalents, including uncategorized transaction review,
  categorization, splits, matching/reconciliation, questions, budgets, and source/profile management.
  Do not expose internal execution machinery or weaken human approval rules. Coverage is not yet verified.
- Confirmed: historical single-month views use the applicable approved budget; no fill for missing
  budgets or multi-month selections, with clear explanation. Grouping remains available. Specify the
  historical revision-selection rule during design; never substitute today's budget silently.

- Spending is a new sidebar page. Keep Overview and existing destinations unchanged for this scope;
  review redundancy after seeing the result. Automations and Activity are separate sidebar pages.
- Include pending spending by default. Provide granular spending-view options in Finance settings
  and the view, including default bucket/category presentation and pending inclusion. Surface simple
  checkboxes during setup; the agent can discuss and persist the same preferences. Preserve the
  earlier default-to-buckets-when-present behavior and explicit user choice.
- Chat shows an unread-message count and needs-attention indicator while there are unread messages.
  Persist user and agent read/acknowledgment separately so users can see whether an agent retrieved
  their message. Do not equate read or acknowledged with answered or financially resolved.
- Missed automation runs promptly add needs-attention to Automations and surface recovery. Infer
  unread from message receipt state, not from the missed schedule alone: an agent could have fetched
  a message before a later failure. Define a reasonable missed-run grace interval during design.
- Historical budget treatment and exact setup prerequisites remain open; provide recommendations.

### Historical-budget evidence and proposal

- Existing budget activation retires prior active versions instead of deleting them. Budget records
  include effectiveFrom, approvedAt, resources, and allocations. There are also explicit monthly
  baseline records and period-review infrastructure. These are foundations, not proof that the
  spending API can already resolve every historical period to the right approved budget.
- Proposed: current-month view uses current approved applicable budget; historical single-month view
  uses the applicable approved historical budget, visibly labeled. If unavailable, show spending
  without fill. Multi-month ranges show spending without one misleading monthly fill. Keep bucket
  grouping available independently of budget coverage. Exact historical revision policy still needs
  definition; never substitute today's budget silently.

### Setup prerequisite proposal — not yet approved

- Require a usable owned account source, explicit account inclusion/ownership, reviewed display
  preferences, and completion of the automation choice. If automation is chosen, require its scoped
  authorized connection and registration/expected schedule before declaring configuration complete;
  its first verified run may remain pending. Whether no-automation setup is permitted needs review.
- Income, bills, debt minimums, reserves, goals, household, location, and budget may be unknown for
  spending/classification. Missing facts block only affected planning/forecast capabilities. Do not
  require an approved budget to inspect spending; a valid complete proposal and exact human approval
  are required before activating a budget. Ask for clarification where missing ownership affects totals.
- Existing users should keep their records and confirmed profile answers; proposed setup is a short
  review of actual missing prerequisites rather than repeating the full interview.

1. Spending totals: pending versus posted, transfers, refunds/reimbursements, account ownership/scope,
   uncategorized spending, and treatment of currencies. Reuse domain accounting semantics rather than
   introducing competing UI calculations.
2. Time: opening period, historical/custom ranges, and monthly fill meaning for cross-month ranges.
3. Setup completion: exact operational prerequisites, whether an automation registration is required,
   whether an approved budget is required, and treatment of existing users.
4. Delayed conversations: grouped questions versus broader chat, approved-budget proposal interaction,
   notifications for replies, and behavior when registered automation pauses, misses runs, or is removed.
5. Workspace composition: spending as Overview versus separate destination; compact balances and
   attention; access to Activity and Automations. Settle import-control visibility with manual controls.

Implementation design must also specify schedule detection thresholds/grace periods and multi-host
routing, audit completeness, exact bubble gestures, tiny/zero bubbles, saved placement, keyboard and
mobile behavior, and reduced motion. These can be proposed as concrete defaults rather than separate
product discussions unless they introduce a substantive choice.

## Current implementation evidence

- `overview-page.tsx` leads with cash, monthly spending, net worth, position evidence, and supporting
  plan/maintenance material. The proposed bubble dashboard is not present there.
- `host-settings.tsx` exposes host connection selection, schedule preparation, health, and recovery.
  Existing product contracts assign schedule cadence/invocation to external hosts and financial
  meaning, execution state, and policy to nohmi.
- Accounts offers bank connection, import, and manual tracking. Existing product contracts explicitly
  support manual/import paths and user correction; a decision to remove these needs a corresponding
  canonical documentation update.
- Finance has saved presentation preferences, budget buckets, categories, and account view selections.
  These are possible foundations, not proof that arbitrary-period spending aggregation is ready.
- Read-only inspection on October 18 found budget activation audit writes in
  `apps/api/src/finance/profile-budget-service.ts`, with actor, approval source, exact budget version,
  and before/after status. Budget policy and action-review services also write audit events. This
  establishes existing infrastructure, not complete coverage or production verification.
- The budget activation service still contains a conditional agent-self-approval path. Its
  reachability and all other approval paths need verification against the newly accepted always-ask
  contract. Runtime code has not been changed during this discussion.
- Existing automation host records have schedule identity, connection binding, nextExpectedAt,
  lastObservedAt, and expected/overdue/paused health. Current inspected code supports explicit
  registration and observation; passive cadence inference has not been established as implemented.

## Topics to settle before implementation

1. Manual controls: visibility direction is settled above. Still define the automation-setup trigger,
   preservation of explicit user preferences, import visibility, and behavior if automation pauses
   or fails. Preserve existing records and access to corrections and questions.
2. Automation: user-facing purpose, setup journey, authority, default cadence, recognition of a real
   configured schedule, health/freshness, paused or failed operation, and recovery.
3. Dashboard placement: replace Overview or add Spending; retain access to balances and decisions
   without crowding the spending view.
4. Bubble behavior: default grouping, bucket/category drill-down, exact amounts, transaction detail,
   icon choices, stable layout, mobile/keyboard access, and reduced motion.
5. Spending meaning: posted/pending activity, transfers, refunds, reimbursements, split transactions,
   uncategorized activity, account scope, currencies, and incomplete or stale data.
6. Periods and customization: defaults, historical navigation, custom ranges, remembered preferences,
   and whether budget comparisons belong in the initial experience.
7. First use: useful experience before a budget or automation exists, connected-bank onboarding,
   and honest empty/unavailable states.
8. Reviews and answers: reduce unnecessary questions through evidence-backed agent reasoning during
   automated runs; use earlier answers appropriately; group related questions; consider conversational
   answers or a chat interface; distinguish saved context from completed bookkeeping and preserve
   explicit authority for changes. Discuss this before implementation.
9. Finance activity page: important event types, readable change descriptions, before/after details,
   reasons/evidence, agent versus approver attribution, links, filters, and treatment of failed attempts.
   Verify audit completeness, durable writes, and approval enforcement during implementation.
10. Asynchronous chat: durable messages tied to questions, consumption on the next automation run,
    reply persistence, registered versus inferred schedule timing, missed runs, paused automation,
    multiple schedules, and preserving conversation history when chat cannot accept new messages.

## Chat component research — October 18

- shadcn/ui AI Elements: https://ui.shadcn.com/docs/ai-elements — composable chat, message,
  prompt input, confirmation, and tool presentation patterns. Preferred candidate to evaluate
  against the existing UI stack; no dependency installed or compatibility claimed.
- assistant-ui: https://www.assistant-ui.com/docs/primitives — accessible chat primitives with
  conversation state handling. Alternative if its runtime abstraction helps durable asynchronous chat.
- Proposed timing copy: “Next agent run in about 2 hours” for a reported schedule; “Usually runs
  Monday mornings · estimated” for an observed pattern. A scheduled start is not a guaranteed reply
  deadline. Missed/paused runs must replace the countdown with an honest state.

## Initial recommendations — not yet decisions

- Automation scope proposal: routine evidence-backed classification and reconciliation, financial
  picture updates, and review preparation run automatically within granted authority. Seek available
  authorized evidence and relevant previous answers before asking a new question. Do not overwrite
  explicit user corrections or infer permission from confidence. Budget revisions and persistent
  action rules retain their explicit approval contracts. Budget changes always require human approval.
- Keep inspection available even when manual record creation is hidden; corrections and answers
  remaining available are now a confirmed decision.
- Separate bank ingestion, agent maintenance, and permission to apply changes in the UI and state model.
- Size bubble area in proportion to spending; expose exact amounts and an accessible detail/list view.
- Do not infer active automation from an authorized agent connection alone.

Canonical contracts to reconcile after decisions: `workspaces.md`, `workspace-stewardship.md`,
`finance-workspace-plan.md`, and `../design/pages/finances.md`.


## Accepted timeline and trends extension

Cooper selected Agenda as the default Cash flow timeline, with Calendar available, and approved
Spending Trends alongside Bubbles and List. These are now specified in design §11 and implementation
Tasks 12–13. Focused Reviews is the next discussion: refine the existing queue without new case
identities, duplicate counts, or independent resolution state.

## Focused Reviews: contextual Chat replies

Cooper selected navigation into Chat for conversational replies from Reviews, rather than a separate
inline conversational composer. The Chat composer visibly shows the case/question and financial
records the draft refers to. Use removable context chips/cards, with inspectable links, so the user
can understand and correct what the message will be linked to before sending. Removing draft context
does not dismiss the review case or undo prior evidence links. Exact context-selection UX is being
refined; do not silently attach an inferred record as if the user explicitly selected it.


## Parallel delivery planning

Cooper explicitly prioritizes maximum parallel execution and fastest independent shipping. Wave
labels are not batch barriers; only actual dependencies and required verification constrain release.
Do not keep asking whether sequencing feels right. This planning update does not launch workers.

The [workstream map](../superpowers/plans/2026-10-18-finance-workstreams.md) now records dependencies,
parallel waves, shared-file ownership, and independent release gates. This is planning only; no
implementation workers have been launched or assigned merge authority.

## Default approval and visualization exploration

Cooper explicitly approved the documented missed-run grace period, repeat-observation threshold for
automation candidates, and session-only persistence of dragged bubble positions. These are no longer
pending product approval; measured implementation issues may still require revisiting them.

Cooper requested exploration of useful visualizations/predictions based on existing financial context
and optional additional information. Treat this as idea development, not blanket approval to expand
implementation scope or collect new personal data. Distinguish schema availability from populated,
fresh user data and distinguish descriptive analysis from uncertain forecasts.

Candidate ideas, not yet implementation scope:
- Spending rhythm heatmap: daily category/bucket spending, transaction drill-down, and incomplete
  coverage labels. Existing transaction dates/amounts can support this without new personal inputs.
- Recurring-cost ladder: monthly equivalents and annualized recurring commitments, separating
  observed prices from projections; do not infer subscription usage or waste from charges alone.
- Payday-to-payday view: spending and known commitments between reliable income dates, with an
  estimated low-balance interval only when dated cash-flow evidence supports it.
- Reimbursement journey: personal cost versus amounts owed/received over time; expected recovery
  never presented as available cash.
- Goal scenarios: compare hypothetical contribution amounts and timelines, showing assumptions and
  uncertainty; no implied budget change or guaranteed date. Existing scenario code is simplified
  arithmetic and does not establish calibrated forecasts or interest-aware debt predictions.
- Optional high-value context, asked only for a feature that uses it: protected cash floor, expected
  annual/irregular expenses and dates, goal target date/flexibility, reliable payday confirmation.
  Reuse existing answers and keep inferred values separate from user-confirmed facts.

Cooper subsequently approved all five exploration views as part of the larger implementation scope:
Spending rhythm, Recurring-cost ladder, Payday-to-payday, Reimbursement journey, and Goal scenarios.
They are follow-on workstreams K–O with explicit dependencies and independent shipping boundaries,
not merely uncommitted ideas. Design §12 and implementation Tasks 14–18 now define their behavior.


## Accepted run/message timing

Cooper clarified that an agent fetches the queue once at run start, processes that batch, replies as
needed, and stops. Messages arriving afterward always become follow-up for the next run. Use a fixed
server cutoff across pagination/resume, not live polling. Do not automatically incorporate later chat
into an in-flight action. Direct record edits retain ordinary optimistic-concurrency protection.


Maintenance integration clarified: the pending conversation batch belongs to `maintain_finances`
start/resume, not a separate scheduled chat job. Fixed cutoff persists across pagination/retries;
new messages always follow up in a later run. Three review proposals still await explicit discussion:
generic-host registration, the automatic chat test exchange, and interrupted-run recovery behavior.


Cooper approved all three external-host proposals after discussion: generic registration, automatic
chat capability test, and guarded interrupted-run recovery. Automation key means the internal schedule
ID, always embedded in that automation's generated prompt, not a new access credential. Create/edit/
recopy must preserve the correct ID. No product questions remain from the independent plan review.
