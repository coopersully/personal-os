# Tasks workspace charter

**Status:** Approved direction; living ledger and surgical foundation implemented

**Last reconciled:** 2026-09-10

This charter applies the [workspace stewardship model](./workspace-stewardship.md) to the
existing Tasks workspace. The two approved 2026-08-12 Tasks and Tracking specifications remain the
normative ontology, classifier, and research basis. This charter names what the current foundation
actually ships and what a future maintenance slice must still prove.

## 1. Purpose and promise

- **Workspace:** Tasks, covering the person's finite commitments. Reminders remain a separate
  compatibility domain, and repeated observations or habits belong to the planned Tracking
  workspace.
- **User outcome:** The person can capture, organize, schedule, complete, cancel, trash, restore,
  and query finite work without confusing lifecycle, time, location, or delivery prompts.
- **Steward promise:** Keep the person's commitment ledger structurally trustworthy and make every
  authorized change explicit, revision-safe, recoverable where promised, and visible in activity.
- **Explicit non-goals:** This workspace does not diagnose, prescribe a life philosophy, manufacture
  urgency, silently reprioritize or reschedule work, treat a Project as a Task, or claim that an
  unfinished maintenance process has made the workspace healthy.

## 2. Living ledger

The implemented canonical records are Views, Lists, Projects, and Tasks:

- a View is a query and owns no material;
- every person owns one protected system Inbox plus zero or more Lists;
- a Project is one finite outcome inside exactly one List;
- a Task is one independently completable action in exactly one List and optionally one same-List
  Project.

Task and Project lifecycle is `open | completed | cancelled`. Deadline (`dueAt`), reserved time
(`scheduledAt`), container availability, and deletion are independent axes. Lists, Projects, and
Tasks are local-only in the current slice. Their public source reference is derived from stable ID
and revision; callers cannot supply it. Writes use positive revisions, bounded idempotency, actor
and policy provenance, and append-only redacted audit evidence.

Task rows still share the physical `reminders` table with Reminder rows. Kind-scoped services,
checks, foreign keys, and separate public contracts make that a transitional storage detail rather
than shared domain ownership. Physical extraction remains an Integration/database migration.

Provider projections, persisted questions, rules, derived workload models, and review artifacts do
not yet exist for Tasks. The target performs a one-time import from external task providers and then
uses nohmi as the authoritative working workspace. The person may explicitly re-trigger an import,
but it is heavily rate-limited and represented as a bounded, auditable import run. Stable provider
identities and content fingerprints deduplicate unchanged and cross-import material; new external
commitments may be added, while matched source changes never silently overwrite nohmi-owned edits
and conflicts enter review. Continuous inbound ingestion and bidirectional synchronization with
multiple providers remain intentionally open future options rather than current goals; any provider
source must define authority, freshness, reconciliation, degraded state, and source-selection
privacy before it enters the ledger.

The long-lived organizational container above Projects remains required. A Project is a finite
outcome; the higher container represents a durable responsibility or context and may contain
multiple Projects and standalone Tasks.

The naming question concerns only that container's user-facing label, not whether the layer exists:

| Candidate | Benefit | Cost |
| --- | --- | --- |
| Lists | Familiar, flexible, and already shipped | Describes a collection more than its long-lived meaning |
| Spaces | Friendly and clearly broader than a Project | Can imply collaboration or a general content hub |
| Categories | Immediately understandable | Can be confused with tags and does not strongly convey ownership |
| Domains | Semantically precise for an enduring part of life | Sounds technical and clinical |

**Lists** remains the provisional label because it avoids a premature migration and is familiar in
task applications. **Areas** is not the default; a later product review may choose a better label
without changing the required hierarchy or source-of-truth contract.

## 3. Expert playbook

| Discipline | Responsibilities reproduced | Basis | Limits |
| --- | --- | --- | --- |
| Project manager | Keep finite outcomes separate from next actions; preserve explicit List and Project context | Approved ontology and the GTD planning hierarchy cited there | Does not infer organizational meaning that the person did not supply |
| Prioritization and workload planner | Distinguish deadline from reserved time; support executable plans and honest Today capacity | Implementation-intention and plan-formation research cited by the ontology | Does not silently choose priorities, dates, or schedules |
| Behavior-change designer | Use prompts as optional cognitive offloading and keep habits/repeated observations in Tracking | Reminder and habit research cited by the ontology | Does not impose streaks, fixed habit-formation periods, wellness claims, or diagnosis |
| Reviewer | Identify structural conflicts, stale assumptions, and recovery needs with source and revision evidence | nohmi audit, policy, and optimistic-concurrency contracts | Does not claim professional certification or infer success from process completion |

The research interpretation and source links live in
[the ontology specification](../superpowers/specs/2026-08-12-tasks-tracking-ontology-classification-design.md#research-interpretation).
The playbook is a versioned product contract; it must not move into MCP descriptions, a host prompt,
or model memory.

## 4. Definition of maintained

The shipped foundation can establish only structural conditions:

- one active protected Inbox exists for the person;
- every non-deleted Task has one owned List and at most one compatible same-List Project;
- ordinary navigation excludes archived Lists and non-open or archived Projects;
- lifecycle, timing, availability, and deletion satisfy their independent invariants;
- unresolved container transitions return exact revision-bound conflicts;
- recoverable Trash has a valid restoration path, falling back to active Inbox or detaching an
  unavailable Project when its original placement is no longer valid; and
- every material mutation has actor, policy, source, request, revision, and redacted audit evidence.

These checks are not yet a domain status result. Tasks does not ship persisted health, stale-decision
checks, questions, a latest review artifact, or the terminal statuses `maintained`,
`maintained_with_questions`, `blocked`, and `failed`. No current API or MCP tool may claim them.

## 5. Surgical operations

The public API, typed client, web workspace, and MCP adapter ship narrow operations for:

- listing, reading, creating, updating, and archiving Lists;
- listing, reading, creating, updating, completing, cancelling, archiving, previewing moves for,
  and moving Projects; and
- listing, reading, creating, updating, completing, reopening, cancelling, trashing, restoring,
  previewing moves for, and moving Tasks.

Reads and move previews require `tasks:read`; mutations require `tasks:write`. Container and Task
moves bind previews to exact candidates and revisions. Mutations preserve idempotency where retries
could duplicate work, reject stale revisions, emit per-entity audit evidence, and surface recovery
conflicts instead of inventing a result. Permanent Task deletion is not public; deprecated
`DELETE /v1/tasks/:id` remains only a compatibility alias for Trash.

## 6. Maintenance turn

A future Tasks maintenance turn may inspect `all`, a bounded time window, or an exact List, Project,
or Task. It must establish an evidence cutoff, inspect the ledger, detect invalid or stale planning
assumptions, retrieve a purpose-bound User Knowledge context pack, apply only approved rules, queue
genuine questions, recompute workload/advice, publish a review, and verify the resulting state.

Before that loop, guided setup should import supported external commitments once, learn how the person
wants to capture, group, prioritize, schedule, and review work, then propose an initial
organization and rulebook. nohmi becomes the authoritative working workspace after import. A later
explicit re-import is a rate-limited migration run that adds new material and reconciles duplicates
without treating the provider as a continuously authoritative source; continuous inbound or
bidirectional provider synchronization remains a possible future extension rather than a setup
promise.

That workflow is not implemented. Tasks has no durable maintenance run/step persistence, leases,
fencing, resume/cancel behavior, retry budget, status endpoint, or `maintain_tasks` MCP tool. Those
capabilities require a separately approved vertical slice and production-equivalent evidence; they
must not be simulated as a client-authored sequence of the existing surgical tools.

## 7. Rulebook, questions, and learning

The current ledger stores explicit Task material, not inferred user rules or a complete model of the
person. A future steward may propose knowledge about placement, timing, planning, capacity, or
review preferences under the shared [`User Knowledge`](user-knowledge.md) contract. Automatic
promotion requires independent reinforcement or successful reuse and is limited to reversible
knowledge categories; it cannot increase authority, activate an external action rule, or bypass
stricter confirmation for a sensitive or high-impact claim. Reusable mutation rules retain their
explicit domain policy boundary. Rules must carry scope, evidence, version, confidence, exceptions,
disablement, rollback, and the records to re-evaluate.

Persisted questions, answer provenance, deduplication, and learning behavior are not implemented.
Natural-language classification and its golden corpus also remain design data; no classifier may
mutate on ambiguous, query, or out-of-domain input.

## 8. Analysis, advice, and review artifact

Today currently composes open Tasks that are overdue or due/reserved in the person's local day and
reports complete paginated counts. That is a bounded product projection, not a Tasks health model or
maintenance review.

A future review must disclose scope, evidence cutoff, freshness, changes, workload and timing risks,
outstanding questions, assumptions, confidence, approved rules, recommendations, and recovery
links. Advice may connect the ledger to relevant goals, priorities, relationships, constraints,
habits, and preferences from User Knowledge, but it must separate facts, inferences, policies, and
recommendations. No stable Tasks review artifact is
implemented by this foundation.

## 9. Surfaces and ownership

Tasks owns its domain schemas, organization rules, feature services and routes, typed-client
feature, web workspace, and 25-tool surgical MCP surface. MCP remains a stateless adapter over the
authenticated public API. There is intentionally no high-level Tasks status or maintenance tool in
current discovery.

Integration owns composition roots, Today composition, global navigation, shared maintenance
infrastructure, the migration journal, and eventual physical Task extraction. Tracking owns future
repeated observations, habits, check-ins, and related goals. Reminders owns current standalone
Reminder lifecycle until Prompt persistence and a reviewed migration exist.

## 10. Acceptance evidence

The implemented slice is covered by domain, PostgreSQL migration and service integration, typed
client, MCP catalog/scope, React interaction, and desktop/mobile Playwright tests. Verification also
covers authorization, revision conflicts, idempotent replay, container concurrency, audit redaction,
restore fallback, complete pagination, canonical URLs, and recovery UI.

This evidence does not prove production maintenance because no maintenance turn exists. The
compatibility observation gate, classifier/golden-corpus execution, recurrence, Prompt persistence,
Reminder conversion, Tracking, physical extraction, and a production-observed Tasks maintenance
run remain explicit follow-ups.
