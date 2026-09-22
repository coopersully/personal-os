# Autonomous development contract

This contract applies when work is explicitly assigned to the development network. It defines
delivery-agent behavior; it does not implement nohmi workspace stewardship or activate a scheduler.
Personal launch skills and live task registries stay outside tracked repository content.

Use [agent handoffs](agent-handoffs.md) for packet, evidence, and revision formats. The
[research note](autonomous-development-research.md) explains the design precedents and deferred
runtime work; it is background for maintainers, not required context for every worker.

## Three roles

| Role | Owns | Delegates |
| --- | --- | --- |
| Automation head | Linear intake, product context, outcome mapping, prioritization within the selected queue, orchestrator assignments, aggregate completion | Every implementation and merge to the appropriate role |
| Orchestrator | One outcome, workstream decomposition, path ownership, dependency order, independent acceptance review, PR gates, final merge | All code, tests, migrations, CI/config fixes, rebases, and conflict resolution to workers |
| Implementation worker | One bounded workstream, implementation plan, code and docs, tests, self-review, PR creation, review responses and fixes | Merge decisions to its orchestrator |

Independent reviewers are auxiliary read-only subagents, not a fourth delivery role. Their dispatch
packets use `role: nohmi-independent-reviewer`; they inspect and report findings without
implementation, file-write, PR-mutation, or merge authority. The orchestrator retains acceptance
and merge ownership.

The head and orchestrator never implement code or make fixes, including one-line fixes, test edits,
workflow changes, conflict resolution, or commits to repair a worker branch. They may inspect code,
run read-only checks, maintain planning records, and update coordination metadata. A correction to
tracked product docs is an implementation assignment too. An Integration owner is a worker with
shared-path responsibility, not permission for an orchestrator to implement.

Workers never merge, enable auto-merge, bypass protection, or approve their own PR as an independent
reviewer. A worker's self-review is required evidence, not GitHub approval. Roles persist across
resume, compaction, subagents, and helper-skill invocation. Switching helpers does not switch roles.
An unavailable worker is resumed or explicitly replaced; its orchestrator does not take over coding.

## Execution model

Keep one persistent automation-head task for the selected queue and one persistent orchestrator
task per coherent outcome. Implementation workers run as subagents by default; an orchestrator
uses a separate read-only reviewer subagent before final acceptance. Skills define role behavior
regardless of whether the host runs that role as a task or subagent. The reviewer reports findings;
the orchestrator retains acceptance and merge responsibility. Reviewers never implement or merge.

Use one implementation worker for a small coherent outcome. Add parallel workers only for independent
work with explicit ownership and stable interfaces. Keep the agent tree shallow: the orchestrator
directly supervises workers and reviewers. Additional nested agents require a concrete independent
subtask and available capacity; do not create a management layer for each implementation step.
Count active agents across the network, including reviewers and nested agents, against host and
user limits. Inspect the host's counting rules rather than assuming a universal slot count.

Give a worker a standalone task only when it needs independent scheduled follow-up, direct ongoing
user collaboration, or a separate execution environment that the subagent host cannot provide.
Record the reason, preserve its dispatch/branch/PR/checkpoint identity, stop the previous executor,
and transfer ownership explicitly. Task creation still requires the user's task-creation authority.
A long CI wait alone is not a reason to promote a worker: the orchestrator owns wakeups and can
resume the worker when actionable feedback arrives.

Subagent persistence, messaging, and restart support vary by host. Discover current capabilities;
do not assume subagents are one-shot or that a prior handle remains usable after restart. Durable
work state lives in the private outcome record, Git branch, PR, and acceptance evidence. Verify the
old executor stopped before replacing it; preserve its worktree and unpushed work during recovery.
Unknown liveness blocks replacement writes rather than allowing two owners to race.

## Epic presentation

Represent each admitted epic with one Codex sidebar section, reusing an existing section when its
identity and membership match. The head records the epic-to-section mapping; its existing outcome
lead maintains members. Use short common-prefix titles, Lead first, then persistent owners in
planned prerequisite/merge order. Order is a navigation aid, not an additional dependency gate.
A portfolio head spanning epics stays outside their individual sections. Do not add another lead
agent or create standalone workers just to fill the sidebar; subagents remain under their parent.

Record section ID, member task/host IDs, exact titles, and intended display order in the private
registry. Confirm all live members before reordering and preserve unrelated members. Reconcile
uncertain section creation before retrying; verify presentation after mutations. Respect explicit
user titles and existing ownership. Section maintenance does not authorize new tasks, schedulers,
project moves, archival, or deletion. A sidebar failure is a presentation gap, not a delivery failure.
The personal launch reference defines the host-specific procedure.

## Intake and dispatch

The head reads only the selected live Nohmi queue. Resolve live project identity and conventions
using `linear-context`; preserve human assignees and existing priority unless directed otherwise.
Search existing issues, PRs, and tasks before allocating work. Establish the intended user journey
from canonical product docs, then map current branches to that goal. Do not let the current diff
define an epic's scope or silently drop an explicit release requirement. Distinguish missing behavior,
inconsistent behavior, and existing behavior that still needs validation. Draft acceptance from
current product docs when the outcome is clear. Missing product intent goes back as a specific question while other
ready work proceeds. Do not invent a requirement to make a vague issue dispatchable.
Reconcile active issues before allocating new work. A canceled, out-of-scope, or newly blocked issue
stops new dispatch, pushes, and merges; signal its children to checkpoint and preserve their branches.

A dispatch contains:

- Role, outcome, non-goals, and parent issue/task references.
- Current product/architecture references and the repository/base identity.
- Observable acceptance criteria, required tests, and delivery evidence.
- Owned paths, shared interfaces, dependencies, and merge order.
- Explicit implementation/merge boundaries and inherited scope authorization.
- Stable dispatch ID, reporting destination, and the next action on completion or blockage.
- Packet and policy revisions, acceptance IDs, effort limits, and criterion-specific evidence needs
  from the [handoff contract](agent-handoffs.md).

Independent workstreams get isolated worktrees and branches. Assign shared files and migration
ordering to one worker; serialize overlapping work. Dependent work starts only when its prerequisite
contract is stable and its base is available. A worker's plan should be proportional to the task.
One coherent issue can have one worker. Keep a vertical feature and its tests under one owner;
capacity is a ceiling, not a target. Do not create a planning/implementation/test hierarchy for an
obvious local change. Reuse the existing outcome orchestrator for related follow-up work.

Reuse existing owners. Use task tools for the head/orchestrators and authorized standalone workers;
use collaboration tools for subagent workers and reviewers. This network contract requests bounded
subagent delegation within assigned outcomes; it does not authorize unrelated task creation.

Create or select an isolated worktree and branch before writable delegation. Give the worker the
absolute path, repository identity, intended base, and owned paths; require every shell/edit/test
operation to target that checkout. A role label or separate context does not isolate files. If the
host shares its parent's working directory, pass explicit working directories or absolute paths;
never change the shared checkout's branch to accommodate another worker. Verify repository/base
identity before editing. These conventions do not provide an OS or credential sandbox.

Give the reviewer current requirements, policy, candidate SHA/diff, and raw verification evidence in
a fresh context, without the worker's conclusions. Review that exact candidate; do not run a review
against files another worker is still changing. Return findings to the implementing owner and repeat
affected review after changes. CodeRabbit and the orchestrator's own acceptance remain required.

## Executor readiness and shared resources

Before treating dispatch as ready, collect a first-turn acknowledgement of the actual repository,
worktree/base, assigned scope, required tools, and effective approval/sandbox/network settings when
exposed. Record evidence time and unknowns. A parent's authorization, global configuration, and an
app permission label do not prove a child inherited the same runtime. Diagnose unexpected approval
requests by exact blocked action and actual governing boundary. Preserve current restrictions;
do not bypass them or repeatedly ask the user to re-authorize already-approved scope. If supported
repair is unavailable, report a precise user action with the affected task's current title/link,
then verify a fresh turn for each repaired executor. Absence of an approval flag is not repair proof.

Separate agent capacity from constrained shared resources. When full verification contends for a
local Docker/runner resource, maintain a bounded queue with one active owner per constrained resource,
worktree, candidate SHA, start time, and completion evidence. Do not serialize unrelated focused
checks or independent runners. Confirm a prior process stopped before transferring its slot; elapsed
time alone cannot release it. Follow checked-in lifecycle commands and give shared environment
failures one diagnosis owner rather than launching duplicate repairs.

Reserve shared migration publication and central composition changes with an implementation owner.
Require the exact prerequisite milestone to be merged and present in the dependent base before
releasing dependent writes. A whole task's "done" status or an unrelated merged PR is insufficient.
Follow the database skill's immutable published-migration rules. If a baseline failure is reproduced
on clean main, map it to one bounded repair issue/owner and keep independent work moving. Do not
weaken tests, expand the feature PR, or create duplicate repair issues to bypass the failure.

## Recoverable coordination

Linear owns delivery state; GitHub owns PR/check/merge facts. A private registry supplements them
with role, executor kind, parent task/host and task or subagent IDs, worktree, branch, owned paths,
dependency IDs, dispatch ID, last observed head/base SHAs, last action, evidence links, blocker,
and next trigger. Never commit the registry.
Make it reachable by the head and orchestrators; a file in one disposable worker worktree is not
sufficient. Record user authorization and queue scope with the network configuration.

Run one head per repository and one orchestrator per outcome. Use an exclusive ownership claim in
the shared private registry before dispatch, and a repository-wide merge claim before final gate
collection. A claim left by an interrupted owner requires live recovery; never reclaim it by age.
Serialize dispatch for the same issue. Record `dispatching` and its unique ID before creating a task
or spawning a subagent; include the ID in its initial prompt and record the returned executor identity.
After a timeout or crash, use the corresponding host's task or agent discovery tools to reconcile
that dispatch before retrying. If discovery cannot prove whether creation succeeded or an executor
stopped, keep the dispatch uncertain; do not create a duplicate writer. Record queued client task
IDs separately from ready task IDs. Never send a subagent ID or queued client ID to a task tool.

On resume, compare the registry with live tasks/subagents, worktrees, Linear, and GitHub before
acting. Reconcile an already merged PR instead of merging again. Transfer ownership explicitly before replacing a worker,
and prevent both old and new owners from pushing. An expired heartbeat alone is not proof that the
original worker stopped. Cross-machine coordination without a shared serialized owner must pause
dispatch for that issue until ownership is established.

Use these network states; map them to existing Linear statuses rather than creating new statuses:
`intake`, `ready`, `dispatching`, `implementing`, `awaiting_review`, `remediation`, `merge_ready`,
`merged`, `blocked`, `canceled`. Keep blockers and successful sibling work independently visible.

## Worker handoff and remediation

Workers report PR URL, exact pushed head, base, acceptance evidence, changed docs, test commands and
results mapped to each acceptance ID, self-review findings/dispositions, CodeRabbit state, remaining
feedback, and blockers. Include packet revision and a resumable next action; a PR URL or process
exit alone is not a completed handoff.
They use `create-pr`, `catchup`, and `resolve-pr-comments` within their assignment. They do not invoke
the merge phase of `ship-it`. Normal assignments authorize in-scope development and PR maintenance;
they do not authorize unrelated scope or weakening security/verification policy.

The orchestrator assesses the current requirements, actual diff, and raw evidence before reading
the worker's conclusions, and records its own criterion verdicts. It routes each finding back to
the owning worker with the defect, expected behavior, evidence, and verification needed. It also
collects the separate read-only review required above; GitHub approval comes from an eligible actor.
After any worker push, all readiness evidence must be reconciled to the new head. Changed acceptance,
ownership, dependencies, or authority also invalidate acceptance even without a push. Deduplicate
repeated CI/review observations into one defect record and follow the handoff contract's no-progress
policy; do not spawn another worker or repeat the same remediation merely because another event arrived.

## Stable final verification

Batch required PR title/body/Work map corrections before collecting final hosted gates. Once the
candidate is frozen, avoid cosmetic metadata churn that starts replacement CI. Necessary corrections
still happen, with fresh evidence for any affected checks. Record workflow/run/attempt IDs, provider,
head, and trigger. A cancelled or failed older attempt may be superseded only by an evidenced
applicable replacement; a same-name success on another head or scope cannot clear it. Pending latest
applicable checks remain waiting. Do not rerun unchanged local verification solely for a metadata
edit when its candidate source and verifier inputs are unchanged; retain the original evidence and
refresh hosted checks. Source/base/verifier-input changes follow the full existing verification gate.

If drafts skip CodeRabbit review, move a ready candidate through the authorized review-ready workflow
and wait for substantive current-diff coverage. A green skipped review is not acceptance. Independent
review still examines the integrated journey and exact destinations/contracts, even after tests pass.

## Merge gates: all must be true

Only the assigned orchestrator merges the assigned PR after verifying:

1. The outcome and acceptance criteria are satisfied, docs and Linear links agree, and independent
   orchestrator review finds no unresolved defect or scope drift. Issue eligibility, acceptance
   packet, and policy revisions are current; a requirement change invalidates an older acceptance.
2. The PR is open and non-draft, the pushed head is exact, dependencies are merged, the head contains
   the current target base, and mergeability is known and conflict-free.
3. Focused verification and `pnpm verify` passed for the candidate head. There are no failed or
   pending selected CI jobs; required checks succeed with the expected provider identity. Discover
   the expected set from current workflow scope and live rules, not just the jobs that appeared.
4. CodeRabbit completed a substantive review covering the current diff, with no unresolved findings.
   Validate bot identity and review coverage. A summary, pending/skipped/rate-limited review,
   historical approval, or absence of comments is not a completed current review.
5. Every review thread is resolved, including outdated threads; actionable top-level comments and
   review summaries are addressed with evidence. Resolve only handled or demonstrably inapplicable
   findings. An unresolved disagreement goes back to the reviewer or head; do not dismiss it merely
   to clear a gate. Required approvals are satisfied and current.
6. The user has authorized this network's merge scope and the actor has normal merge permission.
   The network never changes protections, uses administrator bypass, or leaves deferred auto-merge
   enabled. A queue-only merge path without equivalent final gate enforcement is a blocker.

Reuse `ship-it`'s read-only state schema and `scripts/evaluate_readiness.py` for its existing gates.
Do not invoke its combined implementation/merge workflow. Its `MERGE`/`normal` verdict is necessary
but insufficient: additionally prove zero unresolved threads, independent orchestrator acceptance,
scope ownership, and dependency completion. `AUTO_MERGE`, `admin`, missing data, and unknown states
do not pass this network's gate. The evaluator consumes evidence; it does not authenticate it.

Immediately before merge, re-read PR head/base, all checks, review surfaces, CodeRabbit coverage,
rules, and Linear eligibility, requirements, and links. Rebuild the decision if anything changed.
Merge only the reviewed SHA using
the provider's expected-head condition (for example `gh pr merge <PR> --squash
--match-head-commit <SHA>`). Serialize network merges into the same base. Head matching alone does
not atomically lock the base or reviews: rely on live branch protection to enforce up-to-date checks
and conversation resolution where available, and pause unattended merging if an equivalent gate
cannot be enforced. Do not claim Markdown role instructions create a credential-level boundary.

After an uncertain merge response, read GitHub before retrying. Verify the merged commit and source
head, then update the direct Linear issues only when their outcomes are complete. A parent is done
only when all required child acceptance criteria hold. Merged is not deployed: release-specific
acceptance needs separate production evidence.

## Repetition and control

An external scheduler owns wakeups. One invocation performs bounded useful work, records its next
trigger, and yields while waiting on external events. The head and outcome orchestrators own
scheduled follow-ups; subagent workers have no separate heartbeat by default. During active work,
use bounded agent waits and resume the same worker for actionable remediation. Before yielding,
record the worker's checkpoint, liveness, pending operation, and next trigger. A sleeping parent is
not proof its children stopped; reconcile them on every wakeup. Reuse existing task heartbeats when enabled;
do not create competing schedules. Notify only on meaningful progress, completion, failure, or a
decision requiring the user. Retry transient failures with backoff; stop repeating an unchanged
failing action and report the missing capability or decision.

Treat process liveness, meaningful progress, external waiting, and completion as distinct states.
Record the outstanding external operation and its timeout/backoff so a long CI job is not mistaken
for a stalled worker. A shared authentication, provider, or runner outage pauses new affected work
instead of launching more workers to rediscover the same failure. Resume after fresh recovery evidence.

Track accepted outcomes, remediation rounds, repeated failures, and time waiting for dependencies,
CI, or review. Record token/cost usage only when the host exposes it. The head adjusts admission
within the user's capacity/budget limits; it must not disable gates to improve throughput.

Pausing the head stops new intake. Pausing an outcome stops new dispatches and merges for that
outcome; instruct active workers to checkpoint and stop. Resume from live evidence. Enabling the
network requires an explicit queue scope, reachable task registry, available host tools, and verified
GitHub/Linear/CodeRabbit access. Creating these instructions alone does not start unattended work.

## Useful oversight reports

On an explicit status or ETA request, refresh evidence and lead with accepted/merged outcomes, active
work, the critical dependency, next milestone, and actionable blockers with owner/task links. Distinguish
review-ready, merge-ready, merged, and release-accepted. Give an ETA range and confidence only when
remaining work and observed durations support it; otherwise state the unknown. Include a concise
purpose with every PR number and Linear key. Do not expose private registry or personal source data.

Persist unchanged waits without repeated parent messages or notifications. A new head, completed
milestone, finding, required action, or changed blocker can justify an update; a polling tick alone
cannot. Keep a repeated permission blocker quiet after an actionable report until evidence changes.
