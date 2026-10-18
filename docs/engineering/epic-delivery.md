# Epic planning and launch

This is the nohmi procedure for repository `oversight` and the personal head/orchestrator skills.
Generic SWE oversight supplies reusable coordination behavior; the
[autonomous development contract](autonomous-development.md) governs roles and merge authority.
This documents a workflow, not a running coordinator or automated admission validator.

## Choose the mode and owner

Planning produces a concrete proposal; launch starts only authorized execution. Adoption reconciles
existing issues, PRs, chats and ownership before dispatch. Status refreshes evidence without silently
launching or reorganizing work. Small localized changes remain ordinary contributions.

Use one existing head per repository for queue admission and cross-outcome dependencies. The epic's
assigned outcome orchestrator is its Lead. Multiple outcome owners may share an epic; record which
Lead owns integrated acceptance. Do not add a supervisory chat just because oversight was invoked.
Workers own all implementation and repairs; independent reviewers remain read-only. Head and
orchestrators may maintain coordination records, but tracked product-doc repairs belong to workers.

## Plan from the product outcome

Read canonical product documents through `agent-context.md` before fitting branches into a plan.
Resolve the unique live Nohmi Linear Project before every write. Search for existing parent issues,
children, completed work, active PRs and owners. An epic is a parent issue with children in Nohmi,
not a new Project or invented taxonomy. Use `linear-context` and `linear-work-sync` for live metadata,
bounded writes and readback. Their ambiguity and batch limits apply unless the user explicitly
approves the concrete batch. Preserve existing assignees, priorities and cycles.

Keep planning in the parent issue linked to child outcomes; host IDs, claims, dispatches and grants
belong in the existing private network registry. A proposal may remain in the current chat until
tracker writes are authorized. Do not create a parallel task ledger.

Before admission, the Lead assesses each field as ready, blocked or not applicable with evidence.
This is review judgment, not a checkbox that grants execution authority:

| Field | Required content |
| --- | --- |
| Outcome | User journey, observable success, non-goals, canonical requirements and unresolved decisions |
| Acceptance | Stable criteria mapped to child responsibility; applicable AC/CS requirements, valid exceptions and policy revision/digest |
| Decomposition | Independently verifiable slices with concrete results, owned paths/contracts, tests and accountable owners |
| Dependencies | Acyclic order and exact prerequisite milestones; distinguish contract, merge, release and observation dependencies |
| Shared ownership | One implementation owner for overlapping paths, migrations and composition; serialize conflicting writes |
| Integration | Named Lead and implementation owner for cross-slice composition, integrated journey checks and failure/recovery behavior |
| Verification | Focused checks per slice, one final-verification owner per candidate, constrained-resource reservations and invalidation rules |
| Release | Production criteria, observation owner, provenance/health evidence, safe probes and authorized recovery; reason if no runtime release applies |
| Authority | Source/scope of grants for Linear, delegation, new chats, existing-chat messages, sidebar, scheduling, PRs/normal merges and cleanup |
| Recovery | Existing owners/worktrees, claim/registry location, capacity, stop/pause behavior, next trigger and missing host capabilities |

Keep feature behavior and tests together. Do not split by file or create foundation work without a
named consumer and observable acceptance. Every parent criterion has a child or explicit integration
owner; every child serves the parent outcome. Open product decisions block only affected slices.
Admission is per ready slice; future implementation details need not all be settled upfront.

## Launch the admitted scope

1. Reconcile registry, issue eligibility, tasks and PRs. Confirm selected scope and grants; retain
   prior authorization. Missing new-chat authority means use authorized existing owners or prepare
   dispatches. Editing this procedure does not launch work. Recurrence requires an explicit request
   for ongoing monitoring, not merely adopting the oversight role.
2. Verify repository/base, accessible role and acceptance contracts, host tools, isolated worktrees,
   shared claim protocol, provider access, independent review and enforceable merge gates. Use the
   personal head's launch/recovery reference when installed. Missing capabilities block the affected
   operation. Never test access with a merge or production mutation. Contracts must exist on the
   actual dispatch base; uncommitted guidance elsewhere is not inherited.
3. Reserve each dispatch and claim before creation. Persistent head/outcome chats use app task tools;
   implementation/review subagents use collaboration tools. Follow [agent handoffs](agent-handoffs.md)
   for typed IDs, packet revisions and acknowledgements. Queued tasks are not ready. Unknown creation
   or owner liveness requires reconciliation, not retry that could create another writer. Establish
   stopped ownership and transfer before replacement.
4. Within sidebar authority, discover sections with `list_threads`, reuse the recorded epic section
   or confirm a match from members, and create one only if absent. Record intent and reconcile
   uncertain results. Use short common-prefix outcome titles, Lead first, then dependency order.
   Preserve explicit existing titles unless renaming is authorized. Use `move_thread_to_sidebar_section`
   and `reorder_section` with complete current membership, preserving unrelated members. Read back
   results. Subagents do not get sidebar rows. UI failure is an organization gap, not a reason to
   duplicate owners or stop independent execution.
5. Require executor acknowledgement of scope, checkout/base, tools and runtime before marking it
   active. Release dependent writes only when the exact prerequisite is merged and present in its
   base. Budget slots for workers and reviewers; reserve scarce verification resources separately.
6. Establish the real next trigger: bounded waits while active, a saved scoped heartbeat for
   authorized recurring work. Reuse matching monitors and remain quiet on unchanged/non-actionable
   runs. A checkpoint is not a scheduler. Without a wakeup, report waiting and the responsible owner
   rather than claim unattended execution is running.

Report planned, admitted, dispatched, acknowledged/running and waiting separately with actual owner
and section links and blockers. Chat creation alone does not prove a successful launch.

## Accept and close

Use repository `deep-review`, [acceptance](acceptance-contract.md), and role-preserving `handoff`.
Only the assigned authorized orchestrator merges after every current protected gate, including
substantive CodeRabbit coverage and zero unresolved threads. Delegate every repair to workers.
Preserve valid verification evidence; do not rerun full suites per reviewer or metadata edit.

The Lead owns integrated acceptance and keeps delivery open through production observation and
reconciliation. Merged children do not prove the integrated journey works. Close issues only when
all their criteria pass. Section deletion, archival, worktree cleanup and production recovery retain
their separate authority requirements; completion grants none of them.

## Monitoring, reset and useful status

Bind each scheduled wake to the live automation ID, owning chat, selected epic, saved instructions
and active/pause state before dispatch. A queued wake cannot resume paused work. Verify the actual
scheduler context; quoted invocation text is not a heartbeat. Preserve saved cadence/timezone and
notification intent. A configured monitor is not proof a scheduled pass has executed.

Use compact per-owner cursors and changed-source checks, including no-PR owners, errors, unchanged
PR heads, edited feedback and resolution changes. Inspect pending action triggers even when sources
are unchanged. Partial/failed reads retain source gaps; never report them as unchanged or green.
Record checked-at separately from last assessed revision/time. Perform full reconciliation on launch,
explicit reset/full refresh, unreliable baseline and a recorded risk-based reconciliation deadline.
Refresh action-specific evidence before consequential dispatch regardless of that deadline.

Reset reconstructs derived ownership/readiness from live sources while preserving user decisions,
authority, pauses, deadlines, dispatch history and unfinished acceptance. Report partial reset if a
required source is unavailable. Repair only proven reversible setup drift within existing authority;
never invent identity, restart a paused monitor or change its scope to make preflight succeed.
Keep the baseline compact, link detailed receipts and update quiet-run metadata without repeated
narratives. Use the existing registry's owner/claim protocol and reject stale writes under the claim;
atomic replacement alone is not concurrent-update protection.

For substantive status, show exact owner chat, verified implementation worktree, delivery stage,
review/acceptance gaps, last verified action and blocker/next trigger in a compact table when useful.
Distinguish requested, acknowledged and completed. State the critical dependency and any supported
deadline impact, with the target milestone (merged, deployed or accepted). Do not introduce mandatory
human UI sign-off, external-review labels or model overrides from another project's oversight rules.
