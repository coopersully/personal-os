# Sources, issue loading and queues

Use the available Linear connector for delivery state, GitHub connector for PR/check/review facts,
and Codex chat/project tools for actual ownership and checkout identity. Discover supported tools
before acting. An authenticated repository CLI is a fallback when connector capability is missing;
verify repository/account identity, pagination and permissions. Tool failure never means no work.
For product-state evidence through nohmi tools, call get_ilo_context first, inspect authoritative
state, use required previews, and verify returned effects. Do not use product APIs as a second
engineering tracker. Never copy Occupi connector IDs, labels, commands or credentials.

## Load and retain the complete assigned scope

1. Resolve the unique live Nohmi Linear Project. Read the parent, all scoped children and relations,
   completed deliverables, relevant comments/attachments and existing owners. Finish pagination.
   Follow repository linear-context and work-context; no cross-project or guessed writes.
2. Reconcile direct issues with actual PR URLs, head/base, branches/worktrees and live/archived chat
   IDs. Inspect no-PR work too. Similar titles, idle chats or stale branches do not prove ownership.
3. Load prerequisite issues/branches and the milestone each consumer needs. Admit only assigned
   ready work, preserve priority and human assignee, and reuse the existing issue/chat owner.
   Related backlog is not authorized scope. Testing/review are gates, not workstream dependencies.
4. Save the inventory and compact checkpoints in existing continuity: issue/parent, owner/chat,
   branch/worktree/PR head/base, scope, stage, acceptance, prerequisite milestone, grants/pauses,
   last checked/evidence, pending dispatch receipt and next trigger. Link detailed evidence.
5. Refresh changed records incrementally, including edited feedback on unchanged heads. Reconcile
   full scope on adoption/reset, unreliable reads and the recorded reconciliation deadline.
   Recover missing evidence before reporting; a partial read never establishes full coverage.

Linear owns work state; the existing private outcome registry owns execution claims and continuity.
Resolve the live Project before every tracker write, preserve unrelated metadata, deduplicate and
read back effects. Keep In Progress while required PRs or acceptance remain. Close only on full
acceptance. Follow create-pr for Work maps and structured backlinks. An unchanged heartbeat reports
in chat without adding repetitive Linear comments.

## Two distinct queues

The delivery backlog is the assigned Linear issue/dependency graph. Reserve dispatch and reconcile
acknowledgement through the existing network claim protocol; never create another queue database.

Heavy verification uses Nohmi's existing [shared local capacity](../../../../docs/engineering/delivery-verification.md#shared-local-capacity):
`pnpm verify` enters `.codex/scripts/verification-runner.py`, whose host/user OS lock spans worktrees.
Exit 75 means queued: retain the waiting owner and release-triggered retry; it is not a failed test
or a FIFO reservation. Exit 78 cannot supply candidate acceptance evidence. Never remove a lock,
kill another owner or duplicate its verifier. Inventory older/ad hoc runs that do not participate.
Use the current frozen-candidate verification contract and its proven prose-only exception.
No Occupi queue helper, monitor runtime or scheduler is installed by this skill. Do not claim FIFO
fairness, automatic retry or unattended continuation without an actual supporting runtime.
