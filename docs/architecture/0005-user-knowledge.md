# ADR 0005: User Knowledge and purpose-bound context

- Status: Accepted target architecture; agent-managed memory foundation in source (PR #419, not
  merged or deployed)
- Date: 2026-09-10

## Context

Mail, Tasks, Calendar, and Finances need shared knowledge of the person's life to prioritize work,
explain tradeoffs, and reduce repeated questions. The current implementation distributes that
knowledge across account fields, one document-style profile per domain, goals, motives, Finance
profiles, record notes, and attention items; the exported lightweight memory type is not backed by
durable storage or services.

A generic semantic note store would be easy to search but would not reliably distinguish facts,
preferences, inferences, policies, or expired circumstances. Fully separate workspace profiles
would preserve domain ownership but duplicate shared knowledge and allow contradictory views of the
same person.

## Decision

Reconciled 2026-09-28: nohmi is the account's persistent brain, storage, and tools, never a
built-in agent. External agents manage the knowledge and reason over it. Authenticated agents on
the same account can retrieve permitted contributions from other agents and previous runs; an
originating connection records provenance, not exclusive ownership. Retrieval always uses current
permissions. Agent-to-agent reuse retains the original sources and does not become independent
reinforcement merely because a second agent repeats it. Concurrent revisions conflict explicitly.

Adopt a combined domain and shared-knowledge storage model:

1. Workspace domains continue to own canonical operational records, expert playbooks, decisions,
   and action policy.
2. A shared User Knowledge domain owns typed, versioned knowledge about the person with global,
   workspace, entity, sensitivity, and purpose scopes.
3. Typed relationships connect knowledge to workspace records without copying those records into a
   generic schema.
4. Full-text and semantic indexes support discovery but remain rebuildable projections over the
   relational source of truth.
5. Purpose-bound context assembly produces small versioned context packs for tools and workflows.
6. Consequential runs record the exact knowledge revisions used.
7. Workspace work nodes remain operational records. Their resolutions may source or reinforce a
   separate typed knowledge proposal, but a question, approval, or review is not itself memory.

The product contract and memory lifecycle are defined in
[`docs/product/user-knowledge.md`](../product/user-knowledge.md).

## Knowledge and authority

Knowledge can affect interpretation, prioritization, and recommendations. It cannot grant scopes,
activate a domain rule, approve an external mutation, or increase an agent's authority.

Workspace policy remains domain-owned because its safety checks, action language, reversibility,
and evidence requirements differ. A context pack presents applicable policy separately from facts,
preferences, and inferences.

## Lifecycle

The November 15 [agent-managed memory design](../superpowers/specs/2026-11-15-persistent-memory-design.md)
supersedes the November 12 design. Agents manage memory and the person is the override. Agent saves
are active at once, including inferences, which keep their `inferred` origin; origin never changes.
An agent revision or supersession of a memory the person holds (`ownerHeld`) is stored as a linked
`proposed` record and shows as a conflict until the person resolves it. There is no automatic
promotion or learning rule. Legacy revision snapshots remain immutable through a metadata
projection; ordinary changes append revisions.

Forgetting is Trash, not erasure. Trash moves a record and every record derived from it out of all
agent paths at once; the person can restore them within 30 days or use Delete now. A background
pass, at least daily, purges records trashed more than 30 days ago: content, revisions, sources,
tag links and receipt payloads are removed, and a content-free tombstone remains so references read
as forgotten. Other records' revisions that cite a purged ID are not rewritten. There is no external
deletion ledger, so a backup restore can bring purged memory back; that is an accepted non-goal of
this round.

## Storage shape

The initial persistence design should use PostgreSQL and separate stable identity from immutable
revisions. The exact migration requires its own reviewed implementation design, but it must support:

- typed knowledge objects and schema versions;
- immutable revisions and explicit supersession;
- source references and evidence;
- entity and knowledge relationships;
- global, workspace, purpose, sensitivity, and time scopes;
- proposed, active, disputed, superseded, archived, and expired states, plus Trash and
  content-free tombstones;
- owner-scoped tags, tag aliases and reversible tag merges;
- full-text search; and
- a later, optional vector projection whose deletion and rebuild lifecycle follows the source
  record. None exists yet.

JSON payloads may carry type-specific fields during evolution, but each knowledge kind has a
validated domain schema. A single unvalidated JSON object or vector document is not the canonical
model.

## Context assembly

The API owns context assembly. Web and MCP clients may declare a purpose and target, but cannot
bypass authorization, agent access, sensitivity, or workspace policy by issuing a broad query.
Purpose ranks candidates; it is a relevance hint, not an access check.

Ownership and authorization filters run before structured, full-text, or vector candidate
selection. Every source row and derived index entry carries the authenticated owner's tenant key;
shared names, source identifiers, relationships, or semantic similarity cannot bridge users.
Household or delegated context requires an explicit future sharing grant with purpose, scope,
consent, audit, expiry, and revocation rather than an exception to tenant isolation.

Context selection applies access controls before search, ranks candidates using tags, text,
purpose, status, freshness, provenance, and contradiction, and returns bounded sections for facts,
preferences, inferences, policies, evidence, and missing requirements. High-level workspace
workflows declare knowledge contracts and consume context packs internally.

## Ownership

- `packages/domain` owns knowledge kinds, lifecycle, scope, relationship, reinforcement, context,
  and public tool schemas.
- `packages/database` owns relational persistence, tenant-safe indexes, revision history, and
  migrations.
- `apps/api` owns authorization, retrieval, the session-start core, context assembly, Trash and
  purge, audit, and cross-workspace disclosure.
- `packages/api-client` exposes the typed HTTP contract.
- `apps/web` and `apps/mobile` present inspection, correction, conflict resolution, restriction,
  Trash, export, and tag management. These Memory screens follow in separate PRs; Agents settings
  already list the memory scopes.
- `apps/mcp` remains a stateless adapter over the API.
- Workspace domains own their ledgers, knowledge requirements, expert playbooks, and action rules.

## Consequences

- Shared knowledge becomes consistent and correctable without flattening workspace records.
- Agents can retrieve relevant context without receiving the person's entire history.
- Agents record memory as it is said while preserving provenance and explicit authority.
- Context assembly, sensitivity policy, migration, embedding lifecycle, and Trash and purge require
  dedicated implementation and adversarial testing before the target can ship.
- Fine-grained per-agent control over external-model context disclosure remains a deferred future
  layer; credential scopes and purpose-bounded context packs govern the initial target.
- Current document-style profiles remain transitional and must not be described as complete
  persistent memory.

## Current source implementation

The source separates knowledge identity, immutable revisions, sources, relationships, derivations,
tags and idempotency receipts in owner-keyed PostgreSQL tables. The API owns source classification
and live disclosure checks; stateless MCP tools use the typed authenticated client. Reads require
`knowledge:read`; saves and agent updates require both `knowledge:read` and `knowledge:write`.
Both scopes are default grants for new OAuth consents and personal access tokens; token refresh
never adds scopes on its own. Knowledge text rejects NUL and unpaired UTF-16 surrogates before
JSONB persistence, preserving valid Unicode. Knowledge writes emit redacted audit metadata and never
alter domain policy.

Disclosure is narrowed at read time. A record derived from other records takes, from its live
sources, the narrowest workspace (it needs every workspace scope any source needs) and the highest
sensitivity (it is sensitive when any source is). A narrower source narrows the record; it never
denies it, and the owner is never denied their own memory. Purpose is a ranking hint only and never
restricts a read. Agents never see records the person blocked or moved to Trash, and sensitive
records stay out of the session-start core and workflow memory sections.

See the [current implementation boundary](../product/user-knowledge.md#relationship-to-current-implementation).

## Migration 0146

All memory storage is created by one migration, `0146_persistent_memory`. Earlier branch
migrations were never on main or in production, so they were folded into it and deleted rather
than recovered. 0146 creates the knowledge records, revisions, revision metadata, sources,
relationships, derivations, receipts, owner epochs, tags, tag aliases, tag merges, record-tag links
and tombstones, with owner-composite cascading keys so a purge or account deletion removes
dependent rows. It also backfills `knowledge:read` and `knowledge:write`, once and with an audit
row each, onto every live agent credential that holds a workspace scope and no memory scope.

Local worktree databases that ran an earlier branch migration are recreated rather than adopted
in place. Before merge, the production database is checked for any `knowledge_*` tables; if any
exist, work stops for Cooper's decision. Real PostgreSQL fixtures exercise the migration, owner
isolation and the backfill; they establish source behavior, not deployed catalog acceptance.
