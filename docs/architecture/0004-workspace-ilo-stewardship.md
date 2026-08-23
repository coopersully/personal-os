# ADR 0004: Workspace Ilo stewardship

- Status: Accepted
- Date: 2026-08-15

## Context

An MCP client can invoke tools, but it cannot be the source of Ilo's domain expertise, workflow
ordering, rules, durable progress, or truth about whether a workspace is maintained. Encoding that
behavior in host prompts would make outcomes vary by client, lose learning between sessions, and
turn retries into duplicate or unobservable work.

Each workspace also needs more than generic cleanup. It needs a domain ledger, a researched expert
playbook, exact operations, a bounded authority model, a learning loop, analysis, and a review that
explains the resulting state. Those concepts must remain domain-owned while sharing reliable run
infrastructure.

The product doctrine is defined in
[`ilo-workspace-stewardship.md`](../product/ilo-workspace-stewardship.md).

## Decision

Implement each workspace Ilo as these layered, domain-owned contracts:

1. **Ledger:** canonical material, provider projections, provenance, annotations, questions, rules,
   decisions, and review artifacts.
2. **Playbook:** versioned professional knowledge, calculations, health rubric, recommendation
   boundaries, and research provenance.
3. **Rulebook:** active preferences, approved rules, exceptions, confidence policy, source scope,
   and action authority.
4. **Surgical operations:** small idempotent or revision-guarded domain operations with audit and
   recovery behavior.
5. **Maintenance coordinator:** a durable run composed of named steps that can claim, resume,
   retry, settle, and report work over `all`, a time window, or an exact target.
6. **Question and proposal model:** evidence-linked uncertainty that can resolve one case or propose
   an explicitly approved reusable rule.
7. **Status and review model:** readiness, freshness, backlog, health, recommendations, terminal
   run state, and a durable period narrative.

The generic maintenance substrate may own run/step identifiers, leases, fencing, idempotency,
terminal settlement, retry history, and common result envelopes. It must not encode what counts as
a duplicate transaction, an urgent conversation, a scheduling conflict, a healthy budget, or any
other domain judgment.

## Package responsibilities

- `packages/domain` owns workspace schemas, invariants, playbook/rule contracts, maintenance
  commands, status, questions, advice, and review shapes.
- `packages/database` owns durable ledgers, rules, maintenance runs/steps, review artifacts, and
  repositories.
- `packages/connectors` supplies provider evidence and capabilities; it does not decide the
  workspace's maintained state.
- `apps/api` owns domain orchestration, authorization, synchronization, durable execution, audit,
  and recovery.
- `packages/api-client` exposes typed status, maintenance, and surgical operations.
- `apps/web` presents source health, ledger state, questions, approvals, advice, and reviews.
- `apps/mcp` remains a stateless adapter. It exposes intent and surgical tools but owns no playbook,
  sequencing, learning, or completion decision.

Repository agent skills are engineering instructions only. They help coding agents implement this
architecture; they are not runtime expertise, user memory, an approval source, or a prerequisite
for an MCP host.

## MCP shape

Prefer two high-level operations per mature workspace:

- `get_<workspace>_status` returns readiness, source freshness, maintenance backlog, open questions,
  latest review, and safe next intent.
- `maintain_<workspace>` starts, resumes, or verifies a domain-owned maintenance turn for a bounded
  scope and returns a durable handle or terminal result.

Retain granular tools for surgical inspection, previews, and exact authorized actions. Do not make
the high-level operation a synchronous loop of client-authored calls. Consequential authority stays
at each underlying operation, and a maintenance request cannot widen the caller's scopes or policy.

Finance adds a deliberate agent-challenge boundary between preparation and
settlement. `maintain_finances` owns the durable run and prepares the candidate;
`get_finance_ledger_challenge` pages its complete public evidence;
`submit_finance_ledger_challenge` records versioned rubric coverage and
structured findings. The API—not the MCP host—then applies the app-only review
setting, verifies the committed result, and publishes the period review.

## Reliability and observation

A maintenance run records its requested scope, evidence cutoff, playbook/rulebook versions, steps,
claims, effects, questions, failures, review artifact, and terminal status. External effects follow
the connector reliability contract. Process loss resumes from durable state; concurrent requests
coalesce or fence; ambiguous effects reconcile before replay. Status and review surfaces must
distinguish queued, active, maintained, maintained-with-questions, blocked, and failed work.

## Parallel development

Start each workspace from the
[`workspace Ilo charter template`](../product/workspace-ilo-charter-template.md). Domain branches
own their ledger semantics, playbook, operations, coordinator, and review contract. Shared run
infrastructure and composition roots remain Integration-owned and should land through thin,
explicit registration seams.

## Consequences

- A simple client instruction can produce consistent behavior across MCP hosts because Ilo owns the
  workflow.
- User answers and approved rules persist independently of a conversation or model vendor.
- Reviews explain partial completion and advice instead of reducing a run to success/failure.
- Shared infrastructure can improve reliability without flattening domain expertise into a generic
  workflow engine.
- Each workspace can be developed in parallel against an explicit charter and stable integration
  seams.
- The architecture is incremental: existing tools remain valid while status, maintenance, learning,
  and review capabilities are delivered workspace by workspace.
