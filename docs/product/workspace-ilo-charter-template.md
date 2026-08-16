# Workspace Ilo charter template

Use this charter before planning or parallelizing a new workspace Ilo. Replace every bracketed
prompt with a domain-specific decision. Do not begin with MCP tool names; begin with the ledger and
the professional work required to keep it trustworthy.

## 1. Purpose and promise

- **Workspace:** [name]
- **User outcome:** [what the person can understand or accomplish after maintenance]
- **Ilo promise:** [one sentence describing what this Ilo continually keeps true]
- **Explicit non-goals:** [actions, professional claims, or material this Ilo will not own]

## 2. Living ledger

Define the canonical records, provider projections, user annotations, derived models, questions,
rules, decisions, and review artifacts. For each source, name its authority, freshness signal,
revision/provenance identity, reconciliation rule, and degraded state.

## 3. Expert playbook

| Professional discipline | Responsibilities reproduced | Authoritative research | Limits |
| --- | --- | --- | --- |
| [role] | [methods and judgments] | [sources/version/review cadence] | [what requires a human professional] |

The playbook must be domain data or versioned server-owned policy. A coding-agent skill may explain
how to implement it, but a client prompt or model memory must not be its source of truth.

## 4. Definition of maintained

List observable checks for:

- source connection and freshness;
- completeness and reconciliation;
- unresolved uncertainty and stale decisions;
- rules and approvals;
- derived models, goals, or plans;
- pending, failed, or ambiguous external effects; and
- the latest review artifact and its evidence cutoff.

Define the terminal statuses and the exact evidence required for each. A completed process is not
necessarily a maintained workspace.

## 5. Surgical operations

Inventory the narrow operations needed to inspect, preview, annotate, correct, approve, reverse,
and verify one exact item. For every mutation, state its policy (`preview`, `approve_each`, or
`approved_rule`), revision guard, idempotency identity, audit evidence, and recovery path.

## 6. Maintenance turn

Describe the domain-owned sequence for `all`, a bounded time window, and an exact target:

1. establish scope and evidence cutoff;
2. synchronize and inspect;
3. reconcile and deduplicate;
4. apply rules and authorized operations;
5. queue questions;
6. recalculate models and health;
7. advise;
8. publish the review; and
9. verify terminal state.

Specify durable run/step state, leases, retry limits, idempotency, cancellation, recovery, and
concurrent-run behavior. Name what can remain outstanding without misreporting success.

## 7. Rulebook, questions, and learning

- What can the Ilo infer provisionally?
- What needs a one-off answer?
- What can become a future rule only through explicit approval?
- How are rule scope, confidence, exceptions, provenance, version, disablement, and rollback stored?
- Which earlier records are re-evaluated when an answer or rule changes?
- How does the Ilo avoid asking the same resolved question again?

## 8. Analysis, advice, and review artifact

Define the workspace's health rubric, calculations, goals, trends, risks, and recommendation
boundaries. Every recommendation should identify evidence, assumptions, horizon, confidence, and
the person's relevant goals or preferences.

Define a stable review artifact with these sections:

- scope, evidence cutoff, and source freshness;
- work completed and material changes;
- current health and trend;
- outstanding questions and blocked work;
- recommendations and tradeoffs;
- rules learned or proposed; and
- next maintenance point and recovery links.

## 9. Surfaces and ownership

Design the API/domain behavior first. Then map it to:

- workspace UI for inspection, questions, approvals, recovery, and reviews;
- typed API-client contracts;
- a small MCP intent surface, normally `get_<workspace>_status` and
  `maintain_<workspace>`; and
- granular MCP tools only for useful surgical operations.

Keep expert judgment and orchestration in the domain/API. Keep MCP stateless. List every
Integration-owned composition-root or shared-infrastructure change separately so parallel branches
can land the domain slice without repeatedly conflicting.

## 10. Acceptance evidence

Cover pure domain rules, migrated persistence, concurrent claims, retries/recovery, authorization,
audit/redaction, typed API behavior, MCP discovery/results, UI question/review flows, and at least
one production-equivalent maintenance turn. Record what could still fail despite green tests.

## Parallel work packet

Give each implementing agent:

1. this completed charter and the governing workspace ADR;
2. exact owned paths and explicit non-owned integration files;
3. one independently testable vertical slice;
4. its required external-boundary record;
5. target behavior versus the currently shipped slice; and
6. a handoff contract for migrations, shared registries, and composition-root wiring.

Useful starting disciplines include:

| Workspace | Example disciplines |
| --- | --- |
| Finances | Bookkeeper, accountant/controller, planner, investment analyst, auditor, coach |
| Calendar | Executive assistant, scheduler, capacity planner, travel coordinator |
| Mail | Chief of staff, correspondence triager, records clerk, security reviewer |
| Commitments | Project manager, prioritization coach, workload planner, reviewer |
| Goals and motives | Strategy coach, behavior-change designer, progress analyst |
