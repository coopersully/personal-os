# Epic planning and launch

This is the nohmi procedure for repository `oversight` and the personal head/orchestrator skills.
The self-contained repository oversight skill supplies lifecycle and monitoring runbooks; the
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
For a single-owner outcome, that worker owns integration on its existing branch. Name a separate
composition worker and rolling integration branch only for genuine cross-owner integration needs;
never add either as launch ceremony. Preserve one owner for shared paths and consumer verification.

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
3. Complete the [mandatory oversight kickoff/adoption gate](../../.agents/skills/oversight/SKILL.md#mandatory-kickoff-and-adoption-gate)
   before implementation dispatch. Inspect context/current owners; reuse or create the outcome
   section, resolve/link direct Nohmi issues and dependencies, name/place dedicated existing chats,
   and retain verified receipts/IDs in the outcome entry of the existing private network registry;
   direct issues reference it as defined by the gate. Preserve explicit user titles
   and unrelated/shared chats; subagents do not get sidebar rows. Resumes repair only missing setup.
   UI/tracker failure leaves setup incomplete and blocks new implementation dispatch and an
   established-oversight claim. Continue read-only context gathering; do not interrupt already-running
   authorized owners or duplicate them. Reconcile partial effects before retrying.
4. Reserve each dispatch and claim before creation. Persistent head/outcome chats use app task tools;
   implementation/review subagents use collaboration tools. Follow [agent handoffs](agent-handoffs.md)
   for typed IDs, packet revisions and acknowledgements. Separately authorized new chats begin with
   setup/context only; verify their names, membership and issue links before implementation dispatch.
   Queued tasks are not ready. Unknown creation or owner liveness requires reconciliation, not retry
   that could create another writer. Establish stopped ownership and transfer before replacement.
5. Require executor acknowledgement of scope, checkout/base, tools and runtime before marking it
   active. Release dependent writes when the exact prerequisite milestone is evidenced on the
   integration base: stable reviewed source may suffice for source inclusion; an explicitly required
   merged prerequisite must be merged and present. Preserve migration/publication constraints. Budget
   slots for workers and reviewers; reserve scarce verification resources separately.
6. Establish the real next trigger: bounded waits while active, a saved scoped heartbeat for
   authorized recurring work. Reuse matching monitors and preserve cadence/timezone. Apply the
   oversight skill’s scheduled-report preference (short visible report even unchanged), unless the
   user explicitly requests quiet/muted reporting. A checkpoint is not a scheduler. Without a wakeup,
   report waiting and the responsible owner
   rather than claim unattended execution is running.

Report planned, admitted, dispatched, acknowledged/running and waiting separately with actual owner
and section links and blockers. Chat creation alone does not prove a successful launch.

## Accept and close

Use repository `deep-review`, [acceptance](acceptance-contract.md), and role-preserving `handoff`.
Only the assigned authorized orchestrator merges after every current protected gate, including
current independent deep-review acceptance and zero unresolved threads. Delegate every repair to workers.
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

Every oversight heartbeat performs the repository oversight skill’s
[tracking and presentation check](../../.agents/skills/oversight/SKILL.md#every-oversight-heartbeat-tracking-and-presentation):
live section name/membership/order and durable subject chat titles, preserving accurate titles across
phases and issue changes and retaining explicit user title choices,
bounded drift repair and readback into the existing setup record. Do this even when source revisions
are unchanged; broader reconciliation deadlines do not defer it. Preserve protected/shared chats and
record missing-source or failed-write gaps before any dependent dispatch.

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
