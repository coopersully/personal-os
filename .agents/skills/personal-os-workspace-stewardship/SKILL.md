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
- observable maintained, maintained-with-questions, blocked, and failed states;
- the required, optional, and prohibited User Knowledge plus purpose, freshness, and sensitivity;
- surgical reads, previews, annotations, corrections, approvals, and recovery;
- a durable maintenance turn for all outstanding work, a time window, and an exact target;
- the rulebook, bounded questions, one-off answers, proposed knowledge, reinforcement, and safe
  promotion boundaries;
- health analysis, recommendations, goals/preferences, and confidence/evidence boundaries; and
- the durable review artifact explaining work, state, uncertainty, advice, and next actions.

## Preserve architecture and authority

Keep expertise, sequencing, learning, and completion decisions in domain/API code. Share only
mechanical run infrastructure. Keep MCP stateless: normally expose `get_<workspace>_status`,
`maintain_<workspace>`, and useful surgical tools as thin typed-API adapters.

Every mutation retains least privilege, source evidence, policy, revision/idempotency controls,
audit, and recovery. User Knowledge may become active through manual promotion or safe repeated
reinforcement, but it never grants action authority or activates a mutation rule. Never
guess missing facts, replay ambiguous external effects, hide outstanding questions in a success
count, or treat a finished process as proof that the workspace is maintained.

## Verify the delivered slice

Test domain decisions, migrated persistence, concurrent claims, retry/recovery, authorization,
audit/redaction, typed API behavior, MCP discovery/results, UI questions/reviews, and a
production-equivalent maintenance turn. Record remaining production risks and Integration-owned
handoffs explicitly.
