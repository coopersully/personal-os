# nohmi User Knowledge

- Status: Approved target product contract; not yet implemented as a complete system
- Last reconciled: 2026-09-11

## Purpose

User Knowledge is nohmi's durable, user-owned understanding of the person. It lets every authorized
workspace reason with the person's goals, priorities, motives, relationships, circumstances,
preferences, constraints, routines, habits, decisions, and learned patterns without forcing each
workspace to build an isolated and contradictory profile.

The purpose is not to remember everything or place a transcript into every model prompt. The
purpose is to retrieve the smallest trustworthy context needed for a specific decision, disclose
what is missing, learn from outcomes, and let the person inspect and correct the resulting model of
their life.

User Knowledge is multi-user infrastructure even when an early environment has one account. Every
knowledge object, revision, relationship, evidence source, embedding, search candidate, context
pack, and access record belongs to an authenticated owner and is filtered by that ownership before
structured or semantic retrieval. Similar names, relationships, provider identities, phone numbers,
or embedding proximity can never join knowledge across users. Future household or delegated access
requires an explicit sharing, consent, and revocation model rather than weakening this isolation.

## Product boundaries

| Layer | Responsibility | Examples |
| --- | --- | --- |
| Workspace ledger | Exact operational truth owned by one domain | Messages, tasks, events, transactions, balances |
| User Knowledge | Durable understanding that can inform more than one decision | Relationships, priorities, preferences, constraints, account meanings |
| Workspace policy | Approved rules and authority for behavior | Automatically archive one newsletter; never schedule work on Sunday |
| Context pack | Purpose-specific projection supplied to an agent or workflow | Relevant goals, people, constraints, and evidence for planning Tuesday |
| Attention and review | Work or judgment that remains outstanding | A question about an unfamiliar transaction or conflicting calendar event |

Workspace records must not be copied into User Knowledge merely to make them searchable. Free-form
notes remain annotations on their exact records; a durable meaning is promoted into User Knowledge
only when it is expected to matter beyond that one record or decision.

Questions, approvals, reviews, recovery steps, follow-ups, and completed-work summaries are durable
work nodes, not memory by themselves. Resolving one may create or reinforce a separate typed
knowledge proposal with the node and its source material as evidence; the original work node keeps
its own lifecycle and resolution history.

Knowledge never grants authority. A fact or preference may change a recommendation, while an
approved domain policy determines whether nohmi may act automatically.

## Knowledge model

User Knowledge is one logical graph with record-level scope and disclosure controls, backed by
typed, versioned records rather than one generic note blob. Some knowledge is global, some belongs
to one workspace, and some is intentionally shared with several workspaces.

Initial knowledge kinds should include:

- identity and life circumstances;
- people, organizations, and relationships;
- goals, priorities, motives, and values;
- preferences and communication or planning styles;
- obligations, constraints, boundaries, and risk tolerances;
- routines, habits, and working patterns;
- decisions and the rationale behind them;
- meanings assigned to workspace entities such as accounts, calendars, lists, senders, and
  merchants; and
- provisional patterns inferred from repeated behavior.

Goals remain first-class typed objects rather than becoming text memories. They need hierarchy,
horizon, priority, status, measures, evidence, review cadence, and links to relevant Tasks,
Calendar events, Mail conversations, financial plans, people, and other goals.

Every knowledge record must carry:

- a stable identity, kind, typed value, and schema version;
- global, workspace, and entity scopes;
- provenance, source references, and the actor that created or revised it;
- confidence and a status of `proposed`, `active`, `disputed`, `superseded`, or `expired`;
- observed, valid-from, valid-through, reviewed, and next-review times where applicable;
- sensitivity, allowed purposes, and disclosure policy;
- relationships to other knowledge and exact workspace records; and
- immutable revision and supersession history.

The source record and an exact excerpt or safe structured observation should remain available when
the person is allowed to inspect it. A generated summary is useful retrieval material but cannot be
the only evidence for a durable belief.

## Learning lifecycle

1. A user statement may create active knowledge immediately when its meaning and scope are clear.
2. An agent observation creates proposed knowledge with evidence, confidence, scope, sensitivity,
   and an expiry or review condition.
3. Repeated outcomes, corrections, or reuse reinforce or contradict the proposal.
4. The user may promote, edit, restrict, reject, or supersede a proposal at any time.
5. nohmi may automatically promote a safely inferred proposal after repeated reinforcement or
   successful reuse establishes the domain-defined threshold.
6. Promotion records the evidence and reason; it does not create or expand action authority.
7. Later contradictory evidence lowers confidence or creates a review rather than silently
   rewriting the active belief.

Automatic promotion is limited to knowledge categories whose consequence is reversible and whose
meaning can be evaluated from reliable evidence. Sensitive facts, identity claims, high-impact
financial assumptions, and any rule that changes external systems require the stricter
domain-specific confirmation or approval boundary.

Each knowledge kind defines its own reinforcement model. Repetition alone is insufficient when the
same upstream source is duplicated, when the observed behavior may reflect a temporary constraint,
or when the inference would materially affect another person.

## Retrieval and context packs

Semantic search is an index over User Knowledge, not its source of truth. PostgreSQL stores the
typed records, relationships, revisions, policy, and provenance; full-text and vector indexes are
rebuildable retrieval aids.

Retrieval follows this order:

1. Establish the caller, purpose, workspace, target entities, time horizon, and evidence cutoff.
2. Apply ownership, authorization, sensitivity, purpose, and workspace filters before exposing
   candidates.
3. Retrieve candidates through structured relationships, exact filters, full-text search, and
   semantic similarity.
4. Rank by relevance, active status, freshness, confidence, provenance quality, and contradiction.
5. Return a bounded context pack that separates fact, user preference, inference, policy,
   recommendation, and missing knowledge.
6. Record the knowledge revisions used by a consequential recommendation or maintenance run.

Agents should not receive the complete knowledge graph by default. A Finance tool should not see
unrelated Mail content, and an agent scoped only to Tasks should not receive sensitive financial
knowledge merely because semantic similarity is high.

## Knowledge contracts for workflows

Every high-level setup, status, maintenance, and advisory workflow declares a knowledge contract:

- required knowledge and acceptable freshness;
- optional knowledge that may improve the result;
- prohibited or unnecessary knowledge;
- applicable sensitivity and purpose scopes;
- behavior when knowledge is absent, stale, disputed, or contradictory; and
- which outputs may propose new knowledge.

Missing optional knowledge lowers confidence. Missing required knowledge creates a focused question
or blocks only the affected decision; it does not cause the agent to invent an answer or abandon
unrelated work.

Examples:

| Workflow | Relevant knowledge | Typical missing-context response |
| --- | --- | --- |
| Maintain Mail | Important relationships, reply expectations, sender meanings, communication boundaries | Ask who an ambiguous sender is or leave the conversation in review |
| Maintain Tasks | Active priorities, goals, capacity, work patterns, obligations, planning preferences | Ask which competing commitment matters or leave scheduling unset |
| Maintain Calendar | Time zone, work hours, protected time, travel and buffer preferences, relationship context | Surface a conflict or request the missing boundary |
| Maintain Finances | Household circumstances, jurisdiction, income stability, obligations, goals, reserves, risk tolerance | Ask for required evidence and avoid high-impact guidance until answered |
| Process a general text | Communication preferences plus only the knowledge contracts required by the routed intents | Ask which record, workspace, person, or meaning the request refers to before dispatching |

The Texting coordinator may use enough shared knowledge to route a request, but it does not receive
the union of every possible child workspace's context. Each routed child intent retrieves its own
purpose-bound context after workspace access and disclosure policy are established.

## Agent tools

The target agent interface includes:

- `get_nohmi_context`: identity, time, authority, workspace readiness, knowledge readiness, and
  available intent surfaces;
- `get_context_for_intent`: a bounded context pack for a declared purpose, workspace, and target;
- `search_user_knowledge`: surgical hybrid search with explicit kind, scope, time, and sensitivity
  filters;
- `get_knowledge`: one record with evidence, relationships, revisions, and current status;
- `propose_knowledge`: record a typed, sourced hypothesis without treating it as active fact;
- `update_knowledge`: user-authorized correction or scope change;
- `promote_knowledge`: explicit user promotion or a recorded domain-owned safe-promotion outcome;
- `supersede_knowledge`: preserve history while replacing an outdated belief; and
- `explain_context`: show why knowledge was selected, omitted, or considered missing for one run.

High-level workspace tools should assemble their required context internally. Callers use the
surgical knowledge tools for free-form exploration, correction, and explanation, not to recreate
the hidden steps of a maintenance workflow.

## Cross-workspace use

Cross-workspace reasoning uses typed, purpose-bound requests. For example, Finance may ask Mail for
receipt evidence related to an Amazon transaction and receive matching order facts plus source
links; it does not receive a broad mailbox export.

The resulting relationship belongs to the participating domain records, while reusable knowledge
such as an account meaning or merchant preference may be stored in User Knowledge. Every disclosure
records the initiating purpose, scopes, sources, and knowledge revisions used.

## User experience

The person should encounter this system as **About you** or **Your context**, not as a database
administration screen. It should provide simple sections for priorities and goals, people,
circumstances, routines, preferences, constraints, workspace knowledge, and recent learnings.

The interface must let the person:

- see what nohmi believes and how confident it is;
- distinguish what they said from what nohmi inferred;
- inspect the source and every workspace allowed to use it;
- promote, correct, restrict, dispute, supersede, or delete knowledge;
- review recent automatic promotions and their reinforcement evidence;
- understand which decision or workflow used a belief; and
- export their knowledge, relationships, history, and machine-readable schema.

Contextual workspace interfaces should offer the same controls without forcing the person to leave
the item they are reviewing.

## Privacy and security invariants

- Imported messages, events, attachments, webpages, and provider metadata are untrusted content;
  they cannot directly author trusted knowledge, grant authority, or change disclosure policy.
- Knowledge and its embeddings receive the same tenant isolation, retention, deletion, encryption,
  logging, and export treatment as the underlying sensitive data.
- Cross-workspace access is purpose-limited and auditable; a broad read scope is not permission to
  include every relevant-looking belief in model context.
- Sensitive categories use stricter promotion, disclosure, and review policies.
- Deleting or disconnecting a provider projection does not silently delete user-authored knowledge,
  but affected provenance becomes unavailable or stale and is surfaced for review.
- The person can disable learning, automatic promotion, or cross-workspace use by category and can
  inspect the practical consequence before saving the change.

Fine-grained per-agent controls over which workspace records or User Knowledge categories may enter
an external model host's context are planned but deferred. Until that later layer is designed and
implemented, the target relies on credential scopes, purpose-limited context assembly, and the
privacy rules above; the deferred control must not be described as available.

## Relationship to current implementation

| Current record | What it provides | Why it is not complete User Knowledge |
| --- | --- | --- |
| User account | Display name, planning time zone, home location, and workday bounds | Too small for relationships, priorities, provenance, history, or scoped disclosure |
| Domain profile and approval | One versioned objective, summary, instruction/category arrays, source meanings, preferences, and approval per domain | Coarse document revisions; individual beliefs cannot expire, conflict, relate, or move between scopes cleanly |
| Goals and motives | Simple user-owned goals, target dates, progress, motives, and active state | No hierarchy, measures, priority relationship, provenance, history, or typed links to workspace material |
| Finance profiles and profile versions | Financial circumstances, employment, household, income, reserve, debt, insurance, risk, and provenance fields | Overlaps general personal context and exists in more than one Finance-specific shape |
| Task, Mail, Calendar, and Finance notes | Context attached to an exact operational record | Not reusable or semantically connected beyond that record |
| Attention items and workspace reviews | Durable outstanding work, questions, and summaries | A queue is not memory and resolution does not create a typed reusable belief |
| Lightweight memory domain type | Title, content, source actor, and timestamps | No durable database, API, retrieval, policy, provenance detail, relationships, lifecycle, or user-management surface |

These records are useful migration inputs but do not yet constitute User Knowledge.

Migration must preserve source wording and approvals, identify conflicting or duplicated profile
facts, and avoid automatically promoting coarse summaries into active knowledge. Existing
workspace policies remain domain-owned throughout migration and never acquire authority merely
because their text appears in User Knowledge.
