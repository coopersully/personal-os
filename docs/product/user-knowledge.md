# nohmi User Knowledge

- Status: Approved target product contract; agent-managed memory foundation in source (PR #419,
  not merged or deployed)
- Last reconciled: 2026-11-18

## Purpose

nohmi is the account's persistent brain, storage, and tools. User Knowledge holds durable,
user-owned understanding that authorized external agents manage and retrieve across agents and
previous runs. The brain is persistent knowledge and domain expertise, not a built-in reasoning
agent. nohmi will never have a built-in agent. External agents interpret, infer, triage, advise,
and converse using the knowledge and workflows nohmi supplies.

Knowledge belongs to the account, not the agent, model vendor, connection, or chat that recorded
it. An authorized agent can retrieve and build on another agent's contributions or an earlier
run's decisions without copying chat history. Current scopes, purpose, sensitivity, and source
permissions still apply; sharing an account does not give every agent unrestricted access.

The purpose is not to remember everything or place a transcript into every model prompt. The
purpose is to retrieve the smallest trustworthy context needed for a specific decision, disclose
what is missing, record what the person says as soon as they say it, and let the person inspect and
correct the resulting model of their life.

User Knowledge is multi-user infrastructure even when an early environment has one account. Every
knowledge object, revision, relationship, evidence source, embedding, search candidate, context
pack, and access record belongs to an authenticated owner and is filtered by that ownership before
structured or semantic retrieval. Similar names, relationships, provider identities, phone numbers,
or embedding proximity can never join knowledge across users. Shared household financial plans
and multiple-person financial management are permanently out of scope. Separate accounts remain
isolated; multiple authorized agents on one account are not multiple financial owners.

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
- an origin of `stated` (the person said or entered it) or `inferred` (an agent's conclusion), which
  never changes, and whether the person holds the current value (`ownerHeld`);
- a status of `proposed`, `active`, `disputed`, `superseded`, `archived`, or `expired`, plus a
  separate Trash state;
- 1-8 tags, a `core` flag, and updated, last-confirmed, valid-from and valid-through times;
- sensitivity, the person's per-record agent access, workspace restriction, and optional purposes
  that rank relevance but never gate access;
- relationships to other knowledge and exact workspace records; and
- immutable revision and supersession history.

Agent contributions also identify their authenticated connection and originating run when present.
They retain the original evidence chain across agent reuse. Another agent repeating an inference
is not independent corroboration. Concurrent edits require the expected revision; conflicts remain
inspectable rather than last-writer-wins. A claim or expiring work lease never grants exclusive
ownership of account knowledge. Revoking a connection ends its access, not the account's ownership
of its prior contributions; deletion and export follow the person's data controls.

The [shared toolkit design](../superpowers/specs/2026-09-28-shared-agent-toolkit-design.md)
specifies cross-agent retrieval, mutation, history, and acceptance requirements. Its detailed
design is pending written review; these account-owned knowledge principles are settled decisions.

The [completion specification](../superpowers/specs/2026-10-12-finance-texting-completion-design.md)
and [shared toolkit plan](../superpowers/plans/2026-10-12-shared-toolkit-completion.md) first
proposed typed storage, opt-in scopes and a narrow promotion rule. The November 15
[agent-managed memory design](../superpowers/specs/2026-11-15-persistent-memory-design.md)
supersedes their memory portions: memory scopes are on by default and there is no promotion rule.

The source record and an exact excerpt or safe structured observation should remain available when
the person is allowed to inspect it. A generated summary is useful retrieval material but cannot be
the only evidence for a durable belief.

## Memory lifecycle

### November 15, 2026 decision: agents manage memory

The [agent-managed memory design](../superpowers/specs/2026-11-15-persistent-memory-design.md)
supersedes the November 12 design and its owner-heavy lifecycle. Cooper decided that agents manage
memory and the person is the override:

1. When the person says something important, the agent saves it right away, with tags. The memory
   is active at once, including an agent's inference, which stays labeled `inferred`.
2. Agents search before saving. When a memory changes, they update or supersede it instead of
   saving a duplicate. They can also dispute, archive, unarchive, restrict to a workspace, raise
   sensitivity, and merge tags.
3. When an agent revises or supersedes a memory the person entered or confirmed, the person's
   value stays active and the agent's version becomes a linked proposal. Both show as a conflict
   until the person resolves it.
4. Only the person can confirm, widen a restriction, set agent access, lower sensitivity, export,
   undo a tag merge, or move memory to and from Trash.
5. Every memory an agent receives carries origin, `ownerHeld`, status, sensitivity, tags,
   freshness, validity and source references. The agent decides whether a memory is good enough to
   act on; nohmi supplies the signals, not a trust score.

There is no automatic learning or promotion rule. The earlier three-selection rule for presentation
preferences was removed; those preferences are ordinary memories that agents or the person save.

### Recall

Every session starts with a compact memory core in `get_ilo_context`: memories marked `core`
(lasting preferences, standing constraints and identity-level facts), the tag index with counts,
and totals. It is capped at 4 KiB and reports truncation. Agents search by text and tags for
everything else. Sensitive memories are returned by search and reads, labeled `sensitive`, but never
load into the core or a workspace workflow's memory section. A memory the person blocks is
invisible to agents everywhere.

### Trash and purge

Forgetting is a soft delete. Trash moves a memory and every memory derived from it out of every
agent path at once. The person can restore them within 30 days. After 30 days, or when the person
chooses Delete now, purge removes content, revisions, sources, tag links and receipt payloads and
leaves a content-free tombstone, so other memories' references read as forgotten. Local backups
taken before purge, and agents that already read the memory, may still have it. Original domain
records remain separately owned.

Tag merges file one tag under another without changing any memory's content; the person can undo
a merge.

## Retrieval and context packs

Semantic search is an index over User Knowledge, not its source of truth. PostgreSQL stores the
typed records, relationships, revisions, policy, and provenance; full-text and vector indexes are
rebuildable retrieval aids.

Retrieval follows this order:

1. Establish the caller, purpose, workspace, target entities, time horizon, and evidence cutoff.
2. Apply ownership, authorization, agent access, Trash, sensitivity, and workspace filters before
   exposing candidates. Purpose ranks candidates; it never gates access.
3. Retrieve candidates through structured relationships, exact filters, full-text search, and
   semantic similarity.
4. Rank by tag and text relevance, purpose, active status, freshness, provenance quality, and
   contradiction.
5. Return a bounded context pack that separates fact, user preference, inference, policy,
   recommendation, and missing knowledge.
6. Later: record the knowledge revisions used by a consequential recommendation or maintenance run.
   Persisted context-use records and `explain_context` are not part of the current round.

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

An external agent processing Texting can retrieve purpose-bound knowledge through the same tools.
Texting does not infer a message's meaning or receive the union of every workspace's context.
Each requested child operation enforces workspace access and disclosure policy independently.

## Agent tools

The agent interface is:

- `get_ilo_context`: identity, time, authority, workspace readiness, available tools, and, with
  `knowledge:read`, the session-start memory core and tag index;
- `get_context_for_intent`: a bounded context pack for an optional purpose, workspace, and target;
- `search_user_knowledge`: text and tag search with kind, workspace, purpose, status and origin
  filters;
- `get_knowledge`: one record with sources, relationships and current status;
- `save_knowledge`: save typed, tagged, sourced memory, active at once;
- `update_knowledge`: revise, supersede, dispute, archive, unarchive, restrict or raise
  sensitivity, with owner-held changes stored as proposals; and
- `merge_knowledge_tags`: file one tag under another.

High-level workspace tools assemble bounded evidence and expose applicable workflows and next
actions. Callers also use surgical knowledge tools to retrieve, contribute, correct, dispute, and
supersede knowledge. Domain checks and deterministic steps stay in nohmi; reasoning and decisions
among permitted next actions belong to the external agent. No hidden internal agent completes them.

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
circumstances, routines, preferences, constraints, workspace knowledge, and recent changes.

The interface must let the person:

- see what nohmi remembers and how fresh it is, with no confidence percentages;
- distinguish what they said from what an external agent inferred and identify that agent/run;
- inspect the source and every workspace allowed to use it;
- confirm, correct, resolve conflicts, restrict, block from agents, archive, trash, restore, or
  delete memory now;
- manage tags, including undoing a merge;
- later, understand which decision or workflow used a belief; and
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
- Sensitive memories never load automatically into the core or workflow memory sections. Agents
  may mark memory sensitive or raise it; only the person can lower it.
- Deleting or disconnecting a provider projection does not silently delete user-authored knowledge,
  but affected provenance becomes unavailable or stale and is surfaced for review.
- The person can block any memory from agents or restrict it to a workspace. Category-level
  controls remain future work.

Fine-grained per-agent controls over which workspace records or User Knowledge categories may enter
an external model host's context are planned but deferred. Until that later layer is designed and
implemented, the target relies on credential scopes, purpose-limited context assembly, and the
privacy rules above; the deferred control must not be described as available.

## Relationship to current implementation

PR #419 (COO-166, COO-167) implements the agent-managed memory foundation in source. It is not
merged or deployed; the [implementation log](implementation-log.md) records what it ships.

- **Storage.** Migration `0146_persistent_memory` creates owner-keyed records, immutable revisions,
  sources, relationships, derivations, receipts, tags, tag aliases and merges, record-tag links and
  tombstones in PostgreSQL. Full-text search is a PostgreSQL index; there is no vector search.
- **API.** `POST/GET /v1/knowledge`, `GET /v1/knowledge/:id`, `/:id/history`, `/:id/actions`,
  `/search`, `/context`, `/tags`, `/tags/merge`, `/tags/unmerge` and `/export`, with typed client
  methods. `get_ilo_context` carries the memory core, and `maintain_finances` starts and
  `maintain_mail` responses carry a 16 KiB workspace memory section, both without sensitive memory.
- **Disclosure.** Every read rechecks the live credential, owner, agent access, Trash state and
  workspace scopes. A memory derived from others takes the narrowest workspace and the highest
  sensitivity of its live sources at read time; the person is never denied their own memory.
- **Trash.** Person-only Trash, restore and Delete now; a background pass at least daily purges
  memory trashed more than 30 days ago.
- **Agent access.** `knowledge:read` and `knowledge:write` are default grants for new OAuth
  consents and personal access tokens. Migration `0146` backfills both onto every live agent
  credential that holds a workspace scope and no memory scope, with an audit row each. The consent screen and
  Agents settings on web and iPhone list them. The person cannot yet remove only the memory scopes
  from a connection; the current way is to revoke the connection and issue a new one without them.
  Per-scope removal is a known gap.
- **Not in this round.** Memory screens on web and iPhone (follow-up PRs, COO-168), per-scope
  removal, vector search, automatic learning, `explain_context` and context-use records, and an
  external deletion record that survives a backup restore.

Incoming typed values are limited to 8 KiB of serialized UTF-8 JSON, with ordinary text fields
limited to 2,048 characters. Inference propositions allow 8,256 characters so automatic agent
interpretations can preserve the complete accepted typed content and its JSON wrapper without
truncation. The 8 KiB request-value limit still applies to directly submitted inferences; generated
inference envelopes may exceed that input limit. Reads and exact retries retain the persisted
proposition verbatim.

Goal revision evidence is rejected until Goals exposes a revision contract. Focused PostgreSQL and
registered MCP/API/client tests establish source behavior, not production availability.

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
