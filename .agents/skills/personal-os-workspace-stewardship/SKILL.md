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

Treat external agent platforms as the sole authority for recurring maintenance schedules. nohmi
may report a declared host, expected cadence, last observed invocation, and overdue or unknown
check-in health, but those records must never trigger work or modify the external schedule. Internal
queues, leases, retries, delayed authorized effects, and recovery timers may only continue an
invocation nohmi already accepted; they cannot originate a new recurring maintenance turn.

Do not impose one exclusive scheduler per workspace or intent. Multiple hosts and overlapping
schedules are allowed. Give every declared schedule an immutable nohmi-owned local identity; require
scheduled maintenance API/MCP inputs to carry it, validate it against the authenticated connection,
and propagate it through run, health, revocation, idempotency, and coalescing records. Treat a host
automation identity as optional evidence and leave schedule identity absent for manual or otherwise
unscheduled calls. Preserve scope and idempotency identity so the API can coalesce compatible
durable work and keep incompatible scopes separate without replaying effects.

Allow guided setup to propose any number of rules, but keep every rule inactive until a dedicated,
version-bound preview exposes its condition, scope, sources, representative matches and
non-matches, action, consequences, conflicts/precedence, required authority, and disable/rollback
path. Large sets may be grouped and paginated only if each rule remains inspectable and deselectable.
Invalidate the preview after proposal or sample drift. Setup completion and global review bypass do
not activate an action rule.

Every mutation retains least privilege, source evidence, policy, revision/idempotency controls,
audit, and recovery. User Knowledge may become active through manual promotion or safe repeated
reinforcement, but it never grants action authority or activates a mutation rule. Never
guess missing facts, replay ambiguous external effects, hide outstanding questions in a success
count, or treat a finished process as proof that the workspace is maintained.

Workspaces publish notification intents but never call Twilio, read the shared SMS conversation, or
route general-inbox requests. Read `docs/product/texting-operations.md` and
`docs/architecture/0006-texting-inbox.md` when a steward sends or receives Texting work. The global
review-bypass policy applies across channels; workspace settings cannot widen it.

Treat notification eligibility as one shared policy across SMS, in-app, push, email, and future
channels. Channel-specific controls may choose enablement, destination, supported interaction,
links, format, and medium-appropriate detail, but they may only suppress delivery: they cannot make
a suppressed intent eligible, bypass quiet hours or deduplication, widen authority, or exceed the
shared privacy ceiling.

Give every workspace-owned setting one canonical editor inside its workspace. Centralized Settings
owns global policy, channels, connected-agent credentials/scopes, User Knowledge controls, and
unified Reviews; it may show a read-only cross-workspace overview and deep links, but never a second
editable copy of sources, maintenance behavior, workspace overrides, rules, learning, recovery,
data controls, or domain access posture.

Publish canonical times and typed entity context rather than pre-rendering `today`, `yesterday`, or
`tomorrow`. Texting owns conversion into the person's current time zone and final relative-date
language immediately before delivery.

Keep notification summaries formal, short, and concise. Texting may supply as many directly
answerable questions or actions as reasonably fit, with a hard cap of three and permission to use
only one or two when clarity requires. Every multi-item message includes the unified Settings-owned
Reviews link; if additional work remains or needs richer context, add one short overflow summary.
Do not request one proactive message per item or workspace.

Number each item in a multi-item text and bind that short reference to the exact message and
proposal revision. Require the reply to identify every answered number; accept a direct bounded
answer without a reference only when one unambiguous active item exists.

Create or reference a unified Reviews item for every question, approval, connector failure,
recovery step, or other state that explicitly requires the person. Keep informational and
automatically recoverable conditions in workspace status and activity instead of generating review
or notification noise.

When one request spans workspaces, preserve every verified successful child operation and report
failed, blocked, and uncertain siblings exactly. Never describe partial completion as complete or
automatically reverse useful verified work merely to simulate an atomic cross-provider result.

Do not add a redundant link to a self-contained single question. Request an exact-item or workspace
link when that decision needs more context or cannot fit a reasonable SMS; every multi-item message
uses the unified Settings-owned Reviews link.

Assume proactive maintenance texts defer during the person's global quiet hours unless `any time`
is explicitly enabled. Texting revalidates deferred items at release; the workspace must keep the
underlying question or action state current rather than treating a queued notification as truth.
Texting consolidates multiple current items into one Reviews alert after quiet hours.

Give each notification intent the durable work-item identity needed for deduplication. Rediscovery
in later maintenance runs must not request another message; Texting may remind only after the
person's configured interval and after revalidating the item. The default is 7 days, and `never`
suppresses repeats without resolving or hiding the work item. Prefer silence over notification
completeness.

Before the reminder interval, request another notification for the same item only when the
required action or the consequence of acting or not acting materially changes. Do not treat new
wording, evidence, confidence, rediscovery, or internal progress as new eligibility when the action
and consequence are unchanged. Keep the semantic revision explicit so Texting can deduplicate and
revalidate it while continuing to enforce quiet hours.

## Verify the delivered slice

Test domain decisions, migrated persistence, concurrent claims, retry/recovery, authorization,
audit/redaction, typed API behavior, MCP discovery/results, UI questions/reviews, and a
production-equivalent maintenance turn. Record remaining production risks and Integration-owned
handoffs explicitly.
