# Shared agent toolkit and persistent knowledge design

> Historical planning context imported November 12, 2026. Current canonical product contracts,
> later accepted decisions, and implementation evidence supersede conflicting assumptions here.
> This import does not authorize Finance/Texting expansion or establish shipped Memory capability.

- Status: Written design for Cooper's review; conversation-level direction approved 2026-09-28.
- Source baseline: `origin/main` at `f918b63a91fd8a997af75e9f14b02f53f4305b49`, merged and
  inspected 2026-10-12. Source evidence is not production proof.
- Reconciliation: [satisfied requirements and revised remaining-work roadmap](../../engineering/finance-texting-spec-reconciliation.md).
  Existing implementation is retained; detailed design choices remain subject to written review.
- Companion specs: [Finance](2026-09-28-finance-toolkit-design.md),
  [Texting](2026-09-28-texting-toolkit-design.md).
- Authority: [master design](../../product/master-design.md),
  [User Knowledge](../../product/user-knowledge.md),
  [stewardship](../../product/workspace-stewardship.md).
- Scope: design only. Detailed implementation plans are now drafted at Cooper's request for review. No runtime,
  migration, external account, production message, or existing automation changes are authorized
  by this document alone.

Detailed completion contracts and task plans were requested on 2026-10-12. Read the
[completion specification](2026-10-12-finance-texting-completion-design.md) and
[implementation map](../plans/2026-10-12-finance-texting-completion.md) with this design.
The new documents refine remaining work; product implementation has not begun.

## 1. Intent and settled boundaries

nohmi is the account's persistent brain, storage, knowledge, workflows, and tools. It will never
have a built-in agent. Its entropy-reducing automations produce high-signal material for external
agents to understand, triage, and act on. Agents manage and control knowledge through tools;
other authorized agents on the same account and later runs can retrieve and extend that knowledge.
Knowledge is account-owned, not agent-owned or session-owned.

External agents own reasoning, interpretation, conversation, prioritization judgments, and advice.
nohmi owns synchronization, normalization, deterministic calculations and approved rules, evidence,
authority checks, durable work, and verified effects. It supplies guidance without requiring an
agent to reimplement domain mechanics. It neither chooses a model nor substitutes one when a
caller is absent. No host vendor, local/cloud runtime, schedule declaration, wake-up mechanism,
agent response time, or vendor certification is a product prerequisite.

One financial plan serves one person. The service can contain separate isolated accounts; several
authorized agents can work for the same account. Shared household financial plans and multi-person
financial management are permanently excluded. USD is the current boundary; currencies may be
extended later without introducing financial co-ownership or weakening isolation.

## 2. Design choice and delivery structure

Use three coordinated specs with staged, usable journeys. Finance owns financial truth; Texting
owns the channel; shared toolkit contracts own cross-agent knowledge and durable work access.
The existing monorepo remains intact. Avoid a generic replacement object store or a new agent
orchestration subsystem.

Finishing Finance before Texting would delay the first useful conversation. A single all-at-once
release would conceal unavailable dependencies. The chosen sequence delivers a real question,
SMS answer, fresh-session retrieval, authorized resolution, and app result first, then completes
the broader financial and cross-workspace capabilities.

The first journey may use bounded structured knowledge and existing domain records. Full typed
knowledge lifecycle and cross-agent reuse remain required for full completion; vector search,
model hosting, and vendor-specific adapters are not prerequisites.

## 3. Existing foundation and remaining work (2026-10-12)

| Surface | Satisfied source capability | Completion requirement |
| --- | --- | --- |
| Authority and operations | Expanded API/MCP execution with opt-in execute scopes, owner bypass and attributed approvals; real protocol/database evidence | Reuse these controls for new operations; preserve owner-only scope/bypass/consent boundaries |
| Durable Finance work | Canonical runs, questions/answers, history/evidence and accepted-answer continuation receipts | Generic bounded discovery and safe cross-connection handoff without a mandatory schedule |
| Knowledge | Domain profiles, goals, source notes and signed Finance context | Shared typed persistence, cross-agent retrieval, conflicts, provenance-preserving migration and controls remain |
| Texting work | Real notification producer/drain, bounded Finance SMS admission, acknowledgments and startup/tick recovery | Agent-facing general work discovery/claims and coordinated handling remain |
| External continuation | Persisted vendor schedules, APIs/MCP, setup UI, dispatcher and recovery | Retain as optional integration; provide generic work access without weakening existing ownership fences |

The earlier statement that host integration was only a schema is no longer true. Current host-bound
runs deliberately reject another authorization connection; an arbitrary fresh agent cannot resume
one. Same-account collaboration needs a reviewed ownership transfer/claim contract, not removal of
those checks. Pending knowledge/work are separate from host authority and must retain audit history.

The inspected tree still has no complete shared User Knowledge persistence/tool lifecycle. Shared
profiles and Finance context are valuable source material, not proof that agent B can retrieve and
manage typed knowledge from agent A. Current tool execution evidence is recorded in
[workspace agent verification](../../engineering/workspace-agent-verification.md); provider doubles
and successful blocked/needs-input outcomes are not production or complete-workflow proof.

## 4. Component boundaries

| Component | Responsibilities and dependencies |
| --- | --- |
| Domain ledgers | Native records, exact effects, evidence, calculations, policy and recovery; authoritative for financial/mail/task/calendar meaning |
| Knowledge service | Account-owned typed facts, preferences, hypotheses, relationships, revisions and disclosure; references domain sources without copying ledgers |
| Context assembly | Permission-filtered, purpose-bound projections of knowledge and domain evidence; no model-based interpretation |
| Workflow support | Versioned playbooks, deterministic preparation, next-action schemas, work discovery, claims and progress; yields when judgment is needed |
| API | Authenticates owner/connection and enforces capability, policy, revisions, idempotency and audit |
| MCP and app | Thin access to the same operations, with explicit unavailable and stronger-approval boundaries |
| Optional event delivery | Durable notifications of available work; no promise that a receiver starts or finishes an agent |

Shared orchestration infrastructure stores references to existing domain work. It must not create
a second Finance question, approval, transaction, or answer store. Extensions stay in domain-owned
modules; central exports/routes are composition seams, not new business-logic owners.

## 5. Shared knowledge lifecycle

Each record has an owner, stable ID, schema/kind, typed value, scope, sensitivity, allowed purposes,
validity dates, status, immutable revisions, source references, creating actor/connection, and run
reference when applicable. Distinguish user-stated facts, preferences, agent inferences, decisions,
recommendations, and approved policies. Policy remains in the owning domain.

An agent with appropriate write access may capture a clear user statement as active fact with its
exact message/source provenance; saving it does not require a second routine confirmation.
An inferred interpretation starts as proposed knowledge. Existing safe deterministic promotion
rules can operate only on independently evidenced, eligible categories; they never turn repetition
by multiple agents into independent evidence. High-impact assumptions retain confirmation gates.

Agents can create, retrieve, search, revise, dispute, supersede, and link permitted knowledge.
Promotion or correction requires current revision and authority. A newer write does not silently
erase a conflicting active value. The user can inspect, correct, restrict, export, or delete the
record and identify the contributing agent. One-off transaction notes remain domain notes unless
an agent explicitly records a reusable fact with its source.

The same account's agent B can retrieve a fact saved by agent A, inspect its source and revision,
and record a new supported revision. Connection revocation denies future access immediately but
does not erase account-owned contributions. It does not grant B A's broader scopes. Ownership and
disclosure apply to retrieval, search candidates, context packs, exports, references and events.

## 6. High-signal reads and tool contracts

Prefer bounded structured retrieval and full-text discovery first. Return the context relevant to
the declared workspace, operation, entities and time window: current facts, uncertainties,
contradictions, previous decisions, open work, playbook version and permitted next actions. Include
source/revision references so the caller can inspect evidence. Do not dump account history or
provide hidden reasoning traces. Semantic indexes may later improve retrieval; they cannot become
the source of truth or introduce an internal reasoning agent.

Target capabilities, rather than claims of already registered tool names:

- Orient: identity, scopes, capability availability, freshness and relevant work counts.
- Inspect: bounded context, knowledge history, domain evidence and exact work state.
- Prepare: propose a knowledge change or domain effect and preview current consequences.
- Claim/resume: acquire eligible work and retrieve existing accepted outcomes.
- Execute: commit an authorized operation using stable identity and current revisions.
- Verify/recover: read the receipt/effect and the next safe recovery action.

High-level tools may perform deterministic preparation and return work awaiting agent judgment.
Granular tools support free-form agent workflows. Both enforce identical domain semantics. Tool
catalogs must disclose manual-only or stronger approval requirements instead of promising absolute
agent parity. New public names require a deliberate caller cutover, not compatibility aliases.

## 7. Durable work and overlapping agents

Use domain work IDs, account-scoped operation IDs, immutable accepted receipts, and revision-bound
effects. A work claim has an authenticated holder, expiry and fencing token. It coordinates action;
it does not hide the knowledge from other authorized readers. Claim expiry permits recovery, but
never erases or re-executes an accepted effect. Manual actions remain possible and invalidate stale
proposals. Claim, authorization, revision and idempotency checks occur at commit, not only at read.

Distinguish ready work, claimed work, waiting for agent, waiting for user, awaiting approval,
applied, blocked, failed, and uncertain outcomes. Separate conversation handling from domain
completion and delivery. A note/answer receipt is not an applied financial effect. Existing state
names may be projected into this vocabulary rather than rewritten wholesale.

Persist all information required for another authorized session to resume. Do not require the
original host, agent identity or private transcript. A replacement caller still needs current
scopes and cannot inherit revoked authority. Completed children remain successful if siblings fail.

## 8. Polling and optional events

Authenticated bounded work discovery with stable cursors is required. Advancing a discovery cursor
does not acknowledge or complete work. Historical work and active claims remain inspectable under
current permissions. A caller may poll on any schedule or only when a person opens its session.

The full toolkit also offers optional authenticated event subscriptions, separate from agent-host
registration. Events carry minimal IDs/revisions/type and fetch links, never message bodies,
knowledge values or credentials. A transactional outbox publishes only committed work. Delivery
is at least once with stable event identity, bounded retries and observable failure. Consumers
deduplicate and retrieve authoritative current state before acting. Event delivery cannot grant
scopes or represent successful agent execution. Polling remains a recovery path.

For push subscriptions, verify endpoint ownership and allowed HTTPS destinations; defend against
private-network targets, redirect/rebinding attacks, replay and credential leakage. Signing and
rotation, revocation, expiry, bounded payloads and delivery recovery belong to the event boundary.
Implementation plans must name concrete timeout/retry/retention values and runtime network evidence
before this optional external boundary ships. The question/reply journey does not depend on push.

## 9. Migration and compatibility

Extend existing work and knowledge sources through explicit mappings. Preserve original wording,
record identity, approval evidence and source status. Profile prose is not automatically a verified
fact; conflicts become visible. An implementation inventory must identify each live reader/writer
before changing a shared contract. Published migrations remain immutable; expand/repair/cutover
must preserve accepted work and rollback readability.

The now-implemented host registry is retained as an optional integration, not promoted into a
required toolkit dependency. Preserve existing accepted work, secrets, revocation and original-
connection guards; provide a reviewed cutover to generic connection/work identity where needed. Removing a target requirement is not authorization to
delete persisted runtime data or alter existing external schedules.

## 10. Completion and verification

Acceptance must prove:

1. Agent A records a sourced fact; authorized agent B and a fresh session retrieve it, while a
   narrower credential and another account cannot read it.
2. Concurrent contradictory edits create a visible conflict; repeat agent summaries do not falsely
   reinforce a belief. Revocation, deletion, export and stale-source behavior are correct.
3. An interrupted claim is recoverable; duplicate operations and manual-resolution races do not
   duplicate effects. Wrong-owner and expired credentials fail closed.
4. Every declared capability has app/API/MCP behavior or a precise unavailable/approval reason.
5. New incoming SMS remains available without any host registration, schedule or active agent.
6. Optional event delivery tolerates duplicates, outage, revocation and replay without losing work
   or promising external execution; polling can recover the same work.

Use domain/unit tests, real PostgreSQL integration for concurrency and migration, API/MCP contract
checks, and desktop/mobile acceptance for inspection and correction. Future implementation PRs
run `pnpm verify`. Real external boundaries need authorized production-equivalent evidence; mocks
do not prove Twilio, connectors, event transport or another vendor's runtime.

## 11. Staged completion

First expose generic work discovery and safe handoff over the now-connected Finance question/answer
and SMS runtime, with bounded shared structured account knowledge. Do not rebuild its producer,
recovery loops, host controls or registered agent adapters. Then finish Finance planning/authority, shared knowledge
management and general cross-workspace Texting. Finish optional events and broader reporting without
holding the initial usable journey for host integrations or semantic retrieval. These are dependency
boundaries for the linked plans, not dispatched tasks or claims of delivered milestones.
