# ADR 0005: User Knowledge and purpose-bound context

- Status: Accepted target architecture; implementation pending
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

Adopt a hybrid model:

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

The product contract and learning lifecycle are defined in
[`docs/product/user-knowledge.md`](../product/user-knowledge.md).

## Knowledge and authority

Knowledge can affect interpretation, prioritization, and recommendations. It cannot grant scopes,
activate a domain rule, approve an external mutation, or increase an agent's authority.

Workspace policy remains domain-owned because its safety checks, action language, reversibility,
and evidence requirements differ. A context pack presents applicable policy separately from facts,
preferences, and inferences.

## Promotion

User-authored knowledge may be active immediately when unambiguous. Agent-inferred knowledge begins
as a proposal and may become active through explicit user promotion or a domain-defined safe
promotion rule after independent reinforcement or successful reuse.

Automatic promotion records its evidence and remains limited to reversible knowledge categories.
Sensitive identity, relationship, financial, and health-like claims plus every authority-changing
rule retain stricter confirmation boundaries.

## Storage shape

The initial persistence design should use PostgreSQL and separate stable identity from immutable
revisions. The exact migration requires its own reviewed implementation design, but it must support:

- typed knowledge objects and schema versions;
- immutable revisions and explicit supersession;
- source references and evidence;
- entity and knowledge relationships;
- global, workspace, purpose, sensitivity, and time scopes;
- proposal, active, disputed, superseded, and expired states;
- reinforcement and promotion evidence;
- full-text search; and
- an optional vector projection whose deletion and rebuild lifecycle follows the source record.

JSON payloads may carry type-specific fields during evolution, but each knowledge kind has a
validated domain schema. A single unvalidated JSON object or vector document is not the canonical
model.

## Context assembly

The API owns context assembly. Web and MCP clients declare purpose and target but cannot bypass
authorization, sensitivity, or workspace policy by issuing a semantically broad query.

Ownership and authorization filters run before structured, full-text, or vector candidate
selection. Every source row and derived index entry carries the authenticated owner's tenant key;
shared names, source identifiers, relationships, or semantic similarity cannot bridge users.
Household or delegated context requires an explicit future sharing grant with purpose, scope,
consent, audit, expiry, and revocation rather than an exception to tenant isolation.

Context selection applies access controls before similarity search, ranks candidates using status,
freshness, confidence, provenance, and contradiction, and returns bounded sections for facts,
preferences, inferences, policies, evidence, and missing requirements. High-level workspace
workflows declare knowledge contracts and consume context packs internally.

## Ownership

- `packages/domain` owns knowledge kinds, lifecycle, scope, relationship, reinforcement, context,
  and public tool schemas.
- `packages/database` owns relational persistence, tenant-safe indexes, revision history, and
  migrations.
- `apps/api` owns authorization, promotion evaluation, retrieval, context assembly, audit, and
  cross-workspace disclosure.
- `packages/api-client` exposes the typed HTTP contract.
- `apps/web` presents user inspection, correction, promotion, restriction, export, and deletion.
- `apps/mcp` remains a stateless adapter over the API.
- Workspace domains own their ledgers, knowledge requirements, expert playbooks, and action rules.

## Consequences

- Shared knowledge becomes consistent and correctable without flattening workspace records.
- Agents can retrieve relevant context without receiving the person's entire history.
- The system can learn progressively while preserving provenance and explicit authority.
- Context assembly, promotion thresholds, sensitivity policy, migration, embedding lifecycle, and
  deletion require dedicated implementation and adversarial testing before the target can ship.
- Fine-grained per-agent control over external-model context disclosure remains a deferred future
  layer; credential scopes and purpose-bounded context packs govern the initial target.
- Current document-style profiles remain transitional and must not be described as complete
  persistent memory.
