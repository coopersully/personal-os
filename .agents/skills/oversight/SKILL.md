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

Prepare the epic admission record before dispatch. Preserve existing explicit grants; ask only for
missing decisions or authority after making the plan concrete. New user-owned chats require explicit
task-creation authorization. Messaging, Linear writes, sidebar organization, recurring follow-ups
and merging stay within recorded scope. A launch request may grant these together; this skill does not.

Create/reuse the epic section within organization authority, using live app identities and readback.
Keep Lead first and subagents beneath their owner. Reserve dispatches before creation, verify executor
acknowledgements and exact prerequisite milestones, and record a real next wakeup. Missing capabilities
block the affected operation; keep independent authorized work moving.

Use repository `deep-review` and `handoff` within the assigned role. Track merged, deployed and
production-accepted separately. Preserve current substantive CodeRabbit coverage, zero unresolved
threads and every protected merge gate. Route repairs to workers; never invoke a combined
implementation workflow as head/orchestrator. Close the epic only after integrated acceptance and
required production evidence pass, not merely when child PRs merge.
