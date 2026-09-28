# nohmi workspace stewardship

- Status: Target product doctrine
- Last reconciled: 2026-09-28

## Product definition

A workspace's stewardship contract is the knowledge, workflows, tools, and deterministic
automation nohmi provides to external agents and the person. nohmi is the account's persistent
brain and storage; it will never have a built-in agent. Synchronization, normalization, reliable
calculations, explicit rule execution, evidence checks, and durable work reduce entropy and give
agents high-signal material to triage. External agents supply reasoning, conversation, interpretation,
recommendations, and judgments that are not explicit deterministic operations.

Agents manage knowledge through nohmi, and other authorized agents or previous/later runs on the
same account can retrieve and build on it. The domain retains evidence, provenance, corrections,
permissions, and shared state; no host's private session is the canonical memory. References below
to interviews, learning, advice, questions, and narrative reviews mean agent/toolkit collaboration,
not an internal model loop.

The person may describe how they want the workspace to operate in ordinary language. Guided setup
turns that intent into explicit source meanings, preferences, review cadence, notifications, and
proposed rules. It may propose a complete rule set at once, but every rule remains inactive until a
dedicated, version-bound preview shows its scope, examples, consequences, conflicts, authority, and
recovery path and the owning domain receives the required approval.

The toolkit is available consistently through app, API, and MCP. A high-level intent such as
`maintain finances` can run deterministic preparation and return a resumable work queue, relevant
knowledge, workflow guidance, and permitted next actions. It need not finish agent judgment in
one call. Agents follow or adapt the supplied guidance within enforced domain invariants; they
do not reimplement calculations, persistence, permission checks, or provider reliability.

The four core stewards are Mail, Tasks, Calendar, and Finances. Their complete purposes and
interfaces are defined in [`workspaces and interfaces`](workspaces.md).

Each steward's sources, maintained-state definition, maintenance guidance, notification overrides,
rules, learning, recovery, data controls, and domain access posture have one canonical editor inside
that workspace. Centralized Settings owns global policy, channels, connected-agent credentials and
scopes, User Knowledge controls, and unified Reviews; its cross-workspace overview summarizes and
deep-links to workspace controls without duplicating their editors.

## What every workspace steward owns

Each workspace defines these domain-specific capabilities:

1. **Living ledger.** Canonical records, source evidence, provenance, freshness, reconciliations,
   annotations, decisions, rules, questions, and prior review artifacts.
2. **Expert playbook.** Researched, versioned knowledge and procedures that external agents can
   retrieve and apply to the ledger without claiming a human credential.
3. **Definition of maintained.** Observable conditions that distinguish healthy, stale, uncertain,
   incomplete, and blocked states.
4. **Knowledge contract.** The required, optional, and prohibited User Knowledge for each workflow,
   including freshness, sensitivity, missing-data behavior, and allowed learning outputs.
5. **Guided setup.** A resumable interview that learns the person's goals, source meanings,
   constraints, desired workflow, and review preferences, then proposes configuration and any
   number of inactive rules for dedicated preview.
6. **Surgical operations.** Narrow reads, previews, annotations, corrections, and approved actions
   for one exact record or decision.
7. **Maintenance turn.** A durable, resumable workflow that brings all outstanding work—or a named
   time window or exact target—as close to maintained as current evidence and authority permit.
8. **Rulebook and authority.** Versioned domain rules, source meanings, thresholds, action policy,
   and explicit boundaries between automatic, proposed, approved, and unavailable behavior.
9. **Question and learning loop.** Bounded questions with the evidence and choices needed to answer
   them. Answers resolve the present case and may create or reinforce User Knowledge; reusable
   action rules remain subject to their domain approval policy.
10. **Analysis and advice support.** Reliable analytical tools and durable, agent-authored advice
    citing evidence, assumptions, time horizon, confidence, and unresolved risks. nohmi validates
    references and authority; it does not generate expert judgment internally.
11. **Review artifact.** A durable period write-up that explains what was examined, changed,
    learned, left outstanding, and recommended next. It links back to source material, the User
    Knowledge revisions used, and the activity trail.

## The maintenance turn

A workspace maintenance turn follows one domain-owned loop:

1. Establish the requested scope, purpose, and evidence cutoff.
2. Synchronize or inspect every relevant source and report freshness honestly.
3. Load the bounded context pack required by the workspace's knowledge contract.
4. Reconcile duplicate, missing, conflicting, provisional, and stale material.
5. Apply the active rulebook and perform only actions allowed by current authority.
6. Use surgical operations to organize, annotate, classify, or repair exact records.
7. Queue irreducible uncertainty as compact questions; do not hide it in a generic failure count.
8. Recalculate the workspace's models, goals, health measures, and forward-looking risks.
9. Record proposed or reinforced knowledge separately from domain policy.
10. Produce advice and a review artifact, then verify the resulting state against the definition of
    maintained.

The result may be `maintained`, `maintained_with_questions`, `blocked`, or `failed`; it must never
claim completion merely because a process ran. Work that outlives a request uses API-owned durable
state, leases, idempotency, and recovery. Repeating the same intent must resume or verify prior work
rather than duplicate it.

For a request spanning workspaces, each child operation settles under its owning domain. The
coordinator preserves verified successes, keeps failed, blocked, and uncertain siblings explicit,
and reports the combined truth without claiming atomic completion or automatically undoing useful
work solely because another child failed.

## Durable work nodes

“Node” is the conceptual name for an evidence-linked unit that setup or maintenance leaves for the
person or a later run. The product should present concrete domain language—question, approval,
review, recovery step, follow-up, or completed-work summary—rather than expose a generic graph or
database term.

Every node has an owning workspace, type, lifecycle, source evidence, reason, consequence, related
records, and resolution history. Answering a node resolves the immediate case and may propose or
reinforce User Knowledge or a domain rule; it does not automatically turn the answer into authority.
Later runs must reuse resolved answers and active knowledge so repeated maintenance creates fewer
unnecessary nodes while still surfacing genuinely new uncertainty.

## Two operating modes

Every workspace supports the same conceptual pair:

- **Surgical:** inspect or change one explicitly identified item. This is the precise substrate used
  by the UI, an expert, or a maintenance turn.
- **Maintain:** do everything outstanding within `all`, a bounded time window, or an exact target.
  The domain supplies deterministic stages and durable work; external agents perform judgment
  steps and select permitted operations. The run records both without hosting the agent.

MCP should expose orientation/status, maintenance support, and granular tools for control. The
API owns context assembly, deterministic workflow steps, state and authority. External agents
retrieve the playbook, reason over evidence, and select permitted next steps. MCP remains a thin
adapter, not a second policy engine or a hidden reasoning agent.

Where onboarding is nontrivial, the same surface also exposes a setup intent or shared setup plan.
Across workspaces the vocabulary should remain predictable: setup defines how the workspace should
work, status explains its current state, maintain performs the durable stewardship turn, and
surgical tools inspect or change one exact thing.

Setup may return a large proposed rule set, grouped or paginated for usability, without activating
it. Each rule must remain individually inspectable and deselectable in a dedicated preview covering
condition, scope, source selection, representative matches and non-matches, action, consequences,
conflicts and precedence, required authority, and disable/rollback behavior. Activation binds to
the exact previewed versions; drift requires a new preview, and global review bypass does not
activate action rules.

## Scheduling boundary

External callers choose their execution and cadence; nohmi never hosts the agent or creates,
edits or executes its recurring schedule. No host registration, cloud runtime, local schedule
identity, wake-up mechanism or agent response time is required. The contract is
[external caller interoperability](automation-hosts.md).

Several authorized agents may work on the same account. Polling for work is supported; optional
events announce availability without guaranteeing external execution. Claims, revision checks,
idempotency and shared receipts coordinate callers. Account-owned knowledge and work remain
available to later authorized runs. Optional caller metadata cannot grant authority.

nohmi continues deterministic synchronization, approved rules and accepted-work recovery under its
domain contracts. These reduce entropy or complete accepted effects; they do not replace external
reasoning or create recurring agent work. Work requiring judgment remains honestly pending.

## Learning and promotion

User-authored knowledge may become active immediately when unambiguous. Agent-inferred knowledge
begins as a proposal and may become active through manual user promotion or through a domain-defined
safe-promotion rule after independent reinforcement or successful reuse.

Automatic promotion is limited to reversible knowledge categories and records its evidence,
confidence, scope, and rationale. It never increases authority, activates an external action rule,
or bypasses stricter confirmation for sensitive or high-impact claims. The complete lifecycle is
defined in [`User Knowledge`](user-knowledge.md).

## Finance steward

The Finance steward combines the useful disciplines of a bookkeeper, accountant/controller,
financial planner, investment analyst, auditor, and financial coach. Its ledger includes accounts,
balances, transactions, classifications, transfers, income, recurring obligations, budgets,
savings, investments, liabilities, goals, questions, rules, and period reviews.

A Finance maintenance turn closes the selected period as far as the evidence allows: reconcile
accounts and transfers; classify and annotate posted activity; place spending and income against
the budget; update recurring, cash-flow, savings, investment, liability, and net-worth views;
separate one-off decisions from reusable rules; score financial health against an explainable
rubric; and publish a write-up of changes, budget position, outstanding questions, risks, and
recommended next steps.

Budget health includes pacing above and below the person's approved plan. The steward should warn
when spending threatens obligations or goals and also notice persistent underspending when it means
the person is not funding a stated need, goal, or quality-of-life priority; it informs the tradeoff
and lets the person decide what to value.

The current implementation realizes part of that turn as prepare → agent challenge → settle →
verify → period review. Preparation is read/project only. The agent reviews the entire candidate
against a fixed rubric and can correct, remove, or question work without mutating the canonical
ledger. Settlement applies that exact challenged candidate immediately when the user enabled
Finance review bypass, or places the whole turn into one app approval when they did not. Missing
facts remain questions in either mode.

Its advice should connect evidence to the person's goals and demonstrated tradeoffs. It may explain
budget reallocations, savings priorities, investment considerations, and relevant market context as
informational guidance. Volatile claims must identify their source and as-of time. The steward never
moves money, trades, pays a bill, files a return, invents missing facts, or presents itself as a
licensed fiduciary, accountant, or tax professional.

## Research and trust

Expert playbooks are product assets, not hidden model memory. Record their sources, jurisdiction or
market applicability, version, review date, assumptions, and which calculations or recommendations
they influence. Prefer primary and authoritative sources. Refresh time-sensitive material before
using it and make the evidence cutoff visible in the review.

Keep facts, inferences, preferences, policies, and recommendations distinct. Confidence cannot
replace evidence or authority. When sources conflict, data is stale, or a decision depends on the
person's intent, surface the uncertainty and ask a bounded question.

## Target direction versus shipped behavior

This document defines the target product contract for workspace stewardship. It does not imply that
every workspace or capability above is shipped. The implementation log, code, migrations, tests,
and deployed evidence determine the current slice; plans and pull requests name which parts of the
doctrine they deliver and which remain explicit follow-ups.
