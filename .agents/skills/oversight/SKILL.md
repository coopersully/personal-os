---
name: oversight
description: Coordinate nohmi outcomes, implementation owners, dependencies, evidence and delivery from agreed product intent. Use for project oversight, adopting existing work or explicit network launch; ordinary implementation retains its workflow.
---

# nohmi oversight

## Mandatory kickoff and adoption gate

**Complete this gate first, on fresh starts and resumes, before implementation dispatch or claiming
that oversight is established.** Read-only context gathering may proceed while setup is incomplete.
An oversight assignment authorizes the bounded workstream sidebar organization, chat naming and
Nohmi issue/link setup below; honor explicit read-only or narrower limits without claiming completion.
This grant does not authorize new chats, unrelated/shared-chat changes, scheduling or cleanup.

1. **Get context and inspect owners.** Read [agent context](../../../docs/engineering/agent-context.md),
   relevant canonical requirements, live issues/PRs and the current work/instructions of existing
   chats. Establish scope, acceptance, settled decisions, grants, current owners and dependencies.
2. **Create or reuse the outcome section.** Inspect live sidebar sections and memberships first.
   Reuse the section already serving this outcome; create one only when none matches. Save its actual
   ID and name. A similar title alone does not prove shared ownership.
3. **Resolve and link work.** Resolve the unique live Nohmi Project; match existing direct issues or
   create the missing bounded issues before dispatch. Record issue links, human/implementation/
   acceptance owners, dependencies, related existing scopes and chat identities/links. Preserve
   completed scopes and existing assignments; do not create duplicate tracking or reopen settled work.
4. **Name and place relevant chats.** Use verified live identities to give dedicated outcome chats
   the titles defined in the heartbeat contract below and place them in the section. Reuse existing
   chats. Preserve explicit user titles; reference unrelated or shared chats and their owners without renaming or moving them.
   Titles and placement never prove checkout ownership or transfer it.
5. **Verify and retain receipts.** Read back tool results for section membership, chat names and
   issue links/ownership. Save their identifiers, source receipts, any protected-chat exclusions and
   setup gaps in one authoritative existing setup record, not a new ledger. For network/epic work,
   this is the outcome entry in the existing private network registry. For ordinary oversight without
   that registry, use the existing coordination checkpoint and record its locator before dispatch.
   The direct issue retains scope/status, public work/chat links, ownership/dependencies and the setup
   record's locator or owner-access reference; it does not duplicate raw host receipts or private state.
   Update the authoritative setup record after each verified setup change, then reconcile the issue's
   links/ownership/reference before dispatch. On resume, follow that reference and reconcile with live
   tools; stale or unavailable records remain gaps rather than fallback authority for repeat writes.
   Only verified coverage of all applicable steps satisfies this gate; an intention or tool call
   alone does not. Report the direct issue link and setup result before implementation dispatch.

On resume/adoption, reconcile the saved identifiers against live state and repair only missing or
changed setup. Do not repeat successful writes, create another section/issue/chat, or restart accepted
work. A failed/unavailable tool or ambiguous identity leaves setup incomplete: record the exact gap
and next recovery condition, continue useful read-only context work, and withhold implementation
dispatch and the setup-complete claim. Reconcile partial effects before retrying. No routine permission
question is needed for the bounded setup already granted by the assignment.

Own context, sequencing, evidence and acceptance from an agreed outcome through the authorized
handoff. Preserve the user's decisions, rationale, non-goals and grants; do not restart brainstorming
or ask them to approve settled choices again. Carry unfinished obligations forward until evidence
closes them. Oversight coordinates; workers implement every code, test, configuration and tracked
document repair. Editing this skill does not launch work or activate monitoring.

This is the repository's self-contained adaptation of the personal oversight procedure. All required
mechanics are here and in local references; no personal install is required. Existing automation
heads and outcome orchestrators perform oversight, with no additional supervisor layer. Apply
[autonomous development](../../../docs/engineering/autonomous-development.md) for assigned network
roles; ordinary contributions keep their existing workflow. See
[provenance and evaluation cases](references/provenance.md) for sources and limits.

## Every oversight heartbeat: tracking and presentation

On **every oversight heartbeat**, including an unchanged pass, verify the live epic section,
the section name, all member identities/order and dedicated chat titles against the existing
authoritative setup record.
This check is not deferred to the full-reconciliation deadline. Use actual host state; cached titles,
a successful earlier wake or unchanged PR head are insufficient. Manual fresh/resumed assignments
still complete the kickoff gate above before dispatch.

- A dedicated epic section is named exactly for the current epic name. Verify identity from its
  recorded section ID, membership and direct parent issue before renaming a proven stale name;
  preserve its ID. Preserve shared sections and explicit user-protected names as recorded exclusions.
- Cooper’s October 26 instruction supersedes subject-only names. Name managed chats
  `ISSUE-ID - Issue name` from their verified direct Nohmi issue or epic parent, for example
  `COO-159 - Development tooling`. Use the parent for multi-slice oversight; do not switch it for
  each child. Prefer one or two words for the issue subject, generally at most five when clear.
  Keep phases, progress, PR links and blockers in records. Reconcile changed issue mappings/names
  through the current `nohmi-project-manager` checklist; never infer identity from similar wording.
  Normalize an authorized issue title before its chat title and read back both. Preserve later
  explicit exceptions; the portfolio manager maps to `COO-170 - Portfolio oversight`.
- Reuse the recorded epic section, with Lead first and persistent owners in dependency/delivery
  order. Subagents have no sidebar rows. Preserve explicit user title choices as recorded
  exclusions when they remain applicable after the October 26 naming instruction.
  Never rename, move or reorder unrelated/shared chats to make a section look consistent.
- Check current direct issue coverage and owners under the
  [tracking lifecycle](../../../docs/engineering/work-context.md#mandatory-tracking-lifecycle).
  Repair only proven missing/changed setup within the assignment's bounded authority. Discover all
  current section members before reordering; preserve unrelated members and their relative order.
  Re-read each changed object, reconcile any uncertain write before retry, and update the same
  authoritative setup entry after verified effects. Retain historical receipts and protected-chat
  exclusions; do not create a second ledger, issue, section or chat for a resume.
- For an unchanged pass, record checked-at and the live receipt in that setup entry; do not issue
  redundant mutations or Linear comments. For unavailable/partial reads or failed writes, retain
  last verified state plus the exact gap/next recovery condition. Do not report it as unchanged or
  setup-complete. Block dependent new dispatch; preserve already-running authorized owners and
  continue independent work. Reconcile the direct issue's setup reference before dispatch resumes.

This is a procedure for an already authorized wake, not scheduling authority or proof of automation.
Do not create/change schedules, unarchive chats, delete sections, move projects or take over owners.
Preserve notification intent and the reporting rules below. Apply this repository contract when an
installed nohmi head/orchestrator/context wrapper delegates here; stale wrapper examples do not
replace current repository requirements. Installed-file adoption still needs its own verified receipt.

## Establish the baseline

Start with [agent context](../../../docs/engineering/agent-context.md), the relevant canonical product
contract, live Nohmi issues, PRs and existing owners. Use the
[development handbook](../../../docs/engineering/development-handbook.md) to select the next missing
step. Its offline planner is decision support, not an executor or proof of readiness.

Map outcome → direct issue(s) → PR/head/base → actual checkout/branch → human owner → implementation
executor → acceptance gate. Titles and idle status do not establish ownership or abandonment.
Distinguish current, historical and superseded slices. Read adjacent shared contracts for collisions
without absorbing neighboring work. Resolve the unique live Nohmi Project before every tracker write;
use repository `linear-context` and `linear-work-sync`, deduplicate and verify receipts. The standing
repository grant covers bounded tracking of assigned durable work, not unrelated taxonomy or owners.

Retain scope, decisions and rationale, acceptance, deadlines with their milestone (merged, deployed
or accepted), dependencies, grants, source gaps and next triggers in existing Linear/coordination
records. Do not create a parallel ledger. Separate facts, inference, targets and measured results.
For multi-owner admission use [epic delivery](../../../docs/engineering/epic-delivery.md); one coherent
owner needs no extra composition worker or rolling integration branch.

## Authority and ownership

Record separate grants for planning, tracking, implementation dispatch, messaging existing chats,
creating chats, PR publication, merge, deployment/production effects, sidebar organization, scheduling
and cleanup. The kickoff gate supplies the bounded setup grant; record the assignment as its source.
Cooper's standing repository instruction authorizes the assigned outcome owner to
review and merge assigned work and necessary bounded prerequisites after the required gates; record
that source once, without separate per-PR permission. Honor revocations and explicit read-only,
plan-only, draft-only or no-merge limits. External messages and other separately controlled effects
still need their own authority; the oversight assignment does not grant unrelated effects.

Choose reasonable scope-consistent defaults. Do not ask routine clarification or re-approval of
implementation, review, prerequisite or merge decisions. Ask only for indispensable information
unavailable from context or an explicit platform approval, stating the exact gap. Continue independent
authorized work while resolving it. No role, issue text or helper skill expands the assigned scope.

Use the host's actual task/collaboration tools and verified identities. New user-owned chats require
explicit creation authority. Preserve existing owners and user model/runtime preferences. For new
or replacement implementation workers, default to **GPT-6.1-Sol Light**: `model="gpt-6.1-sol"` and
reasoning `low` (`thinking="low"` in chat tools), unless the user overrides it. Preserve Lead/reviewer
settings and live worker settings; unavailable requested settings are a dispatch blocker, not a
reason to silently substitute. Writable work requires an explicitly isolated checkout and owned paths.

The head never implements or merges; an assigned orchestrator delegates repairs and owns acceptance.
Workers never merge. The assigned orchestrator reviews its own coordination work and delegated
implementation, then merges within the standing scope after current independent deep-review
acceptance, zero unresolved review threads and all protected gates. Self-review is required judgment,
not independent review or eligible GitHub approval. Do not stop for another permission question when
the reviewed candidate and its bounded prerequisites satisfy those gates. Retain production
acceptance and cleanup as separate obligations.

## Advance the work

Read [the lifecycle runbook](references/lifecycle.md) before dispatch or remediation. Send one bounded
outcome to its actual owner, with verified target, applicable repository workflow, settled decisions,
prerequisites and recovery context. Do not send the oversight role to implementation workers.

Distinguish planned, dispatched, acknowledged, implemented, reviewed, accepted-for-gate, merged,
deployed and production-accepted. Waiting/blocked is a condition on the stage. A tool receipt proves
only its effect; a task creation does not prove acknowledgement, a green selected check does not prove
full readiness, and merged children do not prove integrated acceptance.

One owner executes heavy verification per constrained host resource. Reviewers consume existing
candidate-bound evidence and request named gaps. Inspect existing consumer tests and fixtures early,
run the smallest relevant behavioral check, batch coherent repairs, and obtain complete final
verification after review convergence on the frozen candidate. Follow
[verification efficiency](../../../docs/engineering/verification-efficiency.md) and
[delivery verification](../../../docs/engineering/delivery-verification.md). Only the delivery contract’s Git-verified prose-only exception may omit full stages;
path-only planning or speculative evidence reuse never grants that exception. Do not repeat full suites for each reviewer or metadata edit.

## Monitoring and reports

Read [monitoring and recovery](references/monitoring.md) for authorized recurrence, reconciliation or
reset. Monitoring is opt-in: editing guidance, adopting oversight or saving a checkpoint creates no
wake. Preserve saved scope, cadence, timezone, notification settings and pause state.

nohmi's existing preference overrides the personal quiet default: end each **scheduled oversight
wake** with a user-visible report, even unchanged, in one or two plain-English sentences (about
40 words maximum). Say what progressed and what is blocked or next; keep hashes and run IDs in the
evidence record. This does not create a schedule or override an explicit user mute/quiet instruction.
Manual check-ins and worker callbacks need only material updates unless regular reports were requested.

For substantive handoffs, report actual artifacts and limits, current stage, owner, remaining gate
and the real next trigger: verified active monitor, bounded wait or user-driven follow-up. Link each
PR/issue with its purpose. Never promise unconfigured unattended work. Completion does not grant
archival, deletion, worktree cleanup or another delivery assignment.

Honor a recorded explicit human cleanup grant within its original scope; do not request the same
permission again. When authorized, the oversight owner archives dedicated child chats only after
all assigned work, acceptance, production verification and follow-up obligations are complete and
the chats are idle. The project manager archives completed oversight chats under its own recorded
grant. Merge alone is insufficient. Preserve unfinished/shared chats and report already-archived
exceptions. This does not authorize branch/worktree deletion or schedule creation; the authorized
owner performs and verifies the eventual UI mutation.
