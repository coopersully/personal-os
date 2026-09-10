# Ilo workspace stewardship

- Status: Target product doctrine
- Date: 2026-08-15

## Product definition

An Ilo is the persistent expert steward for one product workspace. It maintains that workspace's
living ledger, applies approved domain knowledge and rules, completes authorized work, isolates
questions that require human judgment, learns from the answers, and produces an evidence-backed
review of the current state and how to improve it.

The Ilo is not an MCP prompt, a scheduled client automation, a batch-cleanup endpoint, or a generic
agent persona. It is Ilo product behavior owned by the domain and available consistently to the web
app, API, MCP clients, and future first-party callers. A client should be able to express a small
intent such as `maintain finances`; the Finance Ilo, rather than the client, knows what maintaining
Finances entails.

## What every workspace Ilo owns

Each workspace defines these domain-specific capabilities:

1. **Living ledger.** Canonical records, source evidence, provenance, freshness, reconciliations,
   annotations, decisions, rules, questions, and prior review artifacts.
2. **Expert playbook.** A researched, versioned model of the professional disciplines needed to
   care for the ledger. The Ilo combines their useful methods without claiming a human credential.
3. **Definition of maintained.** Observable conditions that distinguish healthy, stale, uncertain,
   incomplete, and blocked states.
4. **Surgical operations.** Narrow reads, previews, annotations, corrections, and approved actions
   for one exact record or decision.
5. **Maintenance turn.** A durable, resumable workflow that brings all outstanding work—or a named
   time window or exact target—as close to maintained as current evidence and authority permit.
6. **Rulebook and authority.** Versioned domain rules, source meanings, preferences, thresholds,
   action policy, and explicit boundaries between automatic, proposed, approved, and unavailable
   behavior.
7. **Question and learning loop.** Bounded questions with the evidence and choices needed to answer
   them. An answer resolves the present case and becomes a reusable rule only when the person
   explicitly approves that generalization.
8. **Analysis and advice.** A continuing interpretation of what the ledger means, what is changing,
   what the person appears to value, and what options would improve the position. Advice cites its
   evidence, assumptions, time horizon, confidence, and unresolved risks.
9. **Review artifact.** A durable period write-up that explains what was examined, changed, learned,
   left outstanding, and recommended next. It links back to source material and the activity trail.

## The maintenance turn

A workspace maintenance turn follows one domain-owned loop:

1. Establish the requested scope and an evidence cutoff.
2. Synchronize or inspect every relevant source and report freshness honestly.
3. Reconcile duplicate, missing, conflicting, provisional, and stale material.
4. Apply the active rulebook and perform only actions allowed by current authority.
5. Use surgical operations to organize, annotate, classify, or repair exact records.
6. Queue irreducible uncertainty as compact questions; do not hide it in a generic failure count.
7. Recalculate the workspace's models, goals, health measures, and forward-looking risks.
8. Produce advice and a review artifact, then verify the resulting state against the definition of
   maintained.

The result may be `maintained`, `maintained_with_questions`, `blocked`, or `failed`; it must never
claim completion merely because a process ran. Work that outlives a request uses API-owned durable
state, leases, idempotency, and recovery. Repeating the same intent must resume or verify prior work
rather than duplicate it.

## Two operating modes

Every Ilo supports the same conceptual pair:

- **Surgical:** inspect or change one explicitly identified item. This is the precise substrate used
  by the UI, an expert, or a maintenance turn.
- **Maintain:** do everything outstanding within `all`, a bounded time window, or an exact target.
  The domain decides the sequence and records each step.

MCP should normally expose a small orientation/status tool and one maintenance-intent tool for the
workspace, while retaining granular tools when callers need surgical control. Those tools are an
intent surface, not the place where expert judgment or workflow sequencing lives.

## Finance Ilo

The Finance Ilo combines the useful disciplines of a bookkeeper, accountant/controller, financial
planner, investment analyst, auditor, and financial coach. Its ledger includes accounts, balances,
transactions, classifications, transfers, income, recurring obligations, budgets, savings,
investments, liabilities, goals, questions, rules, and period reviews.

A Finance maintenance turn closes the selected period as far as the evidence allows: reconcile
accounts and transfers; classify and annotate posted activity; place spending and income against
the budget; update recurring, cash-flow, savings, investment, liability, and net-worth views;
separate one-off decisions from reusable rules; score financial health against an explainable
rubric; and publish a write-up of changes, budget position, outstanding questions, risks, and
recommended next steps.

The implementation realizes that turn as prepare → agent challenge → settle →
verify → period review. Preparation is read/project only. The agent reviews the
entire candidate against a fixed rubric and can correct, remove, or question
work without mutating the canonical ledger. Settlement applies that exact
challenged candidate immediately when the user enabled Finance review bypass,
or places the whole turn into one app approval when they did not. Missing facts
remain questions in either mode.

Its advice should connect evidence to the person's goals and demonstrated tradeoffs. It may explain
budget reallocations, savings priorities, investment considerations, and relevant market context as
informational guidance. Volatile claims must identify their source and as-of time. The Ilo never
moves money, trades, pays a bill, files a return, invents missing facts, or presents itself as a
licensed fiduciary, accountant, or tax professional.

## Research and trust

Expert playbooks are product assets, not hidden model memory. Record their sources, jurisdiction or
market applicability, version, review date, assumptions, and which calculations or recommendations
they influence. Prefer primary and authoritative sources. Refresh time-sensitive material before
using it and make the evidence cutoff visible in the review.

Keep facts, inferences, preferences, and recommendations distinct. Confidence cannot replace
evidence or authority. When sources conflict, data is stale, or a decision depends on the person's
intent, surface the uncertainty and ask a bounded question.

## Target direction versus shipped behavior

This document defines the target product contract for workspace Ilos. It does not imply that every
workspace or every capability above is already shipped. The implementation log, code, migrations,
tests, and deployed evidence determine the current slice. Plans and PRs should name which parts of
the doctrine they deliver and which remain explicit follow-ups.
