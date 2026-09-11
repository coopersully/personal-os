---
name: personal-os-workspace-stewardship
description: Use when designing, implementing, or reviewing a nohmi workspace steward, maintenance workflow, expert playbook, knowledge contract, domain rulebook, learning loop, advisory output, or period review.
---

# nohmi workspace stewardship

Build each workspace as an expert, self-maintaining product domain rather than a collection of CRUD tools or
client-authored prompts.

## Establish the product contract

Read these before planning code:

1. `docs/product/workspace-stewardship.md`
2. the workspace's product section and architecture ADR
3. `docs/architecture/0004-workspace-stewardship.md`
4. `docs/engineering/feature-ownership.md`
5. the external-boundary and connector reliability docs when sources or durable work are involved

Complete `docs/product/workspace-charter-template.md` for a new workspace. Distinguish target
behavior from the shipped slice; do not update the implementation log until capability ships.

## Design the whole stewardship loop

Define all of the following before naming MCP tools:

- the living ledger, evidence, freshness, provenance, and reconciliation rules;
- the professional disciplines, researched/versioned playbook, and hard limits;
- a resumable guided setup that translates the person's goals, source meanings, constraints,
  desired workflow, review cadence, and notifications into proposed configuration and rules;
- observable maintained, maintained-with-questions, blocked, and failed states;
- the required, optional, and prohibited User Knowledge plus purpose, freshness, and sensitivity;
- surgical reads, previews, annotations, corrections, approvals, and recovery;
- a durable maintenance turn for all outstanding work, a time window, and an exact target;
- the rulebook and typed work nodes for questions, approvals, reviews, recovery, follow-up, and
  completed-work summaries, including how answers create or reinforce proposed knowledge;
- reinforcement and safe promotion boundaries plus how later runs avoid repeating resolved
  questions;
- typed notification intents, per-workspace channel settings, safe summaries, minimum useful entity
  context, canonical times, reply vocabulary, and first-party review or recovery links;
- health analysis, recommendations, goals/preferences, and confidence/evidence boundaries; and
- the durable review artifact explaining work, state, uncertainty, advice, and next actions.

## Preserve architecture and authority

Keep expertise, sequencing, learning, and completion decisions in domain/API code. Share only
mechanical run infrastructure. Keep MCP stateless: normally expose `get_<workspace>_status`,
`maintain_<workspace>`, useful surgical tools, and `setup_<workspace>` or the shared setup plan when
onboarding is nontrivial, all as thin typed-API adapters.

Every mutation retains least privilege, source evidence, policy, revision/idempotency controls,
audit, and recovery. User Knowledge may become active through manual promotion or safe repeated
reinforcement, but it never grants action authority or activates a mutation rule. Never
guess missing facts, replay ambiguous external effects, hide outstanding questions in a success
count, or treat a finished process as proof that the workspace is maintained.

Workspaces publish notification intents but never call Twilio, read the shared SMS conversation, or
route general-inbox requests. Read `docs/product/texting-operations.md` and
`docs/architecture/0006-texting-inbox.md` when a steward sends or receives Texting work. The global
review-bypass policy applies across channels; workspace settings cannot widen it.

Publish canonical times and typed entity context rather than pre-rendering `today`, `yesterday`, or
`tomorrow`. Texting owns conversion into the person's current time zone and final relative-date
language immediately before delivery.

Keep notification summaries formal, short, and concise. Supply one directly answerable item when
only one is open. For multiple questions or actions, let Texting send one cross-workspace statement
that several items need review plus the unified Settings-owned Reviews link; do not request one
message per item or workspace.

Do not add a redundant link to a self-contained single question. Request an exact-item or workspace
link when that decision needs more context or cannot fit a reasonable SMS; multiple items use the
unified Settings-owned Reviews link.

Assume proactive maintenance texts defer during the person's global quiet hours unless `any time`
is explicitly enabled. Texting revalidates deferred items at release; the workspace must keep the
underlying question or action state current rather than treating a queued notification as truth.
Texting consolidates multiple current items into one Reviews alert after quiet hours.

## Verify the delivered slice

Test domain decisions, migrated persistence, concurrent claims, retry/recovery, authorization,
audit/redaction, typed API behavior, MCP discovery/results, UI questions/reviews, and a
production-equivalent maintenance turn. Record remaining production risks and Integration-owned
handoffs explicitly.
