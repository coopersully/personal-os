# nohmi workspaces and interfaces

- Status: Target product contract; current implementation is recorded separately
- Last reconciled: 2026-09-10

## The workspace model

nohmi is an autonomous exoskeleton for a person whose life increasingly happens through digital
systems. It unifies fragmented provider data into four understandable workspaces, gives the person
simple first-party interfaces for direct control, and gives authorized agents consistent tools for
understanding, triaging, and resolving work on the person's behalf.

Each workspace combines a familiar application, a trustworthy ledger, an expert steward, a
maintenance workflow, and narrow tools. The UI, public API, and MCP operate on the same records and
policy boundaries; none of them keeps a separate interpretation of the person's life.

Provider differences are normalized into small, stable, workspace-native concepts so an agent can
learn the nohmi contract once instead of repeatedly interpreting Gmail, iCloud, Plaid, or another
provider's incidental vocabulary. Normalization reduces entropy for models without discarding the
provider identity, capability, revision, or evidence needed for faithful reconciliation.

Today is the cross-workspace operating surface, not a fifth workspace. It presents the small set of
commitments, decisions, exceptions, and completed work that matter now without flattening the four
workspace models into one generic record type.

## Workspace summary

| Workspace | Primary purpose | Meaning of maintained |
| --- | --- | --- |
| Mail | Unify communication and let the person read, search, compose, send, organize, and resolve messages without returning to each provider. | No important communication is untriaged, required replies and derived commitments are visible, safe routine work is completed, and uncertainty is queued. |
| Tasks | Become the person's authoritative working system for captured commitments after importing them from external providers. | No commitment is unprocessed, incorrectly placed, stale, infeasible, or disconnected from the goals and context that give it meaning. |
| Calendar | Unify the person's time across accounts and make nohmi the primary place to view, create, change, and reason about events. | Conflicts, invitations, duplicate events, missing buffers, overload, and other decisions are resolved or explicitly waiting for the person. |
| Finances | Unify financial accounts into an understandable budget, cash-flow, balance, transaction, and net-worth system. | Posted activity is reconciled and understood, plans reflect current evidence and priorities, risks are visible, and irreducible questions are queued. |

## Shared interfaces

Every workspace should expose the following interfaces over one domain-owned source of truth.

| Interface | Goal | Purpose |
| --- | --- | --- |
| App, web, desktop, and future mobile UI | Make the workspace immediately familiar and calm. | Let the person use nohmi as their normal mail client, task manager, calendar, or financial dashboard while progressively disclosing intelligence, provenance, policy, errors, and recovery. |
| Public API | Provide the authoritative product boundary. | Enforce identity, ownership, policy, revisions, idempotency, audit, connector behavior, and durable workflow state for every caller. |
| Guided setup and workflow definition | Learn how this person wants the workspace to operate. | Interview for goals, source meanings, constraints, preferred reviews, notification boundaries, and the person's ideal workflow; propose configuration and rules for approval instead of requiring them to translate their needs into settings. |
| MCP orientation and status | Let an unfamiliar agent understand the workspace quickly. | Report capabilities, freshness, health, active guidance, outstanding work, applicable knowledge, missing context, and the next safe action. |
| MCP maintenance intent | Let an external scheduler or person invoke a complete domain workflow with a small instruction. | Start or resume the domain-owned maintenance turn without requiring the client to reproduce expertise or orchestration. |
| MCP surgical tools | Give agents precise access to exact records and decisions. | Support free-form questions and narrowly scoped reads, previews, corrections, and authorized actions such as reading a balance or inspecting one event. |
| Questions and reviews | Preserve human judgment without blocking unrelated work. | Persist the work nodes created by setup and maintenance: what nohmi did, what it could not safely decide, the evidence behind each question, and the consequence of each answer. |
| Settings and recovery | Make control and degraded state obvious. | Expose sources, synchronization, permissions, agent access, guidance, rules, connector failures, retries, exports, and deletion. |

Texting is a shared general inbox across these interfaces, not another workspace. It routes each
free-form request, answer, or exact review to its owning workspace; workspace maintenance may
publish concise SMS results and questions through Texting according to the person's global and
per-workspace settings. The complete contracts are
[`texting and SMS`](texting-operations.md) and
[`per-workspace settings`](workspace-settings.md).

## Mail

### Goal

Mail is a complete unified mail client informed by the interaction patterns people already know
from Gmail, Apple Mail, and Superhuman. nohmi should make multiple accounts feel like one coherent
inbox while always preserving account identity, provider capabilities, and source fidelity.

### Direct interface

- Unified and per-account inboxes, folders, labels, saved searches, and smart views.
- Fast reading, search, keyboard navigation, composition, drafts, replies, forwarding, and sending.
- Provider-aware archive, trash, spam, unsubscribe, snooze, move, label, mark-read, and batch flows.
- Visible sync freshness, account identity, unsupported actions, connector errors, and recovery.
- Contextual links to tasks, events, receipts, orders, people, and financial activity.

### Agent interface

- Run guided setup to learn account roles, important relationships, communication boundaries,
  review preferences, and the person's desired triage workflow; propose rules for approval.
- Orient with mailbox inventory, capabilities, freshness, active guidance, and unresolved work.
- Search and read exact conversations without exposing provider credentials.
- Triage communication into needs-reply, informational, invitation, receipt, newsletter, and other
  domain-owned meanings.
- Draft or execute only actions permitted by active policy and preserve exact evidence for every
  consequential mutation.
- Maintain Mail toward zero untriaged important communication, producing questions and a durable
  review rather than hiding uncertainty.

## Tasks

### Goal

Tasks is the person's authoritative commitment workspace: a complete task manager with the clarity
of Things or Todoist, planning awareness associated with Sunsama or Akiflow, and fast interaction
patterns associated with Linear. It imports tasks from external providers and becomes the unified
workspace used from then on. Import is a one-time migration that the person may explicitly
re-trigger under a heavy rate limit; repeated imports add genuinely new source commitments,
deduplicate prior material, and do not silently replace nohmi-owned edits. Continuous inbound and
bidirectional multi-provider synchronization remain possible future capabilities, not current
product commitments.

### Direct interface

- Inbox, Today, Upcoming, Open, Later, Projects, long-lived organizational containers, Completed,
  and Trash.
- Quick capture, natural-language entry, keyboard operation, search, filtering, bulk actions, and
  progressive task details.
- Independent deadline, scheduled time, estimate, priority, context, source, project, and lifecycle
  semantics.
- Calendar-aware capacity and timeboxing without making Calendar and Tasks duplicate owners of the
  same meaning: Tasks owns what and why; Calendar owns when.
- A full planning and completion interface that remains useful without an agent.

The product distinction is settled: a Project is a finite outcome, while the higher container is a
durable responsibility or context that can contain many projects and standalone tasks. Keep
**Lists** as the provisional user-facing label because it is already shipped and familiar; do not
introduce **Areas** as the default. A later product review may choose a clearer label without
changing this underlying model.

### Agent interface

- Run guided setup to import existing commitments, learn planning conventions and review cadence,
  and translate the person's preferred workflow into proposed organization and rules.
- Orient with active goals, priorities, capacity, stale commitments, imports, and unresolved Inbox
  material.
- Capture, clarify, organize, estimate, prioritize, split, schedule, defer, complete, and review
  exact commitments through revision-safe operations.
- Explain planning recommendations using the person's goals, constraints, habits, energy, and time
  without manufacturing urgency.
- Maintain Tasks toward zero unprocessed or stale commitments and a feasible, intentional plan.
- Learn how the person organizes and plans while keeping inferred preference separate from action
  authority.

## Calendar

### Goal

Calendar is a unified calendar influenced by Fantastical and Notion Calendar and intended to be the
one place a person needs to view and manage upcoming events. nohmi uses knowledge of the person to
deduplicate, protect privacy, expose realistic availability, and lay out time more intelligently
without obscuring provider truth.

### Direct interface

- Day, week, month, and agenda views across local and connected calendars.
- Complete event creation and editing, invitations, attendee state, recurrence, conferencing,
  location, travel, buffers, privacy, and free/busy behavior where supported.
- Saved calendar sets, search, natural-language creation, drag and keyboard scheduling, and clear
  provider destination controls.
- Deduplication and busy mirroring that show an event once while protecting availability in every
  appropriate calendar.
- Immediate visibility into conflicts, stale synchronization, unsupported mutations, and recovery.

### Agent interface

- Run guided setup to learn calendar meanings, writable destinations, privacy, work hours, buffers,
  travel, protected time, and the person's desired scheduling workflow.
- Orient with time zone, work patterns, protected time, selected calendars, source meanings,
  freshness, and current conflicts.
- Inspect exact events and availability, prepare commitments, manage invitations, and propose
  schedules through provider-aware operations.
- Reason about overload, travel, buffers, meeting density, focus time, and the person's larger
  priorities.
- Maintain Calendar toward zero unexamined conflicts or scheduling decisions while preserving hard
  commitments and approved privacy boundaries.
- Never infer that calendar text or an invitation grants authority for another action.

## Finances

### Goal

Finances is a unified budget, cash-flow, account-balance, transaction, and net-worth application
informed by strong consumer experiences such as Monarch, Rocket Money, and SoFi. Its intelligence
should combine useful methods from bookkeeping, accounting, controllership, financial planning,
investment analysis, auditing, and coaching without claiming professional credentials.

### Direct interface

- Overview, transaction ledger, review inbox, budget and plan, cash flow, wealth, accounts, goals,
  and settings.
- Unified balances and activity across connected institutions plus manual and file-import paths.
- Explainable categorization, splits, transfers, recurring streams, subscriptions, reimbursements,
  ownership, exclusions, and rules.
- Budget creation and refinement grounded in actual income, obligations, goals, reserves, debt,
  risk, and user-selected priorities.
- Explainable pacing signals for spending materially above or below the approved plan. Both can be
  meaningful: overspending can threaten obligations, while persistent underspending can indicate
  that a stated goal, need, or quality-of-life priority is not actually being served.
- Visible data freshness, missing evidence, connector failures, material risks, and review state.

### Agent interface

- Orient with the expert playbook, profile readiness, accounts, balances, budget, goals, freshness,
  questions, and authority.
- Run an interview-driven setup that learns the person's circumstances, proposes a complete budget,
  obtains the required approval, resolves recent unexplained activity, and configures the person's
  preferred review and maintenance workflow.
- Answer free-form financial questions through narrow account, balance, transaction, connection,
  plan, and health tools.
- Maintain Finances by reconciling and classifying outstanding activity, updating the financial
  picture, and creating a review inbox for decisions that cannot be made safely.
- Explain relevant expert information and tradeoffs so the person can choose their priorities;
  never move money, trade, pay bills, file returns, invent facts, or let confidence replace
  authority.

## Cross-workspace behavior

- Typed links connect native records without copying them into a generic object.
- User Knowledge supplies goals, relationships, preferences, constraints, habits, and life context
  across workspaces according to purpose and disclosure policy.
- A workspace may ask another workspace for bounded evidence, such as Finance matching an Amazon
  charge to a receipt in Mail, without receiving unrelated private content.
- Cross-workspace actions preserve the initiating purpose, source references, permissions, and an
  auditable explanation of what was disclosed and why.
- Cross-workspace operations preserve every verified success and report completed, failed, blocked,
  and uncertain child results exactly. A sibling failure never turns partial completion into a
  success claim or triggers compensating rollback solely to create an all-or-nothing appearance.
- Today composes outcomes and decisions from the workspaces; it does not own their records or expert
  logic.

## External scheduling

nohmi owns durable execution but does not require one scheduler. A person may invoke maintenance
through ChatGPT or Codex scheduled tasks, Claude recurring tasks or routines, Gemini scheduled
actions or headless automation, an operating-system scheduler, or another MCP-capable host. They may
configure several hosts or schedules for the same workspace or maintenance intent; nohmi does not
select a single owner or prevent this power-user workflow.

The external platform owns cadence and invocation. nohmi owns the meaning of maintenance,
knowledge retrieval, policy checks, durable run state, idempotency, questions, reviews, recovery,
and the verified terminal result; a client should be able to invoke one maintenance intent rather
than reconstruct the workflow. Every declared schedule receives an immutable nohmi-owned local
identity, and scheduled calls must pass it through the authenticated connection; nohmi validates and
propagates it through run, health, revocation, idempotency, and coalescing records. Only a non-secret
credential reference, optional host automation identity, trigger evidence, scope, and idempotency
identity are retained. Manual and otherwise unscheduled invocations leave schedule identity absent.
Compatible concurrent calls coalesce or resume durable work, while conflicting scopes remain
separate and report their own honest result.

## Target versus current implementation

This document defines the complete target. The implementation log, current API and MCP contracts,
database migrations, tests, and production evidence determine what is shipped; documentation and
interfaces must never present target behavior as available before those sources agree.
