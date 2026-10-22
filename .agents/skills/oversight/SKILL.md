---
name: oversight
description: Plan and coordinate nohmi epics, Linear child tasks, Codex epic sections, and delivery owners. Use for nohmi project oversight or explicit network launch; ordinary implementation retains its workflow.
---

# nohmi oversight

Use `docs/engineering/development-handbook.md` and its offline planner to identify missing steps
and reusable receipts. This does not replace this skill's authority, role or acceptance gates.

Read `docs/engineering/epic-delivery.md` for planning/admission and launch, then
`autonomous-development.md` for role boundaries and `agent-handoffs.md` for dispatch records.
Generic SWE `oversight` supplies common coordination behavior when available; repository contracts
govern nohmi-specific authority, acceptance and delivery. This entrypoint is self-contained through
those repository documents and does not require a personal installation.

Distinguish planning, adopting existing work, launching execution and reporting status from the
request. Editing these workflows does not launch an epic. Start with canonical product intent,
discover existing issues/chats/owners, and reuse them. Small ordinary contributions need no epic.
Keep planning in the existing Linear parent/children and private registry.

For queue intake use the existing `nohmi-automation-head` role; for an assigned outcome use
`nohmi-orchestrator`. Read the installed role skill when available; otherwise apply the repository
role contract and report missing launch/recovery capabilities. Oversight is a coordination procedure
for those roles, not another agent above them. Neither head nor orchestrator implements; only an
authorized orchestrator merges. Workers never merge.

For new or replacement implementation worker chats, default to **GPT-6.1-Sol Light**: explicitly set
`model="gpt-6.1-sol"` and reasoning `low` (`thinking="low"` in chat tools), unless the user explicitly
overrides it. Record and preserve this preference when resuming workers. This default applies only
to implementation workers; preserve Lead and independent reviewer settings. If the requested model
or reasoning setting is unavailable, report the dispatch blocker instead of silently choosing a fallback.

Prepare the epic admission record before dispatch. Preserve existing explicit grants; ask only for
missing decisions or authority after making the plan concrete. New user-owned chats require explicit
task-creation authorization. Messaging, Linear writes, sidebar organization, recurring follow-ups
and merging stay within recorded scope. A launch request may grant these together; this skill does not.

Create/reuse the epic section within organization authority, using live app identities and readback.
Keep Lead first and subagents beneath their owner. Reserve dispatches before creation, verify executor
acknowledgements and exact prerequisite milestones, and record a real next wakeup. Missing capabilities
block the affected operation; keep independent authorized work moving.

Use repository `deep-review` and `handoff` within the assigned role. Track merged, deployed and
production-accepted separately. Preserve current independent deep-review acceptance, zero unresolved
threads and every protected merge gate. Route repairs to workers; never invoke a combined
implementation workflow as head/orchestrator. Close the epic only after integrated acceptance and
required production evidence pass, not merely when child PRs merge.

## Scheduled status reports

End every scheduled oversight wake with a user-visible report, even when nothing has changed.
This requirement supersedes quiet-on-unchanged guidance for scheduled oversight wakes. Use one or
two short sentences, about 40 words maximum, in plain English: say what is done or happening and
what is blocked, next, or being waited on. For unchanged state, say there is no change and what
must happen next; never imply that waiting proves completion.

Keep hashes, run IDs and internal jargon in evidence records, outside this report. Do not recite
coordination procedures or report every tool operation or worker callback. For example: “The
spending checks passed. The remaining fixes are still being tested before the final review.”
An unchanged report could say: “No change since the last update. We are waiting for the final
tests to finish.” This reporting rule does not create schedules, change their cadence, or grant
implementation, acceptance or merge authority.

## Keep delivery moving

For changes to shared contracts, migrations, audit/idempotency, locking, authorization or UI modes,
name an owner for affected existing transitive consumers and fixtures early. Run those existing
consumer test files, including setup and teardown, alongside new tests before the final freeze;
new happy-path tests alone are insufficient. Keep the affected list and evidence in the existing
handoff record, and have independent review check for omissions. Focused proof does not replace
required checks on the complete frozen candidate and actual target base.

Name the composition worker at launch and maintain a separate rolling integration branch through
normal merges of independently reviewed slices as they become source-ready, without waiting for
unrelated slices. Distinguish source-inclusion prerequisites from actual merge, release and
observation prerequisites: reviewed source may enter an authorized composition before its separate
PR merges, but a required merged prerequisite must actually be merged and present. Never change a
checkout while it is being tested; integrate after its resource owner has completed cleanup.

After initial scope and checkout acknowledgement, give one bounded conditional grant naming exact
prerequisite evidence, permitted effects and source restrictions, resource owner, retry bounds and
stop conditions. The owner verifies and records those conditions before continuing or resuming;
unchanged conditions require no additional acknowledgement. Re-read current ownership on resume:
a recorded transfer overrides an older grant. Stop and return to Lead on changed scope, uncertain
ownership, a new failure class, or a new product/security decision. This never grants blanket
retries, duplicate effects, human financial approval, or another role's acceptance/merge authority.
Use existing records rather than creating a new process artifact for each slice.
