# nohmi workspace stewardship

- Status: Target product doctrine
- Last reconciled: 2026-09-10

## Product definition

A workspace steward is nohmi's persistent expert behavior for one product workspace. It maintains
that workspace's living ledger, applies approved domain knowledge and rules, completes authorized
work, isolates questions that require human judgment, learns from answers and safe reinforced
patterns, and produces an evidence-backed review of the current state and how to improve it.

The steward is not an MCP prompt, scheduled client automation, batch-cleanup endpoint, or separate
agent persona. It is nohmi product behavior owned by the domain and available consistently to the
app, API, MCP clients, desktop client, and future first-party callers. A client should be able to
express a small intent such as `maintain finances`; the Finance domain, rather than the client,
knows what maintaining Finances entails.

The four core stewards are Mail, Tasks, Calendar, and Finances. Their complete purposes and
interfaces are defined in [`workspaces and interfaces`](workspaces.md).

## What every workspace steward owns

Each workspace defines these domain-specific capabilities:

1. **Living ledger.** Canonical records, source evidence, provenance, freshness, reconciliations,
   annotations, decisions, rules, questions, and prior review artifacts.
2. **Expert playbook.** A researched, versioned model of the professional disciplines needed to
   care for the ledger. The steward combines their useful methods without claiming a human
   credential.
3. **Definition of maintained.** Observable conditions that distinguish healthy, stale, uncertain,
   incomplete, and blocked states.
4. **Knowledge contract.** The required, optional, and prohibited User Knowledge for each workflow,
   including freshness, sensitivity, missing-data behavior, and allowed learning outputs.
5. **Surgical operations.** Narrow reads, previews, annotations, corrections, and approved actions
   for one exact record or decision.
6. **Maintenance turn.** A durable, resumable workflow that brings all outstanding work—or a named
   time window or exact target—as close to maintained as current evidence and authority permit.
7. **Rulebook and authority.** Versioned domain rules, source meanings, thresholds, action policy,
   and explicit boundaries between automatic, proposed, approved, and unavailable behavior.
8. **Question and learning loop.** Bounded questions with the evidence and choices needed to answer
   them. Answers resolve the present case and may create or reinforce User Knowledge; reusable
   action rules remain subject to their domain approval policy.
9. **Analysis and advice.** A continuing interpretation of what the ledger means, what is changing,
   what the person appears to value, and what options would improve the position. Advice cites its
   evidence, assumptions, time horizon, confidence, and unresolved risks.
10. **Review artifact.** A durable period write-up that explains what was examined, changed,
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

## Two operating modes

Every workspace supports the same conceptual pair:

- **Surgical:** inspect or change one explicitly identified item. This is the precise substrate used
  by the UI, an expert, or a maintenance turn.
- **Maintain:** do everything outstanding within `all`, a bounded time window, or an exact target.
  The domain decides the sequence and records each step.

MCP should normally expose a small orientation/status tool and one maintenance-intent tool for the
workspace, while retaining granular tools when callers need surgical control. Those tools are an
intent surface, not the place where expert judgment, context assembly, or workflow sequencing
lives.

## Scheduling boundary

An external scheduler may invoke a maintenance intent at the person's chosen cadence. Supported
patterns include ChatGPT and Codex scheduled tasks, Claude recurring tasks and routines, Gemini
scheduled actions or headless automation, operating-system schedulers, and other MCP hosts. The
current compatibility matrix and official references live in
[`external automation hosts`](automation-hosts.md).

The scheduler owns when to call. nohmi owns what the intent means, the knowledge and evidence it
requires, durable execution, policy, idempotency, questions, review, recovery, and the verified
terminal result. Scheduled prompts must stay small and must not duplicate the domain workflow.

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
