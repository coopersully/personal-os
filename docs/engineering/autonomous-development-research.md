# Development-network research and refinements

Initial research 2026-09-15; execution-model refinement adopted 2026-09-21. This is a comparison of primary project documentation and engineering reports,
not a benchmark or evidence that these systems have been deployed successfully for nohmi. Current
network behavior is defined in [the operating contract](autonomous-development.md).

## Closest precedents

| Source | Relevant pattern | Fit and limitation |
| --- | --- | --- |
| [OpenAI Symphony](https://github.com/openai/symphony) | Tracker-driven, isolated coding runs with work evidence. The project describes itself as an engineering preview for trusted environments. | Closest Codex/Linear precedent. Its service is an optional future backend, not a prerequisite for the current task-based workflow. |
| [Symphony service specification](https://github.com/openai/symphony/blob/main/SPEC.md) | Separates repository policy, scheduler state, workspace management, execution, and observation. Reconciles existing runs before dispatch and refreshes eligibility. | Borrow these responsibility boundaries. A worker exit does not establish issue completion. |
| [Symphony example workflow](https://github.com/openai/symphony/blob/main/elixir/WORKFLOW.md) | Encodes issue-state routing and a landing phase after human acceptance. | Do not copy its worker-side landing or its assumed tracker statuses: nohmi's assigned orchestrator owns merging and uses live Linear metadata. |
| [Agent Orchestrator](https://github.com/Untrivial-ai/agent-orchestrator) | Persistent project planning, isolated workers, attached PR/CI/review state, and feedback returned to the same owner. | Very close to the requested task hierarchy. The former ComposioHQ URL redirects here; older architecture pages may describe earlier versions. |
| [Gas Town](https://github.com/gastownhall/gastown) | Explicit coordination, worker lifecycle monitoring, and a separate merge-queue responsibility. | Useful separation of concerns. Its documented refinery can fix inline, which conflicts with nohmi's non-implementing orchestrator. Its README and design plans should not be treated as proof of every feature's runtime maturity. |
| [Anthropic multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) | Precise delegated objectives, output shapes, boundaries, bounded context, and proportional effort. It notes that tightly dependent coding work is less parallelizable than research. | Strengthen dispatch packets and avoid filling worker slots simply because they exist. Its reported research results are not coding performance guarantees. |
| [Anthropic long-running harnesses](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) | Incremental work, explicit feature verification, and progress records make fresh sessions recoverable. | Require criterion-level evidence and a useful checkpoint instead of relying on the chat transcript. |
| [OpenAI harness engineering](https://openai.com/index/harness-engineering/) | A short instruction entrypoint routes to maintained repository knowledge; mechanical checks protect architectural invariants. | Retain the product decision map and targeted domain docs. Do not expand root guidance into a duplicate product manual. |
| [GitHub Agentic Workflows safe outputs](https://github.github.io/gh-aw/reference/safe-outputs/) | Separate an agent's structured requests from permission-controlled mutation execution. | Model for future role enforcement. File instructions and worktrees alone do not prevent an agent with shared credentials from merging. |

## Decisions applied now

These are nohmi design choices informed by the sources above, not assertions that another project
uses this exact policy.

1. **Keep the three roles.** The head selects and maps work, orchestrators decide acceptance and
   merging, and workers implement. One simple outcome can have one worker; split only when there is
   independently verifiable work with stable boundaries. Keep a feature and its tests with one owner.
2. **Separate judgment from lifecycle mechanics.** Existing host tools and GitHub supply execution
   and live evidence. Head/orchestrator tasks make product and acceptance decisions. A future
   deterministic coordinator would handle claims, retries, event deduplication, and dispatch state.
   Adding more supervisory LLM roles is not the default response to an operational gap.
3. **Make handoffs explicit.** Use versioned dispatch packets, acceptance IDs, compact context links,
   criterion-to-evidence rows, checkpoints, and separate independent acceptance records. See
   [agent handoffs](agent-handoffs.md).
4. **React once per defect.** Combine repeated CI/review observations, return them to the original
   owner, record attempts, and pause unproductive loops. Track useful progress separately from
   process activity. Honor provider backoff and pause affected dispatch during shared outages.
5. **Reconcile live intent.** Cancellations and material requirement changes affect running work and
   invalidate acceptance even when the code did not change. Instruction revisions are recorded;
   editing a skill cannot silently increase a running agent's authority.
6. **Preserve independent review.** Worker self-review and CodeRabbit are inputs. The orchestrator
   also examines requirements, diff, and raw evidence. Copying old conclusions into a new task does
   not constitute fresh review; independence requires a new assessment.
7. **Measure the pilot before scaling.** Start with one orchestrator and at most two workers. Watch
   accepted outcomes, remediation rounds, repeat failures, time awaiting dependencies/review/CI,
   and available usage data. Unknown cost stays unknown. Increase concurrency only when tasks are
   independent and downstream review/merge capacity can absorb them.

## Task and subagent comparison

Adopt a hybrid: persistent head/outcome tasks own scheduling and acceptance; implementation and
independent review subagents perform bounded work. This is a capability-based architecture decision,
not a measured performance winner. Skills describe roles and apply to either execution mechanism.

| Evidence | Design consequence and limit |
| --- | --- |
| [Codex subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents) documents separate agent contexts, surfaced agent threads, and parallel delegation. | Standalone tasks are not necessary just to separate context. Keep worker logs out of oversight context and supply scoped packets. Parallel writing still requires ownership and integration. |
| [Codex scheduled tasks](https://learn.chatgpt.com/docs/automations?surface=app) can revisit an existing conversation; local execution requires the host and app running. | Persistent outcome owners handle CI/review wakeups. A stored task does not execute continuously, and a worker need not have its own schedule. |
| [Codex worktrees](https://learn.chatgpt.com/docs/environments/git-worktrees) provide separate checkouts. The collaboration tools inspected for this workflow share the parent's directory by default. | Explicitly assign isolated writable worktrees. Context isolation is not filesystem or credential isolation. |
| [Claude subagents](https://code.claude.com/docs/en/sub-agents) documents worktree isolation, follow-up, and transcript recovery after resuming the same session following restart. | Do not equate subagents with disposable one-shot runs. This is Claude evidence, not proof of Codex restart behavior. Discover the actual host's recovery controls. |
| Symphony separates persistent issue/workspace identity from individual run attempts. | Preserve outcome/branch/PR/checkpoint identity through executor replacement. Require stopped-owner evidence before permitting a replacement to write. |

Standalone workers remain appropriate for independent schedules, sustained direct user collaboration,
or execution environments a subagent host cannot supply. Keep the default tree shallow and count
reviewers/nested agents against actual host limits. Do not assume the same slot count on every host.

Prior skill scenario checks exercised instruction behavior; they did not measure issue-to-merge
performance, restart recovery, cost, or defect rates. Anthropic's reported research-evaluation gains
compare multi-agent research with a single agent, not standalone coding tasks with coding subagents.
A future comparison should use matched nohmi outcomes, the same base/model/effort and role contracts,
identical acceptance and merge gates, and independent review. Record accepted outcomes, elapsed time,
remediation rounds, duplicate dispatches, recovery interventions, and usage where exposed. Include
an interrupted-run case. Do not report a speed/cost advantage until measured, or run live merge
experiments without corresponding scope authorization.

## Structure of the skills

- Root `AGENTS.md`/`CLAUDE.md`: product orientation, shared invariants, role boundary, and routing.
- Each personal `SKILL.md`: role, trigger, decision procedure, next action, and reporting contract.
- [Operating contract](autonomous-development.md): shared ownership, recovery, and merge rules.
- [Handoff contract](agent-handoffs.md): packet fields, evidence shape, remediation, and revision rules.
- Personal launch reference: local registry, host adaptation, capacity, authorization, and bootstrap.
- This research note: rationale and sources, loaded for workflow changes rather than every worker run.

## Later implementation, if the pilot justifies it

The current deliverable remains guidance for persistent oversight tasks and subagent execution. No Symphony service, third-party orchestrator,
webhook listener, permission broker, or autonomous merge daemon was installed by this research.

A stronger backend should have a single writer for scheduling state, validated packet/event schemas,
deduplicated observations, resumable workspace identity, bounded retry and admission controls, and
an authenticated merge operation restricted to the assigned orchestrator and reviewed candidate.
It must check all nohmi gates at execution and reject workers' merge requests regardless of prompt.
Worker edits must not be able to change the controller policy that evaluates their own work.

Such a backend can run under the existing task oversight model. Evaluate Symphony or Agent
Orchestrator against those requirements before building custom infrastructure. A new backend must
retain the current Linear source of truth, role separation, CodeRabbit requirement, and exact-head
merge checks. It needs real integration/recovery tests; Markdown validation is insufficient.

The first live pilot should demonstrate one complete issue-to-merge outcome plus an interrupted
handoff, duplicate notification, cancellation, unchanged-SHA requirement change, and stale review.
Do not use throughput alone as a success measure or silently loosen gates to improve it.

## Finance delivery experience (2026-09-22)

A read-only audit of an existing Finance epic's lead-task history and live Codex section informed
these refinements. This is qualitative workflow evidence, not a controlled performance evaluation;
permission observations describe historical runtime records, not a proven underlying app defect.
Private task identifiers and personal financial source material stay outside repository docs.

- A user correction redirected planning from the current changelist to the canonical product journey.
  Intake now maps existing branches into the intended outcome and preserves explicit release targets.
- The user requested short common-prefix names, delivery ordering, and direct links to blocked tasks.
  Each admitted epic now gets a recorded, reusable sidebar section with its existing lead first.
- Several workers had restricted runtime settings despite expected Full Access. Executor readiness
  now distinguishes intended authority from observed settings, diagnoses the specific boundary, and
  verifies each repair in a fresh turn. It does not attempt to change security policy through prompts.
- Explicit prerequisite milestones, shared composition ownership, migration reservations, and a full
  verification queue made contention visible. These become resource-aware admission rules rather
  than a universal requirement to serialize all work.
- Required metadata corrections triggered replacement CI. Final collection now avoids cosmetic
  changes and records applicable attempts. A draft's green CodeRabbit status could represent a skip;
  substantive coverage remains mandatory. Independent review found a navigation defect after tests
  passed, supporting review of integrated behavior rather than trusting test counts alone.
- Repeated wait/approval reports and explicit status/ETA questions show the need for concise milestone
  reporting, linked actions, honest uncertainty, and silence on unchanged observations.

The existing Finance epic remains under its current owners. Updating these instructions neither
retrofits a live assignment's authority nor launches or alters its scheduler.
